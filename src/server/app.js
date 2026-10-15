// ProcureMind's local web server: a small JSON API over the agent, plus the
// static browser app in /public. Node's built-in http module only, so there is
// nothing extra to install.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractQuote } from '../agent/extract.js';
import { extractAll } from '../agent/cache.js';
import { recommend, ComparisonError } from '../agent/recommend.js';
import { recordDecision, recordOutcome } from '../agent/decisions.js';
import { supplierProfile } from '../agent/profile.js';
import { draftEmails } from '../agent/emails.js';
import { generateHistory } from '../data/generate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const SAMPLES = path.join(ROOT, 'samples');
const MAX_BODY = 1_000_000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * @param {object} opts
 * @param {import('../memory/store.js').MemoryStore} opts.store
 * @param {object} [opts.cache] ExtractionCache
 * @param {object} [opts.client] Anthropic client override (tests)
 * @param {() => string} [opts.now] returns today's date (tests)
 */
export function createApp({ store, cache = null, client, now = today, buyer = {} } = {}) {
  const comparisons = new Map(); // id -> { result, quotes }
  const buyerInfo = { name: buyer.name || process.env.BUYER_NAME || 'The Procurement Team', company: buyer.company || process.env.BUYER_COMPANY || 'ProcureMind Demo Co.' };
  const extract = (raw, o) => extractQuote(raw, { ...o, client });

  const routes = {
    'GET /api/status': () => ({ ok: true, simulated: true, today: now(), hasKey: Boolean(client || process.env.ANTHROPIC_API_KEY), buyer: buyerInfo, items: store.data.items }),
    'GET /api/items': () => store.data.items,

    'GET /api/samples': () =>
      fs.readdirSync(SAMPLES).filter((f) => f.endsWith('.txt')).sort().map((f) => ({ name: f.replace(/^\d+-|\.txt$/g, '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()), file: f, text: fs.readFileSync(path.join(SAMPLES, f), 'utf8') })),

    'POST /api/compare': async (body) => {
      const texts = (body.quotes || []).map((t) => String(t || '').trim()).filter(Boolean);
      if (!texts.length) throw new HttpError(400, 'Add at least one quote');
      if (texts.length > 10) throw new HttpError(400, 'Compare at most 10 quotes at a time');
      const date = now();
      const { quotes, failures } = await extractAll(texts, { readFile: (t) => t, extract, cache, receivedAt: date, fresh: Boolean(body.fresh) });
      if (failures.length && !body.allowPartial) {
        const which = failures.map((f) => `quote ${texts.indexOf(f.file) + 1}: ${f.error}`).join('; ');
        throw new HttpError(502, `Could not read ${failures.length} quote(s) (${which}). Try again; quotes already read are remembered.`);
      }
      if (!quotes.length) throw new HttpError(502, 'No quotes could be read');
      const result = await recommend({ quotes, store, itemId: body.itemId || undefined, weights: body.weights, fxRates: body.fxRates || {}, today: date, client, cache: body.fresh ? null : cache });
      const id = crypto.randomUUID();
      comparisons.set(id, { result, quotes });
      if (comparisons.size > 50) comparisons.delete(comparisons.keys().next().value);
      return { id, extracted: quotes, ...result };
    },

    'POST /api/award': (body) => {
      const c = comparisons.get(body.comparisonId);
      if (!c) throw new HttpError(404, 'That comparison has expired. Run the comparison again.');
      if (c.awarded) throw new HttpError(409, `Already awarded as order ${c.awarded.order.id}`);
      const { order, decision } = recordDecision({ store, result: c.result, chosenName: body.chosenName || undefined, decidedAt: now(), note: body.note || null });
      c.awarded = { order, decision, chosenName: store.getSupplier(order.supplierId).name };
      return { order, decision, supplier: c.awarded.chosenName };
    },

    'POST /api/emails': async (body) => {
      const c = comparisons.get(body.comparisonId);
      if (!c) throw new HttpError(404, 'That comparison has expired. Run the comparison again.');
      const chosenName = body.chosenName || c.awarded?.chosenName || c.result.ranked[0].name;
      return draftEmails({ result: c.result, chosenName, buyer: buyerInfo, client, cache });
    },

    'GET /api/orders': () =>
      store.data.orders
        .filter((o) => o.status === 'open')
        .sort((a, b) => b.awardedAt.localeCompare(a.awardedAt))
        .map((o) => ({ ...o, supplier: store.getSupplier(o.supplierId)?.name })),

    'POST /api/outcome': (body) => {
      const defectRate = body.defectPercent == null || body.defectPercent === '' ? undefined : Number(body.defectPercent) / 100;
      const dispute = body.disputeAmount ? { amount: Number(body.disputeAmount), reason: String(body.disputeReason || '').trim() } : undefined;
      const { order, events } = recordOutcome({ store, orderId: body.orderId, deliveredAt: body.deliveredAt, defectRate, qualityNote: body.qualityNote || undefined, dispute });
      return { order, events, profile: supplierProfile(store, order.supplierId) };
    },

    'GET /api/suppliers': () =>
      store.listSuppliers().map((s) => supplierProfile(store, s.id)).sort((a, b) => String(a.category).localeCompare(String(b.category)) || a.name.localeCompare(b.name)),

    'POST /api/reset': () => {
      store.data = generateHistory();
      store.save();
      comparisons.clear();
      return { ok: true };
    }
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      const supplierMatch = req.method === 'GET' && url.pathname.match(/^\/api\/suppliers\/([\w-]+)$/);
      if (supplierMatch) {
        const id = supplierMatch[1];
        if (!store.getSupplier(id)) throw new HttpError(404, 'Supplier not found');
        const h = store.history(id);
        return send(res, 200, { profile: supplierProfile(store, id), events: h.events.slice().reverse(), orders: h.orders.slice().reverse(), quotes: h.quotes.slice(-12).reverse() });
      }
      const handler = routes[`${req.method} ${url.pathname}`];
      if (handler) {
        const body = req.method === 'POST' ? await readBody(req) : {};
        return send(res, 200, await handler(body));
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Unknown API route');
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      return serveStatic(res, url.pathname);
    } catch (err) {
      // Errors from validation (bad dates, unknown orders, mixed currencies) are the user's to fix: 400.
      const status = err.status || (err instanceof ComparisonError || /must be|not found|already|cannot|not one of|needs a/i.test(err.message) ? 400 : 500);
      if (status === 500) console.error(err);
      send(res, status, { error: err.message, ...(err.needsFx ? { needsFx: err.needsFx } : {}) });
    }
  });
}
