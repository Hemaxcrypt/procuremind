// Step 3 of the agent: score each quote on five factors and raise risk flags.
// The ranking is plain, explainable arithmetic, so a buyer (or a judge) can see
// exactly why one supplier beat another. Claude explains the result; it does not
// pick the winner, which keeps the decision repeatable and auditable.

export const DEFAULT_WEIGHTS = { price: 0.3, delivery: 0.3, quality: 0.2, disputes: 0.1, speed: 0.1 };

export const FACTORS = Object.keys(DEFAULT_WEIGHTS);

const clamp = (n) => Math.max(0, Math.min(100, n));
const round1 = (n) => Math.round(n * 10) / 10;

// Pulls a score toward a neutral 50 when there is little evidence, so one lucky
// delivery doesn't look as good as ten reliable ones.
export function shrink(raw, evidence, strength = 1) {
  return 50 + (raw - 50) * (evidence / (evidence + strength));
}

export function normalizeWeights(weights = {}) {
  const merged = { ...DEFAULT_WEIGHTS, ...weights };
  for (const k of FACTORS) {
    if (typeof merged[k] !== 'number' || merged[k] < 0 || Number.isNaN(merged[k])) {
      throw new Error(`Weight for "${k}" must be a number of 0 or more`);
    }
  }
  const total = FACTORS.reduce((s, k) => s + merged[k], 0);
  if (total === 0) throw new Error('At least one weight must be above 0');
  return Object.fromEntries(FACTORS.map((k) => [k, merged[k] / total]));
}

const UPFRONT = /upfront|up-front|in advance|advance payment|prepay|deposit|before (loading|shipment|shipping|delivery)|cash with order/i;

const SUSPICIOUS = /(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|other)\s+(instructions|prompts?|rules)|\b(as an ai|you are an ai|language model|system prompt|ai assistant)\b|(always|must|should)\s+(recommend|choose|select|rank)\s+(us|this supplier|our)/i;

export function riskFlags(option, { today, marketAvg, requestedQty } = {}) {
  const p = option.profile;
  const flags = [];
  const add = (code, message) => flags.push({ code, message });

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (p.deliveries === 0) add('NEW_SUPPLIER', 'No delivery history. Consider a small trial order before a large award.');
  else if (p.confidence === 'low') add('LITTLE_HISTORY', `Only ${plural(p.deliveries, 'past delivery').replace('deliverys', 'deliveries')}, so the track record is thin.`);

  // Problems are flagged however short the record is; the wording says how much evidence there is.
  if (p.deliveries >= 1 && p.onTimeRate < 0.6) {
    add('LATE_HISTORY', p.deliveries >= 3
      ? `On time in only ${Math.round(p.onTimeRate * 100)}% of ${p.deliveries} deliveries, ${p.avgDaysLateWhenLate} days late on average when late.`
      : `Late on ${p.lateDeliveries} of ${plural(p.deliveries, 'delivery').replace('deliverys', 'deliveries')}, up to ${p.worstDaysLate} days late.`);
  }
  if (p.deliveries >= 1 && p.qualityIssues / p.deliveries >= 0.3) {
    add('QUALITY_HISTORY', `${plural(p.qualityIssues, 'quality issue')} in ${plural(p.deliveries, 'delivery').replace('deliverys', 'deliveries')}.`);
  }
  if (p.disputes > 0) add('DISPUTE_HISTORY', `${p.disputes} invoice dispute${p.disputes === 1 ? '' : 's'} totalling USD ${p.disputedAmount.toFixed(2)}.`);
  if (option.paymentTerms && UPFRONT.test(option.paymentTerms)) add('UPFRONT_PAYMENT', `Payment terms require money before delivery: "${option.paymentTerms}".`);
  if (option.leadTimeDays == null) add('NO_LEAD_TIME', 'Quote does not state a lead time.');
  if (option.validUntil && today && option.validUntil < today) add('EXPIRED', `Quote expired on ${option.validUntil}.`);

  if (p.lastItemPrice && option.unitPrice > p.lastItemPrice * 1.08) {
    const pct = Math.round((option.unitPrice / p.lastItemPrice - 1) * 100);
    add('PRICE_UP', `${pct}% above this supplier's last price for this item (${p.lastItemPrice}).`);
  }
  if (requestedQty && option.quantity && option.quantity !== requestedQty) {
    add('QUANTITY_DIFFERS', `Quoted for ${option.quantity.toLocaleString('en-US')}, while most quotes are for ${requestedQty.toLocaleString('en-US')}. Unit prices often change with volume.`);
  }
  if (requestedQty && option.moq && option.moq > requestedQty) {
    add('MOQ_ABOVE_NEED', `Minimum order of ${option.moq.toLocaleString('en-US')} is more than the ${requestedQty.toLocaleString('en-US')} being quoted.`);
  }
  if (option.fx) {
    add('CONVERTED', `Quoted as ${option.fx.originalCurrency} ${option.fx.originalUnitPrice.toLocaleString('en-US')}, converted at 1 ${option.fx.base} = ${option.fx.rate.toLocaleString('en-US')} ${option.fx.originalCurrency}. Check the rate.`);
  }
  if (option.sourceText && SUSPICIOUS.test(option.sourceText)) {
    add('SUSPICIOUS_TEXT', 'This quote contains instructions aimed at an AI. They were ignored and cannot change the ranking, but treat the supplier with care.');
  }
  if (marketAvg && option.unitPrice < marketAvg * 0.85) {
    const pct = Math.round((1 - option.unitPrice / marketAvg) * 100);
    add('BELOW_MARKET', `${pct}% below the average price we've been quoted (${marketAvg}). Confirm the specification matches.`);
  }
  return flags;
}

/**
 * @param {Array<{supplierId, name, unitPrice, leadTimeDays, paymentTerms, validUntil, profile}>} options
 * @returns ranked options, best first, each with per-factor scores and flags
 */
export function scoreOptions(options, { weights, today, marketAvg, requestedQty } = {}) {
  if (!options.length) return [];
  const w = normalizeWeights(weights);
  const minPrice = Math.min(...options.map((o) => o.unitPrice));
  const leads = options.map((o) => o.leadTimeDays).filter((d) => d != null);
  const minLead = leads.length ? Math.min(...leads) : null;

  const scored = options.map((o) => {
    const p = o.profile;
    const n = p.deliveries;
    const onTime = p.onTimeRate ?? 0;
    const lateness = (1 - onTime) * Math.min(40, (p.avgDaysLateWhenLate || 0) * 2);
    const issueRate = n ? p.qualityIssues / n : 0;
    const disputeRate = n ? p.disputes / n : 0;

    const scores = {
      price: clamp((minPrice / o.unitPrice) * 100),
      delivery: n ? shrink(clamp(onTime * 100 - lateness), n) : 50,
      quality: n ? shrink(clamp(100 - issueRate * 70 - (p.avgDefectRate || 0) * 300), n) : 50,
      disputes: n ? shrink(clamp(100 - disputeRate * 150), n) : 50,
      speed: o.leadTimeDays == null || minLead == null ? 50 : clamp((minLead / o.leadTimeDays) * 100)
    };
    const total = FACTORS.reduce((s, k) => s + scores[k] * w[k], 0);
    return {
      ...o,
      scores: Object.fromEntries(FACTORS.map((k) => [k, round1(scores[k])])),
      total: round1(total),
      flags: riskFlags(o, { today, marketAvg, requestedQty })
    };
  });

  // Ties go to the cheaper quote, then alphabetically, so ranking is stable.
  scored.sort((a, b) => b.total - a.total || a.unitPrice - b.unitPrice || a.name.localeCompare(b.name));
  return scored.map((s, i) => ({ rank: i + 1, ...s }));
}
