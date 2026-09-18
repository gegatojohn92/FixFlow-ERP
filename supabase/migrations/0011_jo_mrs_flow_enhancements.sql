-- ============================================================================
-- FixFlow ERP Migration: 0011_jo_mrs_flow_enhancements.sql
--
-- Review & enhancement of the Job Order (JO) and Material Requisition (MRS)
-- flows, structure, and schema. Applies AFTER 0010.
--
-- Contents:
--   1.  job_orders: cancellation & closure audit columns
--   2.  guard_jo_status_transition: fixes dead-end states (MATERIALS_RECEIVED,
--       CLOSED) — full superset of 0004 + 0010
--   3.  guard_mrs_status_transition: wires IN_TRANSIT + fast-track purchasing
--   4.  cascade_jo_cancellation: auto-generates SPARE_CHANGE_RETURN
--       transmittals when cash was already disbursed (Rule 3 / Plan §3.5)
--   5.  system_settings table + get_setting_numeric() helper — business
--       constants (fast-track cap, deficit thresholds, batch limit) become
--       data instead of hardcoded values
--   6.  Performance indexes for all queue/list queries
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. job_orders: cancellation & closure audit trail
-- ----------------------------------------------------------------------------
ALTER TABLE job_orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NULL;
ALTER TABLE job_orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL;
ALTER TABLE job_orders ADD COLUMN IF NOT EXISTS cancelled_by UUID NULL REFERENCES users(id);
ALTER TABLE job_orders ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP NULL;
ALTER TABLE job_orders ADD COLUMN IF NOT EXISTS closed_by UUID NULL REFERENCES users(id);

-- ----------------------------------------------------------------------------
-- 2. JO state machine transition guard (superset of 0004 + 0010)
--
-- Fixes:
--   * IN_PROGRESS          -> MATERIALS_RECEIVED   (delivery verified or 100%
--     stock-issued while the JO is back in IN_PROGRESS)
--   * MATERIALS_RECEIVED   -> COMPLETED            (tech finishes work after
--     materials arrive — previously a dead end)
--   * COMPLETED            -> CLOSED               (manager final acceptance —
--     CLOSED was unreachable from the UI)
--   * MATERIALS_RECEIVED   -> COMPLETED            (already present via 0010?
--     no — 0010 only added AWAITING_MRS_APPROVAL -> MATERIALS_RECEIVED)
-- ----------------------------------------------------------------------------
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
  ELSIF OLD.status = 'IN_PROGRESS' AND NEW.status IN ('AWAITING_MRS_APPROVAL', 'COMPLETED', 'CANCELLED', 'MRS_REJECTED', 'MATERIALS_RECEIVED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'AWAITING_MRS_APPROVAL' AND NEW.status IN ('IN_PROGRESS', 'MATERIALS_RECEIVED', 'CANCELLED', 'MRS_REJECTED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'MRS_REJECTED' AND NEW.status IN ('IN_PROGRESS', 'AWAITING_MRS_APPROVAL') THEN
    RETURN NEW;
  ELSIF OLD.status = 'COMPLETED' AND NEW.status IN ('MATERIALS_RECEIVED', 'REOPENED_UNRESOLVED', 'CRITICAL_REOPEN_ESCALATED', 'CLOSED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'REOPENED_UNRESOLVED' AND NEW.status = 'COMPLETED' THEN
    RETURN NEW;
  ELSIF OLD.status = 'CRITICAL_REOPEN_ESCALATED' AND NEW.status = 'COMPLETED' THEN
    RETURN NEW;
  ELSIF OLD.status = 'MATERIALS_RECEIVED' AND NEW.status IN ('COMPLETED', 'CLOSED') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal job order status transition from % to %', OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_jo_status_transition ON job_orders;
CREATE TRIGGER trg_guard_jo_status_transition
BEFORE UPDATE OF status ON job_orders
FOR EACH ROW EXECUTE FUNCTION guard_jo_status_transition();

-- ----------------------------------------------------------------------------
-- 3. MRS state machine transition guard (superset of 0004)
--
-- Fixes:
--   * EMERGENCY_FAST_TRACK -> PURCHASING   (fast-track skips Forms 6-8-10; the
--     purchaser proceeds directly — previously raised a guard exception)
--   * APPROVED_READY_TO_ORDER -> IN_TRANSIT, READY_FOR_PURCHASE -> IN_TRANSIT,
--     PURCHASING -> IN_TRANSIT             (online / COD orders ship before the
--     requester verification step)
--   * IN_TRANSIT -> FULFILLED / PARTIALLY_FULFILLED_BUDGET_EXHAUSTED / DISPUTED
--     (requester sign-off on shipped orders)
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
  ELSIF OLD.overall_status = 'APPROVED_READY_TO_ORDER' AND NEW.overall_status IN ('TRANSMITTAL_IN_PROGRESS', 'READY_FOR_PURCHASE', 'PURCHASING', 'IN_TRANSIT') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'TRANSMITTAL_IN_PROGRESS' AND NEW.overall_status IN ('READY_FOR_PURCHASE', 'PURCHASING') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'READY_FOR_PURCHASE' AND NEW.overall_status IN ('PURCHASING', 'IN_TRANSIT') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'PURCHASING' AND NEW.overall_status IN ('PARTIALLY_FULFILLED_BUDGET_EXHAUSTED', 'FULFILLED', 'IN_TRANSIT') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED' AND NEW.overall_status = 'FULFILLED' THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'EMERGENCY_FAST_TRACK' AND NEW.overall_status IN ('PURCHASING', 'FULFILLED') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'FULFILLED' AND NEW.overall_status IN ('DISPUTED', 'CLOSED') THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'DISPUTED' AND NEW.overall_status = 'FULFILLED' THEN
    RETURN NEW;
  ELSIF OLD.overall_status = 'IN_TRANSIT' AND NEW.overall_status IN ('FULFILLED', 'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED', 'DISPUTED') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal material requisition status transition from % to %', OLD.overall_status, NEW.overall_status;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_mrs_status_transition ON material_requisitions;
CREATE TRIGGER trg_guard_mrs_status_transition
BEFORE UPDATE OF overall_status ON material_requisitions
FOR EACH ROW EXECUTE FUNCTION guard_mrs_status_transition();

-- ----------------------------------------------------------------------------
-- 4. Cascade Cancellation Lock (superset of 0004)
--
-- In addition to voiding linked MRS and cancelling pending transmittals:
--   * Records WHO/WHEN cancelled (auth.uid() is available in the PostgREST
--     request context; NULL when triggered by service role).
--   * Auto-generates a SPARE_CHANGE_RETURN transmittal for every transmittal
--     where cash already moved (sender SENT or receiver RECEIVED), mirroring
--     the original parties: the holder of the cash returns 100% of it.
--     (README Rule 3 / agent_handoff §3)
-- ----------------------------------------------------------------------------
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
      next_reference_number('TR', EXTRACT(YEAR FROM CURRENT_DATE)),
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_jo_cancelled ON job_orders;
CREATE TRIGGER on_jo_cancelled
AFTER UPDATE ON job_orders
FOR EACH ROW EXECUTE FUNCTION cascade_jo_cancellation();

-- ----------------------------------------------------------------------------
-- 5. system_settings — business constants as data
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(100) PRIMARY KEY,
  value VARCHAR(200) NOT NULL,
  description TEXT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_settings (key, value, description) VALUES
  ('mrs.fast_track_cap_amount', '3000.00',
   'Maximum total estimated cost (PHP) eligible for Emergency Fast-Track (Plan §6.A).'),
  ('mrs.minor_deficit_amount', '200.00',
   'Budget overage (PHP) still treated as a minor deficit when purchasing completes (Plan §6.B).'),
  ('mrs.minor_deficit_percent', '5',
   'Budget overage (percent of allocated budget) still treated as a minor deficit (Plan §6.B).'),
  ('transmittals.batch_max_items', '50',
   'Maximum MRS per batch transmittal (Plan §6.D).')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = CURRENT_TIMESTAMP
WHERE system_settings.value IS DISTINCT FROM EXCLUDED.value
   OR system_settings.description IS DISTINCT FROM EXCLUDED.description;

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_settings_read_all" ON system_settings
FOR SELECT TO authenticated USING (true);

CREATE POLICY "system_settings_admin_write" ON system_settings
FOR ALL TO authenticated
USING (get_my_role() = 'SUPER_ADMIN')
WITH CHECK (get_my_role() = 'SUPER_ADMIN');

-- Helper: read a numeric setting with a hard default (bypasses RLS; read-only).
CREATE OR REPLACE FUNCTION get_setting_numeric(p_key VARCHAR, p_default NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT value::numeric FROM public.system_settings WHERE key = p_key), p_default)
$$;

GRANT EXECUTE ON FUNCTION get_setting_numeric(VARCHAR, NUMERIC) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Performance indexes for queue / list / ledger queries
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_job_orders_status       ON job_orders(status);
CREATE INDEX IF NOT EXISTS idx_job_orders_requester    ON job_orders(requester_id);
CREATE INDEX IF NOT EXISTS idx_job_orders_assignee     ON job_orders(assignee_id);
CREATE INDEX IF NOT EXISTS idx_job_orders_priority     ON job_orders(priority, created_at);

CREATE INDEX IF NOT EXISTS idx_mrs_overall_status      ON material_requisitions(overall_status);
CREATE INDEX IF NOT EXISTS idx_mrs_jo_id               ON material_requisitions(jo_id);
CREATE INDEX IF NOT EXISTS idx_mrs_department          ON material_requisitions(department_id);
CREATE INDEX IF NOT EXISTS idx_mrs_created_at          ON material_requisitions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mrs_line_items_mrs      ON mrs_line_items(mrs_id);
CREATE INDEX IF NOT EXISTS idx_transmittals_mrs        ON transmittal_forms(mrs_id);
CREATE INDEX IF NOT EXISTS idx_transmittals_receiver   ON transmittal_forms(receiver_user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity    ON activity_logs(entity_type, entity_id, timestamp DESC);
