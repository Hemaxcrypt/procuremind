import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateHistory } from '../src/data/generate.js';

const stats = (h, id) => {
  const ev = (t) => h.events.filter((e) => e.supplierId === id && e.type === t);
  const deliveries = ev('delivery');
  return {
    orders: h.orders.filter((o) => o.supplierId === id).length,
    deliveries: deliveries.length,
    late: deliveries.filter((e) => e.daysLate > 0).length,
    quality: ev('quality_issue').length,
    disputes: ev('dispute').length
  };
};

test('generator is deterministic', () => {
  assert.deepEqual(generateHistory(), generateHistory());
});

test('history is marked as simulated', () => {
  assert.equal(generateHistory().meta.simulated, true);
});

test('every record points at a real supplier, quote and order', () => {
  const h = generateHistory();
  const supplierIds = new Set(h.suppliers.map((s) => s.id));
  const quoteIds = new Set(h.quotes.map((q) => q.id));
  const orderIds = new Set(h.orders.map((o) => o.id));
  for (const q of h.quotes) assert.ok(supplierIds.has(q.supplierId));
  for (const o of h.orders) assert.ok(quoteIds.has(o.quoteId));
  for (const e of h.events) assert.ok(orderIds.has(e.orderId));
});

test('nothing is dated after the as-of date', () => {
  const h = generateHistory();
  for (const e of h.events.filter((x) => x.type === 'delivery')) assert.ok(e.date <= h.meta.asOf);
});

test('supplier personas are not leaked into memory', () => {
  for (const s of generateHistory().suppliers) assert.deepEqual(Object.keys(s).sort(), ['category', 'country', 'id', 'name']);
});

test('history tells the intended story for each supplier', () => {
  const h = generateHistory();
  const k = stats(h, 'sup-kestrel');
  assert.ok(k.late / k.deliveries >= 0.5, 'Kestrel should be mostly late');
  assert.equal(stats(h, 'sup-primefold').late, 0, 'Primefold should be on time');
  assert.ok(stats(h, 'sup-verdawrap').quality >= 1, 'Verdawrap should have quality issues');
  assert.ok(stats(h, 'sup-voltrane').quality >= 2, 'Voltrane should have repeated defects');
  const sw = stats(h, 'sup-swiftbarrow');
  assert.ok(sw.late / sw.deliveries >= 0.5, 'Swiftbarrow should be mostly late');
  assert.equal(stats(h, 'sup-meridale').late, 0, 'Meridale should be on time');
  assert.ok(stats(h, 'sup-corvane').disputes >= 1, 'Corvane should have invoice disputes');
  assert.equal(stats(h, 'sup-northgate').orders, 0, 'Northgate should have no history');
});
