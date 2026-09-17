-- FixFlow ERP: allow delivered linked MRS records to advance their JO.
-- Form 14 can legitimately move a JO from AWAITING_MRS_APPROVAL to MATERIALS_RECEIVED
-- after the linked requisition has been fulfilled and requester verification succeeds.

CREATE OR REPLACE FUNCTION guard_jo_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'PENDING_ASSESSMENT' AND NEW.status IN ('IN_PROGRESS', 'CANCELLED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'IN_PROGRESS' AND NEW.status IN ('AWAITING_MRS_APPROVAL', 'COMPLETED', 'CANCELLED', 'MRS_REJECTED') THEN
    RETURN NEW;
  ELSIF OLD.status = 'AWAITING_MRS_APPROVAL' AND NEW.status IN ('IN_PROGRESS', 'MATERIALS_RECEIVED', 'CANCELLED', 'MRS_REJECTED') THEN
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
