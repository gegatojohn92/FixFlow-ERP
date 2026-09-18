-- ============================================================================
-- FixFlow ERP — RESET ALL TEST / TRANSACTIONAL DATA
-- ----------------------------------------------------------------------------
-- Wipes every transactional row so you can test & debug from a clean slate.
--
--   KEEPS:   users, departments, system_settings  (identity + business config)
--   CLEARS:  job_orders, material_requisitions, mrs_line_items,
--            transmittal_forms, item_price_catalog, attachments,
--            pms_assets, pms_activity_logs, activity_logs, audit_events,
--            number_sequences (so TR/JO/MRS numbers restart at -0001),
--            and all objects in the 4 storage buckets.
--
-- HOW TO RUN:
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Paste this whole file (or each section in order) and RUN.
--   3. The final SELECT should show 0 rows for every table except
--      users / departments / system_settings.
--
-- ⚠️  DESTRUCTIVE & IRREVERSIBLE — runs against the live project. Triggers
--     (RLS user policies, 0012/0013/0014/0015 gates) are NOT touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION A — wipe the relational data
-- TRUNCATE ... CASCADE clears dependent rows; RESTART IDENTITY resets every
-- SERIAL id back to 1 so records start clean. `users`/`departments` are NOT in
-- the list and are never referenced as children of the truncated tables, so
-- they are untouched.
-- ----------------------------------------------------------------------------
BEGIN;

TRUNCATE TABLE
  pms_activity_logs,
  activity_logs,
  attachments,
  audit_events,
  transmittal_forms,
  mrs_line_items,
  material_requisitions,
  job_orders,
  item_price_catalog,
  pms_assets
RESTART IDENTITY CASCADE;

-- Reset the atomic reference-number counters (JO/MRS/TR/TR-BATCH).
-- next_reference_number() re-seeds a row automatically on the next insert,
-- starting back at -0001 for the current year.
TRUNCATE TABLE number_sequences RESTART IDENTITY;

COMMIT;

-- ----------------------------------------------------------------------------
-- SECTION B — clear the Supabase Storage buckets (attached photos/receipts).
-- Keeps the buckets themselves; only deletes the files inside them.
-- ----------------------------------------------------------------------------
DELETE FROM storage.objects
WHERE bucket_id IN ('site-photos', 'item-references', 'receipts-proofs', 'messenger-snapshots');

-- ----------------------------------------------------------------------------
-- SECTION C — verification (expect 0 for everything listed, >0 for kept).
-- ----------------------------------------------------------------------------
SELECT 'activity_logs'         AS table_name, COUNT(*) AS rows FROM activity_logs
UNION ALL SELECT 'attachments',          COUNT(*) FROM attachments
UNION ALL SELECT 'audit_events',         COUNT(*) FROM audit_events
UNION ALL SELECT 'transmittal_forms',    COUNT(*) FROM transmittal_forms
UNION ALL SELECT 'mrs_line_items',       COUNT(*) FROM mrs_line_items
UNION ALL SELECT 'material_requisitions',COUNT(*) FROM material_requisitions
UNION ALL SELECT 'job_orders',           COUNT(*) FROM job_orders
UNION ALL SELECT 'item_price_catalog',   COUNT(*) FROM item_price_catalog
UNION ALL SELECT 'pms_assets',           COUNT(*) FROM pms_assets
UNION ALL SELECT 'pms_activity_logs',    COUNT(*) FROM pms_activity_logs
UNION ALL SELECT 'number_sequences',     COUNT(*) FROM number_sequences
UNION ALL SELECT 'users (KEPT)',         COUNT(*) FROM users
UNION ALL SELECT 'departments (KEPT)',   COUNT(*) FROM departments
UNION ALL SELECT 'system_settings (KEPT)', COUNT(*) FROM system_settings;

-- ----------------------------------------------------------------------------
-- OPTIONAL (only if you also want a completely empty identity basis — NOT
-- recommended, users.department_id FK would break). Uncomment to also wipe
-- departments (re-seed them afterwards and re-map your users' departments):
-- ----------------------------------------------------------------------------
-- DELETE FROM departments;
-- ALTER SEQUENCE departments_id_seq RESTART WITH 1;
