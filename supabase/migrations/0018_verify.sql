-- ============================================================================
-- 0018_verify.sql — READ-ONLY verification that 0018 applied cleanly.
--
-- Paste into the Supabase SQL Editor and run. Checks 1-2 must say PASS;
-- checks 3-4 are INFORMATIONAL. One statement (UNION ALL) so every check shows
-- at once.
--
-- 0018 is data-only: it creates no function, trigger or policy, so it cannot
-- disturb the 0011-0017 gate guards. Nothing here needs re-running after a
-- later migration.
-- ============================================================================

-- 1. The stamp column exists and is nullable UUID (NULL = never purchased /
--    pre-0018 row with no audit entry).
SELECT
  '1. trip_completed_by column present' AS check_name,
  CASE WHEN data_type = 'uuid' AND is_nullable = 'YES' THEN 'PASS'
       WHEN data_type IS DISTINCT FROM 'uuid' THEN 'FAIL — wrong type: ' || data_type
       ELSE 'FAIL — should be nullable' END AS status,
  'type=' || data_type || ', nullable=' || is_nullable AS detail
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'material_requisitions'
  AND column_name = 'trip_completed_by'

UNION ALL

-- 2. A stamp must point at a real account (FK to users.id), or the comparison in
--    verifyDeliveryRequester() could be defeated by a fabricated id.
SELECT
  '2. FK to users(id) enforced',
  CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL — ' || count(*)::text || ' foreign keys found' END,
  COALESCE(max(conname), 'none')
FROM pg_constraint
WHERE contype = 'f'
  AND conrelid = 'material_requisitions'::regclass
  AND confrelid = 'users'::regclass
  AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                      WHERE attrelid = 'material_requisitions'::regclass
                        AND attname = 'trip_completed_by')]

UNION ALL

-- 3. INFORMATIONAL — backfill coverage. Requisitions that reached the sign-off
--    stage but carry no stamp are pre-0018 rows whose PURCHASER_TRIP_COMPLETED
--    audit entry is missing (or was never written). For those, the Form 14
--    self-approval block cannot fire — it fails open, as before 0018.
SELECT
  '3. backfill coverage (INFO)',
  'INFO',
  (SELECT count(*)::text FROM material_requisitions
    WHERE trip_completed_by IS NOT NULL) || ' stamped / ' ||
  (SELECT count(*)::text FROM material_requisitions
    WHERE trip_completed_by IS NULL
      AND overall_status IN ('FULFILLED','PARTIALLY_FULFILLED_BUDGET_EXHAUSTED','CLOSED'))
    || ' sign-off-stage rows still unstamped'

UNION ALL

-- 4. INFORMATIONAL — where the check actually lives. 0018 only supplies the
--    data; the refusal is in verifyDeliveryRequester() (src/lib/actions/
--    purchaser-actions.ts). A direct console PATCH of requester_verification is
--    still unguarded at the DB level — that mirror is a §13.2 deferred item.
SELECT
  '4. enforcement location (INFO)',
  'INFO',
  'app-layer only: verifyDeliveryRequester() refuses signer == trip_completed_by; no DB trigger yet'

ORDER BY 1;
