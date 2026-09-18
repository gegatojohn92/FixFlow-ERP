# FixFlow ERP — AI Agent Handoff & Architecture Blueprint

> **Purpose:** This document is a comprehensive technical handoff for any AI Agent or software engineer continuing development, maintenance, or auditing of **FixFlow ERP**. It synthesizes all architectural decisions, database schemas, role matrices, security guardrails, form workflows (Forms 1–18), and current system status.

---

## 1. Executive Summary & Tech Stack

FixFlow ERP is an enterprise operations management system engineered for facility operations, maintenance workflows, material requisitions, and four-step financial chain-of-custody.

### Technology Stack
- **Framework:** Next.js 16 (App Router with Webpack — see Next.js conventions below)
- **Language:** TypeScript 5 (strict typing)
- **Database & Auth:** Supabase (PostgreSQL 15+, Row Level Security, Storage Buckets, GoTrue Auth)
- **Styling:** Vanilla Tailwind CSS with high-contrast slate-950 dark theme, custom status badges, and responsive glassmorphic cards
- **Icons:** Lucide React
- **PWA:** `next-pwa` / Serwist service worker with offline fallbacks and complete icon manifests (`public/icons/`)
- **Route Guard:** `src/proxy.ts` (Next.js 16 proxy pattern for RBAC and session refresh)

---

## 2. Directory Structure & Key Files

```
FixFlow-ERP/
├── public/
│   ├── icons/                    # PWA icons (192, 512, maskable, apple-touch, shortcuts)
│   ├── manifest.webmanifest      # PWA Web Manifest
│   └── sw.js                     # PWA Service Worker (build generated)
├── scripts/
│   ├── generate-icons.mjs        # Script to regenerate PWA icons using Sharp
│   ├── verify-schema.js          # DB schema verification script
│   └── verify-rls.js             # RLS verification script
├── src/
│   ├── app/
│   │   ├── (dashboard)/
│   │   │   ├── admin/users/      # Form 18: User Management (SUPER_ADMIN, MANAGER)
│   │   │   ├── delivery/verify/  # Form 14: Receiving & Inspection
│   │   │   ├── jo/               # Forms 1–4: Job Orders (new, track, queue, escalated)
│   │   │   ├── mrs/              # Forms 5–9: Material Requisition (new, stock, manager, canvass, queue)
│   │   │   ├── pms/              # Forms 15–16 & Register: Preventive Maintenance System
│   │   │   ├── purchaser/queue/  # Form 13: PO & Order Placement
│   │   │   ├── reports/expense/  # Form 17: Deep-Link Expense Analytics
│   │   │   ├── transmittals/     # Forms 10–12: Financial Transmittals Hub & Sub-queues
│   │   │   ├── dashboard/        # Role-based KPI Overview & Analytics
│   │   │   └── layout.tsx        # Dashboard shell with responsive navigation
│   │   ├── login/                # Authentication page
│   │   ├── layout.tsx            # Root HTML layout & font preloads
│   │   └── globals.css           # Design tokens & dark mode utilities
│   ├── components/               # Shared reusable UI widgets & modals
│   │   └── layout/MobileNav.tsx  # Mobile bottom bar (role tiles + More sheet) & role FAB
│   ├── lib/
│   │   ├── actions/              # Next.js Server Actions (jo-actions, mrs-actions, transmittal-actions, pms-actions, user-actions)
│   │   ├── supabase/             # Server (`server.ts`) and Client (`client.ts`) Supabase factories
│   │   └── utils.ts              # Common formatters (PHP currency, date formatters)
│   ├── types/
│   │   ├── database.types.ts     # Supabase auto-generated database types
│   │   └── index.ts              # Domain types, enums, and component prop interfaces
│   └── proxy.ts                  # Edge proxy handling RBAC & session cookie sync
├── supabase/
│   └── migrations/
```

### 2.1 Migrations — `supabase/migrations/`

| Migration | File | Description & Critical Notes |
|---|---|---|
| **0001** | `0001_initial_schema.sql` | Core enums (`user_role`, `jo_status`, `mrs_status`, `transmittal_type`, `transmittal_status`, `pms_interval`, etc.) and all 12 foundation tables. |
| **0001b**| `0001_storage_buckets.sql` | Configures Supabase storage buckets (`attachments`, `receipts`, `site-photos`) with authenticated access policies. |
| **0002** | `0002_rls_policies.sql` | Baseline Row-Level Security on all tables. |
| **0003** | `0003_reference_numbering.sql`| Atomic sequence generator function `next_reference_number(prefix, yr)` preventing duplicate reference numbers (`JO-YYYY-XXXX`, `MRS-YYYY-XXXX`, `TR-YYYY-XXXX`, `TR-BATCH-YYYY-XXXX`). |
| **0004** | `0004_cascade_triggers.sql` | Triggers for JO cancellation cascade: auto-voids linked unpurchased MRS, cancels pending transmittals, and generates mandatory `SPARE_CHANGE_RETURN` if cash was disbursed. |
| **0005** | `0005_fix_rls_recursion.sql` | **CRITICAL:** Replaces recursive `users` policies with `get_my_role()` `SECURITY DEFINER` function to eliminate PostgreSQL 500 infinite recursion errors. |
| **0006** | `0006_seed_admin_user.sql` | Seeding script to link an auth user to `public.users` as `SUPER_ADMIN` with `account_status = 'ACTIVE'`. |
| **0007** | `0007_fix_users_rls_for_transmittals.sql` | Supplementary policy granting mutual visibility among financial-chain roles (`SUPER_ADMIN`, `MANAGER`, `ACCOUNTING`, `BUDGET_OFFICER`, `FRONT_DESK`, `PURCHASER`) for transmittal receiver routing. |
| **0008** | `0008_make_storage_buckets_public.sql` | Sets all 4 buckets (`site-photos`, `item-references`, `receipts-proofs`, `messenger-snapshots`) to `public = true` and adds public read RLS on `storage.objects`. Required for `getPublicUrl()` to render in `<img>` tags without 400 errors. |
| **0009** | `0009_audit_events.sql` | Append-only `audit_events` table, `audit_can_view_event()` visibility helper, and system-event triggers for cascade voids/cancellations. |
| **0010** | `0010_fix_jo_delivery_transition.sql` | Allows `AWAITING_MRS_APPROVAL → MATERIALS_RECEIVED` on `job_orders` for Form 14 delivery verification. |
| **0011** | `0011_jo_mrs_flow_enhancements.sql` | **JO/MRS flow hardening:** `job_orders` cancellation/closure audit columns; JO guard fixes dead-end states (`MATERIALS_RECEIVED → COMPLETED`, `COMPLETED → CLOSED`, `IN_PROGRESS → MATERIALS_RECEIVED`); MRS guard wires `IN_TRANSIT` and `EMERGENCY_FAST_TRACK → PURCHASING`; cascade cancellation now auto-generates `SPARE_CHANGE_RETURN` transmittals for disbursed cash and stamps `cancelled_at/by`; new `system_settings` table + `get_setting_numeric()` (fast-track cap, deficit thresholds, batch limit as data); performance indexes on all queue-filter columns. **Applied in the Supabase SQL Editor on 2026-09-18 (after 0010).** |
| **0012** | `0012_strong_mrs_flow_gates.sql` | **Strict MRS flow chain in the DB guard** (mirror of `MRS_TRANSITIONS` in `status-machines.ts`): owner approval → transmittal (Form 10) → Accounting disburse & mark SENT (Form 11) → Purchaser confirm cash & lock float (Form 13) → purchase / save actuals (Form 13) → delivery sign-off by requester's department (Form 14) → Accounting verify spare & close (Form 16). Closes bypass transitions (approved → purchase without transmittal, transmittal → purchasing without disbursement, ship before cash confirm, close before delivery verified). **Applied in the Supabase SQL Editor on 2026-09-18 (after 0011), confirmed by the owner** — `guard_mrs_status_transition()` + `trg_guard_mrs_status_transition` are live on `material_requisitions`. |
| **0013** | `0013_availability_and_spare_change_gates.sql` | **Partial-availability loop + spare-change reconciliation.** Adds `material_requisitions.availability_hold / availability_notes / availability_reported_at / availability_reported_by / requester_decision / requester_decision_notes / requester_decision_at / requester_decision_by / spare_change_required / spare_change_returned` and `mrs_line_items.qty_available / availability_note`. **Gate A** (inside `guard_mrs_status_transition()`, which now supersedes 0012): a requisition on an unanswered availability hold cannot reach `FULFILLED / PARTIALLY_FULFILLED_BUDGET_EXHAUSTED / IN_TRANSIT`. **Gate B**: `FULFILLED → CLOSED` requires `spare_change_returned >= spare_change_required` (₱0.01 tolerance); new `trg_guard_transmittal_receipt` blocks marking a linked transmittal `RECEIVED` while the MRS still owes spare change (and enforces SENT-before-RECEIVED). New helper `mrs_disbursed_total(p_mrs_id)`. **APPLIED in the Supabase SQL Editor on 2026-09-19** (owner-confirmed; after 0012). Idempotent (`ADD COLUMN IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP TRIGGER IF EXISTS` throughout) — safe to re-run. |
| **0014** | `0014_delivery_signoff_gate.sql` | **Gate C — close requires requester delivery sign-off.** Adds `trg_guard_mrs_delivery_signoff` (blocks any `overall_status → CLOSED` while `requester_verification <> 'VERIFIED'`) and re-declares `guard_transmittal_receipt()` in full (0013 Gate B preserved verbatim + Gate C added: no transmittal `RECEIVED` while its requisition is unverified). Closes the loophole where Accounting could close an MRS the requester never signed off, losing the spare change. **APPLIED in the Supabase SQL Editor on 2026-09-19** (owner-confirmed; after 0013). ⚠️ If 0013 is ever re-applied it overwrites `guard_transmittal_receipt()` and drops Gate C — re-run 0014 afterwards; `0014_verify.sql` check 3 detects this. Companions: `0014_legacy_audit.sql` (read-only damage reconstruction) and `0014_verify.sql` (read-only checks 1–5). |

---

## 4. User Roles & Access Control Matrix

The system enforces 9 distinct roles in `user_role` enum:

| Role | Primary Responsibilities | Accessible Routes |
|---|---|---|
| `SUPER_ADMIN` | Full unrestricted operational & system access | All routes (`/dashboard`, `/jo/*`, `/mrs/*`, `/transmittals/*`, `/pms/*`, `/reports/*`, `/admin/*`, etc.) |
| `MANAGER` | Approvals, user management, work order oversight | `/dashboard`, `/jo/new`, `/jo/track`, `/jo/queue`, `/mrs/manager-queue`, `/pms/*`, `/reports/*`, `/admin/users` |
| `BUDGET_OFFICER`| Canvassing, pricing approvals, transmittal issuance | `/dashboard`, `/jo/new`, `/jo/track`, `/mrs/canvass`, `/transmittals`, `/transmittals/create`, `/reports/expense` |
| `ACCOUNTING` | Disbursement verification, receipt audit | `/dashboard`, `/jo/track`, `/transmittals`, `/transmittals/accounting`, `/reports/expense` |
| `PURCHASER` | Vendor purchase orders, online/COD execution | `/dashboard`, `/purchaser/queue`, `/delivery/verify`, `/transmittals` |
| `STOREKEEPER` | Stock availability checks, warehouse issuance | `/dashboard`, `/mrs/stock-check`, `/delivery/verify` |
| `MAINTENANCE` | Technician execution, PMS checklist execution | `/dashboard`, `/jo/new`, `/jo/track`, `/jo/queue`, `/pms/*`, `/delivery/verify` |
| `FRONT_DESK` | COD advance release, package arrival acknowledgement | `/dashboard`, `/jo/new`, `/jo/track`, `/transmittals`, `/transmittals/front-desk`, `/delivery/verify` |
| `STAFF` | General department requisitions & tracking | `/dashboard`, `/jo/new`, `/jo/track`, `/mrs/new` |

---

## 5. Master Form Specifications (Forms 1 to 18)

### Job Order Management (Forms 1–4)
- **Form 1 (`/jo/new`):** Job Order creation. Supports `NORMAL`, `URGENT`, and `EMERGENCY` priority. Allows uploading site inspection photos.
- **Form 2 (`/jo/track`):** Public/Internal tracker by reference number or department filter. Triggers `cascade_jo_cancellation` upon cancellation (reason + timestamp + actor persisted on the row since 0011). Manager/Super Admin can **Close** a COMPLETED or MATERIALS_RECEIVED ticket (final acceptance → terminal `CLOSED`). Materials can be re-requested from `MRS_REJECTED` tickets.
- **Form 3 (`/jo/queue`):** Technician queue for Maintenance. Assessment logging, work-in-progress notes, and direct requisition linking. List cards show requester name and department.
- **Form 4 (`/jo/queue/escalated`):** Reopened unresolved work orders and critical escalation queue. List cards show requester name and department.

### Materials Requisition System (MRS) (Forms 5–9)
- **Form 5 (`/mrs/new`):** Requisition creation (Standalone or linked to a Job Order). Line-item budget estimation and reference photos.
- **Form 6 (`/mrs/stock-check`):** Storekeeper verification. Marks items as available in warehouse (`ISSUED_FROM_STOCK`) or passes to Manager.
- **Form 7 (`/mrs/manager-queue`):** Manager approval or rejection queue. Shows requester name and department on every card.
- **Form 8 (`/mrs/canvass`):** Budget Officer canvassing grid with live calculations from `item_price_catalog`. Shows requester name in list cards and workspace panel header. Generates allocated budget.
- **Form 9 (`/mrs`):** General Requisitions Ledger. Shows requester name in the Department/Requester column.

### Financial Transmittals & Cash Ledger (Forms 10–12)
- **Transmittals Hub (`/transmittals`):** Central dashboard linking Forms 10, 11, and 12 with chain-of-custody documentation.
- **Form 10 (`/transmittals/create`):** Budget Officer issuance. Single or batch transmittal handoff (up to 50 MRS). **Receiver dropdown lists ALL active accounts** (no role filter) — name and role are shown so the sender can identify the recipient. Previously only SUPER_ADMIN-tier roles were listed.
- **Form 11 (`/transmittals/accounting`):** Accounting disbursement release and voucher verification. Dual-confirmation step.
- **Form 12 (`/transmittals/front-desk`):** Front Desk revolving cash float disbursement, COD package arrival, and barcode acknowledgement.

### Purchasing & Receiving (Forms 13–14)
- **Form 13 (`/purchaser/queue`):** Purchaser queue. Shows requester name in list cards and execution panel header. Manages vendor quotes, PO generation, receipt attachments, and status transition to `IN_TRANSIT` via the **Mark In Transit (Shipped)** button on online/COD requisitions (0011 — previously the status was dead). Trip completion now clamps purchased quantities to the unfulfilled balance and stores `qty_fulfilled = stock issued + purchased`.
- **Form 14 (`/delivery/verify`):** Receiving and inspection. Verifies delivered quantities against line items; supports partial delivery and discrepancy notes.

### Preventive Maintenance System (PMS) (Forms 15–16 & Register)
- **PMS Hub (`/pms`):** Category selection and scheduling rules.
- **Asset Registration (`/pms/register`):** Form for registering new facility assets and aircon units. Includes toggle to configure aircon units with HVAC category and 3-month cycle.
- **Form 15 (`/pms/daily`):** General Equipment PMS queue with standard category checklists (HVAC, Electrical, Plumbing, Structural, Kitchen, General). Supports "Due for Service" and "All Equipment" views.
- **Form 16 (`/pms/aircon`):** Dedicated Air Conditioning 3-Month Service grid with Freon Pressure (PSI), Compressor Amperage (A), and service photo upload.

### Analytics & Administration (Forms 17–18)
- **Form 17 (`/reports/expense`):** Comprehensive expense analytics with DeepLinkModal joining JO, MRS, Transmittals, receipts, and variances.
- **Form 18 (`/admin/users`):** User Account Management. Creation, role assignment, department mapping, and account activation/deactivation.

---

## 6. Critical Implementation Guardrails & Rules

When extending or modifying this codebase, the following rules **must never be violated**:

### Rule 1: Next.js 16 Breaking Conventions
- **Proxy instead of Middleware:** This project uses `src/proxy.ts` (Next.js 16 convention) instead of `middleware.ts`. Do not create a redundant `middleware.ts`.
- **Cookies Handling:** In server client and proxy, always use `request.cookies.getAll()` and `response.cookies.set()`. Do not use deprecated single-key `get/set/remove` patterns.

### Rule 2: Atomic Reference Number Generation
- **Never construct reference numbers client-side.** All reference numbers (`JO-2026-0001`, `MRS-2026-0001`, `TR-2026-0001`, `TR-BATCH-2026-0001`) must be generated via the atomic database function:
  ```sql
  SELECT next_reference_number('JO', 2026);
  ```

### Rule 3: 4-Step Chain of Custody (Transmittals)
- Cash movement between departments requires dual confirmation (`sender_status = 'SENT'`, `receiver_status = 'RECEIVED'`). Never mark a transmittal as received in a single step without logging both parties.
- A canceled Job Order that already has cash disbursed triggers an automated `SPARE_CHANGE_RETURN` transmittal for 100% of the disbursed amount.

### Rule 4: Prevent RLS Recursion on `users` Table
- Never write a policy on `users` that performs a subquery on `users` (e.g., `WHERE (SELECT role FROM users ...)`)
- **Always** use the security-definer function `get_my_role()` defined in `0005_fix_rls_recursion.sql`.

### Rule 5: User Account Status Guard
- All authentication checks verify both `auth.uid()` and `account_status = 'ACTIVE'`. Inactive or password-reset-required accounts are blocked at both proxy level and server action boundaries.

### Rule 6: `attachments` Table — No PostgREST Auto-Join
- The `attachments` table uses a **generic** `entity_id INT` + `entity_type VARCHAR` pattern with **no foreign key** constraints to other tables.
- **Do NOT** try to join `attachments` via Supabase PostgREST embedded resource syntax (e.g., `attachments(file_url, context)` inside a `.select()` on another table). This will always return HTTP 400.
- **Correct pattern:** Fetch the primary records first, collect their IDs, then run a **separate query** with `.in('entity_id', ids)` filtered by `context`, and merge client-side:
  ```ts
  // Step 1: fetch MRS records
  const { data } = await supabase.from('material_requisitions').select('id, ...')
  // Step 2: fetch matching attachments separately
  const { data: attData } = await supabase
    .from('attachments')
    .select('entity_id, file_url')
    .eq('context', 'MRS_ONLINE_SCREENSHOT')
    .in('entity_id', data.map(r => r.id))
  // Step 3: merge
  const merged = data.map(r => ({ ...r, screenshotUrl: screenshotMap[r.id] ?? null }))
  ```

### Rule 7: `online_screenshot_url` Does NOT Exist on `material_requisitions`
- There is **no** `online_screenshot_url` column on the `material_requisitions` table (see `0001_initial_schema.sql` lines 110–148).
- Online cart screenshots are stored in the `attachments` table with `context = 'MRS_ONLINE_SCREENSHOT'` and `entity_type = 'mrs_line_item'`, `entity_id = mrs.id`.
- If you add this column to a select query, PostgreSQL will return error `42703` (column does not exist), silently breaking the entire query and returning no records.

### Rule 8: DOM→Image Capture Must Use `html2canvas-pro`, Never `html2canvas`
- Tailwind CSS v4 emits its default palette as `oklch()` colors. The archived `html2canvas@1.4.1`
  has **no** oklch parser, so it throws
  `Attempting to parse an unsupported color function "oklch"` while reading computed styles — the
  capture fails at click time, not at build time, so `tsc`/`eslint`/`next build` stay green.
- All DOM→canvas rendering goes through `src/components/messenger/SnapshotGenerator.tsx`, which
  imports **`html2canvas-pro`** (drop-in API; parses `oklch()/oklab()/lab()/lch()/color()`).
  Tailwind opacity modifiers (`bg-blue-600/30` → `color-mix(in oklab, …)`) need no polyfill: the
  browser resolves them to `color(srgb …)` at computed-value time.
- **Do not re-add `html2canvas` to `package.json`** and do not import it in a new component. For a
  new capture surface, reuse `SnapshotGenerator` or call `html2canvas-pro` directly.


---

## 7. Setup & Development Guide

### Prerequisites
- Node.js 20+
- Active Supabase Project with environment credentials

### Environment Variables (`.env.local`)
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

### Essential Commands
```bash
# Install dependencies
npm install

# Start local dev server
npm run dev

# Run production build validation (TypeScript + Webpack + PWA)
npm run build

# Regenerate PWA icons if brand asset changes
node scripts/generate-icons.mjs
```

---

## 8. Current System Status & Verification

- **Messenger snapshot export — oklch crash fix (2026-09-18):**
  - Symptom: on Form 8 (`/mrs/canvass`) → Generate Messenger Snapshot, every action ("Copy Image for
    Messenger", "Download PNG", "PDF Report", "Save Cloud Link") failed with
    `Attempting to parse an unsupported color function "oklch"`.
  - Root cause: `SnapshotGenerator` rendered the card with `html2canvas@1.4.1`, which predates CSS
    Color 4 and cannot parse the `oklch()` colors Tailwind v4 compiles every palette utility to. The
    failure is runtime-only, so `tsc`, `eslint` and `next build` were all green.
  - Fix: switched the import to **`html2canvas-pro@2.4.3`** (drop-in API, parses
    `oklch/oklab/lab/lch/color()`) and removed `html2canvas` from `package.json`. All four actions
    share the single `generateCanvas()` path, so this one change covered copy + PNG + PDF + upload.
    See Rule 8.
- **Form 13 trip-save gate (2026-09-18):** `purchaserCompleteTrip` already rejected a trip save before
  Accounting disbursed (0012), but the **"Save Actuals & Forward to Delivery Sign-Off"** button stayed
  live on queue rows still in `APPROVED_READY_TO_ORDER` / `TRANSMITTAL_IN_PROGRESS` /
  `READY_FOR_PURCHASE`, so purchasers filled the whole form and only then got an error. The button is
  now gated on `PURCHASER_COMPLETE_TRIP_STATUSES` — the exact list the action validates — and renders
  the same amber lock badge used by the cash button: *"Waiting for Accounting — Disburse & Mark Sent
  (Form 11)"*, or *"Confirm Cash Received & Lock Float first (Form 13)"* once the transmittal is SENT.
  `handleCompleteTrip` re-checks before firing (defence in depth); receipt/vendor/quantity entry stays
  available while locked. Emergency Fast-Track remains unlocked by design (Plan §6.A).
- **Strict MRS flow chain (0012, 2026-09-18):**
  - The canonical chain is now enforced at **three layers** — app status
    machine (`MRS_TRANSITIONS`), server actions (gates below), and the DB
    trigger guard (migration 0012, mirror of the map). Canonical path:
    `PENDING_MANAGER → IN_CANVASSING → PENDING_OWNER →
    APPROVED_READY_TO_ORDER → TRANSMITTAL_IN_PROGRESS → READY_FOR_PURCHASE →
    PURCHASING → (IN_TRANSIT) → FULFILLED → CLOSED`, with the Form 6
    warehouse branch (`PENDING_MANAGER → ISSUED_FROM_STOCK`) and the
    Emergency Fast-Track bypass (no transmittal, Plan §6.A).
  - New action gates (all throw clear, actionable errors):
    - `purchaserConfirmCash` (Form 13): only from `READY_FOR_PURCHASE` /
      `EMERGENCY_FAST_TRACK`, **and** (non-fast-track) requires a
      `transmittal_forms` row with `sender_status = 'SENT'` for the MRS —
      i.e. Accounting must have disbursed & marked sent first.
    - `purchaserCompleteTrip` (save actuals & forward): only from
      `PURCHASING` / `IN_TRANSIT` / `EMERGENCY_FAST_TRACK` + same transmittal
      re-check + `assertMRSTransition` before the status write.
    - `verifyDeliveryRequester` (Form 14): sign-off restricted to users in
      the **requester's department** (`mrs.department_id`) or SUPER_ADMIN;
      the delivery queue is scoped to the viewer's department on the page.
    - `verifyCashAndMarkReceived` (Form 16): MRS must be `FULFILLED`
      (delivery signed off) before Accounting records spare change & closes;
      spare change validated (0 ≤ spare ≤ disbursed amount).
    - `disburseCashAndMarkSent` (Form 11): rejects transmittals on
      terminal/resolved MRS; MRS advance is forward-only with error checks.
    - `createTransmittal`: rejects terminal/resolved MRS; all TR random
      numbering fallbacks removed (create, spare-change return, FD COD, FD
      replenish) — atomic `next_reference_number` only.
  - **Migration 0012 APPLIED in the Supabase SQL Editor on 2026-09-18**
    (after 0011; owner-confirmed, recorded the same way as 0011). The bypass
    transitions are therefore closed at the DB level too, and
    `trg_guard_mrs_status_transition` is live as the second line of defense
    behind the app gates. To re-verify on any project:
    `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_guard_mrs_status_transition';`
    (expect exactly one row: `BEFORE UPDATE OF overall_status ON
    material_requisitions`).
    **On a freshly provisioned project 0012 must still be replayed**: the
    app-level gates alone leave every non-UI writer (SQL editor, REST `PATCH`
    with a service key, reports/backfill) free to skip a step. The script is
    idempotent (`CREATE OR REPLACE` / `DROP TRIGGER IF EXISTS`), so re-running
    it is safe.
  - Verified: 43-case state-machine test (canonical chain allowed, every
    bypass blocked, all branches intact), tsc clean, eslint clean, build
    30/30.

- **Session hardening — fix for "Minified React error #441" (2026-09-18):**
  - Symptom: submitting a New MRS (Form 5) with photos logged `React error #441` in
    production while the MRS itself was saved fine. #441 = "An error occurred in the
    **Server Components render**" (message hidden in minified builds).
  - Root cause: `supabase.auth.getUser()` makes a network call to the Supabase Auth
    server on **every** server request and **throws** (not `{ error }`) when the session
    can't be validated/refreshed (expired/rotated refresh token, transient network
    failure). The unguarded call in `(dashboard)/layout.tsx` then crashed the whole RSC
    render after the server action had already committed the MRS.
  - Fix:
    - `getServerUser()` in `src/lib/supabase/server.ts` — try/catch wrapper; any failure
      returns `null` (treat as signed out). **Use this in every Server Component.**
    - `(dashboard)/layout.tsx` uses it → clean `/login` redirect instead of a crash.
    - `src/lib/actions/mrs-actions.ts` — all 7 auth blocks now use `getServerUser()`
      with a clear "Session expired or invalid. Please sign in again." error.
    - NEW `src/app/(dashboard)/error.tsx` — error boundary: any future render failure
      shows a "Something went wrong / Try Again" card (with the error digest) instead
      of a blank page.
  - **Completed 2026-09-18 (after JO-flow report):** the same unguarded `getUser()`
    pattern is now migrated in **all** remaining server call sites —
    `jo-actions.ts` (7), `purchaser-actions.ts` (3), `transmittal-actions.ts` (6),
    `pms-actions.ts` (3), `audit-actions.ts` (1), `user-actions.ts` (5),
    `audit-service.ts` (2) — and `proxy.ts` (try/catch: a session-validation
    failure treats the request as signed out instead of 500-ing every route).
    All failures now surface as a clean "Session expired or invalid. Please
    sign in again." / login redirect. **`getServerUser()` is the only sanctioned
    way to resolve the server session — never call `supabase.auth.getUser()`
    directly in Server Components, actions, or the proxy.**
  - **If #441 recurs after pulling this commit:** you are running a build older
    than `fe005c4` (the layout fix). Pull the latest and rebuild/redeploy.
- **`'use server'` file rule (Vercel runtime error, 2026-09-18):**
  Next.js validates at RUNTIME (not build time) that a `'use server'` file
  exports only async functions — any `export const`/object in such a file
  throws `A "use server" file can only export async functions, found object`
  on the first action call (broke every JO action after 465d919 added
  `JO_FIELD_LIMITS` to `jo-actions.ts`). **Shared constants used by client
  pages must live in a plain module** (e.g. `status-machines.ts`) and be
  imported into the action — never exported from a `'use server'` file.

- **Role-Focused Navigation (mobile fix, 2026-09-18):**
  - The old mobile bottom bar rendered up to 9 `justify-around` tiles (SUPER_ADMIN) which clipped labels on phones. It is replaced by `src/components/layout/MobileNav.tsx`:
    - **Bottom bar: max 5 tiles** = the role's primary forms (up to 3, from `ROLE_PRIMARY_ACTIONS` in `src/lib/access-control.ts`) + Dashboard + a **More** button.
    - **More → grouped bottom sheet** with every accessible route (grouped by Job Orders / MRS / Finance / Operations / PMS / Insights / Administration, with form numbers).
    - **Floating quick-access button (FAB)** above the bar opens a role-focused quick menu (e.g. BUDGET_OFFICER → Form 8 Canvass, Form 10 Transmittal, New JO, Form 17 Reports).
  - **Desktop:** the header pill nav is now horizontally scrollable (nothing hidden at any width, incl. SUPER_ADMIN's 23 routes), and a **"Your workspace" role row** under the header exposes the role's primary forms with form-number chips.
  - Single source of truth: `NAV_CATALOG` + `ROLE_PRIMARY_ACTIONS` + `getNavItemsForRole()` / `getPrimaryActionsForRole()` in `src/lib/access-control.ts`. **When adding a route, add it to `NAV_CATALOG` (and, if role-critical, to `ROLE_PRIMARY_ACTIONS`)** so header, bottom bar, sheet, and FAB all stay in sync.
  - `main` bottom padding is `pb-24` on mobile to clear the bar + FAB.

- **Storage Buckets & Photo Attachments:**
  - Migration `0008_make_storage_buckets_public.sql` configures all 4 buckets (`site-photos`, `item-references`, `receipts-proofs`, `messenger-snapshots`) with `public = true` and enables public read RLS policies on `storage.objects` so `getPublicUrl()` renders cleanly in `<img>` elements without 400 Bad Request.
  - `PhotoLightbox` modal (`src/components/ui/PhotoLightbox.tsx`) is deployed across MRS (Requester, Manager, Budget Officer Canvassing), JO (Technician Queue & Ticket Tracking), and Purchaser Queue. Provides zoom, full-screen expansion, download, and external URL viewing.
- **MRS Ledger (Form 9) — Attachments Fix:**
  - Previously broken by an invalid `online_screenshot_url` column reference in the Supabase select query (PostgreSQL `42703` error), causing the entire query to fail silently and return no records.
  - Fixed: column removed from select. Screenshots are fetched via a second `.in()` query on `attachments` (context = `MRS_ONLINE_SCREENSHOT`) and merged client-side. Applies to `mrs/page.tsx` and `mrs/manager-queue/page.tsx`.
- **Requester Name Visibility:**
  - All queue/ledger forms now display the requester's full name alongside the department name.
  - MRS Manager Queue, MRS Canvass (list + panel), Purchaser Queue (list + panel), JO Queue cards, Escalated JO Queue cards all show requester name.
- **Transmittal Receiver Dropdown (Form 10):**
  - `loadReceivers()` in `transmittals/create/page.tsx` no longer filters by role — all `ACTIVE` users are listed as selectable receivers, with role shown in parentheses.
- **PWA & Assets:** 7 sharp-generated PWA PNG icons in `public/icons/`. Web manifest and apple-touch-icon registered. Console is 100% clean of missing resource warnings.
- **Build Status:** Passes `next build --webpack` with zero TypeScript or packaging errors (29 static and dynamic routes compiled).
- **Git Branch:** `main` tracking `origin/main`. Latest commit: `0aface8`.

---

## 9. JO & MRS Flow Enhancements (2026-09-18)

A full review of the Job Order (Forms 1–4) and Material Requisition (Forms 5–9, 13–14)
flows, structure, forms, and schema. Migration **0011** plus coordinated app changes.

### 9.1 Flow bugs fixed
| # | Bug | Fix |
|---|-----|-----|
| 1 | JO dead-end at `MATERIALS_RECEIVED` (no path to completion; only → CLOSED, and no UI could close) | Guard now allows `MATERIALS_RECEIVED → COMPLETED` + `COMPLETED → CLOSED`; `markJobOrderDone` accepts `MATERIALS_RECEIVED`; new `closeJobOrder` action (MANAGER/SUPER_ADMIN) + Close button/modal on Form 2 |
| 2 | `IN_PROGRESS → MATERIALS_RECEIVED` missing from JO guard (delivery-verify / full stock-issue after work resumed) | Added to `guard_jo_status_transition` (0011) |
| 3 | Fast-track MRS broken: `purchaserConfirmCash` set `PURCHASING` from any status; guard rejected `EMERGENCY_FAST_TRACK → PURCHASING` | Guard extended; action now pre-validates status + role with readable errors |
| 4 | `IN_TRANSIT` was a dead enum value (front-desk filter referenced it; nothing set it; verify would fail the guard) | Guard extended (`APPROVED_READY_TO_ORDER/READY_FOR_PURCHASE/PURCHASING → IN_TRANSIT → FULFILLED/PARTIAL/DISPUTED`); new `markMRSInTransit` action + Form 13 button; `verifyDeliveryRequester` accepts `IN_TRANSIT` |
| 5 | `purchaserCompleteTrip` overwrote `qty_fulfilled`, erasing warehouse-issued quantities (double-count) | Action now fetches line items, clamps purchased qty to remaining balance, stores `qty_fulfilled = qty_issued_from_stock + purchased` |
| 6 | `createMRS` linked JOs blindly — guard exception fired *after* MRS + line items were written (orphaned requisition) | Linked JO is fetched and validated **before** insert (only `PENDING_ASSESSMENT / IN_PROGRESS / AWAITING_MRS_APPROVAL / MRS_REJECTED`); Form 5 blocks ineligible links client-side |
| 7 | Cascade cancellation did not generate the promised `SPARE_CHANGE_RETURN` for disbursed cash (Rule 3) | `cascade_jo_cancellation` now inserts a mirrored `SPARE_CHANGE_RETURN` transmittal (100% of amount, original receiver → original sender, both PENDING) for every transmittal with cash already moved; also stamps `cancelled_at/cancelled_by` |
| 8 | `createTransmittal` unconditionally pushed MRS → `TRANSMITTAL_IN_PROGRESS`; supplemental transmittals on a disbursed MRS hit the guard and failed silently | Only the first transmittal transitions `APPROVED_READY_TO_ORDER → TRANSMITTAL_IN_PROGRESS`; others leave status untouched; errors now checked |
| 9 | Random 6-digit fallback numbering in 5 places violated the atomic-numbering guardrail (collisions, gaps) | Removed — RPC failure now fails the action with a clear "not created" message (JO, MRS, TR, FD COD, FD replenish) |
| 10 | Canvass could advance to Owner with unpriced items; client-supplied budget total trusted | `recordCanvassPricing` re-fetches line items, requires supplier + positive price for every unfulfilled item, recomputes the budget server-side; Form 8 gates both action buttons with an amber warning |

### 9.2 Structure
- **`src/lib/status-machines.ts`** — single source of truth for JO/MRS transition maps,
  action-eligibility status lists, role gates, and business-constant defaults. Mirrors the
  DB guards; server actions use it for early, human-readable validation; pages use it to
  render the correct buttons. **Keep in sync with the SQL guards when either changes.**
- **`system_settings`** table (migration 0011) — business constants are now data:
  `mrs.fast_track_cap_amount` (3000), `mrs.minor_deficit_amount` (200),
  `mrs.minor_deficit_percent` (5), `transmittals.batch_max_items` (50).
  Read via `get_setting_numeric(key, default)` (SECURITY DEFINER, read-only for all
  authenticated; write = SUPER_ADMIN only). App code falls back to defaults if the
  function/table is not yet deployed.
- **Indexes** (0011) on the columns every queue filters: `job_orders(status, requester_id,
  assignee_id, priority+created_at)`, `material_requisitions(overall_status, jo_id,
  department_id, created_at DESC)`, `mrs_line_items(mrs_id)`,
  `transmittal_forms(mrs_id, receiver_user_id)`, `activity_logs(entity_type, entity_id, ts DESC)`.

### 9.3 Form enhancements
- **Form 1 (`/jo/new`):** field limits enforced (title 200, location 150, description 2000)
  client- and server-side (`JO_FIELD_LIMITS`); combined-location check.
- **Form 2 (`/jo/track`):** cancellation record (reason/timestamp) and closure record
  rendered; `MATERIALS_RECEIVED` + `MRS_REJECTED` badges; Close button (role-gated);
  "Request Materials" re-appears on `MRS_REJECTED` tickets.
- **Form 3 (`/jo/queue`):** filter gained `MRS_REJECTED` + `MATERIALS_RECEIVED`; Mark Done
  available on all four completable statuses (incl. `CRITICAL_REOPEN_ESCALATED`,
  `MATERIALS_RECEIVED`); Request MRS available on `MRS_REJECTED`.
- **Form 5 (`/mrs/new`):** ineligible linked JO shows a blocking warning + disables
  submit; line-item field limits (255/50/150); quantity must be a positive integer.
- **Form 8 (`/mrs/canvass`):** snapshot + Owner-decision buttons disabled until every
  to-procure item is priced, with an amber list of what's missing.
- **Form 13 (`/purchaser/queue`):** "Mark In Transit (Shipped)" for online orders; cash
  confirmation hidden once in transit; role + status pre-checks.
- **Form 9 / Form 17:** status filters now cover the full `mrs_status` enum (incl.
  `IN_TRANSIT`, `TRANSMITTAL_IN_PROGRESS`, `READY_FOR_PURCHASE`, `PARTIALLY_FULFILLED_BUDGET_EXHAUSTED`).

### 9.4 Audit trail
- `job_orders` gained `cancellation_reason`, `cancelled_at`, `cancelled_by`, `closed_at`,
  `closed_by` (0011). Form 2 renders both records.
- New audit actions logged: `JOB_ORDER_CLOSED`, `MRS_MARKED_IN_TRANSIT` (in addition to the
  existing taxonomy).

### 9.5 Verification
- `npx tsc --noEmit` — clean. `npm run build` (Next 16.3.5 / webpack) — 30/30 routes
  compile (verified with an offline font shim; `src/app/layout.tsx` unchanged in the commit).
- `npx eslint` on all touched files — clean.
- Migration 0011 **applied in the Supabase SQL Editor on 2026-09-18** (confirmed by the
  owner; the script is idempotent: `IF NOT EXISTS` / `CREATE OR REPLACE` throughout).
  App code still degrades gracefully to defaults if `system_settings` is ever missing.


---

## 10. Partial Availability & Spare-Change Reconciliation (2026-09-19)

Migration **0013** plus coordinated app changes close two gaps that the 0012
chain left open: the purchaser could silently under-buy without telling the
requester, and Accounting could close a transmittal for less spare change than
the requisition actually owed.

### 10.1 Gate A — partial availability loop (Form 13 → Form 9 → Form 13)

Canonical loop, enforced at all three layers (status machine → server action →
DB trigger):

1. **Form 13 (`/purchaser/queue`)** — "Item Unavailable / Short Supply" opens an
   availability panel. The purchaser enters `qty_available` (+ an optional
   reason) per line. `reportItemAvailability()` validates every quantity
   against the DB (`0 ≤ available ≤ outstanding`), refuses a report with no
   shortfall, sets `availability_hold = true`, `requester_decision = 'PENDING'`,
   and logs `MRS_AVAILABILITY_REPORTED`.
2. **Form 9 (`/mrs`)** — the requisition shows an amber *"Availability — Your
   Decision Needed"* badge (also a dedicated status filter). The details modal
   lists available-vs-outstanding per line and offers three buttons:
   **Proceed with What's Available** (`PROCEED_PARTIAL`), **Buy Available &
   Cancel Balance** (`CANCEL_REMAINING`, which stamps the short lines
   `UNAVAILABLE`), and **Wait for Full Availability** (`WAIT_FULL`, keeps the
   hold on). `requesterAvailabilityDecision()` restricts this to the
   requisition's own department or SUPER_ADMIN — the same rule Form 14 uses.
3. **Form 13 again** — the purchaser sees the decision, each quantity input is
   capped at the reported `qty_available`, and `purchaserCompleteTrip()`
   rejects any quantity above that ceiling. The forward button stays locked
   while the hold is `PENDING` or `WAIT_FULL`.

`isAwaitingRequesterDecision()` in `status-machines.ts` is the single predicate
shared by the pages, the actions, and (as SQL) the DB guard.

### 10.2 Gate B — spare-change reconciliation (Form 14 → Form 11)

- **Form 14 sign-off** (`verifyDeliveryRequester`) now computes and stamps
  `spare_change_required = mrs_disbursed_total(mrs) − total_actual_spent`
  (disbursed = non-return transmittals with `sender_status IN (SENT, RECEIVED)`),
  and logs `MRS_SPARE_CHANGE_REQUIRED`. The RPC degrades to a direct query if
  0013 is not deployed yet.
- **Form 11 (`/transmittals/accounting`)** shows *"Spare change required: ₱X"*
  next to the input, prefills the placeholder, and **disables** "Verify & Close
  MRS" when the entered amount (plus anything already returned) is short — or
  when the MRS is not yet `FULFILLED`.
- `verifyCashAndMarkReceived()` re-validates server-side: under-returning throws
  a "short by ₱X" error, over-returning against a recorded requirement is also
  rejected, and the accepted amount is accumulated into
  `spare_change_returned` **before** the `CLOSED` write so SQL Gate B sees a
  settled balance. Logs `MRS_SPARE_CHANGE_RETURNED`.
- The DB is the last line of defense: `FULFILLED → CLOSED` and
  `receiver_status → RECEIVED` both raise when the balance is unsettled.

### 10.3 Audit trail
New actions in `AUDIT_ACTIONS`: `MRS_AVAILABILITY_REPORTED`,
`MRS_AVAILABILITY_DECISION`, `MRS_SPARE_CHANGE_REQUIRED`,
`MRS_SPARE_CHANGE_RETURNED`.

### 10.4 Verification
`npx tsc --noEmit` clean · `npx eslint` on all touched files clean ·
`npm run build` 30/30 routes (offline font shim; `layout.tsx` unchanged) ·
20-case gate test (hold blocks/releases per decision, ₱0.01 tolerance,
under/over-return, null-safety) all passing.

> ~~**Action required by the owner:** migration 0013 must be run in the Supabase
> SQL Editor (after 0012).~~ ✅ **DONE 2026-09-19** — 0013 **and** 0014 are both
> applied to the live project (owner-confirmed). See §2.1 and §12.


### 10.5 Hotfix — React #441 on Form 11 when 0013 is not yet applied (2026-09-19)

- **Symptom:** on **Accounting — Transmittals**, entering the spare change and
  clicking *Verify & Close MRS* threw `Minified React error #441`, and after a
  refresh the transmittal was unchanged (nothing was ever written).
- **Root cause:** §10 shipped app code that reads/writes the 0013 columns
  (`spare_change_required`, `spare_change_returned`, `availability_hold`,
  `requester_decision`, `qty_available`, …), but migration **0013 had not been
  applied** to the project. PostgREST answers an unknown column with
  PostgreSQL `42703` and **fails the entire query** (agent_handoff **Rule 7**).
  In `verifyCashAndMarkReceived()` that made the Gate-B lookup return an error,
  so the action threw *before* any write — the throw propagated out of the
  Server Action and surfaced as the minified #441 server-render error. This was
  **not** a session/`getUser()` regression: `getServerUser()` was already used
  correctly here.
- **Fix — graceful degradation to pre-0013 behaviour** (the same guardrail
  0011 uses for `system_settings`). Added to `status-machines.ts`:
  `PG_UNDEFINED_COLUMN = '42703'`, `MRS0013Fields`, and `MRS_0013_DEFAULTS`
  (hold off, decision `NONE`, both spare-change figures `0`).
  - `verifyCashAndMarkReceived()` retries the requisition lookup without the
    0013 columns on `42703`, merges the defaults, **skips** the reconciliation
    gate, and omits `spare_change_returned` from the `CLOSED` update — so
    closing works exactly as it did pre-0013 instead of crashing.
  - `/transmittals/accounting`, `/mrs`, `/purchaser/queue` and
    `/delivery/verify` each retry their list query with the legacy column set
    on `42703` (otherwise **Rule 7** would have silently blanked those queues),
    and show an amber *"migration 0013 not applied"* banner. Availability
    reporting is hidden on Form 13 while in that state.
- **Once 0013 is applied the gates activate automatically** — no code change,
  the banners disappear.
- Verified: tsc clean, eslint clean, build 30/30, 8-case fallback test
  (legacy-row defaults never fabricate a debt or a hold; post-0013 short/exact
  cases still block/allow correctly).


### 10.6 Hotfix — the two 0013 gates deadlocked each other (2026-09-19)

- **Symptom:** with 0013 **applied**, Form 11 *Verify & Close MRS* still threw
  `Minified React error #441` and nothing was written — even when the operator
  entered the exact required amount (₱360 of ₱360).
- **Root cause (my bug, not the migration):** `verifyCashAndMarkReceived()`
  wrote in the wrong order. It marked the **transmittal** `RECEIVED` *first*,
  then settled and closed the requisition. But `trg_guard_transmittal_receipt`
  re-reads `material_requisitions.spare_change_returned` and rejects the
  receipt while the MRS still owes money — and at that instant the MRS was
  still unsettled (`returned = 0`), because the settling update came later.
  **The two Gate-B halves blocked each other**, so a fully-paid requisition
  could never be closed. The trigger's `RAISE EXCEPTION` propagated out of the
  Server Action as the opaque #441 digest.
- **Fix — the write order is now load-bearing and documented in-code:**
  1. `UPDATE material_requisitions SET overall_status='CLOSED',
     spare_change_returned=<total>` (one statement, so the MRS guard sees the
     settled balance on the status write), then
  2. `UPDATE transmittal_forms SET receiver_status='RECEIVED'` — which now
     passes because the MRS it re-reads is already settled.
- **Secondary fix — errors are no longer invisible.** A thrown Server Action
  error is redacted to a digest in production builds, which is why every
  failure here looked like #441 instead of the real message. The throwing body
  became `verifyCashAndMarkReceivedImpl()`, and the exported
  `verifyCashAndMarkReceived()` wraps it to return
  `{ success, netDisbursed?, error? }`. Form 11 renders `result.error` in its
  existing red feedback bar and logs structured JSON server-side.
  **Pattern to reuse: any Server Action called directly from a client
  component should return a structured result rather than throw**, otherwise
  the operator sees a digest instead of the reason.
- Verified: tsc clean, eslint clean, build 30/30, plus a 5-case trigger
  simulation that reproduces the deadlock under the old order and proves the
  new order settles exact payments, still blocks underpayment, handles
  zero-required, and exempts `SPARE_CHANGE_RETURN`.

### 10.7 Gate C — Accounting could close an MRS with no delivery sign-off (2026-09-19)

**Symptom.** Accounting closed a requisition the requester had never verified.
Any spare change on it was never recorded, and the MRS vanished from the
delivery queue after the close.

**Root cause.** 0013 Gate B only compares `spare_change_required` against
`spare_change_returned`, and `spare_change_required` is stamped *by* Form 14
(requester sign-off), defaulting to `0.00`. On a requisition that skipped Form
14 the comparison was `0 - 0 = 0`, so Gate B passed. The
`overall_status = 'FULFILLED'` check was not a backstop either: the purchaser's
own "save actuals" step (Form 13) sets FULFILLED directly, so **FULFILLED means
"purchased", not "delivered and verified"**.

**Fix — migration `0014_delivery_signoff_gate.sql` (Gate C).** Gate on
`requester_verification`, which is `'PENDING_DELIVERY'` (0001 default) until
Form 14 sets it to `'VERIFIED'`:

1. `trg_guard_mrs_delivery_signoff` — blocks any `→ CLOSED` write while
   `requester_verification <> 'VERIFIED'`.
2. `guard_transmittal_receipt()` re-declared in full (0013's Gate B preserved
   verbatim) with Gate C added, so a transmittal cannot be marked RECEIVED
   while its requisition is unverified.

App layer mirrors it: `isDeliveryVerified()` in `status-machines.ts`, checked in
`verifyCashAndMarkReceivedImpl` **before** Gate B (an unverified MRS must fail
with "not signed off", not a misleading "spare change short"), plus a client
pre-check and a disabled button on the Accounting page.

> ⚠️ **Ordering:** if `0013` is ever re-applied it will overwrite
> `guard_transmittal_receipt()` and silently drop Gate C. Re-run `0014`
> afterwards. `0014_verify.sql` check 3 detects exactly this.

`0014_verify.sql` check 4 lists requisitions already CLOSED without sign-off —
historical damage from this bug, which needs manual review; the gate cannot
retroactively recover uncollected cash.

### 10.8 Form 8 canvass sequencing — price lock & button order (2026-09-19)

The Budget Officer could edit canvassed prices after sending the Owner snapshot,
and could log an Owner decision without ever generating one.

`recordCanvassPricing()` (the snapshot action) commits prices and moves the MRS
`IN_CANVASSING → PENDING_OWNER`, and already refuses to run unless the status is
`IN_CANVASSING`. So **`overall_status === 'PENDING_OWNER'` is the durable
"snapshot sent" signal** — it survives a refresh or another device, unlike a
local `useState` flag, and no new column is needed. Derived on the page as
`snapshotSent` / `pricingLocked`:

- supplier + unit-price inputs → `readOnly` + `disabled` once locked;
- "Generate Messenger Snapshot" → disabled after it runs (relabelled
  "Snapshot Sent"; a separate "View Snapshot" button re-opens the modal without
  re-committing prices);
- "Log Owner Decision" → disabled until `snapshotSent`.

`fetchData()` now re-points `selectedMRS` at its refreshed row and is awaited by
both handlers; without that the open requisition kept its pre-snapshot
`IN_CANVASSING` status and the lock only engaged after a manual reselect.

### 10.9 Form 13 partial-availability loop — closing the notification leg (2026-09-19)

Requirement: *if an item is unavailable or only partly available, the requester
is **notified**; they choose whether to proceed; on "proceed" the purchaser buys
what is available and **updates the MRS back** to the requester.*

Audit of what 0013 already shipped:

| Leg | State |
|-----|-------|
| Purchaser reports shortfall (`reportItemAvailability`) | already built |
| Hold freezes the purchase (Gate A, SQL + app) | already built |
| Requester decides — 3 buttons on `/mrs` | already built |
| Purchase ceiling clamped to `qty_available` | already built |
| Actuals → FULFILLED → Form 14 sign-off | already built |
| **Requester is _notified_** | **missing** |
| **Purchaser learns the answer came back** | **missing** |

`logMRSActivity()` only writes `activity_logs` — it is an audit trail, not a
notification. The header bell was a **decorative `<button>` with a hardcoded
always-on blue dot**: no handler, no data. So the loop worked but relied on the
requester happening to open `/mrs` and scroll to the right requisition.

**`src/lib/actions/alert-actions.ts` — `getMyAlerts()`.** Derives alerts from
current row state instead of storing them, so an alert cannot go stale, cannot
be missed, and self-clears when the condition resolves. Three kinds:

- `AVAILABILITY_DECISION` → requester's department, hold is PENDING (leg 2)
- `AVAILABILITY_ANSWERED` → purchaser, hold released, still PURCHASING (leg 3)
- `DELIVERY_SIGN_OFF` → requester's department, awaiting Form 14

Gated on the **same** predicates as the server actions (department match for
Form 9/14, `requester_verification` for Gate C), so an alert and a gate can
never disagree. `WAIT_FULL` deliberately raises **no** purchaser alert — it does
not release the purchase, and surfacing it as actionable would invite exactly
the partial buy the requester refused. Never throws (returns an empty set) since
it feeds the dashboard shell, and degrades on `42703` per Rule 7.

**`src/components/layout/AlertBell.tsx`** replaces the dead bell: real count
badge, dropdown, deep links, re-reads on `pathname` change so acting on an alert
clears it.

> Gotcha: the `.select()` column list must be an **inline literal**. Hoisting it
> to a `const` collapses PostgREST's typed overload to `GenericStringError[]`
> and the row cast fails to compile.

Loop simulation 14/14 (`/tmp/loop.mjs`), covering: hold blocks the purchase,
cross-department isolation, ceiling enforcement, WAIT_FULL blocking, and the
MRS returning to the requester for sign-off.

---

## 11. Session Review & Session-Safety Conformance (2026-09-18)

A fresh-agent onboarding pass over `copilot-instructions.md`, `AGENTS.md`/`CLAUDE.md`,
`agent_handoff.md`, and the full `src/` tree. No feature was requested this session; the
goal was conformance review (treat the handoff as the contract), a small bug fix, and a
verified baseline a successor can trust.

### 11.1 Review scope & methods
- Read every root doc (`copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`,
  `Plan.md`, `agent_handoff.md`, `package.json`, `next.config.ts`, `.env.local`).
- Grepped the tree against the handoff's own guardrails: `src/proxy.ts` (no
  `middleware.ts`), `getAll()`/`setAll()` cookie patterns (no deprecated single-key
  `get/set/remove`), `html2canvas-pro` only (Rule 8), `next_reference_number()` only
  (Rule 2), the `'use server'` constraint (no `export const` in `*`.actions files).
- Ran the local gates: `npx tsc --noEmit` ✅ · `npx eslint src` ✅ (1 pre-existing
  `no-unused-vars` warning in `(dashboard)/mrs/page.tsx`) · `npm run build --webpack`
  ✅ **30/30 routes** (validated with the standard offline font shim — this sandbox has
  no egress to `fonts.googleapis.com`; `src/app/layout.tsx` was left **unchanged**, and
  the `Geist` fetch succeeds normally on Vercel).
- Read the live Supabase migration files (0001–0014) present in `supabase/migrations/`.
  Direct DB probing was not possible from the sandbox (no outbound network); **no DB
  state was assumed** — treat any "applied in SQL Editor" claim below as unverified here.

### 11.2 Deviations found and fixed (session-safety, #441 crash class)
The handoff §8 states `getServerUser()` is "the only sanctioned way to resolve the server
session — never call `supabase.auth.getUser()` directly in Server Components." A grep
found the migration had missed two Server Components:

1. **`src/app/(dashboard)/transmittals/page.tsx`** — the Transmittals Hub is a Server
   Component that called `supabase.auth.getUser()` **unguarded**. Root cause: `getUser()`
   throws (does not return `{ error }`) on an expired/rotated refresh token or transient
   Auth-server network failure, which crashes the whole RSC render — the exact
   "Minified React error #441" vector the handoff documents. Fix: switched to
   `getServerUser()` (returns `null` on any failure), so the hub renders its three
   "Restricted" tiles instead of crashing. Minimal, targeted change per
   `copilot-instructions.md` — no layout, markup, or behaviour changes for signed-in users.
2. **`src/app/page.tsx`** — the root redirect component called `auth.getUser()` inside a
   `try/catch` (guard was correct but non-conforming). Normalised to `getServerUser()` and
   removed the now-dead `try/catch`; behaviour identical (signed-in → `/dashboard`, else
   `/login`).

Other `auth.getUser()` call sites found by the grep are **client-side** (`useEffect` /
`useCallback` in `jo/track`, `delivery/verify`, `mrs/new`, `mrs`, `admin/users`, and
`components/hardware/CameraCapture.tsx`), which is fine — the `getServerUser()` rule is a
Server-Component/action/proxy rule only. All eight `'use server'` action files and
`src/lib/audit/audit-service.ts` re-verified clean against the "no export const" rule.

### 11.3 Baseline for the next agent
- **Branch/commit:** work continues on the session branch; last mainline work is
  `080d74a` ("feat(form13): notify the requester on partial availability; close the loop").
- `agent_handoff.md` §2.1 is the migration inventory, but it stops at 0013; migrations
  **0014** files already exist (`0014_delivery_signoff_gate.sql`, `0014_legacy_audit.sql`,
  `0014_verify.sql`, plus `0013_verify.sql`) and Gate C is documented in §10.7 — when a
  fresh Supabase project is provisioned, replay **0001 → 0014 in order**, then run each
  `*_verify.sql`. On an existing project, `0013`/`0014` must be applied in the SQL Editor
  if the owner hasn't already (README notes the app degrades gracefully on `42703` until
  then, per Rule 7).
- A `DOne plan/` folder (tracked) holds older `Plan.md` / `PLAN2.md` / `agent_handoff.md`
  copies — it is a historical snapshot, **not** the source of truth. Always edit the root
  `agent_handoff.md`; do not try to keep the folder copy in sync.
- `next dev`/`next build` scripts pass `--webpack` explicitly (Turbopack is not enabled).
- The only reproducible build failure in this sandbox is the offline Google-Fonts fetch;
  on Vercel the build is network-enabled and compiles clean (handoff §8's 30/30 metric).

### 11.4 Verification
`git status` clean before work · `npx tsc --noEmit` ✅ · `npx eslint` on changed files ✅ ·
`npm run build` 30/30 (offline shim, `layout.tsx` unchanged) · changed files:
`src/app/page.tsx`, `src/app/(dashboard)/transmittals/page.tsx`, `agent_handoff.md`.

---

## 12. MRS Flow-Chain Audit — Close vs. Requester Sign-Off (2026-09-19)

Owner ran a flow-chain check on **Delivery Verification & Requester Sign-Off** (Form 14)
and **Accounting — Transmittals** (Form 11) for the loophole: *"the transmittal on an
MRS can close without the requester department's sign-off / delivery verification,
leaving the MRS closed and skipping the verification leg."* Verdict and trace below.

### 12.1 Conclusion — the loophole is CLOSED at three layers (post-0014)
`Accounting` / `SUPER_ADMIN` **cannot** close an MRS (or mark its transmittal RECEIVED)
without `requester_verification = 'VERIFIED'`, which only Form 14 (requester's department
or SUPER_ADMIN) can set.

| Layer | Location | Enforcement |
|---|---|---|
| UI | `transmittals/accounting/page.tsx` | `notDelivered = Boolean(tr.mrs) && !isDeliveryVerified(tr.mrs!)` disables **"Verify & Close MRS"**; amber *"Awaiting delivery sign-off by the requesting department (Form 14)"* line. Client pre-check in `handleVerifySpareChange` too. |
| Server action | `verifyCashAndMarkReceivedImpl()` in `transmittal-actions.ts` | `isDeliveryVerified(mrsGate)` throws **before** Gate B — an unverified MRS fails with *"has not been verified as delivered … Form 14 must happen first — that step computes how much spare change is owed"*. Only writer of `overall_status → 'CLOSED'` for MRS. |
| DB trigger | `trg_guard_mrs_delivery_signoff` (0014) | `RAISE EXCEPTION` on any `overall_status → CLOSED` while `requester_verification ≠ 'VERIFIED'` (hard check — survives REST `PATCH` with a service key, SQL editor, backfills). |
| DB trigger | `guard_transmittal_receipt()` (0013+0014) | blocks `receiver_status → RECEIVED` while the linked MRS is unverified **and** while spare change is unsettled (Gate B), and enforces SENT-before-RECEIVED (Rule 3). |

**Field-writer census (exhaustive grep of `src/` + migrations):**
- `overall_status = 'CLOSED'` is written in exactly **one** action — `verifyCashAndMarkReceived`
  (both hits are its legacy-branch/primary-branch).

- `requester_verification = 'VERIFIED' | 'DISPUTED'` is written in exactly **one** action —
  `verifyDeliveryRequester()` (Form 14). The two writes live in `purchaser-actions.ts` lines
  698/748 (the verified branch / the disputed branch) — both are the *correct* Form 14 actor,
  not a purchaser side-effect.

- `receiver_status = 'RECEIVED'` is written in exactly **one** action — `verifyCashAndMarkReceived`
  (the main transmittal update) plus its auto-generated `SPARE_CHANGE_RETURN` insert
  (exempt in the guard by `transmittal_type`).

- No client page writes MRS/transmittals directly; all writes route through `'use server'`
  actions (verified). `jo-actions` only writes `job_orders.status`; `pms-actions` /
  `user-actions` / `audit-actions` touch neither chain table.

- Candidate bypass paths confirmed safe: JO-cancel cascade (`0004`) only `VOID`s linked
  MRS and `CANCELLED`s transmittals (never `CLOSED`/`RECEIVED`); the batch-transmittal RPC
  (`create_batch_transmittal_transaction`) only sets `TRANSMITTAL_IN_PROGRESS`;
  `disburseCashAndMarkSent` only sets `SENT`; Front Desk (Form 12) cod flow touches
  `delivery_status`, not `overall_status → CLOSED` / `receiver_status → RECEIVED`.

### 12.2 The three rows in the owner's legacy-audit output are PRE-0014 damage
`0014_legacy_audit.sql` is read-only and only lists `CLOSED` requisitions, so its output
is **evidence of what already slipped through before Gate C existed** — not proof the
current chain is still open. `0014_verify.sql` check 4 calls these out as historical
damage. Owner's rows:

| MRS | Sign-off | Disbursed | Spent | Should-have-owed | Verdict |
|---|---|---|---|---|---|
| MRS-2026-000014 | PENDING_DELIVERY | 1,440.00 | 504.00 | 936.00 | **CASH LIKELY UNCOLLECTED — ₱936.00** |
| MRS-2026-000015 | PENDING_DELIVERY | 480.00 | 360.00 | 120.00 | **CASH LIKELY UNCOLLECTED — ₱120.00** |
| MRS-2026-000007 | PENDING_DELIVERY | 300.00 | 300.00 | 0.00 | NOTHING OWED |

Gate C is preventive only — it cannot retroactively mint a `spare_change_required` on an
already-CLOSED row. ₱936.00 + ₱120.00 need manual follow-up (recover the cash, or write it
off with approval). Row 007 cost nothing. To re-confirm on any project, run
`0014_verify.sql` checks 1–5 (1–3 must be `OK`; 4 is legacy-damage inventory; 5 is
informational) and `0014_legacy_audit.sql` for the reconstructed verdicts.

### 12.3 Residual (minor) recommendation — not yet implemented
`requester_verification` (VARCHAR, no CHECK constraint) relies on the single Form 14
writer to only ever set `'VERIFIED'`/`'DISPUTED'`/`'PENDING_DELIVERY'`. The triggers treat
*anything ≠ 'VERIFIED'* as unverified, so a typo'd value would fail safe (block the close) —
correct posture. Optional hardening: add a CHECK constraint
(`requester_verification IN ('PENDING_DELIVERY','VERIFIED','DISPUTED')`) in a future
migration. Not shipped this session (no functional gap).
