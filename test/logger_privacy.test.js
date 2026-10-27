'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ComprehensiveAnalyzer = require('../comprehensive_analyzer');

test('diagnostic logger excludes names, paths and raw model errors', () => {
  const analyzer = new ComprehensiveAnalyzer();
  const original = console.log;
  let output = '';
  console.log = (...parts) => { output += parts.map(item => JSON.stringify(item)).join(' '); };
  try {
    analyzer.log('analysis_started', {
      fileName: 'PRIVATE_PERSON_654321.pdf',
      path: '/private/PRIVATE_PERSON_654321.pdf',
      message: 'OCR response mentions PRIVATE_PERSON_654321',
      pageNumber: 3,
      pages: [3, 4],
      qaStatus: 'review-required'
    });
  } finally {
    console.log = original;
  }
  assert.ok(output.includes('pageNumber'));
  assert.ok(output.includes('review-required'));
  assert.equal(output.includes('PRIVATE_PERSON'), false);
  assert.equal(output.includes('/private/'), false);
  assert.equal(output.includes('654321'), false);
});
