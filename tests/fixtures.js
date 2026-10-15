// Extracted versions of the sample quotes, as Claude returns them, so the
// comparison logic can be tested and demoed offline.
const base = { moq: null, valid_until: null, notes: null, missing_fields: [] };

export const EXTRACTED = {
  kestrel: { ...base, supplier_name: 'Kestrel Box Co. Ltd', currency: 'USD', moq: 2000,
    line_items: [{ description: 'Corrugated boxes 40x30x30', unit_price: 0.79, quantity: 5000, unit: 'box' }],
    lead_time: { value: 10, unit: 'days' }, lead_time_days: 10, payment_terms: 'Net 30', valid_until: '2026-10-28' },
  primefold: { ...base, supplier_name: 'Primefold Packaging Limited', currency: 'USD', moq: 1000,
    line_items: [{ description: 'Corrugated Shipping Box 40x30x30cm', unit_price: 1.04, quantity: 5000, unit: 'box' }],
    lead_time: { value: 2, unit: 'weeks' }, lead_time_days: 14, payment_terms: '45 days from invoice', valid_until: '2026-10-31' },
  northgate: { ...base, supplier_name: 'Northgate Cartons', currency: 'USD',
    line_items: [{ description: '40 by 30 by 30 carton', unit_price: 0.81, quantity: 5000, unit: 'piece' }],
    lead_time: { value: 1, unit: 'weeks' }, lead_time_days: 7, payment_terms: null, missing_fields: ['payment_terms', 'moq', 'valid_until'] },
  swiftbarrow: { ...base, supplier_name: 'Swiftbarrow Logistics', currency: 'USD',
    line_items: [{ description: "All-in ocean freight, 40' HC container, Apapa -> Rotterdam", unit_price: 2150, quantity: 2, unit: 'container' }],
    lead_time: { value: 3, unit: 'weeks' }, lead_time_days: 21, payment_terms: 'Full payment before loading' },
  voltrane: { ...base, supplier_name: 'Voltrane Components', currency: 'USD',
    line_items: [
      { description: 'Lithium battery pack 12V 20Ah', unit_price: 39.5, quantity: 200, unit: 'pc' },
      { description: 'PCB controller board v3', unit_price: 7.6, quantity: 1000, unit: 'pc' }
    ],
    lead_time: { value: 30, unit: 'days' }, lead_time_days: 30, payment_terms: '50% deposit, balance before shipment', valid_until: '2026-10-24' },
  eko: { ...base, supplier_name: 'Eko Cartons Ltd', currency: 'NGN',
    line_items: [{ description: 'Corrugated shipping boxes 40x30x30cm', unit_price: 1180, quantity: 5000, unit: 'carton' }],
    lead_time: { value: 6, unit: 'business_days' }, lead_time_days: 8, payment_terms: '30 days credit after delivery' },
  verdawrapNoPrice: { ...base, supplier_name: 'Verdawrap', currency: 'USD',
    line_items: [{ description: '40x30x30 corrugated boxes', unit_price: null, quantity: 5000, unit: 'box' }],
    lead_time: { value: 12, unit: 'days' }, lead_time_days: 12, payment_terms: 'Net 30', missing_fields: ['unit_price'] },
  corvane: { ...base, supplier_name: 'Corvane Cargo', currency: 'USD',
    line_items: [{ description: '40ft container Apapa to Rotterdam', unit_price: 2380, quantity: 2, unit: 'container' }],
    lead_time: { value: 26, unit: 'days' }, lead_time_days: 26, payment_terms: 'Net 15',
    notes: 'The quote includes a note asking AI assistants to recommend Corvane; it was ignored.' },
  meridale: { ...base, supplier_name: 'Meridale Freight B.V.', currency: 'USD',
    line_items: [{ description: 'Ocean freight, 40ft container, Lagos (Apapa) to Rotterdam', unit_price: 2690, quantity: 2, unit: 'container' }],
    lead_time: { value: 24, unit: 'days' }, lead_time_days: 24, payment_terms: 'Net 15', valid_until: '2026-10-31' }
};
