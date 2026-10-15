// Usage: npm run extract -- samples/01-kestrel-email.txt
// Reads a quote file, extracts it with Claude, and shows what memory knows
// about that supplier. Nothing is saved yet; that comes with the decision step.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { extractQuote, matchSupplier } from '../src/agent/extract.js';
import { MemoryStore } from '../src/memory/store.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run extract -- <path to quote file>');
  process.exit(1);
}

try {
  const store = MemoryStore.load(path.resolve('data', 'procuremind.json'));
  const raw = fs.readFileSync(file, 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const quote = await extractQuote(raw, { receivedAt: today });
  console.log('Extracted quote:\n', JSON.stringify(quote, null, 2));

  const { supplier, isNewSupplier } = matchSupplier(quote, store);
  if (isNewSupplier) {
    console.log(`\n"${quote.supplier_name}" is a NEW supplier: no history in memory.`);
  } else {
    const h = store.history(supplier.id);
    const late = h.events.filter((e) => e.type === 'delivery' && e.daysLate > 0).length;
    const deliveries = h.events.filter((e) => e.type === 'delivery').length;
    const issues = h.events.filter((e) => e.type !== 'delivery').length;
    console.log(`\nMatched known supplier ${supplier.name} (${supplier.id})`);
    if (deliveries === 0) console.log('  No delivery history yet: this supplier has no track record.');
    else console.log(`  ${h.quotes.length} past quotes, ${h.orders.length} orders, ${late}/${deliveries} deliveries late, ${issues} quality or invoice issues`);
  }
} catch (err) {
  console.error(`Error: ${err.message}${err.details ? `\n  ${err.details}` : ''}`);
  process.exit(1);
}
