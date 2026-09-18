-- ============================================================================
-- 0015_verify.sql — READ-ONLY verification that 0015 applied cleanly.
--
-- Paste into the Supabase SQL Editor and run. Checks 1-4 must all say PASS.
-- Check 5 is INFORMATIONAL: it lists transmittals the new gates would have
-- refused (legacy rows) — rows there mean the gates are working, not broken.
-- One statement (UNION ALL) so the SQL Editor shows every check at once.
-- ============================================================================

-- 1. All three cash-chain trigger functions exist.
SELECT
  '1. cash-chain functions' AS check_name,
  CASE WHEN COUNT(*) = 3 THEN 'PASS' ELSE 'FAIL — expected 3, found ' || COUNT(*) END AS status,
  COALESCE(string_agg(proname, ', ' ORDER BY proname), '(none)') AS detail
FROM pg_proc
WHERE proname IN ('guard_cash_transmittal_insert',
                  'guard_cash_transmittal_sent',
                  'guard_fd_cod_disbursement')

UNION ALL

-- 2. All three triggers are live.
SELECT
  '2. triggers live',
  CASE WHEN COUNT(*) = 3 THEN 'PASS' ELSE 'FAIL — expected 3, found ' || COUNT(*) END,
  COALESCE(string_agg(tgname, ', ' ORDER BY tgname), '(none)')
FROM pg_trigger
WHERE tgname IN ('trg_guard_cash_transmittal_insert',
                 'trg_guard_cash_transmittal_sent',
                 'trg_guard_fd_cod_disbursement')
  AND NOT tgisinternal

UNION ALL

-- 3. The insert guard carries the pre-purchase status window (not a stale copy).
SELECT
  '3. insert guard body',
  CASE WHEN prosrc LIKE '%APPROVED_READY_TO_ORDER%TRANSMITTAL_IN_PROGRESS%'
         OR prosrc LIKE '%APPROVED_READY_TO_ORDER%' THEN 'PASS' ELSE 'STALE — re-run 0015' END,
  'len=' || length(prosrc)::text
FROM pg_proc
WHERE proname = 'guard_cash_transmittal_insert'

UNION ALL

-- 4. The receipt guard from 0014 is still intact (0015 must not have clobbered
--    Gate C — it does not touch guard_transmittal_receipt).
SELECT
  '4. 0014 gates intact',
  CASE
    WHEN prosrc LIKE '%0014 Gate C%' AND prosrc LIKE '%0013 Gate B%' THEN 'PASS'
    WHEN prosrc LIKE '%0013 Gate B%' THEN 'GATE C LOST — re-run 0014'
    ELSE 'UNEXPECTED — inspect manually'
  END,
  'C=' || (prosrc LIKE '%0014 Gate C%')::text || ' B=' || (prosrc LIKE '%0013 Gate B%')::text
FROM pg_proc
WHERE proname = 'guard_transmittal_receipt'

UNION ALL

-- 5. Informational: transmittals already written against requisitions OUTSIDE
--    the pre-purchase window (legacy rows the new insert gate would refuse).
SELECT
  '5. legacy rows held by 0015 (informational)',
  'INFO',
  COALESCE(string_agg(
    tf.transmittal_number || ' → ' || mr.mrs_number || ' [' || mr.overall_status || ']',
    ', ' ORDER BY tf.transmittal_number), 'none')
FROM transmittal_forms tf
JOIN material_requisitions mr ON mr.id = tf.mrs_id
WHERE tf.transmittal_type NOT IN ('SPARE_CHANGE_RETURN',
                                  'FD_REVOLVING_DISBURSEMENT',
                                  'FD_REVOLVING_REPLENISHMENT')
  AND mr.overall_status NOT IN ('APPROVED_READY_TO_ORDER', 'TRANSMITTAL_IN_PROGRESS',
                                'READY_FOR_PURCHASE', 'PURCHASING');
