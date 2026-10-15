// ProcureMind's persistent memory. A plain JSON file keeps setup simple and
// dependency-free. Everything else talks to this interface, so the storage can
// later be swapped for Supabase or a graph database without touching the agent.

import fs from 'node:fs';
import path from 'node:path';

const EMPTY = { meta: {}, suppliers: [], items: [], quotes: [], orders: [], events: [], decisions: [] };

export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(ltd|limited|inc|llc|plc|co|company|corp|corporation|nig|nigeria)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export class MemoryStore {
  constructor(filePath, data) {
    this.filePath = filePath;
    this.data = { ...structuredClone(EMPTY), ...data };
  }

  static load(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Memory file not found at ${filePath}. Run "npm run seed" first.`);
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return new MemoryStore(filePath, data);
  }

  static create(filePath, data) {
    const store = new MemoryStore(filePath, data);
    store.save();
    return store;
  }

  // Write to a temp file, then rename, so a crash never leaves a half-written file.
  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  listSuppliers(category) {
    return this.data.suppliers.filter((s) => !category || s.category === category);
  }

  getSupplier(id) {
    return this.data.suppliers.find((s) => s.id === id) || null;
  }

  // Matches "KESTREL BOX CO LTD" or "Kestrel Box" to the stored Kestrel Box Co.
  findSupplierByName(name) {
    const target = normalizeName(name);
    if (!target) return null;
    const exact = this.data.suppliers.find((s) => normalizeName(s.name) === target);
    if (exact) return exact;
    const partial = this.data.suppliers.filter((s) => {
      const n = normalizeName(s.name);
      return n.includes(target) || target.includes(n);
    });
    return partial.length === 1 ? partial[0] : null;
  }

  addSupplier({ name, category, country = 'Unknown' }) {
    const base = normalizeName(name).replace(/ /g, '-') || 'supplier';
    let id = `sup-${base}`;
    for (let i = 2; this.getSupplier(id); i++) id = `sup-${base}-${i}`;
    const supplier = { id, name, category, country };
    this.data.suppliers.push(supplier);
    return supplier;
  }

  history(supplierId) {
    const by = (arr) => arr.filter((x) => x.supplierId === supplierId);
    const sortDate = (key) => (a, b) => String(a[key]).localeCompare(String(b[key]));
    return {
      supplier: this.getSupplier(supplierId),
      quotes: by(this.data.quotes).sort(sortDate('receivedAt')),
      orders: by(this.data.orders).sort(sortDate('awardedAt')),
      events: by(this.data.events).sort(sortDate('date')),
      decisions: this.data.decisions.filter((d) => d.supplierIds?.includes(supplierId))
    };
  }

  #nextId(collection, prefix) {
    const nums = this.data[collection].map((x) => Number(String(x.id).split('-').pop()) || 0);
    return `${prefix}-${String(Math.max(0, ...nums) + 1).padStart(4, '0')}`;
  }

  addQuote(quote) {
    const record = { id: this.#nextId('quotes', 'q'), ...quote };
    this.data.quotes.push(record);
    return record;
  }

  addEvent(event) {
    const record = { id: this.#nextId('events', 'e'), ...event };
    this.data.events.push(record);
    return record;
  }

  addOrder(order) {
    const record = { id: this.#nextId('orders', 'o'), status: 'open', ...order };
    this.data.orders.push(record);
    return record;
  }

  addDecision(decision) {
    const record = { id: this.#nextId('decisions', 'd'), ...decision };
    this.data.decisions.push(record);
    return record;
  }
}
