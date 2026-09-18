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
| **0011** | `0011_jo_mrs_flow_enhancements.sql` | **JO/MRS flow hardening:** `job_orders` cancellation/closure audit columns; JO guard fixes dead-end states (`MATERIALS_RECEIVED → COMPLETED`, `COMPLETED → CLOSED`, `IN_PROGRESS → MATERIALS_RECEIVED`); MRS guard wires `IN_TRANSIT` and `EMERGENCY_FAST_TRACK → PURCHASING`; cascade cancellation now auto-generates `SPARE_CHANGE_RETURN` transmittals for disbursed cash and stamps `cancelled_at/by`; new `system_settings` table + `get_setting_numeric()` (fast-track cap, deficit thresholds, batch limit as data); performance indexes on all queue-filter columns. **Apply in Supabase SQL Editor after 0010.** |

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
- Migration 0011 must be applied in the Supabase SQL Editor (idempotent: `IF NOT EXISTS` /
  `CREATE OR REPLACE` throughout) before deploying the app changes; app code degrades
  gracefully to defaults if `system_settings` is not yet present.
