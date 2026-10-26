#!/usr/bin/env python3
"""Private ScanAuditor SQLite workspace.

Long-lived JSON-lines worker for Electron/Node. Uses the Python sqlite3 standard
library already available to ScanAuditor's image converter; no native Electron
Node addon or external database server. NEVER print patient data or paths to
stderr/stdout (except the structured response on the private IPC pipe).
"""
import csv
import datetime
import json
import os
import sqlite3
import sys

OUTCOMES = {
    "no-defect-digital": "digital-only",
    "model-false-positive": "digital-only",
    "source-issue-confirmed": "paper-compared",
    "scan-defect-confirmed": "paper-compared",
    "folder-match-verified": "digital-only",
    "folder-mismatch-confirmed": "digital-only",
    "identity-ocr-false-positive": "digital-only",
    "inconclusive": "undetermined",
}
STATUSES = {"passed", "review-required", "analysis-failed"}
MODES = {"local", "tiered", "astra"}
ACTION_KINDS = {"rescan", "paper-comparison", "investigation"}
ACTION_STATUSES = {"open", "completed", "canceled"}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def valid_string(value, max_len=250):
    return isinstance(value, str) and 0 < len(value) <= max_len and "\x00" not in value


def valid_id(value):
    return type(value) is int and 0 < value < 2**63



# Contextual / provenance observations must not independently drive a
# scan-fidelity remediation queue. Preserve originals in document_runs.
NON_MATERIAL_CONTEXT_CODES = {
    "UNRESOLVED_PAGE", "MULTIPLE_PATIENT_IDENTIFIERS",
    "EXACT_DUPLICATE", "POSSIBLE_DUPLICATE"
}
NON_MATERIAL_MESSAGES = {
    "UNRESOLVED_PAGE": "Uncertain association of unnumbered pages is not proof of a scanning defect.",
    "MULTIPLE_PATIENT_IDENTIFIERS": "Multiple OCR name candidates may reflect other people or text recognition variations; they do not prove a scanning defect.",
    "EXACT_DUPLICATE": "Identical digital pages alone do not establish material scan loss.",
    "POSSIBLE_DUPLICATE": "Similar-looking pages alone do not establish material scan loss."
}

def reclassify_non_material_findings(db):
    """One-way policy reclassification of current case summaries only.

    Preserve immutable document_runs evidence and human review events. The
    evidence export reconstructs an up-to-date envelope from the current
    assessment, while prior evidentiary snapshots remain intact.
    """
    changed = 0
    last_id = 0
    while True:
        rows = db.execute("""SELECT id, analysis_json FROM documents
          WHERE id>? AND qa_status='review-required' ORDER BY id LIMIT 200""",
          (last_id,)).fetchall()
        if not rows:
            break
        for row in rows:
            last_id = row["id"]
            try:
                analysis = json.loads(row["analysis_json"])
                qa = analysis.get("qaAssessment") or {}
                findings = qa.get("findings") or []
                if not isinstance(findings, list):
                    continue
                moved = [f for f in findings if isinstance(f, dict) and
                         f.get("code") in NON_MATERIAL_CONTEXT_CODES]
                if not moved:
                    continue
                retained = [f for f in findings if f not in moved]
                old_info = qa.get("informationalFindings") or []
                informational = list(old_info) if isinstance(old_info, list) else []
                for finding in moved:
                    corrected = dict(finding)
                    corrected["message"] = NON_MATERIAL_MESSAGES[corrected["code"]]
                    informational.append(corrected)
                qa["findings"] = retained
                qa["informationalFindings"] = informational
                qa["originalAutomatedStatus"] = qa.get("status")
                qa["policyReclassified"] = True
                qa["status"] = "review-required" if retained else "passed"
                qa["reason"] = ("One or more potential material scanning defects require review."
                    if retained else "No material scan-fidelity defect was detected by automated checks. "
                    "This does not verify source-paper completeness or record identity.")
                def table(findings):
                    result = []
                    for item in findings:
                        if not isinstance(item, dict):
                            continue
                        pages = item.get("pages") or []
                        pages = [p for p in pages if type(p) is int and p > 0]
                        result.append({"issueType": item.get("code", "").replace("_", " "),
                          "count": len(pages) or 1,
                          "pagesAffected": ", ".join(str(p) for p in pages) if pages else "Document",
                          "description": item.get("message", "")})
                    return result
                analysis["summaryTable"] = table(retained)
                analysis["informationalTable"] = table(informational)
                analysis["priorityIssues"] = [f.get("message", "") for f in retained]
                sources = {"PRINTED_PAGE_SEQUENCE_GAP", "POSSIBLE_TRAILING_PAGES",
                    "POSSIBLY_BLANK_PAGE", "UNREADABLE_PAGE", "POSSIBLE_CUTOFF",
                    "POSSIBLE_INCOMPLETE_PAGE", "BLURRY_PAGE", "DARK_PAGE",
                    "LIGHT_PAGE", "ORIENTATION_ISSUE"}
                pages = sorted({p for f in retained if f.get("code") in sources
                    for p in f.get("pages", []) if type(p) is int and p > 0})
                recommendations = analysis.get("recommendations") or {}
                recommendations["manualReview"] = list(dict.fromkeys(
                    f.get("message", "") for f in retained))
                recommendations["informational"] = list(dict.fromkeys(
                    f.get("message", "") for f in informational))
                recommendations["compareWithSource"] = [
                    "Compare flagged page(s) " + ", ".join(str(p) for p in pages) +
                    " with the paper source if available."] if pages else []
                recommendations["rescanning"] = (
                    ["If source comparison confirms a scanning defect, rescan the affected pages."]
                    if any(f.get("code") in {"UNREADABLE_PAGE", "POSSIBLE_CUTOFF",
                      "POSSIBLE_INCOMPLETE_PAGE", "BLURRY_PAGE", "DARK_PAGE",
                      "LIGHT_PAGE", "ORIENTATION_ISSUE"} for f in retained) else [])
                analysis["recommendations"] = recommendations
                with db:
                    db.execute("UPDATE documents SET qa_status=?,analysis_json=? WHERE id=?",
                        (qa["status"],json.dumps(analysis),row["id"]))
                    db.execute("""UPDATE findings SET kind='information'
                      WHERE document_id=? AND code IN (?,?,?,?)""",
                      (row["id"], *sorted(NON_MATERIAL_CONTEXT_CODES)))
                changed += 1
            except (ValueError, TypeError, AttributeError, KeyError):
                # Malformed older records remain unchanged for investigation.
                continue
    return {"reclassified": changed}

def initialize(db):
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.execute("PRAGMA busy_timeout=5000")
    db.execute("PRAGMA foreign_keys=ON")
    version = db.execute("PRAGMA user_version").fetchone()[0]
    if version > 4:
        raise ValueError("Unsupported newer ScanAuditor database version")
    if version == 0:
        db.executescript("""
        BEGIN;
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          source_path TEXT NOT NULL,
          label TEXT NOT NULL,
          mode TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('folder', 'individual')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE documents (
          id INTEGER PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id),
          source_path TEXT NOT NULL,
          display_name TEXT NOT NULL,
          file_key TEXT,
          file_sha256 TEXT,
          page_count INTEGER NOT NULL DEFAULT 0,
          qa_status TEXT NOT NULL CHECK(qa_status IN ('passed','review-required','analysis-failed')),
          analyzed_at TEXT NOT NULL,
          run_id TEXT,
          analysis_json TEXT NOT NULL,
          evidence_json TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          review_outcome TEXT,
          comparison_basis TEXT,
          reviewed_at TEXT,
          reviewer_label TEXT,
          UNIQUE(project_id, source_path)
        );
        CREATE INDEX ix_docs_queue ON documents(project_id, qa_status, reviewed_at, id);
        CREATE INDEX ix_docs_hash ON documents(file_sha256);
        CREATE INDEX ix_docs_project ON documents(project_id, id);
        CREATE TABLE findings (
          id INTEGER PRIMARY KEY,
          document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          code TEXT NOT NULL,
          page_number INTEGER,
          kind TEXT NOT NULL CHECK(kind IN ('review','information'))
        );
        CREATE INDEX ix_findings_doc ON findings(document_id, code);
        CREATE INDEX ix_findings_code ON findings(code, document_id);
        CREATE TABLE document_runs (
          id INTEGER PRIMARY KEY,
          document_id INTEGER NOT NULL REFERENCES documents(id),
          run_id TEXT,
          analyzed_at TEXT NOT NULL,
          status TEXT NOT NULL,
          page_count INTEGER NOT NULL,
          input_sha256 TEXT,
          evidence_json TEXT NOT NULL,
          revision INTEGER NOT NULL
        );
        CREATE INDEX ix_runs_doc ON document_runs(document_id, id);
        CREATE TABLE review_events (
          id INTEGER PRIMARY KEY,
          document_id INTEGER NOT NULL REFERENCES documents(id),
          outcome TEXT NOT NULL,
          comparison_basis TEXT NOT NULL,
          reviewer_label TEXT,
          timestamp TEXT NOT NULL,
          revision INTEGER NOT NULL
        );
        CREATE INDEX ix_reviews_doc ON review_events(document_id, id);
        CREATE TABLE corrective_actions (
          id INTEGER PRIMARY KEY,
          document_id INTEGER NOT NULL REFERENCES documents(id),
          kind TEXT NOT NULL CHECK(kind IN ('rescan', 'paper-comparison', 'investigation')),
          status TEXT NOT NULL CHECK(status IN ('open','completed','canceled')),
          created_at TEXT NOT NULL,
          closed_at TEXT,
          reviewer_label TEXT,
          revision INTEGER NOT NULL
        );
        CREATE INDEX ix_actions_doc ON corrective_actions(document_id, status);
        CREATE TABLE action_events (
          id INTEGER PRIMARY KEY,
          action_id INTEGER NOT NULL REFERENCES corrective_actions(id),
          status TEXT NOT NULL, timestamp TEXT NOT NULL, reviewer_label TEXT
        );
        CREATE INDEX ix_action_events_action ON action_events(action_id,id);
        PRAGMA user_version=1;
        COMMIT;
        """)
    if version < 2:
        reclassify_non_material_findings(db)
        db.execute("PRAGMA user_version=2")
    if version < 3:
        columns = {row[1] for row in db.execute("PRAGMA table_info(documents)")}
        with db:
            if "association_status" not in columns:
                db.execute("ALTER TABLE documents ADD COLUMN association_status TEXT NOT NULL DEFAULT 'not-assessed'")
            db.execute("CREATE INDEX IF NOT EXISTS ix_docs_association ON documents(project_id,association_status,reviewed_at,id)")
            db.execute("PRAGMA user_version=3")
    if version < 4:
        # Older v3 identity alerts appeared in the attention queue but were
        # missing from the unified findings index. Backfill locally without
        # reanalyzing PDFs, touching provider APIs or changing past evidence.
        with db:
            last_id = 0
            while True:
                previous = db.execute("""SELECT id,analysis_json FROM documents
                  WHERE id>? AND association_status='needs-review'
                  ORDER BY id LIMIT 200""", (last_id,)).fetchall()
                if not previous:
                    break
                for record in previous:
                    last_id = record["id"]
                    try:
                        association = json.loads(record["analysis_json"]).get("recordAssociation") or {}
                        for code, page, kind in extract_association_findings(association):
                            db.execute("""INSERT INTO findings(document_id,code,page_number,kind)
                              VALUES (?,?,?,?)""", (record["id"], code, page, kind))
                    except (ValueError, TypeError, AttributeError):
                        continue
            db.execute("PRAGMA user_version=4")
    return True


def row_dict(row):
    return dict(row) if row else None


def project(db, a):
    project_id = a.get("projectId")
    source = a.get("sourcePath")
    mode = a.get("mode", "local")
    kind = a.get("kind", "folder")
    if not valid_string(project_id, 90) or not valid_string(source, 4096) or mode not in MODES or kind not in ("folder", "individual"):
        raise ValueError("Invalid audit project")
    label = a.get("label")
    if not valid_string(label, 120):
        label = "Folder audit" if kind == "folder" else "Individual audits"
    stamp = now()
    with db:
        db.execute("""INSERT INTO projects (id,source_path,label,mode,kind,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,
          source_path=excluded.source_path""",
          (project_id, source, label, mode, kind, stamp, stamp))
    return row_dict(db.execute("SELECT id,label,mode,kind,created_at,updated_at FROM projects WHERE id=?", (project_id,)).fetchone())


def all_projects(db, a):
    return [row_dict(row) for row in db.execute("""
      SELECT p.id,p.label,p.mode,p.kind,p.updated_at,
      (SELECT count(*) FROM documents d WHERE d.project_id=p.id) document_count,
      (SELECT count(*) FROM documents d WHERE d.project_id=p.id AND (d.qa_status IN ('review-required','analysis-failed') OR d.association_status='needs-review') AND (d.review_outcome IS NULL OR d.review_outcome='inconclusive')) awaiting_review
      FROM projects p ORDER BY p.updated_at DESC LIMIT 500""")]


def extract_association_findings(association):
    """Return one unified audit finding per affected page; never store identity values."""
    result = []
    if not isinstance(association, dict) or association.get("status") != "needs-review":
        return result
    for finding in (association.get("flags") or [])[:1000]:
        if not isinstance(finding, dict):
            continue
        code = finding.get("code")
        if (not isinstance(code, str) or not code or len(code) > 72
                or not code.isascii() or not code.replace("_", "").isalnum()
                or not code[0].isalpha()):
            continue
        pages = finding.get("pages")
        pages = pages if isinstance(pages, list) else []
        valid_pages = sorted({p for p in pages if type(p) is int and p > 0})
        result.extend((code, page, "review") for page in (valid_pages[:1000] or [None]))
    return result[:4000]


def extract_findings(analysis):
    qa = analysis.get("qaAssessment") or {}
    result = []
    for source, kind in (("findings", "review"), ("informationalFindings", "information")):
        for finding in (qa.get(source) or [])[:2000]:
            if not isinstance(finding, dict):
                continue
            code = finding.get("code")
            if not isinstance(code, str) or not code or len(code) > 72:
                continue
            pages = finding.get("pages")
            pages = pages if isinstance(pages, list) else []
            valid_pages = sorted({p for p in pages if type(p) is int and p > 0})
            if not valid_pages:
                result.append((code, None, kind))
            else:
                result.extend((code, p, kind) for p in valid_pages[:2000])
    result.extend(extract_association_findings(analysis.get("recordAssociation")))
    return result[:5000]


def save_document(db, a):
    project_id, source = a.get("projectId"), a.get("sourcePath")
    analysis = a.get("analysis")
    if not valid_string(project_id, 90) or not valid_string(source, 4096) or not isinstance(analysis, dict):
        raise ValueError("Invalid document record")
    if not db.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
        raise ValueError("Unknown project")
    file_info = analysis.get("fileInformation") or {}
    qa = analysis.get("qaAssessment") or {}
    status = qa.get("status") if qa.get("status") in STATUSES else "analysis-failed"
    page_count = file_info.get("totalPages")
    if type(page_count) is not int or page_count < 0:
        page_count = 0
    metadata = analysis.get("analysisMetadata") or {}
    file_hash = metadata.get("fileSha256")
    if not isinstance(file_hash, str) or len(file_hash) != 64 or any(c not in "0123456789abcdefABCDEF" for c in file_hash):
        file_hash = None
    evidence = a.get("evidence") or {}
    if not isinstance(evidence, dict):
        raise ValueError("Invalid evidence")
    name = os.path.basename(source)
    association = analysis.get("recordAssociation") or {}
    association_status = association.get("status")
    if association_status not in {"not-configured", "unconfirmed", "uncertain", "matched", "needs-review"}:
        association_status = "not-assessed"
    stamp = now()
    run_id = a.get("runId") if valid_string(a.get("runId"), 100) else None
    file_key = a.get("fileKey") if valid_string(a.get("fileKey"), 128) else None
    with db:
        previous = db.execute("SELECT id,revision,file_sha256,review_outcome FROM documents WHERE project_id=? AND source_path=?",
                              (project_id, source)).fetchone()
        revision = previous["revision"] + 1 if previous else 1
        # Review outcomes are invalidated only when contents are provably changed,
        # or where no hash can establish sameness. Event history is never deleted.
        preserve_review = bool(previous and file_hash and previous["file_sha256"] == file_hash)
        if previous:
            db.execute("""UPDATE documents SET display_name=?,file_key=?,file_sha256=?,page_count=?,
              qa_status=?,association_status=?,analyzed_at=?,run_id=?,analysis_json=?,evidence_json=?,revision=?,
              review_outcome=CASE WHEN ? THEN review_outcome ELSE NULL END,
              comparison_basis=CASE WHEN ? THEN comparison_basis ELSE NULL END,
              reviewed_at=CASE WHEN ? THEN reviewed_at ELSE NULL END,
              reviewer_label=CASE WHEN ? THEN reviewer_label ELSE NULL END
              WHERE id=?""", (name, file_key, file_hash, page_count, status, association_status, stamp, run_id,
                               json.dumps(analysis), json.dumps(evidence), revision,
                               int(preserve_review), int(preserve_review), int(preserve_review),
                               int(preserve_review), previous["id"]))
            document_id = previous["id"]
            db.execute("DELETE FROM findings WHERE document_id=?", (document_id,))
        else:
            cursor = db.execute("""INSERT INTO documents
              (project_id,source_path,display_name,file_key,file_sha256,page_count,qa_status,
               association_status,analyzed_at,run_id,analysis_json,evidence_json,revision)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
              (project_id, source, name, file_key, file_hash, page_count, status,
               association_status,stamp, run_id, json.dumps(analysis), json.dumps(evidence), revision))
            document_id = cursor.lastrowid
        db.executemany("INSERT INTO findings(document_id,code,page_number,kind) VALUES (?,?,?,?)",
                       ((document_id, code, page, kind) for code, page, kind in extract_findings(analysis)))
        db.execute("""INSERT INTO document_runs
          (document_id,run_id,analyzed_at,status,page_count,input_sha256,evidence_json,revision)
          VALUES (?,?,?,?,?,?,?,?)""",
          (document_id,run_id,stamp,status,page_count,file_hash,json.dumps(evidence),revision))
        db.execute("UPDATE projects SET updated_at=? WHERE id=?", (stamp,project_id))
    overall = "review-required" if status != "passed" or association_status == "needs-review" else "passed"
    return {"id":document_id,"projectId":project_id,"qaStatus":status,
            "overallAuditStatus": overall, "associationStatus": association_status,
            "pageCount":page_count,"revision":revision}


def get_document(db, a):
    document_id = a.get("documentId")
    if not valid_id(document_id):
        raise ValueError("Invalid document identifier")
    row = db.execute("SELECT * FROM documents WHERE id=?", (document_id,)).fetchone()
    if not row:
        return None
    item = row_dict(row)
    item["analysis"] = json.loads(item.pop("analysis_json"))
    item["evidence"] = json.loads(item.pop("evidence_json"))
    item["reviews"] = [row_dict(row) for row in db.execute(
        "SELECT outcome,comparison_basis,reviewer_label,timestamp,revision FROM review_events WHERE document_id=? ORDER BY id DESC LIMIT 50",
        (document_id,))]
    item["actions"] = [row_dict(row) for row in db.execute(
        "SELECT id,kind,status,created_at,closed_at,reviewer_label,revision FROM corrective_actions WHERE document_id=? ORDER BY id DESC",
        (document_id,))]
    item["actionHistory"] = [row_dict(row) for row in db.execute("""
        SELECT a.kind,e.status,e.timestamp,e.reviewer_label FROM action_events e
        JOIN corrective_actions a ON a.id=e.action_id
        WHERE a.document_id=? ORDER BY e.id DESC LIMIT 100""", (document_id,))]
    return item


def list_documents(db, a):
    project_id = a.get("projectId")
    if not valid_string(project_id, 90):
        raise ValueError("Choose an audit project")
    status = a.get("status", "all")
    review = a.get("review", "all")
    if status not in {"all", "attention", "association-review", *STATUSES} or review not in ("all","pending","reviewed"):
        raise ValueError("Invalid filter")
    limit = a.get("limit", 50)
    page = a.get("page", 1)
    if type(limit) is not int or not 1 <= limit <= 100 or type(page) is not int or not 1 <= page <= 100000:
        raise ValueError("Invalid pagination")
    search = a.get("search", "")
    if not isinstance(search, str) or len(search) > 160:
        raise ValueError("Invalid search")
    code = a.get("findingCode", "")
    if not isinstance(code, str) or len(code) > 72:
        raise ValueError("Invalid finding code")
    query = "FROM documents d WHERE d.project_id=?"
    params = [project_id]
    if status == "attention":
        query += " AND (d.qa_status IN ('analysis-failed','review-required') OR d.association_status='needs-review')"
    elif status == "association-review":
        query += " AND d.association_status='needs-review'"
    elif status != "all":
        query += " AND d.qa_status=?"
        params.append(status)
    if review == "pending":
        query += " AND (d.review_outcome IS NULL OR d.review_outcome='inconclusive')"
    elif review == "reviewed":
        query += " AND d.review_outcome IS NOT NULL AND d.review_outcome!='inconclusive'"
    if search.strip():
        # Escaped LIKE literal; this local-only search may contain a patient name.
        query += " AND d.display_name LIKE ? ESCAPE '\\'"
        sanitized = search.strip().replace("\\","\\\\").replace("%","\\%").replace("_","\\_")
        params.append("%" + sanitized + "%")
    if code.strip():
        query += " AND EXISTS (SELECT 1 FROM findings f WHERE f.document_id=d.id AND f.code=?)"
        params.append(code.strip().upper())
    total = db.execute("SELECT count(*) " + query, params).fetchone()[0]
    rows = db.execute("""SELECT d.id,d.project_id,d.display_name,d.page_count,d.qa_status,
      CASE WHEN d.qa_status!='passed' OR d.association_status='needs-review'
        THEN 'review-required' ELSE 'passed' END overall_audit_status,
      d.analyzed_at,d.revision,d.association_status,d.review_outcome,d.comparison_basis,d.reviewed_at,
      (SELECT group_concat(DISTINCT f.code) FROM findings f
         WHERE f.document_id=d.id AND f.kind='review') finding_codes,
      (SELECT count(*) FROM corrective_actions a WHERE a.document_id=d.id AND a.status='open') open_actions
      """ + query + " ORDER BY CASE WHEN d.qa_status='analysis-failed' THEN 0 WHEN d.qa_status='review-required' THEN 1 WHEN d.association_status='needs-review' THEN 2 ELSE 3 END, d.id DESC LIMIT ? OFFSET ?",
      [*params, limit, (page-1)*limit])
    return {"total":total,"page":page,"limit":limit,"rows":[row_dict(row) for row in rows]}


def list_finding_types(db, a):
    project_id = a.get("projectId")
    if not valid_string(project_id, 90):
        raise ValueError("Choose an audit project")
    # Only observed review findings are shown. All labels are rendered locally
    # from a fixed dictionary, never from clinical text.
    return [row_dict(row) for row in db.execute("""
      SELECT f.code, count(DISTINCT f.document_id) AS documents
      FROM findings f JOIN documents d ON d.id=f.document_id
      WHERE d.project_id=? AND f.kind='review'
      GROUP BY f.code ORDER BY documents DESC, f.code LIMIT 250
      """, (project_id,))]


def summary(db, a):
    pid = a.get("projectId")
    if not valid_string(pid, 90):
        raise ValueError("Choose an audit project")
    return row_dict(db.execute("""SELECT count(*) documents,
      coalesce(sum(page_count),0) pages,
      coalesce(sum(qa_status='passed'),0) passed,
      coalesce(sum(qa_status='review-required'),0) review_required,
      coalesce(sum(qa_status='analysis-failed'),0) analysis_failed,
      coalesce(sum(reviewed_at IS NOT NULL),0) reviewed,
      coalesce(sum(association_status='needs-review'),0) association_review,
      coalesce(sum(qa_status!='passed' OR association_status='needs-review'),0) overall_review_required,
      coalesce(sum((qa_status='review-required' OR qa_status='analysis-failed' OR association_status='needs-review') AND (review_outcome IS NULL OR review_outcome='inconclusive')),0) pending_review
      FROM documents WHERE project_id=?""",(pid,)).fetchone())


def review_document(db, a):
    document_id, outcome = a.get("documentId"), a.get("outcome")
    label = a.get("reviewerLabel", "")
    if not valid_id(document_id) or outcome not in OUTCOMES:
        raise ValueError("Invalid manual review")
    if not isinstance(label, str) or len(label) > 120 or "\x00" in label:
        raise ValueError("Invalid reviewer label")
    row = db.execute("SELECT revision FROM documents WHERE id=?", (document_id,)).fetchone()
    if not row:
        raise ValueError("Document not found")
    stamp = now()
    basis = OUTCOMES[outcome]
    with db:
        db.execute("""INSERT INTO review_events(document_id,outcome,comparison_basis,reviewer_label,timestamp,revision)
          VALUES (?,?,?,?,?,?)""",(document_id,outcome,basis,label.strip(),stamp,row["revision"]))
        db.execute("""UPDATE documents SET review_outcome=?,comparison_basis=?,reviewed_at=?,reviewer_label=?
          WHERE id=?""",(outcome,basis,stamp,label.strip(),document_id))
    return {"documentId":document_id,"outcome":outcome,"comparisonBasis":basis,"timestamp":stamp,
            "reviewerLabel":label.strip()}


def create_action(db, a):
    doc, kind = a.get("documentId"), a.get("kind")
    reviewer = a.get("reviewerLabel", "")
    if not valid_id(doc) or kind not in ACTION_KINDS:
        raise ValueError("Invalid corrective action")
    if not isinstance(reviewer, str) or len(reviewer) > 120 or "\x00" in reviewer:
        raise ValueError("Invalid reviewer label")
    row = db.execute("SELECT revision FROM documents WHERE id=?", (doc,)).fetchone()
    if not row:
        raise ValueError("Document not found")
    stamp = now()
    with db:
        cursor = db.execute("""INSERT INTO corrective_actions
          (document_id,kind,status,created_at,revision,reviewer_label)
          VALUES (?,?,'open',?,?,?)""",(doc,kind,stamp,row["revision"],reviewer.strip()))
        db.execute("INSERT INTO action_events(action_id,status,timestamp,reviewer_label) VALUES (?,'open',?,?)",
                   (cursor.lastrowid,stamp,reviewer.strip()))
    return {"id":cursor.lastrowid,"kind":kind,"status":"open"}


def update_action(db, a):
    action_id, status = a.get("actionId"), a.get("status")
    reviewer = a.get("reviewerLabel", "")
    if not valid_id(action_id) or status not in ACTION_STATUSES:
        raise ValueError("Invalid action update")
    if not isinstance(reviewer, str) or len(reviewer) > 120 or "\x00" in reviewer:
        raise ValueError("Invalid reviewer label")
    stamp = now()
    with db:
        cursor = db.execute("UPDATE corrective_actions SET status=?,closed_at=? WHERE id=?",
             (status,stamp if status != "open" else None,action_id))
        if not cursor.rowcount:
            raise ValueError("Action not found")
        db.execute("INSERT INTO action_events(action_id,status,timestamp,reviewer_label) VALUES (?,?,?,?)",
                   (action_id,status,stamp,reviewer.strip()))
    return {"id":action_id,"status":status}


def safe_csv_cell(value):
    text = str(value if value is not None else "")
    # Spreadsheet formula injection protection on exported, potentially
    # patient-identifying filenames.
    if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r", "\n")):
        return "'" + text
    return text


def export_queue(db, a):
    pid, destination = a.get("projectId"), a.get("destination")
    if not valid_string(pid,90) or not valid_string(destination,4096):
        raise ValueError("Invalid export request")
    if not db.execute("SELECT 1 FROM projects WHERE id=?", (pid,)).fetchone():
        raise ValueError("Unknown audit project")
    count = 0
    # The output path must be chosen by Electron's Save dialog, never directly
    # from renderer-controlled text. Stream rows instead of loading 100k cases.
    with open(destination, "w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Document","Pages","Overall audit result","Scan quality QA",
                         "Document preparation / patient identity","Audit finding codes",
                         "Manual outcome","Review basis","Reviewed at","Open corrective actions"])
        cursor = db.execute("""SELECT d.display_name,d.page_count,
          CASE WHEN d.qa_status!='passed' OR d.association_status='needs-review'
            THEN 'review-required' ELSE 'passed' END,
          d.qa_status,d.association_status,
          (SELECT group_concat(DISTINCT f.code) FROM findings f
           WHERE f.document_id=d.id AND f.kind='review'),
          d.review_outcome,d.comparison_basis,d.reviewed_at,
          (SELECT count(*) FROM corrective_actions ac WHERE ac.document_id=d.id AND ac.status='open')
          FROM documents d WHERE d.project_id=? ORDER BY d.id""", (pid,))
        while True:
            chunk = cursor.fetchmany(500)
            if not chunk:
                break
            for row in chunk:
                writer.writerow([safe_csv_cell(cell) for cell in row])
                count += 1
    return {"rows":count}


def backup_database(db, a):
    destination = a.get("destination")
    if not valid_string(destination,4096):
        raise ValueError("Invalid backup destination")
    # SQLite's backup API obtains a consistent snapshot with WAL mode enabled.
    backup = sqlite3.connect(destination)
    try:
        db.backup(backup)
    finally:
        backup.close()
    return {"saved":True}


HANDLERS = {
    "ping": lambda db,a: {"ready": True, "schema": 4},
    "reclassifyPolicy": lambda db,a: reclassify_non_material_findings(db),
    "upsertProject": project,
    "listProjects": all_projects,
    "saveDocument": save_document,
    "getDocument": get_document,
    "listDocuments": list_documents,
    "listFindingTypes": list_finding_types,
    "summary": summary,
    "reviewDocument": review_document,
    "createAction": create_action,
    "updateAction": update_action,
    "exportQueue": export_queue,
    "backupDatabase": backup_database,
}


def main():
    if len(sys.argv) != 2:
        raise ValueError("Database path is required")
    db_path = os.path.abspath(sys.argv[1])
    if hasattr(os, 'umask'):
        os.umask(0o077)  # Protect SQLite, WAL and SHM files on Unix.
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    db = sqlite3.connect(db_path, timeout=5)
    db.row_factory = sqlite3.Row
    try:
        initialize(db)
        for line in sys.stdin:
            try:
                message = json.loads(line)
                request_id = message.get("id")
                action = message.get("action")
                if not isinstance(request_id, int) or action not in HANDLERS:
                    raise ValueError("Unsupported request")
                result = HANDLERS[action](db,message.get("args") or {})
                response = {"id":request_id,"ok":True,"result":result}
            except Exception as exc:
                # Never echo exception details: messages may include a source
                # path, SQL record or PHI; only report the exception class.
                response = {"id":message.get("id") if isinstance(message,dict) else None,
                            "ok":False,"error":type(exc).__name__}
            sys.stdout.write(json.dumps(response,separators=(",",":"))+"\n")
            sys.stdout.flush()
    finally:
        db.close()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Startup failure gets only a generic status; no source paths/PHI.
        sys.stderr.write("ScanAuditor local SQLite worker failed to initialize\n")
        sys.exit(1)
