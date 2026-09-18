-- ============================================================================
-- 0014 verification — READ ONLY. Safe to re-run.
-- Single UNION ALL: the Supabase SQL Editor only renders the LAST result set.
-- Expect status = 'OK' on every row except the informational last one.
-- ============================================================================

-- 1. Gate C trigger exists on material_requisitions
SELECT
  '1. trg_guard_mrs_delivery_signoff' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN 'OK' ELSE 'MISSING — run 0014' END AS status,
  COUNT(*)::text AS detail
FROM pg_trigger
WHERE tgname = 'trg_guard_mrs_delivery_signoff'
  AND NOT tgisinternal

UNION ALL

-- 2. Gate C is actually inside the requisition guard body
SELECT
  '2. guard_mrs_delivery_signoff body',
  CASE WHEN prosrc LIKE '%0014 Gate C%' THEN 'OK' ELSE 'STALE — re-run 0014' END,
  'len=' || length(prosrc)::text
FROM pg_proc
WHERE proname = 'guard_mrs_delivery_signoff'

UNION ALL

-- 3. The receipt guard carries BOTH Gate C (0014) and Gate B (0013).
--    Catches 0013 being re-applied after 0014 and clobbering Gate C.
SELECT
  '3. guard_transmittal_receipt gates',
  CASE
    WHEN prosrc LIKE '%0014 Gate C%' AND prosrc LIKE '%0013 Gate B%' THEN 'OK'
    WHEN prosrc LIKE '%0013 Gate B%' THEN 'GATE C LOST — re-run 0014 (0013 was re-applied after it)'
    ELSE 'UNEXPECTED — inspect manually'
  END,
  'C=' || (prosrc LIKE '%0014 Gate C%')::text || ' B=' || (prosrc LIKE '%0013 Gate B%')::text
FROM pg_proc
WHERE proname = 'guard_transmittal_receipt'

UNION ALL

-- 4. Requisitions CLOSED without a requester sign-off.
--    These are the rows the old bug already let through: spare change, if any,
--    was never computed or collected. Non-zero here is historical damage, not
--    a migration failure — review each one.
SELECT
  '4. closed without sign-off (legacy damage)',
  CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'REVIEW — ' || COUNT(*)::text || ' affected' END,
  COALESCE(string_agg(mrs_number, ', ' ORDER BY mrs_number), 'none')
FROM material_requisitions
WHERE overall_status = 'CLOSED'
  AND COALESCE(requester_verification, 'PENDING_DELIVERY') <> 'VERIFIED'

UNION ALL

-- 5. Informational: rows the new gate will now hold back.
SELECT
  '5. held by Gate C (informational)',
  'INFO',
  COALESCE(string_agg(
    mrs_number || ' [' || overall_status || '/' ||
    COALESCE(requester_verification, 'PENDING_DELIVERY') || ']', ', '
    ORDER BY mrs_number), 'none')
FROM material_requisitions
WHERE overall_status IN ('FULFILLED', 'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED', 'IN_TRANSIT')
  AND COALESCE(requester_verification, 'PENDING_DELIVERY') <> 'VERIFIED';
