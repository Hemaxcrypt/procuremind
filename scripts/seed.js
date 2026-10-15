// Builds data/procuremind.json from the simulated history generator.
// Running it again resets memory to the same starting point.
import path from 'node:path';
import { generateHistory } from '../src/data/generate.js';
import { MemoryStore } from '../src/memory/store.js';

const file = path.resolve('data', 'procuremind.json');
const store = MemoryStore.create(file, generateHistory());
const d = store.data;
console.log(`Seeded simulated memory at ${file}`);
console.log(`  ${d.suppliers.length} suppliers, ${d.quotes.length} quotes, ${d.orders.length} orders, ${d.events.length} events`);
