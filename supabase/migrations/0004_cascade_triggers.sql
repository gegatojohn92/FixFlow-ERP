-- FixFlow ERP Database Migration: 0004_cascade_triggers.sql
-- Single Source of Truth from Plan.md §3.5 & §4 (State Machines & Transition Guards)

-- ============================================================================
-- 1. Cascade Cancellation Lock (Plan.md §3.5 & §6.C)
-- ============================================================================

CREATE OR REPLACE FUNCTION cascade_jo_cancellation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'CANCELLED' AND OLD.status != 'CANCELLED' THEN
    -- Cancel linked MRS if not fulfilled or closed
    UPDATE material_requisitions
    SET overall_status = 'VOIDED'
    WHERE jo_id = NEW.id AND overall_status NOT IN ('FULFILLED', 'CLOSED');

    -- Cancel pending financial transmittals linked to affected MRS
    UPDATE transmittal_forms
    SET sender_status = 'CANCELLED', receiver_status = 'CANCELLED'
    WHERE mrs_id IN (SELECT id FROM material_requisitions WHERE jo_id = NEW.id)
      AND receiver_status = 'PENDING';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_jo_cancelled ON job_orders;
CREATE TRIGGER on_jo_cancelled
AFTER UPDATE ON job_orders
FOR EACH ROW EXECUTE FUNCTION cascade_jo_cancellation();

-- ============================================================================
-- 2. Job Order State Machine Transition Guard (Plan.md §4.1)
-- ============================================================================

CREATE OR REPLACE FUNCTION guard_jo_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- If status did not change, allow update
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Validate allowed transitions per Plan.md §4.1 and operational re-entry paths
  IF OLD.status = 'PENDING_ASSESSMENT' AND NEW.status IN ('IN_PROGRESS', 'CANCELLED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'IN_PROGRESS' AND NEW.status IN ('AWAITING_MRS_APPROVAL', 'COMPLETED', 'CANCELLED', 'MRS_REJECTED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'AWAITING_MRS_APPROVAL' AND NEW.status IN ('IN_PROGRESS', 'CANCELLED', 'MRS_REJECTED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'MRS_REJECTED' AND NEW.status IN ('IN_PROGRESS', 'AWAITING_MRS_APPROVAL') THEN
    RETURN NEW;
  ELSIF OLD.status = 'COMPLETED' AND NEW.status IN ('MATERIALS_RECEIVED', 'REOPENED_UNRESOLVED', 'CRITICAL_REOPEN_ESCALATED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'REOPENED_UNRESOLVED' AND NEW.status = 'COMPLETED' THEN
    RETURN NEW;
  ELSIF OLD.status = 'CRITICAL_REOPEN_ESCALATED' AND NEW.status = 'COMPLETED' THEN
    RETURN NEW;
  ELSIF OLD.status = 'MATERIALS_RECEIVED' AND NEW.status = 'CLOSED' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal job order status transition from % to %', OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_jo_status_transition ON job_orders;
CREATE TRIGGER trg_guard_jo_status_transition
BEFORE UPDATE OF status ON job_orders
FOR EACH ROW EXECUTE FUNCTION guard_jo_status_transition();

-- ============================================================================
-- 3. Material Requisition State Machine Transition Guard (Plan.md §4.2)
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

  -- Validate allowed transitions per Plan.md §4.2 and downstream workflow updates
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
  ELSIF OLD.overall_status = 'APPROVED_READY_TO_ORDER' AND NEW.overall_status IN ('TRANSMITTAL_IN_PROGRESS', 'READY_FOR_PURCHASE', 'PURCHASING') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'TRANSMITTAL_IN_PROGRESS' AND NEW.overall_status IN ('READY_FOR_PURCHASE', 'PURCHASING') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'READY_FOR_PURCHASE' AND NEW.overall_status = 'PURCHASING' THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'PURCHASING' AND NEW.overall_status IN ('PARTIALLY_FULFILLED_BUDGET_EXHAUSTED', 'FULFILLED') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED' AND NEW.overall_status = 'FULFILLED' THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'EMERGENCY_FAST_TRACK' AND NEW.overall_status = 'FULFILLED' THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'FULFILLED' AND NEW.overall_status IN ('DISPUTED', 'CLOSED') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'DISPUTED' AND NEW.overall_status = 'FULFILLED' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal material requisition status transition from % to %', OLD.overall_status, NEW.overall_status;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_mrs_status_transition ON material_requisitions;
CREATE TRIGGER trg_guard_mrs_status_transition
BEFORE UPDATE OF overall_status ON material_requisitions
FOR EACH ROW EXECUTE FUNCTION guard_mrs_status_transition();

-- ============================================================================
-- 4. Atomic Batch Transmittal Creator (Plan.md §6.D / §9.3)
-- ============================================================================

CREATE OR REPLACE FUNCTION create_batch_transmittal_transaction(
  p_items jsonb,
  p_receiver_user_id UUID,
  p_transmittal_type transmittal_type,
  p_notes TEXT,
  p_sender_user_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE);
  v_batch_code TEXT;
  v_result jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) IS NULL OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'Batch transmittal must contain between 1 and 50 items.';
  END IF;

  SELECT 'TR-BATCH-' || v_year || '-' || LPAD(COALESCE(MAX(last_value), 0) + 1::text, 4, '0')
  INTO v_batch_code
  FROM number_sequences
  WHERE entity_prefix = 'TR-BATCH' AND year = v_year;

  IF v_batch_code IS NULL THEN
    v_batch_code := 'TR-BATCH-' || v_year || '-0001';
  END IF;

  WITH rows AS (
    SELECT (item->>'mrsId')::INT AS mrs_id, (item->>'amount')::NUMERIC AS amount
    FROM jsonb_array_elements(p_items) AS item
  ),
  batch_seq AS (
    INSERT INTO number_sequences (entity_prefix, year, last_value)
    VALUES ('TR-BATCH', v_year, COALESCE((SELECT last_value FROM number_sequences WHERE entity_prefix = 'TR-BATCH' AND year = v_year), 0) + 1)
    ON CONFLICT (entity_prefix, year)
    DO UPDATE SET last_value = number_sequences.last_value + 1
    RETURNING 1
  ),
  inserted AS (
    INSERT INTO transmittal_forms (
      transmittal_number,
      mrs_id,
      batch_code,
      transmittal_type,
      amount,
      sender_user_id,
      sender_status,
      receiver_user_id,
      receiver_status,
      notes
    )
    SELECT
      next_reference_number('TR', v_year),
      rows.mrs_id,
      v_batch_code,
      p_transmittal_type,
      rows.amount,
      p_sender_user_id,
      'PENDING',
      p_receiver_user_id,
      'PENDING',
      p_notes
    FROM rows
    RETURNING id, transmittal_number, mrs_id, batch_code, transmittal_type, amount, sender_user_id, sender_status, receiver_user_id, receiver_status, notes
  ),
  updated AS (
    UPDATE material_requisitions
    SET overall_status = 'TRANSMITTAL_IN_PROGRESS'
    WHERE id IN (SELECT mrs_id FROM (SELECT DISTINCT (item->>'mrsId')::INT AS mrs_id FROM jsonb_array_elements(p_items) AS item) rows)
    RETURNING id
  )
  SELECT jsonb_build_object(
    'batch_code', v_batch_code,
    'total_amount', (SELECT COALESCE(SUM(amount), 0)::NUMERIC FROM (SELECT (item->>'amount')::NUMERIC AS amount FROM jsonb_array_elements(p_items) AS item) x),
    'transmittals', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM inserted i), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;
