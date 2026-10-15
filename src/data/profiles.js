// Simulated suppliers and catalog. Every company name here is invented.
// Each supplier has a "personality" that drives its generated history, so the
// history tells a coherent story the agent can learn from.

export const CATEGORIES = ['packaging', 'electronics', 'freight'];

export const ITEMS = [
  { id: 'itm-box-40', category: 'packaging', name: 'Corrugated shipping box 40x30x30cm', unit: 'box', basePrice: 0.85, typicalQty: 5000 },
  { id: 'itm-bubble-50', category: 'packaging', name: 'Bubble wrap roll 50m', unit: 'roll', basePrice: 12.0, typicalQty: 300 },
  { id: 'itm-batt-12v', category: 'electronics', name: 'Lithium battery pack 12V 20Ah', unit: 'pack', basePrice: 48.0, typicalQty: 200 },
  { id: 'itm-pcb-v3', category: 'electronics', name: 'PCB controller board v3', unit: 'board', basePrice: 9.5, typicalQty: 1000 },
  { id: 'itm-fcl-40', category: 'freight', name: '40ft container, Lagos (Apapa) to Rotterdam', unit: 'container', basePrice: 2600, typicalQty: 2 },
  { id: 'itm-air-lhr', category: 'freight', name: 'Air freight per kg, Lagos to London Heathrow', unit: 'kg', basePrice: 4.2, typicalQty: 800 }
];

// priceFactor: multiplier on base price (below 1 = cheap)
// lateProb / avgDaysLate: how often and how badly deliveries slip
// defectProb / defectRange: chance of a quality issue and its defect rate
// disputeProb: chance of an invoice or terms dispute per order
// leadTimeDays: typical quoted lead time
export const SUPPLIERS = [
  { id: 'sup-kestrel', name: 'Kestrel Box Co.', category: 'packaging', country: 'Nigeria', persona: 'Cheapest packaging, but often delivers late',
    priceFactor: 0.86, lateProb: 0.6, avgDaysLate: 12, defectProb: 0.1, defectRange: [0.01, 0.03], disputeProb: 0.05, leadTimeDays: 10, paymentTerms: 'Net 30' },
  { id: 'sup-primefold', name: 'Primefold Packaging', category: 'packaging', country: 'Ghana', persona: 'Premium price, almost always on time',
    priceFactor: 1.14, lateProb: 0.05, avgDaysLate: 2, defectProb: 0.03, defectRange: [0.002, 0.008], disputeProb: 0.0, leadTimeDays: 14, paymentTerms: 'Net 45' },
  { id: 'sup-verdawrap', name: 'Verdawrap', category: 'packaging', country: 'Nigeria', persona: 'Mid-priced, inconsistent quality',
    priceFactor: 0.97, lateProb: 0.2, avgDaysLate: 5, defectProb: 0.45, defectRange: [0.04, 0.12], disputeProb: 0.1, leadTimeDays: 12, paymentTerms: 'Net 30' },
  { id: 'sup-voltrane', name: 'Voltrane Components', category: 'electronics', country: 'China', persona: 'Cheap electronics with recurring defects',
    priceFactor: 0.82, lateProb: 0.25, avgDaysLate: 7, defectProb: 0.55, defectRange: [0.05, 0.15], disputeProb: 0.15, leadTimeDays: 30, paymentTerms: '50% upfront, 50% on shipment' },
  { id: 'sup-shenlo', name: 'Shenlo Electronics', category: 'electronics', country: 'China', persona: 'Mid-priced and reliable, but long lead times',
    priceFactor: 0.98, lateProb: 0.1, avgDaysLate: 4, defectProb: 0.08, defectRange: [0.005, 0.015], disputeProb: 0.02, leadTimeDays: 45, paymentTerms: 'Net 30' },
  { id: 'sup-aldermoor', name: 'Aldermoor Electronic Supply', category: 'electronics', country: 'United Kingdom', persona: 'Expensive but fast and dependable',
    priceFactor: 1.22, lateProb: 0.05, avgDaysLate: 2, defectProb: 0.03, defectRange: [0.002, 0.006], disputeProb: 0.0, leadTimeDays: 10, paymentTerms: 'Net 30' },
  { id: 'sup-swiftbarrow', name: 'Swiftbarrow Logistics', category: 'freight', country: 'Nigeria', persona: 'Lowest freight rates, frequent delays',
    priceFactor: 0.84, lateProb: 0.55, avgDaysLate: 9, defectProb: 0.0, defectRange: [0, 0], disputeProb: 0.1, leadTimeDays: 28, paymentTerms: 'Payment before loading' },
  { id: 'sup-meridale', name: 'Meridale Freight', category: 'freight', country: 'Netherlands', persona: 'Reliable freight forwarder at a fair price',
    priceFactor: 1.05, lateProb: 0.08, avgDaysLate: 3, defectProb: 0.0, defectRange: [0, 0], disputeProb: 0.0, leadTimeDays: 24, paymentTerms: 'Net 15' },
  { id: 'sup-corvane', name: 'Corvane Cargo', category: 'freight', country: 'Nigeria', persona: 'Mid-priced, recurring invoice disputes',
    priceFactor: 0.95, lateProb: 0.2, avgDaysLate: 5, defectProb: 0.0, defectRange: [0, 0], disputeProb: 0.45, leadTimeDays: 26, paymentTerms: 'Net 15' },
  // A brand-new supplier with no history, so the agent must flag unknown risk.
  { id: 'sup-northgate', name: 'Northgate Cartons', category: 'packaging', country: 'Nigeria', persona: 'New supplier, no track record yet',
    priceFactor: 0.9, lateProb: 0, avgDaysLate: 0, defectProb: 0, defectRange: [0, 0], disputeProb: 0, leadTimeDays: 9, paymentTerms: 'Net 30', noHistory: true }
];
