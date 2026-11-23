// Shared module. Only genuinely shared code lives here — add a helper when a
// second page needs it, not in anticipation.

import { supabase } from './supabase.js';
import { TIMEZONE } from './config.js';

export { supabase };

export const BUSINESS_NAME = 'Dream Home Enterprises';

// Navigation. Add an entry in the same phase that builds its page, so the
// menu never contains a link to a page that does not exist.
const NAV = [
  { href: 'index.html', label: 'Dashboard' },
  { href: 'leads.html', label: 'Leads' },
  { href: 'customers.html', label: 'Customers' },
  { href: 'followups.html', label: 'Follow-ups' },
  { href: 'orders.html', label: 'Orders' },
];

// Status and source lists. Each must always match the CHECK constraint of the
// same column in db/schema.sql. Never hard-code these strings elsewhere.
export const LEAD_STATUSES = ['New', 'Contacted', 'Interested', 'Site Visit', 'Negotiation', 'Converted', 'Lost'];
export const ORDER_STATUSES = ['Pending', 'Confirmed', 'Delivered', 'Cancelled'];
export const ORDER_UNITS = ['Box', 'Piece', 'Sq. ft.'];
export const FOLLOWUP_STATUSES = ['Pending', 'Completed', 'Cancelled'];
export const LEAD_SOURCES = ['Walk-in', 'Referral', 'Phone', 'WhatsApp', 'Instagram', 'Website', 'Other'];

// ---------------------------------------------------------------------------
// Small DOM helper. Text always goes through textContent, never innerHTML.
// ---------------------------------------------------------------------------
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------------------------------------------------------------------------
// Toasts and error handling
// ---------------------------------------------------------------------------
export function toast(message, type = 'info') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = el('div');
    box.id = 'toasts';
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const note = el('div', `toast toast-${type}`, message);
  box.append(note);
  setTimeout(() => note.remove(), type === 'error' ? 6000 : 3500);
}

// Turns any error into a message a non-technical user can act on. Raw
// database messages are never shown.
export function friendlyMessage(error) {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '');

  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return 'Incorrect email or password.';
  }
  if (code === 'over_request_rate_limit' || error?.status === 429) {
    return 'Too many attempts. Please wait a minute and try again.';
  }
  if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'Cannot reach the server. Check your internet connection and try again.';
  }
  if (code === '42501') return 'You do not have permission to do that.';
  if (code === '23505') return 'That record already exists.';
  if (code === '23503') return 'That record is linked to other records and cannot be changed this way.';
  if (code === '23514' || code === '23502') return 'Some of the information is not valid. Please check the form.';
  if (code === 'conflict') {
    return 'This record was changed by someone else, so nothing was saved. It has been refreshed; please check it and try again.';
  }
  if (code === 'PGRST301' || /jwt expired/i.test(message)) {
    return 'Your session has expired. Please sign in again.';
  }
  return 'Something went wrong. Please try again.';
}

// Logs the real error for debugging and shows a readable message.
// Pass { toast: false } when the caller shows the message itself.
export function handleError(error, { toast: show = true } = {}) {
  console.error(error);
  const message = friendlyMessage(error);
  if (show) toast(message, 'error');
  return message;
}

// ---------------------------------------------------------------------------
// Phone numbers (Indian mobile numbers only)
// ---------------------------------------------------------------------------
// Returns the canonical 10-digit form. Run this before EVERY save so the
// stored value is consistent and the unique index on customers.phone_norm
// actually prevents duplicates.
export function normalizePhone(input) {
  let digits = String(input ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);                    // 0091...
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2); // 91...
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1); // 0...
  return digits;
}

export function isValidIndianMobile(input) {
  return /^[6-9]\d{9}$/.test(normalizePhone(input));
}

// "9876543210" -> "98765 43210". Falls back to the raw value if invalid.
export function formatPhone(input) {
  const n = normalizePhone(input);
  return isValidIndianMobile(n) ? `${n.slice(0, 5)} ${n.slice(5)}` : String(input ?? '');
}

// Links are built only from a validated number, never from raw user text.
export function telLink(input) {
  const n = normalizePhone(input);
  return isValidIndianMobile(n) ? `tel:+91${n}` : null;
}

export function whatsappLink(input) {
  const n = normalizePhone(input);
  return isValidIndianMobile(n) ? `https://wa.me/91${n}` : null;
}

// ---------------------------------------------------------------------------
// Formatting (money and dates, in the business timezone)
// ---------------------------------------------------------------------------
// Whole rupees show without decimals; anything with paise shows both digits.
const rupees = { style: 'currency', currency: 'INR' };
const moneyWhole = new Intl.NumberFormat('en-IN', { ...rupees, minimumFractionDigits: 0, maximumFractionDigits: 0 });
const moneyPaise = new Intl.NumberFormat('en-IN', { ...rupees, minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  return Number.isInteger(amount) ? moneyWhole.format(amount) : moneyPaise.format(amount);
}

const dateFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIMEZONE, day: '2-digit', month: 'short', year: 'numeric',
});
export function formatDate(value) {
  return value ? dateFormat.format(new Date(value)) : '—';
}

// ---------------------------------------------------------------------------
// Day boundaries and date-times in the business timezone (Asia/Kolkata)
// ---------------------------------------------------------------------------
// India has no daylight saving, so a fixed +05:30 offset is exact. If TIMEZONE
// in config.js ever changes, this offset must change with it.
const IST_OFFSET = '+05:30';

const istDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const istClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const dateTimeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIMEZONE, day: '2-digit', month: 'short', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
});

// "2026-11-23" — the calendar date in IST at the given moment.
export function istDateString(now = new Date()) {
  return istDay.format(now);
}

// [start, end) of the IST calendar day containing `now`, as ISO strings.
export function dayRangeIST(now = new Date()) {
  const start = new Date(`${istDateString(now)}T00:00:00${IST_OFFSET}`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ISO timestamp -> "2026-11-23T10:00", the IST wall-clock value for a
// <input type="datetime-local">.
export function toInputValueIST(value) {
  const parts = Object.fromEntries(istClock.formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// "2026-11-23T10:00" (entered as IST) -> ISO timestamp, or null if invalid.
export function fromInputValueIST(text) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(text))) return null;
  const date = new Date(`${text}:00${IST_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Tomorrow at 10:00 IST, as a datetime-local value.
export function defaultFollowupInputValue(now = new Date()) {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return `${istDateString(tomorrow)}T10:00`;
}

// "23 Nov 2026, 10:00 am" in IST.
export function formatDateTime(value) {
  return value ? dateTimeFormat.format(new Date(value)) : '—';
}

// Money is added in whole paise so 0.10 + 0.20 is exactly 0.30, never
// 0.30000000000000004.
export function addMoney(a, b) {
  return (Math.round(Number(a) * 100) + Math.round(Number(b) * 100)) / 100;
}

// True for plain amounts with at most 2 decimals that fit numeric(12,2).
export function isValidMoney(text) {
  const value = String(text ?? '').trim();
  return /^\d{1,10}(\.\d{1,2})?$/.test(value) && Number(value) < 10_000_000_000;
}

// "due", "overpaid" or "paid in full" as a small badge.
export function balanceBadge(balance) {
  const amount = Number(balance);
  if (amount > 0) return el('span', 'badge badge-due', `${formatMoney(amount)} due`);
  if (amount < 0) return el('span', 'badge badge-over', `Overpaid ${formatMoney(-amount)}`);
  return el('span', 'badge badge-ok', 'Paid in full');
}

// A date-only value such as "2026-11-23" (an order date) in the business zone.
export function formatDay(value) {
  return value ? dateFormat.format(new Date(`${value}T12:00:00${IST_OFFSET}`)) : '—';
}

// ---------------------------------------------------------------------------
// Shared UI helpers used by more than one page
// ---------------------------------------------------------------------------
// Empty or whitespace-only text becomes null so the database stores NULL.
export function orNull(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

// Characters that would break PostgREST's or() filter syntax, or act as
// wildcards, are removed from search text before it is used.
export function cleanSearch(text) {
  return text.replace(/[,()"\%*_]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Adds one filter per word, so EVERY word must match at least one of the
// given text columns (or the digits of the phone column). "amit pune" finds a
// lead whose name matches "amit" and whose location matches "pune".
export function applySearch(query, text, columns, phoneColumn) {
  const words = cleanSearch(text).split(' ').filter(Boolean).slice(0, 6);
  for (const word of words) {
    const parts = columns.map((column) => `${column}.ilike.%${word}%`);
    const digits = word.replace(/\D/g, '');
    if (phoneColumn && digits.length >= 3) parts.push(`${phoneColumn}.ilike.%${digits}%`);
    query = query.or(parts.join(','));
  }
  return query;
}

// One <td> for the list tables. On phones the data-label becomes the caption.
export function tableCell(label, content, className) {
  const td = el('td', className);
  td.dataset.label = label;
  if (content instanceof Node) td.append(content);
  else td.textContent = content === null || content === undefined || content === '' ? '—' : content;
  return td;
}

// A <dt>/<dd> pair for a details list. Skips empty values unless `always`.
export function detail(term, value, always = false) {
  if (!always && (value === null || value === undefined || value === '')) return [];
  return [el('dt', null, term), el('dd', null, value)];
}

// Native <dialog> confirmation, built on first use so pages need no markup.
// Resolves true when the user confirms; Cancel and Esc resolve false.
let confirmParts = null;
function getConfirmParts() {
  if (confirmParts) return confirmParts;
  const dialog = el('dialog');
  dialog.setAttribute('aria-labelledby', 'confirm-title');
  const form = el('form');
  form.method = 'dialog';
  const title = el('h2', null, '');
  title.id = 'confirm-title';
  const text = el('p', null, '');
  const actions = el('div', 'dialog-actions');
  const cancel = el('button', 'btn btn-quiet', 'Cancel');
  cancel.value = 'cancel';
  const ok = el('button', 'btn', 'Confirm');
  ok.value = 'ok';
  actions.append(cancel, ok);
  form.append(title, text, actions);
  dialog.append(form);
  document.body.append(dialog);
  confirmParts = { dialog, title, text, ok };
  return confirmParts;
}

export function confirmAction(title, message, label, danger = false) {
  const parts = getConfirmParts();
  return new Promise((resolve) => {
    parts.title.textContent = title;
    parts.text.textContent = message;
    parts.ok.textContent = label;
    parts.ok.classList.toggle('btn-danger', danger);
    parts.dialog.returnValue = '';
    parts.dialog.addEventListener('close', () => resolve(parts.dialog.returnValue === 'ok'), { once: true });
    parts.dialog.showModal();
  });
}

// ---------------------------------------------------------------------------
// Authentication gate
// ---------------------------------------------------------------------------
// style.css hides the page until this runs. The gate is a usability measure:
// real protection comes from Row Level Security in the database.
export async function requireAuth() {
  let session = null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    session = data.session;
  } catch (error) {
    handleError(error, { toast: false });
  }

  if (!session) {
    location.replace('login.html');
    return null;
  }

  // Signing out in another tab signs out this one too.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') location.replace('login.html');
  });

  document.body.classList.add('ready');
  return session.user;
}

export async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (error) {
    handleError(error);
    return;
  }
  location.replace('login.html');
}

// ---------------------------------------------------------------------------
// Navigation — the only place the menu markup is built
// ---------------------------------------------------------------------------
function pageName(path) {
  const last = path.split('/').pop().replace(/\.html$/, '');
  return last === '' ? 'index' : last;
}

export function renderNav(user) {
  const nav = document.getElementById('nav');
  nav.replaceChildren();

  const bar = el('div', 'nav-bar');
  const brand = el('a', 'brand', BUSINESS_NAME);
  brand.href = 'index.html';
  const toggle = el('button', 'nav-toggle', 'Menu');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'nav-panel');
  bar.append(brand, toggle);

  const panel = el('div', 'nav-panel');
  panel.id = 'nav-panel';

  const links = el('ul', 'nav-links');
  const here = pageName(location.pathname);
  for (const item of NAV) {
    const link = el('a', 'nav-link', item.label);
    link.href = item.href;
    if (pageName(item.href) === here) link.setAttribute('aria-current', 'page');
    const row = el('li');
    row.append(link);
    links.append(row);
  }

  const account = el('div', 'nav-user');
  account.append(el('span', 'nav-email', user?.email ?? ''));
  const out = el('button', 'btn btn-quiet', 'Sign out');
  out.type = 'button';
  out.addEventListener('click', async () => {
    out.disabled = true; // guard against double clicks
    await signOut();
    out.disabled = false; // only reached if sign-out failed
  });
  account.append(out);

  panel.append(links, account);
  nav.append(bar, panel);

  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('nav-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}
