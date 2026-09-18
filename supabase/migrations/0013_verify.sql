-- ============================================================================
-- 0013_verify.sql — READ-ONLY verification that 0013 applied cleanly.
--
-- Paste into the Supabase SQL Editor and run. Every row must say PASS.
-- This script writes nothing; it is safe to run at any time.
-- ============================================================================

-- 1. Columns added by 0013 ---------------------------------------------------
SELECT
  '1. columns' AS check_name,
  CASE WHEN COUNT(*) = 12 THEN 'PASS' ELSE 'FAIL — expected 12, found ' || COUNT(*) END AS result,
  string_agg(table_name || '.' || column_name, ', ' ORDER BY table_name, column_name) AS found
FROM information_schema.columns
WHERE (table_name = 'material_requisitions' AND column_name IN (
         'availability_hold','availability_notes','availability_reported_at',
         'availability_reported_by','requester_decision','requester_decision_notes',
         'requester_decision_at','requester_decision_by',
         'spare_change_required','spare_change_returned'))
   OR (table_name = 'mrs_line_items' AND column_name IN ('qty_available','availability_note'));

-- 2. Both guard triggers live ------------------------------------------------
SELECT
  '2. triggers' AS check_name,
  CASE WHEN COUNT(*) = 2 THEN 'PASS' ELSE 'FAIL — expected 2, found ' || COUNT(*) END AS result,
  string_agg(tgname, ', ') AS found
FROM pg_trigger
WHERE tgname IN ('trg_guard_mrs_status_transition', 'trg_guard_transmittal_receipt')
  AND NOT tgisinternal;

-- 3. Helper function + the two new gates are inside the MRS guard ------------
SELECT
  '3. functions' AS check_name,
  CASE
    WHEN COUNT(*) FILTER (WHERE proname = 'mrs_disbursed_total') = 1
     AND COUNT(*) FILTER (WHERE proname = 'guard_transmittal_receipt') = 1
     AND COUNT(*) FILTER (WHERE proname = 'guard_mrs_status_transition'
                            AND prosrc LIKE '%0013 Gate A%'
                            AND prosrc LIKE '%0013 Gate B%') = 1
    THEN 'PASS'
    ELSE 'FAIL — guard_mrs_status_transition may still be the 0012 version (re-run 0013 AFTER 0012)'
  END AS result,
  string_agg(proname, ', ') AS found
FROM pg_proc
WHERE proname IN ('mrs_disbursed_total','guard_transmittal_receipt','guard_mrs_status_transition');

-- 4. The requester_decision CHECK constraint ---------------------------------
SELECT
  '4. constraint' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL — CHECK constraint missing' END AS result
FROM pg_constraint
WHERE conname = 'material_requisitions_requester_decision_check';

-- 5. Existing rows back-filled with safe defaults (no phantom debts/holds) ---
SELECT
  '5. data sanity' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'PASS'
       ELSE 'FAIL — ' || COUNT(*) || ' row(s) have NULL/odd defaults' END AS result
FROM material_requisitions
WHERE availability_hold IS NULL
   OR requester_decision IS NULL
   OR spare_change_required IS NULL
   OR spare_change_returned IS NULL;

-- 6. Anything already mid-flight that the new gates would now block ----------
--    (informational — empty result is normal on a healthy project)
SELECT
  '6. blocked in-flight' AS check_name,
  mrs_number,
  overall_status,
  availability_hold,
  requester_decision,
  spare_change_required,
  spare_change_returned,
  (spare_change_required - spare_change_returned) AS still_owed
FROM material_requisitions
WHERE (availability_hold = TRUE AND requester_decision = 'PENDING')
   OR (overall_status = 'FULFILLED' AND spare_change_required - spare_change_returned > 0.01)
ORDER BY mrs_number;
