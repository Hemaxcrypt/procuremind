// ProcureMind browser app. Plain JavaScript, no build step.
// All text from quotes or the server is inserted with textContent (via el()),
// never as HTML, so pasted quotes can't inject markup into the page.

const $view = document.getElementById('view');
const $toast = document.getElementById('toast');

// ---------- helpers ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'style') node.setAttribute('style', v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data;
  try { data = await res.json(); } catch { throw new Error(`The server returned an unexpected response (${res.status}).`); }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data });
  return data;
}

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2600);
}

const money = (cur, n) => `${cur} ${Number(n).toLocaleString('en-US', n < 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 4 } : { maximumFractionDigits: 0 })}`;
const pct = (x) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);
const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'not stated');
const RISK = new Set(['LATE_HISTORY', 'QUALITY_HISTORY', 'DISPUTE_HISTORY', 'EXPIRED', 'SUSPICIOUS_TEXT', 'MOQ_ABOVE_NEED']);
const INFO = new Set(['LITTLE_HISTORY', 'CONVERTED']);
const FACTOR_LABELS = { price: 'Price', delivery: 'Delivery', quality: 'Quality', disputes: 'Disputes', speed: 'Speed' };

function working(message) {
  return el('div', { class: 'working', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', {}, message));
}
function errorBox(message) {
  return el('p', { class: 'error', role: 'alert' }, message);
}

// ---------- state ----------
const state = {
  status: null,
  samples: [],
  quotes: [],
  weights: { price: 3, delivery: 3, quality: 2, disputes: 1, speed: 1 },
  itemId: '',
  result: null,
  fxRates: {},
  needsFx: null,
  extraItems: [],
  award: null,
  emails: null,
  busy: false,
  error: null
};

// ---------- compare view ----------
function quoteCard(q, i) {
  return el('div', { class: 'quote-card' },
    el('header', {},
      el('span', {}, q.label || `Quote ${i + 1}`),
      el('button', { class: 'link-btn', type: 'button', onclick: () => { state.quotes.splice(i, 1); renderCompare(); } }, 'Remove')
    ),
    el('textarea', {
      'aria-label': `Text of ${q.label || `quote ${i + 1}`}`,
      placeholder: 'Paste the quote exactly as you received it: an email, a chat message, or text from a PDF.',
      oninput: (e) => { q.text = e.target.value; }
    }, q.text)
  );
}

// Ready-made scenarios, each showing one thing ProcureMind does.
const SCENARIOS = [
  ['All three box quotes', ['01', '02', '03']],
  ['Box quotes with one in naira', ['01', '02', '06']],
  ['A supplier gives no price', ['01', '02', '07']],
  ['Freight, one with a hidden instruction', ['04', '08', '09']]
];

function loadScenario(prefixes) {
  state.quotes = prefixes.map((p) => state.samples.find((s) => s.file.startsWith(p))).filter(Boolean).map((s) => ({ label: s.name, text: s.text }));
  state.itemId = '';
  renderCompare();
}

function addSample(s) {
  if (state.quotes.some((q) => q.text === s.text)) return toast(`${s.name} is already added`);
  const blank = state.quotes.findIndex((q) => !q.text.trim());
  const entry = { label: s.name, text: s.text };
  if (blank >= 0) state.quotes[blank] = entry; else state.quotes.push(entry);
  renderCompare();
}

function weightRow(key) {
  const total = Object.values(state.weights).reduce((a, b) => a + b, 0) || 1;
  const out = el('output', { id: `w-${key}` }, `${Math.round((state.weights[key] / total) * 100)}%`);
  return el('div', { class: 'weight' },
    el('span', {}, FACTOR_LABELS[key]),
    el('input', {
      type: 'range', min: '0', max: '10', step: '1', value: String(state.weights[key]), 'aria-label': `${FACTOR_LABELS[key]} priority`,
      oninput: (e) => {
        state.weights[key] = Number(e.target.value);
        const t = Object.values(state.weights).reduce((a, b) => a + b, 0) || 1;
        for (const k of Object.keys(state.weights)) document.getElementById(`w-${k}`).textContent = `${Math.round((state.weights[k] / t) * 100)}%`;
      }
    }),
    out
  );
}

function inputPanel() {
  const items = state.status?.items || [];
  return el('section', { class: 'sheet sheet-pad stack', 'aria-labelledby': 'quotes-h' },
    el('div', {},
      el('h2', { id: 'quotes-h' }, 'Quotes'),
      el('p', { class: 'muted small' }, 'Paste each supplier quote as it arrived. ProcureMind reads it, checks the supplier’s history, and recommends who to buy from.')
    ),
    el('div', {},
      el('p', { class: 'small', style: 'font-weight:600;margin-bottom:6px' }, 'Try a sample'),
      el('div', { class: 'samples' },
        SCENARIOS.map(([label, files]) => el('button', { class: 'chip scenario', type: 'button', onclick: () => loadScenario(files) }, label))
      ),
      el('details', { class: 'sample-list' },
        el('summary', { class: 'small' }, 'Single sample quotes'),
        el('div', { class: 'samples', style: 'margin-top:8px' }, state.samples.map((s) => el('button', { class: 'chip', type: 'button', onclick: () => addSample(s) }, s.name)))
      )
    ),
    state.quotes.map(quoteCard),
    el('button', { class: 'btn secondary block', type: 'button', onclick: () => { state.quotes.push({ label: '', text: '' }); renderCompare(); } }, 'Add a quote'),
    el('details', { class: 'priorities' },
      el('summary', {}, 'Priorities'),
      el('p', { class: 'muted small', style: 'margin-top:6px' }, 'How much each factor counts. Delivery, quality and disputes come from the supplier’s past orders.'),
      Object.keys(state.weights).map(weightRow)
    ),
    el('div', {},
      el('label', { for: 'item' }, 'Item to compare'),
      el('select', { id: 'item', onchange: (e) => { state.itemId = e.target.value; } },
        el('option', { value: '' }, 'Whichever item is quoted most'),
        [...items, ...state.extraItems.filter((x) => !items.some((it) => it.id === x.id))].map((it) => el('option', { value: it.id, selected: state.itemId === it.id }, it.name))
      )
    ),
    el('button', { class: 'btn block', type: 'button', id: 'compare-btn', disabled: state.busy, onclick: runCompare }, state.busy ? 'Comparing…' : 'Compare quotes')
  );
}

async function runCompare() {
  const quotes = state.quotes.map((q) => q.text).filter((t) => t.trim());
  if (!quotes.length) { state.error = 'Add at least one quote, or pick a sample.'; return renderCompare(); }
  state.busy = true; state.error = null; state.needsFx = null; state.award = null; state.emails = null; state.result = null;
  renderCompare();
  try {
    state.result = await api('/api/compare', { quotes, weights: state.weights, itemId: state.itemId || undefined, fxRates: state.fxRates });
    const seen = [state.result.item, ...state.result.otherItems];
    for (const it of seen) if (!state.extraItems.some((x) => x.id === it.id)) state.extraItems.push({ id: it.id, name: it.name });
  } catch (err) {
    state.error = err.message;
    state.needsFx = err.data?.needsFx || null;
  } finally {
    state.busy = false;
    renderCompare();
  }
}

function optionRow(o, r, top) {
  const cur = r.currency;
  const total = o.quantity ? money(cur, o.unitPrice * o.quantity) : null;
  const href = o.supplierId ? `#supplier/${o.supplierId}` : null;
  return el('li', { class: `option${top ? ' top' : ''}` },
    top ? el('span', { class: `stamp${r.id !== state.stampedId ? ' fresh' : ''}`, 'aria-hidden': 'true' }, 'Recommended') : null,
    el('span', { class: 'rank', 'aria-label': `Rank ${o.rank}` }, o.rank),
    el('div', {},
      el('div', { class: 'supplier-name' }, href ? el('a', { href }, o.name) : o.name, top ? el('span', { class: 'visually-hidden' }, ' (recommended)') : null),
      el('div', { class: 'terms' },
        el('span', {}, el('b', {}, money(cur, o.unitPrice)), ' per unit'),
        total ? el('span', {}, el('b', {}, total), ` for ${o.quantity.toLocaleString('en-US')}`) : null,
        el('span', {}, o.leadTimeDays != null ? el('b', {}, `${o.leadTimeDays} days`) : 'Lead time not stated'),
        el('span', {}, o.paymentTerms || 'Payment terms not stated')
      )
    ),
    el('div', { class: 'score' }, el('strong', {}, Math.round(o.total)), el('span', {}, 'out of 100')),
    el('div', { class: 'factors' },
      Object.entries(o.scores).map(([k, v]) => el('div', { class: `factor${v < 40 ? ' low' : v < 65 ? ' mid' : ''}` },
        `${FACTOR_LABELS[k]} ${Math.round(v)}`,
        el('div', { class: 'bar', role: 'img', 'aria-label': `${FACTOR_LABELS[k]} score ${Math.round(v)} of 100` }, el('i', { style: `width:${Math.max(2, v)}%` }))
      ))
    ),
    o.flags.length ? el('ul', { class: 'flags' }, o.flags.map((f) => el('li', { class: `flag${RISK.has(f.code) ? ' risk' : INFO.has(f.code) ? ' info' : ''}` }, f.message))) : null
  );
}

function explanationBlock(r) {
  const e = r.explanation;
  const list = (title, items) => (items.length ? el('div', {}, el('h3', {}, title), el('ul', {}, items.map((x) => el('li', {}, x)))) : null);
  return el('div', { class: 'explain' },
    el('p', { class: 'summary' }, e.summary),
    list('Why', e.reasons),
    list('Watch out for', e.risks),
    list('Negotiate', e.negotiation_points),
    el('p', { class: 'next' }, el('strong', {}, 'Next step: '), e.next_step),
    el('p', { class: 'source-note' }, r.explanationSource === 'rules'
      ? `Explanation written by built-in rules because Claude could not be reached (${r.fallbackReason}). The ranking is unaffected.`
      : 'Ranking calculated from your supplier history. Explanation written by Claude from those figures.')
  );
}

function decidePanel(r) {
  if (state.award) {
    const a = state.award;
    return el('div', { class: 'decide stack' },
      el('div', { class: 'awarded' },
        el('h3', {}, `Awarded to ${a.supplier}`),
        el('p', { class: 'small' }, `Order ${a.order.id} saved. `, a.order.expectedDelivery ? `Expected by ${fmtDate(a.order.expectedDelivery)}. ` : '', 'When it arrives, log the delivery under ', el('a', { href: '#orders' }, 'Open orders'), ' and ProcureMind will remember how it went.')
      ),
      state.emails ? emailsBlock() : el('button', { class: 'btn secondary', type: 'button', id: 'emails-btn', onclick: draftEmailsNow }, 'Draft award and decline emails')
    );
  }
  const others = r.ranked.slice(1);
  return el('div', { class: 'decide stack' },
    el('h2', {}, 'Decide'),
    el('div', { class: 'decide-row' },
      el('div', {},
        el('label', { for: 'choose' }, 'Award to'),
        el('select', { id: 'choose' },
          el('option', { value: r.ranked[0].name }, `${r.ranked[0].name} (recommended)`),
          others.map((o) => el('option', { value: o.name }, o.name))
        )
      ),
      el('div', {},
        el('label', { for: 'note' }, 'Reason (saved with the decision)'),
        el('input', { id: 'note', type: 'text', placeholder: 'e.g. Trial order for a new supplier' })
      ),
      el('button', { class: 'btn approve', type: 'button', id: 'award-btn', onclick: awardNow }, 'Award order')
    )
  );
}

async function awardNow() {
  const chosenName = document.getElementById('choose').value;
  const note = document.getElementById('note').value.trim();
  const btn = document.getElementById('award-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    state.award = await api('/api/award', { comparisonId: state.result.id, chosenName, note: note || undefined });
    toast(`Order ${state.award.order.id} awarded to ${state.award.supplier}`);
    refreshOrderCount();
  } catch (err) {
    toast(err.message);
    btn.disabled = false; btn.textContent = 'Award order';
    return;
  }
  renderCompare();
}

async function draftEmailsNow() {
  const btn = document.getElementById('emails-btn');
  btn.replaceWith(working('Drafting emails…'));
  try {
    state.emails = await api('/api/emails', { comparisonId: state.result.id, chosenName: state.award.supplier });
  } catch (err) {
    state.emails = { error: err.message };
  }
  renderCompare();
}

function emailCard(to, email) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(`Subject: ${email.subject}\n\n${email.body}`); toast('Email copied'); }
    catch { toast('Copy failed: select the text and copy it manually'); }
  };
  return el('article', { class: 'email' },
    el('header', {},
      el('div', {}, el('div', { class: 'to' }, `To: ${to}`), el('div', { class: 'subject' }, email.subject)),
      el('button', { class: 'btn secondary small', type: 'button', onclick: copy }, 'Copy')
    ),
    el('pre', {}, email.body)
  );
}

function emailsBlock() {
  const e = state.emails;
  if (e.error) return errorBox(e.error);
  return el('div', {},
    el('h3', {}, 'Email drafts'),
    el('p', { class: 'muted small' }, e.source === 'template'
      ? 'Written from templates because Claude could not be reached. Declines never mention the winner or its price.'
      : 'Drafted by Claude. Declines are checked so they never mention the winner or its price.'),
    el('div', { class: 'emails' },
      emailCard(state.award.supplier, e.emails.award),
      e.emails.declines.map((d) => emailCard(d.supplier, d))
    )
  );
}

function fxForm({ base, currencies }) {
  const inputs = currencies.map((c) => el('div', { class: 'fx-row' },
    el('label', { for: `fx-${c}` }, `1 ${base} =`),
    el('input', { id: `fx-${c}`, type: 'number', min: '0', step: 'any', required: true, value: state.fxRates[c] ?? '', placeholder: 'rate' }),
    el('span', {}, c)
  ));
  return el('form', { class: 'stack', onsubmit: (e) => {
    e.preventDefault();
    for (const c of currencies) state.fxRates[c] = Number(document.getElementById(`fx-${c}`).value);
    runCompare();
  } },
    el('h2', {}, 'Exchange rate needed'),
    el('p', {}, `Some quotes are in ${currencies.join(' and ')}, others in ${base}. Enter the rate you want to use. ProcureMind doesn’t guess rates, because they change every day; use today’s rate from your bank or a source you trust.`),
    inputs,
    el('button', { class: 'btn', type: 'submit' }, 'Compare with this rate')
  );
}

function resultsPanel() {
  if (state.busy) return el('section', { class: 'sheet' }, working('Reading quotes with Claude and checking supplier history… this takes a few seconds per new quote.'));
  if (state.needsFx) return el('section', { class: 'sheet sheet-pad' }, fxForm(state.needsFx));
  if (state.error && !state.result) return el('section', { class: 'sheet sheet-pad' }, errorBox(state.error));
  const r = state.result;
  if (!r) {
    return el('section', { class: 'sheet empty' },
      el('h2', {}, 'No comparison yet'),
      el('p', { class: 'muted' }, 'Add two or more quotes for the same item and press Compare quotes. Start with “All three box quotes” to see how history changes the answer.')
    );
  }
  return el('section', { class: 'sheet', 'aria-labelledby': 'result-h' },
    state.error ? el('div', { class: 'sheet-pad' }, errorBox(state.error)) : null,
    el('div', { class: 'result-head' },
      el('div', {},
        el('h1', { id: 'result-h' }, r.item.name),
        el('p', { class: 'muted small' }, `${r.ranked.length} quote${r.ranked.length === 1 ? '' : 's'} compared.`, r.market.avg ? ` Average price quoted in your history: ${money(r.currency, r.market.avg)}.` : '', r.fx ? ` Converted to ${r.fx.base} at ${Object.entries(r.fx.rates).map(([c, v]) => `1 ${r.fx.base} = ${v.toLocaleString('en-US')} ${c}`).join(', ')}.` : '')
      )
    ),
    r.notices.length || r.unpriced.length ? el('ul', { class: 'notices' },
      r.notices.map((n) => el('li', {}, n)),
      r.unpriced.map((u) => el('li', {}, `${u.supplier} did not give a price for “${u.description}”, so it is not compared. Ask them for a price.`))
    ) : null,
    el('ol', { class: 'options', 'aria-label': 'Suppliers ranked best first' }, r.ranked.map((o, i) => optionRow(o, r, i === 0))),
    explanationBlock(r),
    r.otherItems.length ? el('p', { class: 'sheet-pad small muted', style: 'border-top:1px solid var(--rule)' }, 'These quotes also priced: ',
      r.otherItems.map((g, i) => [i ? ', ' : '', el('button', { class: 'link-btn', type: 'button', onclick: () => { state.itemId = g.id; runCompare(); } }, g.name)]), '.') : null,
    decidePanel(r)
  );
}

function renderCompare() {
  $view.replaceChildren(el('div', { class: 'compare' }, inputPanel(), resultsPanel()));
  // The stamp animates once per new result, not on every redraw.
  if (state.result && !state.busy) state.stampedId = state.result.id;
}

// ---------- orders view ----------
async function renderOrders() {
  $view.replaceChildren(working('Loading open orders…'));
  let orders;
  try { orders = await api('/api/orders'); } catch (err) { return $view.replaceChildren(errorBox(err.message)); }
  const today = state.status?.today;
  const head = el('div', { class: 'view-head' },
    el('div', {}, el('h1', {}, 'Open orders'), el('p', { class: 'muted' }, 'Log each delivery as it arrives. Late deliveries, rejected units and invoice disputes are remembered and count in future recommendations.'))
  );
  if (!orders.length) return $view.replaceChildren(head, el('div', { class: 'sheet empty' }, el('h2', {}, 'No open orders'), el('p', { class: 'muted' }, 'Award an order from Compare quotes and it will appear here.')));
  $view.replaceChildren(head, el('div', { class: 'order-list' }, orders.map((o) => orderCard(o, today))));
}

function orderCard(o, today) {
  const card = el('article', { class: 'sheet order' });
  const overdue = o.expectedDelivery && today && o.expectedDelivery < today;
  const fid = (n) => `${o.id}-${n}`;
  const disputeWrap = el('div', { class: 'field-row', hidden: true },
    el('div', {}, el('label', { for: fid('amt') }, `Amount in question (${o.currency})`), el('input', { id: fid('amt'), type: 'number', min: '0', step: '0.01' })),
    el('div', {}, el('label', { for: fid('why') }, 'What was wrong'), el('input', { id: fid('why'), type: 'text', placeholder: 'e.g. Unagreed surcharge on invoice' }))
  );
  const errorSlot = el('div');
  const form = el('form', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Saving…';
      errorSlot.replaceChildren();
      try {
        const res = await api('/api/outcome', {
          orderId: o.id,
          deliveredAt: form.querySelector(`#${CSS.escape(fid('date'))}`).value,
          defectPercent: form.querySelector(`#${CSS.escape(fid('def'))}`).value,
          qualityNote: form.querySelector(`#${CSS.escape(fid('qn'))}`).value.trim(),
          disputeAmount: disputeWrap.hidden ? '' : form.querySelector(`#${CSS.escape(fid('amt'))}`).value,
          disputeReason: form.querySelector(`#${CSS.escape(fid('why'))}`).value
        });
        const p = res.profile;
        form.replaceWith(el('div', { class: 'awarded logged' },
          el('h3', {}, 'Delivery logged'),
          el('ul', {}, res.events.map((e) => el('li', {}, e.description))),
          el('p', { class: 'small' }, `${p.name} is now on time in ${pct(p.onTimeRate)} of ${p.deliveries} deliveries, with ${p.qualityIssues} quality issue${p.qualityIssues === 1 ? '' : 's'} and ${p.disputes} dispute${p.disputes === 1 ? '' : 's'}. `, el('a', { href: `#supplier/${o.supplierId}` }, 'See full record'))
        ));
        refreshOrderCount();
      } catch (err) {
        errorSlot.replaceChildren(errorBox(err.message));
        btn.disabled = false; btn.textContent = 'Log delivery';
      }
    }
  },
    el('div', { class: 'field-row' },
      el('div', {}, el('label', { for: fid('date') }, 'Delivered on'), el('input', { id: fid('date'), type: 'date', required: true, value: today, min: o.awardedAt })),
      el('div', {}, el('label', { for: fid('def') }, 'Units rejected (%)'), el('input', { id: fid('def'), type: 'number', min: '0', max: '100', step: '0.1', placeholder: '0' })),
      el('div', {}, el('label', { for: fid('qn') }, 'Quality note'), el('input', { id: fid('qn'), type: 'text', placeholder: 'e.g. Cartons crushed' }))
    ),
    el('p', { style: 'margin:10px 0' }, el('button', { class: 'link-btn', type: 'button', onclick: (e) => { disputeWrap.hidden = !disputeWrap.hidden; e.target.textContent = disputeWrap.hidden ? 'Add an invoice dispute' : 'Remove the invoice dispute'; } }, 'Add an invoice dispute')),
    disputeWrap,
    errorSlot,
    el('p', { style: 'margin-top:12px' }, el('button', { class: 'btn', type: 'submit' }, 'Log delivery'))
  );
  card.append(
    el('div', { class: 'order-top' },
      el('div', {},
        el('div', {}, el('span', { class: 'order-id' }, o.id), ' from ', el('a', { href: `#supplier/${o.supplierId}` }, o.supplier)),
        el('div', { class: 'muted small' }, `${o.quantity?.toLocaleString('en-US') ?? '?'} × ${o.item} at ${money(o.currency, o.unitPrice)}`)
      ),
      el('div', { class: 'small', style: 'text-align:right' },
        el('div', {}, `Awarded ${fmtDate(o.awardedAt)}`),
        el('div', { class: overdue ? 'overdue' : 'muted' }, o.expectedDelivery ? `${overdue ? 'Overdue, expected' : 'Expected'} ${fmtDate(o.expectedDelivery)}` : 'No delivery date')
      )
    ),
    form
  );
  return card;
}

// ---------- suppliers view ----------
async function renderSuppliers() {
  $view.replaceChildren(working('Loading suppliers…'));
  let list;
  try { list = await api('/api/suppliers'); } catch (err) { return $view.replaceChildren(errorBox(err.message)); }
  const byCat = {};
  for (const s of list) (byCat[s.category || 'other'] ||= []).push(s);
  const catName = { packaging: 'Packaging', electronics: 'Electronics', freight: 'Freight', other: 'Other' };
  $view.replaceChildren(
    el('div', { class: 'view-head' }, el('div', {}, el('h1', {}, 'Suppliers'), el('p', { class: 'muted' }, 'Every supplier’s record, built from past orders. This is the memory ProcureMind uses when it compares quotes.'))),
    ...Object.entries(byCat).flatMap(([cat, ss]) => [
      el('h2', { class: 'cat-title' }, catName[cat] || cat),
      el('div', { class: 'supplier-grid' }, ss.map(supplierCard))
    ])
  );
}

function supplierCard(s) {
  const onTime = s.onTimeRate;
  return el('a', { class: 'sheet supplier-card', href: `#supplier/${s.supplierId}` },
    el('div', { class: 'supplier-name' }, s.name),
    el('div', { class: 'country' }, s.country),
    s.deliveries
      ? el('div', { class: 'stat-line' },
        el('div', { class: `stat ${onTime >= 0.8 ? 'good' : onTime < 0.6 ? 'bad' : ''}` }, el('strong', {}, pct(onTime)), el('span', {}, 'on time')),
        el('div', { class: 'stat' }, el('strong', {}, s.deliveries), el('span', {}, 'deliveries')),
        el('div', { class: `stat ${s.qualityIssues + s.disputes ? 'bad' : ''}` }, el('strong', {}, s.qualityIssues + s.disputes), el('span', {}, 'issues'))
      )
      : el('p', { class: 'small muted', style: 'margin-top:12px' }, 'No deliveries yet. No track record.')
  );
}

async function renderSupplier(id) {
  $view.replaceChildren(working('Loading supplier…'));
  let d;
  try { d = await api(`/api/suppliers/${encodeURIComponent(id)}`); } catch (err) { return $view.replaceChildren(errorBox(err.message)); }
  const p = d.profile;
  const kinds = { delivery: 'Delivery', quality_issue: 'Quality issue', dispute: 'Invoice dispute' };
  $view.replaceChildren(
    el('p', { class: 'small', style: 'margin-bottom:12px' }, el('a', { href: '#suppliers' }, 'All suppliers')),
    el('div', { class: 'view-head' },
      el('div', {}, el('h1', {}, p.name), el('p', { class: 'muted' }, p.category ? `${p.category[0].toUpperCase()}${p.category.slice(1)} supplier in ${p.country}` : `Supplier in ${p.country}`)),
      el('div', { class: 'stat-line' },
        el('div', { class: 'stat' }, el('strong', {}, pct(p.onTimeRate)), el('span', {}, 'on time')),
        el('div', { class: 'stat' }, el('strong', {}, p.avgDaysLateWhenLate ?? 0), el('span', {}, 'avg days late')),
        el('div', { class: 'stat' }, el('strong', {}, p.qualityIssues), el('span', {}, 'quality issues')),
        el('div', { class: 'stat' }, el('strong', {}, p.disputes), el('span', {}, 'disputes'))
      )
    ),
    el('div', { class: 'detail-grid' },
      el('section', { class: 'sheet sheet-pad' },
        el('h2', { style: 'margin-bottom:8px' }, 'History'),
        d.events.length
          ? el('ul', { class: 'timeline' }, d.events.map((e) => el('li', {},
            el('time', { datetime: e.date }, fmtDate(e.date)),
            el('span', { class: e.type !== 'delivery' || e.daysLate ? 'bad' : '' }, `${kinds[e.type] || e.type}: ${e.description}`, e.orderId ? el('span', { class: 'muted' }, ` (${e.orderId})`) : null)
          )))
          : el('p', { class: 'muted' }, 'No deliveries recorded yet.')
      ),
      el('section', { class: 'sheet sheet-pad' },
        el('h2', { style: 'margin-bottom:8px' }, 'Recent quotes'),
        d.quotes.length
          ? el('table', {},
            el('thead', {}, el('tr', {}, el('th', {}, 'Date'), el('th', {}, 'Item'), el('th', { class: 'num' }, 'Unit price'), el('th', { class: 'num' }, 'Lead'))),
            el('tbody', {}, d.quotes.map((q) => el('tr', {},
              el('td', {}, fmtDate(q.receivedAt)), el('td', {}, q.item), el('td', { class: 'num' }, money(q.currency, q.unitPrice)), el('td', { class: 'num' }, q.leadTimeDays != null ? `${q.leadTimeDays}d` : '?')
            ))))
          : el('p', { class: 'muted' }, 'No quotes yet.')
      )
    )
  );
}

// ---------- routing ----------
async function refreshOrderCount() {
  try {
    const orders = await api('/api/orders');
    document.getElementById('order-count').textContent = orders.length || '';
  } catch { /* the count is a nicety */ }
}

function route() {
  const hash = location.hash.replace(/^#/, '') || 'compare';
  const [tab, arg] = hash.split('/');
  const current = tab === 'supplier' ? 'suppliers' : tab;
  document.querySelectorAll('.tabs a').forEach((a) => (a.dataset.tab === current ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  if (tab === 'orders') renderOrders();
  else if (tab === 'suppliers') renderSuppliers();
  else if (tab === 'supplier' && arg) renderSupplier(arg);
  else renderCompare();
  $view.focus({ preventScroll: true });
}

document.getElementById('reset').addEventListener('click', async () => {
  if (!confirm('Reset the demo? This deletes every decision and delivery you logged and restores the original simulated history.')) return;
  try {
    await api('/api/reset', {});
    Object.assign(state, { result: null, award: null, emails: null, error: null });
    toast('Demo reset to the original history');
    refreshOrderCount();
    route();
  } catch (err) { toast(err.message); }
});

window.addEventListener('hashchange', route);

(async function start() {
  try {
    [state.status, state.samples] = await Promise.all([api('/api/status'), api('/api/samples')]);
  } catch (err) {
    $view.replaceChildren(errorBox(`Could not reach the ProcureMind server: ${err.message}. Is "npm start" still running?`));
    return;
  }
  if (!state.status.hasKey) state.error = 'No Claude API key is set, so new quotes can’t be read. Add ANTHROPIC_API_KEY to the .env file and restart.';
  state.quotes = [{ label: '', text: '' }];
  refreshOrderCount();
  route();
})();
