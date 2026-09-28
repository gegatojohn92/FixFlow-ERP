-- ============================================================================
-- FixFlow ERP: 0017_fix_jo_cancellation_cascade.sql
--
-- Rule 3 of agent_handoff.md: "A canceled Job Order that already has cash
-- disbursed triggers an automated SPARE_CHANGE_RETURN transmittal for 100% of
-- the disbursed amount." Two independent defects in `cascade_jo_cancellation()`
-- meant that promise had NOT been kept. Both were found by running the 0016
-- guard suite against a real PostgreSQL instance (not by reading the code).
--
-- ── DEFECT 1 — the reference-number call could not resolve (0011 regression) ─
--   0004 declared an intermediate variable, and the call resolved:
--       v_year INT := EXTRACT(YEAR FROM CURRENT_DATE);
--       next_reference_number('TR', v_year)            -- INT matches (VARCHAR, INT)
--   0011 re-declared the function and inlined the expression, dropping the INT:
--       next_reference_number('TR', EXTRACT(YEAR FROM CURRENT_DATE))
--   EXTRACT() has returned NUMERIC since PostgreSQL 14, and numeric -> integer is
--   an ASSIGNMENT cast, not an IMPLICIT one, so it is not applied during function
--   resolution. The call fails at RUNTIME:
--       function next_reference_number(unknown, numeric) does not exist
--   `on_jo_cancelled` is an AFTER UPDATE trigger, so the exception aborts the
--   statement that fired it: the cancellation, the MRS void (4a) and the
--   cancel-pending step (4c) all rolled back. A SUPER_ADMIN — the one role that
--   can SEE the transmittals, and therefore the only one for whom the branch
--   produced a row to evaluate — could not cancel such a Job Order at all.
--
-- ── DEFECT 2 — the cascade is RLS-blind, so it silently minted nothing ──────
--   The function was NOT SECURITY DEFINER, so step 4b's `INSERT … SELECT FROM
--   transmittal_forms` ran with the CANCELLING USER's RLS. `transmittal_select_safe`
--   (0005) admits only the sender, the receiver, and
--   SUPER_ADMIN / ACCOUNTING / BUDGET_OFFICER / FRONT_DESK / PURCHASER.
--   A MANAGER, a technician, or the requester — the roles that actually cancel
--   Job Orders on Form 2 — see ZERO transmittal rows, so the SELECT returned no
--   rows and the INSERT wrote nothing. No error, no log, no return transmittal.
--   Verified: as MANAGER, the cancel succeeded and the MRS was VOIDED, but
--   `SPARE_CHANGE_RETURN` was never created — the cash already handed out was
--   never formally called back. Defect 2 also masked Defect 1 for those roles
--   (an empty SELECT never evaluates the broken call), which is why the failure
--   was invisible: the only role that hit Defect 1 was SUPER_ADMIN.
--
-- ── FIX ──────────────────────────────────────────────────────────────────────
--   1. `::INT` on the EXTRACT argument (restores what 0004 had).
--   2. `SECURITY DEFINER SET search_path = public` so the cascade sees the whole
--      schema regardless of who cancels — the same sanctioned pattern as
--      `get_my_role()` (0005) and `mrs_disbursed_total()` (0013). The fixed
--      search_path is required for a definer function; `auth.uid()` still
--      resolves to the cancelling user, so `cancelled_by` and the audit trail
--      keep recording the real actor.
--
--   The body below is 0011's function VERBATIM except those two changes — it was
--   extracted from 0011_jo_mrs_flow_enhancements.sql programmatically, not
--   retyped, so no branch of the cascade (4a void, 4b spare-change return + its
--   NOT EXISTS de-duplication, 4c cancel-pending) can have been lost in
--   transcription. That is the §10.7 hazard class, handled deliberately.
--
--   0016's guards are unaffected: the cascade writes only `overall_status`
--   (no 0016-protected column), INSERTs the return transmittal (0016's
--   transmittal guard is BEFORE UPDATE, and 0015's insert gate exempts
--   SPARE_CHANGE_RETURN), and sets statuses to 'CANCELLED' — which 0016
--   deliberately does not restrict, precisely so this cascade keeps working.
--
-- ⚠️ ORDERING: 0011 also re-declares this function. If 0011 is ever re-applied it
--    reintroduces BOTH defects — re-run 0017 afterwards. `0017_verify.sql`
--    checks 1-2 detect exactly this.
--
-- Idempotent (CREATE OR REPLACE + DROP TRIGGER IF EXISTS). Apply AFTER 0016.
-- Does not touch guard_transmittal_receipt(), guard_mrs_status_transition(),
-- guard_mrs_delivery_signoff(), any 0015 gate, or any 0016 guard.
-- ============================================================================

CREATE OR REPLACE FUNCTION cascade_jo_cancellation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'CANCELLED' AND OLD.status != 'CANCELLED' THEN
    -- Audit metadata (action layer may set these first; fill gaps here)
    IF NEW.cancelled_at IS NULL THEN
      NEW.cancelled_at := now();
    END IF;
    IF NEW.cancelled_by IS NULL THEN
      NEW.cancelled_by := auth.uid();
    END IF;

    -- 4a. Void linked MRS if not fulfilled or closed
    UPDATE material_requisitions
    SET overall_status = 'VOIDED'
    WHERE jo_id = NEW.id AND overall_status NOT IN ('FULFILLED', 'CLOSED');

    -- 4b. Auto-generate SPARE_CHANGE_RETURN for disbursed cash
    INSERT INTO transmittal_forms (
      transmittal_number, mrs_id, transmittal_type, amount,
      sender_user_id, sender_status, receiver_user_id, receiver_status, notes
    )
    SELECT
      next_reference_number('TR', EXTRACT(YEAR FROM CURRENT_DATE)::INT),
      t.mrs_id,
      'SPARE_CHANGE_RETURN',
      t.amount,
      t.receiver_user_id,  -- party holding the cash must return it
      'PENDING',
      t.sender_user_id,
      'PENDING',
      'Auto-generated by JO ' || NEW.jo_number || ' cancellation: return 100% of disbursed amount from ' || t.transmittal_number
    FROM transmittal_forms t
    WHERE t.mrs_id IN (SELECT id FROM material_requisitions WHERE jo_id = NEW.id)
      AND (t.sender_status = 'SENT' OR t.receiver_status = 'RECEIVED')
      AND NOT EXISTS (
        SELECT 1 FROM transmittal_forms r
        WHERE r.transmittal_type = 'SPARE_CHANGE_RETURN'
          AND r.mrs_id = t.mrs_id
          AND r.notes LIKE 'Auto-generated by JO ' || NEW.jo_number || ' cancellation:%'
      );

    -- 4c. Cancel transmittals that were never disbursed
    UPDATE transmittal_forms
    SET sender_status = 'CANCELLED', receiver_status = 'CANCELLED'
    WHERE mrs_id IN (SELECT id FROM material_requisitions WHERE jo_id = NEW.id)
      AND sender_status = 'PENDING'
      AND receiver_status = 'PENDING'
      AND transmittal_type <> 'SPARE_CHANGE_RETURN';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_jo_cancelled ON job_orders;
CREATE TRIGGER on_jo_cancelled
AFTER UPDATE ON job_orders
FOR EACH ROW EXECUTE FUNCTION cascade_jo_cancellation();
