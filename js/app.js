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
];

// Status and source lists. Each must always match the CHECK constraint of the
// same column in db/schema.sql. Never hard-code these strings elsewhere.
export const LEAD_STATUSES = ['New', 'Contacted', 'Interested', 'Site Visit', 'Negotiation', 'Converted', 'Lost'];
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
