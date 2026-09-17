const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '..', 'supabase', 'migrations', '0001_initial_schema.sql');
const sql = fs.readFileSync(schemaPath, 'utf8');
const auditMigrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '0009_audit_events.sql');
const auditSql = fs.readFileSync(auditMigrationPath, 'utf8');

// Extract created types
const types = new Set();
const typeRegex = /CREATE\s+TYPE\s+(\w+)\s+AS\s+ENUM\s*\(([^)]+)\);/gi;
let match;
while ((match = typeRegex.exec(sql)) !== null) {
  types.add(match[1]);
}
console.log(`Types defined (${types.size}): ${Array.from(types).join(', ')}`);

// Extract created tables
const tables = new Set();
const tableRegex = /CREATE\s+TABLE\s+(\w+)\s*\(([\s\S]*?)\n\);/gi;
while ((match = tableRegex.exec(sql)) !== null) {
  tables.add(match[1]);
}
console.log(`Tables defined (${tables.size}): ${Array.from(tables).join(', ')}`);

// Expected enums from Plan.md §3.1
const expectedEnums = [
  'user_role', 'account_status', 'jo_priority', 'jo_status', 'mrs_type',
  'mrs_status', 'transmittal_type', 'transmittal_status', 'item_delivery_status',
  'pms_interval', 'asset_category', 'photo_context'
];

// Expected tables from Plan.md §3.2
const expectedTables = [
  'departments', 'users', 'job_orders', 'material_requisitions', 'mrs_line_items',
  'transmittal_forms', 'activity_logs', 'item_price_catalog', 'attachments',
  'pms_assets', 'pms_activity_logs', 'number_sequences'
];

const missingEnums = expectedEnums.filter(e => !types.has(e));
const missingTables = expectedTables.filter(t => !tables.has(t));

if (missingEnums.length > 0) {
  console.error('Missing enums:', missingEnums);
  process.exit(1);
}
if (missingTables.length > 0) {
  console.error('Missing tables:', missingTables);
  process.exit(1);
}

// Foreign key check
const fkRegex = /FOREIGN\s+KEY\s*\([^)]+\)\s+REFERENCES\s+(\w+)\s*\(([^)]+)\)/gi;
const referencedTables = new Set();
while ((match = fkRegex.exec(sql)) !== null) {
  referencedTables.add(match[1]);
}
console.log(`Foreign key references verified for: ${Array.from(referencedTables).join(', ')}`);
for (const ref of referencedTables) {
  if (!tables.has(ref)) {
    console.error(`Referenced table does not exist: ${ref}`);
    process.exit(1);
  }
}

console.log('Verification PASSED: All enums, core tables, and foreign keys match Plan.md specifications.');

const auditRequirements = [
  /CREATE TABLE audit_events/i,
  /audit_events_entity_history_idx/i,
  /audit_events_reference_idx/i,
  /audit_events_actor_idx/i,
  /audit_events_action_idx/i,
  /audit_events_occurred_at_idx/i,
  /audit_can_view_event/i,
  /idempotency_key[^\n]+UNIQUE/i,
];
const missingAuditRequirements = auditRequirements.filter(pattern => !pattern.test(auditSql));
if (missingAuditRequirements.length > 0) {
  console.error('Missing audit schema requirements:', missingAuditRequirements.map(pattern => pattern.toString()));
  process.exit(1);
}
console.log('Verification PASSED: Audit event table, indexes, visibility helper, and idempotency constraint are defined.');
