const fs = require('fs');
const path = require('path');

const rlsFile = path.join(__dirname, '..', 'supabase', 'migrations', '0002_rls_policies.sql');
const sql = fs.readFileSync(rlsFile, 'utf8');

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
