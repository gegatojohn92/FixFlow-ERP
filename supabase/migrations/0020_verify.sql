-- ============================================================================
-- 0020_verify.sql — READ-ONLY verification that 0020 applied cleanly and that
--                   nothing from 0011-0019 was disturbed.
--
-- Paste into the Supabase SQL Editor and run. Checks 1-9 must all say PASS;
-- checks 10-11 are INFORMATIONAL inventories (accounts to reassign, and the
-- reach the new policies grant). One statement (UNION ALL) so every check shows
-- at once.
--
-- Requires 0016 (get_my_role / get_my_department_id) — the policies call them.
-- ============================================================================

-- 1. mrs_select_safe: own-department branch restored, FRONT_DESK added,
--    no retired role, and the recursion-free helper is what it uses.
SELECT
  '1. mrs_select_safe widened correctly' AS check_name,
  CASE WHEN count(*) = 1
        AND bool_and(qual LIKE '%get_my_department_id()%')
        AND bool_and(qual LIKE '%department_id = get_my_department_id()%')
        AND bool_and(qual LIKE '%''FRONT_DESK''%')
        AND bool_and(qual LIKE '%requester_id = auth.uid()%')
        AND bool_and(qual NOT LIKE '%''STOREKEEPER''%')
        AND bool_and(qual NOT LIKE '%SELECT department_id FROM users%')
        AND bool_and(qual LIKE '%is_active_account()%')
       THEN 'PASS'
       ELSE 'FAIL — expected requester + get_my_department_id() + FRONT_DESK, no storekeeper, no raw users subquery: '
            || COALESCE(string_agg(qual, ' | '), 'policy missing') END AS status,
  COALESCE(string_agg(qual, ''), 'no such policy') AS detail
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'material_requisitions' AND policyname = 'mrs_select_safe'

UNION ALL

-- 2. mrs_update_safe: same shape (and the retired role removed from the list
--    0005 had given it — reach now comes from the department branch instead).
SELECT
  '2. mrs_update_safe widened correctly',
  CASE WHEN count(*) = 1
        AND bool_and(qual LIKE '%department_id = get_my_department_id()%')
        AND bool_and(qual LIKE '%''FRONT_DESK''%')
        AND bool_and(qual LIKE '%requester_id = auth.uid()%')
        AND bool_and(qual NOT LIKE '%''STOREKEEPER''%')
        AND bool_and(qual LIKE '%is_active_account()%')
       THEN 'PASS'
       ELSE 'FAIL — ' || COALESCE(string_agg(qual, ' | '), 'policy missing') END,
  COALESCE(string_agg(qual, ''), 'no such policy')
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'material_requisitions' AND policyname = 'mrs_update_safe'

UNION ALL

-- 3. transmittal_insert_safe: FRONT_DESK can mint the Form 12 COD leg.
-- (An INSERT policy has no USING clause: pg_policies stores its WITH CHECK
--  expression in `with_check`, and `qual` is NULL — reading `qual` here would
--  report "policy missing" for a policy that is present and correct.)
SELECT
  '3. transmittal_insert_safe admits FRONT_DESK',
  CASE WHEN count(*) = 1
        AND bool_and(with_check LIKE '%''FRONT_DESK''%')
        AND bool_and(with_check LIKE '%sender_user_id = auth.uid()%')
        AND bool_and(with_check LIKE '%is_active_account()%')
       THEN 'PASS'
       ELSE 'FAIL — ' || COALESCE(string_agg(with_check, ' | '), 'policy missing') END,
  COALESCE(string_agg(with_check, ''), 'no such policy')
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'transmittal_forms' AND policyname = 'transmittal_insert_safe'

UNION ALL

-- 4. No policy anywhere still names the retired role.
SELECT
  '4. no policy references the retired role',
  CASE WHEN count(*) = 0 THEN 'PASS'
       ELSE 'FAIL — ' || string_agg(tablename || '.' || policyname, ', ') END,
  count(*)::text || ' policy/policies still name STOREKEEPER'
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual LIKE '%''STOREKEEPER''%' OR with_check LIKE '%''STOREKEEPER''%')

UNION ALL

-- 5. guard_line_item_fields() was redefined (not merely present): the retired
--    role is gone from its executable code and Rule 3 carries the new message.
SELECT
  '5. guard_line_item_fields() redefined',
  CASE WHEN count(*) = 1
        AND bool_and(prosrc NOT LIKE '%v_role = ''STOREKEEPER''%')
        AND bool_and(prosrc NOT LIKE '%''PURCHASER'', ''STOREKEEPER''%')
        AND bool_and(prosrc LIKE '%retired with Form 6%')
       THEN 'PASS'
       ELSE 'FAIL — still 0016''s body, or the redefinition did not apply' END,
  'len=' || COALESCE(string_agg(length(prosrc)::text, ''), 'function missing')
FROM pg_proc
WHERE proname = 'guard_line_item_fields'

UNION ALL

-- 6. guard_mrs_open_fields(): exists, runs as its owner with a pinned
--    search_path (so its verdict never depends on the caller's RLS visibility),
--    and carries all five rule groups.
SELECT
  '6. guard_mrs_open_fields() correct',
  CASE WHEN count(*) = 1
        AND bool_and(p.prosecdef)
        AND bool_and(COALESCE((SELECT setting FROM unnest(p.proconfig) AS setting
                               WHERE setting LIKE 'search_path=%'), 'no') <> 'no')
        AND bool_and(p.prosrc LIKE '%purpose%')                  -- O1 filed request
        AND bool_and(p.prosrc LIKE '%manager_reviewed_at%')      -- O2 Form 7
        AND bool_and(p.prosrc LIKE '%owner_reviewed_at%')        -- O3 Form 8
        AND bool_and(p.prosrc LIKE '%fast_track_audited_at%')    -- O4 §6.A step 3
        AND bool_and(p.prosrc LIKE '%trip_completed_by%')        -- O5 0018/0019
        AND bool_and(p.prosrc LIKE '%overspend_reason%')
       THEN 'PASS'
       ELSE 'FAIL — definer/search_path/rule-group check: definer='
            || COALESCE(bool_and(p.prosecdef)::text, 'n/a')
            || ' len=' || COALESCE(string_agg(length(p.prosrc)::text, ''), 'missing') END,
  'len=' || COALESCE(string_agg(length(prosrc)::text, ''), 'function missing')
FROM pg_proc p
WHERE proname = 'guard_mrs_open_fields'

UNION ALL
-- 6b. is_active_account(): the Rule 5 gate all three policies now call. Must be
--     SECURITY DEFINER with a pinned search_path (reading public.users from
--     inside a policy is the recursion 0005 was written to remove) and must fail
--     closed when the profile row is missing.
SELECT
  '6b. is_active_account() correct' AS check_name,
  CASE WHEN count(*) = 1
        AND bool_and(p.prosecdef)
        AND bool_and(COALESCE((SELECT setting FROM unnest(p.proconfig) AS setting
                               WHERE setting LIKE 'search_path=%'), 'no') <> 'no')
        AND bool_and(p.prosrc LIKE '%account_status = ''ACTIVE''%')
        AND bool_and(p.prosrc LIKE '%COALESCE%')
        AND bool_and(p.provolatile = 's')
       THEN 'PASS'
       ELSE 'FAIL — definer/search_path/fail-closed check: definer='
            || COALESCE(bool_and(p.prosecdef)::text, 'n/a')
            || ' volatile=' || COALESCE(string_agg(p.provolatile, ''), 'missing') END AS status,
  'len=' || COALESCE(string_agg(length(prosrc)::text, ''), 'function missing') AS detail
FROM pg_proc p
WHERE proname = 'is_active_account'
UNION ALL

-- 7. Both new/redefined guards are actually wired to their tables.
SELECT
  '7. 0020 triggers live',
  CASE WHEN count(*) = 3 THEN 'PASS'
       ELSE 'FAIL — expected 3 triggers, found ' || count(*)::text END,
  COALESCE(string_agg(tgrelid::regclass::text || ': ' || tgname, ' · ' ORDER BY tgname), 'none')
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgname IN ('trg_guard_mrs_open_fields', 'trg_guard_line_item_fields',
                 'trg_guard_users_retired_roles')

UNION ALL

-- 8. No active account still holds the retired role.
SELECT
  '8. no ACTIVE storekeeper accounts',
  CASE WHEN count(*) = 0 THEN 'PASS'
       ELSE 'FAIL — ' || count(*)::text || ' still ACTIVE; re-run 0020 §3a' END,
  'inactive with the retired role: ' ||
    (SELECT count(*)::text FROM users WHERE role = 'STOREKEEPER')
FROM users
WHERE role = 'STOREKEEPER' AND account_status = 'ACTIVE'

UNION ALL

-- 9. Nothing from 0011-0019 was disturbed: the gate and cash-chain guards and
--    their triggers must all still be present and live.
SELECT
  '9. prior gates intact',
  CASE WHEN (SELECT count(*) FROM pg_proc WHERE proname IN (
                 'guard_mrs_status_transition', 'guard_mrs_delivery_signoff',
                 'guard_transmittal_receipt', 'guard_mrs_financial_fields',
                 'guard_transmittal_fields', 'guard_mrs_spend_ceiling',
                 'guard_cash_transmittal_insert', 'guard_cash_transmittal_sent',
                 'guard_fd_cod_disbursement', 'cascade_jo_cancellation',
                 'get_my_role', 'get_my_department_id', 'mrs_department_of',
                 'mrs_disbursed_total')) = 14
        AND (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
                 'trg_guard_mrs_status_transition', 'trg_guard_mrs_delivery_signoff',
                 'trg_guard_transmittal_receipt', 'trg_guard_mrs_financial_fields',
                 'trg_guard_transmittal_fields', 'trg_guard_mrs_spend_ceiling',
                 'trg_guard_cash_transmittal_insert', 'trg_guard_cash_transmittal_sent',
                 'trg_guard_fd_cod_disbursement', 'on_jo_cancelled')) = 10
       THEN 'PASS'
       ELSE 'FAIL — a gate function or trigger is missing; re-apply the migration that owns it' END,
  'gate functions + 10 pre-0020 triggers'

UNION ALL

-- 10. INFORMATIONAL: the accounts 0020 §3a deactivated. Each one needs a new
--     role in Admin → Users (or stays inactive) — a Super Admin can move an
--     account OUT of the retired role; guard_users_retired_roles() only refuses
--     to move one INTO it.
SELECT
  '10. retired-role accounts (INFO)',
  'INFO',
  COALESCE(string_agg(email || ' [' || account_status || ']', ', ' ORDER BY email),
           'none') 
FROM users
WHERE role = 'STOREKEEPER'

UNION ALL

-- 11. INFORMATIONAL: how much reach the own-department branch grants, per
--     department. This is the widening the owner approved (audit §A5 Option A);
--     columns stay owned by 0016 Rules 1-9 and guard_mrs_open_fields().
SELECT
  '11. department reach (INFO)',
  'INFO',
  COALESCE(string_agg(d.department_name || ': ' ||
      (SELECT count(*)::text FROM users u WHERE u.department_id = d.id) || ' user(s) → ' ||
      (SELECT count(*)::text FROM material_requisitions m WHERE m.department_id = d.id) ||
      ' requisition(s)', ' · ' ORDER BY d.department_name), 'no departments')
FROM departments d

ORDER BY check_name;
