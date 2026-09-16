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
- **Form 2 (`/jo/track`):** Public/Internal tracker by reference number or department filter. Triggers `cascade_jo_cancellation` upon cancellation.
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
- **Form 13 (`/purchaser/queue`):** Purchaser queue. Shows requester name in list cards and execution panel header. Manages vendor quotes, PO generation, receipt attachments, and status transition to `IN_TRANSIT`.
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
ernal URL viewing.
- **PWA & Assets:** 7 sharp-generated PWA PNG icons in `public/icons/`. Web manifest and apple-touch-icon registered. Console is 100% clean of missing resource warnings.
- **Build Status:** Passes `next build --webpack` with zero TypeScript or packaging errors (29 static and dynamic routes compiled).
- **Git Branch:** `main` tracking `origin/main`.
