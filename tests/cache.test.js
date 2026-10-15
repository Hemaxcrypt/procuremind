import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExtractionCache, extractAll } from '../src/agent/cache.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-')), 'cache.json');
const files = { 'a.txt': 'quote A', 'b.txt': 'quote B' };
const readFile = (f) => files[f];
const base = { readFile, receivedAt: '2026-10-14', delayMs: 0 };

test('cache survives reload and is keyed by text and date', () => {
  const file = tmp();
  new ExtractionCache(file).set('quote A', '2026-10-14', { supplier_name: 'A' });
  const c = new ExtractionCache(file);
  assert.equal(c.get('quote A', '2026-10-14').supplier_name, 'A');
  assert.equal(c.get('quote A', '2026-10-15'), null);
  assert.equal(c.get('quote B', '2026-10-14'), null);
});

test('second run uses the cache and makes no API calls', async () => {
  const cache = new ExtractionCache(tmp());
  let calls = 0;
  const extract = async (raw) => { calls++; return { supplier_name: raw }; };
  await extractAll(['a.txt', 'b.txt'], { ...base, extract, cache });
  const { quotes } = await extractAll(['a.txt', 'b.txt'], { ...base, extract, cache });
  assert.equal(calls, 2);
  assert.deepEqual(quotes.map((q) => q.supplier_name), ['quote A', 'quote B']);
});

test('--fresh bypasses the cache', async () => {
  const cache = new ExtractionCache(tmp());
  let calls = 0;
  const extract = async (raw) => { calls++; return { supplier_name: raw }; };
  await extractAll(['a.txt'], { ...base, extract, cache });
  await extractAll(['a.txt'], { ...base, extract, cache, fresh: true });
  assert.equal(calls, 2);
});

test('retries connection errors, then succeeds', async () => {
  let calls = 0;
  const extract = async (raw) => { if (++calls < 3) throw new Error('Connection error.'); return { supplier_name: raw }; };
  const { quotes, failures } = await extractAll(['a.txt'], { ...base, extract });
  assert.equal(quotes.length, 1);
  assert.equal(failures.length, 0);
  assert.equal(calls, 3);
});

test('reports failures instead of hiding them', async () => {
  const extract = async (raw) => { if (raw === 'quote B') throw new Error('Connection error.'); return { supplier_name: raw }; };
  const { quotes, failures } = await extractAll(['a.txt', 'b.txt'], { ...base, extract });
  assert.equal(quotes.length, 1);
  assert.equal(failures[0].file, 'b.txt');
});

test('does not retry errors that will not fix themselves', async () => {
  let calls = 0;
  const extract = async () => { calls++; throw new Error('ANTHROPIC_API_KEY is not set'); };
  const { failures } = await extractAll(['a.txt'], { ...base, extract });
  assert.equal(calls, 1);
  assert.equal(failures.length, 1);
});
