// Follow-ups page: Today / Overdue / Upcoming / Done lists, add, edit,
// complete, cancel and reopen. Day boundaries are calendar days in IST.

import {
  supabase, requireAuth, renderNav, handleError, toast, el,
  confirmAction, orNull, applySearch, tableCell,
  normalizePhone, formatPhone, telLink, whatsappLink,
  formatDateTime, dayRangeIST, toInputValueIST, fromInputValueIST, defaultFollowupInputValue,
} from './app.js';

const PAGE_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT = '*, lead:leads(id, name, phone, status, archived_at), customer:customers(id, name, phone)';

const EMPTY = {
  today: 'Nothing is due today.',
  overdue: 'No overdue follow-ups.',
  upcoming: 'No upcoming follow-ups.',
  done: 'No completed or cancelled follow-ups yet.',
};

const $ = (id) => document.getElementById(id);
const dialog = $('followup-dialog');
const form = $('followup-form');
const formError = $('followup-error');
const saveBtn = $('followup-save');

let tab = 'today';
let editing = null;   // the follow-up being edited, or null when adding
let chosen = null;    // { kind: 'lead' | 'customer', id, name, phone } for the form
let saving = false;   // double-submission guard
let loadToken = 0;    // ignores out-of-date responses
let pickToken = 0;

// ---------------------------------------------------------------------------
// Which tab does a follow-up belong to?
// ---------------------------------------------------------------------------
function tabFor(scheduledAt) {
  const { start, end } = dayRangeIST();
  if (scheduledAt < start) return 'overdue';
  if (scheduledAt < end) return 'today';
  return 'upcoming';
}

function applyTab(query, name) {
  const { start, end } = dayRangeIST();
  switch (name) {
    case 'overdue':
      return query.eq('status', 'Pending').lt('scheduled_at', start).order('scheduled_at', { ascending: true });
    case 'today':
      return query.eq('status', 'Pending').gte('scheduled_at', start).lt('scheduled_at', end)
        .order('scheduled_at', { ascending: true });
    case 'upcoming':
      return query.eq('status', 'Pending').gte('scheduled_at', end).order('scheduled_at', { ascending: true });
    default:
      return query.neq('status', 'Pending').order('scheduled_at', { ascending: false });
  }
}

async function loadCounts() {
  const { start, end } = dayRangeIST();
  const base = () => supabase.from('followups').select('id', { count: 'exact', head: true });
  const results = await Promise.all([
    base().eq('status', 'Pending').gte('scheduled_at', start).lt('scheduled_at', end),
    base().eq('status', 'Pending').lt('scheduled_at', start),
    base().eq('status', 'Pending').gte('scheduled_at', end),
    base().neq('status', 'Pending'),
  ]);
  for (const result of results) if (result.error) throw result.error;
  const [today, overdue, upcoming, done] = results.map((r) => r.count);
  $('n-today').textContent = today;
  $('n-overdue').textContent = overdue;
  $('n-upcoming').textContent = upcoming;
  $('n-done').textContent = done;
  $('n-overdue').classList.toggle('tab-count-alert', overdue > 0);
}

function markActiveTab() {
  for (const button of document.querySelectorAll('.tab')) {
    button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
  }
}

// ---------------------------------------------------------------------------
// Loading and rendering
// ---------------------------------------------------------------------------
async function load() {
  const token = ++loadToken;
  markActiveTab();
  $('loading').hidden = false;
  $('empty').hidden = true;
  $('table-wrap').hidden = true;
  $('limit-note').hidden = true;

  try {
    const query = applyTab(supabase.from('followups').select(SELECT, { count: 'exact' }), tab);
    const [list] = await Promise.all([query.limit(PAGE_LIMIT), loadCounts()]);
    if (list.error) throw list.error;
    if (token !== loadToken) return;
    render(list.data, list.count);
  } catch (error) {
    if (token !== loadToken) return;
    handleError(error);
    $('loading').hidden = true;
    showEmpty('Could not load follow-ups. Check your connection and try again.');
  }
}

function showEmpty(message) {
  const box = $('empty');
  box.textContent = message;
  box.hidden = false;
  $('table-wrap').hidden = true;
  $('rows').replaceChildren();
}

function render(items, count) {
  $('loading').hidden = true;
  $('limit-note').hidden = count <= PAGE_LIMIT;
  if (items.length === 0) {
    showEmpty(EMPTY[tab]);
    return;
  }
  $('empty').hidden = true;
  $('table-wrap').hidden = false;
  $('rows').replaceChildren(...items.map(renderRow));
}

// The person to contact: the customer if there is one, otherwise the lead.
function parentOf(item) {
  if (item.customer) {
    const phone = normalizePhone(item.customer.phone);
    return { kind: 'Customer', name: item.customer.name, phone: item.customer.phone,
             tag: '', href: `customers.html?q=${encodeURIComponent(phone)}` };
  }
  if (item.lead) {
    const lead = item.lead;
    const archived = Boolean(lead.archived_at);
    const phone = normalizePhone(lead.phone);
    return { kind: 'Lead', name: lead.name, phone: lead.phone,
             tag: archived ? 'Archived' : lead.status === 'Converted' ? 'Converted' : '',
             href: `leads.html?q=${encodeURIComponent(phone)}${archived ? '&view=archived' : ''}` };
  }
  return null;
}

function daysLate(scheduledAt) {
  const { start } = dayRangeIST();
  return Math.ceil((new Date(start) - new Date(scheduledAt)) / 86400000);
}

function renderRow(item) {
  const tr = el('tr');
  const parent = parentOf(item);

  // Due
  const due = el('span', null, formatDateTime(item.scheduled_at));
  const dueCell = tableCell('Due', due, 'cell-due');
  if (item.status === 'Pending' && tab === 'overdue') {
    const days = daysLate(item.scheduled_at);
    dueCell.append(el('span', 'badge badge-late', `${days} day${days === 1 ? '' : 's'} late`));
  }

  // For
  let forCell;
  if (parent) {
    const link = el('a', 'link-btn', parent.name);
    link.href = parent.href;
    const box = document.createDocumentFragment();
    box.append(link, el('span', 'badge', parent.kind));
    if (parent.tag) box.append(el('span', 'badge badge-archived', parent.tag));
    forCell = tableCell('For', box, 'cell-name');
  } else {
    forCell = tableCell('For', '—', 'cell-name');
  }

  // Phone + contact links
  const phoneBox = document.createDocumentFragment();
  if (parent) {
    phoneBox.append(el('span', null, formatPhone(parent.phone)));
    const tel = telLink(parent.phone);
    const wa = whatsappLink(parent.phone);
    const links = el('span', 'contact-links');
    if (tel) { const a = el('a', 'action-link', 'Call'); a.href = tel; links.append(a); }
    if (wa) {
      const a = el('a', 'action-link', 'WhatsApp');
      a.href = wa; a.target = '_blank'; a.rel = 'noopener noreferrer';
      links.append(a);
    }
    phoneBox.append(links);
  }

  tr.append(
    dueCell,
    forCell,
    tableCell('Phone', phoneBox, 'cell-phone'),
    tableCell('Note', item.note, 'cell-note'),
    tableCell('Status', el('span', 'badge', item.status)),
    tableCell('Actions', actionButtons(item), 'cell-actions'),
  );
  return tr;
}

function actionButtons(item) {
  const box = document.createDocumentFragment();
  const add = (label, handler, className = 'action-link') => {
    const button = el('button', `${className} action-btn`, label);
    button.type = 'button';
    button.addEventListener('click', () => handler(button));
    box.append(button);
  };
  if (item.status === 'Pending') {
    add('Complete', (b) => changeStatus(item, b, { status: 'Completed', completed_at: new Date().toISOString() }, 'Follow-up completed.'));
    add('Edit', () => openForm(item));
    add('Cancel', (b) => cancelFollowup(item, b));
  } else {
    add('Reopen', (b) => changeStatus(item, b, { status: 'Pending', completed_at: null }, 'Follow-up reopened.'));
  }
  return box;
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------
// Updates one follow-up and checks a row was really changed.
async function updateFollowup(id, changes) {
  const { data, error } = await supabase.from('followups').update(changes).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length !== 1) throw new Error('Follow-up was not updated');
}

async function changeStatus(item, button, changes, message) {
  button.disabled = true;
  try {
    await updateFollowup(item.id, changes);
    toast(message, 'success');
    await load();
  } catch (error) {
    handleError(error);
    button.disabled = false;
  }
}

async function cancelFollowup(item, button) {
  const parent = parentOf(item);
  const ok = await confirmAction(
    'Cancel this follow-up?',
    `The follow-up${parent ? ` for “${parent.name}”` : ''} due ${formatDateTime(item.scheduled_at)} will be cancelled. You can reopen it from the Done tab.`,
    'Cancel follow-up', true);
  if (!ok) return;
  await changeStatus(item, button, { status: 'Cancelled', completed_at: null }, 'Follow-up cancelled.');
}

// ---------------------------------------------------------------------------
// Add / edit form and the person picker
// ---------------------------------------------------------------------------
function showChosen() {
  const has = Boolean(chosen);
  $('person-chosen').hidden = !has;
  $('person-picker').hidden = has;
  if (has) {
    $('person-name').textContent = `${chosen.name} · ${chosen.kind === 'lead' ? 'Lead' : 'Customer'} · ${formatPhone(chosen.phone)}`;
  }
  // The person cannot be changed once a follow-up exists.
  $('person-change').hidden = Boolean(editing);
}

function openForm(item = null, person = null) {
  editing = item;
  form.reset();
  formError.textContent = '';
  $('followup-dialog-title').textContent = item ? 'Edit follow-up' : 'Add follow-up';
  $('p-results').replaceChildren();
  $('p-hint').hidden = false;

  if (item) {
    const parent = parentOf(item);
    chosen = parent ? { kind: parent.kind.toLowerCase(), id: item.customer?.id ?? item.lead?.id, name: parent.name, phone: parent.phone } : null;
    form.elements.scheduled.value = toInputValueIST(item.scheduled_at);
    form.elements.note.value = item.note ?? '';
  } else {
    chosen = person;
    form.elements.scheduled.value = defaultFollowupInputValue();
  }
  showChosen();
  dialog.showModal();
  if (!chosen) $('p-search').focus();
}

let pickTimer;
async function runPicker() {
  const term = $('p-search').value.trim();
  const token = ++pickToken;
  const list = $('p-results');
  const digits = term.replace(/\D/g, '');
  if (term.length < 2 && digits.length < 3) {
    list.replaceChildren();
    $('p-hint').hidden = false;
    return;
  }
  $('p-hint').hidden = true;
  try {
    const leadQuery = applySearch(
      supabase.from('leads').select('id, name, phone').is('archived_at', null).neq('status', 'Converted'),
      term, ['name', 'location'], 'phone_norm').limit(6);
    const customerQuery = applySearch(
      supabase.from('customers').select('id, name, phone'), term, ['name', 'location'], 'phone_norm').limit(6);
    const [leads, customers] = await Promise.all([leadQuery, customerQuery]);
    if (leads.error) throw leads.error;
    if (customers.error) throw customers.error;
    if (token !== pickToken) return;

    const rows = [
      ...customers.data.map((r) => ({ kind: 'customer', ...r })),
      ...leads.data.map((r) => ({ kind: 'lead', ...r })),
    ];
    if (rows.length === 0) {
      list.replaceChildren(el('li', 'muted', 'No active leads or customers match.'));
      return;
    }
    list.replaceChildren(...rows.map((r) => {
      const li = el('li');
      const button = el('button', 'picker-item', '');
      button.type = 'button';
      button.append(el('span', 'mini-name', r.name),
                    el('span', 'badge', r.kind === 'lead' ? 'Lead' : 'Customer'),
                    el('span', 'muted', formatPhone(r.phone)));
      button.addEventListener('click', () => { chosen = r; showChosen(); form.elements.scheduled.focus(); });
      li.append(button);
      return li;
    }));
  } catch (error) {
    if (token !== pickToken) return;
    handleError(error);
  }
}

async function onSubmit(event) {
  event.preventDefault();
  if (saving) return; // double-submission guard
  formError.textContent = '';

  if (!chosen) { formError.textContent = 'Choose who this follow-up is for.'; return; }
  const scheduledAt = fromInputValueIST(form.elements.scheduled.value);
  if (!scheduledAt) { formError.textContent = 'Enter a valid date and time.'; return; }
  const year = Number(scheduledAt.slice(0, 4));
  if (year < 2000 || year > 2100) { formError.textContent = 'Enter a date between 2000 and 2100.'; return; }

  const note = orNull(form.elements.note.value);

  saving = true;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  try {
    if (editing) {
      await updateFollowup(editing.id, { scheduled_at: scheduledAt, note });
    } else {
      const parentColumn = chosen.kind === 'lead' ? 'lead_id' : 'customer_id';
      const { error } = await supabase.from('followups').insert({ [parentColumn]: chosen.id, scheduled_at: scheduledAt, note });
      if (error) throw error;
    }
    dialog.close();
    toast(editing ? 'Follow-up updated.' : 'Follow-up added.', 'success');
    tab = tabFor(scheduledAt); // show the list it now belongs to
    await load();
  } catch (error) {
    formError.textContent = handleError(error, { toast: false });
  } finally {
    saving = false;
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save follow-up';
  }
}

// ---------------------------------------------------------------------------
// Opened from a lead or customer: followups.html?lead=<id> or ?customer=<id>
// ---------------------------------------------------------------------------
async function openFromLink() {
  const params = new URLSearchParams(location.search);
  const kind = params.has('lead') ? 'lead' : params.has('customer') ? 'customer' : null;
  if (!kind) return;
  const id = params.get(kind);
  history.replaceState(null, '', 'followups.html'); // a reload must not reopen the form

  if (!UUID.test(id ?? '')) { toast('That link is not valid.', 'error'); return; }
  try {
    const table = kind === 'lead' ? 'leads' : 'customers';
    const columns = kind === 'lead' ? 'id, name, phone, status, archived_at' : 'id, name, phone';
    const { data, error } = await supabase.from(table).select(columns).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) { toast(`That ${kind} could not be found.`, 'error'); return; }
    if (data.archived_at) { toast('That lead is archived. Restore it first.', 'error'); return; }
    openForm(null, { kind, id: data.id, name: data.name, phone: data.phone });
  } catch (error) {
    handleError(error);
  }
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------
for (const button of document.querySelectorAll('.tab')) {
  button.addEventListener('click', () => { tab = button.dataset.tab; load(); });
}
$('add-btn').addEventListener('click', () => openForm());
$('followup-cancel').addEventListener('click', () => dialog.close());
$('person-change').addEventListener('click', () => { chosen = null; showChosen(); $('p-search').focus(); });
$('p-search').addEventListener('input', () => { clearTimeout(pickTimer); pickTimer = setTimeout(runPicker, 250); });
form.addEventListener('submit', onSubmit);

const user = await requireAuth();
if (user) {
  renderNav(user);
  await load();
  await openFromLink();
}
