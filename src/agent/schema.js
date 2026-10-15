// The shape Claude must return when it reads a quote, plus validation.
// Claude fills a tool call with this JSON Schema; zod then checks the result
// before anything is saved, so a bad extraction can never reach memory.

import { z } from 'zod';

const LEAD_UNITS = ['days', 'business_days', 'weeks', 'months'];

export const lineItemSchema = z.object({
  description: z.string().min(1),
  unit_price: z.number().positive().nullable(), // null = no price given ("price on request")
  quantity: z.number().positive().nullable(),
  unit: z.string().nullable()
});

const realQuoteSchema = z.object({
  is_quote: z.literal(true).optional().default(true),
  supplier_name: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code'),
  line_items: z.array(lineItemSchema).min(1),
  moq: z.number().positive().nullable(),
  lead_time: z.object({ value: z.number().positive(), unit: z.enum(LEAD_UNITS) }).nullable(),
  payment_terms: z.string().nullable(),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  notes: z.string().nullable(),
  missing_fields: z.array(z.string())
});

// Text that isn't a supplier quote at all (a newsletter, a random email).
const notQuoteSchema = z.object({ is_quote: z.literal(false), not_quote_reason: z.string().min(3) }).passthrough();

export const extractedQuoteSchema = z.union([notQuoteSchema, realQuoteSchema]);

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

// JSON Schema given to Claude as the tool's input_schema.
export const quoteToolSchema = {
  type: 'object',
  properties: {
    is_quote: { type: 'boolean', description: 'false if the text is not a supplier quote or price offer at all' },
    not_quote_reason: nullable({ type: 'string', description: 'If is_quote is false, one sentence on what the text is instead' }),
    supplier_name: { type: 'string', description: 'Company name of the supplier sending the quote' },
    currency: { type: 'string', description: '3-letter ISO code such as USD, EUR, NGN. Use USD if prices use "$" with no other hint.' },
    line_items: {
      type: 'array',
      description: 'One entry per product or service priced in the quote',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          unit_price: nullable({ type: 'number', description: 'Price for ONE unit. If only a total is given, divide by quantity. null if no price is given (e.g. "price on request").' }),
          quantity: nullable({ type: 'number' }),
          unit: nullable({ type: 'string', description: 'e.g. box, roll, kg, container' })
        },
        required: ['description', 'unit_price', 'quantity', 'unit']
      }
    },
    moq: nullable({ type: 'number', description: 'Minimum order quantity, if stated' }),
    lead_time: nullable({
      type: 'object',
      properties: { value: { type: 'number' }, unit: { type: 'string', enum: LEAD_UNITS } },
      required: ['value', 'unit']
    }),
    payment_terms: nullable({ type: 'string', description: 'e.g. "Net 30", "50% upfront, 50% on shipment"' }),
    valid_until: nullable({ type: 'string', description: 'Quote expiry as YYYY-MM-DD' }),
    notes: nullable({ type: 'string', description: 'Conditions or caveats worth a buyer knowing, in one or two sentences' }),
    missing_fields: { type: 'array', items: { type: 'string' }, description: 'Names of important fields the quote did not state' }
  },
  required: ['is_quote', 'supplier_name', 'currency', 'line_items', 'moq', 'lead_time', 'payment_terms', 'valid_until', 'notes', 'missing_fields']
};

const DAYS_PER_UNIT = { days: 1, business_days: 1.4, weeks: 7, months: 30 };

export function leadTimeToDays(leadTime) {
  if (!leadTime) return null;
  return Math.round(leadTime.value * DAYS_PER_UNIT[leadTime.unit]);
}
