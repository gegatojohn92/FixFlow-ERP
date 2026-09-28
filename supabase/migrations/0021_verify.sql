-- ============================================================================
-- 0021_verify.sql — READ-ONLY verification for 0021 A6/B4 hardening.
--
-- Paste into the Supabase SQL Editor after running
-- 0021_status_authority_and_fd_float_ack.sql. Checks 1-6 must PASS.
-- ============================================================================

SELECT
  '1. status actor guard exists' AS check_name,
  CASE WHEN count(*) = 1
        AND bool_and(p.prosecdef)
        AND bool_and(COALESCE((SELECT setting FROM unnest(p.proconfig) AS setting
                               WHERE setting LIKE 'search_path=%'), 'no') <> 'no')
        AND bool_and(p.prosrc LIKE '%PENDING_MANAGER%IN_CANVASSING%')
        AND bool_and(p.prosrc LIKE '%BUDGET_OFFICER%')
        AND bool_and(p.prosrc LIKE '%ACCOUNTING%')
        AND bool_and(p.prosrc LIKE '%PURCHASER%')
        AND bool_and(p.prosrc LIKE '%v_is_same_department%')
        AND bool_and(p.prosrc LIKE '%requester_verification%')
        AND bool_and(p.prosrc LIKE '%ISSUED_FROM_STOCK%')
       THEN 'PASS'
       ELSE 'FAIL — missing/incorrect guard_mrs_status_actor() body' END AS status,
  'len=' || COALESCE(string_agg(length(p.prosrc)::text, ''), 'function missing') AS detail
FROM pg_proc p
WHERE p.proname = 'guard_mrs_status_actor'

UNION ALL

SELECT
  '2. status actor trigger live',
  CASE WHEN count(*) = 1 THEN 'PASS'
       ELSE 'FAIL — expected trg_guard_mrs_status_actor on material_requisitions' END,
  COALESCE(string_agg(tgrelid::regclass::text || ': ' || tgname, ', '), 'none')
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgname = 'trg_guard_mrs_status_actor'
  AND tgrelid = 'material_requisitions'::regclass

UNION ALL

SELECT
  '3. transmittal_update_safe admits Front Desk',
  CASE WHEN count(*) = 1
        AND bool_and(qual LIKE '%''FRONT_DESK''%')
        AND bool_and(qual LIKE '%is_active_account()%')
        AND bool_and(qual LIKE '%receiver_user_id = auth.uid()%')
       THEN 'PASS'
       ELSE 'FAIL — policy missing FRONT_DESK/is_active_account/receiver branch: '
            || COALESCE(string_agg(qual, ' | '), 'policy missing') END,
  COALESCE(string_agg(qual, ''), 'no such policy')
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'transmittal_forms' AND policyname = 'transmittal_update_safe'

UNION ALL

SELECT
  '4. transmittal field guard allows FD receipts only for FD legs',
  CASE WHEN count(*) = 1
        AND bool_and(prosrc LIKE '%FD_REVOLVING_DISBURSEMENT%')
        AND bool_and(prosrc LIKE '%FD_REVOLVING_REPLENISHMENT%')
        AND bool_and(prosrc LIKE '%v_role = ''ACCOUNTING''%')
        AND bool_and(prosrc LIKE '%v_role = ''FRONT_DESK''%')
       THEN 'PASS'
       ELSE 'FAIL — guard_transmittal_fields() does not carry the 0021 Rule 7 exception' END,
  'len=' || COALESCE(string_agg(length(prosrc)::text, ''), 'function missing')
FROM pg_proc
WHERE proname = 'guard_transmittal_fields'

UNION ALL

SELECT
  '5. receipt guard keeps Gates B/C and exempts FD legs',
  CASE WHEN count(*) = 1
        AND bool_and(prosrc LIKE '%FD_REVOLVING_DISBURSEMENT%')
        AND bool_and(prosrc LIKE '%FD_REVOLVING_REPLENISHMENT%')
        AND bool_and(prosrc LIKE '%0014 Gate C%')
        AND bool_and(prosrc LIKE '%0013 Gate B%')
        AND bool_and(prosrc LIKE '%sender_status NOT IN%')
       THEN 'PASS'
       ELSE 'FAIL — guard_transmittal_receipt() lost either FD exemptions or Gates B/C' END,
  'len=' || COALESCE(string_agg(length(prosrc)::text, ''), 'function missing')
FROM pg_proc
WHERE proname = 'guard_transmittal_receipt'

UNION ALL

SELECT
  '6. prior and 0021 triggers live',
  CASE WHEN (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
                 'trg_guard_mrs_status_transition', 'trg_guard_mrs_status_actor',
                 'trg_guard_mrs_delivery_signoff', 'trg_guard_transmittal_receipt',
                 'trg_guard_mrs_financial_fields', 'trg_guard_transmittal_fields',
                 'trg_guard_mrs_spend_ceiling', 'trg_guard_cash_transmittal_insert',
                 'trg_guard_cash_transmittal_sent', 'trg_guard_fd_cod_disbursement',
                 'on_jo_cancelled')) = 11
       THEN 'PASS'
       ELSE 'FAIL — one or more gate triggers are missing after 0021' END,
  'expects 11 non-internal gate triggers including trg_guard_mrs_status_actor'

ORDER BY check_name;
