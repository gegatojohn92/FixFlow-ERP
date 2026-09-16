-- FixFlow ERP: 0006_seed_admin_user.sql
-- Seeds the initial SUPER_ADMIN department and user record.
--
-- IMPORTANT: Run this AFTER creating your first user via Supabase Auth Dashboard.
-- Replace the UUID and email below with the actual auth.users UUID for your admin.
--
-- HOW TO GET YOUR USER UUID:
--   1. Go to Supabase Dashboard → Authentication → Users
--   2. Find your admin user and copy their UUID
--   3. Replace 'YOUR_ADMIN_AUTH_UUID_HERE' with that UUID
--   4. Replace 'admin@yourcompany.com' with your admin email
--
-- Run this in: Supabase Dashboard → SQL Editor

-- Step 1: Ensure a default "Administration" department exists
INSERT INTO departments (department_name)
VALUES ('Administration')
ON CONFLICT DO NOTHING;

-- Step 2: Insert the SUPER_ADMIN user record
-- REPLACE the values below before running!
INSERT INTO users (id, email, full_name, role, department_id, account_status)
VALUES (
  'YOUR_ADMIN_AUTH_UUID_HERE',           -- Replace with UUID from Supabase Auth
  'admin@yourcompany.com',               -- Replace with your admin email
  'System Administrator',                -- Replace with your name
  'SUPER_ADMIN',
  (SELECT id FROM departments WHERE department_name = 'Administration' LIMIT 1),
  'ACTIVE'
)
ON CONFLICT (id) DO UPDATE
  SET account_status = 'ACTIVE',
      role = 'SUPER_ADMIN';
