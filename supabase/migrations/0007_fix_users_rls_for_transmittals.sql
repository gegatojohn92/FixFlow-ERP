-- FixFlow ERP Migration: 0007_fix_users_rls_for_transmittals.sql
-- Purpose: Allow financial-chain and management roles to view active users
--          with financial roles for transmittal routing (Plan.md §5 Form 10).

DROP POLICY IF EXISTS "users_select_financial_roles" ON users;

CREATE POLICY "users_select_financial_roles" ON users
FOR SELECT TO authenticated USING (
  -- Financial-chain roles can view all active financial-chain users
  get_my_role() IN ('SUPER_ADMIN', 'MANAGER', 'ACCOUNTING', 'BUDGET_OFFICER', 'FRONT_DESK', 'PURCHASER')
  AND role IN ('SUPER_ADMIN', 'ACCOUNTING', 'BUDGET_OFFICER', 'FRONT_DESK', 'PURCHASER')
  AND account_status = 'ACTIVE'
);
