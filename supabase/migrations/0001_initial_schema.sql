-- FixFlow ERP Database Migration: 0001_initial_schema.sql
-- Single Source of Truth from Plan.md §3.1 & §3.2

-- ============================================================================
-- 3.1 ENUMS
-- ============================================================================

CREATE TYPE user_role AS ENUM (
  'SUPER_ADMIN', 'MANAGER', 'BUDGET_OFFICER', 'ACCOUNTING', 'PURCHASER',
  'MAINTENANCE', 'FRONT_DESK', 'STAFF', 'STOREKEEPER'
);

CREATE TYPE account_status AS ENUM ('ACTIVE', 'INACTIVE', 'PASSWORD_RESET_REQUIRED');

-- 3-tier priority (Plan.md §0 / Addendum §1, §3)
CREATE TYPE jo_priority AS ENUM ('NORMAL', 'URGENT', 'EMERGENCY');

-- Statuses including MATERIALS_RECEIVED (Plan.md §3.1)
CREATE TYPE jo_status AS ENUM (
  'PENDING_ASSESSMENT', 'IN_PROGRESS', 'AWAITING_MRS_APPROVAL', 'MRS_REJECTED',
  'COMPLETED', 'MATERIALS_RECEIVED', 'CLOSED',
  'REOPENED_UNRESOLVED', 'CRITICAL_REOPEN_ESCALATED', 'CANCELLED'
);

CREATE TYPE mrs_type AS ENUM ('STANDALONE', 'JOB_ORDER');

-- Statuses including CLOSED (Plan.md §0.6 / §3.1)
CREATE TYPE mrs_status AS ENUM (
  'PENDING_MANAGER', 'MANAGER_REJECTED', 'IN_CANVASSING', 'PENDING_OWNER',
  'OWNER_REJECTED', 'APPROVED_READY_TO_ORDER', 'IN_TRANSIT',
  'TRANSMITTAL_IN_PROGRESS', 'READY_FOR_PURCHASE', 'PURCHASING', 'FULFILLED',
  'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED', 'DISPUTED', 'EMERGENCY_FAST_TRACK',
  'ISSUED_FROM_STOCK', 'VOIDED', 'CLOSED'
);

CREATE TYPE transmittal_type AS ENUM (
  'INITIAL_DISBURSEMENT', 'SPARE_CHANGE_RETURN', 'SUPPLEMENTAL_DISBURSEMENT',
  'EMERGENCY_REIMBURSEMENT', 'DIRECT_ONLINE_DISBURSEMENT',
  'FD_REVOLVING_DISBURSEMENT', 'FD_REVOLVING_REPLENISHMENT',
  'ONLINE_COD_ADVANCE', 'BATCH_DISBURSEMENT'
);

CREATE TYPE transmittal_status AS ENUM ('PENDING', 'SENT', 'RECEIVED', 'CANCELLED');

CREATE TYPE item_delivery_status AS ENUM (
  'PENDING', 'IN_TRANSIT', 'DELIVERED', 'BACKORDERED', 'BUDGET_EXHAUSTED', 'UNAVAILABLE'
);

CREATE TYPE pms_interval AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM_MONTHS', 'YEARLY');

CREATE TYPE asset_category AS ENUM (
  'HVAC', 'ELECTRICAL', 'PLUMBING', 'STRUCTURAL', 'KITCHEN_EQUIPMENT', 'GENERAL'
);

CREATE TYPE photo_context AS ENUM (
  'JO_SITE_PHOTO', 'JO_REOPEN_PHOTO', 'MRS_ITEM_REFERENCE',
  'MRS_ONLINE_SCREENSHOT', 'PURCHASE_RECEIPT', 'DELIVERY_PROOF',
  'AIRCON_SERVICE_PHOTO', 'FD_COD_RECEIPT'
);

-- ============================================================================
-- 3.2 CORE TABLES (12 total — Plan.md §0.3 & §3.2)
-- ============================================================================

-- 1. Departments
CREATE TABLE departments (
  id SERIAL PRIMARY KEY,
  department_name VARCHAR(100) NOT NULL
);

-- 2. Users (mirrors Supabase Auth)
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(100) UNIQUE NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role user_role NOT NULL DEFAULT 'STAFF',
  department_id INT NOT NULL,
  account_status account_status NOT NULL DEFAULT 'PASSWORD_RESET_REQUIRED',
  created_by UUID NULL,
  last_login_at TIMESTAMP NULL,
  deactivated_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 3. Job Orders
CREATE TABLE job_orders (
  id SERIAL PRIMARY KEY,
  jo_number VARCHAR(50) UNIQUE NOT NULL,
  revision_suffix INT DEFAULT 0,
  location VARCHAR(150) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  priority jo_priority DEFAULT 'NORMAL',
  status jo_status DEFAULT 'PENDING_ASSESSMENT',
  site_photo_url VARCHAR(255) NULL,
  requester_id UUID NOT NULL,
  assignee_id UUID NULL,
  reopen_count INT DEFAULT 0,
  is_emergency_fast_track BOOLEAN DEFAULT FALSE,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (requester_id) REFERENCES users(id),
  FOREIGN KEY (assignee_id) REFERENCES users(id)
);

-- 4. Material Requisitions (MRS)
CREATE TABLE material_requisitions (
  id SERIAL PRIMARY KEY,
  mrs_number VARCHAR(50) UNIQUE NOT NULL,
  request_type mrs_type NOT NULL,
  jo_id INT NULL,
  department_id INT NOT NULL,
  requester_id UUID NOT NULL,
  purpose TEXT NOT NULL,
  is_online_purchase BOOLEAN DEFAULT FALSE,
  online_tracking_number VARCHAR(100) NULL,
  est_shipping_fee DECIMAL(10,2) DEFAULT 0.00,
  actual_shipping_fee DECIMAL(10,2) DEFAULT 0.00,
  online_supplier_url TEXT NULL,
  revolving_fund_used BOOLEAN DEFAULT FALSE,
  manager_status VARCHAR(50) DEFAULT 'PENDING',
  manager_rejection_reason TEXT NULL,
  manager_reviewed_at TIMESTAMP NULL,
  total_estimated_cost DECIMAL(10,2) DEFAULT 0.00,
  allocated_budget DECIMAL(10,2) DEFAULT 0.00,
  total_actual_spent DECIMAL(10,2) DEFAULT 0.00,
  spare_change_amount DECIMAL(10,2) DEFAULT 0.00,
  budget_variance_amount DECIMAL(10,2) DEFAULT 0.00,
  owner_status VARCHAR(50) DEFAULT 'PENDING',
  owner_rejection_reason TEXT NULL,
  owner_reviewed_at TIMESTAMP NULL,
  delivery_status VARCHAR(50) DEFAULT 'PENDING_PURCHASE',
  requester_verification VARCHAR(50) DEFAULT 'PENDING_DELIVERY',
  verification_notes TEXT NULL,
  verified_at TIMESTAMP NULL,
  overall_status mrs_status DEFAULT 'PENDING_MANAGER',
  is_emergency_fast_track BOOLEAN DEFAULT FALSE,
  fast_track_cap_amount DECIMAL(10,2) DEFAULT 3000.00,
  fast_track_audited_at TIMESTAMP NULL,
  fast_track_audited_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (jo_id) REFERENCES job_orders(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (requester_id) REFERENCES users(id)
);

-- 5. MRS Line Items
CREATE TABLE mrs_line_items (
  id SERIAL PRIMARY KEY,
  mrs_id INT NOT NULL,
  item_description VARCHAR(255) NOT NULL,
  qty_requested INT NOT NULL,
  qty_fulfilled INT DEFAULT 0,
  qty_issued_from_stock INT DEFAULT 0,
  unit VARCHAR(50) NOT NULL,
  reference_photo_url VARCHAR(255) NULL,
  store_name VARCHAR(150) NULL,
  est_unit_price DECIMAL(10,2) DEFAULT 0.00,
  actual_unit_price DECIMAL(10,2) DEFAULT 0.00,
  vendor_rating INT DEFAULT 5,
  is_overpriced BOOLEAN DEFAULT FALSE,
  item_delivery_status item_delivery_status DEFAULT 'PENDING',
  purchased_at TIMESTAMP NULL,
  FOREIGN KEY (mrs_id) REFERENCES material_requisitions(id) ON DELETE CASCADE
);

-- 6. Financial Transmittal Forms
CREATE TABLE transmittal_forms (
  id SERIAL PRIMARY KEY,
  transmittal_number VARCHAR(50) UNIQUE NOT NULL,
  mrs_id INT NULL,
  batch_code VARCHAR(50) NULL,
  transmittal_type transmittal_type NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  sender_user_id UUID NOT NULL,
  sender_status transmittal_status DEFAULT 'PENDING',
  sent_at TIMESTAMP NULL,
  receiver_user_id UUID NOT NULL,
  receiver_status transmittal_status DEFAULT 'PENDING',
  received_at TIMESTAMP NULL,
  courier_tracking_barcode VARCHAR(100) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (mrs_id) REFERENCES material_requisitions(id),
  FOREIGN KEY (sender_user_id) REFERENCES users(id),
  FOREIGN KEY (receiver_user_id) REFERENCES users(id)
);

-- 7. Activity & Audit Logs
CREATE TABLE activity_logs (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INT NOT NULL,
  action VARCHAR(100) NOT NULL,
  jo_id INT NULL,
  mrs_id INT NULL,
  transmittal_id INT NULL,
  reference_code VARCHAR(100) NOT NULL,
  details_notes TEXT NULL,
  performed_by UUID NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (jo_id) REFERENCES job_orders(id) ON DELETE SET NULL,
  FOREIGN KEY (mrs_id) REFERENCES material_requisitions(id) ON DELETE SET NULL,
  FOREIGN KEY (transmittal_id) REFERENCES transmittal_forms(id) ON DELETE SET NULL,
  FOREIGN KEY (performed_by) REFERENCES users(id)
);

-- 8. Item Price Catalog (Forms 5, 8, 13)
CREATE TABLE item_price_catalog (
  id SERIAL PRIMARY KEY,
  item_description VARCHAR(255) NOT NULL,
  store_name VARCHAR(150) NOT NULL,
  last_unit_price DECIMAL(10,2) NOT NULL,
  is_overpriced_flag BOOLEAN DEFAULT FALSE,
  overpriced_flag_count INT DEFAULT 0,
  last_purchased_at TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (item_description, store_name)
);

-- 9. Attachments (Forms 1, 5, 13, 16)
CREATE TABLE attachments (
  id SERIAL PRIMARY KEY,
  context photo_context NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INT NOT NULL,
  file_url VARCHAR(255) NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);

-- 10. PMS Assets (Forms 15, 16)
CREATE TABLE pms_assets (
  id SERIAL PRIMARY KEY,
  asset_name VARCHAR(150) NOT NULL,
  category asset_category NOT NULL,
  location VARCHAR(150) NOT NULL,
  interval_type pms_interval NOT NULL,
  interval_custom_months INT NULL,
  last_performed_date DATE NULL,
  next_due_date DATE NOT NULL,
  is_aircon BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. PMS Activity Logs
CREATE TABLE pms_activity_logs (
  id SERIAL PRIMARY KEY,
  asset_id INT NOT NULL REFERENCES pms_assets(id),
  performed_by UUID NOT NULL REFERENCES users(id),
  checklist_json JSONB NOT NULL,
  freon_pressure_psi DECIMAL(6,2) NULL,
  compressor_amperage DECIMAL(6,2) NULL,
  performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. Number Sequences (Utility for atomic numbering)
CREATE TABLE number_sequences (
  entity_prefix VARCHAR(10) NOT NULL,
  year INT NOT NULL,
  last_value INT NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_prefix, year)
);
