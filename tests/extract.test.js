// Uses a fake Claude client, so these tests run offline and cost nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractQuote, ExtractionError } from '../src/agent/extract.js';
import { leadTimeToDays } from '../src/agent/schema.js';

const good = {
  supplier_name: 'Kestrel Box Co. Ltd',
  currency: 'USD',
  line_items: [{ description: 'Corrugated box 40x30x30', unit_price: 0.79, quantity: 5000, unit: 'box' }],
  moq: 2000,
  lead_time: { value: 10, unit: 'days' },
  payment_terms: 'Net 30',
  valid_until: '2026-10-28',
  notes: null,
  missing_fields: []
};

function fakeClient(...inputs) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (req) => {
        calls.push(structuredClone(req));
        const input = inputs[Math.min(calls.length - 1, inputs.length - 1)];
        return { content: input === null ? [{ type: 'text', text: 'oops' }] : [{ type: 'tool_use', id: `tu_${calls.length}`, name: 'record_quote', input }] };
      }
    }
  };
}

test('returns a validated quote with lead time in days', async () => {
  const client = fakeClient(good);
  const q = await extractQuote('some quote', { receivedAt: '2026-10-14', client });
  assert.equal(q.line_items[0].unit_price, 0.79);
  assert.equal(q.lead_time_days, 10);
  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0].tool_choice, { type: 'auto' });
});

test('retries with the validation error when Claude returns bad data', async () => {
  const bad = { ...good, currency: 'dollars', line_items: [{ ...good.line_items[0], unit_price: -1 }] };
  const client = fakeClient(bad, good);
  const q = await extractQuote('some quote', { receivedAt: '2026-10-14', client });
  assert.equal(q.currency, 'USD');
  assert.equal(client.calls.length, 2);
  const feedback = client.calls[1].messages.at(-1).content[0];
  assert.equal(feedback.type, 'tool_result');
  assert.match(feedback.content, /currency/);
});

test('gives up with a clear error after repeated bad data', async () => {
  const client = fakeClient({ ...good, line_items: [] });
  await assert.rejects(extractQuote('q', { receivedAt: '2026-10-14', client }), ExtractionError);
});

test('nudges Claude when it replies without calling the tool', async () => {
  const client = fakeClient(null, good);
  const q = await extractQuote('q', { receivedAt: '2026-10-14', client });
  assert.equal(q.supplier_name, 'Kestrel Box Co. Ltd');
  assert.match(client.calls[1].messages.at(-1).content, /record_quote/);
});

test('rejects empty input before calling Claude', async () => {
  const client = fakeClient(good);
  await assert.rejects(extractQuote('   ', { receivedAt: '2026-10-14', client }), /empty/);
  assert.equal(client.calls.length, 0);
});

test('explains a missing API key', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(extractQuote('q', { receivedAt: '2026-10-14' }), /ANTHROPIC_API_KEY/);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('lead time conversion', () => {
  assert.equal(leadTimeToDays({ value: 3, unit: 'weeks' }), 21);
  assert.equal(leadTimeToDays({ value: 1, unit: 'months' }), 30);
  assert.equal(leadTimeToDays(null), null);
});

test('rejects text that is not a quote, without retrying', async () => {
  const client = fakeClient({ ...good, is_quote: false, not_quote_reason: 'It is a newsletter about trade fairs.' });
  await assert.rejects(extractQuote('Join our trade fair!', { receivedAt: '2026-10-14', client }), /doesn't look like a supplier quote: It is a newsletter/);
  assert.equal(client.calls.length, 1);
});

test('accepts an item with no price', async () => {
  const client = fakeClient({ ...good, is_quote: true, line_items: [{ description: 'Box', unit_price: null, quantity: 5000, unit: 'box' }] });
  const q = await extractQuote('Price on request', { receivedAt: '2026-10-14', client });
  assert.equal(q.line_items[0].unit_price, null);
});

test('tells Claude that quote text is untrusted', async () => {
  const client = fakeClient(good);
  await extractQuote('some quote', { receivedAt: '2026-10-14', client });
  assert.match(client.calls[0].system, /untrusted/);
});
