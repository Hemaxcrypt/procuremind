// Starts the ProcureMind web app: npm start, then open http://localhost:3000
import 'dotenv/config';
import path from 'node:path';
import { createApp } from '../src/server/app.js';
import { MemoryStore } from '../src/memory/store.js';
import { ExtractionCache } from '../src/agent/cache.js';
import { generateHistory } from '../src/data/generate.js';

const file = path.resolve('data', 'procuremind.json');
let store;
try {
  store = MemoryStore.load(file);
} catch {
  store = MemoryStore.create(file, generateHistory()); // first run: seed automatically
}
const cache = new ExtractionCache(path.resolve('data', 'extract-cache.json'));
const port = Number(process.env.PORT) || 3000;

createApp({ store, cache })
  .listen(port, '127.0.0.1', () => {
    console.log(`ProcureMind is running at http://localhost:${port}`);
    if (!process.env.ANTHROPIC_API_KEY) console.log('Note: ANTHROPIC_API_KEY is not set, so new quotes cannot be read. Add it to .env.');
    console.log('Press Ctrl+C to stop.');
  })
  .on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the other server or run: PORT=3001 npm start` : err.message);
    process.exit(1);
  });
