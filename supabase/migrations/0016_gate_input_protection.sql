-- ============================================================================
-- FixFlow ERP: 0016_gate_input_protection.sql
--
-- PHASE 1 of the remediation plan in agent_handoff.md §13.4 (audit of 2026-09-20).
--
-- ── ROOT CAUSE (finding A1 — CRITICAL) ───────────────────────────────────────
-- Every gate shipped in 0012–0015 fires on a STATUS column only:
--
--   trg_guard_mrs_status_transition    BEFORE UPDATE OF overall_status   (0013)
--   trg_guard_mrs_delivery_signoff     BEFORE UPDATE OF overall_status   (0014)
--   trg_guard_transmittal_receipt      BEFORE UPDATE OF receiver_status  (0013/0014)
--   trg_guard_cash_transmittal_sent    BEFORE UPDATE OF sender_status    (0015)
--   trg_guard_cash_transmittal_insert  BEFORE INSERT                     (0015)
--   trg_guard_fd_cod_disbursement      BEFORE INSERT                     (0015)
--
-- The VALUES those gates read were left unprotected, and the RLS policies
-- inherited from 0005 are column-blind (`mrs_update_safe`,
-- `transmittal_update_safe`) or command-blind (`Line items write follows
-- parent MRS` is FOR ALL, so it grants DELETE too). A user whom a gate is
-- meant to constrain can therefore rewrite the gate's own inputs with a direct
-- PostgREST PATCH from the browser console — no UI involved:
--
--   spare_change_required  → 0                 defeats Gate B (0013)
--   requester_verification → 'VERIFIED'        defeats Gate C (0014)
--   transmittal_forms.mrs_id → NULL            row leaves guard_transmittal_receipt
--   transmittal_forms.transmittal_type → 'SPARE_CHANGE_RETURN'
--                                              same exemption, same effect
--   transmittal_forms.amount → any value       mutable by its own receiver
--   total_actual_spent / allocated_budget / mrs_line_items.*
--                                              falsifies the spend ledger that
--                                              Form 14 and Form 17 compute from
--
-- ALSO CLOSES:
--   B3 — `fdReplenishFloat` had no amount validation at ANY layer: no check in
--        the action, no CHECK on the column, and 0015's insert trigger explicitly
--        exempts FD_REVOLVING_REPLENISHMENT. A negative or absurd replenishment
--        posted straight to the float ledger.
--   C3 — §12.3's outstanding recommendation: `requester_verification` had no
--        CHECK constraint.
--
-- ── DESIGN DECISION: triggers, not column-level privileges ───────────────────
-- Column GRANTs were the first idea (§13.4 as written), but they only bind a
-- role that lacks a TABLE-level UPDATE grant. Supabase grants table-level ALL to
-- both `authenticated` and `service_role`, so column grants would (a) require
-- revoking table-level UPDATE and re-enumerating every column the app writes —
-- one omission breaks production — and (b) still not bind `service_role`.
-- BEFORE UPDATE triggers fire for EVERY role including service_role, express
-- "who may write what" rather than "who may write this column", and can raise
-- the same actionable messages the app gates use. Strictly stronger here.
--
-- ── GUARANTEES ───────────────────────────────────────────────────────────────
--   · Does NOT redefine guard_transmittal_receipt(), guard_mrs_status_transition(),
--     guard_mrs_delivery_signoff(), or any 0015 function. New functions and new
--     trigger names only, so 0016 cannot clobber Gates B/C and re-running 0013
--     cannot clobber 0016 (the §10.7 ordering hazard is unchanged, not widened).
--   · Idempotent: DROP TRIGGER IF EXISTS / CREATE OR REPLACE / constraint
--     existence checks throughout — safe to re-run.
--   · `auth.uid() IS NULL` (SQL Editor, service_role, scripts/reset_test_data.sql,
--     backfills) is a trusted administrative path and is waved through, so the
--     owner can still repair data and reset test data.
--   · Every legitimate app writer was traced before these rules were written
--     (see the "LEGITIMATE WRITER" comment on each rule). Rules are scoped to the
--     role that the route-level RBAC in src/lib/access-control.ts already admits,
--     so no UI flow can regress.
--
-- REQUIRES: 0013 (spare-change columns + mrs_disbursed_total) and 0014 applied.
--           Apply AFTER 0015. Companion: 0016_verify.sql (read-only).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Prerequisites — fail fast with a clear message rather than half-applying
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'material_requisitions'
       AND column_name  = 'spare_change_required'
  ) THEN
    RAISE EXCEPTION
      '0016 requires migration 0013 (spare_change_required / spare_change_returned). Apply 0013 and 0014 first, then re-run 0016.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'material_requisitions'
       AND column_name  = 'requester_decision'
  ) THEN
    RAISE EXCEPTION
      '0016 requires migration 0013 (requester_decision / availability_hold). Apply 0013 first, then re-run 0016.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'mrs_disbursed_total'
  ) THEN
    RAISE EXCEPTION
      '0016 requires the mrs_disbursed_total() helper from migration 0013. Apply 0013 first, then re-run 0016.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Actor helpers (mirror the SECURITY DEFINER pattern of get_my_role(), 0005)
--
--    SECURITY DEFINER + fixed search_path: a trigger body that queried `users`
--    as the invoking role would be subject to users_select_safe, and a query on
--    material_requisitions from the line-item trigger would be subject to
--    mrs_select_safe — both would make the guard's verdict depend on RLS
--    visibility instead of on the rule. Defining them once, definer-side, keeps
--    the verdict deterministic. Rule 4 (no recursive users subquery in a policy)
--    is respected: these are functions, not policies.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_my_department_id()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT department_id FROM public.users WHERE id = auth.uid()
$$;

/** Department a requisition belongs to — the Form 9 / Form 14 authority scope. */
CREATE OR REPLACE FUNCTION mrs_department_of(p_mrs_id INT)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT department_id FROM public.material_requisitions WHERE id = p_mrs_id
$$;

GRANT EXECUTE ON FUNCTION get_my_department_id()   TO authenticated;
GRANT EXECUTE ON FUNCTION mrs_department_of(INT)   TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. CHECK constraints (B3, C3, and non-negative cash fields)
--
--    Added through DO blocks so pre-existing dirty data cannot make the
--    migration fail half-applied: with violations present the constraint is
--    added NOT VALID (every NEW/UPDATED row is still checked) and the owner is
--    told exactly how to finish the job once the rows are repaired.
-- ----------------------------------------------------------------------------

-- (a) transmittal_forms.amount must be positive — closes B3 at the schema level
--     for every transmittal type, including the FD legs 0015 exempts.
DO $$
DECLARE v_bad INT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tr_amount_positive') THEN
    RAISE NOTICE '0016: chk_tr_amount_positive already present — skipped.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_bad FROM transmittal_forms WHERE NOT (amount > 0);

  IF v_bad = 0 THEN
    ALTER TABLE transmittal_forms
      ADD CONSTRAINT chk_tr_amount_positive CHECK (amount > 0);
    RAISE NOTICE '0016: chk_tr_amount_positive added and validated (0 legacy violations).';
  ELSE
    ALTER TABLE transmittal_forms
      ADD CONSTRAINT chk_tr_amount_positive CHECK (amount > 0) NOT VALID;
    RAISE WARNING
      '0016: % legacy transmittal row(s) have amount <= 0. Constraint added NOT VALID — new and updated rows are blocked, legacy rows are untouched. Repair them, then run: ALTER TABLE transmittal_forms VALIDATE CONSTRAINT chk_tr_amount_positive;',
      v_bad;
  END IF;
END $$;

-- (b) requester_verification is a closed vocabulary (§12.3 recommendation).
--     NULL is permitted: the column defaults to 'PENDING_DELIVERY' but legacy
--     rows may predate it, and the guards already treat NULL as unverified.
DO $$
DECLARE v_bad INT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mrs_requester_verification_values') THEN
    RAISE NOTICE '0016: chk_mrs_requester_verification_values already present — skipped.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_bad
    FROM material_requisitions
   WHERE requester_verification IS NOT NULL
     AND requester_verification NOT IN ('PENDING_DELIVERY', 'VERIFIED', 'DISPUTED');

  IF v_bad = 0 THEN
    ALTER TABLE material_requisitions
      ADD CONSTRAINT chk_mrs_requester_verification_values
      CHECK (requester_verification IS NULL
             OR requester_verification IN ('PENDING_DELIVERY', 'VERIFIED', 'DISPUTED'));
    RAISE NOTICE '0016: chk_mrs_requester_verification_values added and validated.';
  ELSE
    ALTER TABLE material_requisitions
      ADD CONSTRAINT chk_mrs_requester_verification_values
      CHECK (requester_verification IS NULL
             OR requester_verification IN ('PENDING_DELIVERY', 'VERIFIED', 'DISPUTED')) NOT VALID;
    RAISE WARNING
      '0016: % requisition(s) carry an out-of-vocabulary requester_verification. Constraint added NOT VALID; repair then run: ALTER TABLE material_requisitions VALIDATE CONSTRAINT chk_mrs_requester_verification_values;',
      v_bad;
  END IF;
END $$;

-- (c) Cash figures can never be negative. A negative `spare_change_required`
--     would satisfy Gate B's `required - returned > 0.01` test for free; a
--     negative `spare_change_returned` would inflate the outstanding balance and
--     corrupt Form 17's net-disbursed maths.
DO $$
DECLARE v_bad INT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mrs_cash_figures_non_negative') THEN
    RAISE NOTICE '0016: chk_mrs_cash_figures_non_negative already present — skipped.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_bad
    FROM material_requisitions
   WHERE COALESCE(spare_change_required, 0) < 0
      OR COALESCE(spare_change_returned, 0) < 0
      OR COALESCE(spare_change_amount, 0)   < 0
      OR COALESCE(total_actual_spent, 0)    < 0
      OR COALESCE(allocated_budget, 0)      < 0;

  IF v_bad = 0 THEN
    ALTER TABLE material_requisitions
      ADD CONSTRAINT chk_mrs_cash_figures_non_negative
      CHECK (COALESCE(spare_change_required, 0) >= 0
         AND COALESCE(spare_change_returned, 0) >= 0
         AND COALESCE(spare_change_amount, 0)   >= 0
         AND COALESCE(total_actual_spent, 0)    >= 0
         AND COALESCE(allocated_budget, 0)      >= 0);
    RAISE NOTICE '0016: chk_mrs_cash_figures_non_negative added and validated.';
  ELSE
    ALTER TABLE material_requisitions
      ADD CONSTRAINT chk_mrs_cash_figures_non_negative
      CHECK (COALESCE(spare_change_required, 0) >= 0
         AND COALESCE(spare_change_returned, 0) >= 0
         AND COALESCE(spare_change_amount, 0)   >= 0
         AND COALESCE(total_actual_spent, 0)    >= 0
         AND COALESCE(allocated_budget, 0)      >= 0) NOT VALID;
    RAISE WARNING
      '0016: % requisition(s) carry a negative cash figure. Constraint added NOT VALID; repair then run: ALTER TABLE material_requisitions VALIDATE CONSTRAINT chk_mrs_cash_figures_non_negative;',
      v_bad;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. material_requisitions — who may write the gate inputs
--
--    BEFORE UPDATE (all columns, deliberately NOT "UPDATE OF …": a lone
--    `spare_change_required = 0` PATCH changes no status column and would slip
--    past every 0012–0015 trigger. Comparing OLD/NEW per field catches it.)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_mrs_financial_fields()
RETURNS TRIGGER AS $$
DECLARE
  v_role        user_role;
  v_dept        INT;
  v_mrs_dept    INT;
  v_is_admin    BOOLEAN;
  v_is_dept     BOOLEAN;
  v_expected    DECIMAL(10,2);
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

  v_dept     := get_my_department_id();
  v_mrs_dept := OLD.department_id;
  v_is_admin := v_role = 'SUPER_ADMIN';
  v_is_dept  := v_dept IS NOT NULL AND v_mrs_dept IS NOT NULL AND v_dept = v_mrs_dept;

  -- ── Rule 1: purchase actuals — Form 13 only ───────────────────────────────
  -- LEGITIMATE WRITER: purchaserCompleteTrip() (PURCHASER / SUPER_ADMIN,
  -- role-checked at purchaser-actions.ts:406). This is the figure Gate B's
  -- `required = disbursed − spent` is derived from, so a requester who could
  -- inflate it would zero their own spare-change debt.
  IF (NEW.total_actual_spent     IS DISTINCT FROM OLD.total_actual_spent
   OR NEW.actual_shipping_fee    IS DISTINCT FROM OLD.actual_shipping_fee
   OR NEW.budget_variance_amount IS DISTINCT FROM OLD.budget_variance_amount)
     AND NOT (v_is_admin OR v_role = 'PURCHASER') THEN
    RAISE EXCEPTION
      'Purchase actuals on % can only be recorded by a Purchaser saving a trip (Form 13) — you are signed in as %.',
      NEW.mrs_number, v_role;
  END IF;

  -- ── Rule 2: spare_change_amount — Form 13 (variance) or Form 11 (received) ─
  -- LEGITIMATE WRITERS: purchaserCompleteTrip() (PURCHASER) and
  -- verifyCashAndMarkReceivedImpl() (ACCOUNTING, role-checked at
  -- transmittal-actions.ts:428).
  IF NEW.spare_change_amount IS DISTINCT FROM OLD.spare_change_amount
     AND NOT (v_is_admin OR v_role IN ('PURCHASER', 'ACCOUNTING')) THEN
    RAISE EXCEPTION
      'The spare-change figure on % can only be written by a Purchaser (Form 13) or Accounting (Form 11) — you are signed in as %.',
      NEW.mrs_number, v_role;
  END IF;

  -- ── Rule 3: spare_change_returned — Accounting only, and never reduced ─────
  -- LEGITIMATE WRITER: verifyCashAndMarkReceivedImpl() (ACCOUNTING / SUPER_ADMIN).
  -- Written in the SAME statement as overall_status='CLOSED' (§10.6 write order),
  -- which is why this fires together with the status guards rather than before them.
  IF NEW.spare_change_returned IS DISTINCT FROM OLD.spare_change_returned THEN
    IF NOT (v_is_admin OR v_role = 'ACCOUNTING') THEN
      RAISE EXCEPTION
        'Returned spare change on % can only be recorded by Accounting (Form 11) — you are signed in as %.',
        NEW.mrs_number, v_role;
    END IF;
    -- Cash that has been handed back cannot be un-handed-back. Only a Super
    -- Admin may correct a genuine keying error.
    IF NEW.spare_change_returned < OLD.spare_change_returned - 0.01 AND NOT v_is_admin THEN
      RAISE EXCEPTION
        'Returned spare change on % cannot be reduced from % to %. Recorded returns are cumulative; ask a Super Admin if this is a keying error.',
        NEW.mrs_number, OLD.spare_change_returned, NEW.spare_change_returned;
    END IF;
  END IF;

  -- ── Rule 4: spare_change_required — the Gate B debt ───────────────────────
  -- LEGITIMATE WRITER: verifyDeliveryRequester() (Form 14 — the requester's own
  -- department, or SUPER_ADMIN; department-checked at purchaser-actions.ts:672).
  --
  -- The department actor must write the COMPUTED value, not a chosen one:
  --   required = GREATEST(mrs_disbursed_total(mrs) − total_actual_spent, 0)
  -- which is exactly what Form 14 sends (purchaser-actions.ts:688-691, using the
  -- same SECURITY DEFINER helper). This is what makes Gate C self-sign-off safe:
  -- a requester may confirm their own delivery (that is their job) but cannot
  -- confirm it AND erase the debt in the same breath.
  -- ACCOUNTING / SUPER_ADMIN may set it freely to correct a mis-stamped figure.
  IF NEW.spare_change_required IS DISTINCT FROM OLD.spare_change_required THEN
    IF v_is_admin OR v_role = 'ACCOUNTING' THEN
      NULL; -- privileged correction
    ELSIF NOT v_is_dept THEN
      RAISE EXCEPTION
        'Spare change required on % can only be stamped by the requesting department at delivery sign-off (Form 14), or corrected by Accounting — you are signed in as %.',
        NEW.mrs_number, v_role;
    ELSE
      v_expected := GREATEST(
        COALESCE(mrs_disbursed_total(NEW.id), 0) - COALESCE(NEW.total_actual_spent, 0),
        0
      )::DECIMAL(10,2);

      IF ABS(NEW.spare_change_required - v_expected) > 0.01 THEN
        RAISE EXCEPTION
          'Spare change required on % must equal cash disbursed minus cash spent (% − % = %), not %. Form 14 computes this automatically; it cannot be entered by hand.',
          NEW.mrs_number,
          COALESCE(mrs_disbursed_total(NEW.id), 0),
          COALESCE(NEW.total_actual_spent, 0),
          v_expected,
          NEW.spare_change_required;
      END IF;
    END IF;
  END IF;

  -- ── Rule 5: requester_verification — the Gate C switch ────────────────────
  -- LEGITIMATE WRITER: verifyDeliveryRequester() (Form 14 — requester's
  -- department or SUPER_ADMIN). Everything except 'VERIFIED' counts as
  -- unverified, so this column IS Gate C; writing it is signing off a delivery.
  IF (NEW.requester_verification IS DISTINCT FROM OLD.requester_verification
   OR NEW.verification_notes     IS DISTINCT FROM OLD.verification_notes
   OR NEW.verified_at            IS DISTINCT FROM OLD.verified_at)
     AND NOT (v_is_admin OR v_is_dept) THEN
    RAISE EXCEPTION
      'Delivery sign-off on % belongs to the requesting department (Form 14). You are signed in as % — ask a colleague from that department, or a Super Admin.',
      NEW.mrs_number, v_role;
  END IF;

  -- ── Rule 6: allocated_budget — the cash ceiling ───────────────────────────
  -- LEGITIMATE WRITERS: recordCanvassPricing() (Form 8) and recordOwnerDecision()
  -- (Owner decision logged off-platform). Both live on /mrs/canvass, which
  -- access-control.ts restricts to SUPER_ADMIN + BUDGET_OFFICER. This is the
  -- outlay ceiling createTransmittal() validates cash against, so whoever sets
  -- it decides how much cash may be issued.
  IF NEW.allocated_budget IS DISTINCT FROM OLD.allocated_budget
     AND NOT (v_is_admin OR v_role = 'BUDGET_OFFICER') THEN
    RAISE EXCEPTION
      'The allocated budget on % can only be set by a Budget Officer canvassing or logging the Owner decision (Forms 8 / Owner) — you are signed in as %.',
      NEW.mrs_number, v_role;
  END IF;

  -- ── Rule 7: availability_hold — the Gate A freeze ─────────────────────────
  -- LEGITIMATE WRITERS: reportItemAvailability() raises the hold (PURCHASER);
  -- requesterAvailabilityDecision() releases it (the requester's department, or
  -- keeps it raised for WAIT_FULL). Releasing is the department's call alone —
  -- a purchaser who could clear their own hold would defeat Gate A without the
  -- requester ever deciding.
  IF OLD.availability_hold IS NOT TRUE AND NEW.availability_hold IS TRUE
     AND NOT (v_is_admin OR v_role = 'PURCHASER' OR v_is_dept) THEN
    RAISE EXCEPTION
      'An availability hold on % can only be raised by the Purchaser reporting a shortfall (Form 13) — you are signed in as %.',
      NEW.mrs_number, v_role;
  END IF;

  IF OLD.availability_hold IS TRUE AND NEW.availability_hold IS NOT TRUE
     AND NOT (v_is_admin OR v_is_dept) THEN
    RAISE EXCEPTION
      'The availability hold on % can only be released by the requesting department answering the shortfall (Form 9) — the Purchaser may not lift their own hold.',
      NEW.mrs_number;
  END IF;

  -- ── Rule 8: requester_decision — the Gate A answer ────────────────────────
  -- LEGITIMATE WRITERS: reportItemAvailability() sets 'PENDING' (PURCHASER) when
  -- it raises the hold; requesterAvailabilityDecision() records the real answer
  -- (the requester's department). Splitting the two is what stops the purchaser
  -- from answering on the requester's behalf.
  IF NEW.requester_decision IS DISTINCT FROM OLD.requester_decision THEN
    IF v_is_admin OR v_is_dept THEN
      NULL; -- Form 9 — the requester's own decision
    ELSIF v_role = 'PURCHASER' AND NEW.requester_decision = 'PENDING' THEN
      NULL; -- Form 13 — raising the hold always parks the decision at PENDING
    ELSE
      RAISE EXCEPTION
        'The availability decision on % belongs to the requesting department (Form 9). A Purchaser may only open the question (PENDING), never answer it — you are signed in as %.',
        NEW.mrs_number, v_role;
    END IF;
  END IF;

  -- ── Rule 9: FD float flags — Form 12 only ─────────────────────────────────
  -- LEGITIMATE WRITER: fdCodDisbursement() (FRONT_DESK / SUPER_ADMIN,
  -- role-checked at transmittal-actions.ts:714). §12.4 L8 already flags the
  -- semantics of this write; until that follow-up lands, only Front Desk may make it.
  IF (NEW.delivery_status       IS DISTINCT FROM OLD.delivery_status
   OR NEW.revolving_fund_used   IS DISTINCT FROM OLD.revolving_fund_used)
     AND NOT (v_is_admin OR v_role = 'FRONT_DESK') THEN
    RAISE EXCEPTION
      'The delivery/revolving-float flags on % are written by Front Desk processing a COD advance (Form 12) — you are signed in as %.',
      NEW.mrs_number, v_role;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_mrs_financial_fields ON material_requisitions;
CREATE TRIGGER trg_guard_mrs_financial_fields
BEFORE UPDATE ON material_requisitions
FOR EACH ROW EXECUTE FUNCTION guard_mrs_financial_fields();

-- ----------------------------------------------------------------------------
-- 4. transmittal_forms — identity and amount are immutable; status writes are
--    role-scoped.
--
--    guard_transmittal_receipt() (0013/0014) decides WHETHER a receipt may
--    happen; this decides WHO may write the ledger row at all. It deliberately
--    does not touch receiver_status semantics, so Gates B and C are untouched.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_transmittal_fields()
RETURNS TRIGGER AS $$
DECLARE
  v_role     user_role;
  v_is_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;  -- SQL Editor / service_role / cascade maintenance
  END IF;

  v_role := get_my_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION
      'Transmittal % cannot be modified: your user has no role record in public.users (Rule 5).',
      NEW.transmittal_number;
  END IF;
  v_is_admin := v_role = 'SUPER_ADMIN';

  -- ── Rule 1: the amount is the ledger entry — immutable after creation ──────
  -- No app flow updates it (createTransmittal / createBatchTransmittal /
  -- fdCodDisbursement / fdReplenishFloat all INSERT). `transmittal_update_safe`
  -- lets the RECEIVER update the row, so without this the recipient of cash
  -- could rewrite how much they were handed.
  IF NEW.amount IS DISTINCT FROM OLD.amount AND NOT v_is_admin THEN
    RAISE EXCEPTION
      'The amount on transmittal % is immutable once created (%). Void and re-issue it if the figure is wrong; only a Super Admin may amend it in place.',
      NEW.transmittal_number, OLD.amount;
  END IF;

  -- ── Rule 2: the requisition link is what Gates B and C hang from ───────────
  -- guard_transmittal_receipt() returns early when `NEW.mrs_id IS NULL`, so
  -- detaching a transmittal silently exempts it from both gates.
  IF NEW.mrs_id IS DISTINCT FROM OLD.mrs_id AND NOT v_is_admin THEN
    RAISE EXCEPTION
      'Transmittal % cannot be re-pointed at another requisition (or detached from its requisition) — that would remove it from the spare-change and delivery sign-off gates. Void and re-issue it instead.',
      NEW.transmittal_number;
  END IF;

  -- ── Rule 3: the type selects the gate exemptions ───────────────────────────
  -- guard_transmittal_receipt() exempts SPARE_CHANGE_RETURN, and
  -- mrs_disbursed_total() excludes it from the disbursed total, so re-typing a
  -- disbursement as a return both exempts it from the gates and erases it from
  -- the debt calculation.
  IF NEW.transmittal_type IS DISTINCT FROM OLD.transmittal_type AND NOT v_is_admin THEN
    RAISE EXCEPTION
      'The type of transmittal % is immutable (%): re-typing it would change which cash-chain gates apply to it. Void and re-issue it instead.',
      NEW.transmittal_number, OLD.transmittal_type;
  END IF;

  -- ── Rule 4: the two parties are the chain of custody (Rule 3 of the handoff) ─
  IF (NEW.sender_user_id   IS DISTINCT FROM OLD.sender_user_id
   OR NEW.receiver_user_id IS DISTINCT FROM OLD.receiver_user_id) AND NOT v_is_admin THEN
    RAISE EXCEPTION
      'The sender/receiver on transmittal % cannot be changed after creation — the chain of custody records who handed cash to whom. Void and re-issue it instead.',
      NEW.transmittal_number;
  END IF;

  -- ── Rule 5: the courier barcode is the COD paper trail ─────────────────────
  -- LEGITIMATE WRITER: fdCodDisbursement() sets it at INSERT; Front Desk may
  -- correct a mis-scan afterwards.
  IF NEW.courier_tracking_barcode IS DISTINCT FROM OLD.courier_tracking_barcode
     AND NOT (v_is_admin OR v_role = 'FRONT_DESK') THEN
    RAISE EXCEPTION
      'The courier tracking barcode on transmittal % can only be corrected by Front Desk (Form 12) — you are signed in as %.',
      NEW.transmittal_number, v_role;
  END IF;

  -- ── Rule 6: marking SENT is Accounting's disbursement (Form 11) ────────────
  -- LEGITIMATE WRITER: disburseCashAndMarkSent() (ACCOUNTING / SUPER_ADMIN,
  -- role-checked at transmittal-actions.ts:316). The FD legs are created already
  -- SENT by an INSERT, so this never fires for Form 12.
  -- CANCELLED is deliberately NOT restricted: cascade_jo_cancellation()
  -- (0004/0011) cancels transmittals as the JO-cancelling user, who may be a
  -- MANAGER, a technician, or the requester.
  IF NEW.sender_status = 'SENT'
     AND OLD.sender_status IS DISTINCT FROM NEW.sender_status
     AND NOT (v_is_admin OR v_role = 'ACCOUNTING') THEN
    RAISE EXCEPTION
      'Transmittal % can only be marked SENT by Accounting disbursing the cash (Form 11) — you are signed in as %.',
      NEW.transmittal_number, v_role;
  END IF;

  -- ── Rule 7: marking RECEIVED is Accounting's reconciliation (Form 11) ──────
  -- LEGITIMATE WRITER: verifyCashAndMarkReceivedImpl() (ACCOUNTING / SUPER_ADMIN).
  -- WHEN Phase 5 adds the Front Desk acknowledgement leg for the FD float
  -- (finding B4), FRONT_DESK must be added here for the FD transmittal types.
  IF NEW.receiver_status = 'RECEIVED'
     AND OLD.receiver_status IS DISTINCT FROM NEW.receiver_status
     AND NOT (v_is_admin OR v_role = 'ACCOUNTING') THEN
    RAISE EXCEPTION
      'Transmittal % can only be marked RECEIVED by Accounting verifying the cash (Form 11) — you are signed in as %.',
      NEW.transmittal_number, v_role;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_transmittal_fields ON transmittal_forms;
CREATE TRIGGER trg_guard_transmittal_fields
BEFORE UPDATE ON transmittal_forms
FOR EACH ROW EXECUTE FUNCTION guard_transmittal_fields();

-- ----------------------------------------------------------------------------
-- 5. mrs_line_items — the spend ledger Form 17 and the README's actual-spent
--    formula are computed from:
--      Total MRS Spent = Σ (actual_unit_price × qty_fulfilled) + actual_shipping_fee
--
--    `Line items write follows parent MRS` (0002) is FOR ALL, so today any user
--    who can SEE a requisition can rewrite or delete its line items.
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

  -- ── Rule 3: warehouse issuance — Storekeeper (Form 6) ──────────────────────
  -- LEGITIMATE WRITER: issueStockFormSK() on /mrs/stock-check
  -- (SUPER_ADMIN + STOREKEEPER per access-control.ts). It writes both
  -- qty_issued_from_stock and qty_fulfilled.
  IF NEW.qty_issued_from_stock IS DISTINCT FROM OLD.qty_issued_from_stock
     AND NOT (v_is_admin OR v_role = 'STOREKEEPER') THEN
    RAISE EXCEPTION
      'Stock issued from the warehouse can only be recorded by a Storekeeper (Form 6) — you are signed in as %.', v_role;
  END IF;

  -- ── Rule 4: purchase actuals — Purchaser (Form 13) ─────────────────────────
  -- LEGITIMATE WRITER: purchaserCompleteTrip() on /purchaser/queue
  -- (SUPER_ADMIN + PURCHASER). qty_fulfilled is shared with Rule 3 because
  -- Form 6 also stamps it (0011: qty_fulfilled = stock issued + purchased).
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
     AND NOT (v_is_admin OR v_role IN ('PURCHASER', 'STOREKEEPER')) THEN
    RAISE EXCEPTION
      'Fulfilled quantity can only be recorded by a Purchaser (Form 13) or a Storekeeper issuing stock (Form 6) — you are signed in as %.', v_role;
  END IF;

  -- ── Rule 5: per-line delivery status ───────────────────────────────────────
  -- LEGITIMATE WRITERS: purchaserCompleteTrip() and reportItemAvailability()
  -- (PURCHASER), issueStockFormSK() (STOREKEEPER), and
  -- requesterAvailabilityDecision() which stamps short lines UNAVAILABLE on
  -- CANCEL_REMAINING (the requester's department, purchaser-actions.ts:354).
  IF NEW.item_delivery_status IS DISTINCT FROM OLD.item_delivery_status
     AND NOT (v_is_admin OR v_is_dept OR v_role IN ('PURCHASER', 'STOREKEEPER')) THEN
    RAISE EXCEPTION
      'Line delivery status can only be updated by the Purchaser (Form 13), the Storekeeper (Form 6), or the requesting department answering a shortfall (Form 9) — you are signed in as %.', v_role;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_line_item_fields ON mrs_line_items;
CREATE TRIGGER trg_guard_line_item_fields
BEFORE UPDATE ON mrs_line_items
FOR EACH ROW EXECUTE FUNCTION guard_line_item_fields();

-- No app flow deletes a requisition line, and 0002's FOR ALL policy permits it.
-- Deleting lines is how a spent record disappears from Form 17.
CREATE OR REPLACE FUNCTION guard_line_item_delete()
RETURNS TRIGGER AS $$
DECLARE
  v_role user_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN OLD;  -- reset_test_data.sql / cascade maintenance
  END IF;

  v_role := get_my_role();
  IF v_role IS NULL OR v_role <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION
      'Requisition lines cannot be deleted — the purchase record is the audit trail for what was spent. Void the requisition instead, or ask a Super Admin.';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_line_item_delete ON mrs_line_items;
CREATE TRIGGER trg_guard_line_item_delete
BEFORE DELETE ON mrs_line_items
FOR EACH ROW EXECUTE FUNCTION guard_line_item_delete();

-- ----------------------------------------------------------------------------
-- 6. Done. Run 0016_verify.sql (read-only) to confirm every guard is live and
--    that 0013/0014/0015 were not disturbed.
-- ----------------------------------------------------------------------------
