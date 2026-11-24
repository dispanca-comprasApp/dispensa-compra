// app.js — interface e fluxos. O estado em memória (S) é só um espelho do IndexedDB:
// toda alteração grava primeiro no banco (db.batch = atômico) e depois recarrega e redesenha.
import * as DB from './db.js';
import { uid, r2, r3, num, brl, today, cap, norm, key, toBase, bestUnit, fmtQty, packsNeeded,
  summarize, lastPrice, priceStats, planCheck, consumeRecipe, parseVoice } from './logic.js';

const S = { cfg: {}, markets: [], spaces: [], items: [], list: [], prices: [], pantry: [], recipes: [], plan: [], purchases: [] };
const UI = { tab: 'list', month: today().slice(0, 7), day: today(), edit: null, voice: [], install: null };

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = (a, id) => a.find(x => x.id === id);
const item = id => byId(S.items, id);
const recipe = id => byId(S.recipes, id);
const mkName = id => byId(S.markets, id)?.name ?? 'Mercado removido';
const spName = id => byId(S.spaces, id)?.name ?? '—';
const findItem = name => S.items.find(i => key(i.name) === key(name));
const pantryMap = () => Object.fromEntries(S.pantry.map(p => [p.itemId, p.qty]));
const defSpace = pref => (S.spaces.find(s => norm(s.name) === pref) || S.spaces[0]).id;
const opts = (arr, sel, lbl = x => x.name) => arr.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(lbl(x))}</option>`).join('');
const unitOpts = sel => [['un', 'un'], ['g', 'g'], ['kg', 'kg'], ['ml', 'ml'], ['l', 'L']].map(([v, t]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${t}</option>`).join('');
const money = n => String(n || '').replace('.', ',');
const cmpName = (a, b) => (item(a.itemId)?.name || '').localeCompare(item(b.itemId)?.name || '', 'pt-BR');
const run = fn => Promise.resolve().then(fn).catch(e => { console.error(e); toast(e.message || 'Algo deu errado'); });
let tt;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 3000); }
const sumOf = () => summarize(S.list, S.spaces, { ...S.cfg, _spaceOf: id => item(id)?.spaceId });

// ---------- carga / seed ----------
async function load() {
  const names = DB.STORES;
  const rows = await Promise.all(names.map(DB.all));
  const m = Object.fromEntries(names.map((n, i) => [n, rows[i]]));
  S.cfg = m.kv.find(k => k.key === 'cfg') || {};
  const ord = (a, b) => (a.ord || 0) - (b.ord || 0);
  Object.assign(S, { markets: m.markets.sort(ord), spaces: m.spaces.sort(ord), items: m.items, list: m.list, prices: m.prices,
    pantry: m.pantry, recipes: m.recipes, plan: m.plan, purchases: m.purchases });
}
async function seed() {
  const ops = [];
  if (!S.markets.length) ['Atacadão', 'Mercado do bairro'].forEach((n, i) => ops.push({ store: 'markets', put: { id: 'mk' + i, name: n, ord: i } }));
  if (!S.spaces.length) ['Geladeira', 'Despensa', 'Freezer', 'Limpeza e higiene', 'Outros'].forEach((n, i) => ops.push({ store: 'spaces', put: { id: 'sp' + i, name: n, limit: 0, ord: i } }));
  if (!S.cfg.key) ops.push({ store: 'kv', put: { key: 'cfg', marketId: 'mk0', days: 30, people: 2, budget: 0, itemLimit: 0 } });
  await DB.batch(ops);
}
async function refresh() { await load(); render(); }
async function saveCfg(p) { Object.assign(S.cfg, p); await DB.put('kv', S.cfg); }

// ---------- render ----------
const TABS = [['list', '🛒', 'Lista'], ['pantry', '🏠', 'Despensa'], ['recipes', '🍳', 'Receitas'], ['agenda', '📅', 'Agenda'], ['settings', '⚙️', 'Ajustes']];
function render() {
  renderView(); renderBar();
  $('#nav').innerHTML = TABS.map(([t, i, l]) => `<button data-act="tab" data-t="${t}" class="${UI.tab === t ? 'on' : ''}"><span>${i}</span>${l}</button>`).join('');
}
const renderView = () => { $('#view').innerHTML = VIEWS[UI.tab](); };
function renderBar() {
  const n = S.list.filter(l => l.checked).length;
  $('#bar').innerHTML = {
    list: `<button class="btn mic" data-act="voice" aria-label="Ditar itens">🎤</button><button class="btn pri" data-act="addLine">＋ Item</button><button class="btn ok" data-act="finish" ${n ? '' : 'disabled'}>✔ Finalizar${n ? ` (${n})` : ''}</button>`,
    pantry: `<button class="btn pri" data-act="pantryAdd">＋ Adicionar à despensa</button>`,
    recipes: `<button class="btn pri" data-act="recipeAdd">＋ Nova receita</button>`,
    agenda: '', settings: '',
  }[UI.tab];
}

// ---------- LISTA ----------
function cfgHTML() {
  const c = S.cfg, per = c.budget > 0 ? brl(c.budget / (c.days || 1) / (c.people || 1)) : null;
  return `<div class="card"><label>Mercado desta compra<select data-chg="cfg:marketId">${opts(S.markets, c.marketId)}</select></label>
  <div class="grid2">
   <label>Duração (dias)<input inputmode="numeric" value="${c.days || ''}" data-chg="cfg:days"></label>
   <label>Pessoas<input inputmode="numeric" value="${c.people || ''}" data-chg="cfg:people"></label>
   <label>Meta de gastos (R$)<input inputmode="decimal" value="${c.budget ? money(c.budget) : ''}" placeholder="sem meta" data-chg="cfg:budget"></label>
   <label>Limite de itens<input inputmode="numeric" value="${c.itemLimit || ''}" placeholder="sem limite" data-chg="cfg:itemLimit"></label>
  </div>${per ? `<small class="mut">≈ ${per} por pessoa/dia</small>` : ''}</div>`;
}
function sumHTML() {
  const s = sumOf(), c = S.cfg, B = c.budget > 0, N = c.itemLimit > 0;
  const bar = (on, v, max) => on ? `<i class="bar"><u style="width:${Math.min(100, v / max * 100)}%"></u></i>` : '';
  const chips = S.spaces.filter(sp => s.bySpace[sp.id] || sp.limit > 0).map(sp => {
    const n = s.bySpace[sp.id] || 0, over = sp.limit > 0 && n > sp.limit;
    return `<span class="chip ${over ? 'bad' : sp.limit > 0 ? 'ok' : ''}">${esc(sp.name)} ${n}${sp.limit > 0 ? '/' + sp.limit : ''}</span>`;
  }).join('');
  return `<div class="sum">
   <div class="box ${B ? (s.overBudget ? 'bad' : 'ok') : ''}"><label>Total</label><b>${brl(s.total)}</b>
    <small>${B ? (s.overBudget ? 'estourou ' + brl(s.total - c.budget) : 'meta ' + brl(c.budget)) : 'sem meta'}</small>${bar(B, s.total, c.budget)}</div>
   <div class="box ${N ? (s.overItems ? 'bad' : 'ok') : ''}"><label>Itens</label><b>${s.count}</b>
    <small>${N ? (s.overItems ? 'passou ' + (s.count - c.itemLimit) : 'limite ' + c.itemLimit) : 'sem limite'}</small>${bar(N, s.count, c.itemLimit)}</div>
  </div><div class="chips">${chips}${s.cart ? `<span class="chip">No carrinho ${brl(s.cart)} · ${s.cartCount}</span>` : ''}</div>`;
}
function rowHTML(l) {
  const it = item(l.itemId) || { name: '?', unit: 'un', pack: 1 }, st = priceStats(S.prices, l.itemId, l.price);
  let stats = '<small>sem histórico de preço</small>';
  if (st && st.n) {
    const cls = l.price > 0 && l.price <= st.min ? 'good' : l.price > 0 && l.price >= st.max && st.max > st.min ? 'bad' : '';
    stats = `<div class="st"><span>mín ${brl(st.min)}</span><span class="${cls}">atual ${l.price > 0 ? brl(l.price) : '—'}</span><span>máx ${brl(st.max)}</span></div>`;
  }
  const pack = it.unit === 'un' && it.pack === 1 ? '' : ' · ' + fmtQty(it.pack, it.unit);
  return `<div class="row ${l.checked ? 'done' : ''}">
   <button class="chk" data-act="toggle" data-id="${l.id}" aria-label="Marcar como comprado">${l.checked ? '✔' : ''}</button>
   <div class="main" data-act="editLine" data-id="${l.id}"><b>${esc(it.name)}</b><small>${esc(spName(it.spaceId))}${pack}</small>
    <div class="pr">${l.price > 0 ? `${brl(l.price)} × ${l.qty} = ${brl(l.price * l.qty)}` : 'toque para pôr o preço'}</div>${stats}</div>
   <div class="step"><button data-act="dec" data-id="${l.id}" aria-label="Menos">−</button><span>${l.qty}</span><button data-act="inc" data-id="${l.id}" aria-label="Mais">+</button></div></div>`;
}
function listView() {
  const groups = {};
  S.list.forEach(l => (groups[l.marketId] ||= []).push(l));
  const order = [...S.markets.map(m => m.id), ...Object.keys(groups).filter(k => !S.markets.some(m => m.id === k))];
  const body = order.filter(id => groups[id]).map(id => {
    const ls = groups[id].sort((a, b) => a.checked - b.checked || cmpName(a, b));
    return `<section><h4>${esc(mkName(id))}<small>${ls.reduce((a, l) => a + l.qty, 0)} itens · ${brl(ls.reduce((a, l) => a + l.qty * l.price, 0))}</small></h4>${ls.map(rowHTML).join('')}</section>`;
  }).join('');
  return sumHTML() + cfgHTML() + (body || `<p class="empty">Lista vazia.<br>Toque em <b>＋ Item</b> ou no 🎤 para ditar.</p>`);
}

// Sheet de item da lista (adicionar/editar)
function statLine(itemId) {
  const st = itemId && priceStats(S.prices, itemId, 0);
  if (!st) return 'Sem histórico de preço ainda — o preço pago entra no histórico ao finalizar a compra.';
  return `Histórico: mín ${brl(st.min)}${st.minMarketId ? ' (' + esc(mkName(st.minMarketId)) + ')' : ''} · máx ${brl(st.max)} · último ${brl(st.last)}`;
}
function openSheet(html) { $('#sheet').innerHTML = `<div class="back" data-act="closeSheet"></div><div class="panel">${html}</div>`; $('#sheet').classList.add('open'); }
function closeSheet() { $('#sheet').classList.remove('open'); $('#sheet').innerHTML = ''; UI.edit = null; }

function lineSheet(id, preset = {}) {
  const l = id && byId(S.list, id), it = l ? item(l.itemId) : null;
  UI.edit = { id: id || null };
  const pack = bestUnit(it?.pack ?? 1, it?.unit ?? 'un');
  openSheet(`<h3>${l ? 'Editar item' : 'Adicionar item'}</h3>
   <label>Nome<input id="f-name" list="dl-items" value="${esc(it?.name ?? preset.name ?? '')}" data-chg="fName" autocomplete="off"></label>
   <datalist id="dl-items">${S.items.map(i => `<option value="${esc(i.name)}">`).join('')}</datalist>
   <div class="grid2"><label>Quantidade<input id="f-qty" inputmode="numeric" value="${l?.qty ?? 1}"></label>
   <label>Preço unitário (R$)<input id="f-price" inputmode="decimal" value="${money(l?.price || '')}" placeholder="0,00"></label></div>
   <label>Mercado<select id="f-market">${opts(S.markets, l?.marketId ?? S.cfg.marketId)}</select></label>
   <label>Espaço / categoria<select id="f-space">${opts(S.spaces, it?.spaceId ?? defSpace('despensa'))}</select></label>
   <label>Cada unidade comprada contém<div class="grid2"><input id="f-pack" inputmode="decimal" value="${money(pack.qty)}"><select id="f-unit">${unitOpts(pack.unit)}</select></div></label>
   <p class="mut" id="f-hint">${statLine(it?.id)}</p>
   <button class="btn ghost" data-act="webPrice" style="width:100%">🔎 Ver preço online</button>
   <div class="btns"><button class="btn pri" data-act="saveLine">Salvar</button>${l ? '<button class="btn bad" data-act="delLine">Remover</button>' : ''}</div>`);
}
function prefillFromName() {
  if (UI.edit?.id) return;
  const it = findItem($('#f-name').value); if (!it) return;
  const b = bestUnit(it.pack, it.unit);
  $('#f-space').value = it.spaceId; $('#f-pack').value = money(b.qty); $('#f-unit').value = b.unit;
  const p = lastPrice(S.prices, it.id, $('#f-market').value) || lastPrice(S.prices, it.id);
  if (p && !num($('#f-price').value)) $('#f-price').value = money(p);
  $('#f-hint').textContent = statLine(it.id);
}
// Mudar a unidade de um item já usado na despensa/receitas quebraria as contas: bloqueia.
const unitLocked = id => S.pantry.some(p => p.itemId === id) || S.recipes.some(r => r.ingredients.some(g => g.itemId === id));
function ensureItem(name, baseUnit, spaceId) {
  let it = findItem(name);
  if (!it) return { id: uid(), name: cap(name.trim()), spaceId, unit: baseUnit, pack: baseUnit === 'un' ? 1 : 1000 };
  if (it.unit !== baseUnit) {
    if (unitLocked(it.id)) throw new Error(`"${it.name}" é medido em ${it.unit}. Use a mesma unidade (g/kg, ml/L ou un).`);
    return { ...it, unit: baseUnit, pack: baseUnit === 'un' ? 1 : 1000 };
  }
  return it;
}
async function saveLine() {
  const name = $('#f-name').value.trim(); if (!name) return toast('Digite o nome do item');
  const qty = Math.max(1, Math.round(num($('#f-qty').value)) || 1), price = r2(num($('#f-price').value));
  const marketId = $('#f-market').value, spaceId = $('#f-space').value;
  const b = toBase(num($('#f-pack').value) > 0 ? num($('#f-pack').value) : 1, $('#f-unit').value);
  let it = findItem(name);
  if (it && it.unit !== b.unit && unitLocked(it.id)) throw new Error(`"${it.name}" já está na despensa/receitas em ${it.unit}. Mantenha a mesma unidade.`);
  it = { ...(it || { id: uid(), name: cap(name) }), spaceId, unit: b.unit, pack: b.qty };
  const ops = [{ store: 'items', put: it }];
  const cur = UI.edit?.id && byId(S.list, UI.edit.id);
  if (cur) ops.push({ store: 'list', put: { ...cur, itemId: it.id, qty, price, marketId } });
  else {
    const same = S.list.find(l => l.itemId === it.id && l.marketId === marketId && !l.checked);
    ops.push({ store: 'list', put: same ? { ...same, qty: same.qty + qty, price: price || same.price } : { id: uid(), itemId: it.id, qty, price, marketId, checked: false } });
  }
  await DB.batch(ops); closeSheet(); await refresh();
}
async function finishOk() {
  const lines = S.list.filter(l => l.checked); if (!lines.length) return closeSheet();
  const pm = pantryMap(), ops = [], date = today(), touched = new Set();
  let total = 0, count = 0;
  for (const l of lines) {
    const it = item(l.itemId); pm[l.itemId] = r3((pm[l.itemId] || 0) + l.qty * (it?.pack || 1)); touched.add(l.itemId);
    total += l.qty * l.price; count += l.qty;
    if (l.price > 0) ops.push({ store: 'prices', put: { id: uid(), itemId: l.itemId, marketId: l.marketId, price: l.price, date } });
    ops.push({ store: 'list', del: l.id });
  }
  touched.forEach(id => ops.push({ store: 'pantry', put: { id, itemId: id, qty: pm[id] } }));
  ops.push({ store: 'purchases', put: { id: uid(), date, marketId: S.cfg.marketId, total: r2(total), count } });
  await DB.batch(ops); closeSheet(); await refresh(); toast('Compra finalizada — itens na despensa ✔');
}

// ---------- VOZ ----------
function voiceSheet() {
  UI.voice = [];
  openSheet(`<h3>Ditar itens</h3><p class="mut">Ex.: "2 arroz 25 reais, 3 leite, remover feijão". Confira o texto antes de confirmar.</p>
   <textarea id="v-text" placeholder="Fale ou digite aqui…"></textarea>
   <button class="btn ghost" id="mic" data-act="micStart" style="width:100%;margin-top:8px">🎤 Falar</button>
   <div id="v-prev"></div><div class="btns"><button class="btn pri" data-act="voiceApply">Confirmar</button></div>`);
  $('#v-text').addEventListener('input', previewVoice);
}
function previewVoice() {
  UI.voice = parseVoice($('#v-text').value).map(r => ({ ...r, skip: false }));
  $('#v-prev').innerHTML = UI.voice.map((r, i) => `<label class="row" style="margin-top:8px;color:var(--tx);font-size:16px"><input type="checkbox" checked data-chg="vSkip" data-i="${i}" style="width:28px;min-height:28px;margin:0">
   <span class="main">${r.acao === 'remover' ? '🗑 Remover' : '＋'} ${r.acao === 'add' ? r.qty + ' × ' : ''}<b style="display:inline">${esc(r.name)}</b>${r.price ? ' · ' + brl(r.price) : ''}</span></label>`).join('')
    || '<p class="mut">Nada reconhecido ainda.</p>';
}
function micStart() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Ditado indisponível neste navegador — digite no campo');
  const r = new SR(); r.lang = 'pt-BR'; r.interimResults = false; r.maxAlternatives = 1;
  r.onresult = e => { const ta = $('#v-text'); ta.value = (ta.value ? ta.value + ', ' : '') + e.results[0][0].transcript; previewVoice(); };
  r.onerror = e => toast(e.error === 'network' ? 'Ditado precisa de internet — digite no campo' : e.error === 'not-allowed' ? 'Permita o microfone no navegador' : 'Não entendi, tente de novo');
  r.onend = () => { const b = $('#mic'); if (b) b.textContent = '🎤 Falar'; };
  $('#mic').textContent = '🎤 Ouvindo…'; r.start();
}
async function voiceApply() {
  const rows = UI.voice.filter(r => !r.skip); if (!rows.length) return toast('Nada para confirmar');
  const ops = [], lines = S.list.map(l => ({ ...l })), newItems = {};
  let added = 0, removed = 0;
  for (const r of rows) {
    const known = findItem(r.name) || newItems[key(r.name)];
    if (r.acao === 'remover') {
      for (const l of lines.filter(l => !l.gone && known && l.itemId === known.id)) { l.gone = true; removed++; }
      continue;
    }
    const it = known || (newItems[key(r.name)] = { id: uid(), name: r.name, spaceId: defSpace('outros'), unit: 'un', pack: 1 });
    if (!known) ops.push({ store: 'items', put: it });
    const price = r.price || lastPrice(S.prices, it.id, S.cfg.marketId) || lastPrice(S.prices, it.id);
    const same = lines.find(l => !l.gone && l.itemId === it.id && l.marketId === S.cfg.marketId && !l.checked);
    if (same) { same.qty += r.qty; if (r.price) same.price = r.price; same.dirty = true; }
    else lines.push({ id: uid(), itemId: it.id, qty: r.qty, price, marketId: S.cfg.marketId, checked: false, dirty: true });
    added++;
  }
  lines.forEach(l => { if (l.gone) ops.push({ store: 'list', del: l.id }); else if (l.dirty) { const { dirty, ...x } = l; ops.push({ store: 'list', put: x }); } });
  await DB.batch(ops); closeSheet(); await refresh();
  toast(`${added ? added + ' adicionado(s)' : ''}${added && removed ? ' · ' : ''}${removed ? removed + ' removido(s)' : ''}`.trim() || 'Nada alterado');
}

// ---------- DESPENSA ----------
function pantryView() {
  const res = planCheck(S.plan, S.recipes, pantryMap()).reserved;
  const rows = S.pantry.map(p => ({ p, it: item(p.itemId) })).filter(x => x.it);
  const html = S.spaces.map(sp => ({ sp, rows: rows.filter(x => x.it.spaceId === sp.id).sort((a, b) => a.it.name.localeCompare(b.it.name, 'pt-BR')) })).filter(g => g.rows.length)
    .map(g => `<section><h4>${esc(g.sp.name)}<small>${g.rows.length} itens</small></h4>${g.rows.map(({ p, it }) =>
      `<div class="row" data-act="pantryEdit" data-id="${p.itemId}"><div class="main"><b>${esc(it.name)}</b>${res[p.itemId] ? `<small>reservado p/ receitas: ${fmtQty(res[p.itemId], it.unit)}</small>` : ''}</div><div class="qty">${fmtQty(p.qty, it.unit)}</div></div>`).join('')}</section>`).join('');
  return html || `<p class="empty">Despensa vazia.<br>Itens entram aqui quando você finaliza uma compra — ou toque em <b>＋ Adicionar</b> para lançar o que já tem em casa.</p>`;
}
function pantrySheet(itemId) {
  const it = item(itemId), p = it && S.pantry.find(x => x.itemId === itemId), b = bestUnit(p?.qty ?? 0, it?.unit ?? 'un');
  UI.edit = { id: itemId || null };
  openSheet(`<h3>${it ? 'Ajustar estoque' : 'Adicionar à despensa'}</h3>
   <label>Item<input id="p-name" list="dl-items" value="${esc(it?.name ?? '')}" ${it ? 'readonly' : ''} autocomplete="off"></label>
   <datalist id="dl-items">${S.items.map(i => `<option value="${esc(i.name)}">`).join('')}</datalist>
   <label>Quantidade em estoque (total)<div class="grid2"><input id="p-qty" inputmode="decimal" value="${money(b.qty || '')}"><select id="p-unit">${unitOpts(b.unit)}</select></div></label>
   <label>Espaço<select id="p-space">${opts(S.spaces, it?.spaceId ?? defSpace('despensa'))}</select></label>
   <div class="btns"><button class="btn pri" data-act="pantrySave">Salvar</button>${p ? '<button class="btn bad" data-act="pantryDel">Zerar</button>' : ''}</div>`);
}
async function pantrySave() {
  const name = $('#p-name').value.trim(); if (!name) return toast('Digite o nome do item');
  const q = num($('#p-qty').value); if (q < 0) return toast('Quantidade não pode ser negativa');
  const b = toBase(q, $('#p-unit').value), it = { ...ensureItem(name, b.unit, $('#p-space').value), spaceId: $('#p-space').value };
  await DB.batch([{ store: 'items', put: it }, b.qty > 0 ? { store: 'pantry', put: { id: it.id, itemId: it.id, qty: b.qty } } : { store: 'pantry', del: it.id }]);
  closeSheet(); await refresh();
}

// ---------- RECEITAS ----------
function recipesView() {
  const pm = pantryMap();
  return S.recipes.map(r => {
    const c = planCheck([{ id: 'x', date: '0', recipeId: r.id, portions: r.servings, status: 'planned' }], S.recipes, pm).plans.x;
    return `<div class="row" data-act="recipeEdit" data-id="${r.id}"><div class="main"><b>${esc(r.name)}</b><small>rende ${r.servings} · ${r.ingredients.length} ingredientes</small>
     <small style="color:${c.ok ? '#7ddc82' : 'var(--hl)'}">${c.ok ? '✔ tem tudo na despensa' : 'faltam ' + c.missing.length + ' ingrediente(s)'}</small></div>
     <button class="btn sm" data-act="schedule" data-id="${r.id}">Agendar</button></div>`;
  }).join('') || `<p class="empty">Nenhuma receita ainda.<br>Cadastre uma e agende no calendário: a despensa é conferida e abatida sozinha.</p>`;
}
const ingRow = g => {
  const it = g.itemId && item(g.itemId), b = bestUnit(g.qty || 0, it?.unit ?? 'g');
  return `<div class="ing"><input class="i-name" list="dl-items" placeholder="Ingrediente" value="${esc(it?.name ?? '')}" autocomplete="off">
   <input class="i-qty" inputmode="decimal" placeholder="Qtd" value="${g.qty ? money(b.qty) : ''}"><select class="i-unit">${unitOpts(b.unit)}</select><button class="sq" data-act="rmIng" aria-label="Remover ingrediente">×</button></div>`;
};
function recipeSheet(id) {
  const r = id && recipe(id); UI.edit = { id: id || null };
  openSheet(`<h3>${r ? 'Editar receita' : 'Nova receita'}</h3>
   <label>Nome<input id="r-name" value="${esc(r?.name ?? '')}"></label><label>Rende (porções)<input id="r-serv" inputmode="numeric" value="${r?.servings ?? 2}"></label>
   <datalist id="dl-items">${S.items.map(i => `<option value="${esc(i.name)}">`).join('')}</datalist>
   <label>Ingredientes (para o total de porções acima)</label><div id="ings">${(r?.ingredients.length ? r.ingredients : [{}]).map(ingRow).join('')}</div>
   <button class="btn ghost" data-act="addIng" style="width:100%;margin-top:8px">＋ ingrediente</button>
   <div class="btns"><button class="btn pri" data-act="recipeSave">Salvar</button>${r ? '<button class="btn" data-act="schedule" data-id="' + r.id + '">Agendar</button><button class="btn bad" data-act="recipeDel">Excluir</button>' : ''}</div>`);
}
async function recipeSave() {
  const name = $('#r-name').value.trim(), servings = Math.max(1, Math.round(num($('#r-serv').value)) || 1);
  if (!name) return toast('Dê um nome à receita');
  const ops = [], ings = [], seen = {};
  for (const row of document.querySelectorAll('#ings .ing')) {
    const n = $('.i-name', row).value.trim(), q = num($('.i-qty', row).value); if (!n && !q) continue;
    if (!n || q <= 0) throw new Error('Cada ingrediente precisa de nome e quantidade');
    const b = toBase(q, $('.i-unit', row).value);
    const it = seen[key(n)] || ensureItem(n, b.unit, defSpace('despensa'));   // lança erro se a unidade conflita com a despensa/receitas
    seen[key(n)] = it; ops.push({ store: 'items', put: it });
    ings.push({ itemId: it.id, qty: b.qty });
  }
  if (!ings.length) throw new Error('Adicione pelo menos um ingrediente');
  ops.push({ store: 'recipes', put: { id: UI.edit?.id || uid(), name, servings, ingredients: ings } });
  await DB.batch(ops); closeSheet(); await refresh();
}
function scheduleSheet(recipeId, date) {
  if (!S.recipes.length) return toast('Cadastre uma receita primeiro');
  const r = recipe(recipeId) || S.recipes[0];
  openSheet(`<h3>Agendar receita</h3><label>Receita<select id="s-rec" data-chg="sRec">${opts(S.recipes, r.id)}</select></label>
   <label>Dia<input type="date" id="s-date" value="${date || UI.day}"></label><label>Porções<input id="s-por" inputmode="numeric" value="${r.servings}"></label>
   <div class="btns"><button class="btn pri" data-act="scheduleSave">Agendar</button></div>`);
}
async function scheduleSave() {
  const date = $('#s-date').value; if (!date) return toast('Escolha o dia');
  const r = recipe($('#s-rec').value), portions = Math.max(1, Math.round(num($('#s-por').value)) || r.servings);
  await DB.put('plan', { id: uid(), date, recipeId: r.id, portions, status: 'planned' });
  Object.assign(UI, { day: date, month: date.slice(0, 7), tab: 'agenda' }); closeSheet(); await refresh();
}

// ---------- AGENDA ----------
function agendaView() {
  const chk = planCheck(S.plan, S.recipes, pantryMap()).plans;
  const [y, m] = UI.month.split('-').map(Number), off = new Date(y, m - 1, 1).getDay(), nd = new Date(y, m, 0).getDate();
  const title = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  let cells = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<div class="h">${d}</div>`).join('') + '<span></span>'.repeat(off);
  for (let d = 1; d <= nd; d++) {
    const ds = `${UI.month}-${String(d).padStart(2, '0')}`, es = S.plan.filter(p => p.date === ds);
    const st = !es.length ? '' : es.some(p => p.status === 'planned' && !chk[p.id]?.ok) ? 'miss' : es.some(p => p.status === 'planned') ? 'ok' : 'done';
    cells += `<button data-act="day" data-d="${ds}" class="${ds === UI.day ? 'sel' : ''} ${ds === today() ? 'today' : ''}">${d}${st ? `<i class="${st}"></i>` : ''}</button>`;
  }
  const es = S.plan.filter(p => p.date === UI.day).map(p => {
    const r = recipe(p.recipeId), c = chk[p.id];
    const status = p.status === 'done' ? '<div class="okt">✔ feita — ingredientes abatidos</div>'
      : c.ok ? '<div class="okt">✔ tudo na despensa</div>'
      : `<div class="miss">Faltam: ${c.missing.map(g => `${fmtQty(g.missing, item(g.itemId)?.unit)} ${esc(item(g.itemId)?.name)}`).join(', ')}</div>`;
    const btns = p.status === 'done' ? `<button class="btn sm" data-act="planUndo" data-id="${p.id}">Desfazer</button>`
      : `<button class="btn sm ok" data-act="planDone" data-id="${p.id}">Fiz (abater)</button>${c.ok ? '' : `<button class="btn sm pri" data-act="planMissing" data-id="${p.id}">Faltantes → lista</button>`}<button class="btn sm" data-act="planDel" data-id="${p.id}">🗑</button>`;
    return `<div class="card"><b>${esc(r?.name ?? '(receita removida)')}</b> <small class="mut">${p.portions} porções</small>${status}<div class="btns" style="margin-top:6px">${btns}</div></div>`;
  }).join('');
  const any = S.plan.some(p => p.status === 'planned' && !chk[p.id]?.ok);
  return `<div class="monthbar"><button class="sq" data-act="month" data-n="-1">‹</button><span>${title}</span><button class="sq" data-act="month" data-n="1">›</button></div><div class="cal">${cells}</div>
   <button class="btn pri" data-act="addPlanDay" style="width:100%">＋ Agendar receita em ${UI.day.split('-').reverse().slice(0, 2).join('/')}</button>
   <h4>Neste dia</h4>${es || '<p class="mut">Nada agendado.</p>'}
   ${any ? '<button class="btn" data-act="allMissing" style="width:100%;margin-top:8px">🛒 Enviar TODOS os faltantes da agenda → lista</button>' : ''}`;
}
async function missingToList(map) {
  const ops = []; let n = 0;
  for (const [itemId, miss] of Object.entries(map)) {
    const it = item(itemId); if (!it) continue;
    const have = S.list.filter(l => l.itemId === itemId).reduce((a, l) => a + l.qty, 0);   // já na lista (marcado ou não) conta como coberto
    const add = packsNeeded(miss, it.pack) - have; if (add <= 0) continue;
    const line = S.list.find(l => l.itemId === itemId && !l.checked);
    ops.push({ store: 'list', put: line ? { ...line, qty: line.qty + add } : { id: uid(), itemId, qty: add, price: lastPrice(S.prices, itemId, S.cfg.marketId) || 0, marketId: S.cfg.marketId, checked: false } });
    n++;
  }
  await DB.batch(ops); await refresh();
  toast(n ? `${n} item(ns) enviados para a lista` : 'Nada novo: os faltantes já estão na lista');
}
async function planDone(id) {
  const p = byId(S.plan, id), r = p && recipe(p.recipeId); if (!r) throw new Error('Receita não encontrada');
  const before = pantryMap(), res = consumeRecipe(r, p.portions, before), ops = [];
  for (const g of r.ingredients) { const q = res.pantry[g.itemId]; ops.push(q > 1e-6 ? { store: 'pantry', put: { id: g.itemId, itemId: g.itemId, qty: q } } : { store: 'pantry', del: g.itemId }); }
  ops.push({ store: 'plan', put: { ...p, status: 'done', consumed: res.consumed } });
  await DB.batch(ops); await refresh();
  toast(res.short.length ? `Despensa zerada: faltou ${res.short.map(s => fmtQty(s.missing, item(s.itemId).unit) + ' ' + item(s.itemId).name).join(', ')}` : 'Ingredientes abatidos da despensa ✔');
}
async function planUndo(id) {
  const p = byId(S.plan, id), pm = pantryMap(), ops = [];
  for (const c of p.consumed || []) ops.push({ store: 'pantry', put: { id: c.itemId, itemId: c.itemId, qty: r3((pm[c.itemId] || 0) + c.qty) } });
  const { consumed, ...rest } = p; ops.push({ store: 'plan', put: { ...rest, status: 'planned' } });
  await DB.batch(ops); await refresh(); toast('Desfeito: ingredientes devolvidos à despensa');
}

// ---------- AJUSTES ----------
function settingsView() {
  return `<h4>Mercados</h4>${S.markets.map(m => `<div class="row"><input class="grow" value="${esc(m.name)}" data-chg="mkName" data-id="${m.id}"><button class="sq" data-act="mkDel" data-id="${m.id}" aria-label="Excluir">🗑</button></div>`).join('')}
   <div class="row"><input class="grow" id="new-mk" placeholder="Novo mercado"><button class="sq" data-act="mkAdd" aria-label="Adicionar">＋</button></div>
   <h4>Espaços / categorias <small>limite de itens por compra (vazio = sem limite)</small></h4>
   ${S.spaces.map(s => `<div class="row"><input class="grow" value="${esc(s.name)}" data-chg="spName" data-id="${s.id}"><input class="sm" inputmode="numeric" placeholder="limite" value="${s.limit || ''}" data-chg="spLimit" data-id="${s.id}"><button class="sq" data-act="spDel" data-id="${s.id}" aria-label="Excluir">🗑</button></div>`).join('')}
   <div class="row"><input class="grow" id="new-sp" placeholder="Novo espaço (ex.: Cozinha)"><button class="sq" data-act="spAdd" aria-label="Adicionar">＋</button></div>
   <h4>Dados <small>ficam só neste aparelho</small></h4>
   <div class="btns"><button class="btn" data-act="export">⬇ Exportar backup</button><button class="btn" data-act="import">⬆ Importar backup</button></div>
   ${UI.install ? '<div class="btns"><button class="btn pri" data-act="install">📲 Instalar o app</button></div>' : '<p class="mut">Para instalar: menu do Chrome ⋮ → “Instalar app”.</p>'}`;
}
const VIEWS = { list: listView, pantry: pantryView, recipes: recipesView, agenda: agendaView, settings: settingsView };

// ---------- ações (delegação de cliques) ----------
const ACT = {
  tab: d => { UI.tab = d.t; render(); scrollTo(0, 0); },
  closeSheet,
  toggle: async d => { const l = byId(S.list, d.id); await DB.put('list', { ...l, checked: !l.checked }); await refresh(); },
  inc: d => step(d.id, 1), dec: d => step(d.id, -1),
  addLine: () => lineSheet(), editLine: d => lineSheet(d.id), saveLine, webPrice: () => {
    const n = $('#f-name').value.trim(); if (!n) return toast('Digite o nome do item');
    if (!navigator.onLine) return toast('Sem internet — usando só o histórico salvo');
    window.open('https://www.google.com/search?q=' + encodeURIComponent(`preço ${n} ${mkName($('#f-market').value)}`), '_blank');
  },
  delLine: async () => { await DB.del('list', UI.edit.id); closeSheet(); await refresh(); },
  finish: () => {
    const ls = S.list.filter(l => l.checked), tot = ls.reduce((a, l) => a + l.qty * l.price, 0), semPreco = ls.filter(l => !(l.price > 0)).length;
    openSheet(`<h3>Finalizar compra</h3><p>${ls.reduce((a, l) => a + l.qty, 0)} itens · <b>${brl(tot)}</b></p><p class="mut">Os itens marcados vão para a despensa e os preços entram no histórico. O que não foi marcado continua na lista.${semPreco ? `<br>⚠ ${semPreco} item(ns) sem preço (não entram no histórico).` : ''}</p>
     <div class="btns"><button class="btn ok" data-act="finishOk">Confirmar</button><button class="btn" data-act="closeSheet">Voltar</button></div>`);
  },
  finishOk,
  voice: voiceSheet, micStart, voiceApply,
  pantryAdd: () => pantrySheet(), pantryEdit: d => pantrySheet(d.id), pantrySave,
  pantryDel: async () => { await DB.del('pantry', UI.edit.id); closeSheet(); await refresh(); },
  recipeAdd: () => recipeSheet(), recipeEdit: d => recipeSheet(d.id), recipeSave,
  recipeDel: async () => {
    if (!confirm('Excluir esta receita e seus agendamentos pendentes?')) return;
    const id = UI.edit.id, ops = [{ store: 'recipes', del: id }, ...S.plan.filter(p => p.recipeId === id && p.status === 'planned').map(p => ({ store: 'plan', del: p.id }))];
    await DB.batch(ops); closeSheet(); await refresh();
  },
  addIng: () => $('#ings').insertAdjacentHTML('beforeend', ingRow({})),
  rmIng: (d, el) => { const rows = document.querySelectorAll('#ings .ing'); if (rows.length > 1) el.closest('.ing').remove(); else el.closest('.ing').querySelectorAll('input').forEach(i => (i.value = '')); },
  schedule: d => { closeSheet(); scheduleSheet(d.id); },
  scheduleSave,
  day: d => { UI.day = d.d; renderView(); },
  month: d => { const [y, m] = UI.month.split('-').map(Number), n = new Date(y, m - 1 + Number(d.n), 1); UI.month = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`; renderView(); },
  addPlanDay: () => scheduleSheet(null, UI.day),
  planDone: d => planDone(d.id), planUndo: d => planUndo(d.id),
  planDel: async d => { await DB.del('plan', d.id); await refresh(); },
  planMissing: d => missingToList(Object.fromEntries(planCheck(S.plan, S.recipes, pantryMap()).plans[d.id].missing.map(g => [g.itemId, g.missing]))),
  allMissing: () => {
    const agg = {}; Object.values(planCheck(S.plan, S.recipes, pantryMap()).plans).forEach(c => c.missing.forEach(g => (agg[g.itemId] = r3((agg[g.itemId] || 0) + g.missing))));
    return missingToList(agg);
  },
  mkAdd: async () => { const n = $('#new-mk').value.trim(); if (!n) return; await DB.put('markets', { id: uid(), name: n, ord: Date.now() }); await refresh(); },
  mkDel: async d => {
    if (S.markets.length < 2) return toast('Mantenha pelo menos um mercado');
    if (!confirm('Excluir este mercado? Os itens dele na lista passam para outro mercado.')) return;
    const to = S.markets.find(m => m.id !== d.id).id, ops = [{ store: 'markets', del: d.id }, ...S.list.filter(l => l.marketId === d.id).map(l => ({ store: 'list', put: { ...l, marketId: to } }))];
    if (S.cfg.marketId === d.id) { S.cfg.marketId = to; ops.push({ store: 'kv', put: S.cfg }); }
    await DB.batch(ops); await refresh();
  },
  spAdd: async () => { const n = $('#new-sp').value.trim(); if (!n) return; await DB.put('spaces', { id: uid(), name: n, limit: 0, ord: Date.now() }); await refresh(); },
  spDel: async d => {
    if (S.spaces.length < 2) return toast('Mantenha pelo menos um espaço');
    if (!confirm('Excluir este espaço? Os itens dele passam para outro espaço.')) return;
    const to = S.spaces.find(s => s.id !== d.id).id;
    await DB.batch([{ store: 'spaces', del: d.id }, ...S.items.filter(i => i.spaceId === d.id).map(i => ({ store: 'items', put: { ...i, spaceId: to } }))]); await refresh();
  },
  export: async () => {
    const blob = new Blob([JSON.stringify(await DB.dump())], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `dispensa-compra-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
  import: () => $('#imp').click(),
  install: async () => { if (!UI.install) return; UI.install.prompt(); await UI.install.userChoice; UI.install = null; renderView(); },
};
async function step(id, dlt) { const l = byId(S.list, id); await DB.put('list', { ...l, qty: Math.max(1, l.qty + dlt) }); await refresh(); }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || !ACT[el.dataset.act]) return;
  run(() => ACT[el.dataset.act](el.dataset, el));
});
document.addEventListener('change', e => {
  const el = e.target, k = el.dataset.chg; if (!k) return;
  run(async () => {
    if (k.startsWith('cfg:')) {
      const f = k.slice(4); let v = el.value;
      if (f !== 'marketId') { v = f === 'budget' ? r2(num(v)) : Math.round(num(v)); v = Math.max(f === 'days' || f === 'people' ? 1 : 0, v); }
      await saveCfg({ [f]: v }); renderView();
    } else if (k === 'mkName') { const m = byId(S.markets, el.dataset.id); if (el.value.trim()) { m.name = el.value.trim(); await DB.put('markets', m); } else el.value = m.name; }
    else if (k === 'spName' || k === 'spLimit') {
      const s = byId(S.spaces, el.dataset.id);
      if (k === 'spName') { if (el.value.trim()) s.name = el.value.trim(); else el.value = s.name; } else s.limit = Math.max(0, Math.round(num(el.value)));
      await DB.put('spaces', s);
    } else if (k === 'fName') prefillFromName();
    else if (k === 'sRec') $('#s-por').value = recipe(el.value).servings;
    else if (k === 'vSkip') UI.voice[Number(el.dataset.i)].skip = !el.checked;
    else if (k === 'importFile') {
      const f = el.files[0]; el.value = ''; if (!f) return;
      const data = JSON.parse(await f.text());
      if (!confirm('Importar substitui TODOS os dados atuais deste aparelho. Continuar?')) return;
      await DB.restore(data); await refresh(); toast('Backup importado ✔');
    }
  });
});

// ---------- inicialização ----------
function net() { const n = $('#net'); n.textContent = navigator.onLine ? '● online' : '● offline'; n.classList.toggle('off', !navigator.onLine); }
addEventListener('online', net); addEventListener('offline', net);
addEventListener('beforeinstallprompt', e => { e.preventDefault(); UI.install = e; if (UI.tab === 'settings') renderView(); });
(async function init() {
  net();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.storage?.persist?.();          // pede ao Android para não apagar os dados locais
  await load(); await seed(); await load(); render();
})().catch(e => { document.body.insertAdjacentHTML('beforeend', `<p style="padding:16px">Erro ao iniciar: ${esc(e.message)}</p>`); });
