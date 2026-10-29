"""Streaming, local-only Excel audit workbook exporter.

Uses the Python standard library already required by ScanAuditor. No patient
records are sent to the Electron renderer, a web service, or any AI provider.
Each worksheet is streamed from SQLite and automatically split at Excel's
1,048,576-row limit. The workbook is for audit operations, NOT authorization
to destroy paper records.
"""
import datetime
import itertools
import json
import math
import os
import re
import sqlite3
import tempfile
import zipfile
from xml.sax.saxutils import escape

MAX_ROWS = 1048576
INVALID_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]")
CELL_LIMIT = 32767
COLORS = {"header": "243B5B", "dark": "25364A", "white": "FFFFFF"}
# Same plain-language concepts displayed in the ScanAuditor review interface.
LABELS = {
    "UNREADABLE_PAGE": "Unreadable page",
    "POSSIBLE_CUTOFF": "Possibly cropped or cut-off content",
    "CUT_OFF_TEXT": "Cut-off text",
    "POSSIBLE_INCOMPLETE_PAGE": "Possibly incomplete page",
    "BLURRY_PAGE": "Blurry page",
    "DARK_PAGE": "Page too dark",
    "LIGHT_PAGE": "Page too light",
    "ORIENTATION_ISSUE": "Page rotated or misaligned",
    "PRINTED_PAGE_SEQUENCE_GAP": "Possible missing numbered page",
    "POSSIBLE_TRAILING_PAGES": "Possible missing final page(s)",
    "REPEATED_PRINTED_PAGE_NUMBER": "Repeated printed page number",
    "UNCONFIRMED_PAGE_NUMBER_JUMP": "Uncertain printed page sequence",
    "POSSIBLY_BLANK_PAGE": "Possibly blank page",
    "CONTENT_AT_RISK": "Potential loss of page content",
    "PARTIALLY_UNCERTAIN_CONTENT": "Content difficult to assess",
    "ANALYSIS_INCOMPLETE": "Analysis did not finish",
    "IMAGE_ANALYSIS_INCOMPLETE": "Image analysis did not finish",
    "IMAGE_METRICS_INCOMPLETE": "Image quality checks did not finish",
    "UNRESOLVED_PAGE": "Page relationship needs review",
    "UNCERTAIN_IDENTIFIER": "Uncertain patient identifier",
    "MULTIPLE_PATIENT_IDENTIFIERS": "Multiple patient identifiers",
    "REGISTRATION_DISCREPANCY": "Registration number differs from patient folder",
    "PATIENT_NAME_DISCREPANCY": "Patient name differs from patient folder",
    "CONFLICTING_PATIENT_NAMES": "Different patient names repeated across pages",
    "DATE_ANOMALY": "Date inconsistency",
    "EXACT_DUPLICATE": "Duplicate page detected",
    "POSSIBLE_DUPLICATE": "Possible duplicate page",
    "ANALYSIS_FAILED": "Analysis failed",
}

def label(code):
    return LABELS.get(code, str(code or "Unknown").replace("_", " ").capitalize())

def xml_text(value):
    """All user/database strings are literal Excel strings, never formulas."""
    text = INVALID_XML.sub("", str(value if value is not None else ""))
    if text.lstrip().startswith(("=", "+", "-", "@")):
        text = "'" + text
    return escape(text[:CELL_LIMIT], {'"': '&quot;', "'": '&apos;'})

def colref(number):
    """Zero-based Excel column reference."""
    result = ""
    number += 1
    while number:
        number, digit = divmod(number - 1, 26)
        result = chr(65 + digit) + result
    return result

def xcell(value, col, row):
    ref = colref(col) + str(row)
    if type(value) is int or (type(value) is float and math.isfinite(value)):
        return f'<c r="{ref}"><v>{value}</v></c>'
    if value is None:
        return ""
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{xml_text(value)}</t></is></c>'

def row_xml(values, rownum, header=False):
    attrs = f' r="{rownum}"'
    if header:
        attrs += ' s="1" customFormat="1" ht="34" customHeight="1"'
    cells = []
    for col, value in enumerate(values):
        if header:
            cells.append(f'<c r="{colref(col)}{rownum}" s="1" t="inlineStr"><is><t>{xml_text(value)}</t></is></c>')
        else:
            result = xcell(value, col, rownum)
            if result:
                cells.append(result)
    return "<row" + attrs + ">" + "".join(cells) + "</row>"

def styles_xml():
    return ('''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><color rgb="FF25364A"/><name val="Aptos"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>
</fonts><fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF243B5B"/><bgColor indexed="64"/></patternFill></fill>
</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>''')

class WorkbookWriter:
    def __init__(self, zip_file):
        self.zf = zip_file
        self.sheet_names = []

    def write_table(self, title, columns, rows, widths=None):
        iterator = iter(rows)
        pending = next(iterator, None)
        part = 1
        written = 0
        while pending is not None or part == 1:
            name = title if part == 1 else title[:27] + " " + str(part)
            if len(name) > 31:
                raise ValueError("Excel worksheet name exceeds limit")
            self.sheet_names.append(name)
            sheet_no = len(self.sheet_names)
            with self.zf.open(f'xl/worksheets/sheet{sheet_no}.xml', 'w') as raw:
                def put(text):
                    raw.write(text.encode('utf-8'))
                put('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
                put(f'<dimension ref="A1:{colref(len(columns)-1)}1"/>')
                put('<sheetViews><sheetView workbookViewId="0">'
                    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
                    '</sheetView></sheetViews>')
                widths = widths or [26] * len(columns)
                put('<cols>' + ''.join(
                    f'<col min="{i+1}" max="{i+1}" width="{w}" customWidth="1"/>'
                    for i, w in enumerate(widths)) + '</cols>')
                put('<sheetData>' + row_xml(columns, 1, True))
                rownum = 1
                while pending is not None and rownum < MAX_ROWS:
                    rownum += 1
                    if len(pending) != len(columns):
                        raise ValueError("Unexpected report column count")
                    put(row_xml(pending, rownum))
                    pending = next(iterator, None)
                written += rownum - 1
                put('</sheetData>')
                put(f'<autoFilter ref="A1:{colref(len(columns)-1)}{rownum}"/>')
                put('</worksheet>')
            part += 1
        return written

    def finish(self):
        sheets = ''.join(
            f'<sheet name="{xml_text(n)}" sheetId="{i}" r:id="rId{i}"/>'
            for i, n in enumerate(self.sheet_names, 1))
        self.zf.writestr('xl/workbook.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<sheets>{sheets}</sheets></workbook>')
        self.zf.writestr('xl/_rels/workbook.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + ''.join(
                f'<Relationship Id="rId{i}" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                f'Target="worksheets/sheet{i}.xml"/>'
                for i in range(1, len(self.sheet_names)+1))
            + f'<Relationship Id="rId{len(self.sheet_names)+1}" '
              'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
              'Target="styles.xml"/></Relationships>')
        self.zf.writestr('xl/styles.xml', styles_xml())
        self.zf.writestr('_rels/.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="xl/workbook.xml"/></Relationships>')
        overrides = ''.join(
            f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            for i in range(1, len(self.sheet_names)+1))
        self.zf.writestr('[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/styles.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            + overrides + '</Types>')

def query_rows(db, sql, params):
    # SQLite cursors are consumed one row at a time to keep memory bounded.
    for row in db.execute(sql, params):
        yield tuple(row)

def historic_findings(db, pid):
    rows = db.execute("""SELECT d.id,d.display_name,r.revision,r.analyzed_at,
        r.status,r.evidence_json
        FROM document_runs r JOIN documents d ON d.id=r.document_id
        WHERE d.project_id=? ORDER BY r.id""", (pid,))
    for doc_id, name, revision, stamp, status, evidence in rows:
        try:
            qa = json.loads(evidence).get("qa") or {}
            for source, kind in (("findings", "Review finding"),
                                 ("informational", "Informational")):
                for finding in qa.get(source) or []:
                    if not isinstance(finding, dict):
                        continue
                    code = finding.get("code")
                    pages = finding.get("pages") or []
                    for page in (pages if pages else [None]):
                        yield (doc_id, name, revision, stamp, status, kind,
                               code, label(code), page)
        except (TypeError, ValueError, AttributeError):
            # Older or malformed snapshots remain visible in Analysis Runs.
            continue

def export_complete_audit(db, project_id, destination):
    if not isinstance(project_id, str) or not 0 < len(project_id) <= 90:
        raise ValueError("Invalid project")
    if not isinstance(destination, str) or not 0 < len(destination) <= 4096 or "\x00" in destination:
        raise ValueError("Invalid destination")
    project = db.execute("SELECT id,label,mode,kind,created_at FROM projects WHERE id=?",
                         (project_id,)).fetchone()
    if project is None:
        raise ValueError("Unknown audit project")
    metrics = db.execute("""SELECT count(*) documents,
        coalesce(sum(page_count),0) pages,
        coalesce(sum(qa_status='passed'),0) passed,
        coalesce(sum(qa_status='review-required'),0) review_required,
        coalesce(sum(qa_status='analysis-failed'),0) analysis_failed,
        coalesce(sum(association_status='needs-review'),0) identity_review,
        coalesce(sum(review_outcome IS NOT NULL AND review_outcome!='inconclusive'),0) reviewed,
        coalesce(sum(comparison_basis='paper-compared' AND review_outcome IS NOT NULL),0) paper_compared,
        coalesce(sum((qa_status!='passed' OR association_status='needs-review') AND
          (review_outcome IS NULL OR review_outcome='inconclusive')),0) outstanding_review
        FROM documents WHERE project_id=?""", (project_id,)).fetchone()
    outstanding_actions = db.execute("""SELECT count(*) FROM corrective_actions a
        JOIN documents d ON d.id=a.document_id WHERE d.project_id=? AND a.status='open'""",
        (project_id,)).fetchone()[0]
    completed_actions = db.execute("""SELECT count(*) FROM corrective_actions a
        JOIN documents d ON d.id=a.document_id WHERE d.project_id=? AND a.status='completed'""",
        (project_id,)).fetchone()[0]

    overview = [
        ("Project", project["label"]), ("Project ID", project_id),
        ("Project type", project["kind"]), ("AI mode", project["mode"]),
        ("Project created (UTC)", project["created_at"]),
        ("Report exported (UTC)", datetime.datetime.now(datetime.timezone.utc).isoformat()),
        ("Documents indexed", metrics["documents"]),
        ("Pages in indexed PDFs", metrics["pages"]),
        ("Automated QA passed", metrics["passed"]),
        ("Automated QA review required", metrics["review_required"]),
        ("Analysis failed", metrics["analysis_failed"]),
        ("Identity / filing reviews flagged", metrics["identity_review"]),
        ("Definitive human reviews (current)", metrics["reviewed"]),
        ("Paper-compared outcomes (staff-reported, current)", metrics["paper_compared"]),
        ("Unresolved flagged records", metrics["outstanding_review"]),
        ("Open corrective actions", outstanding_actions),
        ("Completed corrective actions", completed_actions),
        ("Scope", "Selected audit project only; all records, not just the visible queue page."),
        ("Findings scope", "Current Findings is the latest stored assessment; Run Findings History contains earlier coded snapshots."),
        ("Reviewer identity", "Reviewer names/IDs are staff-entered and NOT authenticated."),
        ("Paper comparison", "Paper-compared is a staff-reported decision basis, not an independently verified source-completeness certificate."),
        ("Disposal limitation", "Neither automated QA nor this export authorizes paper destruction."),
        ("Sensitive information", "Contains local source paths, filenames, reviewer labels and other potentially identifying data."),
    ]

    # Create adjacent, private temporary output. Replace only once complete.
    directory = os.path.dirname(os.path.abspath(destination))
    fd, temporary = tempfile.mkstemp(prefix=".scanauditor-report-", suffix=".xlsx", dir=directory)
    os.close(fd)
    try:
        try:
            os.chmod(temporary, 0o600)
        except OSError:
            pass  # NTFS permissions derive from the hospital-controlled folder.
        totals = {}
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED,
                             compresslevel=6, allowZip64=True) as archive:
            book = WorkbookWriter(archive)
            totals["summary"] = book.write_table("Executive Summary",
                ["Measure", "Value"], overview, [48, 95])
            totals["records"] = book.write_table("Record Register",
                ["Record ID", "Filename", "Local source path", "PDF pages",
                 "Overall audit", "Scan quality", "Identity / filing", "Latest human outcome",
                 "Review basis", "Reviewer (staff-entered)", "Reviewed at (UTC)",
                 "Current revision", "Last analyzed (UTC)", "Open actions"],
                query_rows(db, """SELECT d.id,d.display_name,d.source_path,d.page_count,
                CASE WHEN d.qa_status!='passed' OR d.association_status='needs-review'
                  THEN 'review-required' ELSE 'passed' END,
                d.qa_status,d.association_status,d.review_outcome,d.comparison_basis,
                d.reviewer_label,d.reviewed_at,d.revision,d.analyzed_at,
                (SELECT count(*) FROM corrective_actions a
                 WHERE a.document_id=d.id AND a.status='open')
                FROM documents d WHERE d.project_id=? ORDER BY d.id""", (project_id,)),
                [13, 37, 65, 13, 20, 21, 22, 29, 19, 25, 27, 15, 27, 14])
            def current_rows():
                for doc_id, name, kind, code, page in query_rows(db, """SELECT
                    d.id,d.display_name,f.kind,f.code,f.page_number
                    FROM findings f JOIN documents d ON d.id=f.document_id
                    WHERE d.project_id=? ORDER BY d.id,f.id""", (project_id,)):
                    yield (doc_id, name, "Review finding" if kind == "review" else "Informational",
                           code, label(code), page if page is not None else "Entire record")
            totals["findings"] = book.write_table("Current Findings",
                ["Record ID", "Filename", "Finding category", "Finding code", "Issue identified", "PDF page"],
                current_rows(), [13, 40, 20, 37, 55, 15])
            totals["runs"] = book.write_table("Analysis Runs",
                ["Record ID", "Filename", "Revision", "Analyzed at (UTC)",
                 "Automated status at run", "PDF pages", "Source SHA-256",
                 "Evidence SHA-256", "Historical / current"],
                ((r[0],r[1],r[2],r[3],r[4],r[5],r[6],r[7],
                  "Current revision" if r[2] == r[8] else "Historical")
                 for r in query_rows(db, """SELECT d.id,d.display_name,r.revision,r.analyzed_at,
                     r.status,r.page_count,r.input_sha256,
                     json_extract(r.evidence_json,'$.evidenceSha256'),d.revision
                     FROM document_runs r JOIN documents d ON d.id=r.document_id
                     WHERE d.project_id=? ORDER BY r.id""", (project_id,))),
                [13, 40, 12, 27, 25, 13, 69, 69, 22])
            totals["historic_findings"] = book.write_table("Run Findings History",
                ["Record ID", "Filename", "Revision", "Analyzed at (UTC)",
                 "QA status at run", "Finding category", "Finding code",
                 "Issue identified", "PDF page"],
                historic_findings(db, project_id),
                [13, 40, 12, 27, 22, 20, 39, 55, 15])
            totals["reviews"] = book.write_table("Human Review Decisions",
                ["Record ID", "Filename", "Review outcome", "Verification basis",
                 "Reviewer (staff-entered)", "Decision date (UTC)", "Revision",
                 "Decision status"],
                query_rows(db, """SELECT d.id,d.display_name,r.outcome,r.comparison_basis,
                    r.reviewer_label,r.timestamp,r.revision,
                    CASE WHEN d.review_outcome IS NOT NULL AND r.id=(
                      SELECT max(r2.id) FROM review_events r2 WHERE r2.document_id=d.id)
                      AND r.revision=d.revision THEN 'Current' ELSE 'Historical / superseded' END
                    FROM review_events r JOIN documents d ON d.id=r.document_id
                    WHERE d.project_id=? ORDER BY r.id""", (project_id,)),
                [13, 40, 31, 22, 26, 28, 12, 26])
            totals["actions"] = book.write_table("Corrective Actions",
                ["Action ID", "Record ID", "Filename", "Action type", "Current status",
                 "Created at (UTC)", "Closed at (UTC)", "Requested by (staff-entered)",
                 "Revision"],
                query_rows(db, """SELECT a.id,d.id,d.display_name,a.kind,a.status,
                    a.created_at,a.closed_at,a.reviewer_label,a.revision
                    FROM corrective_actions a JOIN documents d ON d.id=a.document_id
                    WHERE d.project_id=? ORDER BY a.id""", (project_id,)),
                [13, 13, 40, 27, 20, 29, 29, 27, 12])
            totals["action_history"] = book.write_table("Action History",
                ["Action ID", "Record ID", "Filename", "Action type",
                 "Status event", "Event date (UTC)", "Recorded by (staff-entered)"],
                query_rows(db, """SELECT a.id,d.id,d.display_name,a.kind,e.status,
                    e.timestamp,e.reviewer_label
                    FROM action_events e
                    JOIN corrective_actions a ON a.id=e.action_id
                    JOIN documents d ON d.id=a.document_id
                    WHERE d.project_id=? ORDER BY e.id""", (project_id,)),
                [13, 13, 40, 27, 19, 29, 28])
            book.finish()
        os.replace(temporary, destination)
        return {"saved": True, "rows": metrics["documents"],
                "sheets": len(book.sheet_names), "totals": totals}
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
