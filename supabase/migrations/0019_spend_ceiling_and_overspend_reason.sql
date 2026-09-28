-- ============================================================================
-- 0019: Spend ceiling + over-spend justification (audit §A3) — Phase 3 of §13.4
--
-- WHY
--   `total_actual_spent` is a self-reported figure and it is *subtractive*: Gate B's
--   debt is `spare_change_required = mrs_disbursed_total(id) − total_actual_spent`
--   (computed at Form 14). Every peso of claimed spend therefore reduces the cash
--   the purchaser must hand back, and before this migration nothing bounded the
--   claim: `purchaserCompleteTrip()` compared spend against `allocated_budget`
--   only (a budget the purchaser never holds), never against the cash actually
--   released. Reporting `spent >= disbursed` drove the debt to exactly 0, Gate B
--   passed legitimately, and the money stayed in the purchaser's pocket — no
--   console PATCH needed, so 0016's role gates (which are correct as far as they
--   go) do not touch it.
--
-- WHAT
--   1. `material_requisitions.overspend_reason TEXT` — the justification a
--      purchaser must give when the trip costs more than the cash released
--      (out-of-pocket top-up, store price inflation, a COD fee). Written in the
--      SAME UPDATE as the actuals, so the guard below sees both at once.
--   2. `guard_mrs_spend_ceiling()` — refuses a spend figure above the ceiling
--      unless that reason is present:
--        · normal chain    → ceiling = mrs_disbursed_total(id) (0013, SECURITY
--                            DEFINER, so this stays correct inside a trigger —
--                            the §13.5 A4 lesson)
--        · Emergency Fast-Track → ceiling = the row's own `fast_track_cap_amount`
--                            (Plan §6.A skipped Forms 6/7/8/10, so there is no
--                            transmittal to measure against; the cap that let the
--                            requisition bypass approval is the right bound)
--      A ceiling of 0 is a real ceiling, not "no limit": spend with no cash
--      released is exactly what the 0012 chain forbids, so it now needs a reason
--      too instead of silently passing (contrast the B10 no-op this replaces).
--
--   The reason is a *justification*, not a permission slip — it is recorded on
--   the row and in the audit log so Form 17 / an owner review can see every trip
--   that cost more than it was given.
--
-- NOT MIRRORED HERE
--   The receipt-evidence rule (a trip that owes no change back must carry at
--   least one `PURCHASE_RECEIPT` attachment) lives in the app only: receipts are
--   rows in `attachments` keyed by line item, written after the spend figure, so
--   a BEFORE UPDATE guard could not see them without a storage-coupled query.
--   Documented in §13.7.
--
-- SCOPE / SAFETY
--   · Creates ONE new function and ONE new trigger; redefines none of the
--     0011-0018 guards, so it cannot clobber Gates B/C and re-running 0013/0014
--     cannot clobber it (§10.7 hazard class).
--   · `auth.uid() IS NULL` (SQL Editor, service_role, reset & backfill scripts)
--     is waved through, exactly like 0016.
--   · Requires 0013 (`mrs_disbursed_total`) and 0011 (`get_setting_numeric`).
--   · SAFE TO RE-RUN: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE /
--     DROP TRIGGER IF EXISTS throughout.
--
-- Apply AFTER 0018. Then run 0019_verify.sql.
-- ============================================================================

ALTER TABLE material_requisitions
  ADD COLUMN IF NOT EXISTS overspend_reason TEXT NULL;

COMMENT ON COLUMN material_requisitions.overspend_reason IS
  'Justification recorded on Form 13 when the trip cost more than the cash released (mrs_disbursed_total), or more than the fast-track cap for an Emergency Fast-Track requisition. Required by guard_mrs_spend_ceiling() (audit §A3); NULL/blank means the spend was within the ceiling.';

CREATE OR REPLACE FUNCTION guard_mrs_spend_ceiling()
RETURNS TRIGGER AS $$
DECLARE
  v_ceiling DECIMAL(10,2);
BEGIN
  -- SQL Editor / service_role / reset & backfill scripts: trusted admin path.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only the spend figure is guarded here; every other column write passes
  -- straight through (0016's guard owns who may write it, Rule 1).
  IF NEW.total_actual_spent IS NOT DISTINCT FROM OLD.total_actual_spent THEN
    RETURN NEW;
  END IF;

  v_ceiling := CASE
    WHEN NEW.is_emergency_fast_track THEN
      COALESCE(NEW.fast_track_cap_amount,
               get_setting_numeric('mrs.fast_track_cap_amount', 3000.00)::DECIMAL(10,2))
    ELSE
      -- SECURITY DEFINER since 0013, so this reads the true ledger even when the
      -- writer's own RLS would hide the transmittal rows.
      mrs_disbursed_total(NEW.id)
  END;

  IF NEW.total_actual_spent > v_ceiling + 0.01
     AND COALESCE(btrim(NEW.overspend_reason), '') = '' THEN
    RAISE EXCEPTION
      'Reported spend of ₱% on % exceeds the ₱% released for it% — record an over-spend reason on Form 13 (or correct the actuals).',
      NEW.total_actual_spent,
      NEW.mrs_number,
      v_ceiling,
      CASE WHEN NEW.is_emergency_fast_track
             THEN ' (Emergency Fast-Track cap)'
           ELSE '' END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_mrs_spend_ceiling ON material_requisitions;
CREATE TRIGGER trg_guard_mrs_spend_ceiling
BEFORE UPDATE ON material_requisitions
FOR EACH ROW EXECUTE FUNCTION guard_mrs_spend_ceiling();
