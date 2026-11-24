// logic.js — funções PURAS (sem DOM, sem banco): cálculos, unidades, receitas e parser de voz.
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
export const r3 = n => Math.round((Number(n) || 0) * 1000) / 1000;
export const num = s => { const n = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
export const brl = n => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const today = () => { const d = new Date(), p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Normaliza texto (sem acento/caixa) e "chave" tolerante a plural simples (ovos = ovo).
export const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
export const key = s => norm(s).split(' ').map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)).join(' ');

// ---------- Unidades: tudo é guardado em g, ml ou un ----------
export const UNITS = { un: { base: 'un', f: 1 }, g: { base: 'g', f: 1 }, kg: { base: 'g', f: 1000 }, ml: { base: 'ml', f: 1 }, l: { base: 'ml', f: 1000 } };
export const toBase = (qty, unit) => { const u = UNITS[unit] || UNITS.un; return { qty: r3(qty * u.f), unit: u.base }; };
export function bestUnit(qty, base) {            // para exibir/editar: 5000 g -> 5 kg
  if (base === 'g' && qty >= 1000) return { qty: r3(qty / 1000), unit: 'kg' };
  if (base === 'ml' && qty >= 1000) return { qty: r3(qty / 1000), unit: 'l' };
  return { qty: r3(qty), unit: base };
}
export function fmtQty(qty, base) {
  const b = bestUnit(qty, base), n = b.qty.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return `${n} ${b.unit === 'l' ? 'L' : b.unit}`;
}
export const packsNeeded = (missingBase, pack) => Math.max(1, Math.ceil(missingBase / (pack || 1) - 1e-9));

// ---------- Totais, contadores e limites da lista ----------
export function summarize(list, spaces, cfg) {
  let total = 0, cart = 0, count = 0, cartCount = 0;
  const bySpace = {}, spaceOf = cfg._spaceOf || (() => null);
  for (const l of list) {
    const sub = l.qty * l.price;
    total += sub; count += l.qty;
    if (l.checked) { cart += sub; cartCount += l.qty; }
    const sp = spaceOf(l.itemId); if (sp) bySpace[sp] = (bySpace[sp] || 0) + l.qty;
  }
  total = r2(total); cart = r2(cart);
  return {
    total, cart, count, cartCount, bySpace,
    overBudget: cfg.budget > 0 && total > cfg.budget,
    overItems: cfg.itemLimit > 0 && count > cfg.itemLimit,
    overSpaces: spaces.filter(s => s.limit > 0 && (bySpace[s.id] || 0) > s.limit).map(s => s.id),
  };
}

// ---------- Preços: mínimo / máximo / último, do histórico local ----------
const latest = arr => arr.reduce((a, b) => (!a || b.date + b.id > a.date + a.id ? b : a), null);
export const lastPrice = (hist, itemId, marketId) =>
  latest(hist.filter(p => p.itemId === itemId && p.price > 0 && (!marketId || p.marketId === marketId)))?.price ?? 0;
export function priceStats(hist, itemId, current = 0) {
  const h = hist.filter(p => p.itemId === itemId && p.price > 0);
  const ps = h.map(p => p.price); if (current > 0) ps.push(current);
  if (!ps.length) return null;
  const min = Math.min(...ps), max = Math.max(...ps);
  return { min, max, n: h.length, last: latest(h)?.price ?? null, minMarketId: latest(h.filter(p => p.price === min))?.marketId ?? null };
}

// ---------- Receitas x despensa ----------
// Percorre as receitas agendadas em ordem de data e vai "gastando" o estoque virtual.
// Retorna, por agendamento, o que falta; e quanto de cada item está reservado.
export function planCheck(plans, recipes, pantry) {
  const avail = { ...pantry }, out = {}, reserved = {};
  const todo = plans.filter(p => p.status === 'planned').sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
  for (const p of todo) {
    const r = recipes.find(x => x.id === p.recipeId);
    if (!r) { out[p.id] = { ok: true, missing: [] }; continue; }
    const k = (p.portions || r.servings) / (r.servings || 1), missing = [];
    for (const g of r.ingredients) {
      const need = g.qty * k, have = Math.max(0, avail[g.itemId] || 0), take = Math.min(have, need);
      avail[g.itemId] = r3(have - take);
      reserved[g.itemId] = r3((reserved[g.itemId] || 0) + take);
      if (need - take > 1e-6) missing.push({ itemId: g.itemId, need: r3(need), missing: r3(need - take) });
    }
    out[p.id] = { ok: !missing.length, missing };
  }
  return { plans: out, reserved };
}
// Baixa os ingredientes da despensa. Nunca fica negativo: o que faltou volta em "short".
export function consumeRecipe(r, portions, pantry) {
  const k = (portions || r.servings) / (r.servings || 1), next = { ...pantry }, used = {}, short = [];
  for (const g of r.ingredients) {
    const need = g.qty * k, have = Math.max(0, next[g.itemId] || 0), take = Math.min(have, need);
    next[g.itemId] = r3(have - take); used[g.itemId] = r3((used[g.itemId] || 0) + take);
    if (need - take > 1e-6) short.push({ itemId: g.itemId, missing: r3(need - take) });
  }
  return { pantry: next, consumed: Object.entries(used).map(([itemId, qty]) => ({ itemId, qty })), short };
}

// ---------- Parser de voz ----------
// "2 arroz 25 reais, 3 leite, na verdade 4 leite, remover feijão" -> [{acao,name,qty,price}]
const B = (s, f = 'giu') => new RegExp(`(?<![\\p{L}\\p{N}])(?:${s})(?![\\p{L}\\p{N}])`, f);
const NUMW = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, 'três': 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12 };
export function parseVoice(text) {
  let t = String(text || '').normalize('NFC').toLowerCase();
  t = t.replace(/r\$\s*(\d+(?:[.,]\d+)?)/g, ' $1 reais ');
  t = t.replace(B(Object.keys(NUMW).join('|')), m => NUMW[m]);
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*(?:reais|real)(?![\p{L}])(?:\s*e\s*(\d{1,2})(?:\s*centavos?)?)?/giu,
    (m, a, b) => ` §${Number(a.replace(',', '.')) + (b ? Number(b) / 100 : 0)}§ `);
  const SEP = /\s*(?:[,;]|(?<![\p{L}\p{N}])(?:mais|depois)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])e(?![\p{L}\p{N}])(?=\s*\d)|(?<![\p{L}\p{N}])e(?![\p{L}\p{N}])(?=\s+(?:remov|tir|apag|exclu)))\s*/u;
  const out = [];
  for (let c of t.split(SEP)) {
    const CORR = 'na verdade|quer dizer|corrig\\p{L}*|n[aã]o';
    const corrected = B(CORR, 'iu').test(c);
    c = c.split(B(CORR)).pop().trim();   // correção na mesma fala: vale o que vem depois
    if (!c) continue;
    let acao = 'add';
    if (B('remove|remover|tira|tirar|apaga|apagar|exclui|excluir', 'iu').test(c)) { acao = 'remover'; c = c.replace(B('remove|remover|tira|tirar|apaga|apagar|exclui|excluir'), ' '); }
    const pm = c.match(/§([\d.]+)§/), price = pm ? Number(pm[1]) : 0;
    c = c.replace(/§[\d.]+§/g, ' ').replace(B('adiciona|adicionar|coloca|colocar|bota|botar|inclui|incluir|quero|preciso|me'), ' ')
      .replace(/\s+/g, ' ').trim().replace(/^(?:de|do|da|dos|das)\s+/u, '').replace(/\s+(?:por|a|custa|custando|cada|valor|pre[cç]o|de)$/u, '');
    let qty = 1, name = c;
    const m = c.match(/^(\d+(?:[.,]\d+)?)\s*(?:x(?![\p{L}])|unidades?|un(?![\p{L}])|pacotes?|caixas?|latas?|garrafas?)?\s*(?:de\s+)?(.+)$/u);
    if (m) { qty = Math.max(1, Math.round(Number(m[1].replace(',', '.')))); name = m[2]; }
    name = name.trim();
    if (!/\p{L}/u.test(name)) continue;
    const row = { acao, name: cap(name), qty, price };
    if (corrected && acao === 'add' && out.length) {      // "..., na verdade 4 leite" substitui o item anterior
      let i = out.map(o => key(o.name)).lastIndexOf(key(name)); if (i < 0) i = out.length - 1;
      out[i] = row;
    } else out.push(row);
  }
  return out;
}
