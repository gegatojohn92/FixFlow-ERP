-- ============================================================================
-- 0021_status_authority_and_fd_float_ack.sql
--
-- A6 + B4 hardening (run AFTER 0020):
--   A6: guard `material_requisitions.overall_status` by ACTOR, not only by the
--       transition chain. 0011/0013 already validate "may status X move to Y?";
--       this migration adds "may THIS ROLE perform X -> Y?".
--   B4: complete Rule 3 for Front Desk float legs. FD COD/replenishment rows are
--       created SENT/PENDING; Front Desk can now acknowledge the receiver side as
--       RECEIVED without being blocked by Accounting-only Rule 7 or by Gate B/C
--       checks that belong to MRS settlement transmittals.
--
-- Idempotent. Does not remove the existing transition guard; it adds a second
-- BEFORE UPDATE OF overall_status trigger for actor authority, and re-declares
-- the two transmittal guards whose bodies must change for B4.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A6 — actor authority for material_requisitions.overall_status
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_mrs_status_actor()
RETURNS TRIGGER AS $$
DECLARE
  v_role user_role;
  v_actor_department_id INT;
  v_is_same_department BOOLEAN;
  v_is_jo_requester BOOLEAN;
BEGIN
  IF OLD.overall_status IS NOT DISTINCT FROM NEW.overall_status THEN
    RETURN NEW;
  END IF;

  -- SQL Editor / service_role / idempotent backfills. The existing transition
  -- guard still validates the chain for ordinary writes; backfills must be able
  -- to repair legacy rows deliberately.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_role := get_my_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION
      'Requisition % cannot move from % to %: your user has no ACTIVE role record (0021 status actor gate).',
      NEW.mrs_number, OLD.overall_status, NEW.overall_status;
  END IF;

  -- SUPER_ADMIN remains the explicit override for every legal transition.
  IF v_role = 'SUPER_ADMIN' THEN
    RETURN NEW;
  END IF;

  v_actor_department_id := get_my_department_id();
  v_is_same_department := v_actor_department_id IS NOT NULL AND v_actor_department_id = NEW.department_id;

  -- JO cancellation cascade writes VOIDED as the user who cancelled the JO.
  -- Permit the same human authority the JO cancellation flow admits; the chain
  -- guard still refuses terminal -> VOIDED transitions.
  IF NEW.overall_status = 'VOIDED' AND OLD.overall_status NOT IN ('FULFILLED', 'CLOSED') THEN
    SELECT EXISTS (
      SELECT 1
        FROM job_orders jo
       WHERE jo.id = OLD.jo_id
         AND jo.requester_id = auth.uid()
    ) INTO v_is_jo_requester;

    IF auth.uid() = OLD.requester_id OR v_is_jo_requester OR v_role IN ('MANAGER', 'MAINTENANCE') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'Only the MRS requester, JO requester, Maintenance, Managers, or a Super Admin may void requisition % through the JO cancellation cascade (signed in as %).',
      NEW.mrs_number, v_role;
  END IF;

  -- Form 7 — Manager review.
  IF OLD.overall_status = 'PENDING_MANAGER'
     AND NEW.overall_status IN ('MANAGER_REJECTED', 'IN_CANVASSING')
     AND v_role = 'MANAGER' THEN
    RETURN NEW;
  END IF;

  -- Form 6 was retired by 0020. Legacy ISSUED_FROM_STOCK rows may only be
  -- produced/corrected by SUPER_ADMIN (handled by the override above).
  IF OLD.overall_status = 'PENDING_MANAGER'
     AND NEW.overall_status = 'ISSUED_FROM_STOCK' THEN
    RAISE EXCEPTION
      'The stock-check path was retired with Form 6; only a Super Admin may move requisition % to ISSUED_FROM_STOCK.',
      NEW.mrs_number;
  END IF;

  -- Re-opening rejected requisitions has no app writer in this deployment.
  -- Treat it as a console-only repair reserved to SUPER_ADMIN.
  IF (OLD.overall_status = 'MANAGER_REJECTED' AND NEW.overall_status = 'PENDING_MANAGER')
     OR (OLD.overall_status = 'OWNER_REJECTED' AND NEW.overall_status = 'PENDING_MANAGER') THEN
    RAISE EXCEPTION
      'Re-opening rejected requisition % is a Super Admin repair action only (0021 status actor gate).',
      NEW.mrs_number;
  END IF;

  -- Form 8 — canvass and off-platform Owner decision.
  IF OLD.overall_status = 'IN_CANVASSING'
     AND NEW.overall_status = 'PENDING_OWNER'
     AND v_role = 'BUDGET_OFFICER' THEN
    RETURN NEW;
  END IF;

  IF OLD.overall_status = 'PENDING_OWNER'
     AND NEW.overall_status IN ('OWNER_REJECTED', 'APPROVED_READY_TO_ORDER')
     AND v_role = 'BUDGET_OFFICER' THEN
    RETURN NEW;
  END IF;

  -- Forms 10/11 — cash issuance and Accounting disbursement.
  IF OLD.overall_status = 'APPROVED_READY_TO_ORDER'
     AND NEW.overall_status = 'TRANSMITTAL_IN_PROGRESS'
     AND v_role IN ('BUDGET_OFFICER', 'ACCOUNTING') THEN
    RETURN NEW;
  END IF;

  IF OLD.overall_status = 'TRANSMITTAL_IN_PROGRESS'
     AND NEW.overall_status = 'READY_FOR_PURCHASE'
     AND v_role = 'ACCOUNTING' THEN
    RETURN NEW;
  END IF;

  -- Form 13 — Purchaser cash confirmation, in-transit, and actuals.
  IF OLD.overall_status = 'READY_FOR_PURCHASE'
     AND NEW.overall_status = 'PURCHASING'
     AND v_role = 'PURCHASER' THEN
    RETURN NEW;
  END IF;

  IF OLD.overall_status = 'PURCHASING'
     AND NEW.overall_status IN ('PARTIALLY_FULFILLED_BUDGET_EXHAUSTED', 'FULFILLED', 'IN_TRANSIT')
     AND v_role = 'PURCHASER' THEN
    RETURN NEW;
  END IF;

  IF OLD.overall_status = 'EMERGENCY_FAST_TRACK'
     AND NEW.overall_status IN ('PURCHASING', 'FULFILLED', 'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED')
     AND v_role = 'PURCHASER' THEN
    RETURN NEW;
  END IF;

  -- Form 14 — requester's department delivery sign-off / dispute handling.
  -- A status-only PATCH is not enough: Form 14 also stamps the delivery verdict
  -- that Gate C reads. Requiring the matching requester_verification value here
  -- closes the A6 console path while preserving the real Form 14 writer.
  IF OLD.overall_status IN ('PARTIALLY_FULFILLED_BUDGET_EXHAUSTED', 'IN_TRANSIT', 'FULFILLED', 'DISPUTED')
     AND v_is_same_department
     AND (
       (NEW.overall_status = 'FULFILLED' AND NEW.requester_verification = 'VERIFIED')
       OR (NEW.overall_status = 'DISPUTED' AND NEW.requester_verification = 'DISPUTED')
     ) THEN
    RETURN NEW;
  END IF;

  -- Form 11 — Accounting close after Form 14 and spare-change reconciliation.
  IF OLD.overall_status = 'FULFILLED'
     AND NEW.overall_status = 'CLOSED'
     AND v_role = 'ACCOUNTING' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Requisition % cannot move from % to % by role % (0021 status actor gate). Use the owning form/role for this step.',
    NEW.mrs_number, OLD.overall_status, NEW.overall_status, v_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_mrs_status_actor ON material_requisitions;
CREATE TRIGGER trg_guard_mrs_status_actor
BEFORE UPDATE OF overall_status ON material_requisitions
FOR EACH ROW EXECUTE FUNCTION guard_mrs_status_actor();

-- ----------------------------------------------------------------------------
-- 2. B4 — Front Desk can update FD float transmittals it must acknowledge
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "transmittal_update_safe" ON transmittal_forms;
CREATE POLICY "transmittal_update_safe" ON transmittal_forms
FOR UPDATE TO authenticated USING (
  is_active_account()
  AND (
    sender_user_id = auth.uid()
    OR receiver_user_id = auth.uid()
    OR get_my_role() IN ('SUPER_ADMIN','ACCOUNTING','BUDGET_OFFICER','FRONT_DESK')
  )
);

-- ----------------------------------------------------------------------------
-- 3. B4 — field guard: RECEIVED remains Accounting-only except FD float legs
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

  IF NEW.amount IS DISTINCT FROM OLD.amount AND NOT v_is_admin THEN
    RAISE EXCEPTION
      'The amount on transmittal % is immutable once created (%). Void and re-issue it if the figure is wrong; only a Super Admin may amend it in place.',
      NEW.transmittal_number, OLD.amount;
  END IF;

  IF NEW.mrs_id IS DISTINCT FROM OLD.mrs_id AND NOT v_is_admin THEN
    RAISE EXCEPTION
      'Transmittal % cannot be re-pointed at another requisition (or detached from its requisition) — that would remove it from the spare-change and delivery sign-off gates. Void and re-issue it instead.',
      NEW.transmittal_number;
  END IF;

  IF NEW.transmittal_type IS DISTINCT FROM OLD.transmittal_type AND NOT v_is_admin THEN
    RAISE EXCEPTION
      'The type of transmittal % is immutable (%): re-typing it would change which cash-chain gates apply to it. Void and re-issue it instead.',
      NEW.transmittal_number, OLD.transmittal_type;
  END IF;

  IF (NEW.sender_user_id   IS DISTINCT FROM OLD.sender_user_id
   OR NEW.receiver_user_id IS DISTINCT FROM OLD.receiver_user_id) AND NOT v_is_admin THEN
    RAISE EXCEPTION
      'The sender/receiver on transmittal % cannot be changed after creation — the chain of custody records who handed cash to whom. Void and re-issue it instead.',
      NEW.transmittal_number;
  END IF;

  IF NEW.courier_tracking_barcode IS DISTINCT FROM OLD.courier_tracking_barcode
     AND NOT (v_is_admin OR v_role = 'FRONT_DESK') THEN
    RAISE EXCEPTION
      'The courier tracking barcode on transmittal % can only be corrected by Front Desk (Form 12) — you are signed in as %.',
      NEW.transmittal_number, v_role;
  END IF;

  IF NEW.sender_status = 'SENT'
     AND OLD.sender_status IS DISTINCT FROM NEW.sender_status
     AND NOT (v_is_admin OR v_role = 'ACCOUNTING') THEN
    RAISE EXCEPTION
      'Transmittal % can only be marked SENT by Accounting disbursing the cash (Form 11) — you are signed in as %.',
      NEW.transmittal_number, v_role;
  END IF;

  -- Accounting closes MRS-linked cash transmittals. Front Desk acknowledges the
  -- two FD float leg types created by Form 12; this is the missing B4 receipt leg.
  IF NEW.receiver_status = 'RECEIVED'
     AND OLD.receiver_status IS DISTINCT FROM NEW.receiver_status
     AND NOT (
       v_is_admin
       OR v_role = 'ACCOUNTING'
       OR (v_role = 'FRONT_DESK'
           AND NEW.transmittal_type IN ('FD_REVOLVING_DISBURSEMENT', 'FD_REVOLVING_REPLENISHMENT'))
     ) THEN
    RAISE EXCEPTION
      'Transmittal % can only be marked RECEIVED by Accounting (Form 11), or by Front Desk for FD float legs (Form 12) — you are signed in as %.',
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
-- 4. B4 — receipt guard: FD float acknowledgements are not MRS close receipts
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

  -- Dual confirmation (Rule 3): cash must have left before any receiver side is
  -- acknowledged. SPARE_CHANGE_RETURN rows are inserted already RECEIVED and
  -- also satisfy this check because sender_status is RECEIVED.
  IF NEW.sender_status NOT IN ('SENT', 'RECEIVED') THEN
    RAISE EXCEPTION
      'Transmittal % cannot be marked RECEIVED before it is marked SENT (chain of custody).',
      NEW.transmittal_number;
  END IF;

  -- These types are not Accounting's MRS close receipt. FD_REVOLVING_* rows are
  -- the Form 12 float ledger; acknowledging them should not require Form 14 or
  -- spare-change settlement on the linked requisition.
  IF NEW.transmittal_type IN ('SPARE_CHANGE_RETURN', 'FD_REVOLVING_DISBURSEMENT', 'FD_REVOLVING_REPLENISHMENT')
     OR NEW.mrs_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(spare_change_required, 0),
         COALESCE(spare_change_returned, 0),
         mrs_number,
         COALESCE(requester_verification, 'PENDING_DELIVERY'),
         overall_status
    INTO v_required, v_returned, v_number, v_verified, v_mrs_status
    FROM material_requisitions
   WHERE id = NEW.mrs_id;

  -- Gate C (0014): no MRS close receipt before requester sign-off.
  IF v_number IS NOT NULL AND v_verified <> 'VERIFIED' THEN
    RAISE EXCEPTION
      'Transmittal % cannot be closed: requisition % has not been verified as delivered by the requester (status "%") — 0014 Gate C.',
      NEW.transmittal_number, v_number, v_verified;
  END IF;

  -- Gate B (0013): spare change must be fully returned before close receipt.
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
