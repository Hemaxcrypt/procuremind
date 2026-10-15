// Deterministic generator for 12 months of simulated procurement history.
// Same seed in, same history out, so demos and tests are repeatable.

import { ITEMS, SUPPLIERS, CATEGORIES } from './profiles.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(isoDate, months) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

const DISPUTE_REASONS = [
  'Invoice billed a higher rate than the agreed quote',
  'Unagreed surcharge added to the final invoice',
  'Quantity on invoice did not match quantity received',
  'Payment terms on invoice differed from the quote'
];

const QUALITY_REASONS = {
  packaging: ['Boxes crushed or weak at the seams', 'Print misaligned on cartons', 'Material thinner than specified'],
  electronics: ['Units failed incoming inspection', 'Batteries below rated capacity', 'Boards with soldering faults']
};

export function generateHistory({ seed = 12, start = '2025-10-01', months = 12, asOf = '2026-10-10' } = {}) {
  const rand = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (lo, hi) => lo + rand() * (hi - lo);

  const quotes = [];
  const orders = [];
  const events = [];
  let q = 0, o = 0, e = 0;
  const nextId = (prefix, n) => `${prefix}-${String(n).padStart(4, '0')}`;

  for (let m = 0; m < months; m++) {
    for (const category of CATEGORIES) {
      const catItems = ITEMS.filter((i) => i.category === category);
      const item = catItems[m % catItems.length];
      const rfqDate = addDays(addMonths(start, m), Math.floor(between(1, 20)));
      const quantity = Math.round(item.typicalQty * between(0.8, 1.2));
      const inflation = 1 + 0.004 * m; // slow upward price drift

      const bidders = SUPPLIERS.filter((s) => s.category === category && !s.noHistory);
      const roundQuotes = bidders.map((s) => {
        const quote = {
          id: nextId('q', ++q),
          supplierId: s.id,
          itemId: item.id,
          item: item.name,
          unit: item.unit,
          quantity,
          unitPrice: round2(item.basePrice * s.priceFactor * inflation * between(0.96, 1.04)),
          currency: 'USD',
          leadTimeDays: Math.max(3, s.leadTimeDays + Math.round(between(-3, 3))),
          paymentTerms: s.paymentTerms,
          receivedAt: rfqDate,
          source: 'history'
        };
        quotes.push(quote);
        return quote;
      });

      // The past buyer mostly chose the cheapest bid, which is why the
      // history contains the problems a smarter agent should learn from.
      const cheapest = roundQuotes.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a));
      const chosenByPrice = rand() < 0.5;
      const winner = chosenByPrice ? cheapest : pick(roundQuotes);
      const supplier = SUPPLIERS.find((s) => s.id === winner.supplierId);

      const awardedAt = addDays(rfqDate, 3);
      const expectedDelivery = addDays(awardedAt, winner.leadTimeDays);
      const order = {
        id: nextId('o', ++o),
        quoteId: winner.id,
        supplierId: winner.supplierId,
        itemId: item.id,
        item: item.name,
        quantity,
        unitPrice: winner.unitPrice,
        currency: 'USD',
        awardedAt,
        expectedDelivery,
        rationale: chosenByPrice ? 'Lowest unit price' : 'Spread business across suppliers',
        status: 'open'
      };
      orders.push(order);

      if (expectedDelivery > asOf) continue; // not due yet, stays open

      const late = rand() < supplier.lateProb;
      const daysLate = late ? Math.max(1, Math.round(supplier.avgDaysLate * between(0.5, 1.5))) : 0;
      const deliveredAt = addDays(expectedDelivery, daysLate);
      if (deliveredAt > asOf) continue;
      order.status = 'delivered';

      events.push({
        id: nextId('e', ++e), supplierId: supplier.id, orderId: order.id, type: 'delivery', date: deliveredAt, daysLate,
        description: daysLate ? `Delivered ${daysLate} days late` : 'Delivered on time'
      });

      if (QUALITY_REASONS[category] && rand() < supplier.defectProb) {
        const defectRate = round2(between(...supplier.defectRange) * 100) / 100;
        events.push({
          id: nextId('e', ++e), supplierId: supplier.id, orderId: order.id, type: 'quality_issue', date: addDays(deliveredAt, 2), defectRate,
          description: `${pick(QUALITY_REASONS[category])} (${(defectRate * 100).toFixed(1)}% of units rejected)`
        });
      }

      if (rand() < supplier.disputeProb) {
        const amount = round2(order.unitPrice * order.quantity * between(0.03, 0.09));
        events.push({
          id: nextId('e', ++e), supplierId: supplier.id, orderId: order.id, type: 'dispute', date: addDays(deliveredAt, 7), amount,
          description: `${pick(DISPUTE_REASONS)} (USD ${amount.toFixed(2)} in question)`
        });
      }
    }
  }

  // The persona is deliberately left out: the agent must learn each supplier's
  // behaviour from its history, not be told the answer.
  const suppliers = SUPPLIERS.map(({ id, name, category, country }) => ({ id, name, category, country }));
  return {
    meta: { simulated: true, seed, start, months, asOf, generatedBy: 'ProcureMind simulated data generator' },
    suppliers,
    items: ITEMS,
    quotes,
    orders,
    events,
    decisions: []
  };
}
