'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');

function contrast(hex1, hex2) {
  const lum = hex => {
    const rgb = hex.match(/[a-f\d]{2}/gi).map(x => parseInt(x, 16) / 255);
    return rgb.map(n => n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4))
      .reduce((acc, n, i) => acc + n * [0.2126, 0.7152, 0.0722][i], 0);
  };
  const [a, b] = [lum(hex1), lum(hex2)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('pagination text and disabled buttons remain readable on a light background', () => {
  assert.ok(contrast('#24334a', '#f2f5fa') >= 4.5);
  assert.ok(contrast('#5b6677', '#e9edf3') >= 4.5);
  assert.match(css, /\.audit-queue-pagination \{/);
  assert.match(css, /background: #f2f5fa/);
  assert.match(css, /\.audit-queue-pagination #audit-page-label/);
  assert.match(css, /\.audit-queue-pagination \.btn:disabled/);
  assert.match(html, /<nav class="audit-queue-pagination" aria-label="Review queue pages">/);
});

test('large review queues use scrollable bounded pages instead of an unbounded list', () => {
  assert.match(html, /id="audit-queue-scroll" role="region"[^>]*tabindex="0"/);
  assert.match(html, /Scroll within the table to see more rows/);
  assert.match(css, /max-height: 460px; overflow: auto/);
  assert.match(renderer, /const auditQueueState = \{ page: 1, total: 0, limit: 50/);
  assert.match(renderer, /window\.electronAPI\.auditListDocuments\(params\)/);
  assert.match(renderer, /Showing ' \+ queueFormat\(from\)/);
  assert.match(renderer, /changeAuditQueuePage\(auditQueueState\.page \+ 1\)/);
  assert.match(renderer, /byId\('audit-queue-scroll'\)\.scrollTop = 0/);
  assert.match(renderer, /detail\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
});
