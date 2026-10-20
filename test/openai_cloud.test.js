'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CloudScanAnalyzer = require('../cloud_analyzer');
const { OpenAIClient, PAGE_SCHEMA, needsSecondPass } = require('../openai_inference');

function extraction(confidence = 'high') {
  return {
    ocrText: 'Emergency Department Record. Page 1 of 4. Patient Name John Smith.',
    patientNames: [{ value: 'John Smith', confidence, evidence: 'Patient Name label' }],
    hospitalNumbers: [],
    dates: [],
    warnings: [],
    quality: {
      blurry: false, dark: false, light: false,
      unreadable: false, cutoff: false, incomplete: false,
      upsideDown: false, sideways: false, misaligned: false
    }
  };
}

test('cloud Responses API request uses strict JSON, store false and meters actual token usage', async () => {
  const metered = [];
  let called = 0;
  const client = new OpenAIClient({
    apiKey: 'sk-test-only-not-real',
    onUsage: x => { metered.push(x); },
    post: async (url, body, opts) => {
      called += 1;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      assert.equal(body.model, 'gpt-6-luna');
      assert.ok(opts.headers.Authorization.startsWith('Bearer '));
      return { data: {
        status: 'completed',
        output: [{ content: [{ type: 'output_text', text: JSON.stringify(extraction()) }] }],
        usage: { input_tokens: 4000, output_tokens: 200 }
      } };
    }
  });
  const answer = await client.request({
    model: 'gpt-6-luna', input: [{ role: 'user', content: 'synthetic fixture' }],
    schema: PAGE_SCHEMA, pageKey: 'hash:1'
  });
  assert.equal(answer.patientNames[0].value, 'John Smith');
  assert.equal(called, 1);
  assert.equal(metered.length, 1);
  assert.equal(metered[0].usage.input_tokens, 4000);
});

test('high-confidence Luna result avoids Sol fallback', async () => {
  const calls = [];
  const cloud = new CloudScanAnalyzer({
    mode: 'tiered',
    client: {
      analyzeImage: async x => { calls.push(x.model); return extraction(); },
      classifyText: async () => ({})
    }
  });
  const text = await cloud.extractTextWithOCR('synthetic.png', 1);
  const result = await cloud.performStructuredPageAnalysis(text, 'fixture.pdf', 1);
  assert.deepEqual(calls, ['gpt-6-luna']);
  assert.deepEqual(result.patientIdentifiers.names, ['John Smith']);
});

test('low confidence result invokes Sol before making deterministic QA decision', async () => {
  const calls = [];
  const cloud = new CloudScanAnalyzer({
    mode: 'tiered',
    client: {
      analyzeImage: async x => {
        calls.push(x.model);
        return extraction(x.model === 'gpt-6-luna' ? 'medium' : 'high');
      }
    }
  });
  const text = await cloud.extractTextWithOCR('synthetic.png', 1);
  const result = await cloud.performStructuredPageAnalysis(text, 'fixture.pdf', 1);
  assert.deepEqual(calls, ['gpt-6-luna', 'gpt-6.1-sol']);
  assert.deepEqual(result.patientIdentifiers.names, ['John Smith']);
  assert.equal(result.uncertainFindings.length, 0);
});

test('Astra benchmark calls Astra alone', async () => {
  const calls = [];
  const cloud = new CloudScanAnalyzer({
    mode: 'astra',
    client: { analyzeImage: async x => { calls.push(x.model); return extraction('medium'); } }
  });
  await cloud.extractTextWithOCR('synthetic.png', 1);
  assert.deepEqual(calls, ['gpt-6-astra']);
});

test('quality concerns and nearly empty OCR can trigger second pass', () => {
  assert.equal(needsSecondPass(extraction()), false);
  const uncertain = extraction();
  uncertain.quality.cutoff = true;
  assert.equal(needsSecondPass(uncertain), true);
  uncertain.quality.cutoff = false;
  uncertain.ocrText = 'Hi';
  assert.equal(needsSecondPass(uncertain), true);
});
