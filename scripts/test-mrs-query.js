const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim();
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function testQuery() {
  console.log('Testing query on material_requisitions without online_screenshot_url...');
  const { data, error } = await supabase
    .from('material_requisitions')
    .select(`
      id, mrs_number, request_type, purpose, created_at, overall_status,
      total_estimated_cost, allocated_budget, total_actual_spent,
      manager_rejection_reason, owner_rejection_reason,
      is_emergency_fast_track, fast_track_audited_at,
      is_online_purchase, online_supplier_url, est_shipping_fee,
      department:departments(department_name),
      requester:users!material_requisitions_requester_id_fkey(full_name),
      job_order:job_orders!material_requisitions_jo_id_fkey(jo_number, title),
      mrs_line_items(id, item_description, qty_requested, qty_issued_from_stock, unit, store_name, est_unit_price, reference_photo_url)
    `);

  if (error) {
    console.error('FAILED with error:', error);
  } else {
    console.log('SUCCESS! Rows found:', data.length);
    console.log('First row (if any):', data[0] ? { id: data[0].id, mrs_number: data[0].mrs_number, items: data[0].mrs_line_items?.length } : 'No rows');
  }
}

testQuery();
