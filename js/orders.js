// Orders page: list, search, filters, sort, add, view, edit, status change and
// "Record payment". Orders are never deleted; cancel them instead.
//
// Money is stored as a running "amount paid" per order (no per-payment
// history). Saves that change money check the order has not been changed by
// someone else first, and refuse if it has.

import {
  supabase, requireAuth, renderNav, handleError, toast, el,
  confirmAction, orNull, applySearch, cleanSearch, tableCell, detail,
  ORDER_STATUSES, ORDER_UNITS,
  normalizePhone, formatPhone, formatMoney, formatDay, formatDate, istDateString,
  addMoney, isValidMoney, balanceBadge,
} from './app.js';

const PAGE_LIMIT = 200;
const SELECT = '*, customer:customers(id, name, phone, lead_id)';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SORTS = {
  newest:  [['order_date', { ascending: false }], ['created_at', { ascending: false }]],
  oldest:  [['order_date', { ascending: true }],  ['created_at', { ascending: true }]],
  total:   [['total_amount', { ascending: false }], ['created_at', { ascending: false }]],
  balance: [['balance', { ascending: false }], ['created_at', { ascending: false }]],
};

const $ = (id) => document.getElementById(id);
const filters = {
  form: $('filters'), search: $('f-search'), status: $('f-status'), payment: $('f-payment'),
  from: $('f-from'), to: $('f-to'), sort: $('f-sort'),
};
const orderDialog = $('order-dialog');
const form = $('order-form');
const formError = $('order-error');
const saveBtn = $('order-save');
const viewDialog = $('view-dialog');
const payDialog = $('pay-dialog');
const payForm = $('pay-form');

let editing = null;   // order being edited, or null when adding
let chosen = null;    // customer picked in the form: { id, name, phone, lead_id }
let paying = null;    // order a payment is being recorded against
let saving = false;   // double-submission guards
let payingBusy = false;
let loadToken = 0;
let pickToken = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fillOptions(select, values) {
  for (const value of values) select.append(new Option(value, value));
}

// Logs and shows an error. If someone else changed the order, also refresh.
async function report(error, options) {
  const message = handleError(error, options);
  if (error?.code === 'conflict') await load();
  return message;
}

// Updates one order, but only if it is still as we last saw it. `guard` is the
// column that must be unchanged: updated_at for edits and status changes,
// amount_paid for payments.
async function updateOrder(order, changes, guard = 'updated_at') {
  const { data, error } = await supabase.from('orders').update(changes)
    .eq('id', order.id).eq(guard, order[guard]).select('id');
  if (error) throw error;
  if (!data || data.length !== 1) {
    const conflict = new Error('Order was changed by someone else');
    conflict.code = 'conflict';
    throw conflict;
  }
}

// A cancelled order is not owed, whatever balance the database holds.
function balanceFor(order) {
  return order.status === 'Cancelled' ? el('span', 'muted', 'Cancelled') : balanceBadge(order.balance);
}

const customerHref = (customer) => `customers.html?q=${encodeURIComponent(normalizePhone(customer.phone))}`;

// ---------------------------------------------------------------------------
// Loading and rendering
// ---------------------------------------------------------------------------
function hasActiveFilters() {
  return Boolean(filters.search.value.trim() || filters.status.value || filters.payment.value
    || filters.from.value || filters.to.value);
}

async function load() {
  const token = ++loadToken;
  $('loading').hidden = false;
  $('empty').hidden = true;
  $('table-wrap').hidden = true;
  $('limit-note').hidden = true;

  try {
    if (filters.from.value && filters.to.value && filters.from.value > filters.to.value) {
      $('loading').hidden = true;
      $('count').textContent = '';
      showEmpty('The “From” date is after the “To” date.');
      return;
    }

    let query = supabase.from('orders').select(SELECT, { count: 'exact' });
    if (filters.status.value) query = query.eq('status', filters.status.value);
    // Cancelled orders are excluded from both payment filters: nothing is owed on them.
    if (filters.payment.value === 'outstanding') query = query.gt('balance', 0).neq('status', 'Cancelled');
    if (filters.payment.value === 'settled') query = query.lte('balance', 0).neq('status', 'Cancelled');
    if (filters.from.value) query = query.gte('order_date', filters.from.value);
    if (filters.to.value) query = query.lte('order_date', filters.to.value);

    // Search: customers whose name or phone match (every word must match),
    // or an order whose description or notes contain the whole text.
    const text = cleanSearch(filters.search.value);
    if (text) {
      const found = await applySearch(supabase.from('customers').select('id'), text, ['name', 'location'], 'phone_norm').limit(100);
      if (found.error) throw found.error;
      const parts = [`description.ilike.%${text}%`, `notes.ilike.%${text}%`];
      if (found.data.length) parts.push(`customer_id.in.(${found.data.map((c) => c.id).join(',')})`);
      query = query.or(parts.join(','));
    }

    for (const [column, options] of SORTS[filters.sort.value]) query = query.order(column, options);

    const { data, error, count } = await query.limit(PAGE_LIMIT);
    if (error) throw error;
    if (token !== loadToken) return;
    render(data, count);
  } catch (error) {
    if (token !== loadToken) return;
    handleError(error);
    $('loading').hidden = true;
    $('count').textContent = '';
    showEmpty('Could not load orders. Check your connection and try again.');
  }
}

function showEmpty(message) {
  const box = $('empty');
  box.textContent = message;
  box.hidden = false;
  $('table-wrap').hidden = true;
  $('rows').replaceChildren();
}

function render(orders, count) {
  $('loading').hidden = true;
  $('count').textContent = `${count} order${count === 1 ? '' : 's'}`;
  $('limit-note').hidden = count <= PAGE_LIMIT;
  if (orders.length === 0) {
    showEmpty(hasActiveFilters() ? 'No orders match your search or filters.' : 'No orders yet. Use “Add order” to create the first one.');
    return;
  }
  $('empty').hidden = true;
  $('table-wrap').hidden = false;
  $('rows').replaceChildren(...orders.map(renderRow));
}

function renderRow(order) {
  const tr = el('tr');
  if (order.status === 'Cancelled') tr.className = 'row-muted';

  const customerBox = document.createDocumentFragment();
  if (order.customer) {
    const link = el('a', 'link-btn', order.customer.name);
    link.href = customerHref(order.customer);
    customerBox.append(link);
  } else {
    customerBox.append('—');
  }

  const orderBox = document.createDocumentFragment();
  const open = el('button', 'link-btn', order.description || 'Order');
  open.type = 'button';
  open.addEventListener('click', () => openView(order));
  orderBox.append(open);
  if (order.quantity !== null) orderBox.append(el('span', 'sub', `${order.quantity} ${order.unit ?? ''}`.trim()));

  tr.append(
    tableCell('Date', formatDay(order.order_date), 'cell-date'),
    tableCell('Customer', customerBox, 'cell-customer'),
    tableCell('Order', orderBox, 'cell-order'),
    tableCell('Total', formatMoney(order.total_amount), 'cell-num'),
    tableCell('Paid', formatMoney(order.amount_paid), 'cell-num'),
    tableCell('Balance', balanceFor(order), 'cell-num'),
    tableCell('Status', statusSelect(order)),
    tableCell('Actions', actionButtons(order), 'cell-actions'),
  );
  return tr;
}

function statusSelect(order) {
  const select = el('select', 'row-select');
  select.setAttribute('aria-label', `Status of order ${order.description}`);
  fillOptions(select, ORDER_STATUSES);
  select.value = order.status;

  select.addEventListener('change', async () => {
    const wanted = select.value;
    if (wanted === 'Cancelled') {
      const paid = Number(order.amount_paid) > 0
        ? ` ${formatMoney(order.amount_paid)} is recorded as paid; cancelling does not change that amount.` : '';
      const ok = await confirmAction('Cancel this order?',
        `“${order.description}” will be marked Cancelled.${paid} You can change the status back later.`,
        'Cancel order', true);
      if (!ok) { select.value = order.status; return; }
    }
    select.disabled = true;
    try {
      await updateOrder(order, { status: wanted });
      toast(`Status changed to ${wanted}.`, 'success');
      await load();
    } catch (error) {
      select.value = order.status;
      select.disabled = false;
      await report(error);
    }
  });
  return select;
}

function actionButtons(order) {
  const box = document.createDocumentFragment();
  const add = (label, handler) => {
    const button = el('button', 'action-link action-btn', label);
    button.type = 'button';
    button.addEventListener('click', handler);
    box.append(button);
  };
  if (order.status !== 'Cancelled') add('Record payment', () => openPay(order));
  add('Edit', () => openForm(order));
  return box;
}

// ---------------------------------------------------------------------------
// View dialog
// ---------------------------------------------------------------------------
function openView(order) {
  $('view-title').textContent = order.description || 'Order';
  const badge = $('view-badge');
  badge.textContent = order.status;

  const rows = [];
  if (order.customer) {
    const dd = el('dd');
    const link = el('a', null, `${order.customer.name} · ${formatPhone(order.customer.phone)}`);
    link.href = customerHref(order.customer);
    dd.append(link);
    rows.push(el('dt', null, 'Customer'), dd);
  }
  rows.push(
    ...detail('Order date', formatDay(order.order_date), true),
    ...detail('Quantity', order.quantity === null ? null : `${order.quantity} ${order.unit ?? ''}`.trim()),
    ...detail('Total', formatMoney(order.total_amount), true),
    ...detail('Paid', formatMoney(order.amount_paid), true),
  );
  const balance = el('dd');
  balance.append(balanceFor(order));
  rows.push(el('dt', null, 'Balance'), balance);
  rows.push(
    ...detail('Notes', order.notes),
    ...detail('Added', formatDate(order.created_at), true),
    ...detail('Last updated', formatDate(order.updated_at), true),
  );
  $('view-details').replaceChildren(...rows);

  const actions = $('view-actions');
  actions.replaceChildren();
  if (order.status !== 'Cancelled') {
    const pay = el('button', 'btn', 'Record payment');
    pay.type = 'button';
    pay.addEventListener('click', () => { viewDialog.close(); openPay(order); });
    actions.append(pay);
  }
  const edit = el('button', 'btn btn-quiet', 'Edit');
  edit.type = 'button';
  edit.addEventListener('click', () => { viewDialog.close(); openForm(order); });
  const close = el('button', 'btn btn-quiet', 'Close');
  close.type = 'button';
  close.addEventListener('click', () => viewDialog.close());
  actions.append(edit, close);
  viewDialog.showModal();
}

// ---------------------------------------------------------------------------
// Record payment
// ---------------------------------------------------------------------------
function openPay(order) {
  paying = order;
  payForm.reset();
  $('pay-error').textContent = '';
  $('pay-preview').textContent = '';
  $('pay-summary').replaceChildren(
    ...detail('Customer', order.customer?.name ?? '—', true),
    ...detail('Order', order.description, true),
    ...detail('Total', formatMoney(order.total_amount), true),
    ...detail('Paid so far', formatMoney(order.amount_paid), true),
  );
  payDialog.showModal();
  $('pay-amount').focus();
}

function previewPayment() {
  const text = $('pay-amount').value;
  if (!paying || !isValidMoney(text) || Number(text) <= 0) { $('pay-preview').textContent = ''; return; }
  const newPaid = addMoney(paying.amount_paid, text);
  const balance = addMoney(paying.total_amount, -newPaid);
  $('pay-preview').textContent = balance > 0 ? `New balance: ${formatMoney(balance)} due`
    : balance < 0 ? `New balance: overpaid by ${formatMoney(-balance)}` : 'New balance: paid in full';
}

async function onPay(event) {
  event.preventDefault();
  if (payingBusy) return; // double-submission guard
  $('pay-error').textContent = '';
  const text = $('pay-amount').value.trim();
  if (!isValidMoney(text) || Number(text) <= 0) {
    $('pay-error').textContent = 'Enter an amount above zero, with at most 2 decimals.';
    return;
  }

  payingBusy = true;
  $('pay-save').disabled = true;
  $('pay-save').textContent = 'Saving…';
  try {
    const newPaid = addMoney(paying.amount_paid, text);
    if (newPaid > Number(paying.total_amount)) {
      const over = addMoney(newPaid, -Number(paying.total_amount));
      const ok = await confirmAction('Payment exceeds the total',
        `This makes the total paid ${formatMoney(over)} more than the order total of ${formatMoney(paying.total_amount)}. Record it anyway?`,
        'Record anyway');
      if (!ok) return;
    }
    await updateOrder(paying, { amount_paid: newPaid }, 'amount_paid');
    payDialog.close();
    toast(`Payment of ${formatMoney(text)} recorded.`, 'success');
    await load();
  } catch (error) {
    // After a conflict the dialog closes, so the message must be a toast.
    const conflict = error?.code === 'conflict';
    if (conflict) payDialog.close();
    $('pay-error').textContent = await report(error, { toast: conflict });
  } finally {
    payingBusy = false;
    $('pay-save').disabled = false;
    $('pay-save').textContent = 'Record payment';
  }
}

// ---------------------------------------------------------------------------
// Add / edit form and the customer picker
// ---------------------------------------------------------------------------
function showChosen() {
  const has = Boolean(chosen);
  $('person-chosen').hidden = !has;
  $('person-picker').hidden = has;
  if (has) $('person-name').textContent = `${chosen.name} · ${formatPhone(chosen.phone)}`;
  $('person-change').hidden = Boolean(editing); // the customer of an order cannot change
}

function openForm(order = null, customer = null) {
  editing = order;
  form.reset();
  formError.textContent = '';
  $('order-dialog-title').textContent = order ? 'Edit order' : 'Add order';
  $('p-results').replaceChildren();
  $('p-hint').hidden = false;

  const today = istDateString();
  form.elements.order_date.max = today;
  const f = form.elements;
  f.status.replaceChildren();
  fillOptions(f.status, ORDER_STATUSES);

  if (order) {
    chosen = order.customer ? { ...order.customer } : null;
    f.order_date.value = order.order_date;
    f.status.value = order.status;
    f.description.value = order.description ?? '';
    f.quantity.value = order.quantity ?? '';
    f.unit.value = order.unit ?? '';
    f.total_amount.value = order.total_amount;
    f.amount_paid.value = order.amount_paid;
    f.notes.value = order.notes ?? '';
  } else {
    chosen = customer;
    f.order_date.value = today;
    f.status.value = 'Pending';
    f.amount_paid.value = '0';
  }
  showChosen();
  orderDialog.showModal();
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
    const { data, error } = await applySearch(
      supabase.from('customers').select('id, name, phone, lead_id'), term, ['name', 'location'], 'phone_norm').limit(8);
    if (error) throw error;
    if (token !== pickToken) return;
    if (data.length === 0) {
      list.replaceChildren(el('li', 'muted', 'No customers match. Convert the lead to a customer first.'));
      return;
    }
    list.replaceChildren(...data.map((customer) => {
      const li = el('li');
      const button = el('button', 'picker-item', '');
      button.type = 'button';
      button.append(el('span', 'mini-name', customer.name), el('span', 'muted', formatPhone(customer.phone)));
      button.addEventListener('click', () => { chosen = customer; showChosen(); form.elements.description.focus(); });
      li.append(button);
      return li;
    }));
  } catch (error) {
    if (token !== pickToken) return;
    handleError(error);
  }
}

// Business rules the browser's native validation cannot express.
function validate(f) {
  if (!chosen) return 'Choose the customer for this order.';
  if (!f.order_date.value) return 'Enter the order date.';
  if (f.order_date.value > istDateString()) return 'The order date cannot be in the future.';
  if (f.order_date.value < '2000-01-01') return 'Enter a date from the year 2000 onwards.';
  if (!f.description.value.trim()) return 'Describe what was ordered.';
  const total = f.total_amount.value.trim();
  if (!isValidMoney(total) || Number(total) <= 0) return 'Total must be above zero, with at most 2 decimals.';
  const paid = f.amount_paid.value.trim();
  if (paid !== '' && !isValidMoney(paid)) return 'Amount paid must be zero or more, with at most 2 decimals.';
  const quantity = f.quantity.value.trim();
  if (quantity !== '' && (!isValidMoney(quantity) || Number(quantity) <= 0)) return 'Quantity must be above zero, with at most 2 decimals.';
  if (quantity !== '' && !f.unit.value) return 'Choose a unit for the quantity.';
  if (quantity === '' && f.unit.value) return 'Enter a quantity, or clear the unit.';
  return '';
}

async function onSubmit(event) {
  event.preventDefault();
  if (saving) return; // double-submission guard
  formError.textContent = '';
  const f = form.elements;

  const problem = validate(f);
  if (problem) { formError.textContent = problem; return; }

  const total = Number(f.total_amount.value);
  const paid = f.amount_paid.value.trim() === '' ? 0 : Number(f.amount_paid.value);
  const payload = {
    order_date: f.order_date.value,
    description: f.description.value.trim(),
    quantity: f.quantity.value.trim() === '' ? null : Number(f.quantity.value),
    unit: orNull(f.unit.value),
    total_amount: total,
    amount_paid: paid,
    status: f.status.value,
    notes: orNull(f.notes.value),
  };

  saving = true;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  try {
    if (paid > total) {
      const ok = await confirmAction('Paid is more than the total',
        `The amount paid (${formatMoney(paid)}) is more than the order total (${formatMoney(total)}). Save anyway?`,
        'Save anyway');
      if (!ok) return;
    }
    if (editing) {
      await updateOrder(editing, payload);
    } else {
      const { error } = await supabase.from('orders').insert({
        ...payload, customer_id: chosen.id, lead_id: chosen.lead_id ?? null,
      });
      if (error) throw error;
    }
    orderDialog.close();
    toast(editing ? 'Order updated.' : 'Order added.', 'success');
    await load();
  } catch (error) {
    const conflict = error?.code === 'conflict';
    if (conflict) orderDialog.close();
    formError.textContent = await report(error, { toast: conflict });
  } finally {
    saving = false;
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save order';
  }
}

// ---------------------------------------------------------------------------
// Opened from a customer: orders.html?customer=<id>
// ---------------------------------------------------------------------------
async function openFromLink() {
  const params = new URLSearchParams(location.search);
  if (!params.has('customer')) return;
  const id = params.get('customer');
  history.replaceState(null, '', 'orders.html'); // a reload must not reopen the form
  if (!UUID.test(id ?? '')) { toast('That link is not valid.', 'error'); return; }
  try {
    const { data, error } = await supabase.from('customers').select('id, name, phone, lead_id').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) { toast('That customer could not be found.', 'error'); return; }
    openForm(null, data);
  } catch (error) {
    handleError(error);
  }
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------
fillOptions(filters.status, ORDER_STATUSES);
fillOptions(form.elements.unit, ORDER_UNITS);

// orders.html?q=<phone> (from the dashboard's recent orders).
const startingSearch = new URLSearchParams(location.search).get('q');
if (startingSearch) filters.search.value = startingSearch.slice(0, 100);

let searchTimer;
filters.search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 300); });
for (const control of [filters.status, filters.payment, filters.from, filters.to, filters.sort]) {
  control.addEventListener('change', load);
}
filters.form.addEventListener('submit', (event) => { event.preventDefault(); load(); });

$('add-btn').addEventListener('click', () => openForm());
$('order-cancel').addEventListener('click', () => orderDialog.close());
$('person-change').addEventListener('click', () => { chosen = null; showChosen(); $('p-search').focus(); });
$('p-search').addEventListener('input', () => { clearTimeout(pickTimer); pickTimer = setTimeout(runPicker, 250); });
form.addEventListener('submit', onSubmit);
$('pay-cancel').addEventListener('click', () => payDialog.close());
$('pay-amount').addEventListener('input', previewPayment);
payForm.addEventListener('submit', onPay);

const user = await requireAuth();
if (user) {
  renderNav(user);
  await load();
  await openFromLink();
}
