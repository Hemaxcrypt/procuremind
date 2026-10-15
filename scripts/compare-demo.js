// Usage:
//   npm run compare -- samples/01-kestrel-email.txt samples/02-primefold-formal.txt samples/03-northgate-chat.txt
// Options:
//   --item <id>        compare a specific item (e.g. itm-box-40); default is the item quoted most
//   --save             save the quotes and the decision to memory
//   --choose <name>    award to a different supplier than recommended (with --save)
//   --note "<text>"    your reason, saved with the decision
//   --rate NGN=1500    exchange rate for a quote in another currency (1 USD = 1500 NGN); repeat for more
//   --fresh            re-read quotes with Claude even if they were read before
//   --allow-partial    compare whatever quotes could be read, even if some failed
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { extractQuote } from '../src/agent/extract.js';
import { recommend } from '../src/agent/recommend.js';
import { recordDecision } from '../src/agent/decisions.js';
import { MemoryStore } from '../src/memory/store.js';
import { ExtractionCache, extractAll } from '../src/agent/cache.js';

const { values: opts, positionals: files } = parseArgs({
  allowPositionals: true,
  options: {
    item: { type: 'string' }, save: { type: 'boolean' }, choose: { type: 'string' }, note: { type: 'string' },
    fresh: { type: 'boolean' }, 'allow-partial': { type: 'boolean' }, rate: { type: 'string', multiple: true }
  }
});

if (!files.length) {
  console.error('Usage: npm run compare -- <quote file> [more quote files] [--save] [--choose <supplier>]');
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const fxRates = {};
for (const r of opts.rate || []) {
  const m = r.match(/^([A-Za-z]{3})=([\d.]+)$/);
  if (!m || !(Number(m[2]) > 0)) {
    console.error(`--rate must look like NGN=1500 (got "${r}")`);
    process.exit(1);
  }
  fxRates[m[1].toUpperCase()] = Number(m[2]);
}
const line = (s = '') => console.log(s);

try {
  const store = MemoryStore.load(path.resolve('data', 'procuremind.json'));

  const cache = new ExtractionCache(path.resolve('data', 'extract-cache.json'));
  console.log(`Reading ${files.length} quote(s)...`);
  const { quotes, failures } = await extractAll(files, {
    readFile: (f) => fs.readFileSync(f, 'utf8'),
    extract: extractQuote,
    cache,
    receivedAt: today,
    fresh: opts.fresh,
    onProgress: (f, status) => console.log(`  ${path.basename(f)}: ${status}`)
  });
  if (failures.length) {
    failures.forEach((f) => console.log(`  Could not read ${f.file}: ${f.error}`));
    if (!opts['allow-partial']) {
      throw new Error(`${failures.length} quote(s) could not be read, so the comparison would be incomplete. Fix the problem above (for a connection error, just run the same command again: quotes already read are remembered), or add --allow-partial to compare the rest.`);
    }
    console.log('  Continuing with the quotes that were read (--allow-partial).');
  }
  if (!quotes.length) throw new Error('No quotes could be read');

  const result = await recommend({ quotes, store, itemId: opts.item, today, fxRates, cache: opts.fresh ? null : cache });
  const cur = result.currency;

  line(`\n${result.item.name}${result.market.avg ? `  (market average from history: ${cur} ${result.market.avg})` : ''}`);
  if (result.fx) line(`Converted to ${result.fx.base} at ${Object.entries(result.fx.rates).map(([c, v]) => `1 ${result.fx.base} = ${v} ${c}`).join(', ')}`);
  for (const n of result.notices) line(`Note: ${n}`);
  for (const u of result.unpriced) line(`Note: ${u.supplier} gave no price for "${u.description}", so it is not compared.`);
  line('-'.repeat(96));
  line(`${'#'.padEnd(3)}${'Supplier'.padEnd(30)}${'Unit price'.padEnd(13)}${'Lead'.padEnd(9)}${'Score'.padEnd(8)}Price Deliv Qual  Disp  Speed`);
  for (const o of result.ranked) {
    const s = o.scores;
    line(`${String(o.rank).padEnd(3)}${o.name.slice(0, 29).padEnd(30)}${`${cur} ${o.unitPrice}`.padEnd(13)}${(o.leadTimeDays != null ? `${o.leadTimeDays}d` : '?').padEnd(9)}${String(o.total).padEnd(8)}${[s.price, s.delivery, s.quality, s.disputes, s.speed].map((x) => String(Math.round(x)).padEnd(6)).join('')}`);
    for (const f of o.flags) line(`     ! ${f.message}`);
  }

  const e = result.explanation;
  line(`\nRECOMMENDATION: ${result.recommended.name}`);
  line(e.summary);
  line('\nWhy:');
  e.reasons.forEach((r) => line(`  - ${r}`));
  if (e.risks.length) { line('\nWatch out for:'); e.risks.forEach((r) => line(`  - ${r}`)); }
  if (e.negotiation_points.length) { line('\nNegotiate:'); e.negotiation_points.forEach((r) => line(`  - ${r}`)); }
  line(`\nNext step: ${e.next_step}`);
  if (result.explanationSource === 'rules') line(`\n(Explanation written by built-in rules because Claude was unavailable: ${result.fallbackReason})`);
  if (result.otherItems.length) line(`\nAlso quoted: ${result.otherItems.map((g) => `${g.name} [--item ${g.id}]`).join('; ')}`);

  if (opts.save) {
    const { order, decision } = recordDecision({ store, result, chosenName: opts.choose, decidedAt: today, note: opts.note });
    const chosen = store.getSupplier(order.supplierId).name;
    line(`\nSaved to memory. Order ${order.id} awarded to ${chosen}${decision.followedRecommendation ? '' : ' (you overrode the recommendation)'}.`);
    if (order.expectedDelivery) line(`Expected delivery ${order.expectedDelivery}. When it arrives, log it with:`);
    line(`  npm run outcome -- ${order.id} --delivered YYYY-MM-DD`);
  } else {
    line('\nNothing saved. Add --save to record this decision in memory.');
  }
} catch (err) {
  console.error(`\nError: ${err.message}${err.details ? `\n  ${err.details}` : ''}`);
  if (err.needsFx) console.error(`  Add the rate, for example: --rate ${err.needsFx.currencies[0]}=1500 (use today's real rate)`);
  process.exit(1);
}
