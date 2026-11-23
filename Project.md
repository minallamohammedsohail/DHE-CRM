# Tile Business CRM — Project Instructions

Status: **architecture approved.** Review completed and decisions locked on 2026-11-23.
Implementation has not started. No code, no database tables, no deployment yet.

## 1. Project Goal

Build a simple, reliable, mobile-friendly CRM for a tile business.

The CRM's primary purpose is to:
- Capture potential customers and enquiries.
- Track leads through the sales process.
- Ensure customers are followed up on time.
- Convert leads into customers.
- Track basic customer orders and revenue.
- Help the business increase lead conversion and sales.

The application must prioritize reliability, simplicity, ease of use, and maintainability over complexity.

We are prioritizing reliability, simplicity and finishing the project over adding complexity.

## 2. Mandatory Technology Stack (LOCKED)

Use only:

- HTML5
- CSS3
- Vanilla JavaScript (ES6+ modules)
- Supabase (PostgreSQL database and authentication)
- Supabase JavaScript client loaded from its official CDN, **pinned to an exact version**
- Vercel for static hosting
- Git and GitHub for version control

Do NOT use:

- React
- Next.js
- Vue
- Angular
- TypeScript
- Node.js backend
- Express
- Redux
- Tailwind
- Bootstrap
- jQuery
- Build tools
- Webpack
- Vite
- Docker
- Unnecessary npm packages
- Any framework or dependency unless explicitly approved

Do not introduce a new technology without explaining why it is necessary and asking for approval first.

### 2.1 Supabase client version pinning

Import the Supabase client from an exact version URL, never a floating major range:

```js
// Correct — exact version
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';

// Wrong — a third-party update can break production with no change on our side
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
```

The version shown above is illustrative. Confirm the current published version on the CDN during Phase 0 before pinning it, and record the exact version in use as a comment in `js/config.js`. Upgrading the version is a deliberate, tested, committed change.

## 3. Architecture

This is a static multi-page frontend application.

The browser runs the HTML, CSS, and JavaScript.

The frontend communicates directly with Supabase using the Supabase JavaScript client.

Supabase handles:
- PostgreSQL database
- Authentication
- Row Level Security
- Data persistence

There must be no custom backend server. There are no Edge Functions, no serverless functions and no build step.

Use ES modules and a simple modular file structure: one JS module per page, plus one shared `app.js`.

### 3.1 Access model

- **Multi-user shared CRM** for a small number of authorized users.
- **All authorized users share the same business data.** Every authenticated user can read and write all leads, customers, follow-ups and orders.
- **No public sign-up.** Accounts are created manually in the Supabase dashboard.
- `created_by` is recorded on every row for auditing, not for access control.

### 3.2 Shared application shell

- Navigation is rendered by **one function in `app.js`** into an empty `<nav id="nav">` on each page. Navigation markup is never duplicated across HTML files.
- The CRM shell is **hidden until authentication is verified**. `style.css` sets `body { visibility: hidden }`; the auth gate reveals it only after the Supabase session resolves. This prevents an unauthenticated visitor briefly seeing CRM content before the redirect.
- The route guard is a usability measure only. It is **not** a security boundary. Security comes from Row Level Security.

### 3.3 Timezone

The business timezone is **Asia/Kolkata**.

All timestamps are stored as `timestamptz` (UTC) in the database. All "today", "overdue", "this month" and day/month boundary calculations are performed in Asia/Kolkata through a single shared helper in `app.js`. Never derive day boundaries from raw UTC values or from the browser's local timezone.

## 4. Folder Structure

Maintain this structure unless a change is necessary and approved.

```
tile-crm/
├── index.html              Dashboard
├── login.html              Authentication
├── leads.html
├── customers.html
├── followups.html
├── orders.html
├── Project.md
├── .gitignore
├── css/
│   └── style.css           Single stylesheet, media queries included
├── js/
│   ├── config.js           Supabase URL + anon key (committed)
│   ├── supabase.js         Client creation
│   ├── app.js              Shared: auth gate, nav, helpers, constants
│   ├── dashboard.js
│   ├── leads.js
│   ├── customers.js
│   ├── followups.js
│   └── orders.js
├── db/
│   └── schema.sql          Full schema, constraints, indexes, triggers, RLS
└── assets/
    └── images/
```

Notes:
- `css/responsive.css` has been **merged into `style.css`**. One stylesheet; media queries live beside the rules they override.
- `db/schema.sql` is the authoritative record of the database. The schema must never exist only inside the Supabase web dashboard.
- Create `assets/images/` only when an image is actually needed.
- Do not add `components/`, `utils/`, `services/`, a router, or any further directory.

Do not create unnecessary files, folders, abstractions, or duplicate utilities.

## 5. Database Tables

Use only these four tables.

All tables include:
- `id uuid primary key default gen_random_uuid()`
- `created_at timestamptz not null default now()`
- `created_by uuid references auth.users(id) default auth.uid()`
- `updated_at timestamptz not null default now()`, maintained by a `set_updated_at()` BEFORE UPDATE trigger

### leads

- `id` — UUID primary key
- `name` — text, required
- `phone` — text, required (as entered)
- `phone_norm` — text, generated stored, `regexp_replace(phone, '\D', '', 'g')`
- `location` — text
- `source` — text
- `requirement` — text
- `interested_product` — text
- `budget` — numeric
- `status` — text, not null, default `'New'`, CHECK constrained
- `notes` — text
- `archived_at` — timestamptz, nullable
- `created_at`, `created_by`, `updated_at`

Lead statuses (CHECK constraint):
`New`, `Contacted`, `Interested`, `Site Visit`, `Negotiation`, `Converted`, `Lost`

**Leads are archived, never permanently deleted from the UI.** "Delete" sets `archived_at = now()`; "Restore" sets it back to `NULL`. Archived leads are excluded from all lists, searches, filters and dashboard counts by default, and are reachable through an explicit "Archived" view. This preserves the lead's follow-up and order history.

### customers

- `id` — UUID primary key
- `lead_id` — UUID, nullable, references `leads(id)`
- `name` — text, required
- `phone` — text, required
- `phone_norm` — text, generated stored, `regexp_replace(phone, '\D', '', 'g')`, **unique index**
- `location` — text
- `notes` — text
- `created_at`, `created_by`, `updated_at`

Duplicate customers are prevented by the unique index on `phone_norm`, enforced by the database rather than by a client-side check. During lead conversion, look up the existing customer by `phone_norm` first; if one exists, link the lead to it instead of creating a second record.

### followups

- `id` — UUID primary key
- `lead_id` — UUID, nullable, references `leads(id)`
- `customer_id` — UUID, nullable, references `customers(id)`
- `scheduled_at` — timestamptz, required
- `note` — text
- `status` — text, not null, default `'Pending'`, CHECK constrained
- `completed_at` — timestamptz, nullable
- `created_at`, `created_by`, `updated_at`

Follow-up statuses (CHECK constraint):
`Pending`, `Completed`, `Cancelled`

Constraint: `CHECK (lead_id IS NOT NULL OR customer_id IS NOT NULL)` — a follow-up must have a parent.

### orders

- `id` — UUID primary key
- `customer_id` — UUID, not null, references `customers(id)`
- `lead_id` — UUID, nullable, references `leads(id)`
- `order_date` — date, not null, default current date in Asia/Kolkata
- `description` — text
- `quantity` — numeric
- `unit` — text
- `total_amount` — numeric(12,2), not null, CHECK `>= 0`
- `amount_paid` — numeric(12,2), not null, default 0, CHECK `>= 0`
- `balance` — numeric(12,2), **generated always as `(total_amount - amount_paid)` stored**
- `status` — text, not null, default `'Pending'`, CHECK constrained
- `notes` — text
- `created_at`, `created_by`, `updated_at`

Order statuses (CHECK constraint):
`Pending`, `Confirmed`, `Delivered`, `Cancelled`

Outstanding amount is the generated `balance` column. It is never recomputed in JavaScript.

### Foreign-key deletion behavior

Explicitly defined, even though the UI exposes no hard deletes for leads:

| Foreign key | On delete | Reason |
|---|---|---|
| `customers.lead_id` → `leads.id` | `SET NULL` | The customer survives; it just loses its origin link. |
| `followups.lead_id` → `leads.id` | `CASCADE` | A follow-up has no meaning without its parent. |
| `followups.customer_id` → `customers.id` | `CASCADE` | Same. |
| `orders.customer_id` → `customers.id` | `RESTRICT` | An order must never lose its customer. Revenue history is protected. |
| `orders.lead_id` → `leads.id` | `SET NULL` | Attribution link only. |

### Indexes

- `leads(status)`
- `leads(created_at DESC)`
- `leads(phone_norm)`
- `leads(archived_at)` — partial index on `archived_at IS NULL` for the default list
- `customers(phone_norm)` — UNIQUE
- `followups(status, scheduled_at)`
- `orders(customer_id)`
- `orders(order_date)`

Nothing further. `ILIKE '%term%'` search is adequate at this data volume; no `pg_trgm` extension is needed.

### Status constants

Every status list exists in exactly two places that must agree: the database CHECK constraint in `db/schema.sql`, and an exported constant in `js/app.js` used to build dropdowns and filters. Never hard-code a status string anywhere else.

Do not modify the schema without explaining the reason and obtaining approval. Schema changes are made in `db/schema.sql` and committed.

## 6. Core Features

### Dashboard
Display:
- New leads this month
- Active leads
- Follow-ups due today
- Overdue follow-ups
- Leads converted this month
- Revenue this month
- Recent leads
- Lead pipeline summary
- Recent orders

All counts exclude archived leads. All date windows are computed in Asia/Kolkata. Counters use `{ count: 'exact', head: true }` queries run in parallel with `Promise.all`, so no row data is transferred for a number.

**The dashboard is built last**, after leads, customers, follow-ups and orders all work. It reads from every table, so building it earlier would produce widgets that cannot be verified.

### Leads
- Add lead
- View lead
- Edit lead
- Archive lead with confirmation
- Restore archived lead
- View archived leads
- Search leads
- Filter by status
- Filter by source
- Sort leads
- Change status
- Add notes
- Open phone dialer
- Open WhatsApp chat
- Schedule follow-up
- Convert lead to customer

### Customers
- Add customer manually
- Search customers
- View customer profile
- Edit customer
- View associated leads
- View follow-up history
- View order history
- Call customer
- WhatsApp customer

### Follow-ups
- View today's follow-ups
- View overdue follow-ups
- View upcoming follow-ups
- Mark as completed
- Cancel follow-up
- Add follow-up
- Call or WhatsApp the related customer
- Navigate to related lead or customer

### Orders
- Create order
- Edit order
- View order
- Record amount paid
- Show outstanding amount (the generated `balance` column)
- Update order status
- View order history by customer
- Search and filter orders

### Communication and phone numbers

Phone input accepts **Indian mobile numbers**. Normalization is performed by one shared helper in `app.js` and applied consistently everywhere:

1. Strip every non-digit character.
2. Drop a leading `0`.
3. Drop a leading `91` if the result would otherwise be 12 digits.
4. The result must be 10 digits beginning with 6, 7, 8 or 9. Anything else fails validation with a clear message.

Link formats:
- Dialer: `tel:+91XXXXXXXXXX`
- WhatsApp: `https://wa.me/91XXXXXXXXXX` — country code `91`, no `+`, no spaces, no dashes

Prefilled WhatsApp message text must be passed through `encodeURIComponent`. A phone number must pass normalization and validation **before** it is placed in any `href`.

WhatsApp messages may be prefilled but must never be automatically sent.

## 7. UI and Design

Create a polished, modern, professional CRM.

Design principles:
- Light theme
- Clean white cards
- Soft neutral background
- Deep navy primary color
- Subtle accent color
- Good typography
- Consistent spacing
- Clear hierarchy
- Minimal clutter
- Subtle borders and shadows
- Responsive design
- Mobile-first usability

Use a consistent sidebar navigation on desktop, rendered from `app.js`.

Navigation:
- Dashboard
- Leads
- Customers
- Follow-ups
- Orders

On mobile, use a compact or collapsible navigation. Tables collapse to cards through CSS only — no JavaScript layout branching.

All modals — add/edit forms and confirmations — use the **native HTML `<dialog>` element**. No modal library. `<dialog>` provides focus trapping and Esc handling for free.

All forms must have:
- Clear labels
- Validation
- Useful error messages
- Loading states
- Success feedback

Use **native HTML validation wherever possible** (`required`, `type`, `pattern`, `min`, `maxlength`) and add a `validate()` function only for business rules the browser cannot express. Do not hand-roll what the browser already does.

All destructive actions require confirmation.

Do not use placeholder buttons. Every button shown must work.

Avoid unnecessary animations, large gradients, decorative elements, excessive icons, or visual clutter.

## 8. Coding Rules

- Write readable, simple JavaScript.
- Use ES modules.
- Use async/await for asynchronous operations.
- Avoid deeply nested callbacks.
- Avoid unnecessary abstractions.
- Avoid duplicate code when a simple shared helper is useful.
- Keep each page's functionality in its respective JS file.
- Keep shared functions in `app.js` only when genuinely shared — when a second page needs them, not in anticipation.
- Do not rewrite working files unnecessarily.
- Do not modify unrelated features when implementing a request.
- Do not create mock features that appear functional but are not connected.
- Do not silently swallow errors.
- Use proper try/catch handling for database operations.
- Show user-friendly error messages.
- Validate user input before database operations.
- Prevent unsafe HTML injection. Do not insert user-provided text using unsafe `innerHTML`.
- Use `textContent` or safe DOM creation for user-provided content.

### 8.1 Shared helpers in `app.js`

`app.js` is the only shared module. It exports:

- The Supabase client (from `supabase.js`)
- `requireAuth()` — the auth gate; reveals the shell or redirects to `login.html`
- `renderNav()` — the single navigation renderer
- `signOut()`
- Status constants for leads, follow-ups and orders
- `normalizePhone()`, `isValidIndianMobile()`, `telLink()`, `whatsappLink()`
- `formatMoney()`, `formatDate()`, `todayIST()`, `startOfMonthIST()`
- `toast(message, type)` — the shared success/error notifier
- `handleError(error)` — logs the real error, shows a readable message through `toast`

### 8.2 Error handling

Every database call is wrapped in try/catch and every catch routes through the single `handleError()` helper. It logs the underlying error to the console for debugging and shows a readable message to the user. Errors are never swallowed and raw Postgres messages are never shown verbatim.

### 8.3 Double-submission protection

Every form submit handler must:

1. Set an in-flight flag and disable the submit button as its first action.
2. Show a loading state.
3. Re-enable the button and clear the flag in a `finally` block.

This is mandatory on every create and update form, without exception.

### 8.4 Rendering pattern

One pattern, repeated on every page: `load()` → query → clear the `<tbody>` → build rows with `document.createElement` and `textContent`. No templating engine. No `innerHTML` containing user data.

## 9. Security Rules

- Never place a Supabase service-role key in frontend code, in the repository, or anywhere outside the Supabase dashboard. This project has no backend and no Edge Functions, so the service-role key should never be needed at all.
- Only use the Supabase anon/publishable key in the frontend.
- **`js/config.js` is committed to the repository**, containing the Supabase project URL and the anon/publishable key. This key is public by design; it is protected by Row Level Security, not by secrecy. With no build step there is no way to inject it at deploy time, so gitignoring it would break production.
- **Public sign-up must be disabled** in the Supabase dashboard. Accounts are created manually. With sign-up enabled, anyone reading the anon key from the published JavaScript could register and gain full access to all data.
- **Enable Row Level Security on every table, in the same SQL statement block that creates it.** A table reachable with the anon key and no RLS is a public API over the customer list.
- Create policies for the `authenticated` role only. Grant `anon` nothing — no policies, no function grants, no table grants.
- All authenticated users share full read/write access to all business data (decision 2). `created_by` is for auditing, not authorization.
- **Verify RLS before go-live.** Query each of the four table endpoints with only the anon key and an unauthenticated session, and confirm zero rows are returned. This is the only proof that RLS works; do not assume it.
- Do not assume frontend checks provide security.
- Do not commit secrets to GitHub. `.gitignore` covers `.env` and any local scratch files. `js/config.js` is deliberately not in it.

## 10. Development Workflow

Build the CRM incrementally.

Never attempt to build the entire application in one operation.

The workflow is:

1. Plan the feature.
2. Identify the files that need modification.
3. Implement only that feature.
4. Review the changes.
5. Test the feature.
6. Fix errors.
7. Confirm the feature works.
8. Update Project.md with completed work.
9. Commit to Git.
10. Move to the next feature.

Do not start the next feature before the current feature is tested.

## 11. Implementation Order (APPROVED)

Each phase ends with something testable. Nothing depends on code that does not yet exist.

| Phase | Work | Rationale |
|---|---|---|
| 0 | Supabase project created; `db/schema.sql` written and applied; RLS enabled and verified blocked for `anon`; public sign-up disabled; user accounts created manually. `git init`, GitHub repository, Vercel deploying a placeholder page. | Prove the whole pipeline — database through to a deployed URL — before writing any feature. A pipeline problem found on day one costs minutes. |
| 1 | Auth and shell: `login.html`, session guard, hidden-until-verified shell, logout, `renderNav()`, `style.css` foundation (colors, cards, forms, buttons, dialogs, responsive nav). | Every later page inherits this. Build the design system once. |
| 2 | **Leads** — full CRUD, archive/restore, search, status and source filters, sort, status change, notes, call and WhatsApp links. | The core of the product. Exercises every pattern the other pages reuse. |
| 3 | **Customers** and lead-to-customer conversion with phone deduplication. | Needs leads. Conversion is the trickiest logic in the app. |
| 4 | **Follow-ups** — today, overdue, upcoming; complete; cancel; schedule from a lead. | Needs leads and customers as parents. |
| 5 | **Orders** — create, edit, record payment, outstanding balance, status. | Needs customers. |
| 6 | **Dashboard** — all nine widgets. | Reads from all four tables. Built last so every number is verifiable against real data. |
| 7 | Hardening — empty states, invalid input, database-failure paths, mobile pass on a real device, roughly 30 dummy records exercised then removed. | Section 12's test list, run against something complete. |

## 12. Testing

Test:
- Empty states
- Invalid form inputs
- Duplicate phone numbers
- Database failures
- Loading states
- Search
- Filters
- Mobile layout
- Edit operations
- Archive and restore operations
- Lead conversion
- Follow-up completion
- Order calculations
- Day and month boundaries in Asia/Kolkata
- Double form submission
- RLS: unauthenticated access with the anon key returns nothing

Never claim something is tested if it has not actually been tested.

## 13. Development Environment

Use VS Code with a simple local static server, such as Live Server, during development.

Do not open module-based HTML pages directly through `file://`. ES module imports require a local HTTP server.

The application must run without a build or compilation step.

## 14. Git

Use Git regularly.

Commit after each stable feature.

Do not force push.

Do not delete or overwrite user work.

Before large changes, inspect the current Git status.

## 15. Claude Code Behavior

Before starting a task:
1. Read this Project.md.
2. Inspect the relevant files.
3. Check existing functionality.
4. Explain the proposed changes briefly.
5. Implement only the requested scope.

Do not:
- Change the technology stack.
- Add packages without approval.
- Rebuild the project unnecessarily.
- Rewrite working functionality.
- Make unrelated modifications.
- Guess requirements that affect data.
- Perform large refactors without approval.

If there are multiple possible solutions, choose the simplest reliable solution.

If a problem can be solved with a few lines of vanilla JavaScript, do not introduce a library.

If uncertain about a major architectural decision, stop and ask before proceeding.

## 16. Definition of Done

A feature is considered complete only when:
- It works as intended.
- Its UI is responsive.
- Its database operations work.
- Validation works.
- Errors are handled through the shared helper.
- Double submission is prevented.
- Existing features are not broken.
- No placeholder functionality remains.
- The changes are documented briefly in Project.md.

## 17. Current Project Status

Project status: **Phases 0 to 5 complete. Phase 6 (Dashboard) next.**

Completed:
- Technology stack selected and locked; architecture reviewed and approved
- Phase 0: schema applied; RLS enabled and verified; sign-up disabled; accounts created; GitHub repository; Vercel placeholder
- Phase 1: auth gate, shared nav, toast and error handling, style foundation, login page
- Phase 2: Leads
- Phase 3: Customers and lead conversion
- Phase 4: Follow-ups (IST calendar-day buckets; archiving a lead cancels its pending follow-ups)
- Phase 5: Orders. `orders.html`, `js/orders.js`; exact-money helpers in `app.js`; Orders section and "Add order" on the customer profile.

Decisions applied in Phase 5 (defaults approved):
- D1 payments are one running "amount paid" per order; "Record payment" adds to it; it can also be corrected by editing the order. There is no per-payment history (that would need a fifth table).
- D2 overpayment is allowed after a confirmation; the balance shows as "Overpaid"
- D3 `unit` is a fixed list (Box, Piece, Sq. ft.) via a CHECK constraint; quantity and unit are given together or not at all
- D4 required: customer, description, total above 0, order date not in the future (defaults to today in IST)
- D5 any status can move to any other; Cancelled needs confirmation and warns when money is recorded as paid; orders are never deleted
- D6 add on the Orders page with a customer search, or from the customer profile (`orders.html?customer=<id>`); `lead_id` is copied from the customer's origin lead automatically
- D7 "Record payment", order edits and status changes check the order is unchanged since it was loaded (`amount_paid` for payments, `updated_at` otherwise) and refuse with a message and a refresh if someone else changed it. Amounts are handled in whole paise.
- Cancelled orders show no balance and are excluded from the "Outstanding" and "Paid in full" filters and from a customer's outstanding total. "Outstanding" on a customer profile sums only orders with a positive balance; an overpaid order is not netted against another order.

Phase 5 tested (locally, signed in, temporary rows, all deleted afterwards):
- Money helpers in Node (default timezone, Los Angeles, Auckland): 0.10 + 0.20 is exactly 0.30; valid and invalid amount strings; 3-decimal input is rejected before any arithmetic
- Payments through the page: 0.10 then 0.20 gives exactly 0.30, then up to exactly 10,000; zero, negative and 3-decimal amounts blocked; live new-balance preview; overpayment prompt (dismiss keeps the dialog open and data unchanged, confirm records it and shows "Overpaid")
- Concurrency: another user changes the order while a payment dialog, an edit form, or a status dropdown is open; each save is refused, nothing is overwritten, the user sees the message and the list refreshes; a clean edit still saves (the `updated_at` guard matches exactly). A bug found here (message hidden in a closed dialog) was fixed and re-tested.
- Validation proven in two layers: the browser's native checks block every bad case; with those removed, my own checks alone reject blank description, future date, year 1999, zero total, 3-decimal total, paid and quantity, negative paid, zero quantity, quantity without unit, unit without quantity, `1e3` and an amount too large for the column
- Add: customer picker (too short, by name, by phone, no match, hostile characters), nothing chosen, overpayment on create, valid add with quantity and unit, triple submit creates one row
- Status: normal change; Cancel with money recorded (dismiss reverts the dropdown, confirm cancels); un-cancel; cancelled row muted with no balance
- View and edit dialogs: contents, prefilled edit with the customer locked, saved values, `created_at` and customer unchanged, `updated_at` moves
- Search, filters and sorts compared against results computed independently from the raw database rows: customer name, phone, description and notes, phrase, no match, each status, outstanding, paid in full, date from, to, range, same day, a combination, reversed range message, and all four sorts including full tie-break order
- `?customer=` links: valid, invalid id, valid id that does not exist
- Customer profile: order history, outstanding total checked against an independent calculation (cancelled excluded), "Add order" link, empty state
- The database refuses to delete a customer who has orders (`ON DELETE RESTRICT`, error 23503)
- A script tag and an `<img onerror>` in a customer name and an order description render as plain text; nothing executed
- Offline load shows a friendly message after about 7 seconds
- Regression: lead search and conversion, follow-up picker and creation; no JavaScript errors
- Layout at desktop and phone width; no horizontal overflow on phones; fixed cramped filters, wrapping actions, and row actions that were only 24px tall (now 46px on phones)

Database constraint `orders_unit_check` (applied to the live database and verified):
- Rejected with error 23514 naming `orders_unit_check`: `Kg`, `Sq. m`, `box` (lowercase), `Box ` (trailing space), `Sq.ft.` and an empty string
- Accepted: `Box`, `Piece`, `Sq. ft.` and no unit (NULL)
- An update to an invalid unit is also rejected
- The app stores NULL, never an empty string, when no unit is chosen

Known behaviour and limits:
- No per-payment history and no order numbers (orders are identified by customer, date and description); either would be a schema addition
- Lists show at most 200 rows
- Order search matches customers by name or phone (every word), and descriptions or notes by the whole phrase; at most the first 100 matching customers are used
- With no network, loads show no error for about 7 seconds while the Supabase client retries
- On phones the filter block is tall; the first order appears below about five rows of filters
- Modal dialogs cannot be captured in screenshots; they were checked through page state
- Carried from Phase 2: one unexplained, unreproduced stuck Save button after a duplicate-warning Cancel
- Not tested: the deployed Vercel site with Phase 1 to 5 code; signing out in a second tab

Next:
- Phase 6: Dashboard (all nine widgets). Open question O3 (what "Revenue this month" means) must be settled first; my default is the sum of `total_amount` for non-cancelled orders dated this month.

## 18. Open Questions

These do not block Phase 0 but must be answered before the phase that depends on them.

| # | Question | Proposed default | Needed by |
|---|---|---|---|
| O1 | Is `leads.source` a free-text field or a fixed list? A fixed list allows a CHECK constraint and a reliable filter dropdown. | Fixed list: Walk-in, Referral, Phone, WhatsApp, Instagram, Website, Other | Phase 2 |
| O2 | May `amount_paid` exceed `total_amount` (advance or overpayment), making `balance` negative? | Allowed; no upper CHECK | Phase 5 |
| O3 | Does "Revenue this month" mean the total of orders dated this month, or payments received this month? Do Cancelled orders count? | Sum of `total_amount` for orders with `order_date` in this month, excluding Cancelled | Phase 6 |
| O4 | Is `orders.unit` free text or a fixed list? | Fixed list: Box, Piece, Sq. ft. | Phase 5 |
| O5 | Can any authenticated user restore an archived lead, or is that restricted? | Any authenticated user; the action is logged by `created_by`/`updated_at` | Phase 2 |
| O6 | Do customers also need archiving, or only leads? | Only leads for now | Phase 3 |
| O7 | Is email confirmation enabled on the Supabase project? Manually created users need confirming or login fails with an unclear error. | Disabled, since accounts are created by hand | Phase 0 |
| O8 | Should the repository file be `Project.md` or `PROJECT.md`? Git is case-sensitive even though Windows is not. | Keep `Project.md` as it exists now | Phase 0 |
