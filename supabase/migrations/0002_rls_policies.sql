-- FixFlow ERP Database Migration: 0002_rls_policies.sql
-- Single Source of Truth from Plan.md §3.3 (Full Coverage for all 12 tables)

-- ============================================================================
-- 1. departments
-- ============================================================================
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read departments" ON departments
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Super admins can manage departments" ON departments
FOR ALL TO authenticated USING (
  (SELECT role FROM users WHERE id = auth.uid()) = 'SUPER_ADMIN'
);

-- ============================================================================
-- 2. users
-- ============================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own profile, dept, or elevated roles read all" ON users
FOR SELECT TO authenticated USING (
  id = auth.uid()
  OR department_id = (SELECT department_id FROM users WHERE id = auth.uid())
  OR (SELECT role FROM users WHERE id = auth.uid()) IN ('SUPER_ADMIN', 'MANAGER', 'BUDGET_OFFICER', 'ACCOUNTING')
);

CREATE POLICY "Super admin and managers create users" ON users
FOR INSERT TO authenticated WITH CHECK (
  (SELECT role FROM users WHERE id = auth.uid()) IN ('SUPER_ADMIN', 'MANAGER')
);

CREATE POLICY "Users update own profile or elevated roles manage" ON users
FOR UPDATE TO authenticated USING (
  id = auth.uid()
  OR (SELECT role FROM users WHERE id = auth.uid()) IN ('SUPER_ADMIN', 'MANAGER')
);

-- ============================================================================
-- 3. job_orders
-- ============================================================================
ALTER TABLE job_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dept-scoped JO read" ON job_orders
FOR SELECT TO authenticated USING (
  requester_id = auth.uid()
  OR (SELECT department_id FROM users WHERE id = auth.uid())
     = (SELECT department_id FROM users WHERE id = job_orders.requester_id)
  OR (SELECT role FROM users WHERE id = auth.uid())
     IN ('SUPER_ADMIN','MANAGER','MAINTENANCE')
);

CREATE POLICY "Any authenticated user creates a JO" ON job_orders
FOR INSERT TO authenticated WITH CHECK (requester_id = auth.uid());

CREATE POLICY "Requester or assigned roles update JO" ON job_orders
FOR UPDATE TO authenticated USING (
  requester_id = auth.uid()
  OR assignee_id = auth.uid()
  OR (SELECT role FROM users WHERE id = auth.uid())
     IN ('SUPER_ADMIN','MANAGER','MAINTENANCE')
);

-- ============================================================================
-- 4. material_requisitions
-- ============================================================================
ALTER TABLE material_requisitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read own dept MRS" ON material_requisitions
FOR SELECT TO authenticated USING (
  department_id IN (SELECT department_id FROM users WHERE id = auth.uid())
  OR (SELECT role FROM users WHERE id = auth.uid())
     IN ('SUPER_ADMIN','MANAGER','BUDGET_OFFICER','ACCOUNTING','PURCHASER')
);

CREATE POLICY "Requester creates own MRS" ON material_requisitions
FOR INSERT TO authenticated WITH CHECK (requester_id = auth.uid());

CREATE POLICY "Assigned roles update MRS" ON material_requisitions
FOR UPDATE TO authenticated USING (
  requester_id = auth.uid()
  OR (SELECT role FROM users WHERE id = auth.uid())
     IN ('SUPER_ADMIN','MANAGER','STOREKEEPER','BUDGET_OFFICER','ACCOUNTING','PURCHASER')
);

-- ============================================================================
-- 5. mrs_line_items
-- ============================================================================
ALTER TABLE mrs_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Line items inherit MRS access" ON mrs_line_items
FOR SELECT TO authenticated USING (
  mrs_id IN (SELECT id FROM material_requisitions)
);

CREATE POLICY "Line items write follows parent MRS" ON mrs_line_items
FOR ALL TO authenticated USING (
  mrs_id IN (SELECT id FROM material_requisitions)
);

-- ============================================================================
-- 6. transmittal_forms
-- ============================================================================
ALTER TABLE transmittal_forms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Financial roles transmittal access" ON transmittal_forms
FOR SELECT TO authenticated USING (
  sender_user_id = auth.uid()
  OR receiver_user_id = auth.uid()
  OR (SELECT role FROM users WHERE id = auth.uid())
     IN ('SUPER_ADMIN','ACCOUNTING','BUDGET_OFFICER','FRONT_DESK','PURCHASER')
);

CREATE POLICY "Financial roles create transmittals" ON transmittal_forms
FOR INSERT TO authenticated WITH CHECK (
  sender_user_id = auth.uid()
  OR (SELECT role FROM users WHERE id = auth.uid())
     IN ('SUPER_ADMIN','ACCOUNTING','BUDGET_OFFICER')
);

CREATE POLICY "Involved parties or financial managers update transmittals" ON transmittal_forms
FOR UPDATE TO authenticated USING (
  sender_user_id = auth.uid()
  OR receiver_user_id = auth.uid()
  OR (SELECT role FROM users WHERE id = auth.uid())
     IN ('SUPER_ADMIN','ACCOUNTING','BUDGET_OFFICER')
);

-- ============================================================================
-- 7. activity_logs
-- ============================================================================
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Append-only audit log" ON activity_logs
FOR INSERT TO authenticated WITH CHECK (performed_by = auth.uid());

CREATE POLICY "Audit log read scoped to role" ON activity_logs
FOR SELECT TO authenticated USING (
  (SELECT role FROM users WHERE id = auth.uid())
  IN ('SUPER_ADMIN','MANAGER','ACCOUNTING')
);

-- ============================================================================
-- 8. item_price_catalog
-- ============================================================================
ALTER TABLE item_price_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Catalog readable by all authenticated users" ON item_price_catalog
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Catalog managed by budget officer, purchaser, or super admin" ON item_price_catalog
FOR ALL TO authenticated USING (
  (SELECT role FROM users WHERE id = auth.uid())
  IN ('SUPER_ADMIN','BUDGET_OFFICER','PURCHASER')
);

-- ============================================================================
-- 9. attachments
-- ============================================================================
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Attachments readable by authenticated users" ON attachments
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Attachments uploaded by owner" ON attachments
FOR INSERT TO authenticated WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Attachments deleted by owner or super admin" ON attachments
FOR DELETE TO authenticated USING (
  uploaded_by = auth.uid()
  OR (SELECT role FROM users WHERE id = auth.uid()) = 'SUPER_ADMIN'
);

-- ============================================================================
-- 10. pms_assets
-- ============================================================================
ALTER TABLE pms_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PMS assets viewable by authenticated users" ON pms_assets
FOR SELECT TO authenticated USING (true);

CREATE POLICY "PMS assets managed by maintenance, manager, or super admin" ON pms_assets
FOR ALL TO authenticated USING (
  (SELECT role FROM users WHERE id = auth.uid())
  IN ('SUPER_ADMIN','MANAGER','MAINTENANCE')
);

-- ============================================================================
-- 11. pms_activity_logs
-- ============================================================================
ALTER TABLE pms_activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PMS activity viewable by maintenance, manager, super admin" ON pms_activity_logs
FOR SELECT TO authenticated USING (
  (SELECT role FROM users WHERE id = auth.uid())
  IN ('SUPER_ADMIN','MANAGER','MAINTENANCE')
);

CREATE POLICY "PMS activity logged by maintenance, manager, super admin" ON pms_activity_logs
FOR INSERT TO authenticated WITH CHECK (
  performed_by = auth.uid()
  AND (SELECT role FROM users WHERE id = auth.uid()) IN ('SUPER_ADMIN','MANAGER','MAINTENANCE')
);

-- ============================================================================
-- 12. number_sequences
-- ============================================================================
ALTER TABLE number_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Number sequences managed by authenticated users" ON number_sequences
FOR ALL TO authenticated USING (true);
