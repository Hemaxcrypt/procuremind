// Remembers quotes Claude has already read, keyed by the exact text and the
// date received. Re-running a comparison then needs no API calls for the same
// quotes: faster, cheaper, consistent, and unaffected by network problems.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class ExtractionCache {
  constructor(filePath) {
    this.filePath = filePath;
    this.entries = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
  }

  static key(rawText, receivedAt) {
    return crypto.createHash('sha256').update(`${receivedAt}\n${rawText.trim()}`).digest('hex');
  }

  get(rawText, receivedAt) {
    return this.entries[ExtractionCache.key(rawText, receivedAt)] ?? null;
  }

  set(rawText, receivedAt, value) {
    this.entries[ExtractionCache.key(rawText, receivedAt)] = value;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.entries, null, 2));
    fs.renameSync(tmp, this.filePath);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Reads several quotes one at a time, using the cache and retrying failures.
 * Returns { quotes, failures }; callers decide whether a partial set is acceptable.
 */
export async function extractAll(files, { readFile, extract, cache, receivedAt, fresh = false, attempts = 3, delayMs = 2000, onProgress = () => {} }) {
  const quotes = [];
  const failures = [];
  for (const file of files) {
    const raw = readFile(file);
    const cached = !fresh && cache?.get(raw, receivedAt);
    if (cached) {
      quotes.push({ ...cached, source_text: raw });
      onProgress(file, 'cached');
      continue;
    }
    let lastError;
    for (let i = 1; i <= attempts; i++) {
      try {
        const q = await extract(raw, { receivedAt });
        cache?.set(raw, receivedAt, q);
        quotes.push({ ...q, source_text: raw });
        onProgress(file, 'read');
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        // Bad input or a missing key won't fix itself; only retry network trouble.
        if (!/connection|timeout|timed out|overloaded|ECONN|ETIMEDOUT|fetch failed|socket|5\d\d/i.test(err.message)) break;
        if (i < attempts) {
          onProgress(file, `retrying (${err.message})`);
          await sleep(delayMs * i);
        }
      }
    }
    if (lastError) failures.push({ file, error: lastError.message });
  }
  return { quotes, failures };
}
