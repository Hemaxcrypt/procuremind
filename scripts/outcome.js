// Usage:
//   npm run outcome -- <order id> --delivered 2026-11-02
//   npm run outcome -- o-0037 --delivered 2026-11-02 --defects 0.08 --note "Boxes crushed"
//   npm run outcome -- o-0037 --delivered 2026-11-02 --dispute 120 --reason "Unagreed surcharge"
import path from 'node:path';
import { parseArgs } from 'node:util';
import { recordOutcome } from '../src/agent/decisions.js';
import { supplierProfile } from '../src/agent/profile.js';
import { MemoryStore } from '../src/memory/store.js';

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: { delivered: { type: 'string' }, defects: { type: 'string' }, note: { type: 'string' }, dispute: { type: 'string' }, reason: { type: 'string' } }
});

try {
  const [orderId] = positionals;
  if (!orderId || !o.delivered) throw new Error('Usage: npm run outcome -- <order id> --delivered YYYY-MM-DD [--defects 0.05 --note "..."] [--dispute 120 --reason "..."]');
  const store = MemoryStore.load(path.resolve('data', 'procuremind.json'));
  const { order, events } = recordOutcome({
    store,
    orderId,
    deliveredAt: o.delivered,
    defectRate: o.defects != null ? Number(o.defects) : undefined,
    qualityNote: o.note,
    dispute: o.dispute != null ? { amount: Number(o.dispute), reason: o.reason } : undefined
  });
  const p = supplierProfile(store, order.supplierId);
  console.log(`Logged for ${p.name}:`);
  events.forEach((e) => console.log(`  - ${e.description}`));
  console.log(`Track record now: on time in ${Math.round(p.onTimeRate * 100)}% of ${p.deliveries} deliveries, ${p.qualityIssues} quality issue(s), ${p.disputes} dispute(s).`);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
