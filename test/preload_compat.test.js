'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

function loadPreload(webUtils) {
  let api;
  const electron = {
    webUtils,
    contextBridge: { exposeInMainWorld: (_name, exposed) => { api = exposed; } },
    ipcRenderer: { invoke: async () => null, on: () => {}, removeListener: () => {} }
  };
  vm.runInNewContext(source, {
    require: name => {
      assert.equal(name, 'electron');
      return electron;
    }
  }, { filename: 'preload.js' });
  return api;
}

test('Electron 28 dropped files use legacy File.path', () => {
  const api = loadPreload(undefined);
  assert.equal(api.getPathForFile({ path: 'C:\\Synthetic\\Record.pdf' }),
    'C:\\Synthetic\\Record.pdf');
  assert.throws(() => api.getPathForFile({}), /Browse Files/);
});

test('Electron 29+ dropped files use webUtils instead of File.path', () => {
  const api = loadPreload({ getPathForFile: file => 'resolved:' + file.name });
  assert.equal(api.getPathForFile({ name: 'Record.pdf', path: 'legacy.pdf' }),
    'resolved:Record.pdf');
});
