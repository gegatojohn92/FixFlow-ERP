-- ============================================================================
-- 0020: Align the row policies with the roles the app routes, guard the columns
--       that widening exposes, and retire the storekeeper role (audit §A5)
--       — Phase 4b of §13.4
--
-- WHY (finding A5, reproduced in supabase/tests as GAP G1-G8)
--   0005 replaced 0002's material_requisitions policies to break an RLS
--   recursion, and in doing so dropped "Staff read own dept MRS" without ever
--   restoring own-department read. The role lists it left behind omit three
--   roles the app routes to their own forms, plus any colleague of the
--   requester:
--     mrs_select_safe        requester · SA · MANAGER · BO · ACCOUNTING · PURCHASER
--     mrs_update_safe        the same + STOREKEEPER
--     transmittal_insert_safe sender · SA · ACCOUNTING · BO
--   Under RLS the SELECT policy is applied to the rows an UPDATE reads, so a
--   role missing from mrs_select_safe writes 0 rows even where
--   mrs_update_safe names it (harness G8: the storekeeper role is in the UPDATE
--   policy, get_my_role() resolves, the write still hits nothing). PostgREST
--   reports that as a *successful* response, which is why Phase 4's B2 fix had
--   to start checking affected-row counts.
--
--   The result is that three shipped forms cannot be used by the roles the app
--   routes to them:
--     · Form 6  /mrs/stock-check      — queue empty, actions die on "MRS not found."
--     · Form 12 /transmittals/front-desk — cannot read the COD candidate list,
--               cannot INSERT the COD leg (transmittal_insert_safe omits FRONT_DESK,
--               and 0015's guard_fd_cod_disbursement() is NOT SECURITY DEFINER, so
--               it read the requisition under the inserter's RLS and reported
--               "references a requisition that does not exist"), cannot write the
--               delivery flags that 0016 Rule 9 names FRONT_DESK the only
--               legitimate writer of.
--     · Form 14 /delivery/verify      — MAINTENANCE cannot read or sign off its
--               OWN department's deliveries (0016 Rule 5 grants exactly that), and
--               a colleague of the requester cannot sign off either, which makes
--               the advice printed by Rule 5's own error text ("ask a colleague
--               from that department, or a Super Admin") unactionable.
--
-- WHAT
--   1. mrs_select_safe / mrs_update_safe — restore the own-department branch
--      (0002's original intent) using 0016's get_my_department_id(), which is
--      SECURITY DEFINER with a pinned search_path and therefore recursion-free
--      (Rule 4 of the handoff: never subquery `users` inside a policy). Add
--      FRONT_DESK, the one genuinely cross-department service role left: a
--      single front desk advances COD cash for every department (Form 12 lists
--      all online requisitions by design). Department authority stays the real
--      gate for Forms 9 and 14 — 0016 Rules 5 and 8 already scope it.
--   2. transmittal_insert_safe — add FRONT_DESK so fdCodDisbursement() can mint
--      the COD leg it already validates.
--   2b. All three rewritten policies now also require is_active_account()
--      (new, SECURITY DEFINER, STABLE). Rule 5 of the handoff says every path
--      checks account_status='ACTIVE', and src/proxy.ts:91 does — but no row
--      policy ever has, so a deactivated account holding a JWT that has not
--      expired yet kept its full RLS reach on direct REST calls. Since 3a below
--      retires a role BY deactivating its accounts, and since section 1 widens
--      reach, the gate belongs in the policies being rewritten. Fails closed:
--      a missing users row counts as inactive.
--   3. RETIRE THE STOREKEEPER ROLE and remove Form 6 (owner's decision, §13.9):
--      the warehouse stock-check flow is not used by this deployment, so the
--      role, /mrs/stock-check and issueStockFormSK() are gone from the app and
--      the role is dropped from every policy here.
--        · Existing storekeeper accounts are set account_status='INACTIVE'
--          (Rule 5 of the handoff: every auth path checks account_status, so
--          they cannot sign in until an admin reassigns them).
--        · guard_users_retired_roles() refuses to move an account INTO the
--          retired role, while still allowing one to be moved OUT of it, so a
--          deactivated account can be reassigned rather than being stuck.
--        · The enum VALUE cannot be dropped — PostgreSQL has no
--          ALTER TYPE ... DROP VALUE — so 'STOREKEEPER' stays defined and
--          unused. database.types.ts therefore still lists it.
--   4. guard_line_item_fields() redefined (full body preserved) to drop the
--      retired role from 0016 Rules 3, 4 and 5: issued-from-stock becomes
--      Super-Admin-only, qty_fulfilled Purchaser-only, line delivery status
--      Purchaser + requesting department.
--   5. guard_mrs_open_fields() — NEW. Widening row reach to a whole department
--      exposes the requisition columns 0016 deliberately left open, so each now
--      has a named owner (see the rule comments). Without this, any colleague
--      could rewrite the filed request, the Manager/Owner review stamps, the
--      fast-track post-audit stamps, or 0018's trip_completed_by — and rewriting
--      that last one is how the Form 14 self-sign-off refusal (audit §A1c) would
--      be defeated.
--
-- NOT COVERED HERE (reported as finding A6 in §13.9, deliberately not fixed)
--   `overall_status` still has no ROLE authority at the DB layer: 0011-0013's
--   guard_mrs_status_transition() validates the transition CHAIN only. Before
--   this migration that hole was reachable by the requester alone (who could
--   always update their own row); the own-department branch widens it to the
--   whole department. Closing it needs a per-transition actor matrix audited
--   against every app writer, so it is proposed separately as 0021 rather than
--   bundled into a policy migration.
--
-- SCOPE / SAFETY
--   · Redefines ONE 0016 function (guard_line_item_fields) and creates TWO new
--     ones. It does NOT touch guard_mrs_status_transition, guard_mrs_delivery_
--     signoff, guard_transmittal_receipt, guard_mrs_financial_fields,
--     guard_transmittal_fields, guard_mrs_spend_ceiling or cascade_jo_
--     cancellation, so Gates A/B/C, the cash chain and the 0017 cascade are
--     unaffected (0016_verify checks 1-2 assert that function and its trigger
--     still exist, not its body length — verified before redefining it).
--   · `auth.uid() IS NULL` (SQL Editor, service_role, reset & backfill scripts)
--     is waved through, exactly like 0016.
--   · Requires 0016 (get_my_role, get_my_department_id, mrs_department_of) and
--     0018/0019 (trip_completed_by, overspend_reason) — apply AFTER 0019.
--   · SAFE TO RE-RUN: DROP POLICY IF EXISTS / CREATE OR REPLACE /
--     DROP TRIGGER IF EXISTS throughout; the deactivation is idempotent.
--
-- Apply AFTER 0019. Then run 0020_verify.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. is_active_account() — Rule 5 at the row-policy layer
--    SECURITY DEFINER + pinned search_path, like 0016's get_my_role() and
--    get_my_department_id(): reading public.users from inside a policy is
--    exactly the recursion 0005 was written to remove (handoff Rule 4).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION is_active_account()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Fail closed: no profile row, or any status other than ACTIVE, means no reach.
  SELECT COALESCE(
    (SELECT account_status = 'ACTIVE' FROM public.users WHERE id = auth.uid()),
    FALSE
  )
$$;

GRANT EXECUTE ON FUNCTION is_active_account() TO authenticated;

COMMENT ON FUNCTION is_active_account() IS
  '0020: TRUE when the signed-in user has a public.users row with account_status=''ACTIVE''. Rule 5 of the handoff enforced at the row-policy layer, so a deactivated account loses RLS reach even while its JWT is still valid. SECURITY DEFINER to avoid the users-policy recursion 0005 removed.';

-- ----------------------------------------------------------------------------
-- 1. material_requisitions — row reach (finding A5)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "mrs_select_safe" ON material_requisitions;
CREATE POLICY "mrs_select_safe" ON material_requisitions
FOR SELECT TO authenticated USING (
  is_active_account()
  AND (
  -- The filer always sees their own requisition.
  requester_id = auth.uid()
  -- Own department: restores 0002's "Staff read own dept MRS", dropped by 0005
  -- to break the recursion. get_my_department_id() is SECURITY DEFINER, so this
  -- does not re-enter the users policies (handoff Rule 4). This is what makes
  -- Form 14 sign-off and Form 9 decisions reachable by the requester's
  -- colleagues, which 0016 Rules 5 and 8 already treat as the department's call.
  OR department_id = get_my_department_id()
  -- Oversight/financial roles see everything, plus FRONT_DESK: one front desk
  -- handles COD advances for every department (Form 12).
  OR get_my_role() IN ('SUPER_ADMIN','MANAGER','BUDGET_OFFICER','ACCOUNTING','PURCHASER','FRONT_DESK')
  )
);

DROP POLICY IF EXISTS "mrs_update_safe" ON material_requisitions;
CREATE POLICY "mrs_update_safe" ON material_requisitions
FOR UPDATE TO authenticated USING (
  is_active_account()
  AND (
    requester_id = auth.uid()
    OR department_id = get_my_department_id()
    OR get_my_role() IN ('SUPER_ADMIN','MANAGER','BUDGET_OFFICER','ACCOUNTING','PURCHASER','FRONT_DESK')
  )
);
-- Row reach is deliberately coarse: WHICH columns an actor may write is
-- enforced by guard_mrs_financial_fields() (0016 Rules 1-9) and
-- guard_mrs_open_fields() (below), both of which are SECURITY DEFINER and so
-- judge the rule instead of the row's visibility.

-- ----------------------------------------------------------------------------
-- 2. transmittal_forms — FRONT_DESK mints the COD leg (Form 12)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "transmittal_insert_safe" ON transmittal_forms;
CREATE POLICY "transmittal_insert_safe" ON transmittal_forms
FOR INSERT TO authenticated WITH CHECK (
  is_active_account()
  AND (
    sender_user_id = auth.uid()
    OR get_my_role() IN ('SUPER_ADMIN','ACCOUNTING','BUDGET_OFFICER','FRONT_DESK')
  )
);

-- ----------------------------------------------------------------------------
-- 3. Retire the storekeeper role
-- ----------------------------------------------------------------------------

-- 3a. Deactivate the accounts that hold it. Rule 5 of the handoff: every auth
--     path checks account_status='ACTIVE', so INACTIVE accounts cannot sign in.
--     An admin (or a Super Admin console) can reassign them afterwards — 3b
--     deliberately allows moving an account OUT of the retired role.
DO $$
DECLARE
  v_count INT;
  v_list  TEXT;
BEGIN
  SELECT COUNT(*), COALESCE(string_agg(email, ', ' ORDER BY email), '')
    INTO v_count, v_list
    FROM users
   WHERE role = 'STOREKEEPER' AND account_status <> 'INACTIVE';

  IF COALESCE(v_count, 0) = 0 THEN
    RAISE NOTICE '0020: no active storekeeper accounts to deactivate.';
    RETURN;
  END IF;

  UPDATE users
     SET account_status = 'INACTIVE'
   WHERE role = 'STOREKEEPER' AND account_status <> 'INACTIVE';

  RAISE WARNING
    '0020: % storekeeper account(s) set to INACTIVE because the role and Form 6 are retired — reassign each one in Admin → Users if the person still needs access: %',
    v_count, v_list;
END $$;

-- 3b. Refuse to hand the retired role to anyone. Fires on INSERT and on an
--     UPDATE that changes `role`, so deactivating or renaming an existing
--     storekeeper account still works, and so does moving one to another role.
CREATE OR REPLACE FUNCTION guard_users_retired_roles()
RETURNS TRIGGER AS $$
BEGIN
  -- SQL Editor / service_role / backfill scripts: trusted admin path.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.role = 'STOREKEEPER' AND OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION
      'The storekeeper role was retired by migration 0020 (Form 6 / the warehouse stock check was removed). Assign STAFF, PURCHASER or another active role instead; a Super Admin can move an existing storekeeper account to a different role.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_users_retired_roles ON users;
CREATE TRIGGER trg_guard_users_retired_roles
BEFORE INSERT OR UPDATE OF role ON users
FOR EACH ROW EXECUTE FUNCTION guard_users_retired_roles();

-- ----------------------------------------------------------------------------
-- 4. mrs_line_items — 0016's field guard, minus the retired role
--    (full body preserved; only Rules 3, 4 and 5 change)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_line_item_fields()
RETURNS TRIGGER AS $$
DECLARE
  v_role     user_role;
  v_dept     INT;
  v_mrs_dept INT;
  v_is_admin BOOLEAN;
  v_is_dept  BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_role := get_my_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION
      'This requisition line cannot be modified: your user has no role record in public.users (Rule 5).';
  END IF;

  v_dept     := get_my_department_id();
  v_mrs_dept := mrs_department_of(NEW.mrs_id);
  v_is_admin := v_role = 'SUPER_ADMIN';
  v_is_dept  := v_dept IS NOT NULL AND v_mrs_dept IS NOT NULL AND v_dept = v_mrs_dept;

  -- ── Rule 1: the request itself is immutable after Form 5 ───────────────────
  -- No app flow updates these (createMRS INSERTs them). Editing what was asked
  -- for would silently re-scope an already-approved budget.
  IF (NEW.item_description     IS DISTINCT FROM OLD.item_description
   OR NEW.qty_requested        IS DISTINCT FROM OLD.qty_requested
   OR NEW.unit                 IS DISTINCT FROM OLD.unit
   OR NEW.reference_photo_url  IS DISTINCT FROM OLD.reference_photo_url)
     AND NOT v_is_admin THEN
    RAISE EXCEPTION
      'The requested item, quantity and unit are fixed once the requisition is filed (Form 5). Reject or void the requisition and file a new one; only a Super Admin may amend a line in place.';
  END IF;

  -- ── Rule 2: canvassed pricing — Budget Officer (Form 8) ────────────────────
  -- LEGITIMATE WRITER: recordCanvassPricing() on /mrs/canvass
  -- (SUPER_ADMIN + BUDGET_OFFICER per access-control.ts).
  IF (NEW.est_unit_price IS DISTINCT FROM OLD.est_unit_price
   OR NEW.store_name     IS DISTINCT FROM OLD.store_name)
     AND NOT (v_is_admin OR v_role = 'BUDGET_OFFICER') THEN
    RAISE EXCEPTION
      'Canvassed supplier and unit price can only be recorded by a Budget Officer (Form 8) — you are signed in as %.', v_role;
  END IF;

  -- ── Rule 3: warehouse issuance — retired with Form 6 (0020) ────────────────
  -- The storekeeper role and issueStockFormSK() / /mrs/stock-check are removed
  -- by 0020, so NO app flow writes qty_issued_from_stock any more. The column
  -- and its history stay readable (Form 17, legacy ISSUED_FROM_STOCK rows); only
  -- a Super Admin may correct a legacy value in place.
  IF NEW.qty_issued_from_stock IS DISTINCT FROM OLD.qty_issued_from_stock
     AND NOT v_is_admin THEN
    RAISE EXCEPTION
      'Warehouse issuance was retired with Form 6 (migration 0020) — only a Super Admin may amend a legacy issued-from-stock quantity. You are signed in as %.', v_role;
  END IF;

  -- ── Rule 4: purchase actuals — Purchaser (Form 13) ─────────────────────────
  -- LEGITIMATE WRITER: purchaserCompleteTrip() on /purchaser/queue
  -- (SUPER_ADMIN + PURCHASER). qty_fulfilled used to be shared with Rule 3
  -- (0011: qty_fulfilled = stock issued + purchased); with Form 6 retired by
  -- 0020 the Purchaser is its only writer.
  IF (NEW.actual_unit_price IS DISTINCT FROM OLD.actual_unit_price
   OR NEW.purchased_at      IS DISTINCT FROM OLD.purchased_at
   OR NEW.vendor_rating     IS DISTINCT FROM OLD.vendor_rating
   OR NEW.is_overpriced     IS DISTINCT FROM OLD.is_overpriced
   OR NEW.qty_available     IS DISTINCT FROM OLD.qty_available
   OR NEW.availability_note IS DISTINCT FROM OLD.availability_note)
     AND NOT (v_is_admin OR v_role = 'PURCHASER') THEN
    RAISE EXCEPTION
      'Purchase actuals and reported availability can only be recorded by a Purchaser (Form 13) — you are signed in as %.', v_role;
  END IF;

  IF NEW.qty_fulfilled IS DISTINCT FROM OLD.qty_fulfilled
     AND NOT (v_is_admin OR v_role = 'PURCHASER') THEN
    RAISE EXCEPTION
      'Fulfilled quantity can only be recorded by a Purchaser saving a trip (Form 13) — you are signed in as %.', v_role;
  END IF;

  -- ── Rule 5: per-line delivery status ───────────────────────────────────────
  -- LEGITIMATE WRITERS: purchaserCompleteTrip() and reportItemAvailability()
  -- (PURCHASER), and requesterAvailabilityDecision() which stamps short lines
  -- UNAVAILABLE on CANCEL_REMAINING (the requester's department,
  -- purchaser-actions.ts:354). Form 6 was the fourth writer until 0020 retired it.
  IF NEW.item_delivery_status IS DISTINCT FROM OLD.item_delivery_status
     AND NOT (v_is_admin OR v_is_dept OR v_role = 'PURCHASER') THEN
    RAISE EXCEPTION
      'Line delivery status can only be updated by the Purchaser (Form 13) or the requesting department answering a shortfall (Form 9) — you are signed in as %.', v_role;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_line_item_fields ON mrs_line_items;
CREATE TRIGGER trg_guard_line_item_fields
BEFORE UPDATE ON mrs_line_items
FOR EACH ROW EXECUTE FUNCTION guard_line_item_fields();

-- ----------------------------------------------------------------------------
-- 5. material_requisitions — the columns 0016 left open
--
--    0016 protects the cash and gate inputs (Rules 1-9). Everything else on the
--    requisition was unprotected because, until now, RLS made the row reachable
--    only by the filer and by the five oversight roles. Section 1 above widens
--    reach to the whole department, so each remaining column group gets a named
--    owner here. BEFORE UPDATE over the whole row (not "UPDATE OF …"), for the
--    same reason 0016 gives: a lone PATCH of one column would otherwise slip
--    past every trigger.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_mrs_open_fields()
RETURNS TRIGGER AS $$
DECLARE
  v_role        user_role;
  v_is_admin    BOOLEAN;
BEGIN
  -- SQL Editor / service_role / reset & backfill scripts: trusted admin path.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_role := get_my_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION
      'Requisition % cannot be modified: your user has no role record in public.users (Rule 5).',
      NEW.mrs_number;
  END IF;

  v_is_admin := v_role = 'SUPER_ADMIN';

  -- ── Rule O1: the filed request is immutable after Form 5 ───────────────────
  -- No app flow UPDATEs any of these — createMRS() INSERTs them and there is no
  -- edit-MRS action (MRS_EDITABLE_STATUSES has no consumer in src/). Editing
  -- what was asked for, what it was estimated to cost, which department owns it
  -- or whether it bypassed approval as an Emergency Fast-Track would silently
  -- re-scope an already-approved requisition, so only a Super Admin correcting a
  -- filing error may touch them.
  IF (NEW.purpose                IS DISTINCT FROM OLD.purpose
   OR NEW.request_type           IS DISTINCT FROM OLD.request_type
   OR NEW.department_id          IS DISTINCT FROM OLD.department_id
   OR NEW.requester_id           IS DISTINCT FROM OLD.requester_id
   OR NEW.jo_id                  IS DISTINCT FROM OLD.jo_id
   OR NEW.mrs_number             IS DISTINCT FROM OLD.mrs_number
   OR NEW.total_estimated_cost   IS DISTINCT FROM OLD.total_estimated_cost
   OR NEW.est_shipping_fee       IS DISTINCT FROM OLD.est_shipping_fee
   OR NEW.is_online_purchase     IS DISTINCT FROM OLD.is_online_purchase
   OR NEW.online_supplier_url    IS DISTINCT FROM OLD.online_supplier_url
   OR NEW.online_tracking_number IS DISTINCT FROM OLD.online_tracking_number
   OR NEW.is_emergency_fast_track IS DISTINCT FROM OLD.is_emergency_fast_track
   OR NEW.fast_track_cap_amount  IS DISTINCT FROM OLD.fast_track_cap_amount)
     AND NOT v_is_admin THEN
    RAISE EXCEPTION
      'The filed details of % (purpose, estimates, online/COD flags, department, Emergency Fast-Track cap) are fixed once the requisition is submitted — no form rewrites them. Reject or void it and file a new one; only a Super Admin may amend it in place.',
      NEW.mrs_number;
  END IF;

  -- ── Rule O2: the Manager review stamps — Form 7 ────────────────────────────
  -- LEGITIMATE WRITER: managerReviewMRS() (MANAGER_REVIEW_ROLES = SUPER_ADMIN +
  -- MANAGER). Approving oneself into the canvass stage would skip Form 7.
  IF (NEW.manager_status            IS DISTINCT FROM OLD.manager_status
   OR NEW.manager_rejection_reason  IS DISTINCT FROM OLD.manager_rejection_reason
   OR NEW.manager_reviewed_at       IS DISTINCT FROM OLD.manager_reviewed_at)
     AND NOT (v_is_admin OR v_role = 'MANAGER') THEN
    RAISE EXCEPTION
      'The manager review on % can only be recorded by a Manager on Form 7 — you are signed in as %.',
      NEW.mrs_number, v_role;
  END IF;

  -- ── Rule O3: the Owner decision stamps — Form 8 ────────────────────────────
  -- LEGITIMATE WRITER: recordOwnerDecision() (OWNER_DECISION_ROLES =
  -- SUPER_ADMIN + BUDGET_OFFICER, who enters the off-platform Owner outcome).
  IF (NEW.owner_status            IS DISTINCT FROM OLD.owner_status
   OR NEW.owner_rejection_reason  IS DISTINCT FROM OLD.owner_rejection_reason
   OR NEW.owner_reviewed_at       IS DISTINCT FROM OLD.owner_reviewed_at)
     AND NOT (v_is_admin OR v_role = 'BUDGET_OFFICER') THEN
    RAISE EXCEPTION
      'The Owner decision on % can only be recorded by a Budget Officer on Form 8 — you are signed in as %.',
      NEW.mrs_number, v_role;
  END IF;

  -- ── Rule O4: the Emergency Fast-Track post-audit stamps — Plan §6.A step 3 ──
  -- LEGITIMATE WRITER: postAuditFastTrack() (FAST_TRACK_AUDIT_ROLES =
  -- SUPER_ADMIN + MANAGER + BUDGET_OFFICER). These two columns are the only
  -- evidence that the 24-hour post-audit happened, so they cannot be writable
  -- by the department that benefited from the bypass.
  IF (NEW.fast_track_audited_at IS DISTINCT FROM OLD.fast_track_audited_at
   OR NEW.fast_track_audited_by IS DISTINCT FROM OLD.fast_track_audited_by)
     AND NOT (v_is_admin OR v_role IN ('MANAGER', 'BUDGET_OFFICER')) THEN
    RAISE EXCEPTION
      'The Emergency Fast-Track post-audit on % can only be stamped by a Manager or Budget Officer (Plan §6.A step 3) — you are signed in as %.',
      NEW.mrs_number, v_role;
  END IF;

  -- ── Rule O5: the trip stamps added by 0018 and 0019 ────────────────────────
  -- LEGITIMATE WRITER: purchaserCompleteTrip() (SUPER_ADMIN + PURCHASER), in the
  -- same UPDATE as the actuals that 0016 Rule 1 already reserves to them.
  -- trip_completed_by is what Form 14 reads to refuse a self-sign-off (audit
  -- §A1c), so a department colleague who could rewrite it could erase the
  -- evidence and sign off a trip they executed. overspend_reason is the
  -- justification 0019 requires beside an over-ceiling spend; clearing it would
  -- leave the spend unexplained in Form 17.
  IF (NEW.trip_completed_by IS DISTINCT FROM OLD.trip_completed_by
   OR NEW.overspend_reason  IS DISTINCT FROM OLD.overspend_reason)
     AND NOT (v_is_admin OR v_role = 'PURCHASER') THEN
    RAISE EXCEPTION
      'The trip record on % (who executed it, and why it overspent) is written by the Purchaser saving the trip on Form 13 — you are signed in as %.',
      NEW.mrs_number, v_role;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_mrs_open_fields ON material_requisitions;
CREATE TRIGGER trg_guard_mrs_open_fields
BEFORE UPDATE ON material_requisitions
FOR EACH ROW EXECUTE FUNCTION guard_mrs_open_fields();

COMMENT ON FUNCTION guard_mrs_open_fields() IS
  '0020: owns the material_requisitions columns 0016 left open (the filed request, the Manager/Owner review stamps, the fast-track post-audit stamps, and 0018/0019''s trip stamps). Needed because 0020 widened mrs_select_safe/mrs_update_safe to the requester''s own department (audit §A5).';

