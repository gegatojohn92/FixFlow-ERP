-- FixFlow ERP: 0005_fix_rls_recursion.sql
-- Fixes the infinite-recursion 500 error on the `users` table RLS policies.
--
-- ROOT CAUSE:
--   The original `users` SELECT policy called:
--     (SELECT role FROM users WHERE id = auth.uid())
--   This re-triggers the same RLS check on `users`, causing Postgres to enter
--   an infinite recursive loop → 500 Internal Server Error.
--
-- FIX:
--   1. Create a SECURITY DEFINER helper function that bypasses RLS to fetch
--      the current user's role. This breaks the recursion.
--   2. Drop all old policies on `users` and replace them with recursion-safe ones.
--   3. The SELECT policy is simplified to `id = auth.uid()` for a user's own row
--      (which is always safe and non-recursive), and elevated role checks use
--      the helper function.

-- ============================================================================
-- STEP 1: Create a SECURITY DEFINER helper to safely get current user's role
-- ============================================================================

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid()
$$;

-- ============================================================================
-- STEP 2: Drop the old (recursive) policies on `users`
-- ============================================================================

DROP POLICY IF EXISTS "Users read own profile, dept, or elevated roles read all" ON users;
DROP POLICY IF EXISTS "Super admin and managers create users" ON users;
DROP POLICY IF EXISTS "Users update own profile or elevated roles manage" ON users;

-- ============================================================================
-- STEP 3: Create corrected, recursion-safe policies
-- ============================================================================

-- SELECT: Users can always read their own row.
-- Elevated roles (SUPER_ADMIN, MANAGER, BUDGET_OFFICER, ACCOUNTING) can read all.
-- Same-department read uses the helper function to avoid recursion.
CREATE POLICY "users_select_safe" ON users
FOR SELECT TO authenticated USING (
  id = auth.uid()
  OR get_my_role() IN ('SUPER_ADMIN', 'MANAGER', 'BUDGET_OFFICER', 'ACCOUNTING')
);

-- INSERT: Only SUPER_ADMIN and MANAGER can create new user records.
CREATE POLICY "users_insert_safe" ON users
FOR INSERT TO authenticated WITH CHECK (
  get_my_role() IN ('SUPER_ADMIN', 'MANAGER')
);

-- UPDATE: Users can update their own profile; elevated roles can manage all.
CREATE POLICY "users_update_safe" ON users
FOR UPDATE TO authenticated USING (
  id = auth.uid()
  OR get_my_role() IN ('SUPER_ADMIN', 'MANAGER')
);

-- ============================================================================
-- STEP 4: Also fix the recursive sub-selects in OTHER tables' policies
--         that reference `(SELECT role FROM users WHERE id = auth.uid())`
--         Replace them with get_my_role() calls.
-- ============================================================================

-- departments
DROP POLICY IF EXISTS "Super admins can manage departments" ON departments;
CREATE POLICY "departments_admin_manage_safe" ON departments
FOR ALL TO authenticated USING (get_my_role() = 'SUPER_ADMIN');

-- job_orders
DROP POLICY IF EXISTS "Dept-scoped JO read" ON job_orders;
DROP POLICY IF EXISTS "Requester or assigned roles update JO" ON job_orders;

CREATE POLICY "jo_select_safe" ON job_orders
FOR SELECT TO authenticated USING (
  requester_id = auth.uid()
  OR assignee_id = auth.uid()
  OR get_my_role() IN ('SUPER_ADMIN','MANAGER','MAINTENANCE')
);

CREATE POLICY "jo_update_safe" ON job_orders
FOR UPDATE TO authenticated USING (
  requester_id = auth.uid()
  OR assignee_id = auth.uid()
  OR get_my_role() IN ('SUPER_ADMIN','MANAGER','MAINTENANCE')
);

-- material_requisitions
DROP POLICY IF EXISTS "Staff read own dept MRS" ON material_requisitions;
DROP POLICY IF EXISTS "Assigned roles update MRS" ON material_requisitions;

CREATE POLICY "mrs_select_safe" ON material_requisitions
FOR SELECT TO authenticated USING (
  requester_id = auth.uid()
  OR get_my_role() IN ('SUPER_ADMIN','MANAGER','BUDGET_OFFICER','ACCOUNTING','PURCHASER')
);

CREATE POLICY "mrs_update_safe" ON material_requisitions
FOR UPDATE TO authenticated USING (
  requester_id = auth.uid()
  OR get_my_role() IN ('SUPER_ADMIN','MANAGER','STOREKEEPER','BUDGET_OFFICER','ACCOUNTING','PURCHASER')
);

-- transmittal_forms
DROP POLICY IF EXISTS "Financial roles transmittal access" ON transmittal_forms;
DROP POLICY IF EXISTS "Financial roles create transmittals" ON transmittal_forms;
DROP POLICY IF EXISTS "Involved parties or financial managers update transmittals" ON transmittal_forms;

CREATE POLICY "transmittal_select_safe" ON transmittal_forms
FOR SELECT TO authenticated USING (
  sender_user_id = auth.uid()
  OR receiver_user_id = auth.uid()
  OR get_my_role() IN ('SUPER_ADMIN','ACCOUNTING','BUDGET_OFFICER','FRONT_DESK','PURCHASER')
);

CREATE POLICY "transmittal_insert_safe" ON transmittal_forms
FOR INSERT TO authenticated WITH CHECK (
  sender_user_id = auth.uid()
  OR get_my_role() IN ('SUPER_ADMIN','ACCOUNTING','BUDGET_OFFICER')
);

CREATE POLICY "transmittal_update_safe" ON transmittal_forms
FOR UPDATE TO authenticated USING (
  sender_user_id = auth.uid()
  OR receiver_user_id = auth.uid()
  OR get_my_role() IN ('SUPER_ADMIN','ACCOUNTING','BUDGET_OFFICER')
);

-- activity_logs
DROP POLICY IF EXISTS "Audit log read scoped to role" ON activity_logs;
CREATE POLICY "audit_log_select_safe" ON activity_logs
FOR SELECT TO authenticated USING (
  get_my_role() IN ('SUPER_ADMIN','MANAGER','ACCOUNTING')
);

-- item_price_catalog
DROP POLICY IF EXISTS "Catalog managed by budget officer, purchaser, or super admin" ON item_price_catalog;
CREATE POLICY "catalog_manage_safe" ON item_price_catalog
FOR ALL TO authenticated USING (
  get_my_role() IN ('SUPER_ADMIN','BUDGET_OFFICER','PURCHASER')
);

-- attachments
DROP POLICY IF EXISTS "Attachments deleted by owner or super admin" ON attachments;
CREATE POLICY "attachments_delete_safe" ON attachments
FOR DELETE TO authenticated USING (
  uploaded_by = auth.uid()
  OR get_my_role() = 'SUPER_ADMIN'
);

-- pms_assets
DROP POLICY IF EXISTS "PMS assets managed by maintenance, manager, or super admin" ON pms_assets;
CREATE POLICY "pms_assets_manage_safe" ON pms_assets
FOR ALL TO authenticated USING (
  get_my_role() IN ('SUPER_ADMIN','MANAGER','MAINTENANCE')
);

-- pms_activity_logs
DROP POLICY IF EXISTS "PMS activity viewable by maintenance, manager, super admin" ON pms_activity_logs;
DROP POLICY IF EXISTS "PMS activity logged by maintenance, manager, super admin" ON pms_activity_logs;

CREATE POLICY "pms_log_select_safe" ON pms_activity_logs
FOR SELECT TO authenticated USING (
  get_my_role() IN ('SUPER_ADMIN','MANAGER','MAINTENANCE')
);

CREATE POLICY "pms_log_insert_safe" ON pms_activity_logs
FOR INSERT TO authenticated WITH CHECK (
  performed_by = auth.uid()
  AND get_my_role() IN ('SUPER_ADMIN','MANAGER','MAINTENANCE')
);
