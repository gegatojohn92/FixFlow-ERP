-- ============================================================================
-- 0013_verify.sql — READ-ONLY verification that 0013 applied cleanly.
--
-- Paste into the Supabase SQL Editor and run. Checks 1-5 must all say PASS.
-- Check 6 is INFORMATIONAL: it lists requisitions the new gates are currently
-- holding — rows there mean the gates are working, not that anything is broken.
--
-- This is ONE statement (UNION ALL) so the SQL Editor shows every check at
-- once; running them as separate statements only displays the last result.
-- This script writes nothing; it is safe to run at any time.
-- ============================================================================

-- 1. Columns added by 0013
SELECT
  '1. columns' AS check_name,
  CASE WHEN COUNT(*) = 12 THEN 'PASS' ELSE 'FAIL — expected 12, found ' || COUNT(*) END AS result,
  string_agg(table_name || '.' || column_name, ', ' ORDER BY table_name, column_name) AS details
FROM information_schema.columns
WHERE (table_name = 'material_requisitions' AND column_name IN (
         'availability_hold','availability_notes','availability_reported_at',
         'availability_reported_by','requester_decision','requester_decision_notes',
         'requester_decision_at','requester_decision_by',
         'spare_change_required','spare_change_returned'))
   OR (table_name = 'mrs_line_items' AND column_name IN ('qty_available','availability_note'))

UNION ALL

-- 2. Both guard triggers live
SELECT
  '2. triggers',
  CASE WHEN COUNT(*) = 2 THEN 'PASS' ELSE 'FAIL — expected 2, found ' || COUNT(*) END,
  COALESCE(string_agg(tgname, ', '), '(none)')
FROM pg_trigger
WHERE tgname IN ('trg_guard_mrs_status_transition', 'trg_guard_transmittal_receipt')
  AND NOT tgisinternal

UNION ALL

-- 3. Helper function + proof the MRS guard is the 0013 version (not a stale 0012)
SELECT
  '3. functions',
  CASE
    WHEN COUNT(*) FILTER (WHERE proname = 'mrs_disbursed_total') = 1
     AND COUNT(*) FILTER (WHERE proname = 'guard_transmittal_receipt') = 1
     AND COUNT(*) FILTER (WHERE proname = 'guard_mrs_status_transition'
                            AND prosrc LIKE '%0013 Gate A%'
                            AND prosrc LIKE '%0013 Gate B%') = 1
    THEN 'PASS'
    ELSE 'FAIL — guard_mrs_status_transition may still be the 0012 version (re-run 0013 AFTER 0012)'
  END,
  COALESCE(string_agg(DISTINCT proname, ', '), '(none)')
FROM pg_proc
WHERE proname IN ('mrs_disbursed_total','guard_transmittal_receipt','guard_mrs_status_transition')

UNION ALL

-- 4. The requester_decision CHECK constraint
SELECT
  '4. constraint',
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL — CHECK constraint missing' END,
  COALESCE(string_agg(conname, ', '), '(none)')
FROM pg_constraint
WHERE conname = 'material_requisitions_requester_decision_check'

UNION ALL

-- 5. Existing rows back-filled with safe defaults (no phantom debts/holds)
SELECT
  '5. data sanity',
  CASE WHEN COUNT(*) = 0 THEN 'PASS'
       ELSE 'FAIL — ' || COUNT(*) || ' row(s) have NULL defaults' END,
  'rows with NULL 0013 defaults: ' || COUNT(*)
FROM material_requisitions
WHERE availability_hold IS NULL
   OR requester_decision IS NULL
   OR spare_change_required IS NULL
   OR spare_change_returned IS NULL

UNION ALL

-- 6. INFORMATIONAL — requisitions the gates are currently holding.
--    Rows here are expected and healthy: each is waiting on a real action.
SELECT
  '6. held by gates (info)',
  CASE WHEN COUNT(*) = 0 THEN 'none held' ELSE COUNT(*) || ' held — see details' END,
  COALESCE(string_agg(
    mrs_number || ': ' ||
    CASE
      WHEN availability_hold AND requester_decision = 'PENDING'
        THEN 'awaiting requester availability decision'
      ELSE 'owes spare change of ' ||
           to_char(spare_change_required - spare_change_returned, 'FM999999990.00')
    END, ' | ' ORDER BY mrs_number), '(none)')
FROM material_requisitions
WHERE (availability_hold = TRUE AND requester_decision = 'PENDING')
   OR (overall_status = 'FULFILLED' AND spare_change_required - spare_change_returned > 0.01)

ORDER BY 1;
