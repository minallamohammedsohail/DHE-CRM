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
- `source` — text, nullable, fixed list enforced by CHECK `leads_source_check`: Walk-in, Referral, Phone, WhatsApp, Instagram, Website, Other (matches `LEAD_SOURCES` in `app.js`)
- `requirement` — text
- `interested_product` — text
- `budget` — numeric
- `status` — text, not null, default `'New'`, CHECK constrained
- `notes` — text
- `archived_at` — timestamptz, nullable
- `converted_at` — timestamptz, nullable; set by the app when the lead is converted to a customer; used by the dashboard's "leads converted this month"
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
- `unit` — text, nullable, fixed list enforced by CHECK `orders_unit_check`: Box, Piece, Sq. ft. (matches `ORDER_UNITS` in `app.js`); quantity and unit are given together or not at all
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

Project status: **All six build phases are complete. Remaining work is hardening (section 11, phase 7) and go-live checks.**

Completed:
- Phase 0: schema applied; RLS enabled and verified; sign-up disabled; accounts created; GitHub repository; Vercel placeholder
- Phase 1: auth gate, shared nav, toast and error handling, style foundation, login page
- Phase 2: Leads
- Phase 3: Customers and lead conversion
- Phase 4: Follow-ups (IST calendar-day buckets; archiving a lead cancels its pending follow-ups)
- Phase 5: Orders (exact-paise money, concurrent-edit protection, no per-payment history)
- Phase 6: Dashboard. `index.html`, `js/dashboard.js`; IST month helper in `app.js`; `leads.converted_at`; click-through parameters `?status=` (leads), `?tab=` (follow-ups) and `?q=` (orders).

Decisions applied in Phase 6 (defaults approved):
- D1 Revenue this month = sum of `total_amount` of non-cancelled orders dated in the current IST month, with the order count shown
- D2 Active leads = non-archived leads in New, Contacted, Interested, Site Visit or Negotiation; computed from the pipeline counts so the tile and pipeline always agree
- D3 Leads converted this month uses `converted_at`, set at conversion (both the new-customer and the link-to-existing paths); archived leads are excluded
- D4 all lead counts exclude archived leads; "New leads this month" = created this month and not archived
- D5 follow-up tiles use the Phase 4 definitions (pending, IST calendar day)
- D6 recent leads and recent orders show the latest 5; the pipeline shows all 7 statuses as bars
- D7 click-through: follow-up tiles open the matching tab; pipeline rows open Leads filtered to that status; recent items open their records
- Each widget loads independently; a failure shows "—" (or "Could not load this section") for that widget only, with a Refresh button and one error toast. No auto-refresh.

Phase 6 tested (locally, signed in, temporary rows, all deleted afterwards):
- Month helper in Node (default timezone, Los Angeles, Auckland): 12 checks including 23:59:59 IST on 30 Nov versus 00:00:00 on 1 Dec, December into January, leap and non-leap February, and UTC still on the 31st while India is already in the next month
- Empty database: zeros and "No leads yet" / "No orders yet"
- Data placed exactly on the month and day edges, with archived leads and cancelled orders. Every tile and the pipeline matched a hand calculation and an independent recomputation from the raw rows; revenue is exactly ₹3,500.30 (1,000.10 + 2,000.20 + 500) and excludes cancelled and out-of-month orders
- `converted_at`: leads converted one second inside and outside each month boundary and an archived converted lead are counted correctly; converting through the real button stamps `converted_at` on both paths
- India's midnight passed during testing; the dashboard correctly moved a follow-up from overdue to today and two from today to overdue (due today 2 to 1, overdue 1 to 3), matching predictions
- Failure isolation: blocking only order requests fails only Revenue and Recent orders; fully offline shows "—" everywhere with one friendly message after about 7 seconds, and Refresh recovers; the Refresh button disables and shows a loading state while running
- Click-throughs: tiles, pipeline rows, recent leads and recent orders land on the right filtered views; invalid `?status=` and `?tab=` values (including `__proto__`) are ignored
- A script tag, an `<img onerror>` and similar text in lead names and order descriptions render as plain text
- Layout at desktop and phone width; no horizontal overflow on phones
- Regression: follow-ups default tab and counts, order search and status filter, customer profile (leads, follow-ups, orders, outstanding total)
- A bug found during testing: none in the dashboard itself; one false alarm came from the test comparing timestamps as text

Known behaviour and limits:
- No auto-refresh; the figures are as of the last load or Refresh
- Revenue is booked orders, not cash collected; there is no per-payment history
- The overdue and due-today counts rely on the browser's clock being correct
- Revenue pages through orders 1000 at a time in the browser; it is correct for any volume but would slow for very large months
- Pending follow-ups left on an archived lead (only if the cancel step failed at archive time) are still counted
- With no network, loads show no error for about 7 seconds while the Supabase client retries
- Lists show at most 200 rows
- Modal dialogs cannot be captured in screenshots; they were checked through page state
- Carried from Phase 2: one unexplained, unreproduced stuck Save button after a duplicate-warning Cancel
- Not tested: signing in on the deployed site (needs a real password, which only the owner should type); signing out in a second tab; real phone hardware

Deployment (https://dhe-crm-nine.vercel.app/), verified against commit d3b1530:
- All 15 served files (6 pages, `style.css`, 8 JavaScript files) are byte-identical to the committed versions; Vercel is deploying from `main` automatically
- JavaScript is served as `application/javascript`; caching is `max-age=0, must-revalidate`, so a push is visible immediately; HTTPS with HSTS
- No service-role key in any served file; `config.js` holds a `sb_publishable_` key only; no email addresses, passwords or project URLs in any tracked file
- Signed out, all five protected pages end on `login.html`, and protected content never appears, sampled every 60 ms for 4.5 seconds each
- A wrong password on the live site shows "Incorrect email or password.", sends one request from a triple submit, and the form recovers
- Using the key from the live `config.js`: anonymous read, insert, update and delete are all refused with `permission denied` (42501) on `leads`, `customers`, `followups` and `orders`; sign-up is refused ("Signups not allowed for this instance"); the REST root, which would reveal the schema, requires a secret key
- Publicly served but harmless: `Project.md`, `db/schema.sql` and `.gitattributes` (design documentation; no secrets)
- Security headers set by Vercel: only `Strict-Transport-Security`. Not set: `X-Content-Type-Options`, `X-Frame-Options` or CSP `frame-ancestors`, `Referrer-Policy`, `Content-Security-Policy`. Adding them needs a `vercel.json`, which is a new file and needs approval.

Next:
- Phase 7 hardening (section 11): the owner signs in on the deployed site and works through each page on a real phone; decide on the security headers and on hiding the documentation files; change the passwords used during testing; decide who else gets an account

## 18. Resolved Questions

All questions raised during planning have been answered. None are open.

| # | Question | Decision |
|---|---|---|
| O1 | Is `leads.source` free text or a fixed list? | Fixed list: Walk-in, Referral, Phone, WhatsApp, Instagram, Website, Other (CHECK constraint) |
| O2 | May `amount_paid` exceed `total_amount`? | Yes, after a confirmation; the balance shows as "Overpaid" |
| O3 | What does "Revenue this month" mean? | Booked orders: the sum of `total_amount` for non-cancelled orders dated in the current IST month. Cash collected cannot be reported accurately without a per-payment history. |
| O4 | Is `orders.unit` free text or a fixed list? | Fixed list: Box, Piece, Sq. ft. (CHECK constraint) |
| O5 | Who can restore an archived lead? | Any signed-in user |
| O6 | Do customers need archiving? | No; leads only |
| O7 | Is email confirmation enabled? | No, since accounts are created by hand |
| O8 | `Project.md` or `PROJECT.md`? | `Project.md` |

Possible future additions that would each need a schema change and your approval: a per-payment history table (receipts, cash-collected reporting) and an order number column.
