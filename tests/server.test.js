// Runs the real web server on a random port with a fake Claude, and drives the
// full flow a user would: compare, award, draft emails, log delivery.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server/app.js';
import { MemoryStore } from '../src/memory/store.js';
import { generateHistory } from '../src/data/generate.js';
import { ExtractionCache } from '../src/agent/cache.js';
import { EXTRACTED as X } from './fixtures.js';
import { checkDeclines, templateEmails } from '../src/agent/emails.js';

const SAMPLE = {
  kestrel: fs.readFileSync('samples/01-kestrel-email.txt', 'utf8'),
  primefold: fs.readFileSync('samples/02-primefold-formal.txt', 'utf8'),
  northgate: fs.readFileSync('samples/03-northgate-chat.txt', 'utf8')
};
const read = (f) => fs.readFileSync(`samples/${f}`, 'utf8');
Object.assign(SAMPLE, { swiftbarrow: read('04-swiftbarrow-freight.txt'), eko: read('06-eko-cartons-naira.txt'), noPrice: read('07-verdawrap-no-price.txt'), corvane: read('08-corvane-freight.txt'), meridale: read('09-meridale-freight.txt') });
const BY_TEXT = new Map([[SAMPLE.kestrel.trim(), X.kestrel], [SAMPLE.primefold.trim(), X.primefold], [SAMPLE.northgate.trim(), X.northgate],
  [SAMPLE.swiftbarrow.trim(), X.swiftbarrow], [SAMPLE.eko.trim(), X.eko], [SAMPLE.noPrice.trim(), X.verdawrapNoPrice], [SAMPLE.corvane.trim(), X.corvane], [SAMPLE.meridale.trim(), X.meridale]]);

// A fake Claude: answers each tool with sensible data, like the real one would.
function fakeClaude({ leakyDeclines = false } = {}) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (req) => {
        const tool = req.tools[0].name;
        calls.push(tool);
        let input;
        if (tool === 'record_quote') {
          const text = req.messages[0].content.match(/<quote>\n([\s\S]*)\n<\/quote>/)[1];
          input = { ...BY_TEXT.get(text.trim()) };
          delete input.lead_time_days;
        } else if (tool === 'write_recommendation') {
          const top = JSON.parse(req.messages[0].content.match(/<facts>\n([\s\S]*)\n<\/facts>/)[1]).options[0].supplier;
          input = { summary: `${top} is the pick: best balance of price and record.`, reasons: ['On time 2 of 2.'], risks: ['Thin record.'], negotiation_points: ['Ask for $1.01.'], next_step: 'Confirm the order.' };
        } else if (tool === 'draft_emails') {
          const facts = JSON.parse(req.messages[0].content.match(/<facts>\n([\s\S]*)\n<\/facts>/)[1]);
          input = {
            award: { subject: `Award: ${facts.item}`, body: `Dear ${facts.awarded.supplier} team, we are pleased to award you ${facts.awarded.quantity} units at ${facts.awarded.unit_price}. Please confirm.` },
            declines: facts.declined.map((s) => ({ supplier: s, subject: 'Your quotation', body: leakyDeclines ? `Dear ${s}, we chose ${facts.awarded.supplier} at ${facts.awarded.unit_price}. Thanks anyway.` : `Dear ${s} team, thank you for quoting. We will not proceed this time but welcome future quotes.` }))
          };
        }
        return { content: [{ type: 'tool_use', id: `t${calls.length}`, name: tool, input }] };
      }
    }
  };
}

let server, base, claude, store;
async function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-'));
  store = MemoryStore.create(path.join(dir, 'mem.json'), generateHistory());
  claude = fakeClaude(opts);
  server = createApp({ store, cache: new ExtractionCache(path.join(dir, 'cache.json')), client: claude, now: () => '2026-10-14', buyer: { name: 'Em', company: 'Test Co' } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}
const post = async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, data: await r.json() }; };

before(() => start());
after(() => server.close());

test('serves the app and the samples', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /ProcureMind/);
  const { data } = await get('/api/samples');
  assert.equal(data.length, 9);
  assert.equal((await fetch(base + '/../package.json')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});

test('full flow: compare, award, emails, log delivery, memory updates', async () => {
  const cmp = await post('/api/compare', { quotes: [SAMPLE.kestrel, SAMPLE.primefold, SAMPLE.northgate] });
  assert.equal(cmp.status, 200);
  assert.equal(cmp.data.ranked[0].name, 'Primefold Packaging');
  assert.equal(cmp.data.explanationSource, 'claude');

  const again = await post('/api/compare', { quotes: [SAMPLE.kestrel, SAMPLE.primefold, SAMPLE.northgate] });
  assert.equal(again.data.explanationSource, 'claude (cached)');
  assert.equal(claude.calls.filter((c) => c === 'record_quote').length, 3, 'quotes are read once');

  const award = await post('/api/award', { comparisonId: cmp.data.id, chosenName: 'Northgate Cartons', note: 'Trial order' });
  assert.equal(award.status, 200);
  assert.equal(award.data.supplier, 'Northgate Cartons');
  assert.equal(award.data.decision.followedRecommendation, false);
  assert.equal((await post('/api/award', { comparisonId: cmp.data.id })).status, 409, 'cannot award twice');

  const mail = await post('/api/emails', { comparisonId: cmp.data.id, chosenName: 'Northgate Cartons' });
  assert.equal(mail.data.source, 'claude');
  assert.equal(mail.data.emails.declines.length, 2);

  const orders = await get('/api/orders');
  assert.ok(orders.data.some((o) => o.id === award.data.order.id));

  const out = await post('/api/outcome', { orderId: award.data.order.id, deliveredAt: '2026-11-05', defectPercent: '9', qualityNote: 'Crushed' });
  assert.equal(out.status, 200);
  assert.equal(out.data.events.length, 2);
  assert.equal(out.data.profile.deliveries, 1);
  assert.ok(!(await get('/api/orders')).data.some((o) => o.id === award.data.order.id), 'delivered orders leave the open list');

  const after = await post('/api/compare', { quotes: [SAMPLE.kestrel, SAMPLE.primefold, SAMPLE.northgate] });
  assert.equal(after.data.ranked.at(-1).name, 'Northgate Cartons', 'the bad delivery is remembered');
});

test('scenario: a quote in naira asks for a rate, then compares in USD', async () => {
  const first = await post('/api/compare', { quotes: [SAMPLE.kestrel, SAMPLE.primefold, SAMPLE.eko] });
  assert.equal(first.status, 400);
  assert.deepEqual(first.data.needsFx, { base: 'USD', currencies: ['NGN'] });
  const second = await post('/api/compare', { quotes: [SAMPLE.kestrel, SAMPLE.primefold, SAMPLE.eko], fxRates: { NGN: 1500 } });
  assert.equal(second.status, 200);
  const eko = second.data.ranked.find((o) => o.name === 'Eko Cartons Ltd');
  assert.equal(eko.currency, 'USD');
  assert.ok(eko.flags.some((f) => f.code === 'CONVERTED'));
});

test('scenario: a supplier gives no price', async () => {
  const r = await post('/api/compare', { quotes: [SAMPLE.kestrel, SAMPLE.primefold, SAMPLE.noPrice] });
  assert.equal(r.status, 200);
  assert.equal(r.data.ranked.length, 2);
  assert.equal(r.data.unpriced[0].supplier, 'Verdawrap');
});

test('scenario: a hidden instruction is flagged and the reliable forwarder still wins', async () => {
  const r = await post('/api/compare', { quotes: [SAMPLE.swiftbarrow, SAMPLE.corvane, SAMPLE.meridale] });
  assert.equal(r.status, 200);
  assert.equal(r.data.ranked[0].name, 'Meridale Freight');
  const corvane = r.data.ranked.find((o) => o.name === 'Corvane Cargo');
  assert.ok(corvane.flags.some((f) => f.code === 'SUSPICIOUS_TEXT'));
  assert.notEqual(r.data.ranked[0].name, 'Corvane Cargo');
});

test('rejects bad input with clear 400s', async () => {
  assert.equal((await post('/api/compare', { quotes: [] })).status, 400);
  assert.equal((await post('/api/award', { comparisonId: 'nope' })).status, 404);
  const bad = await post('/api/outcome', { orderId: 'o-9999', deliveredAt: '2026-10-14' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /not found/);
  assert.equal((await get('/api/suppliers/sup-nope')).status, 404);
  const malformed = await fetch(base + '/api/compare', { method: 'POST', body: '{not json' });
  assert.equal(malformed.status, 400);
});

test('supplier pages list records', async () => {
  const list = await get('/api/suppliers');
  assert.ok(list.data.length >= 10);
  const k = await get('/api/suppliers/sup-kestrel');
  assert.ok(k.data.events.length > 0);
  assert.equal(k.data.profile.name, 'Kestrel Box Co.');
});

test('reset restores the original history', async () => {
  await post('/api/reset', {});
  assert.deepEqual(store.data, generateHistory());
});

test('declines that leak the winner are rejected and replaced by templates', async () => {
  server.close();
  await start({ leakyDeclines: true });
  const cmp = await post('/api/compare', { quotes: [SAMPLE.kestrel, SAMPLE.primefold] });
  const mail = await post('/api/emails', { comparisonId: cmp.data.id });
  assert.equal(mail.data.source, 'template');
  const decline = mail.data.emails.declines[0];
  assert.doesNotMatch(decline.body, /Primefold|1\.04/);
});

test('decline checker and templates', () => {
  const result = { item: { name: 'Box', unit: 'box' }, ranked: [{ name: 'Primefold Packaging', unitPrice: 1.04, quantity: 10, currency: 'USD' }, { name: 'Kestrel Box Co.', unitPrice: 0.79 }], explanation: { negotiation_points: [] } };
  const chosen = result.ranked[0];
  const t = templateEmails({ result, chosen, buyer: { name: 'Em', company: 'Co' } });
  assert.equal(checkDeclines(t, { result, chosen }), null);
  assert.match(checkDeclines({ declines: [] }, { result, chosen }), /missing/);
  assert.match(t.award.body, /USD 1\.04/);
});
