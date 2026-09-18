-- ============================================================================
-- 0012_strong_mrs_flow_gates.sql
-- ----------------------------------------------------------------------------
-- Purpose: enforce the STRICT MRS flow chain at the database level
--          (mirror of src/lib/status-machines.ts, MRS_TRANSITIONS).
--
-- Canonical chain enforced (each step gates the next):
--   PENDING_MANAGER          → manager approval (Form 7)
--   IN_CANVASSING            → BO canvassing + snapshot to owner (Form 8)
--   PENDING_OWNER            → owner decision recorded by BO (Form 8)
--   APPROVED_READY_TO_ORDER  → ONLY → TRANSMITTAL_IN_PROGRESS (Form 10)
--   TRANSMITTAL_IN_PROGRESS  → ONLY → READY_FOR_PURCHASE
--                              (Form 11 — Accounting disburses & marks SENT)
--   READY_FOR_PURCHASE       → ONLY → PURCHASING
--                              (Form 13 — Purchaser confirms cash & locks float)
--   PURCHASING               → IN_TRANSIT (online/COD shipped)
--                              | FULFILLED / PARTIALLY_FULFILLED_BUDGET_EXHAUSTED
--                              (Form 13 — save actuals & forward to delivery)
--   IN_TRANSIT               → FULFILLED / PARTIALLY_... / DISPUTED
--                              (Form 14 — requester's department sign-off)
--   FULFILLED                → CLOSED (Form 16 — Accounting verifies spare
--                              change and closes the MRS) | DISPUTED
--
--   Bypass (by design, Plan §6.A): EMERGENCY_FAST_TRACK → PURCHASING |
--   FULFILLED | PARTIALLY_FULFILLED_BUDGET_EXHAUSTED (no transmittal).
--   Warehouse branch (Plan §5 Form 6): PENDING_MANAGER → ISSUED_FROM_STOCK.
--   Any non-terminal status may still be cascade-VOIDED.
--
-- What this CLOWS (was previously allowed, now rejected):
--   * APPROVED_READY_TO_ORDER → READY_FOR_PURCHASE / PURCHASING / IN_TRANSIT
--     (skipping the transmittal entirely)
--   * TRANSMITTAL_IN_PROGRESS → PURCHASING (skipping Accounting disbursement)
--   * READY_FOR_PURCHASE      → IN_TRANSIT (shipping before cash confirmation)
--   * PARTIALLY_FULFILLED_BUDGET_EXHAUSTED → DISPUTED is now ALLOWED (sign-off
--     dispute on a budget-exhausted requisition — app parity)
--
-- Apply: Supabase SQL Editor, AFTER 0011 (idempotent: CREATE OR REPLACE).
-- ============================================================================

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
