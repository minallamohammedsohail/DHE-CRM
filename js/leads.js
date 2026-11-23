// Leads page: list, search/filter/sort, add, view, edit, status change,
// archive and restore. Leads are never hard-deleted from the UI.

import {
  supabase, requireAuth, renderNav, handleError, toast, el,
  confirmAction, orNull, applySearch, tableCell, detail,
  LEAD_STATUSES, LEAD_SOURCES,
  normalizePhone, isValidIndianMobile, formatPhone, telLink, whatsappLink,
  formatMoney, formatDate,
} from './app.js';

const PAGE_LIMIT = 200;

const SORTS = {
  newest: ['created_at', { ascending: false }],
  oldest: ['created_at', { ascending: true }],
  name:   ['name', { ascending: true }],
  budget: ['budget', { ascending: false, nullsFirst: false }],
};

const $ = (id) => document.getElementById(id);

const filters = {
  form: $('filters'), search: $('f-search'), status: $('f-status'),
  source: $('f-source'), sort: $('f-sort'), view: $('f-view'),
};
const leadDialog = $('lead-dialog');
const leadForm = $('lead-form');
const leadError = $('lead-error');
const saveBtn = $('lead-save');
const viewDialog = $('view-dialog');

let editing = null;      // the lead being edited, or null when adding
let saving = false;      // double-submission guard for the lead form
let converting = false;  // double-click guard for lead conversion
let loadToken = 0;       // ignores out-of-date responses when filters change fast

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fillOptions(select, values) {
  for (const value of values) select.append(new Option(value, value));
}

// "Converted" is set only by lead conversion (Phase 3), never by hand.
function manualStatuses() {
  return LEAD_STATUSES.filter((s) => s !== 'Converted');
}

// Updates one lead and checks a row was really changed. Without the check, a
// blocked or missing row would "succeed" silently.
async function updateLead(id, changes) {
  const { data, error } = await supabase.from('leads').update(changes).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length !== 1) throw new Error('Lead was not updated');
}

// ---------------------------------------------------------------------------
// Loading and rendering the list
// ---------------------------------------------------------------------------
function hasActiveFilters() {
  return Boolean(filters.search.value.trim() || filters.status.value || filters.source.value);
}

async function load() {
  const token = ++loadToken;
  $('loading').hidden = false;
  $('empty').hidden = true;
  $('table-wrap').hidden = true;
  $('limit-note').hidden = true;

  try {
    const archived = filters.view.value === 'archived';
    let query = supabase.from('leads').select('*', { count: 'exact' });
    query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
    if (filters.status.value) query = query.eq('status', filters.status.value);
    if (filters.source.value) query = query.eq('source', filters.source.value);

    query = applySearch(query, filters.search.value,
      ['name', 'location', 'interested_product', 'requirement'], 'phone_norm');

    const [column, options] = SORTS[filters.sort.value];
    query = query.order(column, options);
    if (column !== 'created_at') query = query.order('created_at', { ascending: false });

    const { data, error, count } = await query.limit(PAGE_LIMIT);
    if (error) throw error;
    if (token !== loadToken) return; // a newer load has started

    render(data, count, archived);
  } catch (error) {
    if (token !== loadToken) return;
    handleError(error);
    $('loading').hidden = true;
    $('count').textContent = '';
    showEmpty('Could not load leads. Check your connection and try again.');
  }
}

function showEmpty(message) {
  const box = $('empty');
  box.textContent = message;
  box.hidden = false;
  $('table-wrap').hidden = true;
  $('rows').replaceChildren();
}

function render(leads, count, archived) {
  $('loading').hidden = true;
  $('count').textContent = `${count} ${archived ? 'archived ' : ''}lead${count === 1 ? '' : 's'}`;
  $('limit-note').hidden = count <= PAGE_LIMIT;

  if (leads.length === 0) {
    if (hasActiveFilters()) showEmpty('No leads match your search or filters.');
    else if (archived) showEmpty('No archived leads.');
    else showEmpty('No leads yet. Use “Add lead” to create the first one.');
    return;
  }

  $('empty').hidden = true;
  $('table-wrap').hidden = false;
  $('rows').replaceChildren(...leads.map(renderRow));
}

function renderRow(lead) {
  const tr = el('tr');

  const nameButton = el('button', 'link-btn', lead.name);
  nameButton.type = 'button';
  nameButton.addEventListener('click', () => openView(lead));

  tr.append(
    tableCell('Name', nameButton, 'cell-name'),
    tableCell('Phone', formatPhone(lead.phone)),
    tableCell('Location', lead.location),
    tableCell('Source', lead.source),
    tableCell('Status', statusSelect(lead)),
    tableCell('Budget', formatMoney(lead.budget)),
    tableCell('Added', formatDate(lead.created_at)),
    tableCell('Actions', contactLinks(lead), 'cell-actions'),
  );
  return tr;
}

function contactLinks(lead) {
  const box = document.createDocumentFragment();
  const tel = telLink(lead.phone);
  const wa = whatsappLink(lead.phone);
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

function statusSelect(lead) {
  const select = el('select', 'row-select');
  select.setAttribute('aria-label', `Status for ${lead.name}`);
  const locked = lead.status === 'Converted' || lead.archived_at;
  fillOptions(select, locked ? [lead.status] : manualStatuses());
  select.value = lead.status;
  select.disabled = Boolean(locked);

  select.addEventListener('change', async () => {
    const wanted = select.value;
    select.disabled = true;
    try {
      await updateLead(lead.id, { status: wanted });
      lead.status = wanted;
      toast(`Status changed to ${wanted}.`, 'success');
      await load();
    } catch (error) {
      handleError(error);
      select.value = lead.status;
      select.disabled = false;
    }
  });
  return select;
}

// ---------------------------------------------------------------------------
// View dialog
// ---------------------------------------------------------------------------
function openView(lead) {
  const archived = Boolean(lead.archived_at);
  $('view-title').textContent = lead.name;
  const badge = $('view-badge');
  badge.textContent = archived ? 'Archived' : lead.status;
  badge.classList.toggle('badge-archived', archived);

  $('view-details').replaceChildren(
    ...detail('Phone', formatPhone(lead.phone), true),
    ...detail('Status', lead.status, true),
    ...detail('Location', lead.location),
    ...detail('Source', lead.source),
    ...detail('Interested product', lead.interested_product),
    ...detail('Budget', lead.budget === null ? null : formatMoney(lead.budget)),
    ...detail('Requirement', lead.requirement),
    ...detail('Notes', lead.notes),
    ...detail('Added', formatDate(lead.created_at), true),
    ...detail('Last updated', formatDate(lead.updated_at), true),
    ...(archived ? detail('Archived on', formatDate(lead.archived_at)) : []),
  );

  const actions = $('view-actions');
  actions.replaceChildren();

  const tel = telLink(lead.phone);
  const wa = whatsappLink(lead.phone);
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

  if (!archived && lead.status === 'Converted') {
    // The customers page opens with the search pre-filled from ?q=
    const viewCustomer = el('a', 'btn', 'View customer');
    viewCustomer.href = `customers.html?q=${encodeURIComponent(normalizePhone(lead.phone))}`;
    actions.append(viewCustomer);
  } else if (!archived) {
    const convert = el('button', 'btn', 'Convert to customer');
    convert.type = 'button';
    convert.addEventListener('click', () => convertLead(lead));
    actions.append(convert);
  }

  if (archived) {
    const restore = el('button', 'btn btn-quiet', 'Restore');
    restore.type = 'button';
    restore.addEventListener('click', () => restoreLead(lead, restore));
    actions.append(restore);
  } else {
    const edit = el('button', 'btn btn-quiet', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => { viewDialog.close(); openForm(lead); });
    const archive = el('button', 'btn btn-quiet', 'Archive');
    archive.type = 'button';
    archive.addEventListener('click', () => archiveLead(lead, archive));
    actions.append(edit, archive);
  }

  const close = el('button', 'btn btn-quiet', 'Close');
  close.type = 'button';
  close.addEventListener('click', () => viewDialog.close());
  actions.append(close);

  viewDialog.showModal();
}

async function archiveLead(lead, button) {
  viewDialog.close();
  const ok = await confirmAction(
    'Archive this lead?',
    `“${lead.name}” will be hidden from the lead list. You can restore it later from the Archived view.`,
    'Archive', true,
  );
  if (!ok) return;
  button.disabled = true;
  try {
    await updateLead(lead.id, { archived_at: new Date().toISOString() });
    toast('Lead archived.', 'success');
    await load();
  } catch (error) {
    handleError(error);
  } finally {
    button.disabled = false;
  }
}

// Converts a lead into a customer. Safe to run again after a failure: it looks
// the customer up by phone first, and the unique index on customers.phone_norm
// stops a second record even if two people convert at once.
async function convertLead(lead) {
  if (converting) return; // double-click guard
  converting = true;
  viewDialog.close();
  try {
    const phone = normalizePhone(lead.phone);
    let customer = await findCustomerByPhone(phone);

    const proceed = customer
      ? await confirmAction(
          'Customer already exists',
          `“${customer.name}” is already a customer with this number. Link this lead to them instead of creating a new customer?`,
          'Link lead')
      : await confirmAction(
          'Convert to customer?',
          `“${lead.name}” will be added as a customer and this lead will be marked Converted.`,
          'Convert');
    if (!proceed) return;

    const linkedToExisting = Boolean(customer);
    if (!customer) {
      const { data, error } = await supabase
        .from('customers')
        .insert({ lead_id: lead.id, name: lead.name, phone, location: lead.location })
        .select('id, name, lead_id')
        .single();
      if (error && error.code === '23505') {
        // Someone else created this customer a moment ago: use theirs.
        customer = await findCustomerByPhone(phone);
        if (!customer) throw error;
      } else if (error) {
        throw error;
      } else {
        customer = data;
      }
    } else if (!customer.lead_id) {
      // Record where this customer came from, but never overwrite an existing origin.
      const { error } = await supabase.from('customers').update({ lead_id: lead.id })
        .eq('id', customer.id).is('lead_id', null);
      if (error) throw error;
    }

    await updateLead(lead.id, { status: 'Converted' });
    toast(linkedToExisting ? `Lead linked to customer “${customer.name}”.` : 'Lead converted to a customer.', 'success');
    await load();
  } catch (error) {
    handleError(error);
  } finally {
    converting = false;
  }
}

async function findCustomerByPhone(phone) {
  const { data, error } = await supabase.from('customers').select('id, name, lead_id')
    .eq('phone_norm', phone).limit(1);
  if (error) throw error;
  return data[0] ?? null;
}

async function restoreLead(lead, button) {
  button.disabled = true;
  try {
    await updateLead(lead.id, { archived_at: null });
    viewDialog.close();
    toast('Lead restored.', 'success');
    await load();
  } catch (error) {
    handleError(error);
  } finally {
    button.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Add / edit form
// ---------------------------------------------------------------------------
function openForm(lead = null) {
  editing = lead;
  leadForm.reset();
  leadError.textContent = '';
  $('lead-dialog-title').textContent = lead ? 'Edit lead' : 'Add lead';

  const statusField = leadForm.elements.status;
  statusField.replaceChildren();
  const converted = lead?.status === 'Converted';
  fillOptions(statusField, converted ? ['Converted'] : manualStatuses());
  statusField.disabled = converted;

  if (lead) {
    leadForm.elements.name.value = lead.name;
    leadForm.elements.phone.value = formatPhone(lead.phone);
    leadForm.elements.location.value = lead.location ?? '';
    leadForm.elements.source.value = lead.source ?? '';
    leadForm.elements.interested_product.value = lead.interested_product ?? '';
    leadForm.elements.budget.value = lead.budget ?? '';
    leadForm.elements.requirement.value = lead.requirement ?? '';
    leadForm.elements.notes.value = lead.notes ?? '';
    statusField.value = lead.status;
  } else {
    statusField.value = 'New';
  }
  leadDialog.showModal();
}

// Business-rule checks the browser's native validation cannot express.
// Returns an error message, or '' when the form is valid.
function validate(form) {
  if (!form.elements.name.value.trim()) return 'Enter the lead’s name.';
  if (!isValidIndianMobile(form.elements.phone.value)) {
    return 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.';
  }
  const budget = form.elements.budget.value.trim();
  if (budget !== '') {
    const amount = Number(budget);
    if (!Number.isFinite(amount) || amount < 0) return 'Budget must be zero or more.';
    if (amount >= 10_000_000_000) return 'Budget is too large.';
  }
  const source = form.elements.source.value;
  if (source && !LEAD_SOURCES.includes(source)) return 'Choose a source from the list.';
  return '';
}

async function findDuplicate(phone, excludeId) {
  let leadQuery = supabase.from('leads').select('name, archived_at').eq('phone_norm', phone).limit(1);
  if (excludeId) leadQuery = leadQuery.neq('id', excludeId);
  const customerQuery = supabase.from('customers').select('name').eq('phone_norm', phone).limit(1);
  const [leads, customers] = await Promise.all([leadQuery, customerQuery]);
  if (leads.error) throw leads.error;
  if (customers.error) throw customers.error;

  if (customers.data.length) return `A customer named “${customers.data[0].name}” already has this number.`;
  if (leads.data.length) {
    const found = leads.data[0];
    return `A lead named “${found.name}”${found.archived_at ? ' (archived)' : ''} already has this number.`;
  }
  return '';
}

async function onSubmit(event) {
  event.preventDefault();
  if (saving) return; // double-submission guard
  leadError.textContent = '';

  const problem = validate(leadForm);
  if (problem) {
    leadError.textContent = problem;
    return;
  }

  const f = leadForm.elements;
  const phone = normalizePhone(f.phone.value);
  const payload = {
    name: f.name.value.trim(),
    phone,
    location: orNull(f.location.value),
    source: orNull(f.source.value),
    interested_product: orNull(f.interested_product.value),
    requirement: orNull(f.requirement.value),
    budget: orNull(f.budget.value) === null ? null : Number(f.budget.value),
    notes: orNull(f.notes.value),
  };
  if (!f.status.disabled) payload.status = f.status.value;

  saving = true;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  try {
    const phoneChanged = !editing || normalizePhone(editing.phone) !== phone;
    if (phoneChanged) {
      const duplicate = await findDuplicate(phone, editing?.id);
      if (duplicate) {
        const proceed = await confirmAction('Possible duplicate', `${duplicate} Save anyway?`, 'Save anyway');
        if (!proceed) return;
      }
    }

    if (editing) {
      await updateLead(editing.id, payload);
    } else {
      const { error } = await supabase.from('leads').insert(payload);
      if (error) throw error;
    }

    leadDialog.close();
    toast(editing ? 'Lead updated.' : 'Lead added.', 'success');
    await load();
  } catch (error) {
    leadError.textContent = handleError(error, { toast: false });
  } finally {
    saving = false;
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save lead';
  }
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------
fillOptions(filters.status, LEAD_STATUSES);
fillOptions(filters.source, LEAD_SOURCES);
fillOptions(leadForm.elements.source, LEAD_SOURCES);

let searchTimer;
filters.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 300);
});
for (const select of [filters.status, filters.source, filters.sort, filters.view]) {
  select.addEventListener('change', load);
}
filters.form.addEventListener('submit', (event) => { event.preventDefault(); load(); });

$('add-btn').addEventListener('click', () => openForm());
$('lead-cancel').addEventListener('click', () => leadDialog.close());
leadForm.addEventListener('submit', onSubmit);

const user = await requireAuth();
if (user) {
  renderNav(user);
  await load();
}
