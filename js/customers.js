// Customers page: list, search, sort, add, edit and a profile showing the
// leads that belong to the customer. Customers are never deleted from the UI.

import {
  supabase, requireAuth, renderNav, handleError, toast, el,
  confirmAction, orNull, applySearch, tableCell, detail,
  normalizePhone, isValidIndianMobile, formatPhone, telLink, whatsappLink,
  formatDate, formatDateTime, formatDay, formatMoney, addMoney,
} from './app.js';

const PAGE_LIMIT = 200;

const SORTS = {
  newest: ['created_at', { ascending: false }],
  oldest: ['created_at', { ascending: true }],
  name:   ['name', { ascending: true }],
};

const $ = (id) => document.getElementById(id);

const filters = { form: $('filters'), search: $('f-search'), sort: $('f-sort') };
const customerDialog = $('customer-dialog');
const customerForm = $('customer-form');
const customerError = $('customer-error');
const saveBtn = $('customer-save');
const viewDialog = $('view-dialog');

let editing = null;   // the customer being edited, or null when adding
let saving = false;   // double-submission guard
let loadToken = 0;    // ignores out-of-date responses when search changes fast

// ---------------------------------------------------------------------------
// Loading and rendering the list
// ---------------------------------------------------------------------------
async function load() {
  const token = ++loadToken;
  $('loading').hidden = false;
  $('empty').hidden = true;
  $('table-wrap').hidden = true;
  $('limit-note').hidden = true;

  try {
    let query = supabase.from('customers').select('*', { count: 'exact' });
    query = applySearch(query, filters.search.value, ['name', 'location'], 'phone_norm');

    const [column, options] = SORTS[filters.sort.value];
    query = query.order(column, options);
    if (column !== 'created_at') query = query.order('created_at', { ascending: false });

    const { data, error, count } = await query.limit(PAGE_LIMIT);
    if (error) throw error;
    if (token !== loadToken) return;

    render(data, count);
  } catch (error) {
    if (token !== loadToken) return;
    handleError(error);
    $('loading').hidden = true;
    $('count').textContent = '';
    showEmpty('Could not load customers. Check your connection and try again.');
  }
}

function showEmpty(message) {
  const box = $('empty');
  box.textContent = message;
  box.hidden = false;
  $('table-wrap').hidden = true;
  $('rows').replaceChildren();
}

function render(customers, count) {
  $('loading').hidden = true;
  $('count').textContent = `${count} customer${count === 1 ? '' : 's'}`;
  $('limit-note').hidden = count <= PAGE_LIMIT;

  if (customers.length === 0) {
    if (filters.search.value.trim()) showEmpty('No customers match your search.');
    else showEmpty('No customers yet. Convert a lead, or use “Add customer”.');
    return;
  }

  $('empty').hidden = true;
  $('table-wrap').hidden = false;
  $('rows').replaceChildren(...customers.map(renderRow));
}

function renderRow(customer) {
  const tr = el('tr');

  const nameButton = el('button', 'link-btn', customer.name);
  nameButton.type = 'button';
  nameButton.addEventListener('click', () => openView(customer));

  tr.append(
    tableCell('Name', nameButton, 'cell-name'),
    tableCell('Phone', formatPhone(customer.phone)),
    tableCell('Location', customer.location),
    tableCell('Added', formatDate(customer.created_at)),
    tableCell('Actions', contactLinks(customer), 'cell-actions'),
  );
  return tr;
}

function contactLinks(customer) {
  const box = document.createDocumentFragment();
  const tel = telLink(customer.phone);
  const wa = whatsappLink(customer.phone);
  if (tel) {
    const call = el('a', 'action-link', 'Call');
    call.href = tel;
    box.append(call);
  }
  if (wa) {
    const chat = el('a', 'action-link', 'WhatsApp');
    chat.href = wa;
    chat.target = '_blank';
    chat.rel = 'noopener noreferrer';
    box.append(chat);
  }
  return box;
}

// ---------------------------------------------------------------------------
// Profile dialog
// ---------------------------------------------------------------------------
function openView(customer) {
  $('view-title').textContent = customer.name;
  $('view-details').replaceChildren(
    ...detail('Phone', formatPhone(customer.phone), true),
    ...detail('Location', customer.location),
    ...detail('Notes', customer.notes),
    ...detail('Added', formatDate(customer.created_at), true),
    ...detail('Last updated', formatDate(customer.updated_at), true),
  );

  const actions = $('view-actions');
  actions.replaceChildren();
  const tel = telLink(customer.phone);
  const wa = whatsappLink(customer.phone);
  if (tel) {
    const call = el('a', 'btn', 'Call');
    call.href = tel;
    actions.append(call);
  }
  if (wa) {
    const chat = el('a', 'btn', 'WhatsApp');
    chat.href = wa;
    chat.target = '_blank';
    chat.rel = 'noopener noreferrer';
    actions.append(chat);
  }
  const schedule = el('a', 'btn btn-quiet', 'Schedule follow-up');
  schedule.href = `followups.html?customer=${encodeURIComponent(customer.id)}`;
  const addOrder = el('a', 'btn btn-quiet', 'Add order');
  addOrder.href = `orders.html?customer=${encodeURIComponent(customer.id)}`;
  actions.append(schedule, addOrder);
  const edit = el('button', 'btn btn-quiet', 'Edit');
  edit.type = 'button';
  edit.addEventListener('click', () => { viewDialog.close(); openForm(customer); });
  const close = el('button', 'btn btn-quiet', 'Close');
  close.type = 'button';
  close.addEventListener('click', () => viewDialog.close());
  actions.append(edit, close);

  loadLeadsAndFollowups(customer);
  viewDialog.showModal();
}

// Leads that belong to this customer: the lead it was converted from, plus any
// lead sharing its phone number (archived ones are included and labelled).
async function loadLeads(customer) {
  const box = $('view-leads');
  box.replaceChildren(el('p', 'muted', 'Loading…'));
  try {
    const clauses = [`phone_norm.eq.${normalizePhone(customer.phone)}`];
    if (customer.lead_id) clauses.push(`id.eq.${customer.lead_id}`);
    const { data, error } = await supabase.from('leads')
      .select('id, name, status, source, archived_at, created_at')
      .or(clauses.join(','))
      .order('created_at', { ascending: false });
    if (error) throw error;
    if (viewDialog.open === false) return [];

    if (data.length === 0) {
      box.replaceChildren(el('p', 'muted', 'No leads are linked to this customer.'));
      return [];
    }
    const list = el('ul', 'mini-list');
    for (const lead of data) {
      const row = el('li');
      row.append(el('span', 'mini-name', lead.name));
      row.append(el('span', 'badge', lead.status));
      if (lead.archived_at) row.append(el('span', 'badge badge-archived', 'Archived'));
      row.append(el('span', 'muted', `${lead.source ?? 'No source'} · ${formatDate(lead.created_at)}`));
      list.append(row);
    }
    box.replaceChildren(list);
    return data;
  } catch (error) {
    handleError(error);
    box.replaceChildren(el('p', 'muted', 'Could not load this customer’s leads.'));
    return [];
  }
}

async function loadLeadsAndFollowups(customer) {
  const leads = await loadLeads(customer);
  await Promise.all([loadFollowups(customer, leads), loadOrders(customer)]);
}

// Order history, newest first, with what is still owed (cancelled orders are
// not counted).
async function loadOrders(customer) {
  const box = $('view-orders');
  box.replaceChildren(el('p', 'muted', 'Loading…'));
  try {
    const { data, error } = await supabase.from('orders')
      .select('id, order_date, description, total_amount, amount_paid, balance, status')
      .eq('customer_id', customer.id)
      .order('order_date', { ascending: false }).order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    if (viewDialog.open === false) return;

    if (data.length === 0) {
      box.replaceChildren(el('p', 'muted', 'No orders yet.'));
      return;
    }
    let owed = 0;
    for (const order of data) {
      if (order.status !== 'Cancelled' && Number(order.balance) > 0) owed = addMoney(owed, order.balance);
    }
    const summary = el('p', owed > 0 ? 'owed-line' : 'muted',
      owed > 0 ? `Outstanding: ${formatMoney(owed)}` : 'Nothing outstanding.');

    const list = el('ul', 'mini-list');
    for (const order of data.slice(0, 50)) {
      const row = el('li');
      row.append(el('span', 'mini-name', order.description));
      row.append(el('span', 'badge', order.status));
      row.append(el('span', 'muted', `${formatDay(order.order_date)} · ${formatMoney(order.total_amount)} total · ${formatMoney(order.amount_paid)} paid`));
      list.append(row);
    }
    const parts = [summary, list];
    if (data.length > 50) parts.push(el('p', 'muted', `Showing the latest 50 of ${data.length} orders.`));
    box.replaceChildren(...parts);
  } catch (error) {
    handleError(error);
    box.replaceChildren(el('p', 'muted', 'Could not load orders.'));
  }
}

// Follow-up history: the customer's own, plus those of its associated leads
// (a converted lead's earlier follow-ups stay visible here).
async function loadFollowups(customer, leads) {
  const box = $('view-followups');
  box.replaceChildren(el('p', 'muted', 'Loading…'));
  try {
    const clauses = [`customer_id.eq.${customer.id}`];
    if (leads.length) clauses.push(`lead_id.in.(${leads.map((l) => l.id).join(',')})`);
    const { data, error } = await supabase.from('followups')
      .select('id, scheduled_at, note, status, lead_id, lead:leads(name)')
      .or(clauses.join(','))
      .order('scheduled_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    if (viewDialog.open === false) return;

    if (data.length === 0) {
      box.replaceChildren(el('p', 'muted', 'No follow-ups yet.'));
      return;
    }
    const list = el('ul', 'mini-list');
    for (const item of data) {
      const row = el('li');
      row.append(el('span', 'mini-name', formatDateTime(item.scheduled_at)));
      row.append(el('span', 'badge', item.status));
      row.append(el('span', 'muted', item.lead_id && item.lead ? `Lead: ${item.lead.name}` : 'Customer'));
      if (item.note) row.append(el('span', 'mini-note', item.note));
      list.append(row);
    }
    box.replaceChildren(list);
  } catch (error) {
    handleError(error);
    box.replaceChildren(el('p', 'muted', 'Could not load follow-ups.'));
  }
}

// ---------------------------------------------------------------------------
// Add / edit form
// ---------------------------------------------------------------------------
function openForm(customer = null) {
  editing = customer;
  customerForm.reset();
  customerError.textContent = '';
  $('customer-dialog-title').textContent = customer ? 'Edit customer' : 'Add customer';
  if (customer) {
    const f = customerForm.elements;
    f.name.value = customer.name;
    f.phone.value = formatPhone(customer.phone);
    f.location.value = customer.location ?? '';
    f.notes.value = customer.notes ?? '';
  }
  customerDialog.showModal();
}

// Business rules the browser's native validation cannot express.
function validate(form) {
  if (!form.elements.name.value.trim()) return 'Enter the customer’s name.';
  if (!isValidIndianMobile(form.elements.phone.value)) {
    return 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.';
  }
  return '';
}

async function onSubmit(event) {
  event.preventDefault();
  if (saving) return; // double-submission guard
  customerError.textContent = '';

  const problem = validate(customerForm);
  if (problem) {
    customerError.textContent = problem;
    return;
  }

  const f = customerForm.elements;
  const phone = normalizePhone(f.phone.value);
  const payload = {
    name: f.name.value.trim(),
    phone,
    location: orNull(f.location.value),
    notes: orNull(f.notes.value),
  };

  saving = true;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  try {
    const phoneChanged = !editing || normalizePhone(editing.phone) !== phone;
    if (phoneChanged) {
      // A customer already using this number is a hard stop: the database
      // enforces it with a unique index, so there is no "save anyway".
      let customerQuery = supabase.from('customers').select('name').eq('phone_norm', phone).limit(1);
      if (editing) customerQuery = customerQuery.neq('id', editing.id);
      const leadQuery = supabase.from('leads').select('name').eq('phone_norm', phone)
        .is('archived_at', null).limit(1);
      const [customers, leads] = await Promise.all([customerQuery, leadQuery]);
      if (customers.error) throw customers.error;
      if (leads.error) throw leads.error;

      if (customers.data.length) {
        customerError.textContent = `A customer named “${customers.data[0].name}” already has this number.`;
        return;
      }
      if (leads.data.length && !editing) {
        const proceed = await confirmAction(
          'A lead has this number',
          `A lead named “${leads.data[0].name}” already has this number. It is usually better to convert that lead from the Leads page. Add this customer anyway?`,
          'Add anyway');
        if (!proceed) return;
      }
    }

    if (editing) {
      const { data, error } = await supabase.from('customers').update(payload)
        .eq('id', editing.id).select('id');
      if (error) throw error;
      if (!data || data.length !== 1) throw new Error('Customer was not updated');
    } else {
      const { error } = await supabase.from('customers').insert(payload);
      if (error) throw error;
    }

    customerDialog.close();
    toast(editing ? 'Customer updated.' : 'Customer added.', 'success');
    await load();
  } catch (error) {
    const message = handleError(error, { toast: false });
    // Two people saving the same number at once: the unique index wins.
    customerError.textContent = error?.code === '23505'
      ? 'A customer with this number already exists.'
      : message;
  } finally {
    saving = false;
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save customer';
  }
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------
// Links from a converted lead arrive as customers.html?q=<phone>.
const startingSearch = new URLSearchParams(location.search).get('q');
if (startingSearch) filters.search.value = startingSearch.slice(0, 100);

let searchTimer;
filters.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 300);
});
filters.sort.addEventListener('change', load);
filters.form.addEventListener('submit', (event) => { event.preventDefault(); load(); });

$('add-btn').addEventListener('click', () => openForm());
$('customer-cancel').addEventListener('click', () => customerDialog.close());
customerForm.addEventListener('submit', onSubmit);

const user = await requireAuth();
if (user) {
  renderNav(user);
  await load();
}
