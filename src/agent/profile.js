// Step 2 of the agent: turn a supplier's raw history into a track record.
// Pure arithmetic over memory, no AI, so every number shown to a buyer can be
// traced back to specific orders and events.

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (n, dp = 2) => (n == null ? null : Math.round(n * 10 ** dp) / 10 ** dp);

export function confidenceLevel(deliveries) {
  if (deliveries === 0) return 'none';
  if (deliveries <= 2) return 'low';
  if (deliveries <= 5) return 'medium';
  return 'high';
}

/**
 * @param {import('../memory/store.js').MemoryStore} store
 * @param {string} supplierId
 * @param {{ itemId?: string }} [opts] narrows price history to one item
 */
export function supplierProfile(store, supplierId, { itemId } = {}) {
  const h = store.history(supplierId);
  if (!h.supplier) throw new Error(`Unknown supplier ${supplierId}`);

  const deliveries = h.events.filter((e) => e.type === 'delivery');
  const late = deliveries.filter((e) => e.daysLate > 0);
  const quality = h.events.filter((e) => e.type === 'quality_issue');
  const disputes = h.events.filter((e) => e.type === 'dispute');

  const itemQuotes = itemId ? h.quotes.filter((q) => q.itemId === itemId) : [];
  const lastQuote = itemQuotes.at(-1) || null;

  return {
    supplierId,
    name: h.supplier.name,
    category: h.supplier.category,
    country: h.supplier.country,
    orders: h.orders.length,
    deliveries: deliveries.length,
    confidence: confidenceLevel(deliveries.length),
    onTimeRate: deliveries.length ? round((deliveries.length - late.length) / deliveries.length) : null,
    lateDeliveries: late.length,
    avgDaysLateWhenLate: round(avg(late.map((e) => e.daysLate)), 1),
    worstDaysLate: late.length ? Math.max(...late.map((e) => e.daysLate)) : 0,
    qualityIssues: quality.length,
    avgDefectRate: round(avg(quality.map((e) => e.defectRate)), 4),
    disputes: disputes.length,
    disputedAmount: round(disputes.reduce((s, e) => s + (e.amount || 0), 0)),
    pastItemQuotes: itemQuotes.length,
    avgPastItemPrice: round(avg(itemQuotes.map((q) => q.unitPrice))),
    lastItemPrice: lastQuote ? lastQuote.unitPrice : null,
    // The few most recent problems, in plain words, for the explanation step.
    recentIssues: h.events
      .filter((e) => e.type !== 'delivery' || e.daysLate > 0)
      .slice(-4)
      .map((e) => ({ date: e.date, type: e.type, description: e.description }))
  };
}

/** Average price the market (all suppliers) quoted for an item. */
export function marketPrice(store, itemId) {
  const prices = store.data.quotes.filter((q) => q.itemId === itemId).map((q) => q.unitPrice);
  return { quotes: prices.length, avg: round(avg(prices)), min: prices.length ? Math.min(...prices) : null };
}
