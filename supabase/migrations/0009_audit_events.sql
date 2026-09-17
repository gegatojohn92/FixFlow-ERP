-- FixFlow ERP: append-only business audit events
-- Stores historical actor context and record state transitions independently of UI logs.

CREATE TABLE audit_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  actor_name VARCHAR(100) NULL,
  actor_role user_role NULL,
  actor_department_id INT NULL REFERENCES departments(id) ON DELETE SET NULL,
  actor_department_name VARCHAR(100) NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INT NOT NULL,
  entity_department_id INT NULL REFERENCES departments(id) ON DELETE SET NULL,
  reference_code VARCHAR(100) NULL,
  action VARCHAR(100) NOT NULL,
  previous_state JSONB NULL,
  resulting_state JSONB NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id UUID NULL,
  idempotency_key VARCHAR(180) NULL UNIQUE,
  CONSTRAINT audit_events_entity_type_check CHECK (
    entity_type IN (
      'job_order', 'material_requisition', 'mrs_line_item',
      'transmittal_form', 'pms_asset', 'pms_activity_log',
      'item_price_catalog', 'user', 'system'
    )
  ),
  CONSTRAINT audit_events_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX audit_events_entity_history_idx
  ON audit_events(entity_type, entity_id, occurred_at DESC, id DESC);
CREATE INDEX audit_events_reference_idx
  ON audit_events(reference_code, occurred_at DESC);
CREATE INDEX audit_events_actor_idx
  ON audit_events(actor_user_id, occurred_at DESC);
CREATE INDEX audit_events_actor_department_idx
  ON audit_events(actor_department_id, occurred_at DESC);
CREATE INDEX audit_events_entity_department_idx
  ON audit_events(entity_department_id, occurred_at DESC);
CREATE INDEX audit_events_action_idx
  ON audit_events(action, occurred_at DESC);
CREATE INDEX audit_events_occurred_at_idx
  ON audit_events(occurred_at DESC);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION audit_can_view_event(
  p_actor_user_id UUID,
  p_actor_department_id INT,
  p_entity_department_id INT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users viewer
    WHERE viewer.id = auth.uid()
      AND viewer.account_status = 'ACTIVE'
      AND (
        viewer.role IN ('SUPER_ADMIN', 'MANAGER', 'BUDGET_OFFICER', 'ACCOUNTING')
        OR p_actor_user_id = auth.uid()
        OR p_actor_department_id = viewer.department_id
        OR p_entity_department_id = viewer.department_id
      )
  )
$$;

CREATE POLICY "Audit events append own actor" ON audit_events
FOR INSERT TO authenticated
WITH CHECK (
  actor_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.users viewer
    WHERE viewer.id = auth.uid()
      AND viewer.account_status = 'ACTIVE'
  )
);

CREATE POLICY "Audit events read authorized scope" ON audit_events
FOR SELECT TO authenticated
USING (audit_can_view_event(actor_user_id, actor_department_id, entity_department_id));

-- Audit records are immutable for ordinary application roles. There are
-- intentionally no UPDATE or DELETE policies.
REVOKE UPDATE, DELETE ON audit_events FROM authenticated;
GRANT SELECT, INSERT ON audit_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE audit_events_id_seq TO authenticated;

-- Preserve automated consequences of JO cancellation as distinct system events.
CREATE OR REPLACE FUNCTION audit_jo_cancellation_cascade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.overall_status IS DISTINCT FROM NEW.overall_status
     AND NEW.overall_status = 'VOIDED' THEN
    INSERT INTO audit_events (
      actor_user_id, actor_name, actor_role, entity_type, entity_id,
      entity_department_id, reference_code, action, previous_state,
      resulting_state, metadata
    )
    VALUES (
      NULL, 'System', NULL, 'material_requisition', NEW.id,
      NEW.department_id, NEW.mrs_number, 'MRS_VOIDED_BY_CASCADE',
      jsonb_build_object('overall_status', OLD.overall_status),
      jsonb_build_object('overall_status', NEW.overall_status),
      jsonb_build_object('cause', 'JOB_ORDER_CANCELLATION_CASCADE')
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_mrs_cancellation_cascade ON material_requisitions;
CREATE TRIGGER audit_mrs_cancellation_cascade
AFTER UPDATE OF overall_status ON material_requisitions
FOR EACH ROW EXECUTE FUNCTION audit_jo_cancellation_cascade();

CREATE OR REPLACE FUNCTION audit_transmittal_cancellation_cascade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_department_id INT;
BEGIN
  IF (OLD.sender_status IS DISTINCT FROM NEW.sender_status AND NEW.sender_status = 'CANCELLED')
     OR (OLD.receiver_status IS DISTINCT FROM NEW.receiver_status AND NEW.receiver_status = 'CANCELLED') THEN
    SELECT department_id INTO v_department_id
    FROM material_requisitions
    WHERE id = NEW.mrs_id;

    INSERT INTO audit_events (
      actor_user_id, actor_name, actor_role, entity_type, entity_id,
      entity_department_id, reference_code, action, previous_state,
      resulting_state, metadata
    )
    VALUES (
      NULL, 'System', NULL, 'transmittal_form', NEW.id,
      v_department_id, NEW.transmittal_number, 'TRANSMITTAL_CANCELLED_BY_CASCADE',
      jsonb_build_object('sender_status', OLD.sender_status, 'receiver_status', OLD.receiver_status),
      jsonb_build_object('sender_status', NEW.sender_status, 'receiver_status', NEW.receiver_status),
      jsonb_build_object('cause', 'JOB_ORDER_CANCELLATION_CASCADE')
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_transmittal_cancellation_cascade ON transmittal_forms;
CREATE TRIGGER audit_transmittal_cancellation_cascade
AFTER UPDATE OF sender_status, receiver_status ON transmittal_forms
FOR EACH ROW EXECUTE FUNCTION audit_transmittal_cancellation_cascade();
