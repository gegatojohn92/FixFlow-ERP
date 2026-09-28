-- ============================================================================
-- 0019_verify.sql — READ-ONLY verification that 0019 applied cleanly and that
--                   nothing from 0011-0018 was disturbed.
--
-- Paste into the Supabase SQL Editor and run. Checks 1-4 must all say PASS;
-- checks 5-6 are INFORMATIONAL inventories of damage this migration cannot
-- retroactively repair. One statement (UNION ALL) so every check shows at once.
--
-- Requires 0013 (`mrs_disbursed_total`) — checks 5 and 6 call it.
-- ============================================================================

-- 1. The justification column exists and is nullable (NULL = within ceiling).
SELECT
  '1. overspend_reason column present' AS check_name,
  CASE WHEN data_type = 'text' AND is_nullable = 'YES' THEN 'PASS'
       WHEN data_type IS DISTINCT FROM 'text' THEN 'FAIL — wrong type: ' || data_type
       ELSE 'FAIL — should be nullable' END AS status,
  'type=' || data_type || ', nullable=' || is_nullable AS detail
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'material_requisitions'
  AND column_name = 'overspend_reason'

UNION ALL

-- 2. The guard exists, runs as its owner (so `mrs_disbursed_total` reads the true
--    ledger — the §13.5 A4 lesson), has a pinned search_path, and carries BOTH
--    ceiling branches. A body missing either branch means a partial edit.
SELECT
  '2. guard_mrs_spend_ceiling() correct',
  CASE WHEN count(*) = 1
        AND bool_and(p.prosecdef)
        AND bool_and(COALESCE((SELECT setting FROM unnest(p.proconfig) AS setting
                               WHERE setting LIKE 'search_path=%'), 'no') <> 'no')
        AND bool_and(p.prosrc LIKE '%mrs_disbursed_total%')
        AND bool_and(p.prosrc LIKE '%fast_track_cap_amount%')
        AND bool_and(p.prosrc LIKE '%overspend_reason%')
       THEN 'PASS'
       ELSE 'FAIL — definer/search_path/branch check: ' ||
            'definer=' || COALESCE(bool_and(p.prosecdef)::text, 'n/a') ||
            ' disbursed-branch=' || COALESCE(bool_and(p.prosrc LIKE '%mrs_disbursed_total%')::text, 'n/a') ||
            ' fasttrack-branch=' || COALESCE(bool_and(p.prosrc LIKE '%fast_track_cap_amount%')::text, 'n/a')
  END,
  'copies=' || count(*)::text || ' · len=' || COALESCE(max(length(p.prosrc))::text, '0')
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'guard_mrs_spend_ceiling'

UNION ALL

-- 3. The trigger is live on material_requisitions.
SELECT
  '3. trigger live',
  CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL — ' || count(*)::text || ' copies (expected 1)' END,
  COALESCE(max(tgname), 'trg_guard_mrs_spend_ceiling missing')
FROM pg_trigger
WHERE tgrelid = 'material_requisitions'::regclass
  AND tgname = 'trg_guard_mrs_spend_ceiling'
  AND NOT tgisinternal

UNION ALL

-- 4. Nothing from 0011-0018 was disturbed: 0016's four field guards, the six
--    pre-0016 gate triggers, and 0017's SECURITY DEFINER cascade must all still
--    be present. (0019 creates one new function and one new trigger; it
--    redefines nothing.)
SELECT
  '4. prior gates intact',
  CASE WHEN (SELECT COUNT(*) FROM pg_proc WHERE proname IN (
               'guard_mrs_financial_fields','guard_transmittal_fields',
               'guard_line_item_fields','guard_line_item_delete')) = 4
        AND (SELECT COUNT(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
               'trg_guard_mrs_status_transition','trg_guard_mrs_delivery_signoff',
               'trg_guard_transmittal_receipt','trg_guard_cash_transmittal_insert',
               'trg_guard_cash_transmittal_sent','trg_guard_fd_cod_disbursement')) = 6
        AND (SELECT prosecdef FROM pg_proc WHERE proname = 'cascade_jo_cancellation' LIMIT 1)
       THEN 'PASS'
       ELSE 'FAIL — 0016 guards=' ||
            (SELECT COUNT(*)::text FROM pg_proc WHERE proname IN (
               'guard_mrs_financial_fields','guard_transmittal_fields',
               'guard_line_item_fields','guard_line_item_delete')) ||
            '/4 · pre-0016 triggers=' ||
            (SELECT COUNT(*)::text FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
               'trg_guard_mrs_status_transition','trg_guard_mrs_delivery_signoff',
               'trg_guard_transmittal_receipt','trg_guard_cash_transmittal_insert',
               'trg_guard_cash_transmittal_sent','trg_guard_fd_cod_disbursement')) ||
            '/6 · cascade-definer=' ||
            COALESCE((SELECT prosecdef::text FROM pg_proc
                       WHERE proname = 'cascade_jo_cancellation' LIMIT 1), 'missing')
  END,
  'Gate B/C, 0015 cash gates, 0016 field guards and the 0017 cascade all still live'

UNION ALL

-- 5. INFORMATIONAL — A3 damage inventory. Requisitions whose recorded spend
--    already exceeds the cash released for them, with no justification on file.
--    The guard is preventive, not retroactive: these rows are unaffected until
--    someone next writes `total_actual_spent`. Every one of them produced a
--    spare-change debt of ₱0.00 at Form 14 — treat like §12.2's ₱936.00:
--    recover or write off with approval.
SELECT
  '5. spend over cash released (INFO)',
  'INFO',
  (SELECT COUNT(*)::text FROM material_requisitions m
    WHERE NOT COALESCE(m.is_emergency_fast_track, FALSE)
      AND COALESCE(m.total_actual_spent, 0) > mrs_disbursed_total(m.id) + 0.01
      AND COALESCE(btrim(m.overspend_reason), '') = '') || ' requisitions · ₱' ||
  COALESCE((SELECT SUM(m.total_actual_spent - mrs_disbursed_total(m.id))::text
              FROM material_requisitions m
             WHERE NOT COALESCE(m.is_emergency_fast_track, FALSE)
               AND COALESCE(m.total_actual_spent, 0) > mrs_disbursed_total(m.id) + 0.01
               AND COALESCE(btrim(m.overspend_reason), '') = ''), '0') ||
  ' unexplained excess (excludes Emergency Fast-Track, which is capped separately)'

UNION ALL

-- 6. INFORMATIONAL — B7 damage inventory. Rows where more spare change was
--    recorded as returned than was ever owed. The app now refuses new ones
--    (`verifyCashAndMarkReceived`); no CHECK constraint was added, because a
--    NOT VALID constraint would freeze every legacy violating row against ALL
--    future updates. If this count is 0, a later migration can add the
--    constraint safely — see §13.7.
SELECT
  '6. over-recorded spare change (INFO)',
  'INFO',
  (SELECT COUNT(*)::text FROM material_requisitions
    WHERE COALESCE(spare_change_returned, 0) > COALESCE(spare_change_required, 0) + 0.01) ||
  ' requisitions · ₱' ||
  COALESCE((SELECT SUM(spare_change_returned - spare_change_required)::text
              FROM material_requisitions
             WHERE COALESCE(spare_change_returned, 0) > COALESCE(spare_change_required, 0) + 0.01), '0') ||
  ' overstated as returned (understates Form 17 net disbursed)'

ORDER BY 1;
