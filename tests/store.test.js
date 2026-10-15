import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore, normalizeName } from '../src/memory/store.js';
import { generateHistory } from '../src/data/generate.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-')), 'mem.json');

test('normalizeName strips company suffixes and punctuation', () => {
  assert.equal(normalizeName('Kestrel Box Co. Ltd'), 'kestrel box');
  assert.equal(normalizeName('PRIMEFOLD PACKAGING LIMITED'), 'primefold packaging');
});

test('finds suppliers by messy names', () => {
  const s = new MemoryStore(tmpFile(), generateHistory());
  assert.equal(s.findSupplierByName('Kestrel Box Co. Ltd').id, 'sup-kestrel');
  assert.equal(s.findSupplierByName('PRIMEFOLD PACKAGING LIMITED').id, 'sup-primefold');
  assert.equal(s.findSupplierByName('northgate cartons').id, 'sup-northgate');
  assert.equal(s.findSupplierByName('Swiftbarrow').id, 'sup-swiftbarrow');
  assert.equal(s.findSupplierByName('Totally Unknown Ltd'), null);
  assert.equal(s.findSupplierByName(''), null);
});

test('memory survives a save and reload', () => {
  const file = tmpFile();
  const s = MemoryStore.create(file, generateHistory());
  const e = s.addEvent({ supplierId: 'sup-kestrel', type: 'delivery', date: '2026-10-20', daysLate: 14, description: 'Delivered 14 days late' });
  s.save();
  const reloaded = MemoryStore.load(file);
  assert.ok(reloaded.history('sup-kestrel').events.some((x) => x.id === e.id));
  assert.ok(!fs.existsSync(`${file}.tmp`));
});

test('new records get unique sequential ids', () => {
  const s = new MemoryStore(tmpFile(), generateHistory());
  const a = s.addQuote({ supplierId: 'sup-kestrel' });
  const b = s.addQuote({ supplierId: 'sup-kestrel' });
  assert.notEqual(a.id, b.id);
  assert.equal(new Set(s.data.quotes.map((q) => q.id)).size, s.data.quotes.length);
});

test('addSupplier avoids id collisions', () => {
  const s = new MemoryStore(tmpFile(), { suppliers: [] });
  const a = s.addSupplier({ name: 'Acme Crates', category: 'packaging' });
  const b = s.addSupplier({ name: 'Acme Crates', category: 'packaging' });
  assert.notEqual(a.id, b.id);
});

test('loading a missing file gives a helpful error', () => {
  assert.throws(() => MemoryStore.load('/no/such/file.json'), /npm run seed/);
});
