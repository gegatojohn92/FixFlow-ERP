-- ============================================================================
-- 0017_verify.sql — READ-ONLY verification that 0017 applied cleanly and that
--                   Rule 3's cascade is functional again (both defects).
--
-- Paste into the Supabase SQL Editor and run. Checks 1-5 must all say PASS.
-- Check 6 is INFORMATIONAL. One statement (UNION ALL) so every check shows at once.
--
-- ⚠️ ORDERING: 0011 also re-declares cascade_jo_cancellation(). If 0011 is ever
--    re-applied, checks 1 and 2 flip to STALE/FAIL — re-run 0017.
-- ============================================================================

-- 1. The live cascade body carries the cast.
SELECT
  '1. EXTRACT cast restored' AS check_name,
  CASE WHEN prosrc LIKE '%EXTRACT(YEAR FROM CURRENT_DATE)::INT%' THEN 'PASS'
       WHEN prosrc LIKE '%EXTRACT(YEAR FROM CURRENT_DATE)%'      THEN 'STALE — 0011 body is live, re-run 0017'
       ELSE 'FAIL — no reference-number call found in the cascade body' END AS status,
  'len=' || length(prosrc)::text AS detail
FROM pg_proc
WHERE proname = 'cascade_jo_cancellation'

UNION ALL

-- 2. Defect 2 fixed: the cascade must be SECURITY DEFINER, or step 4b runs with
--    the cancelling user's RLS and silently inserts nothing for MANAGER /
--    technician / requester cancellations.
SELECT
  '2. cascade is SECURITY DEFINER',
  CASE WHEN p.prosecdef THEN 'PASS' ELSE 'FAIL — 0011 body is live (not definer), re-run 0017' END,
  'search_path fixed: ' || CASE WHEN COALESCE((SELECT setting FROM unnest(p.proconfig) AS setting
                             WHERE setting LIKE 'search_path=%'), 'no') <> 'no' THEN 'yes' ELSE 'NO' END
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'cascade_jo_cancellation'

UNION ALL

-- 3. The cast is the ONLY other difference from 0011: every branch of the cascade
--    must still be present (4a void, 4b spare-change return + de-dupe, 4c cancel).
SELECT
  '3. cascade branches intact',
  CASE WHEN prosrc LIKE '%overall_status = ''VOIDED''%'
        AND prosrc LIKE '%SPARE_CHANGE_RETURN%'
        AND prosrc LIKE '%NOT EXISTS%'
        AND prosrc LIKE '%sender_status = ''CANCELLED'', receiver_status = ''CANCELLED''%'
        AND prosrc LIKE '%party holding the cash must return it%'
       THEN 'PASS' ELSE 'FAIL — a cascade branch is missing; re-run 0017' END,
  'len=' || length(prosrc)::text
FROM pg_proc
WHERE proname = 'cascade_jo_cancellation'

UNION ALL

-- 4. next_reference_number is still a single (VARCHAR, INT) function.
SELECT
  '4. next_reference_number signature',
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL — expected 1, found ' || COUNT(*) END,
  COALESCE(string_agg(pg_get_function_identity_arguments(p.oid), ', '), '(none)')
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'next_reference_number'

UNION ALL

-- 5. The trigger is live and 0016 / 0013 / 0014 / 0015 were not disturbed.
SELECT
  '5. trigger stack intact',
  CASE WHEN (SELECT COUNT(*) FROM pg_trigger
              WHERE tgname = 'on_jo_cancelled' AND NOT tgisinternal) = 1
        AND (SELECT COUNT(*) FROM pg_trigger
              WHERE tgname IN ('trg_guard_mrs_status_transition',
                               'trg_guard_mrs_delivery_signoff',
                               'trg_guard_transmittal_receipt',
                               'trg_guard_cash_transmittal_insert',
                               'trg_guard_cash_transmittal_sent',
                               'trg_guard_fd_cod_disbursement',
                               'trg_guard_mrs_financial_fields',
                               'trg_guard_transmittal_fields',
                               'trg_guard_line_item_fields',
                               'trg_guard_line_item_delete')
                AND NOT tgisinternal) = 10
       THEN 'PASS'
       ELSE 'FAIL — on_jo_cancelled=' ||
            (SELECT COUNT(*)::text FROM pg_trigger WHERE tgname = 'on_jo_cancelled' AND NOT tgisinternal) ||
            '/1, guards=' ||
            (SELECT COUNT(*)::text FROM pg_trigger
              WHERE tgname IN ('trg_guard_mrs_status_transition',
                               'trg_guard_mrs_delivery_signoff',
                               'trg_guard_transmittal_receipt',
                               'trg_guard_cash_transmittal_insert',
                               'trg_guard_cash_transmittal_sent',
                               'trg_guard_fd_cod_disbursement',
                               'trg_guard_mrs_financial_fields',
                               'trg_guard_transmittal_fields',
                               'trg_guard_line_item_fields',
                               'trg_guard_line_item_delete')
                AND NOT tgisinternal) || '/10' END,
  'on_jo_cancelled + 10 guard triggers'

UNION ALL

-- 6. INFORMATIONAL — legacy damage inventory (READ-ONLY, executes no generator).
--    Because the exception aborted the whole statement, a cancellation attempt on
--    a Job Order with disbursed cash rolled back entirely: no CANCELLED status, no
--    voided MRS, no SPARE_CHANGE_RETURN. Two populations are worth reviewing:
--      (a) CANCELLED Job Orders that DO have disbursed cash but NO auto-generated
--          return — Rule 3 never ran for them (pre-0011 legacy, or a partial path).
--      (b) Job Orders stamped with cancellation metadata whose status is NOT
--          CANCELLED — the fingerprint of a rolled-back cancellation attempt.
--    0017 makes (b) impossible going forward; it cannot retroactively create the
--    missing returns in (a). Those need manual review: recover the cash, or write
--    it off with approval (same posture as §12.2's ₱936.00 + ₱120.00).
SELECT
  '6. cascade damage inventory (info)',
  'INFO',
  'cancelled JOs owing a spare-change return: ' ||
  (SELECT COUNT(DISTINCT j.id)
     FROM job_orders j
     JOIN material_requisitions m ON m.jo_id = j.id
     JOIN transmittal_forms t ON t.mrs_id = m.id
    WHERE j.status = 'CANCELLED'
      AND t.transmittal_type <> 'SPARE_CHANGE_RETURN'
      AND (t.sender_status = 'SENT' OR t.receiver_status = 'RECEIVED')
      AND NOT EXISTS (SELECT 1 FROM transmittal_forms r
                       WHERE r.transmittal_type = 'SPARE_CHANGE_RETURN'
                         AND r.mrs_id = t.mrs_id
                         AND r.notes LIKE 'Auto-generated by JO ' || j.jo_number || ' cancellation:%'))
  || ' · JOs stamped cancelled but status <> CANCELLED (rolled-back attempts): ' ||
  (SELECT COUNT(*) FROM job_orders
    WHERE status <> 'CANCELLED'
      AND (cancelled_at IS NOT NULL OR cancellation_reason IS NOT NULL))

ORDER BY check_name;
