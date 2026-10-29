'use strict';

// Persistent Python stdlib sqlite3 subprocess. Electron already depends on
// Python for PDF conversion. No native Node addon or npm lockfile change.
// The worker owns the database connection; paths and PHI never enter logs.
const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { getPythonPath } = require('./comprehensive_analyzer').prototype;

function localProjectId(sourcePath, mode, kind = 'folder') {
  return crypto.createHash('sha256')
    .update(kind + '\0' + mode + '\0' + path.resolve(sourcePath)).digest('hex');
}

class AuditStore {
  constructor(userData, options = {}) {
    if (!userData || typeof userData !== 'string') throw new Error('Missing local application data directory');
    this.dbPath = path.join(userData, 'audit-workspace', 'workspace.sqlite3');
    this.python = options.pythonPath || getPythonPath.call({});
    this.child = null;
    this.seq = 0;
    this.pending = new Map();
    this.started = null;
    this.closed = false;
  }

  async start() {
    if (this.started) return this.started;
    this.started = this._start();
    return this.started;
  }
  async _start() {
    await fs.ensureDir(path.dirname(this.dbPath));
    try { await fs.chmod(path.dirname(this.dbPath), 0o700); } catch (_) { /* NTFS ACLs are managed by the OS. */ }
    const child = spawn(this.python, ['-u', path.join(__dirname, 'audit_store.py'), this.dbPath], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']
    });
    this.child = child;
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', line => {
      let packet;
      try { packet = JSON.parse(line); } catch (_) { return; }
      const pending = this.pending.get(packet.id);
      if (!pending) return;
      this.pending.delete(packet.id);
      if (packet.ok) pending.resolve(packet.result);
      else pending.reject(new Error('SQLite audit workspace request failed (' +
        String(packet.error || 'unknown').slice(0, 40) + ')'));
    });
    child.on('error', () => this._failAll('SQLite audit worker could not start'));
    child.on('exit', () => this._failAll('SQLite audit worker stopped'));
    await this._send('ping', {});
    return this;
  }
  _failAll(message) {
    for (const item of this.pending.values()) item.reject(new Error(message));
    this.pending.clear();
  }
  _send(action, args) {
    if (!this.child || this.closed || !this.child.stdin.writable) {
      return Promise.reject(new Error('SQLite workspace is unavailable'));
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ id, action, args }) + '\n', 'utf8', error => {
        if (error) {
          this.pending.delete(id);
          reject(new Error('Could not write to local SQLite workspace'));
        }
      });
    });
  }
  async call(action, args = {}) {
    await this.start();
    return this._send(action, args);
  }
  async upsertProject(sourcePath, mode, kind = 'folder') {
    if (!['local', 'tiered', 'astra'].includes(mode)) throw new Error('Invalid audit mode');
    return this.call('upsertProject', {
      projectId: localProjectId(sourcePath, mode, kind),
      sourcePath: path.resolve(sourcePath),
      label: kind === 'individual' ? 'Individual audits — ' + mode : path.basename(sourcePath) || 'Folder audit',
      mode, kind
    });
  }
  async saveDocument(projectId, sourcePath, result, runId = null, fileKey = null) {
    const { evidenceReport } = require('./evidence_report');
    const analysis = result?.analysis || {};
    return this.call('saveDocument', {
      projectId, sourcePath: path.resolve(sourcePath), analysis,
      evidence: evidenceReport(result), runId, fileKey
    });
  }
  listProjects() { return this.call('listProjects'); }
  listDocuments(args) { return this.call('listDocuments', args); }
  listFindingTypes(projectId) { return this.call('listFindingTypes', { projectId }); }
  summary(projectId) { return this.call('summary', { projectId }); }
  getDocument(documentId) { return this.call('getDocument', { documentId }); }
  reviewDocument(documentId, outcome, reviewerLabel = '') {
    return this.call('reviewDocument', { documentId, outcome, reviewerLabel });
  }
  createAction(documentId, kind, reviewerLabel = '') {
    return this.call('createAction', { documentId, kind, reviewerLabel });
  }
  updateAction(actionId, status, reviewerLabel = '') {
    return this.call('updateAction', { actionId, status, reviewerLabel });
  }
  exportQueue(projectId, destination) { return this.call('exportQueue', { projectId, destination }); }
  exportCompleteExcel(projectId, destination) {
    return this.call('exportCompleteExcel', { projectId, destination });
  }
  backupDatabase(destination) { return this.call('backupDatabase', { destination }); }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.child?.stdin.end();
    this.child?.kill();
    this._failAll('SQLite workspace closed');
  }
}
module.exports = { AuditStore, localProjectId };
