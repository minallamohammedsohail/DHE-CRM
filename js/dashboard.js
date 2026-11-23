// Dashboard. Every widget loads on its own: if one query fails that widget
// shows "—" and the rest still render. All "this month", "today" and "overdue"
// boundaries are in Asia/Kolkata. Counts exclude archived leads.

import {
  supabase, requireAuth, renderNav, handleError, toast, el,
  LEAD_STATUSES, normalizePhone, formatMoney, formatDay, formatDate, formatPhone,
  addMoney, balanceBadge, dayRangeIST, monthBoundsIST,
} from './app.js';

const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat('en-IN');

// Statuses that count as "active": still in play, not finished.
const ACTIVE_STATUSES = ['New', 'Contacted', 'Interested', 'Site Visit', 'Negotiation'];
const PAGE = 1000; // PostgREST returns at most 1000 rows per request

let refreshing = false;

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------
const TILES = [
  { key: 'newLeads',  label: 'New leads this month' },
  { key: 'active',    label: 'Active leads' },
  { key: 'today',     label: 'Follow-ups due today', href: 'followups.html?tab=today' },
  { key: 'overdue',   label: 'Overdue follow-ups',   href: 'followups.html?tab=overdue', alert: true },
  { key: 'converted', label: 'Leads converted this month' },
  { key: 'revenue',   label: 'Revenue this month' },
];
const tileParts = {};

function buildTiles() {
  const box = $('tiles');
  box.replaceChildren();
  for (const tile of TILES) {
    const node = el(tile.href ? 'a' : 'div', 'tile');
    if (tile.href) node.href = tile.href;
    const value = el('p', 'tile-value', '…');
    const note = el('p', 'tile-note', '');
    node.append(el('p', 'tile-label', tile.label), value, note);
    box.append(node);
    tileParts[tile.key] = { node, value, note, alert: tile.alert };
  }
}

function setTile(key, value, note = '') {
  const part = tileParts[key];
  part.value.textContent = typeof value === 'number' ? number.format(value) : value;
  part.note.textContent = note;
  if (part.alert) part.node.classList.toggle('tile-alert', typeof value === 'number' && value > 0);
}

function failTile(key) {
  setTile(key, '—', 'Could not load');
}

// ---------------------------------------------------------------------------
// Queries. Each throws on error; the caller isolates failures per widget.
// ---------------------------------------------------------------------------
async function count(query) {
  const { count: n, error } = await query;
  if (error) throw error;
  return n;
}

const leadsCount = () => supabase.from('leads').select('id', { count: 'exact', head: true }).is('archived_at', null);
const followupsCount = () => supabase.from('followups').select('id', { count: 'exact', head: true }).eq('status', 'Pending');

// Sum of total_amount for non-cancelled orders dated in the month, added in
// whole paise. Pages through the rows so it stays correct past 1000 orders.
async function monthRevenue(month) {
  let total = 0;
  let orders = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('orders').select('total_amount')
      .gte('order_date', month.firstDay).lt('order_date', month.nextFirstDay)
      .neq('status', 'Cancelled')
      .order('id').range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data) total = addMoney(total, row.total_amount);
    orders += data.length;
    if (data.length < PAGE) break;
  }
  return { total, orders };
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------
async function loadNewLeads(month) {
  setTile('newLeads', await count(leadsCount().gte('created_at', month.start).lt('created_at', month.end)));
}

async function loadConverted(month) {
  setTile('converted', await count(leadsCount().gte('converted_at', month.start).lt('converted_at', month.end)));
}

async function loadFollowups() {
  const { start, end } = dayRangeIST();
  const [today, overdue] = await Promise.all([
    count(followupsCount().gte('scheduled_at', start).lt('scheduled_at', end)),
    count(followupsCount().lt('scheduled_at', start)),
  ]);
  setTile('today', today);
  setTile('overdue', overdue);
}

async function loadRevenue(month) {
  const { total, orders } = await monthRevenue(month);
  setTile('revenue', formatMoney(total), `${number.format(orders)} order${orders === 1 ? '' : 's'}, not counting cancelled`);
}

// Pipeline: one count per status. "Active leads" is the sum of the active
// statuses, so the tile and the pipeline can never disagree.
async function loadPipeline() {
  const counts = await Promise.all(LEAD_STATUSES.map((status) => count(leadsCount().eq('status', status))));
  const byStatus = Object.fromEntries(LEAD_STATUSES.map((status, i) => [status, counts[i]]));
  setTile('active', ACTIVE_STATUSES.reduce((sum, status) => sum + byStatus[status], 0));

  const max = Math.max(...counts, 0);
  const rows = LEAD_STATUSES.map((status) => {
    const link = el('a', 'bar-row');
    link.href = `leads.html?status=${encodeURIComponent(status)}`;
    const fill = el('span', 'bar-fill');
    fill.style.width = max === 0 ? '0%' : `${(byStatus[status] / max) * 100}%`;
    const track = el('span', 'bar-track');
    track.append(fill);
    link.append(el('span', 'bar-label', status), track, el('span', 'bar-count', number.format(byStatus[status])));
    return link;
  });
  $('pipeline').replaceChildren(...rows);
}

function emptyNote(text) {
  return el('p', 'muted', text);
}

async function loadRecentLeads() {
  const { data, error } = await supabase.from('leads')
    .select('id, name, phone, status, source, created_at')
    .is('archived_at', null)
    .order('created_at', { ascending: false }).limit(5);
  if (error) throw error;
  if (data.length === 0) { $('recent-leads').replaceChildren(emptyNote('No leads yet.')); return; }

  const list = el('ul', 'mini-list');
  for (const lead of data) {
    const row = el('li');
    const link = el('a', 'mini-name', lead.name);
    link.href = `leads.html?q=${encodeURIComponent(normalizePhone(lead.phone))}`;
    row.append(link, el('span', 'badge', lead.status),
      el('span', 'muted', `${lead.source ?? 'No source'} · ${formatDate(lead.created_at)}`));
    list.append(row);
  }
  $('recent-leads').replaceChildren(list);
}

async function loadRecentOrders() {
  const { data, error } = await supabase.from('orders')
    .select('id, description, order_date, total_amount, balance, status, customer:customers(name, phone)')
    .order('order_date', { ascending: false }).order('created_at', { ascending: false }).limit(5);
  if (error) throw error;
  if (data.length === 0) { $('recent-orders').replaceChildren(emptyNote('No orders yet.')); return; }

  const list = el('ul', 'mini-list');
  for (const order of data) {
    const row = el('li');
    const link = el('a', 'mini-name', order.description || 'Order');
    link.href = order.customer ? `orders.html?q=${encodeURIComponent(normalizePhone(order.customer.phone))}` : 'orders.html';
    row.append(link, el('span', 'badge', order.status));
    row.append(el('span', 'muted', `${order.customer?.name ?? '—'} · ${formatDay(order.order_date)} · ${formatMoney(order.total_amount)}`));
    if (order.status !== 'Cancelled') row.append(balanceBadge(order.balance));
    list.append(row);
  }
  $('recent-orders').replaceChildren(list);
}

// ---------------------------------------------------------------------------
// Loading: every widget independently
// ---------------------------------------------------------------------------
function failSection(id) {
  $(id).replaceChildren(emptyNote('Could not load this section.'));
}

async function load() {
  const month = monthBoundsIST();
  $('month-label').textContent = `${month.label} · India time`;

  const jobs = [
    [() => loadNewLeads(month), () => failTile('newLeads')],
    [() => loadConverted(month), () => failTile('converted')],
    [loadFollowups, () => { failTile('today'); failTile('overdue'); }],
    [() => loadRevenue(month), () => failTile('revenue')],
    [loadPipeline, () => { failTile('active'); failSection('pipeline'); }],
    [loadRecentLeads, () => failSection('recent-leads')],
    [loadRecentOrders, () => failSection('recent-orders')],
  ];

  const results = await Promise.allSettled(jobs.map(([run]) => run()));
  let failures = 0;
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      failures += 1;
      console.error(result.reason);
      jobs[i][1]();
    }
  });

  if (failures) {
    toast(failures === jobs.length
      ? handleError(results[0].reason, { toast: false })
      : 'Some figures could not be loaded. Use Refresh to try again.', 'error');
  }
  $('updated').textContent = `Updated ${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date())}`;
}

async function refresh() {
  if (refreshing) return; // ignore repeated clicks
  refreshing = true;
  $('refresh-btn').disabled = true;
  $('refresh-btn').textContent = 'Refreshing…';
  try {
    buildTiles();
    await load();
  } finally {
    refreshing = false;
    $('refresh-btn').disabled = false;
    $('refresh-btn').textContent = 'Refresh';
  }
}

$('refresh-btn').addEventListener('click', refresh);

const user = await requireAuth();
if (user) {
  renderNav(user);
  await refresh();
}
