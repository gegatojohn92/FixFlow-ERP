const fs = require('fs');
const path = require('path');

const rlsFile = path.join(__dirname, '..', 'supabase', 'migrations', '0002_rls_policies.sql');
const sql = fs.readFileSync(rlsFile, 'utf8');
const auditRlsFile = path.join(__dirname, '..', 'supabase', 'migrations', '0009_audit_events.sql');
const auditSql = fs.readFileSync(auditRlsFile, 'utf8');

const all12Tables = [
  'departments', 'users', 'job_orders', 'material_requisitions', 'mrs_line_items',
  'transmittal_forms', 'activity_logs', 'item_price_catalog', 'attachments',
  'pms_assets', 'pms_activity_logs', 'number_sequences'
];

for (const table of all12Tables) {
  const rlsEnablePattern = new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
  if (!rlsEnablePattern.test(sql)) {
    console.error(`Missing ENABLE ROW LEVEL SECURITY for: ${table}`);
    process.exit(1);
  }

  const policyPattern = new RegExp(`CREATE\\s+POLICY\\s+"[^"]+"\\s+ON\\s+${table}`, 'i');
  if (!policyPattern.test(sql)) {
    console.error(`Missing CREATE POLICY for: ${table}`);
    process.exit(1);
  }
}

console.log(`RLS Policy Verification: All ${all12Tables.length} tables have RLS enabled and policies defined.`);
console.log('Verification PASSED: Full RLS coverage verified against Plan.md §3.3.');

const auditRlsRequirements = [
  /ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY/i,
  /CREATE POLICY "Audit events append own actor" ON audit_events/i,
  /CREATE POLICY "Audit events read authorized scope" ON audit_events/i,
  /REVOKE UPDATE, DELETE ON audit_events FROM authenticated/i,
];
const missingAuditRlsRequirements = auditRlsRequirements.filter(pattern => !pattern.test(auditSql));
if (missingAuditRlsRequirements.length > 0) {
  console.error('Missing audit RLS requirements:', missingAuditRlsRequirements.map(pattern => pattern.toString()));
  process.exit(1);
}
console.log('Verification PASSED: Audit RLS visibility and immutability requirements are defined.');
