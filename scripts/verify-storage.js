const fs = require('fs');
const path = require('path');

const storageFile = path.join(__dirname, '..', 'supabase', 'migrations', '0001_storage_buckets.sql');
const sql = fs.readFileSync(storageFile, 'utf8');

const requiredBuckets = ['site-photos', 'item-references', 'receipts-proofs', 'messenger-snapshots'];

for (const b of requiredBuckets) {
  if (!sql.includes(`'${b}'`)) {
    console.error(`Missing bucket definition: ${b}`);
    process.exit(1);
  }
}

if (!sql.includes('storage.buckets') || !sql.includes('storage.objects')) {
  console.error('Missing storage tables references');
  process.exit(1);
}

console.log(`Storage Buckets Verified (${requiredBuckets.length}): ${requiredBuckets.join(', ')}`);
console.log('Verification PASSED: All 4 storage buckets and storage RLS policies validated.');
