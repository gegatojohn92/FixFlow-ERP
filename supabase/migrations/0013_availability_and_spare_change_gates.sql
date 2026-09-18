-- ============================================================================
-- 0013_availability_and_spare_change_gates.sql
-- ----------------------------------------------------------------------------
-- Purpose: two new hard gates in the MRS ⇄ Transmittal chain, enforced in the
--          database as the second line of defense behind the server actions
--          (mirror of src/lib/status-machines.ts).
--
--  A. PARTIAL AVAILABILITY LOOP (Form 13 → Form 9 → Form 13)
--     When the purchaser finds an item unavailable, or only part of the
--     requested quantity available, they report availability instead of
--     silently buying less. The requisition is put on an availability hold and
--     the requester (or anyone in the requester's department) must decide:
--        PROCEED_PARTIAL  — buy what is available, drop the rest
--        WAIT_FULL        — do not buy yet, wait for full availability
--        CANCEL_REMAINING — buy what is available, formally cancel the balance
--     The purchaser cannot save actuals while a hold is still PENDING.
--
--  B. SPARE-CHANGE RECONCILIATION (Form 14 → Form 11/16)
--     When the requester's department signs the delivery off (Form 14), the
--     system stamps `spare_change_required` on the requisition =
--        total disbursed cash (SENT/RECEIVED transmittals, excluding returns)
--        − total actually spent.
--     Accounting may NOT mark a transmittal RECEIVED / close the requisition
--     until the cumulative spare change physically returned
--     (`spare_change_returned`) covers `spare_change_required`.
--
-- Apply: Supabase SQL Editor, AFTER 0012. Idempotent
-- (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema — availability loop + spare-change reconciliation columns
-- ----------------------------------------------------------------------------
ALTER TABLE material_requisitions
  ADD COLUMN IF NOT EXISTS availability_hold BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE material_requisitions
  ADD COLUMN IF NOT EXISTS availability_notes TEXT NULL;
ALTER TABLE material_requisitions
  ADD COLUMN IF NOT EXISTS availability_reported_at TIMESTAMP NULL;
ALTER TABLE material_requisitions
  ADD COLUMN IF NOT EXISTS availability_reported_by UUID NULL REFERENCES users(id);

-- NONE = never reported; PENDING = awaiting the requester's answer.
ALTER TABLE material_requisitions
  ADD COLUMN IF NOT EXISTS requester_decision VARCHAR(30) NOT NULL DEFAULT 'NONE';
ALTER TABLE material_requisitions
  ADD COLUMN IF NOT EXISTS requester_decision_notes TEXT NULL;
ALTER TABLE material_requisitions
  ADD COLUMN IF NOT EXISTS requester_decision_at TIMESTAMP NULL;
ALTER TABLE material_requisitions
  ADD COLUMN IF NOT EXISTS requester_decision_by UUID NULL REFERENCES users(id);

ALTER TABLE material_requisitions
  ADD COLUMN IF NOT EXISTS spare_change_required DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE material_requisitions
  ADD COLUMN IF NOT EXISTS spare_change_returned DECIMAL(10,2) NOT NULL DEFAULT 0.00;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'material_requisitions_requester_decision_check'
  ) THEN
    ALTER TABLE material_requisitions
      ADD CONSTRAINT material_requisitions_requester_decision_check
      CHECK (requester_decision IN ('NONE', 'PENDING', 'PROCEED_PARTIAL', 'WAIT_FULL', 'CANCEL_REMAINING'));
  END IF;
END $$;

-- Per-line availability reported by the purchaser (NULL = not yet assessed).
ALTER TABLE mrs_line_items
  ADD COLUMN IF NOT EXISTS qty_available INT NULL;
ALTER TABLE mrs_line_items
  ADD COLUMN IF NOT EXISTS availability_note VARCHAR(255) NULL;

CREATE INDEX IF NOT EXISTS idx_mrs_availability_hold
  ON material_requisitions(availability_hold, requester_decision)
  WHERE availability_hold = TRUE;

-- ----------------------------------------------------------------------------
-- 2. Gate A — a requisition on an unanswered availability hold cannot advance
--    past PURCHASING / IN_TRANSIT / EMERGENCY_FAST_TRACK.
-- 3. Gate B — FULFILLED → CLOSED requires the spare change to be fully
--    reconciled (returned >= required, ₱0.01 rounding tolerance).
--
-- Both live inside guard_mrs_status_transition() so there is exactly ONE
-- transition guard on material_requisitions (supersedes 0012; the transition
-- map below is an unchanged copy of 0012's strict chain).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_mrs_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- If status did not change, allow update
  IF OLD.overall_status = NEW.overall_status THEN
    RETURN NEW;
  END IF;

  -- Any non-terminal status can transition to VOIDED via cascade cancellation
  IF NEW.overall_status = 'VOIDED' AND OLD.overall_status NOT IN ('FULFILLED', 'CLOSED') THEN
    RETURN NEW;
  END IF;

  -- ── Gate A (0013): unanswered availability hold blocks the purchase forward ──
  IF NEW.availability_hold = TRUE
     AND NEW.requester_decision = 'PENDING'
     AND NEW.overall_status IN ('FULFILLED', 'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED', 'IN_TRANSIT')
  THEN
    RAISE EXCEPTION
      'Requisition % is on an availability hold awaiting the requester''s decision — it cannot advance to % (0013 Gate A).',
      NEW.mrs_number, NEW.overall_status;
  END IF;

  -- ── Gate B (0013): spare change must be fully returned before closing ──
  IF OLD.overall_status = 'FULFILLED' AND NEW.overall_status = 'CLOSED'
     AND COALESCE(NEW.spare_change_required, 0) - COALESCE(NEW.spare_change_returned, 0) > 0.01
  THEN
    RAISE EXCEPTION
      'Requisition % cannot be closed: spare change of % is required but only % has been returned (0013 Gate B).',
      NEW.mrs_number,
      COALESCE(NEW.spare_change_required, 0),
      COALESCE(NEW.spare_change_returned, 0);
  END IF;

  -- Validate allowed transitions (strict chain — Plan.md §4.2 + 0012)
  IF OLD.overall_status = 'PENDING_MANAGER' AND NEW.overall_status IN ('MANAGER_REJECTED', 'IN_CANVASSING', 'ISSUED_FROM_STOCK') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'MANAGER_REJECTED' AND NEW.overall_status = 'PENDING_MANAGER' THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'IN_CANVASSING' AND NEW.overall_status = 'PENDING_OWNER' THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'PENDING_OWNER' AND NEW.overall_status IN ('OWNER_REJECTED', 'APPROVED_READY_TO_ORDER') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'OWNER_REJECTED' AND NEW.overall_status = 'PENDING_MANAGER' THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'APPROVED_READY_TO_ORDER' AND NEW.overall_status = 'TRANSMITTAL_IN_PROGRESS' THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'TRANSMITTAL_IN_PROGRESS' AND NEW.overall_status = 'READY_FOR_PURCHASE' THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'READY_FOR_PURCHASE' AND NEW.overall_status = 'PURCHASING' THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'PURCHASING' AND NEW.overall_status IN ('PARTIALLY_FULFILLED_BUDGET_EXHAUSTED', 'FULFILLED', 'IN_TRANSIT') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED' AND NEW.overall_status IN ('FULFILLED', 'DISPUTED') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'EMERGENCY_FAST_TRACK' AND NEW.overall_status IN ('PURCHASING', 'FULFILLED', 'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'FULFILLED' AND NEW.overall_status IN ('DISPUTED', 'CLOSED') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'DISPUTED' AND NEW.overall_status = 'FULFILLED' THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'IN_TRANSIT' AND NEW.overall_status IN ('FULFILLED', 'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED', 'DISPUTED') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal material requisition status transition from % to % (strict flow chain — 0012).', OLD.overall_status, NEW.overall_status;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_mrs_status_transition ON material_requisitions;
CREATE TRIGGER trg_guard_mrs_status_transition
BEFORE UPDATE OF overall_status ON material_requisitions
FOR EACH ROW EXECUTE FUNCTION guard_mrs_status_transition();

-- ----------------------------------------------------------------------------
-- 4. Gate B (transmittal side) — a linked transmittal cannot be marked
--    RECEIVED while the requisition still owes spare change. Mirrors
--    verifyCashAndMarkReceived() in src/lib/actions/transmittal-actions.ts.
--
--    Spare-change RETURN transmittals are exempt: they are the vehicle that
--    carries the money back and are stamped RECEIVED on creation.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_transmittal_receipt()
RETURNS TRIGGER AS $$
DECLARE
  v_required DECIMAL(10,2);
  v_returned DECIMAL(10,2);
  v_number   VARCHAR(50);
BEGIN
  IF NEW.receiver_status <> 'RECEIVED' OR OLD.receiver_status = 'RECEIVED' THEN
    RETURN NEW;
  END IF;

  IF NEW.transmittal_type = 'SPARE_CHANGE_RETURN' OR NEW.mrs_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Dual confirmation (Rule 3): cash must have been sent before it is received.
  IF NEW.sender_status NOT IN ('SENT', 'RECEIVED') THEN
    RAISE EXCEPTION
      'Transmittal % cannot be marked RECEIVED before it is marked SENT (chain of custody).',
      NEW.transmittal_number;
  END IF;

  SELECT COALESCE(spare_change_required, 0), COALESCE(spare_change_returned, 0), mrs_number
    INTO v_required, v_returned, v_number
    FROM material_requisitions
   WHERE id = NEW.mrs_id;

  IF v_required IS NOT NULL AND v_required - v_returned > 0.01 THEN
    RAISE EXCEPTION
      'Transmittal % cannot be closed: requisition % still owes spare change of % (returned: %) — 0013 Gate B.',
      NEW.transmittal_number, v_number, v_required, v_returned;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_transmittal_receipt ON transmittal_forms;
CREATE TRIGGER trg_guard_transmittal_receipt
BEFORE UPDATE OF receiver_status ON transmittal_forms
FOR EACH ROW EXECUTE FUNCTION guard_transmittal_receipt();

-- ----------------------------------------------------------------------------
-- 5. Helper — total cash disbursed against a requisition (excludes returns).
--    Used by Form 14 sign-off to stamp `spare_change_required`.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mrs_disbursed_total(p_mrs_id INT)
RETURNS DECIMAL(10,2) AS $$
  SELECT COALESCE(SUM(amount), 0.00)::DECIMAL(10,2)
    FROM transmittal_forms
   WHERE mrs_id = p_mrs_id
     AND transmittal_type <> 'SPARE_CHANGE_RETURN'
     AND sender_status IN ('SENT', 'RECEIVED');
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION mrs_disbursed_total(INT) TO authenticated;
