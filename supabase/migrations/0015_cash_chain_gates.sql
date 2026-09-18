-- ============================================================================
-- 0015 — CASH CHAIN hard gates (transmittal creation / disbursement / COD)
--
-- DISCREPANCIES THIS FIXES
-- ------------------------
-- The 0012/0013/0014 gates protect the requisition STATE machine and the
-- settle-and-close step, but the cash chain's *entry points* were still open
-- to direct writers (SQL editor, service-key REST PATCH, batch RPC):
--
--   1. A new transmittal could be committed against a requisition whose
--      overall_status is anything except the pre-purchase window
--      (APPROVED_READY_TO_ORDER / TRANSMITTAL_IN_PROGRESS / READY_FOR_PURCHASE
--      / PURCHASING). Cash could therefore be "issued" against a requisition
--      the Owner had NOT approved, or one already FULFILLED/IN_TRANSIT/CLOSED.
--   2. `disburseCashAndMarkSent` could move a transmittal to SENT (cash leaves
--      the office) for a requisition outside the disbursement window.
--   3. Front Desk could advance the revolving float (COD) to a requisition
--      that is not an online purchase, or one already fulfilled.
--
-- These are independent of 0004/0011/0012/0013/0014; this file only ADDS two
-- new trigger functions and is fully idempotent (CREATE OR REPLACE / DROP
-- TRIGGER IF EXISTS). No new columns.
--
-- Note: unlike 0013/0014, this does NOT touch guard_transmittal_receipt(),
-- so re-running 0013/0014 cannot clobber these gates.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Guard functions
-- ----------------------------------------------------------------------------

-- (a) New budget transmittals only within the pre-purchase window.
CREATE OR REPLACE FUNCTION guard_cash_transmittal_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_status VARCHAR(50);
  v_number VARCHAR(50);
BEGIN
  -- Returns carry cash BACK; the FD revolving float has its own gate (c);
  -- replenishments / standalone transmittals have no linked MRS.
  IF NEW.mrs_id IS NULL
     OR NEW.transmittal_type IN ('SPARE_CHANGE_RETURN',
                                 'FD_REVOLVING_DISBURSEMENT',
                                 'FD_REVOLVING_REPLENISHMENT') THEN
    RETURN NEW;
  END IF;

  SELECT overall_status, mrs_number
    INTO v_status, v_number
    FROM material_requisitions
   WHERE id = NEW.mrs_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Cash transmittal % references a requisition that does not exist.', NEW.transmittal_number;
  END IF;

  IF v_status NOT IN ('APPROVED_READY_TO_ORDER', 'TRANSMITTAL_IN_PROGRESS',
                      'READY_FOR_PURCHASE', 'PURCHASING') THEN
    RAISE EXCEPTION
      'Transmittal % cannot be issued: requisition % is "%" — cash transmittals are only issued while the requisition is APPROVED_READY_TO_ORDER / TRANSMITTAL_IN_PROGRESS / READY_FOR_PURCHASE / PURCHASING (0015 cash-chain gate).',
      NEW.transmittal_number, v_number, v_status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_cash_transmittal_insert ON transmittal_forms;
CREATE TRIGGER trg_guard_cash_transmittal_insert
BEFORE INSERT ON transmittal_forms
FOR EACH ROW EXECUTE FUNCTION guard_cash_transmittal_insert();

-- (b) Marking a transmittal SENT (cash leaves the office) is only allowed
--     while the requisition is within the disbursement window.
CREATE OR REPLACE FUNCTION guard_cash_transmittal_sent()
RETURNS TRIGGER AS $$
DECLARE
  v_status VARCHAR(50);
  v_number VARCHAR(50);
BEGIN
  -- Only when sender_status transitions INTO 'SENT'.
  IF NEW.sender_status IS NOT DISTINCT FROM OLD.sender_status
     OR NEW.sender_status <> 'SENT' THEN
    RETURN NEW;
  END IF;

  IF NEW.mrs_id IS NULL OR NEW.transmittal_type = 'SPARE_CHANGE_RETURN' THEN
    RETURN NEW;
  END IF;

  SELECT overall_status, mrs_number
    INTO v_status, v_number
    FROM material_requisitions
   WHERE id = NEW.mrs_id;

  IF v_status NOT IN ('TRANSMITTAL_IN_PROGRESS', 'READY_FOR_PURCHASE', 'PURCHASING') THEN
    RAISE EXCEPTION
      'Transmittal % cannot be marked SENT: requisition % is "%" — cash may only be disbursed from TRANSMITTAL_IN_PROGRESS / READY_FOR_PURCHASE / PURCHASING (0015 cash-chain gate).',
      NEW.transmittal_number, v_number, v_status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_cash_transmittal_sent ON transmittal_forms;
CREATE TRIGGER trg_guard_cash_transmittal_sent
BEFORE UPDATE OF sender_status ON transmittal_forms
FOR EACH ROW EXECUTE FUNCTION guard_cash_transmittal_sent();

-- (c) FD revolving-float COD advances only for genuine online orders whose
--     purchase is in flight (and not already fulfilled/shipped-delivered).
CREATE OR REPLACE FUNCTION guard_fd_cod_disbursement()
RETURNS TRIGGER AS $$
DECLARE
  v_status   VARCHAR(50);
  v_number   VARCHAR(50);
  v_online   BOOLEAN;
BEGIN
  IF NEW.transmittal_type <> 'FD_REVOLVING_DISBURSEMENT' OR NEW.mrs_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT overall_status, mrs_number, is_online_purchase
    INTO v_status, v_number, v_online
    FROM material_requisitions
   WHERE id = NEW.mrs_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'COD disbursement % references a requisition that does not exist.', NEW.transmittal_number;
  END IF;

  IF v_online IS NOT TRUE THEN
    RAISE EXCEPTION
      'COD disbursement % blocked: requisition % is not an online/COD purchase (0015 cash-chain gate).',
      NEW.transmittal_number, v_number;
  END IF;

  IF v_status NOT IN ('APPROVED_READY_TO_ORDER', 'TRANSMITTAL_IN_PROGRESS',
                      'READY_FOR_PURCHASE', 'PURCHASING', 'IN_TRANSIT') THEN
    RAISE EXCEPTION
      'COD disbursement % blocked: requisition % is "%" — the FD float only advances cash for online orders in flight (0015 cash-chain gate).',
      NEW.transmittal_number, v_number, v_status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_fd_cod_disbursement ON transmittal_forms;
CREATE TRIGGER trg_guard_fd_cod_disbursement
BEFORE INSERT ON transmittal_forms
FOR EACH ROW EXECUTE FUNCTION guard_fd_cod_disbursement();
