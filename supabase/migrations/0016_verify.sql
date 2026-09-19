-- ============================================================================
-- 0016_verify.sql — READ-ONLY verification that 0016 applied cleanly and that
--                   it did NOT disturb 0013 / 0014 / 0015.
--
-- Paste into the Supabase SQL Editor and run. Checks 1-7 must all say PASS.
-- Checks 8-9 are INFORMATIONAL (legacy-data inventory and the live trigger
-- stack). One statement (UNION ALL) so the editor shows every check at once.
--
-- NOTE: the SQL Editor runs as postgres, where auth.uid() IS NULL — the trusted
-- administrative path 0016 waves through. These checks therefore inspect the
-- guard BODIES and the catalog rather than attempting writes: a negative test
-- run from the editor would pass for the wrong reason. To prove the gates bite,
-- use the browser-console reproductions in agent_handoff.md §13.3 as a signed-in
-- non-privileged user (expect a permission exception naming the rule).
-- ============================================================================

-- 1. All four 0016 guard functions exist.
SELECT
  '1. 0016 guard functions' AS check_name,
  CASE WHEN COUNT(*) = 4 THEN 'PASS' ELSE 'FAIL — expected 4, found ' || COUNT(*) END AS status,
  COALESCE(string_agg(proname, ', ' ORDER BY proname), '(none)') AS detail
FROM pg_proc
WHERE proname IN ('guard_mrs_financial_fields',
                  'guard_transmittal_fields',
                  'guard_line_item_fields',
                  'guard_line_item_delete')

UNION ALL

-- 2. All four 0016 triggers are live.
SELECT
  '2. 0016 triggers live',
  CASE WHEN COUNT(*) = 4 THEN 'PASS' ELSE 'FAIL — expected 4, found ' || COUNT(*) END,
  COALESCE(string_agg(tgname || ' (' || tgrelid::regclass || ')', ', ' ORDER BY tgname), '(none)')
FROM pg_trigger
WHERE tgname IN ('trg_guard_mrs_financial_fields',
                 'trg_guard_transmittal_fields',
                 'trg_guard_line_item_fields',
                 'trg_guard_line_item_delete')
  AND NOT tgisinternal

UNION ALL

-- 3. The actor helpers exist (the guards call them; a missing helper means the
--    trigger would fail at write time, not at apply time).
SELECT
  '3. actor helpers',
  CASE WHEN COUNT(*) = 2 THEN 'PASS' ELSE 'FAIL — expected 2, found ' || COUNT(*) END,
  COALESCE(string_agg(proname, ', ' ORDER BY proname), '(none)')
FROM pg_proc
WHERE proname IN ('get_my_department_id', 'mrs_department_of')

UNION ALL

-- 4. The three CHECK constraints exist. 'VALID' means legacy data was clean;
--    'NOT VALID' still blocks every new/updated row — see check 8 to finish it.
SELECT
  '4. check constraints',
  CASE WHEN COUNT(*) = 3 THEN 'PASS' ELSE 'FAIL — expected 3, found ' || COUNT(*) END,
  COALESCE(string_agg(conname || '=' || CASE WHEN convalidated THEN 'VALID' ELSE 'NOT VALID' END,
                      ', ' ORDER BY conname), '(none)')
FROM pg_constraint
WHERE conname IN ('chk_tr_amount_positive',
                  'chk_mrs_requester_verification_values',
                  'chk_mrs_cash_figures_non_negative')

UNION ALL

-- 5. The requisition guard carries the Gate B recompute rule (proves it is this
--    migration's body, not a stale or truncated one).
SELECT
  '5. MRS guard body',
  CASE WHEN prosrc LIKE '%mrs_disbursed_total%'
        AND prosrc LIKE '%spare_change_required%'
        AND prosrc LIKE '%requester_verification%'
        AND prosrc LIKE '%availability_hold%'
        AND prosrc LIKE '%allocated_budget%'
       THEN 'PASS' ELSE 'STALE — re-run 0016' END,
  'len=' || length(prosrc)::text
FROM pg_proc
WHERE proname = 'guard_mrs_financial_fields'

UNION ALL

-- 6. The transmittal guard carries the anti-detachment rules (mrs_id and
--    transmittal_type are the two exemptions in guard_transmittal_receipt).
SELECT
  '6. transmittal guard body',
  CASE WHEN prosrc LIKE '%NEW.mrs_id IS DISTINCT FROM OLD.mrs_id%'
        AND prosrc LIKE '%NEW.transmittal_type IS DISTINCT FROM OLD.transmittal_type%'
        AND prosrc LIKE '%NEW.amount IS DISTINCT FROM OLD.amount%'
       THEN 'PASS' ELSE 'STALE — re-run 0016' END,
  'len=' || length(prosrc)::text
FROM pg_proc
WHERE proname = 'guard_transmittal_fields'

UNION ALL

-- 7. 0013 / 0014 / 0015 are undisturbed. 0016 adds functions and triggers only;
--    it never redefines an existing guard. Gate B = spare-change comparison,
--    Gate C = requester_verification check, both inside guard_transmittal_receipt.
SELECT
  '7. prior gates intact',
  CASE WHEN (SELECT COUNT(*) FROM pg_proc
              WHERE proname = 'guard_transmittal_receipt'
                AND prosrc LIKE '%spare_change_required%') = 1
        AND (SELECT COUNT(*) FROM pg_proc
              WHERE proname = 'guard_transmittal_receipt'
                AND prosrc LIKE '%VERIFIED%') = 1
        AND (SELECT COUNT(*) FROM pg_trigger
              WHERE tgname IN ('trg_guard_mrs_status_transition',
                               'trg_guard_mrs_delivery_signoff',
                               'trg_guard_transmittal_receipt',
                               'trg_guard_cash_transmittal_insert',
                               'trg_guard_cash_transmittal_sent',
                               'trg_guard_fd_cod_disbursement')
                AND NOT tgisinternal) = 6
       THEN 'PASS'
       ELSE 'FAIL — B=' ||
            (SELECT COUNT(*)::text FROM pg_proc
              WHERE proname = 'guard_transmittal_receipt' AND prosrc LIKE '%spare_change_required%') ||
            ' C=' ||
            (SELECT COUNT(*)::text FROM pg_proc
              WHERE proname = 'guard_transmittal_receipt' AND prosrc LIKE '%VERIFIED%') ||
            ' triggers=' ||
            (SELECT COUNT(*)::text FROM pg_trigger
              WHERE tgname IN ('trg_guard_mrs_status_transition',
                               'trg_guard_mrs_delivery_signoff',
                               'trg_guard_transmittal_receipt',
                               'trg_guard_cash_transmittal_insert',
                               'trg_guard_cash_transmittal_sent',
                               'trg_guard_fd_cod_disbursement')
                AND NOT tgisinternal) ||
            '/6 — re-run 0013 → 0014 → 0015 → 0016 in order'
       END,
  'gate functions + 6 pre-0016 triggers'

UNION ALL

-- 8. INFORMATIONAL — legacy rows the new CHECK constraints would refuse. Any row
--    here is PRE-0016 damage, not a broken gate; the constraints were added
--    NOT VALID if this was non-empty at apply time. Repair, then VALIDATE.
SELECT
  '8. legacy data inventory (info)',
  'INFO',
  'amount<=0: ' || (SELECT COUNT(*) FROM transmittal_forms WHERE NOT (amount > 0))
    || ' · bad verification value: ' || (SELECT COUNT(*) FROM material_requisitions
                                          WHERE requester_verification IS NOT NULL
                                            AND requester_verification NOT IN
                                                ('PENDING_DELIVERY','VERIFIED','DISPUTED'))
    || ' · negative cash figure: ' || (SELECT COUNT(*) FROM material_requisitions
                                        WHERE COALESCE(spare_change_required,0) < 0
                                           OR COALESCE(spare_change_returned,0) < 0
                                           OR COALESCE(spare_change_amount,0)   < 0
                                           OR COALESCE(total_actual_spent,0)    < 0
                                           OR COALESCE(allocated_budget,0)      < 0)
    || ' · closed without sign-off: ' || (SELECT COUNT(*) FROM material_requisitions
                                           WHERE overall_status = 'CLOSED'
                                             AND COALESCE(requester_verification,'PENDING_DELIVERY') <> 'VERIFIED')

UNION ALL

-- 9. INFORMATIONAL — the live guard stack per chain table, in firing order
--    (Postgres fires same-event triggers alphabetically). Confirms 0016 sits
--    alongside the earlier gates rather than replacing any of them.
SELECT
  '9. trigger stack (info)',
  'INFO',
  string_agg(tgrelid::regclass::text || ': ' || tgname, ' | ' ORDER BY tgrelid, tgname)
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgrelid::regclass::text IN ('material_requisitions', 'transmittal_forms', 'mrs_line_items')

ORDER BY check_name;
