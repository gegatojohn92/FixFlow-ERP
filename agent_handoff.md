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
| **0015** | `0015_cash_chain_gates.sql` | **CASH CHAIN entry-point gates.** Three new triggers on `transmittal_forms`: `trg_guard_cash_transmittal_insert` (new budget transmittals only while the requisition is `APPROVED_READY_TO_ORDER / TRANSMITTAL_IN_PROGRESS / READY_FOR_PURCHASE / PURCHASING`), `trg_guard_cash_transmittal_sent` (marking SENT only from `TRANSMITTAL_IN_PROGRESS / READY_FOR_PURCHASE / PURCHASING`), `trg_guard_fd_cod_disbursement` (FD float COD advances only for genuine `is_online_purchase` orders still in flight). Idempotent, no new columns, does **not** touch `guard_transmittal_receipt()` so it cannot clobber Gate C. Companion: `0015_verify.sql`. **APPLIED in the Supabase SQL Editor on 2026-09-19** (owner-confirmed; after 0014). `0015_verify.sql` checks 1–4 all PASS (3 functions + 3 triggers live; `guard_transmittal_receipt` still carries both 0013 Gate B and 0014 Gate C) — see §12.5. Check 5 is informational: it lists legacy transmittals whose *current* MRS status is outside the pre-purchase window (expected — completed work ends CLOSED; the gate is preventive, not retroactive). |
| **0016** | `0016_gate_input_protection.sql` | **Gate-input protection — Phase 1 of §13.4.** Every 0012–0015 gate fires on a *status* column; 0016 protects the **values those gates read**, which were writable by the very roles they constrain (finding A1). Four new `SECURITY DEFINER` guards + three CHECK constraints: `trg_guard_mrs_financial_fields` — who may write `total_actual_spent` / `actual_shipping_fee` / `budget_variance_amount` (Purchaser), `spare_change_amount` (Purchaser or Accounting), `spare_change_returned` (Accounting, never reducible), `spare_change_required` (requester's department **and it must equal `mrs_disbursed_total − total_actual_spent`**; Accounting/SUPER_ADMIN may correct), `requester_verification` (requester's department), `allocated_budget` (Budget Officer), `availability_hold` (Purchaser raises it, only the department releases it), `requester_decision` (a Purchaser may only park it at `PENDING`), `delivery_status` / `revolving_fund_used` (Front Desk); `trg_guard_transmittal_fields` — `amount`, `mrs_id`, `transmittal_type`, `sender_user_id`, `receiver_user_id` are **immutable** (detaching or re-typing a row was how `guard_transmittal_receipt` got bypassed), `→ SENT` and `→ RECEIVED` are Accounting-only, `CANCELLED` deliberately left open for the JO cascade; `trg_guard_line_item_fields` + `trg_guard_line_item_delete` — the spend ledger Form 17 and the README's actual-spent formula are computed from. Constraints: `transmittal_forms.amount > 0` (closes **B3** at the schema level, including the FD types 0015 exempts), `requester_verification` vocabulary (closes **C3** / §12.3), cash figures non-negative. `auth.uid() IS NULL` (SQL Editor, `service_role`, `scripts/reset_test_data.sql`, backfills) is waved through. **Does not redefine any existing guard**, so it cannot clobber Gates B/C and re-running 0013 cannot clobber it. ⚠️ **NOT YET APPLIED — owner action required, after 0015.** Companion: `0016_verify.sql` (read-only, checks 1–7 must PASS). |
| **0017** | `0017_fix_jo_cancellation_cascade.sql` | **Rule 3 restored — the JO-cancellation cascade was broken two ways (finding A4).** (1) 0011 inlined `next_reference_number('TR', EXTRACT(YEAR FROM CURRENT_DATE))`, dropping 0004's `v_year INT` variable; `EXTRACT` returns NUMERIC since PostgreSQL 14 and numeric→integer is an *assignment* cast, not an *implicit* one, so resolution failed at runtime with `function next_reference_number(unknown, numeric) does not exist`. `on_jo_cancelled` is an AFTER UPDATE trigger, so the exception aborted the firing statement — a **SUPER_ADMIN could not cancel** a Job Order that had disbursed cash at all, and 4a/4c rolled back with it. (2) The function was **not `SECURITY DEFINER`**, so step 4b's `INSERT … SELECT FROM transmittal_forms` ran under the *cancelling user's* RLS. `transmittal_select_safe` (0005) admits only the sender, the receiver, and SUPER_ADMIN/ACCOUNTING/BUDGET_OFFICER/FRONT_DESK/PURCHASER — so MANAGER, MAINTENANCE and the requester saw **zero rows** and the mandatory `SPARE_CHANGE_RETURN` was **silently never created**: MRS voided, cash handed out never called back, no error and no log. Defect 2 also masked defect 1 (an empty SELECT never evaluates the broken call), which is why only SUPER_ADMIN ever saw a failure. Fixed with `::INT` + `SECURITY DEFINER SET search_path = public`; the body was extracted from 0011 **programmatically** (verified one-line diff) so no cascade branch could be lost in transcription — the §10.7 hazard class, handled deliberately. `auth.uid()` still resolves to the canceller, so `cancelled_by` keeps recording the real actor. ⚠️ Re-applying 0011 reintroduces **both** defects — re-run 0017; `0017_verify.sql` checks 1–2 detect it. ⚠️ **NOT YET APPLIED — owner action required, after 0016.** Companion: `0017_verify.sql` (read-only; check 6 inventories cancelled JOs that still owe a return). |
| **0018** | `0018_add_trip_completed_by.sql` | **Separation of duties on the purchase → sign-off handoff — Phase 2 of §13.4 (finding A1c).** Adds `material_requisitions.trip_completed_by UUID NULL REFERENCES users(id)`: who recorded the actuals on Form 13. `verifyDeliveryRequester()` refuses a Form 14 signer whose id matches it, so a PURCHASER sitting in the requesting department can no longer buy *and* certify receipt of their own purchase (SUPER_ADMIN remains the override). The stamp was needed because the only prior record of the executor was `activity_logs('PURCHASER_TRIP_COMPLETED')`, whose SELECT policy (`0005 audit_log_select_safe`) admits only SUPER_ADMIN/MANAGER/ACCOUNTING — a STAFF or PURCHASER verifier cannot read the row that would disqualify them, so an app check against the audit log **fails open for exactly the case it exists to catch**. Single writer (`purchaserCompleteTrip` is the only action that writes `total_actual_spent`), so one stamp covers offline trips, online orders and COD alike; each call overwrites it, so the column means "who last recorded the actuals". Backfills from the audit trail (latest entry per requisition) and is **idempotent** — re-running never overwrites an app-written stamp. **Data-only**: creates no function, trigger or policy, so it cannot clobber the 0011–0017 guards and has no ordering hazard. A DB-level mirror of the check is still deferred (§13.2 A1c). ⚠️ **NOT YET APPLIED — owner action required, after 0017.** Companion: `0018_verify.sql` (read-only; checks 1–2 must PASS, check 3 inventories sign-off-stage rows the backfill could not stamp). |
| **0019** | `0019_spend_ceiling_and_overspend_reason.sql` | **Spend ceiling + over-spend justification — Phase 3 of §13.4 (finding A3).** Adds `material_requisitions.overspend_reason TEXT` and `guard_mrs_spend_ceiling()` / `trg_guard_mrs_spend_ceiling`. Gate B derives the debt as `spare_change_required = mrs_disbursed_total(id) − total_actual_spent`, which makes a *self-reported* figure subtractive: every peso of claimed spend cancels a peso the purchaser would otherwise hand back, so reporting `spent ≥ disbursed` zeroed the debt legitimately — no console PATCH needed, and 0016's role gates (correct as far as they go) do not touch it. The guard refuses a spend above the ceiling unless the justification is present in the **same** UPDATE: ceiling = `mrs_disbursed_total(id)` (0013, `SECURITY DEFINER`, so it stays correct inside a trigger — the §13.5 A4 lesson), or the row's own `fast_track_cap_amount` for an Emergency Fast-Track requisition (Plan §6.A skips Form 10, so there is no transmittal to measure against). **A ceiling of 0 is a real ceiling**, not "no limit" — spend with no cash released now needs a reason instead of passing silently (the DB analogue of B10). `auth.uid() IS NULL` waved through like 0016; guards the spend figure only, so a pre-0019 row that is *already* over the ceiling stays updatable (no NOT-VALID-CHECK freeze). Creates one function + one trigger, redefines nothing from 0011–0018. Receipt evidence is **app-only** (receipts are `attachments` rows written after the spend figure) — see §13.7. ⚠️ **NOT YET APPLIED — owner action required, after 0018.** Companion: `0019_verify.sql` (read-only; checks 1–4 must PASS, checks 5–6 inventory existing A3/B7 damage). |

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

### Reset test data (clean slate for debugging)
`scripts/reset_test_data.sql` — paste into the **Supabase SQL Editor** to wipe every
transactional row (JO, MRS, line items, transmittals, price catalog, attachments, PMS
assets/activity, activity/audit logs, reference-number counters, storage-bucket files)
while **keeping `users`, `departments`, and `system_settings`**. Run Section C (the final
UNION-ALL SELECT) after to confirm 0 rows everywhere except the kept tables. Destructive
and irreversible — do not run in production outside a deliberate reset.

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
- `agent_handoff.md` §2.1 is the migration inventory and is current through **0019**. When a
  fresh Supabase project is provisioned, replay **0001 → 0019 in order** (skipping only the
  storage-schema migrations `0001_storage_buckets` / `0008` and the auth-seed `0006`), then
  run each `*_verify.sql`. On an existing project, **0016 → 0017 → 0018 → 0019 are still
  awaiting the owner's SQL Editor run, in that order** (0013/0014/0015 are applied and
  owner-confirmed); until then the app degrades gracefully on `42703` per Rule 7 / §10.5 —
  see §13.5, §13.6 and §13.7 for what each does and what its verify script must report.
- **Migration changes are executed, not eyeballed**: `supabase/tests/` holds a harness that
  boots a real PostgreSQL (`embedded-postgres`, devDependency of *that folder only*),
  replays the migrations and asserts the guards — `cd supabase/tests && npm install && npm
  test`. Run it after any migration edit and before handing one to the owner; it also
  executes every `*_verify.sql` and fails on any `FAIL` row. See `supabase/tests/README.md`
  (it supersedes the throwaway `/tmp/pgtest` harness described in §13.5, which did not
  survive between sessions).
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

### 12.4 Full CASH CHAIN audit — discrepancies found & enhancements (2026-09-19)

Full-chain review of **MRS → JO → Transmittal → Purchaser Procurement → Delivery
Verification/Sign-Off → Accounting/Financial Transmittals**, looking for cash-loopholes
and discrepancies. Result: the **settle-and-close path (0013/0014) was already airtight**;
the **cash entry points (when money is committed/released)** had gaps, now closed at the
app layer and backed by migration 0015 at the DB layer.

**Discrepancies / loopholes found and fixed:**

| # | Loophole | Risk | Fix (app) | Fix (DB) |
|---|---|---|---|---|
| L1 | `createTransmittal` accepted a linked MRS in **any** status except `CLOSED/VOIDED/ISSUED_FROM_STOCK` — cash could be issued against `PENDING_MANAGER`/`IN_CANVASSING`/`PENDING_OWNER` (no allocated budget) or already `FULFILLED`/`IN_TRANSIT` | Cash committed with no Owner approval / after purchase done | `TRANSMITTABLE_MRS_STATUSES` window check in `createTransmittal` | `trg_guard_cash_transmittal_insert` |
| L2 | **No cumulative limit** on cash issued against an MRS — unlimited supplemental transmittals | Over-disbursement leak | outlay-ceiling check (`allocated_budget + total_actual_spent`, returns exempt) in `createTransmittal` | not yet (needs cross-row aggregate trigger; app-enforced) |
| L3 | `disburseCashAndMarkSent` blocked only terminal statuses — could SEND cash against `APPROVED_READY_TO_ORDER` (before the transmittal chain) or after actuals saved | Cash released out of sequence | `DISBURSABLE_MRS_STATUSES` window check | `trg_guard_cash_transmittal_sent` |
| L4 | `createBatchTransmittal` RPC had **no** status/limit validation (only count ≤ 50) | Batch can fund unapproved/over-budget MRS | status + ceiling check per item before the RPC | insert trigger applies per-row inside the RPC's multi-row INSERT |
| L5 | Form 10 create page offered `FULFILLED` requisitions for new transmittals | UI invited a now-invalid action | candidate list uses `TRANSMITTABLE_MRS_STATUSES` | — |
| L6 | `fdCodDisbursement` accepted **any** amount & **any** requisition (no online-order check, no status check, no positive-amount check) | Revolving-float leak — cash to arbitrary/wrong requisitions | online+status+amount+ceiling checks in `fdCodDisbursement` | `trg_guard_fd_cod_disbursement` |
| L7 | Form 12 COD list showed `PURCHASING/READY_FOR_PURCHASE/IN_TRANSIT/APPROVED_READY_TO_ORDER` | List/dropdown drift from the enforced window | header uses `FD_COD_MRS_STATUSES` | — |
| L8 | Front Desk COD advance stamped `delivery_status='DELIVERED'` on the MRS even though it's a *cash advance*, not a physical delivery | `delivery_status` semantics (ledger/verify screens read `item_delivery_status`, not this column) | left as-is — no cash loophole; flagged for a follow-up (align `delivery_status` semantics or drop the write) | — |

**Confirmed already-safe (no change needed):** single close writer + Gate C (close needs
requester `VERIFIED`); `next_reference_number()` is atomic (no collisions, no gaps on the
composite PK); non-terminating code paths preserve the audit trail.

**Enhancements shipped this session:**
- `src/lib/status-machines.ts` — new shared windows `TRANSMITTABLE_MRS_STATUSES`,
  `DISBURSABLE_MRS_STATUSES`, `FD_COD_MRS_STATUSES` (single source of truth).
- `src/lib/actions/transmittal-actions.ts` — gates in `createTransmittal`,
  `createBatchTransmittal`, `disburseCashAndMarkSent`, `fdCodDisbursement`.
- `src/app/(dashboard)/transmittals/create/page.tsx` + `front-desk/page.tsx` — lists synced
  to the shared windows.
- `supabase/migrations/0015_cash_chain_gates.sql` + `0015_verify.sql` — DB-level hard gates.

**Verification:** `npx tsc --noEmit` clean · `npx eslint` clean (1 pre-existing warning) ·
`npm run build` 30/30. **✅ 0015 APPLIED 2026-09-19** (owner ran it + `0015_verify.sql`):
checks 1–4 PASS, check 5 informational — see §12.5.

### 12.5 Owner-run `0015_verify.sql` result (2026-09-19)

All hard checks green:

| check | status | note |
|---|---|---|
| 1. cash-chain functions | **PASS** | all three functions present |
| 2. triggers live | **PASS** | all three triggers present |
| 3. insert guard body | **PASS** | `len=1215` (the pre-purchase window is in the body) |
| 4. 0014 gates intact | **PASS** | `C=true B=true` — Gate C and Gate B both still live in `guard_transmittal_receipt` |

Check 5 listed 15 legacy transmittals whose **current** MRS status is `CLOSED`/`FULFILLED`
(e.g. `TR-…000001 → MRS-…000001 [CLOSED]`). That is **informational and expected**, not a
failure: every completed workflow ends with the MRS `CLOSED`, so *any* historical transmittal
on a finished requisition falls outside the pre-purchase window. The insert gate is
**preventive** — it stops *new* cash being issued against those statuses; it does not (and
must not) rewrite history. In particular:

- `TR-…000016 → MRS-…000014` / `TR-…000017 → MRS-…000015` — the two "CASH LIKELY
  UNCOLLECTED" rows from §12.2 — remain flagged for the manual ₱936.00 + ₱120.00 recovery;
  0015 does not (and cannot) fix that retrospectively.
- `TR-…000018` and `TR-…000019` both point at `MRS-…000017` — two disbursement transmittals
  on one requisition, expected for a supplemental/COD + initial split; closing time already
  settles them via Gate B.

**Handoff note:** `agent_handoff.md` §2.1's migration table and §12.4 have been updated to
"APPLIED" accordingly. No code changes this turn — the only file changed is `agent_handoff.md`.

---

## 13. Full-Chain Authorization & Cash-Integrity Audit (2026-09-20)

Fresh-agent audit of **JO → MRS → Transmittal → Purchase → Delivery Sign-Off →
Accounting Close**, extending §12.4. Scope: every `'use server'` action that writes
`job_orders`, `material_requisitions`, `mrs_line_items`, `transmittal_forms`; every
migration guard (0004–0015); and the live RLS policies (0005/0007).

> **Status: FINDINGS ONLY — no code changed this session.** The tree was verified
> green first (`npx tsc --noEmit` ✅ · `npx eslint src` ✅ 0 errors / the 1 known
> pre-existing warning · `npm run build` **30/30** via the §11.3 offline font shim,
> `src/app/layout.tsx` restored byte-identical). Supabase is unreachable from this
> sandbox (`https://<project>.supabase.co` → no route), so **no DB state was probed
> and none was assumed** — every finding below is evidenced in source, with a
> reproduction path the owner can confirm.

### 13.1 Verdict

The **status machine is airtight** (§12's conclusion holds: `overall_status`,
`receiver_status`, `sender_status` are trigger-guarded and the app/DB maps are in
sync branch-for-branch). The gap has moved **one level down**: the *inputs* those
gates read, and the *authorization* of who may drive each stage, are not protected.
§12.1's "closed at three layers" is true **through the UI**; at the data layer the
same loophole is reachable by the roles it is meant to constrain.

### 13.2 Findings

| # | Sev | Finding | Evidence |
|---|---|---|---|
| **A1** | **CRITICAL** | **Gate B / Gate C inputs are writable by the constrained roles.** No trigger and no CHECK protects `spare_change_required`, `spare_change_returned`, `requester_verification`, `total_actual_spent`, `allocated_budget`, or `transmittal_forms.amount`; all three MRS triggers fire `BEFORE UPDATE OF overall_status` **only**. RLS `mrs_update_safe` / `transmittal_update_safe` are column-blind. | `0005_fix_rls_recursion.sql:105-133` (no `WITH CHECK`, no column scope) · triggers: `0013:159`, `0014:51` (both `UPDATE OF overall_status`), `0013:209`/`0014:117` (`receiver_status`), `0015:107` (`sender_status`) · `0001` has **no** `CHECK (amount > 0)` |
| **A2** | **HIGH** | **No role gate on five stage-advancing actions** — `issueStockFormSK` (Form 6), `managerReviewMRS` (Form 7), `recordCanvassPricing` (Form 8, sets `allocated_budget`), `recordOwnerDecision` (Owner approval, sets `allocated_budget`), `postAuditFastTrack`. Status checks only. RLS lets a requester update **their own** row, and STOREKEEPER / BUDGET_OFFICER / ACCOUNTING / PURCHASER update **any** row. **Fixed in Phase 2 (§13.6)** — all five now assert the role beside the write; the same pass also found `createBatchTransmittal` had **no sender check at all** (it went straight from the session check to the batch RPC) and gated it too. | `mrs-actions.ts:276,369,431,533,604` — contrast `markMRSInTransit:658`, `purchaserConfirmCash:87`, `purchaserCompleteTrip:406`, `createTransmittal:44`, `disburseCashAndMarkSent:316`, `fdCodDisbursement:714`, `fdReplenishFloat:833`, `closeJobOrder:398`, which **all** check role |
| **A3** | **HIGH** | **Actual spend is never capped by the cash released, and receipts are optional.** `purchaserCompleteTrip` validates spend against `allocated_budget` only; `getDisbursedTotal()` is used **once**, at Form 14, to *derive* `spare_change_required = disbursed − spent`. A purchaser who reports `spent ≥ disbursed` legitimately drives `required` to `0` (`requiredRaw > TOLERANCE ? … : 0`) and Gate B then passes with the cash still in their pocket — no REST call needed. | `purchaser-actions.ts:587-596` (variance vs `allocated` only) · `:688-691` (required derivation) · `:533` (`if (item.receiptPhotoUrl)` — receipt not required) · README's "computed strictly from verified vendor receipts" is not enforced. **Fixed in Phase 3 (§13.7)** — migration **0019** caps the spend at the cash actually released (or the fast-track cap) unless an `overspend_reason` is recorded in the same write, and the app adds the receipt-evidence rule for the one claim that benefits the reporter. |
| **A4** | **HIGH** | **Rule 3's automatic `SPARE_CHANGE_RETURN` never worked.** Two independent defects in `cascade_jo_cancellation()`: (i) 0011 inlined `EXTRACT(YEAR …)` (NUMERIC since PG14) into a `(VARCHAR, INT)` call, so it failed to resolve at runtime and the AFTER-UPDATE exception rolled the cancellation back — SUPER_ADMIN could not cancel a JO with disbursed cash at all; (ii) the function was not `SECURITY DEFINER`, so its `INSERT … SELECT FROM transmittal_forms` ran under the canceller's RLS and MANAGER / MAINTENANCE / requester cancellations silently minted **nothing** (MRS voided, cash never called back, no error, no log). Found by *executing* the cascade against a real PostgreSQL, not by reading it. **Fixed by migration 0017.** | `0011:177` vs `0004:142,184` (the INT variable 0011 dropped) · `0005:116-127` (`transmittal_select_safe` excludes MANAGER/MAINTENANCE/STAFF) · reproduced: MANAGER cancel → `returns = 0` |
| **A1c** | RESIDUAL | **Same-department authority is role-blind.** Form 9 / Form 14 authority is scoped to `mrs.department_id` with **no role exclusion** in the app, so a PURCHASER or ACCOUNTING user who sits in the requester's department can answer their own availability hold and sign off their own delivery — the separation-of-duties conflict Gate C exists to prevent. 0016 **mirrors the app** rather than inventing a stricter policy (tightening it would change who can do their job, which is the owner's call, not a hardening decision). Recorded for Phase 2. **App layer closed in Phase 2 (§13.6)** — the *self*-approval case is now refused on both forms: Form 14 via new migration **0018** (`trip_completed_by`, needed because `activity_logs` SELECT is role-scoped and would have failed open), Form 9 via the existing `availability_reported_by`. The **DB-layer residual is unchanged**: 0016 still mirrors department-only authority, so a console PATCH remains role-blind (harness residuals R1/R2 still describe the DB, and still pass). | `purchaser-actions.ts:313,672` (department-only checks) · 0016 `v_is_dept` · harness residuals R1/R2 |
| **A5** | **CRITICAL** | **The MRS row policies omit roles the app routes to them, so Forms 6, 12 and 14 are unusable by their designated actors.** *(found in Phase 4 while fixing B2 — not in the original audit)* 0005 replaced 0002's policies with `mrs_select_safe` (requester · SA · MANAGER · BUDGET_OFFICER · ACCOUNTING · PURCHASER) and `mrs_update_safe` (the same + STOREKEEPER), and dropped "Staff read own dept MRS" to break the RLS recursion — never restoring own-department read once 0016 added the recursion-free `get_my_department_id()`. Under RLS the SELECT policy is applied to the rows an UPDATE reads, so a role missing from `mrs_select_safe` writes **0 rows** even where `mrs_update_safe` names it: the missing SELECT branch is the binding gate for every write. Reproduced in the harness (GAP **G1–G8**): **STOREKEEPER** sees no requisitions → Form 6's stock-check queue is empty and its actions die on "MRS not found."; **FRONT_DESK** cannot read the COD candidate list, cannot INSERT the COD leg (`transmittal_insert_safe` omits it, and 0015's insert trigger — not `SECURITY DEFINER` — then reports "references a requisition that does not exist"), and cannot write `delivery_status`/`revolving_fund_used` that **0016 Rule 9 names it the only legitimate writer of**; **MAINTENANCE** can neither read nor sign off **its own department's** deliveries (0016 Rule 5 grants exactly that); and a **same-department colleague who is not the requester** cannot sign off Form 14 — which makes the advice printed by 0016 Rule 5's own error text ("ask a colleague from that department, or a Super Admin"), repeated by Phase 2's A1c messages, unactionable. The fix widens who can read requisition data, so it is an **owner decision**: proposed migration **0020** is drafted in §13.8, not applied. | `0005:96-109` (both policies; the dept branch dropped) · `0002:70-75` (what 0005 dropped) · `0005:123-128` (`transmittal_insert_safe` omits FRONT_DESK) · `0016:429-437` (Rule 9 names FRONT_DESK) · `0016:366-377` (Rule 5 names the department) · harness GAP G1–G8 · `mrs/stock-check/page.tsx:56` · `transmittals/front-desk/page.tsx:59` · `delivery/verify/page.tsx:98` |
| **B1** | MEDIUM | **Multi-transmittal MRS dead-ends at close.** `receiver_status='RECEIVED'` has exactly two writers, both inside `verifyCashAndMarkReceivedImpl`, which requires `overall_status === 'FULFILLED'`. Once the first transmittal closes the MRS, every other SENT transmittal on it can never be received — and the error misdirects the operator to Form 14 ("Delivery must be verified…"), which already happened. The DB would allow it (`guard_transmittal_receipt` reads Gate C/B, not status). §12.5 already observed two transmittals on `MRS-2026-000017`. **Fixed in Phase 4 (§13.8)** — an already-CLOSED, already-settled requisition is now a *resume*: the receipt is written, both spare-change figures accumulate instead of being overwritten, and `overall_status` is left alone; every other non-FULFILLED status still refuses, with an error that names Forms 13 *and* 14 instead of pointing only at 14. Harness P17/P18 prove the DB permitted this all along, N9/N10 prove the resume cannot reduce recorded returns or bypass Gate C. | `transmittal-actions.ts:556-560` (FULFILLED requirement, error at :559) · `:606,641` (the only RECEIVED writers) · `0014:57-105` |
| **B2** | MEDIUM | **Four unchecked writes return `{ success: true }` after a failed UPDATE**, then log an activity entry claiming the change happened → false audit trail. PostgREST reports an RLS-denied UPDATE as 0 rows, silently. **Fixed in Phase 4 (§13.8)** — all four sites now request `count: 'exact'` and refuse on either an `error` or a 0-row write, *before* the activity entry is written, so the audit log can no longer claim a change that did not land. `count` rather than a follow-up SELECT because harness G8 proves SELECT is blind for exactly the roles these writes concern. | `mrs-actions.ts:393` (`managerReviewMRS`), `:566` (`recordOwnerDecision`), `:619` (`postAuditFastTrack`), `transmittal-actions.ts:795` (`fdCodDisbursement` → `delivery_status`) |
| **B3** | MEDIUM | **`fdReplenishFloat` has no amount validation at any layer** — no `Number.isFinite` / `> 0` check (unlike its two siblings), no `CHECK` on the column, and `0015`'s insert trigger **exempts** `FD_REVOLVING_REPLENISHMENT`. A negative or absurd replenishment posts straight to the float ledger. Receiver role is also unchecked despite `// The Front Desk user`. **App half fixed in Phase 2 (§13.6)** — amount must be finite and > 0, receiver must exist, be `ACTIVE` and be `FRONT_DESK` (matching the Form 12 dropdown exactly); the schema `CHECK (amount > 0)` came with 0016. | `transmittal-actions.ts:817-880` · `0015:42-44` · `0001` (no CHECK) |
| **B4** | MEDIUM | **The FD float legs never complete Rule 3.** `FD_REVOLVING_DISBURSEMENT` and `FD_REVOLVING_REPLENISHMENT` are inserted with `receiver_status='PENDING'` and nothing in `src/` ever acknowledges them — Form 12 has no arrival/acknowledgement action, so §5's "COD package arrival, and barcode acknowledgement" leg is missing. | `transmittal-actions.ts:783,861` · grep: only `:606,641` write `RECEIVED` |
| **B5** | MEDIUM | **`disburseCashAndMarkSent` writes SENT before advancing the MRS**, with no transaction. If the advance fails, cash is SENT while the MRS sits at `TRANSMITTAL_IN_PROGRESS` — and no action can recover it (disburse requires `sender_status='PENDING'`, and that transition has a single writer). **Fixed in Phase 4 (§13.8)** — the pair is now resumable rather than reordered: `sender_status='SENT'` *plus* a linked requisition still at `TRANSMITTAL_IN_PROGRESS` is recognised as the half-done state, the SENT write (and its `sent_at`) is left untouched, and the missing advance is completed. Every other non-PENDING status still refuses. | `transmittal-actions.ts:356-378` (SENT at :356, advance after) |
| **B6** | MEDIUM | **Receiver is never validated** in `createTransmittal`, `createBatchTransmittal`, `fdReplenishFloat` — not existence, not `account_status='ACTIVE'` (Rule 5), not role. Cash can be handed to a deactivated account that can never acknowledge it (Rule 3 stalls permanently). The Form 10 UI lists only ACTIVE users, so the action is looser than the UI. **Fixed in Phase 2 (§13.6)** via a shared `requireActiveReceiver()`; no role filter is imposed on Forms 10/11 because §5 deliberately lists every active account there. | `transmittal-actions.ts:144` (single receiver write) · `:861` (replenish receiver) |
| **B7** | MEDIUM | **Over-return check is skipped when `required === 0`** (`… && required > 0`), so Accounting can enter any amount ≤ the transmittal, which is written to `spare_change_returned` **and** mints a phantom `SPARE_CHANGE_RETURN` — understating net disbursed in Form 17. **Fixed in Phase 3 (§13.7)** at the app layer (the `gateUnavailable` pre-0013 path stays permissive on purpose); no CHECK constraint was added, because a `NOT VALID` constraint would freeze every legacy violating row against *all* future updates — `0019_verify.sql` check 6 inventories them so a later migration can add it safely. | `transmittal-actions.ts:540` (the `&& required > 0` escape) · `:632` (phantom return insert) |
| **B8** | MEDIUM | **`createMRS` trusts the client's `department_id`** although it has already fetched `profile.department_id`. Department drives who may sign off Form 14 and decide Form 9, so a crafted request reassigns both. Form 5 sends the right value; the server does not enforce it. **Fixed in Phase 2 (§13.6)** — the profile's department is now authoritative; only `CROSS_DEPARTMENT_MRS_ROLES` (MANAGER/SUPER_ADMIN) may file for another department, and a profile with no department is refused instead of passing the client's value through. | `mrs-actions.ts:181` (client value written) vs `:49-60` (profile already fetched) · `purchaser-actions.ts:672,313` |
| **B9** | MEDIUM | **§10.6's "return a structured result, never throw" pattern was applied to 1 of ~20 client-called actions.** The other 19 still throw, so in production every carefully-worded gate message added by 0012–0015 surfaces as an opaque digest — the exact symptom §10.5/§10.6 were written to eliminate. | `verifyCashAndMarkReceived:673` (wrapped) vs `purchaserCompleteTrip`, `createTransmittal`, `disburseCashAndMarkSent`, `fdCodDisbursement`, `reportItemAvailability`, `requesterAvailabilityDecision`, `verifyDeliveryRequester`, all `jo-`/`mrs-`/`user-` actions |
| **B10** | LOW-MED | **The outlay ceiling no-ops on a zero-budget requisition** — `if (outlayCeiling > 0)` and `if (ceiling <= 0) continue`. A requisition with `allocated_budget` 0/NULL can receive unlimited cash transmittals (L2's app-only gate silently disarms itself). **Fixed in Phase 3 (§13.7)** — both the single and batch paths now fail closed on a zero ceiling, and the Form 10 picker disables those requisitions; 0019 mirrors the same rule in the DB for spend. | `transmittal-actions.ts:106-121` (`if (outlayCeiling > 0)`) · `:246-256` (`if (ceiling <= 0) continue`) |
| **C1** | LOW | `guard_transmittal_receipt()` selects `v_mrs_status` and never uses it — a dropped check; worth confirming no status rule was lost between 0013 and 0014. | `0014:68,92` |
| **C2** | LOW | `purchaserCompleteTrip` updates line items in a loop with `throw itemErr` (raw PostgREST object, no message) and no rollback → partial actuals on a mid-loop failure. **Fixed in Phase 4 (§13.8)** — the raw object is replaced with an `Error` naming the line item and how many of the trip's lines already landed, plus why re-saving is safe (the loop writes absolute values, not increments). | `purchaser-actions.ts:519-530` (`throw itemErr` at :530) |
| **C3** | LOW | §12.3's `requester_verification` CHECK constraint is still open — now load-bearing, because A1 makes that column a direct bypass. | §12.3 |
| **C4** | INFO | `components/hardware/CameraCapture.tsx` uses hooks + the browser client with no `'use client'`; safe only because every importer is a client component. Pre-existing eslint warning at `mrs/page.tsx:88` (unused `refreshing`) unchanged. | — |

### 13.3 Reproduction paths (owner-verifiable, no code required)

- **A1 / Gate C bypass** — as any user in the requester's department, from the
  browser console on any signed-in page:
  `await supabase.from('material_requisitions').update({ requester_verification: 'VERIFIED', spare_change_required: 0 }).eq('id', <mrs>)`
  then `.update({ overall_status: 'CLOSED' })`. Both writes pass RLS
  (`requester_id = auth.uid()`) and **no trigger fires** (they are not
  `overall_status`→guard-covered in the first statement, and by the second the
  Gate C condition is already satisfied). Result: §12's "closed at three layers"
  is defeated without touching the UI.
- **A1 / ledger amount** — as the *receiver* of a transmittal:
  `.from('transmittal_forms').update({ amount: 999999 }).eq('id', <tr>)` — allowed
  by `transmittal_update_safe`, no CHECK, no trigger (0015's insert gate does not
  fire on UPDATE).
- **A2 / self-approval** — as a STAFF requester, invoke the Form 7 then Form 8 then
  Owner-decision actions on your own requisition (server actions are POSTed with
  the `Next-Action` id; the proxy authorizes the *route*, not the *action*). RLS
  permits the writes on your own row, so your own requisition reaches
  `APPROVED_READY_TO_ORDER` with an `allocated_budget` you chose — the ceiling a
  Budget Officer's cash issuance is then validated against.
- **A3 / zero-out the spare change** — as the purchaser, save actuals whose total
  meets or exceeds the disbursed cash (receipts optional), then Form 14 computes
  `required = 0`; Accounting closes legitimately and Gate B records a settled
  balance.
- **B1** — any MRS with ≥ 2 SENT transmittals (e.g. `TR-…000018` / `TR-…000019` on
  `MRS-…000017`, §12.5): close the first, then attempt the second → permanent
  dead-end with a misleading Form-14 error.

### 13.4 Recommended remediation (phased, not started)

1. ~~**Migration 0016 — protect the gate inputs (A1, B3, C3).**~~ ✅ **SHIPPED
   2026-09-20** — `0016_gate_input_protection.sql` + `0016_verify.sql`, plus
   `0017_fix_jo_cancellation_cascade.sql` + `0017_verify.sql` for finding **A4**,
   which the 0016 test run surfaced. See §13.5 for the deviation from this plan
   (triggers instead of column privileges) and the verification matrix.
   **Awaiting the owner's SQL Editor run (0016 then 0017, after 0015).**
2. ~~**App authorization pass (A2, B6, B8).**~~ ✅ **SHIPPED 2026-09-20** — role gates
   added through the existing `status-machines.ts` role-list convention, receivers
   validated in all three cash-issuing actions, `department_id` forced from the
   server-side profile, and **A1c** closed at the app layer with new migration
   **0018**. See §13.6 for the gate/route cross-check, the behaviour changes and the
   three deliberate exclusions. **0018 awaits the owner's SQL Editor run (after 0017).**
3. ~~**Cash math (A3, B7, B10).**~~ ✅ **SHIPPED 2026-09-20** — migration **0019**
   (`overspend_reason` + `guard_mrs_spend_ceiling()`) bounds reported spend at the cash
   actually released; Form 13 collects the justification and enforces the receipt-evidence
   rule; B7's over-return bound now applies when `required === 0`; B10's ceiling fails
   closed in both the single and batch paths and in the Form 10 picker. See §13.7 for the
   design decisions (why the ceiling is *released* cash rather than budget, why no CHECK
   constraint for B7, what is deliberately app-only) and the verification matrix.
   **0019 awaits the owner's SQL Editor run (after 0018).**
4. ~~**Durability & diagnostics (B1, B2, B5, C2).**~~ ✅ **SHIPPED 2026-09-20** —
   an already-CLOSED requisition is now a *resume* for its remaining SENT
   transmittals (B1), all four unchecked writes verify the affected-row count
   before logging success (B2), the disburse→advance pair is resumable instead of
   reordered (B5), and the raw `throw itemErr` is a real `Error` that names the
   line and the partial state (C2). App-layer only: **no migration**. It also
   surfaced a new CRITICAL finding, **A5** — see §13.8 and item 7.
5. **Rule 3 completion for the float (B4)** — a Form 12 acknowledgement action as
   the second writer of `receiver_status='RECEIVED'` for the FD legs.
6. **Error surfacing (B9)** — extend §10.6's structured-result wrapper to the
   client-called actions, highest-cash-risk first.
7. **A5 — align the MRS/transmittal row policies with the roles the app routes
   (owner decision).** Forms 6, 12 and 14 are unusable by STOREKEEPER,
   FRONT_DESK, MAINTENANCE and same-department colleagues because
   `mrs_select_safe` omits them and RLS applies the SELECT policy to the rows an
   UPDATE reads. Migration **0020** is drafted in §13.8 with the exact policy
   text and the residual it introduces; it widens read reach, so it waits on the
   owner rather than shipping with a phase.

Each phase is independently shippable and must finish green on
`tsc` · `eslint` · `build 30/30` per §11.3, with the phase recorded here.

### 13.5 Phase 1 shipped — 0016 + 0017 (2026-09-20)

**Files added (no application code changed):**
`supabase/migrations/0016_gate_input_protection.sql`, `0016_verify.sql`,
`0017_fix_jo_cancellation_cascade.sql`, `0017_verify.sql`.

**Deviation from the §13.4 plan, and why.** Phase 1 was specified as column-level
`GRANT UPDATE (…)`. That was wrong, and was dropped after tracing the privileges:
Supabase grants **table-level** `ALL` to both `authenticated` and `service_role`, and
a column grant only *adds* to a table grant — so column privileges would have done
nothing at all until table-level UPDATE was revoked and every column the app writes
was re-enumerated (one omission breaks a production flow), and they would *still* not
bind `service_role`. `BEFORE UPDATE` triggers fire for every role including
`service_role`, express "who may write **what**" instead of "who may write this
column", and raise actionable messages in the house style. Strictly stronger.

**Scope discipline.** 0016 protects only the columns whose legitimate writer is
already role- or department-checked in the app, or already fenced by route RBAC in
`access-control.ts` (`/mrs/canvass` → BUDGET_OFFICER + SUPER_ADMIN, `/purchaser` →
PURCHASER, `/transmittals/accounting` → ACCOUNTING, `/mrs/stock-check` → STOREKEEPER),
so no UI flow can regress. `manager_status` / `owner_status` / `fast_track_audited_*`
were **deliberately left to Phase 2**: those four actions are exactly the ones with
unchecked writes (finding **B2**), so a new DB rejection there would be swallowed and
reported to the operator as success. Hardening them before their error handling exists
would have manufactured silent false-approvals.

**Verification — a real PostgreSQL, not a code read.** apt and the Supabase host are
both unreachable from this sandbox, but the npm registry is not, and
`@embedded-postgres/linux-x64` ships genuine PostgreSQL binaries (18.4) inside the
tarball. Harness: boot a cluster → lay down Supabase-compatible scaffolding
(`anon` / `authenticated` / `service_role` + `auth.uid()` reading
`request.jwt.claims`, table-level `ALL` so RLS is the gate, not grants) → replay
**0001 → 0017** in order (skipping only the storage-schema migrations `0001_storage_buckets`
/ `0008` and the auth-seed `0006`) → seed 10 users across all 9 roles in two
departments → run each case as a signed-in role inside a rolled-back transaction with
per-step savepoints.

**59/59 cases passed.**

| Bucket | Count | What it proves |
|---|---|---|
| POSITIVE | 25/25 | Every legitimate write traced out of `src/lib/actions` still succeeds: Form 6 stock issue, Form 8 line pricing + `allocated_budget`, Form 9 hold answer/release (incl. WAIT_FULL keeping the hold), Form 11 SENT → settle-and-close in §10.6's order → RECEIVED, Form 12 COD flags, Form 13 actuals + availability report + line ceilings, Form 14 sign-off with the computed debt, the JO cascade's `CANCELLED` writes as MANAGER, and SUPER_ADMIN/Accounting corrections. |
| NEGATIVE | 32/32 | Every §13.3 bypass now fails. Each case records **how** it was stopped — `raised` (the guard fired) or `silent no-op` (RLS hid the row, value provably unchanged, re-read as postgres before and after) — because a 0-row UPDATE is a successful defence that would otherwise look like a pass for the wrong reason. |
| RESIDUAL | 2/2 | **A1c** documented, not "fixed": a same-department ACCOUNTING/PURCHASER still holds Form 9 / Form 14 authority, because that is what the app says. 0016 mirrors the app instead of silently inventing a stricter policy. |

`0016_verify.sql` checks **1–7 PASS** (8–9 informational) · `0017_verify.sql` checks
**1–5 PASS** (6 informational). Both were executed against the same cluster, so the
owner-facing scripts are known-good SQL, not eyeballed SQL.

Repo gates, unchanged baseline: `npx tsc --noEmit` ✅ clean · `npx eslint src` ✅
0 errors + the 1 known pre-existing warning (`mrs/page.tsx:88`) · `npm run build`
✅ **30/30 routes** via the §11.3 offline font shim, `src/app/layout.tsx` restored
byte-identical (`git status` clean apart from these four files and this document).

**Finding A4 was found by executing, not by reading.** Neither §9 nor §12 caught it:
the `EXTRACT` cast defect only raises when the branch produces a row, and the
RLS-blindness defect only appears when the canceller is *not* SUPER_ADMIN — so each
defect hid the other. The harness ran the cascade as MANAGER, STAFF and SUPER_ADMIN
and compared the resulting `transmittal_forms` rows.

**Owner action required:**
1. Run `0016_gate_input_protection.sql` in the Supabase SQL Editor (after 0015), then
   `0017_fix_jo_cancellation_cascade.sql`. Order matters; both are idempotent.
2. Run `0016_verify.sql` (checks 1–7 must be PASS) and `0017_verify.sql` (1–5 PASS).
3. Read `0017_verify.sql` **check 6** and `0016_verify.sql` **check 8**: they inventory
   the historical damage these gates cannot retroactively repair — cancelled Job Orders
   that still owe a `SPARE_CHANGE_RETURN`, and legacy rows that made a CHECK constraint
   land `NOT VALID`. Treat like §12.2's ₱936.00 + ₱120.00: recover or write off with
   approval.

**Reproducing the harness** (kept out of Git, per the §10.9 `/tmp/loop.mjs` precedent —
it needs `embedded-postgres`, which must not enter `package.json`):
`mkdir /tmp/pgtest && cd /tmp/pgtest && npm i embedded-postgres pg`, then a script that
boots a cluster, applies `supabase/migrations/*.sql` in numeric order, and asserts the
59 cases above. `scripts/reset_test_data.sql` remains the way to clean the live project.
> **Superseded in Phase 3:** that harness lived in `/tmp` and did not survive the session,
> so it was rebuilt as a tracked asset at **`supabase/tests/`** — same design (real cluster,
> signed-in roles, rolled-back transactions, per-step savepoints, raised-**or**-unchanged
> assertion rule), now covering 0016–0019 and executing all four verify scripts.
> `cd supabase/tests && npm install && npm test`. The §10.9 constraint is still honoured:
> `embedded-postgres` is a devDependency of *that folder's* own `package.json`, never the
> app's. See `supabase/tests/README.md`.

**Still open (Phases 5–6 of §13.4 — Phase 2 shipped in §13.6, Phase 3 in §13.7,
Phase 4 in §13.8):** Rule 3 completion for the FD float (B4) → error surfacing (B9),
plus **A5** (row policies vs. the roles the app routes), which needs an owner decision
on the drafted migration 0020. Note **A4 is closed** by 0017, **B3/C3** by 0016,
**A2/B6/B8 + A1c's app layer** by Phase 2, **A3/B7/B10** by Phase 3, and
**B1/B2/B5/C2** by Phase 4.

### 13.6 Phase 2 shipped — app authorization pass (2026-09-20)

**Findings closed:** **A2** (role gates), **B6** (receiver validation), **B8**
(client-trusted `department_id`), the app half of **B3** (replenishment amount), and
**A1c** at the app layer (self-approval on Forms 9 and 14). New migration **0018** +
`0018_verify.sql`.

**Files changed**

| File | Change |
|---|---|
| `src/lib/status-machines.ts` | Six new role lists beside `JO_CLOSE_ROLES` / `MRS_IN_TRANSIT_ROLES`: `STOCK_CHECK_ROLES`, `MANAGER_REVIEW_ROLES`, `CANVASS_ROLES`, `OWNER_DECISION_ROLES`, `FAST_TRACK_AUDIT_ROLES`, `CROSS_DEPARTMENT_MRS_ROLES`. |
| `src/lib/actions/mrs-actions.ts` | New module-local `requireActorRole(supabase, allowed, message)` (session → profile → role, throws the house-voice message); wired into `issueStockFormSK`, `managerReviewMRS`, `recordCanvassPricing`, `recordOwnerDecision`, `postAuditFastTrack`. `createMRS` resolves the department from the profile (B8). |
| `src/lib/actions/transmittal-actions.ts` | New module-local `requireActiveReceiver(supabase, id, expectedRole?)`; called by `createTransmittal`, `createBatchTransmittal`, `fdReplenishFloat` (the last with `'FRONT_DESK'`). `createBatchTransmittal` also gained the sender gate it never had; `fdReplenishFloat` gained amount validation. |
| `src/lib/actions/purchaser-actions.ts` | `purchaserCompleteTrip` stamps `trip_completed_by`; `verifyDeliveryRequester` refuses the executor; `requesterAvailabilityDecision` refuses the reporter; both now refuse a missing profile row instead of falling through their authority check. |
| `src/types/database.types.ts` | `trip_completed_by` added to `material_requisitions` Row / Insert / Update + its Relationships FK entry (generated-style, hand-applied — the sandbox cannot reach Supabase to re-run `supabase gen types`; a future regeneration after 0018 is applied produces the same four additions). |
| `src/app/(dashboard)/mrs/page.tsx` | `canAudit` now reads `FAST_TRACK_AUDIT_ROLES` instead of an inline literal, so the button and the server gate cannot drift. |
| `supabase/migrations/0018_add_trip_completed_by.sql`, `0018_verify.sql` | **NEW** — see §2.1. |

**Every gate was cross-checked against `ROUTE_ACCESS_RULES`, not invented.** A server
gate narrower than its route rule would lock out legitimate users, so each list was
derived from the route that hosts the action and then confirmed against the Plan:

| Action (Form) | Role list | Route rule it matches |
|---|---|---|
| `issueStockFormSK` (6) | `SUPER_ADMIN, STOREKEEPER` | `/mrs/stock-check` — identical |
| `managerReviewMRS` (7) | `SUPER_ADMIN, MANAGER` | `/mrs/manager-queue` — identical |
| `recordCanvassPricing` (8) | `SUPER_ADMIN, BUDGET_OFFICER` | `/mrs/canvass` — identical, and matches 0016 rule R6 (`allocated_budget` → Budget Officer) |
| `recordOwnerDecision` (8) | `SUPER_ADMIN, BUDGET_OFFICER` | `/mrs/canvass` — the Owner is an off-platform actor; the Budget Officer who ran the canvass records the outcome |
| `postAuditFastTrack` (9) | `SUPER_ADMIN, MANAGER, BUDGET_OFFICER` | `/mrs` is viewable by all nine roles, so the **action** is the gate — see below |
| `createBatchTransmittal` (10) | `SUPER_ADMIN, BUDGET_OFFICER` | same list `createTransmittal` already enforced |
| `fdReplenishFloat` receiver (12) | `FRONT_DESK`, `ACTIVE` | the Form 12 UI already queried `.eq('role','FRONT_DESK').eq('account_status','ACTIVE')` |

**The post-audit actor was read, not guessed.** `DOne plan/Plan.md:650` (§6.A step 3):
*"Within 24 hours, a Manager or Budget Officer opens the record from Form 9 and completes
a post-audit."* Independently, the Form 9 UI already hid the button behind exactly
`['SUPER_ADMIN','MANAGER','BUDGET_OFFICER']` (`mrs/page.tsx:287`) — so the shipped list
agrees with both the spec and the screen, and only the Server Action was missing it.
⚠️ Citation note for the next agent: the **root** `Plan.md` is a *different* document
("Feature Blueprint: Comprehensive Audit Logging…") and contains no Form specs; the
form-level plan that code comments cite as "Plan §6.A" / "Plan §5 Form 10" lives only in
`DOne plan/Plan.md`. That folder is otherwise a historical snapshot (§11.3) — read it for
intent, never edit it.

**Why A1c needed a migration instead of an audit-log lookup.** The obvious implementation
— compare the Form 14 signer against the `PURCHASER_TRIP_COMPLETED` row in `activity_logs`
— silently fails open, because `0005 audit_log_select_safe` grants SELECT only to
SUPER_ADMIN / MANAGER / ACCOUNTING. The actor who most needs to be caught (a PURCHASER or
STAFF member of the requesting department) cannot read the row that disqualifies them, so
the query returns nothing and the sign-off proceeds. `material_requisitions` has no other
record of who bought the goods, hence 0018's stamp. Form 9 needed no migration:
`availability_reported_by` (0013) is already on the row and already selected.

**Legacy tolerance (Rule 7 / §10.5), both directions.** A project that has not applied
0018 yet must keep working, so: the stamp write retries without `trip_completed_by` on
`42703` (losing the stamp must not lose the actuals), and the Form 14 read retries with
the pre-0018 column set (sign-off continues, minus the self-approval check). No path
fails closed on a missing column.

**Deliberate exclusions** — recorded so they are not re-found as oversights:

1. **`fdCodDisbursement`'s receiver is not validated.** It is *derived*
   (`mrs.requester_id`), not client-supplied, so it is not the B6 shape; refusing it would
   strand an in-flight COD parcel at the front desk with no in-app remedy (no SUPER_ADMIN
   override helps — the *receiver*, not the actor, is the problem). Correct place to
   enforce it is the deferred DB mirror, where an override path can be designed.
2. **No client-side pre-empt for the two A1c refusals.** `/delivery/verify` does not
   select `trip_completed_by` and `/mrs` loads neither `availability_reported_by` nor the
   viewer's id, so hiding the buttons would mean new client queries with their own `42703`
   fallbacks. The refusals therefore surface through the existing error paths — which is
   **B9** territory: in production a thrown Server Action surfaces as an opaque digest, so
   these two messages will read clearly in dev and poorly in prod until Phase 6 wraps the
   client-called actions in `{success, error}`. Deliberately not half-converted here.
3. **A1c's DB mirror is still deferred**, together with the §13.2 columns 0016 left alone
   (`manager_status`, `owner_status`, `fast_track_audited_*`).

**Behaviour changes an operator will notice** (all intentional):

1. A user whose profile has **no department** can no longer file an MRS — clear error
   asking for an administrator, instead of writing whatever the client sent.
2. **MANAGER** may now file for another department (before, *anyone* could). The Form 5 UI
   still files for the actor's own department only, so no screen changes.
3. **Batch transmittals** now require Budget Officer / SUPER_ADMIN. Previously the action
   had no sender check at all and relied entirely on `/transmittals/create` being hidden.
4. **Cash cannot be handed to a non-ACTIVE account** — including
   `PASSWORD_RESET_REQUIRED` (the `users.account_status` default), which is exactly the
   account that could never acknowledge receipt under Rule 3. Both dropdowns already
   excluded those users, so no legitimate pick is lost.
5. **FD float replenishment** requires a finite amount > 0 and an ACTIVE `FRONT_DESK`
   receiver; the error names the actual account status so the Budget Officer knows what to
   fix.
6. **Self-approval is refused**: whoever recorded the actuals cannot sign off that
   delivery (Form 14), and whoever raised an availability hold cannot answer it (Form 9).
   This covers Form 14's **dispute** path too — the executor cannot freeze the chain on
   their own purchase either. SUPER_ADMIN overrides both, which is the escape hatch for a
   department too small to have a second pair of hands.
7. A **missing profile row** now refuses Forms 9 and 14 instead of silently falling
   through the department-authority check (`if (decider && …)` / `if (verifier && …)` were
   fail-open on `null`).

**Verification (all re-run after the final edit)**

- `npx tsc --noEmit` ✅ clean.
- `npm run lint` ✅ 0 errors + the 1 known pre-existing warning (`mrs/page.tsx` unused
  `refreshing`, now line 89 after the added import).
- `npm run build` ✅ **30/30 routes** via the §11.3 offline font shim; `src/app/layout.tsx`
  restored byte-identical afterwards (`git diff` empty for that file).
- `/tmp/pgtest` harness ✅ **62/62** — POSITIVE **28/28** (the 25 Phase-1 cases unchanged
  plus three new 0018 cases: **P24** the column is a nullable UUID FK to `users`, **P25**
  the backfill recovers the executor from a seeded `PURCHASER_TRIP_COMPLETED` entry,
  **P26** re-applying 0018 does not overwrite an app-written stamp even when a *newer*
  audit entry by a different actor exists) · NEGATIVE **32/32** unchanged · RESIDUAL
  **2/2** unchanged. Replay range is now **0001 → 0018**; 0018 applied cleanly on first
  run.
- `0016_verify.sql` checks 1–7 PASS (8–9 INFO) · `0017_verify.sql` 1–5 PASS (6 INFO) ·
  **`0018_verify.sql` 1–2 PASS** (3–4 INFO) — all three executed against the same
  cluster, so the owner-facing scripts are known-good SQL.
- No existing guard function is redefined by 0018 (`CREATE OR REPLACE FUNCTION` count: 0),
  so the §10.7 / §13.5 clobber hazard does not apply and no re-run ordering is introduced.

**Owner action required**

1. Apply `0018_add_trip_completed_by.sql` in the Supabase SQL Editor **after 0017**
   (idempotent; safe to re-run at any time).
2. Run `0018_verify.sql` — checks **1–2 must be PASS**. Read **check 3**: it counts
   sign-off-stage requisitions the backfill could not stamp (no `PURCHASER_TRIP_COMPLETED`
   audit entry). For those rows only, the Form 14 self-approval block cannot fire — it
   behaves as it did before 0018. Check 4 is a reminder that enforcement is app-layer.
3. No data cleanup is implied. Unlike 0016 check 8 / 0017 check 6, nothing here inventories
   damage — 0018 is additive.

### 13.7 Phase 3 shipped — cash maths (2026-09-20)

**Findings closed:** **A3** (spend was never bounded by the cash released, receipts
optional), **B7** (over-return bound skipped when `required === 0`), **B10** (the outlay
ceiling disarmed itself on a zero budget). New migration **0019** + `0019_verify.sql`.

**Files changed**

| File | Change |
|---|---|
| `supabase/migrations/0019_spend_ceiling_and_overspend_reason.sql`, `0019_verify.sql` | **NEW** — `overspend_reason` column + `guard_mrs_spend_ceiling()` / `trg_guard_mrs_spend_ceiling`. See §2.1. |
| `src/types/database.types.ts` | `overspend_reason` added to `material_requisitions` Row / Insert / Update. |
| `src/lib/actions/purchaser-actions.ts` | `purchaserCompleteTrip` gains `overspendReason?`, a **pre-pass** that clamps and totals the trip *before* any write, the ceiling + receipt rules, the stepped legacy column sets, and a richer audit entry. Quantity policy extracted to `planPurchasedQty()` so the validated total and the written total cannot diverge. |
| `src/lib/actions/transmittal-actions.ts` | **B7** — over-return bound now applies when nothing is owed (`!gateUnavailable && …`, the pre-0013 path stays permissive). **B10** — a zero outlay ceiling is refused in `createTransmittal` *and* `createBatchTransmittal` instead of skipping the check. |
| `src/app/(dashboard)/purchaser/queue/page.tsx` | Loads the cash released for the selected requisition (`mrs_disbursed_total`, same fallback as the server), shows it beside Allocated Budget, collects the over-spend reason when the trip exceeds it, states the receipt requirement, and disables Submit until both are satisfied. |
| `src/app/(dashboard)/transmittals/create/page.tsx` | Both MRS pickers (single + batch) disable requisitions with a zero outlay ceiling, so the server refusal is never reached by accident. |
| `supabase/tests/` | **NEW** — the migration harness, now a tracked asset (`README.md`, `migration-harness.mjs`, its own `package.json`), plus `.gitignore` entries for its `node_modules/` and `.pg-data/`. |

**Design decisions** (recorded because each was a fork, not a detail):

1. **The ceiling is the cash *released*, not the budget.** Gate B computes
   `required = mrs_disbursed_total − total_actual_spent`, so the figure the purchaser
   types is *subtractive*: every peso of claimed spend cancels a peso they would otherwise
   hand back. The pre-existing variance-vs-`allocated_budget` check could not see that —
   `allocated_budget` is what the Owner approved and the purchaser never holds it, so
   "spent more than approved" and "spent more than I was given" are different failures.
   A3 is the second one, and it is the one that pays.
2. **Justification, not prohibition.** Over-spending the released cash is legitimate
   (a store price above the canvass, an out-of-pocket top-up, a COD fee), so 0019 requires
   `overspend_reason` rather than refusing the trip. The reason is stored on the
   requisition **and** written to the audit entry, so Form 17 / an owner review can list
   every trip that cost more than it was given. A trip back within the ceiling clears any
   stale reason.
3. **Emergency Fast-Track is capped at its own cap.** It has no transmittal to measure
   against (Plan §6.A skips Forms 6/7/8/10), so the bound is the row's
   `fast_track_cap_amount` — the same figure that let it bypass approval — falling back to
   `get_setting_numeric('mrs.fast_track_cap_amount', 3000)` and then `FAST_TRACK_CAP_DEFAULT`.
4. **A ceiling of 0 is a real ceiling.** `if (outlayCeiling > 0)` / `if (ceiling <= 0) continue`
   were the B10 no-ops: a requisition with no approved budget could be funded without
   limit. Both app paths now refuse, and 0019 refuses spend when nothing was released.
5. **The receipt rule is deliberately narrow.** It fires only when the trip *erases the
   debt* (spent ≥ released) **and** goods were actually bought. A trip that hands change
   back is self-evidencing — the returned cash is the proof — so burdening it would add
   friction to the common case for no control gain, and a failed camera/upload could
   dead-end a purchaser mid-trip. Shipping-fee-only trips are exempt because there is no
   line to attach a receipt to. *Tightening this to "every trip needs a receipt" is a
   one-line owner decision:* the `erasesDebt &&` term in `purchaserCompleteTrip`.
6. **No CHECK constraint for B7.** `spare_change_returned <= spare_change_required` looks
   like the obvious DB mirror, but a `NOT VALID` CHECK is evaluated on **every** UPDATE of
   the row — so each legacy violating row would become frozen against all future writes
   (including closing it). Instead `0019_verify.sql` **check 6** inventories them; if the
   count is 0 a later migration can add the constraint safely.
7. **The receipt rule is not mirrored in the DB.** Receipts are `attachments` rows keyed by
   line item and written *after* the spend figure, so a `BEFORE UPDATE` guard could not see
   them without a storage-coupled query. App-only, and documented as such in 0019's header.
8. **Validation moved ahead of the writes.** The trip is now clamped and totalled in a
   pre-pass, so an over-ceiling, unevidenced or over-quantity trip is refused *before*
   anything is written to `mrs_line_items` / `attachments` / `item_price_catalog`. That
   also shrinks **C2**'s partial-write surface (the quantity ceiling used to throw from
   inside the loop, after earlier lines were already committed) without changing C2's
   remaining scope, which is Phase 4.

**Behaviour changes an operator will notice** (all intentional):

1. Form 13 shows **Cash Released** (or **Fast-Track Cap**) next to Allocated Budget, and
   the two are different numbers with different meanings — the budget is what was approved,
   the ceiling is what may be spent without an explanation.
2. A trip over the ceiling cannot be submitted until a **reason** is typed; the reason is
   stored on the requisition and appears in the audit trail (and in the success toast).
3. A trip that leaves **no spare change to return** cannot be submitted without at least
   one **vendor receipt** attached to a purchased line.
4. Form 10's MRS pickers grey out requisitions with **no approved budget** ("no approved
   budget, Form 8 first") instead of letting the Budget Officer discover it on submit.
5. Accounting can no longer record **more spare change returned than was owed** on a
   requisition owing ₱0.00; the message tells them to re-check the amount or have the
   actuals corrected. Pre-0013 deployments (`gateUnavailable`) keep the old permissive
   behaviour, because there `required` is a fabricated default rather than a real balance.

**Verification (all re-run after the final edit)**

- `npx tsc --noEmit` ✅ clean · `npm run lint` ✅ 0 errors + the 1 known pre-existing
  warning (`mrs/page.tsx` unused `refreshing`) · `npm run build` ✅ **30/30 routes** via the
  §11.3 offline font shim, `src/app/layout.tsx` restored byte-identical.
- **Harness `supabase/tests/` ✅ 21/21** — POSITIVE 12/12 (actuals within and exactly at the
  ceiling; over-spend *with* a reason; fast-track up to its cap; SQL-Editor wave-through;
  legacy over-ceiling rows still updatable; 0016 Accounting return; 0018 stamp + column/FK;
  0017 Rule 3 cascade as MANAGER, STAFF and SUPER_ADMIN each minting one ₱1,000.00
  `SPARE_CHANGE_RETURN` mirrored to the original sender) · NEGATIVE 8/8 (inflated spend,
  blank reason, spend with nothing released, fast-track over cap, requester and outsider
  zeroing the Gate B debt, outsider self-stamping Gate C, receiver inflating the ledger
  amount) · RESIDUAL 1/1 (§13.2 A1c at the DB layer).
- **All four verify scripts executed and PASS**: `0016` 1–7 (+8–9 INFO) · `0017` 1–5 (+6 INFO) ·
  `0018` 1–2 (+3–4 INFO) · **`0019` 1–4 (+5–6 INFO)**. Check 4 proves 0019 disturbed none of
  0016's four field guards, the six pre-0016 gate triggers, or 0017's DEFINER cascade.
- Harness relocation: `/tmp/pgtest` (Phase 1/2) did not survive the session — `/tmp` is not
  persisted — so it was rebuilt inside the repo where it is durable and re-runnable by the
  owner. The §10.9 constraint still holds: `embedded-postgres` lives in
  `supabase/tests/package.json`, never the app's.

**Owner action required**

1. Apply `0019_spend_ceiling_and_overspend_reason.sql` in the Supabase SQL Editor
   **after 0018** (idempotent; requires 0011's `get_setting_numeric` and 0013's
   `mrs_disbursed_total`).
2. Run `0019_verify.sql` — checks **1–4 must be PASS**. Then read the two inventories:
   **check 5** lists requisitions whose recorded spend already exceeds the cash released
   with no justification (each one produced a ₱0.00 spare-change debt at Form 14 — treat
   like §12.2's ₱936.00: recover or write off with approval); **check 6** lists rows where
   more spare change was recorded as returned than was owed (B7 damage — it understates
   Form 17's net disbursed).
3. Nothing is frozen by 0019: the guard fires only when `total_actual_spent` is written, so
   pre-existing over-ceiling rows stay fully updatable until someone next touches the spend.

**Still open (Phases 5–6 of §13.4):** Rule 3 completion for the FD float (B4) → error
surfacing (B9, which is what makes every message added in Phases 2–4 readable in
production instead of a digest) → **A5**, the row-policy/role mismatch found in
Phase 4 (§13.8), which needs the owner's decision on migration 0020.

### 13.8 Phase 4 shipped — durability & diagnostics (2026-09-20)

**Findings closed:** **B1** (multi-transmittal close dead-end), **B2** (four unchecked
writes), **B5** (unrecoverable disburse→advance pair), **C2** (raw `throw itemErr`).
All four are **app-layer only — this phase adds no migration.**

**New finding:** **A5 (CRITICAL)** — the MRS/transmittal row policies omit roles the app
routes to them, so Forms 6, 12 and 14 are unusable by their designated actors. Found
while fixing B2 (the fourth unchecked write turns out to be unreachable by its own role).
Migration **0020** is drafted below with three options; **it widens who can read
requisition data, so it is the owner's decision and has NOT been applied.**

#### Files changed

| File | Change |
|---|---|
| `src/lib/actions/transmittal-actions.ts` | **B1** resume-settle in `verifyCashAndMarkReceivedImpl` · **B5** resume detection in `disburseCashAndMarkSent` · **B2** row-count check on Form 12's delivery write · `MRSStatus` added to the existing type import |
| `src/lib/actions/mrs-actions.ts` | **B2** row-count + error checks at Form 7 (`managerReviewMRS`), Form 8/Owner (`recordOwnerDecision`) and Form 9 post-audit (`postAuditFastTrack`) |
| `src/lib/actions/purchaser-actions.ts` | **C2** the line-item loop now throws a real `Error` naming the line and the partial state (`linesWritten` counter) |
| `supabase/tests/migration-harness.mjs` | 10 new cases (**P17–P20**, **N9–N10**, **GAP G1–G8**), a new `GAP` report kind, `seedMRS({ online })` for Form 12 fixtures |
| `agent_handoff.md` | §13.2 A5 row + Phase 4 markers on B1/B2/B5/C2 · §13.4 items 4 and 7 · this section |

#### Design decisions

1. **B1 — an already-CLOSED requisition is a *resume*, not an error.** The refusal was
   purely app-layer: `guard_transmittal_receipt()` (0014) reads Gate C
   (`requester_verification`) and Gate B (`required − returned`) and **never** reads
   `overall_status`, so the database permitted the receipt all along (harness **P17**).
   The relaxation is exactly one status wide — `CLOSED` — and every other non-FULFILLED
   status still refuses, now naming **both** Forms 13 and 14 instead of pointing only at
   Form 14 (which the operator had already completed: the original error text was the
   misdirection B1 reported).
2. **B1 — Gate C is not weakened by the relaxation.** Harness **N10** proves a CLOSED
   requisition whose delivery was never signed off still refuses the receipt at the DB,
   and the app's own `isDeliveryVerified()` check runs *before* this block, unchanged.
   **N9** proves the resume cannot reduce already-recorded returns (0016 Rule 3).
3. **B1 — `overall_status` is omitted from the resume payload.** Every guard version
   (0011, 0012, 0013) early-returns when the status is unchanged, so re-sending `CLOSED`
   would be *tolerated*; leaving it out keeps the resume independent of that detail and
   keeps the audit note honest (`MRS already CLOSED by an earlier receipt.` rather than
   claiming a transition that did not happen).
4. **B1 — both spare-change figures are written as running totals.** `spare_change_returned`
   already was; `spare_change_amount` was being **overwritten with this receipt's slice**,
   so a resume carrying ₱0.00 spare change wiped the earlier ₱500.00 out of the column
   Form 17 sums (`reports/expense/page.tsx:175`). Both now carry the cumulative figure
   (harness **P18** asserts ₱500.00 is preserved and the status stays CLOSED). 0016 Rule 2
   permits ACCOUNTING to write the amount and Rule 3 permits the returned figure to grow.
5. **B2 — verification uses `count: 'exact'`, not a follow-up SELECT.** An RLS-refused
   UPDATE arrives as a *successful* response that touched 0 rows, so checking `error`
   alone was not enough — but the obvious alternative (`.select('id')` after the write)
   is unusable here: harness **G8** proves that for exactly the roles these writes
   concern, the SELECT policy hides the row, so a select-based check would report a
   **false failure** on a write that succeeded. PostgREST's affected-row count needs no
   read visibility. All four sites now refuse on `error` **or** a 0-row write, and do so
   **before** `logMRSActivity`/`logTransmittalActivity` runs — the false audit trail was
   the finding.
6. **B2 — Form 12's message names the transmittal it did create.** That write happens
   *after* the COD transmittal INSERT, so a blind retry would mint a second `TR-…`
   number for the same cash. The error states the advance exists and must not be
   re-entered.
7. **B5 — resume, not reorder.** The SENT-then-advance order is load-bearing (§10.6, and
   0016 Rule 6 makes ACCOUNTING the only writer of `sender_status='SENT'`), so the fix
   recognises the half-done state instead of changing the sequence: `sender_status='SENT'`
   **and** a linked requisition still at `TRANSMITTAL_IN_PROGRESS` → skip the SENT write
   and complete the advance. `sent_at` is deliberately **not** rewritten on a resume —
   Rule 3's chain of custody must keep the moment the cash actually left. Any other
   non-PENDING status still refuses, with a clearer message for the SENT case.
8. **C2 — the message states why a retry is safe.** Every value the loop writes
   (`qty_fulfilled`, `actual_unit_price`, `item_delivery_status`, `vendor_rating`,
   `is_overpriced`, `purchased_at`) is **absolute, not incremental**, so re-saving the
   trip after a mid-loop failure cannot double-count; the error says so and reports how
   many of the trip's lines already landed. The receipt `attachments` insert and the
   `item_price_catalog` upsert remain best-effort by design — an attachment or catalogue
   hiccup must not abort a recorded trip — and are unchanged.
9. **Harness — `GAP` is a separate kind that does not gate the run.** A red harness must
   always mean "a migration regressed", never "a known defect is still known", so A5's
   eight cases report as ⚠️ *reproduced* under their own heading and are excluded from
   the pass count. **Once 0020 (or an equivalent) is applied, delete G1–G8 or flip them
   into POSITIVE cases asserting the new visibility** — they are written to fail loudly
   if the gap quietly closes.

#### A5 — evidence

Mechanism: 0005 dropped 0002's `"Staff read own dept MRS"` to break the RLS recursion and
replaced both MRS policies with role lists that omit STOREKEEPER (SELECT), FRONT_DESK and
MAINTENANCE (both), and never restored an own-department branch — even after 0016 added
the recursion-free `get_my_department_id()` (SECURITY DEFINER, pinned `search_path`, so it
*is* safe inside a policy). Because RLS applies the SELECT policy to the rows an UPDATE
reads, the missing SELECT branch also blocks writes for those roles — which is why
`mrs_update_safe` naming STOREKEEPER changes nothing (G8).

| Harness | Role | Form | Reproduced symptom |
|---|---|---|---|
| G1 | STOREKEEPER | 6 stock-check | 0 rows visible → queue empty, actions die on "MRS not found." |
| G2 | FRONT_DESK | 12 COD | 0 rows visible → the COD candidate list is empty |
| G3 | FRONT_DESK | 12 COD | the COD transmittal INSERT raises *"references a requisition that does not exist"* while postgres sees the row (`is_online_purchase=true`, `PURCHASING`) — `transmittal_insert_safe` omits FRONT_DESK and 0015's insert trigger is **not** SECURITY DEFINER, so it reads the MRS blind |
| G4 | FRONT_DESK | 12 COD | `delivery_status`/`revolving_fund_used` write → 0 rows; **0016 Rule 9 names FRONT_DESK the only legitimate writer** and never fires |
| G5 | MAINTENANCE | 14 delivery | 0 rows visible for a requisition in **its own department** |
| G6 | MAINTENANCE | 14 delivery | `requester_verification` write → 0 rows; **0016 Rule 5 grants sign-off to the requesting department** and never fires |
| G7 | same-dept colleague (STAFF, not the requester) | 14 delivery | sign-off write → 0 rows — the advice in **0016 Rule 5's own error text** ("ask a colleague from that department, or a Super Admin"), repeated by Phase 2's A1c messages, is unactionable |
| G8 | STOREKEEPER | 6 | named in `mrs_update_safe`, `get_my_role()` resolves correctly, write still hits 0 rows → SELECT visibility gates writes |
| P19/P20 | ACCOUNTING / PURCHASER | — | controls: the same COD insert and the same read succeed for roles the policies admit, so the blindness above is role-specific and not a fixture artefact |

Two internal contradictions make this a defect rather than an intentional restriction:
**0016 Rule 9** was written to allow FRONT_DESK (and only FRONT_DESK) to write the float
flags, and **0016 Rule 5** tells the refused user to ask a department colleague — neither
is reachable through the row policies that 0005 left in place.

Phase 4 changes A5's *visibility*, not its existence: the Form 12 delivery write now
reports the failure honestly instead of logging a success that never happened (B2), but
the action still dies earlier at "MRS not found." — so **Form 12 needs 0020 to work at
all**, and Forms 6 and 14 need it for their designated roles.

#### A5 — three ways to close it (owner decision)

**Option A — align the policies with the app (recommended).** Restores own-department read
(0002's original intent, recursion-free via 0016's helper), adds the two cross-department
service roles (a warehouse and a front desk serve every department — Forms 6 and 12 list
all requisitions by design), and lets FRONT_DESK mint the COD leg. Form 14's
same-department authority then works for MAINTENANCE and for colleagues, which is what
0016 Rule 5 and the Phase 2 messages already promise.

```sql
-- 0020_align_mrs_row_policies.sql  (DRAFT — run AFTER 0019; needs 0016's get_my_department_id())
DROP POLICY IF EXISTS "mrs_select_safe" ON material_requisitions;
CREATE POLICY "mrs_select_safe" ON material_requisitions
FOR SELECT TO authenticated USING (
  requester_id = auth.uid()
  OR department_id = get_my_department_id()                      -- own department (0002's intent, no recursion)
  OR get_my_role() IN ('SUPER_ADMIN','MANAGER','BUDGET_OFFICER','ACCOUNTING','PURCHASER',
                       'STOREKEEPER','FRONT_DESK')               -- serve every department (Forms 6, 12)
);

DROP POLICY IF EXISTS "mrs_update_safe" ON material_requisitions;
CREATE POLICY "mrs_update_safe" ON material_requisitions
FOR UPDATE TO authenticated USING (
  requester_id = auth.uid()
  OR department_id = get_my_department_id()                      -- Form 9 / Form 14 department authority
  OR get_my_role() IN ('SUPER_ADMIN','MANAGER','STOREKEEPER','BUDGET_OFFICER','ACCOUNTING',
                       'PURCHASER','FRONT_DESK')                 -- 0016 Rule 9's writer
);

DROP POLICY IF EXISTS "transmittal_insert_safe" ON transmittal_forms;
CREATE POLICY "transmittal_insert_safe" ON transmittal_forms
FOR INSERT TO authenticated WITH CHECK (
  sender_user_id = auth.uid()
  OR get_my_role() IN ('SUPER_ADMIN','ACCOUNTING','BUDGET_OFFICER','FRONT_DESK')  -- Form 12 COD leg
);
```

*Residual this introduces:* the department branch makes **any** same-department user able
to reach the requisition columns 0016 does not protect (`purpose`, `est_shipping_fee`,
`is_online_purchase`, `online_supplier_url`, `online_tracking_number`, `verification_notes`
is protected, `notes`, …). 0016 Rules 1–9 cover the cash/gate columns only. Optional
mitigation: a small `guard_mrs_request_fields()` restricting the request's own descriptive
fields to the requester + SUPER_ADMIN (~30 lines, same pattern as 0016's other guards) —
say the word and it ships with 0020.

**Option B — roles only, no department branch.** Add `STOREKEEPER`, `FRONT_DESK` and
`MAINTENANCE` to both MRS policies and `FRONT_DESK` to `transmittal_insert_safe`. Smaller
diff, but it grants those three roles **global** read (every department's requisitions),
and a same-department colleague who is not the requester **still cannot sign off Form 14**
— so G7 stays open and the "ask a colleague" advice stays unactionable.

**Option C — narrow the app to match the database.** Keep the policies as they are and
remove the roles that cannot use the forms: drop STOREKEEPER from `/mrs/stock-check`,
FRONT_DESK and MAINTENANCE from `/delivery` and `/transmittals/front-desk` in
`ROUTE_ACCESS_RULES`, restrict `fdCodDisbursement` to SUPER_ADMIN, and rewrite 0016
Rule 5's advice (and the Phase 2 A1c messages) to "ask a Super Admin". No data is exposed,
but Forms 6, 12 and 14 then depend on a Super Admin being available — and 0016 Rule 9
still names a role that cannot write.

#### Verification (all gates green)

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean (0 errors) |
| `eslint` on the three changed action files | clean (0 errors, 0 warnings) |
| `npm run build` | 30/30 routes generated (offline font shim applied, then `layout.tsx` restored — `git status` clean) |
| `cd supabase/tests && npm test` | **27/27 gated cases** · POSITIVE **16/16** · NEGATIVE **10/10** · RESIDUAL **1/1** · GAP **8/8 reproduced** (not gated) · `0016_verify` + `0017_verify` + `0018_verify` + `0019_verify` all **PASS** |

New cases: **P17** second receipt on a CLOSED MRS is permitted · **P18** resume settle
keeps the running spare-change total · **P19**/**P20** controls for the GAP block ·
**N9** returns cannot be reduced on a resume · **N10** Gate C still blocks an unverified
CLOSED MRS · **G1–G8** the A5 evidence table above.

#### Operator-visible changes

- Accounting can now close out **every** transmittal on a multi-payment requisition; the
  second and later receipts record their spare change against an already-CLOSED
  requisition instead of refusing with "Delivery must be verified…".
- Form 17's **Spare Change** column no longer loses earlier receipts when a later one is
  verified.
- A disbursement interrupted between "mark SENT" and "advance the requisition" can simply
  be run again — it completes the advance instead of reporting "already processed".
- Forms 7, 8/Owner and 9 post-audit, and Form 12's delivery stamp, now **fail with a
  reason** instead of reporting success and writing an audit entry for a change that never
  landed.
- A Form 13 trip that fails part-way through its line items says which line failed, how
  many were already saved, and that re-saving is safe.

#### Owner actions

1. **Decide A5** — Option A / B / C above. Nothing in Phase 4 requires a migration, so
   0016→0019 remain the only pending SQL; 0020 is drafted and waiting on this decision.
2. No new SQL is required for Phase 4 itself. If 0020 is approved it must run **after
   0019** (it calls 0016's `get_my_department_id()`), and G1–G8 should then be deleted or
   flipped to POSITIVE cases.
3. Phases 5–6 remain: **B4** (the FD float's missing acknowledgement leg — note 0016
   Rule 7 already records that FRONT_DESK must be added there when it ships) and **B9**
   (structured results for client-called actions, which is what makes every message added
   in Phases 2–4 readable in production instead of a React digest).
