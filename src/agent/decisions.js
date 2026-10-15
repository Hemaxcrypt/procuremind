// Step 5 of the agent: write what happened back to memory. Quotes, the buyer's
// decision, and later the delivery outcome all become history, which is what
// makes the next recommendation smarter.

import { addDays } from '../data/generate.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * Saves the buyer's decision for a comparison returned by recommend().
 * @param {object} args
 * @param {import('../memory/store.js').MemoryStore} args.store
 * @param {object} args.result output of recommend() or buildComparison()
 * @param {string} [args.chosenName] supplier the buyer picked; defaults to the recommendation
 * @param {string} args.decidedAt YYYY-MM-DD
 * @param {string} [args.note] buyer's reason, especially when overriding
 */
export function recordDecision({ store, result, chosenName, decidedAt, note = null }) {
  if (!DATE.test(decidedAt || '')) throw new Error('decidedAt must be a YYYY-MM-DD date');
  const ranked = result.ranked;
  const recommended = ranked[0];
  const chosen = chosenName
    ? ranked.find((o) => o.name.toLowerCase() === chosenName.toLowerCase() || o.name.toLowerCase().startsWith(chosenName.toLowerCase()))
    : recommended;
  if (!chosen) throw new Error(`"${chosenName}" is not one of the quoted suppliers: ${ranked.map((o) => o.name).join(', ')}`);

  // A new item becomes part of the catalog, so its price history starts building.
  if (result.item.isNew && !store.data.items.some((i) => i.id === result.item.id)) {
    const { id, name, unit, category } = result.item;
    store.data.items.push({ id, name, unit, category });
  }

  // Every quote in the comparison is remembered, not just the winner, so price
  // history builds up for all suppliers.
  const savedQuotes = ranked.map((o) => {
    let supplierId = o.supplierId;
    if (!supplierId) {
      const existing = store.findSupplierByName(o.name);
      supplierId = existing ? existing.id : store.addSupplier({ name: o.name, category: result.item.category }).id;
      o.supplierId = supplierId;
    }
    return store.addQuote({
      supplierId,
      itemId: result.item.id,
      item: result.item.name,
      unit: result.item.unit,
      quantity: o.quantity,
      unitPrice: o.unitPrice,
      currency: o.currency,
      ...(o.fx ? { originalUnitPrice: o.fx.originalUnitPrice, originalCurrency: o.fx.originalCurrency, fxRate: o.fx.rate } : {}),
      leadTimeDays: o.leadTimeDays,
      paymentTerms: o.paymentTerms,
      validUntil: o.validUntil,
      receivedAt: decidedAt,
      source: 'extracted'
    });
  });

  const chosenQuote = savedQuotes[ranked.indexOf(chosen)];
  const order = store.addOrder({
    quoteId: chosenQuote.id,
    supplierId: chosen.supplierId,
    itemId: result.item.id,
    item: result.item.name,
    quantity: chosen.quantity,
    unitPrice: chosen.unitPrice,
    currency: chosen.currency,
    awardedAt: decidedAt,
    expectedDelivery: chosen.leadTimeDays != null ? addDays(decidedAt, chosen.leadTimeDays) : null,
    rationale: note || (chosen === recommended ? 'Followed ProcureMind recommendation' : 'Buyer override')
  });

  const decision = store.addDecision({
    decidedAt,
    itemId: result.item.id,
    supplierIds: ranked.map((o) => o.supplierId),
    recommendedSupplierId: recommended.supplierId,
    chosenSupplierId: chosen.supplierId,
    followedRecommendation: chosen === recommended,
    orderId: order.id,
    weights: result.weights,
    scores: ranked.map((o) => ({ supplierId: o.supplierId, total: o.total, flags: o.flags.map((f) => f.code) })),
    note
  });

  store.save();
  return { order, decision, quotes: savedQuotes };
}

/**
 * Records how an order turned out. This is the feedback that changes future scores.
 * @param {object} args
 * @param {string} args.orderId
 * @param {string} args.deliveredAt YYYY-MM-DD
 * @param {number} [args.defectRate] share of units rejected, 0-1
 * @param {string} [args.qualityNote]
 * @param {{ amount: number, reason: string }} [args.dispute]
 */
export function recordOutcome({ store, orderId, deliveredAt, defectRate, qualityNote, dispute }) {
  const order = store.data.orders.find((o) => o.id === orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);
  if (order.status === 'delivered') throw new Error(`Order ${orderId} is already marked delivered`);
  if (!DATE.test(deliveredAt || '')) throw new Error('deliveredAt must be a YYYY-MM-DD date');
  if (deliveredAt < order.awardedAt) throw new Error('deliveredAt cannot be before the order was awarded');
  if (defectRate != null && !(defectRate >= 0 && defectRate <= 1)) throw new Error('defectRate must be between 0 and 1');
  if (dispute && (!(dispute.amount > 0) || !dispute.reason)) throw new Error('A dispute needs a positive amount and a reason');

  const daysLate = order.expectedDelivery ? Math.max(0, daysBetween(order.expectedDelivery, deliveredAt)) : 0;
  const events = [
    store.addEvent({ supplierId: order.supplierId, orderId, type: 'delivery', date: deliveredAt, daysLate, description: daysLate ? `Delivered ${daysLate} days late` : 'Delivered on time' })
  ];
  if (defectRate) {
    events.push(store.addEvent({
      supplierId: order.supplierId, orderId, type: 'quality_issue', date: deliveredAt, defectRate,
      description: `${qualityNote || 'Quality issue on delivery'} (${(defectRate * 100).toFixed(1)}% of units rejected)`
    }));
  }
  if (dispute) {
    events.push(store.addEvent({
      supplierId: order.supplierId, orderId, type: 'dispute', date: deliveredAt, amount: dispute.amount,
      description: `${dispute.reason} (${order.currency} ${dispute.amount.toFixed(2)} in question)`
    }));
  }
  order.status = 'delivered';
  store.save();
  return { order, events };
}
