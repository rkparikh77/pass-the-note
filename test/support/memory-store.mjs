import assert from 'node:assert/strict';
export class MemoryStore {
  entries = new Map(); conflicts = 0; writes = [];
  async getWithMetadata(key, options) {
    assert.equal(options.consistency, 'strong'); assert.equal(options.type, 'json');
    const entry = this.entries.get(key); return entry ? structuredClone(entry) : null;
  }
  async setJSON(key, data, options) {
    assert.ok(options.onlyIfNew === true || typeof options.onlyIfMatch === 'string', 'Every write must be conditional');
    // Yield so concurrent requests really hold the same old snapshot.
    await new Promise(resolve => setImmediate(resolve));
    this.writes.push(options);
    const current = this.entries.get(key);
    if ((options.onlyIfNew && current) || (options.onlyIfMatch && current?.etag !== options.onlyIfMatch)) { this.conflicts++; return { modified: false }; }
    const etag = `"${this.writes.length}"`; this.entries.set(key, { data: structuredClone(data), etag, metadata: {} }); return { modified: true, etag };
  }
}
