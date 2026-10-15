// Matches a quoted line ("All-in ocean freight, 40' HC container, Apapa -> Rotterdam")
// to an item in the catalog ("40ft container, Lagos (Apapa) to Rotterdam"), so
// quotes for the same thing can be compared with each other and with history.

const STOP = new Set(['the', 'a', 'an', 'of', 'per', 'to', 'for', 'and', 'with', 'in', 'all', 'pcs', 'pc', 'piece', 'pieces', 'unit', 'units', 'each']);

export function tokens(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/(\d+)\s*(ft|'|")/g, '$1') // 40ft, 40' -> 40
      .replace(/(\d+)(cm|mm)\b/g, '$1') // 30cm -> 30
      .replace(/(\d+)\s*x\s*(\d+)\s*x\s*(\d+)/g, '$1 $2 $3') // 40x30x30 -> 40 30 30
      .replace(/(\d+)\s*by\s*(\d+)\s*by\s*(\d+)/g, '$1 $2 $3')
      .split(/[^a-z0-9]+/)
      .map((t) => t.replace(/s$/, '')) // boxes -> boxe, cartons -> carton; good enough
      .filter((t) => t && !STOP.has(t))
  );
}

const SYNONYMS = { carton: 'box', boxe: 'box', battery: 'batt', batterie: 'batt', board: 'pcb', ocean: 'sea', hc: 'container' };
const canon = (set) => new Set([...set].map((t) => SYNONYMS[t] || t));

/** Returns the best catalog item for a line description, or null if nothing fits well. */
export function matchItem(description, catalog, { minScore = 0.3 } = {}) {
  const words = canon(tokens(description));
  let best = null;
  for (const item of catalog) {
    const target = canon(tokens(item.name));
    const shared = [...target].filter((t) => words.has(t)).length;
    const score = shared / target.size; // share of the catalog name that is covered
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score >= minScore ? best.item : null;
}
