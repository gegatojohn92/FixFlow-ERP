-- ============================================================================
-- 0014 — Delivery Sign-Off Gate (Gate C)
--
-- DISCREPANCY THIS FIXES
-- ----------------------
-- Accounting could close a requisition that the requester had never signed off.
--
-- Root cause: 0013 Gate B only fires when there is something to reconcile —
-- it compares `spare_change_required` against `spare_change_returned`. But
-- `spare_change_required` is stamped by Form 14 (requester delivery sign-off)
-- and defaults to 0.00. So on a requisition that never passed Form 14 the
-- comparison is 0 - 0 = 0, the gate passes, and Accounting closes the MRS with
-- the real spare change never computed and never collected. The money silently
-- vanishes and the MRS drops out of the delivery queue.
--
-- The existing `overall_status = 'FULFILLED'` check is NOT sufficient: the
-- purchaser's own "save actuals" step (Form 13) sets FULFILLED directly, well
-- before the requester ever confirms receipt. FULFILLED therefore means
-- "purchased", not "delivered and verified".
--
-- FIX
-- ---
-- Gate on the field that actually records the sign-off:
-- `requester_verification`, which is 'PENDING_DELIVERY' until Form 14 runs and
-- only then becomes 'VERIFIED' (or 'DISPUTED').
--
-- Idempotent and safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Gate C on the requisition: block FULFILLED → CLOSED before sign-off.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_mrs_delivery_signoff()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.overall_status = 'CLOSED'
     AND OLD.overall_status IS DISTINCT FROM 'CLOSED'
     AND COALESCE(NEW.requester_verification, 'PENDING_DELIVERY') <> 'VERIFIED'
  THEN
    RAISE EXCEPTION
      'Requisition % cannot be closed: the requester has not verified delivery yet (status "%"). Form 14 sign-off must happen first so the spare change owed is computed — 0014 Gate C.',
      NEW.mrs_number,
      COALESCE(NEW.requester_verification, 'PENDING_DELIVERY');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_mrs_delivery_signoff ON material_requisitions;
CREATE TRIGGER trg_guard_mrs_delivery_signoff
BEFORE UPDATE OF overall_status ON material_requisitions
FOR EACH ROW EXECUTE FUNCTION guard_mrs_delivery_signoff();

-- ----------------------------------------------------------------------------
-- 2. Gate C on the transmittal: same rule at the receipt end.
--    Extends the 0013 receipt guard so a transmittal cannot be marked RECEIVED
--    while its requisition is still awaiting sign-off. Re-declared in full
--    (rather than patched) so 0013's Gate B logic is preserved verbatim.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_transmittal_receipt()
RETURNS TRIGGER AS $$
DECLARE
  v_required   DECIMAL(10,2);
  v_returned   DECIMAL(10,2);
  v_number     VARCHAR(50);
  v_verified   VARCHAR(50);
  v_mrs_status VARCHAR(50);
BEGIN
  IF NEW.receiver_status IS NOT DISTINCT FROM OLD.receiver_status
     OR NEW.receiver_status <> 'RECEIVED'
  THEN
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

  SELECT COALESCE(spare_change_required, 0),
         COALESCE(spare_change_returned, 0),
         mrs_number,
         COALESCE(requester_verification, 'PENDING_DELIVERY'),
         overall_status
    INTO v_required, v_returned, v_number, v_verified, v_mrs_status
    FROM material_requisitions
   WHERE id = NEW.mrs_id;

  -- ── Gate C (0014): no receipt before the requester has signed off ──────────
  -- Without this, the spare change owed was never computed and closing the
  -- transmittal would lose it.
  IF v_number IS NOT NULL AND v_verified <> 'VERIFIED' THEN
    RAISE EXCEPTION
      'Transmittal % cannot be closed: requisition % has not been verified as delivered by the requester (status "%") — 0014 Gate C.',
      NEW.transmittal_number, v_number, v_verified;
  END IF;

  -- ── Gate B (0013): spare change must be fully returned ────────────────────
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
