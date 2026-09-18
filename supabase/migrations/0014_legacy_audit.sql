-- ============================================================================
-- 0014 legacy audit — READ ONLY. Safe to re-run. Changes nothing.
--
-- Reconstructs what the three requisitions closed WITHOUT a requester sign-off
-- should have owed, using the same arithmetic Form 14 would have used:
--
--     spare change owed = mrs_disbursed_total(mrs) - total_actual_spent
--
-- `mrs_disbursed_total()` (0013) sums SENT/RECEIVED transmittals and excludes
-- SPARE_CHANGE_RETURN, so it is the cash that actually left the office.
--
-- Read `verdict` first:
--   CASH LIKELY UNCOLLECTED  → real money owed and never recorded. Investigate.
--   NOTHING OWED             → spent >= disbursed; the skipped sign-off cost
--                              nothing financially. Safe to leave closed.
--   NO CASH DISBURSED        → nothing ever went out (stock issue / COD).
--   ALREADY RECORDED         → change was recorded despite the missing sign-off.
-- ============================================================================

WITH affected AS (
  SELECT
    mr.id,
    mr.mrs_number,
    mr.overall_status,
    COALESCE(mr.requester_verification, 'PENDING_DELIVERY') AS verification,
    COALESCE(mr.total_actual_spent, 0)      AS spent,
    COALESCE(mr.allocated_budget, 0)        AS allocated,
    COALESCE(mr.spare_change_required, 0)   AS recorded_required,
    COALESCE(mr.spare_change_returned, 0)   AS recorded_returned,
    mrs_disbursed_total(mr.id)              AS disbursed,
    mr.created_at
  FROM material_requisitions mr
  WHERE mr.overall_status = 'CLOSED'
    AND COALESCE(mr.requester_verification, 'PENDING_DELIVERY') <> 'VERIFIED'
),
calc AS (
  SELECT
    a.*,
    ROUND(a.disbursed - a.spent, 2) AS owed_reconstructed,
    ROUND(a.disbursed - a.spent, 2) - a.recorded_returned AS gap
  FROM affected a
)
SELECT
  c.mrs_number,
  c.verification                                   AS sign_off_state,
  to_char(c.allocated,  'FM999999990.00')          AS allocated,
  to_char(c.disbursed,  'FM999999990.00')          AS cash_disbursed,
  to_char(c.spent,      'FM999999990.00')          AS actually_spent,
  to_char(GREATEST(c.owed_reconstructed, 0), 'FM999999990.00') AS should_have_owed,
  to_char(c.recorded_returned, 'FM999999990.00')   AS recorded_returned,
  CASE
    WHEN c.disbursed <= 0                THEN 'NO CASH DISBURSED — nothing to collect'
    WHEN c.owed_reconstructed <= 0.01    THEN 'NOTHING OWED — spent >= disbursed'
    WHEN c.gap <= 0.01                   THEN 'ALREADY RECORDED — change was captured'
    ELSE 'CASH LIKELY UNCOLLECTED — ' ||
         to_char(c.gap, 'FM999999990.00') || ' unaccounted for'
  END                                              AS verdict,
  -- Transmittals behind the disbursed figure, for the paper trail.
  COALESCE((
    SELECT string_agg(
             tf.transmittal_number || ' ' ||
             to_char(tf.amount, 'FM999999990.00') ||
             ' [' || tf.transmittal_type || '/' || tf.sender_status || '→' ||
             tf.receiver_status || ']',
             ', ' ORDER BY tf.transmittal_number)
    FROM transmittal_forms tf
    WHERE tf.mrs_id = c.id
  ), 'none')                                       AS transmittals,
  to_char(c.created_at, 'YYYY-MM-DD HH24:MI')      AS raised_on
FROM calc c
ORDER BY
  CASE WHEN c.disbursed > 0 AND c.gap > 0.01 THEN 0 ELSE 1 END,
  c.mrs_number;
