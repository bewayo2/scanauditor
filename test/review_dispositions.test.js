'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { saveDisposition, getDisposition } = require('../review_dispositions');

const hash = 'a'.repeat(64);

test('digital-only assessment remains distinct from verified source-paper comparison', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scanauditor-review-'));
  t.after(async () => fs.remove(dir));
  const digital = await saveDisposition(dir, { fileSha256: hash, outcome: 'no-defect-digital' });
  assert.equal(digital.comparisonBasis, 'digital-only');
  assert.deepEqual(await getDisposition(dir, hash), digital);
  const paper = await saveDisposition(dir, { fileSha256: hash, outcome: 'source-issue-confirmed' });
  assert.equal(paper.comparisonBasis, 'paper-compared');
  assert.deepEqual(await getDisposition(dir, hash), paper);
  const stored = await fs.readFile(path.join(dir, 'review-feedback', 'dispositions.jsonl'), 'utf8');
  assert.ok(!stored.includes('Patient Name'));
  assert.equal(stored.trim().split('\n').length, 2);
});

test('invalid outcomes and missing hashes cannot create review records', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scanauditor-review-'));
  t.after(async () => fs.remove(dir));
  await assert.rejects(saveDisposition(dir, { fileSha256: 'not-a-hash', outcome: 'no-defect-digital' }), /Invalid/);
  await assert.rejects(saveDisposition(dir, { fileSha256: hash, outcome: 'drop table' }), /Invalid/);
  assert.equal(await getDisposition(dir, 'not-a-hash'), null);
});
