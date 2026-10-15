// Step 6 of the agent: draft the emails a buyer sends after deciding: an award
// to the chosen supplier and a courteous decline to each of the others.
// Declines must never reveal who won or at what price; that is checked in code,
// not just asked for, because leaking competitor pricing is a real procurement
// mistake. If Claude is unavailable, plain templates are used instead.

import { z } from 'zod';
import { callTool, getClient } from './claude.js';

const emailSchema = z.object({ subject: z.string().min(3).max(150), body: z.string().min(40).max(2500) });
export const emailsSchema = z.object({
  award: emailSchema,
  declines: z.array(emailSchema.extend({ supplier: z.string().min(1) }))
});

const emailJson = { type: 'object', properties: { subject: { type: 'string' }, body: { type: 'string' } }, required: ['subject', 'body'] };
const TOOL = {
  name: 'draft_emails',
  description: 'Draft the award email and one decline email per losing supplier',
  input_schema: {
    type: 'object',
    properties: {
      award: emailJson,
      declines: {
        type: 'array',
        items: { type: 'object', properties: { supplier: { type: 'string' }, ...emailJson.properties }, required: ['supplier', 'subject', 'body'] }
      }
    },
    required: ['award', 'declines']
  }
};

const SYSTEM = `You draft supplier emails for a procurement buyer. Professional, warm, concise. No hype, no emojis.
AWARD email: confirm the award, restating item, quantity, unit price, currency, lead time and payment terms exactly as given.
Ask the supplier to confirm in writing. Include the buyer's requested terms (from "requests") politely, as asks, not demands.
DECLINE emails: one per supplier listed in "declined". Thank them, say they were not selected this time, and invite them to quote again.
A decline must NEVER mention the winning supplier, any other supplier, or any other supplier's price or terms. That information is confidential.
If a term is null (not stated in the quote), do not print it; instead ask the supplier to confirm that term.
Sign every email with the buyer's name and company. Use only the facts given; never invent numbers, dates or names.
Always respond by calling the draft_emails tool.`;

function units(n, unit) {
  if (!unit || n === 1 || unit === 'kg') return `${n.toLocaleString('en-US')} ${unit || 'units'}`;
  return `${n.toLocaleString('en-US')} ${unit}${/(x|s|ch|sh)$/.test(unit) ? 'es' : 's'}`;
}

function money(currency, n) {
  return `${currency} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function emailFacts({ result, chosen, buyer }) {
  const losers = result.ranked.filter((o) => o !== chosen);
  return {
    buyer,
    item: result.item.name,
    awarded: {
      supplier: chosen.name,
      quantity: chosen.quantity,
      unit: result.item.unit,
      unit_price: chosen.unitPrice,
      currency: chosen.currency,
      total: chosen.quantity ? Math.round(chosen.unitPrice * chosen.quantity * 100) / 100 : null,
      lead_time_days: chosen.leadTimeDays,
      payment_terms: chosen.paymentTerms,
      quote_valid_until: chosen.validUntil
    },
    // Negotiation points only apply when the buyer followed the recommendation.
    requests: chosen === result.ranked[0] ? result.explanation?.negotiation_points ?? [] : [],
    declined: losers.map((o) => o.name)
  };
}

/** Code-level guard: a decline must not leak the winner or other bidders. */
export function checkDeclines(emails, { result, chosen }) {
  const losers = result.ranked.filter((o) => o !== chosen).map((o) => o.name);
  const got = emails.declines.map((d) => d.supplier.toLowerCase());
  for (const name of losers) {
    if (!got.some((g) => g.includes(name.split(/\s+/)[0].toLowerCase()))) return `missing a decline email for ${name}`;
  }
  const winnerPrice = String(chosen.unitPrice);
  for (const d of emails.declines) {
    const text = `${d.subject}\n${d.body}`.toLowerCase();
    for (const other of result.ranked) {
      const first = other.name.split(/\s+/)[0].toLowerCase();
      if (d.supplier.toLowerCase().includes(first)) continue;
      if (text.includes(first)) return `the decline to ${d.supplier} mentions another supplier (${other.name}); declines must not`;
    }
    if (text.includes(winnerPrice)) return `the decline to ${d.supplier} mentions the winning price; declines must not`;
  }
  return null;
}

export function templateEmails({ result, chosen, buyer }) {
  const f = emailFacts({ result, chosen, buyer });
  const a = f.awarded;
  const sign = `Kind regards,\n${buyer.name}\n${buyer.company}`;
  const lines = [
    `Item: ${f.item}`,
    a.quantity ? `Quantity: ${units(a.quantity, a.unit)}` : null,
    `Unit price: ${money(a.currency, a.unit_price)}`,
    a.total ? `Total: ${money(a.currency, a.total)}` : null,
    a.lead_time_days != null ? `Lead time: ${a.lead_time_days} days` : null,
    a.payment_terms ? `Payment terms: ${a.payment_terms}` : null
  ].filter(Boolean);
  const missing = [a.payment_terms ? null : 'payment terms', a.lead_time_days != null ? null : 'lead time'].filter(Boolean);
  const confirm = missing.length ? `\n\nYour quotation did not state the ${missing.join(' or ')}. Please confirm ${missing.length > 1 ? 'these' : 'this'} as well.` : '';
  const requests = f.requests.length ? `\n\nBefore we issue the purchase order, we would also like to discuss:\n${f.requests.map((r) => `- ${r}`).join('\n')}` : '';
  return {
    award: {
      subject: `Order award: ${f.item}`,
      body: `Dear ${a.supplier} team,\n\nThank you for your quotation. We are pleased to award you this order on the following terms:\n\n${lines.join('\n')}${confirm}${requests}\n\nPlease confirm these terms in writing so we can issue the purchase order.\n\n${sign}`
    },
    declines: f.declined.map((name) => ({
      supplier: name,
      subject: `Your quotation: ${f.item}`,
      body: `Dear ${name} team,\n\nThank you for taking the time to quote for ${f.item}. After careful review, we have decided not to proceed with your offer on this occasion.\n\nWe appreciate your interest and would welcome your quotation on future requirements.\n\n${sign}`
    }))
  };
}

export async function draftEmails({ result, chosenName, buyer, client, model, cache }) {
  const chosen = chosenName
    ? result.ranked.find((o) => o.name.toLowerCase() === chosenName.toLowerCase())
    : result.ranked[0];
  if (!chosen) throw new Error(`"${chosenName}" is not one of the quoted suppliers`);

  const facts = emailFacts({ result, chosen, buyer });
  const key = JSON.stringify(facts);
  const cached = cache?.get(key, 'emails');
  if (cached) return { emails: cached, source: 'claude (cached)' };

  try {
    const emails = await callTool({
      client: getClient(client),
      model,
      system: SYSTEM,
      prompt: `Draft the emails.\n\n<facts>\n${JSON.stringify(facts, null, 2)}\n</facts>`,
      tool: TOOL,
      schema: emailsSchema,
      check: (e) => checkDeclines(e, { result, chosen }),
      maxTokens: 3000
    });
    cache?.set(key, 'emails', emails);
    return { emails, source: 'claude' };
  } catch (err) {
    return { emails: templateEmails({ result, chosen, buyer }), source: 'template', fallbackReason: err.message };
  }
}
