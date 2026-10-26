'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ScanFidelityAnalyzer = require('../scan_fidelity_analyzer');
const { folderIdentity, namesCompatible, evaluateRecordAssociation, applyRecordAssociation } =
  require('../record_association');

const PDF = path.join('/synthetic', 'scanned', 'REG 654321 - Alex Example', 'visit', 'sample.pdf');
const root = path.join('/synthetic', 'scanned');
const reg = (page, value, confidence = 'high', evidence = 'beside Hospital Number label') =>
  ({ pageNumber: page, kind: 'registration', value, confidence, evidence });
const name = (page, value, confidence = 'high', evidence = 'Patient Name label') =>
  ({ pageNumber: page, kind: 'name', value, confidence, evidence });

test('patient registration is sourced only from a folder segment, never date-heavy PDF filenames', () => {
  assert.deepEqual(folderIdentity(PDF, root), {
    registration: '654321', name: 'Alex Example', source: 'patient-folder'
  });
  assert.equal(folderIdentity(path.join(root, 'visit', '14 NOVEMBER 2018 - 05 JULY 2010 654321.pdf'), root), null);
  assert.equal(folderIdentity(path.join(root, 'unlabeled', 'sample.pdf'), root), null);
  assert.equal(folderIdentity(path.join(root, '654321', 'page.pdf'), root)?.registration, '654321');
});

test('a patient folder remains authoritative across deeper dated visit and subfolders', () => {
  const nested = path.join(root, '654321', '201811', 'visit 4', 'test.pdf');
  assert.equal(folderIdentity(nested, root)?.registration, '654321');
  const labeled = path.join(root, 'Scans', 'REG 654321', '202306', 'visit', 'test.pdf');
  assert.equal(folderIdentity(labeled, root)?.registration, '654321');
  const periodOnly = path.join(root, '201811', 'visit', 'test.pdf');
  assert.equal(folderIdentity(periodOnly, root), null);
});

test('hospital NAME_REGISTRATION folders are authoritative, without examining PDF filenames', () => {
  const named = path.join(root, 'FICTIONAL_EXAMPLE_123456', '201811', 'visit.pdf');
  assert.deepEqual(folderIdentity(named, root), {
    registration: '123456', name: 'FICTIONAL EXAMPLE', source: 'patient-folder'
  });
  const namedDeep = path.join(root, 'SYNTHETIC_PATIENT_234567', 'Visits', '202002', 'scan.pdf');
  assert.equal(folderIdentity(namedDeep, root).registration, '234567');
  const mixed = path.join(root, 'DEMO-PERSON_34567', 'document.pdf');
  assert.equal(folderIdentity(mixed, root).registration, '34567');
  assert.equal(folderIdentity(path.join(root, 'miscellaneous', 'FICTIONAL_EXAMPLE_123456.pdf'), root), null);
  assert.equal(namesCompatible('Example Fictional', 'FICTIONAL EXAMPLE'), true);
  assert.equal(namesCompatible('EXAMPLE FICTIOMAL', 'FICTIONAL_EXAMPLE'.replace('_', ' ')), true);
  const mismatched = evaluateRecordAssociation(named, root, [
    name(1, 'Other Patient'), name(4, 'Other Patient'), reg(1, '123456')
  ]);
  assert.equal(mismatched.status, 'needs-review');
  assert.equal(mismatched.flags[0].code, 'PATIENT_NAME_DISCREPANCY');
});

test('whole-PDF corroborated folder-registration mismatch requires distinct repeated labeled pages', () => {
  const result = evaluateRecordAssociation(PDF, root, [
    reg(1, '654321'), reg(3, '654321'),
    reg(6, '345678'), reg(9, '345678'), name(1, 'Alex Example')
  ]);
  assert.equal(result.status, 'needs-review');
  assert.deepEqual(result.matchedRegistrationPages, [1, 3]);
  assert.deepEqual(result.flags.map(f => f.code), ['REGISTRATION_DISCREPANCY']);
  assert.deepEqual(result.flags[0].pages, [6, 9]);
  assert.equal(result.flags[0].observedRegistration, '345678');
});

test('single-page record with a materially different, clearly labeled registration warrants human identity review', () => {
  const strong = evaluateRecordAssociation(PDF, root,
    [reg(1, '345678')], { totalPages: 1 });
  assert.equal(strong.status, 'needs-review');
  assert.deepEqual(strong.flags[0].pages, [1]);
  assert.equal(strong.flags[0].confidence, 'high');

  const minor = evaluateRecordAssociation(PDF, root,
    [reg(1, '654322')], { totalPages: 1 });
  assert.notEqual(minor.status, 'needs-review');
  const unlabeled = evaluateRecordAssociation(PDF, root,
    [reg(1, '345678', 'high', 'Date of Admission')], { totalPages: 1 });
  assert.notEqual(unlabeled.status, 'needs-review');
});

test('one-digit registration OCR errors and isolated discrepancies do not trigger identity queue', () => {
  const result = evaluateRecordAssociation(PDF, root, [
    reg(1, '654321'), reg(2, '654321'),
    reg(3, '654322'), reg(4, '654322'), reg(5, '654322'),
    reg(6, '345678')
  ]);
  assert.equal(result.status, 'matched');
  assert.equal(result.flags.length, 0);
  assert.ok(result.observations.some(f => f.code === 'REGISTRATION_DISCREPANCY' &&
    f.reason.includes('single-character')));
  assert.ok(result.observations.some(f => f.code === 'REGISTRATION_DISCREPANCY' &&
    f.pages.length === 1));
});

test('dates, doctor identifiers, unlabeled numbers, low confidence and incorrect lengths cannot create alerts', () => {
  const result = evaluateRecordAssociation(PDF, root, [
    reg(1, '345678', 'high', 'Date of Admission'),
    reg(2, '345678', 'high', 'Dr Provider ID'),
    reg(3, '345678', 'medium', 'Hospital Number label'),
    reg(4, '345678', 'high', 'phone number'),
    reg(5, '20181114', 'high', 'Hospital Number label'),
    name(6, 'Dr Monica Ward', 'high', 'Doctor signature'),
    name(7, 'Nurse C', 'high', 'staff listing')
  ]);
  assert.equal(result.status, 'unconfirmed');
  assert.equal(result.flags.length, 0);
  assert.equal(result.evaluatedPages, 0);
});

test('OCR variants of a real name match despite small transcription changes', () => {
  assert.ok(namesCompatible('Alex Example', 'Alix Example'));
  assert.ok(namesCompatible('Alex A. Example', 'Alex Example'));
  assert.ok(namesCompatible('Alex Example', 'Alexx Example'));
  assert.equal(namesCompatible('Alex Example', 'Taylor Fiction'), false);
  const result = evaluateRecordAssociation(PDF, root,
    [name(1, 'Alex Example'), name(3, 'Alix Example'), name(5, 'Alexx Example')]);
  assert.equal(result.flags.length, 0);
});

test('folder name mismatch needs repeated confident patient-labeled names, not a stray clinician', () => {
  const result = evaluateRecordAssociation(PDF, root,
    [name(1, 'Alex Example'), name(4, 'Alex Example'),
      name(6, 'Taylor Fiction'), name(9, 'Taylor Fiction'),
      name(8, 'Dr Clinician', 'high', 'clinician Name')]);
  assert.equal(result.status, 'needs-review');
  assert.deepEqual(result.flags.map(f => f.code), ['PATIENT_NAME_DISCREPANCY']);
  assert.deepEqual(result.flags[0].pages, [6, 9]);
});

test('repeated incompatible patient names in distinct sections are flagged even when folder only has registration', () => {
  const source = path.join(root, '654321', 'record.pdf');
  const association = evaluateRecordAssociation(source, root, [
    name(1, 'Alex Example'), name(2, 'Alix Example'),
    name(6, 'Taylor Fiction'), name(9, 'Taylor Fiction'),
    name(10, 'Doctor Morgan', 'high', 'Doctor name')]);
  assert.equal(association.status, 'needs-review');
  assert.deepEqual(association.flags.map(f => f.code), ['CONFLICTING_PATIENT_NAMES']);
  assert.deepEqual(association.flags[0].pages, [1, 2, 6, 9]);
});

test('multiple names without recurrent labeled evidence stay informational, with no scan QA status change', () => {
  const result = { analysis: { qaAssessment: { status: 'passed', findings: [] },
    identifierMentions: [reg(1, '654321'), name(1, 'Alex Example'), name(5, 'Taylor Fiction')] } };
  applyRecordAssociation(result, PDF, root);
  assert.equal(result.analysis.qaAssessment.status, 'passed');
  assert.notEqual(result.analysis.recordAssociation.status, 'needs-review');
});

test('folder check never silently classifies an unrecognized folder as an identity match', () => {
  const result = evaluateRecordAssociation(path.join(root, 'Documents', 'sample.pdf'), root,
    [reg(1, '654321'), reg(2, '345678')]);
  assert.equal(result.status, 'not-configured');
  assert.equal(result.expectedRegistration, null);
});


test('whole-page extraction retains labeled mentions through the shared local/cloud analyzer aggregation', () => {
  const analyzer = new ScanFidelityAnalyzer();
  const pages = [1, 2, 3].map(pageNumber => ({
    pageNumber, success: true,
    patientIdentifiers: { names: ['Alex Example'], hospitalNumbers: [pageNumber === 1 ? '654321' : '345678'] },
    identifierCandidates: {
      names: [{ value: 'Alex Example', confidence: 'high', evidence: 'Patient Name label' }],
      hospitalNumbers: [{
        value: pageNumber === 1 ? '654321' : '345678',
        confidence: 'high', formatValid: true, evidence: 'Hospital Number label'
      }]
    },
    dates: [], uncertainFindings: []
  }));
  const combined = analyzer.combinePageAnalyses(pages, 3);
  assert.equal(combined.identifierMentions.length, 6);
  const result = { analysis: {
    qaAssessment: { status: 'passed', findings: [] },
    identifierMentions: combined.identifierMentions
  } };
  applyRecordAssociation(result, PDF, root);
  assert.equal(result.analysis.qaAssessment.status, 'passed');
  assert.equal(result.analysis.recordAssociation.status, 'needs-review');
  assert.deepEqual(result.analysis.recordAssociation.flags[0].pages, [2, 3]);
});
