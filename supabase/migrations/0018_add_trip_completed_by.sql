-- ============================================================================
-- 0018: Separation of duties on the purchase → sign-off handoff (audit §A1c)
--
-- WHY
--   Gate C (`requester_verification = 'VERIFIED'`, Form 14) is scoped by
--   DEPARTMENT, and department scope is role-blind: a PURCHASER who belongs to
--   the requesting department can record the actuals on Form 13 and then sign
--   off their own delivery on Form 14 — buying and self-certifying receipt in
--   one pass. Nothing in the chain compared the two actors, because the MRS row
--   never recorded WHO executed the purchase trip: that lived only in
--   `activity_logs` ('PURCHASER_TRIP_COMPLETED'), whose SELECT policy
--   (0005 `audit_log_select_safe`) is limited to SUPER_ADMIN / MANAGER /
--   ACCOUNTING. A STAFF or PURCHASER verifier therefore cannot read the very
--   row that would disqualify them — an app-layer check against the audit log
--   fails open for exactly the case it exists to catch.
--
-- WHAT
--   Stamp the executor on the requisition itself, next to the actor stamps the
--   schema already carries (`fast_track_audited_by`, `availability_reported_by`,
--   `requester_decision_by`), and backfill it from the audit trail so historical
--   rows are covered too. `verifyDeliveryRequester()` then refuses a signer whose
--   id matches `trip_completed_by` (SUPER_ADMIN excepted).
--
--   Single writer: `purchaserCompleteTrip()` is the only action that writes
--   `total_actual_spent`, so one stamp point covers offline trips, online
--   orders and COD alike. Each call overwrites the stamp, so the column always
--   holds "who last recorded the actuals".
--
-- SCOPE
--   Data-only. No guard function, trigger or policy is created or replaced here —
--   the six gate functions from 0011-0017 are untouched, so 0018 has no ordering
--   hazard with them. A DB-level mirror of the check (a trigger on
--   `requester_verification`) is deferred: it needs the same actor comparison and
--   will be added together with the remaining §13.2 deferred columns.
--
-- SAFE TO RE-RUN: ADD COLUMN IF NOT EXISTS + a backfill restricted to rows where
--   the stamp is still NULL (it never overwrites a value the app has written).
--
-- Apply AFTER 0017. Then run 0018_verify.sql.
-- ============================================================================

ALTER TABLE material_requisitions
  ADD COLUMN IF NOT EXISTS trip_completed_by UUID NULL REFERENCES users(id);

COMMENT ON COLUMN material_requisitions.trip_completed_by IS
  'User who recorded the actuals on Form 13 (purchaserCompleteTrip). Form 14 delivery sign-off refuses this user — whoever bought the goods cannot also certify receipt of them (audit §A1c).';

-- Backfill: the most recent PURCHASER_TRIP_COMPLETED entry per requisition,
-- matching the semantic the app maintains from here on (last actor to record
-- actuals). Rows whose log entry is missing keep NULL — see 0018_verify.sql
-- check 3 for the inventory.
UPDATE material_requisitions m
SET trip_completed_by = l.performed_by
FROM (
  SELECT DISTINCT ON (mrs_id) mrs_id, performed_by
  FROM activity_logs
  WHERE action = 'PURCHASER_TRIP_COMPLETED'
    AND mrs_id IS NOT NULL
  ORDER BY mrs_id, timestamp DESC
) l
WHERE m.id = l.mrs_id
  AND m.trip_completed_by IS NULL;
