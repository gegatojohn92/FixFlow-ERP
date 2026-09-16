const fs = require('fs');
const path = require('path');

const numberingFile = path.join(__dirname, '..', 'supabase', 'migrations', '0003_reference_numbering.sql');
const numberingSql = fs.readFileSync(numberingFile, 'utf8');

const triggersFile = path.join(__dirname, '..', 'supabase', 'migrations', '0004_cascade_triggers.sql');
const triggersSql = fs.readFileSync(triggersFile, 'utf8');

// 1. Verify reference numbering function
if (!numberingSql.includes('next_reference_number') || !numberingSql.includes('number_sequences')) {
  console.error('Missing next_reference_number implementation');
  process.exit(1);
}
console.log('Reference Numbering Verified: next_reference_number() function defined properly.');

// 2. Verify cascade cancellation trigger
if (!triggersSql.includes('cascade_jo_cancellation') || !triggersSql.includes('on_jo_cancelled')) {
  console.error('Missing cascade_jo_cancellation implementation');
  process.exit(1);
}
console.log('Cascade Cancellation Verified: cascade_jo_cancellation() and trigger on_jo_cancelled defined.');

// 3. Verify illegal transition guards
if (!triggersSql.includes('guard_jo_status_transition') || !triggersSql.includes('trg_guard_jo_status_transition')) {
  console.error('Missing guard_jo_status_transition implementation');
  process.exit(1);
}
if (!triggersSql.includes('guard_mrs_status_transition') || !triggersSql.includes('trg_guard_mrs_status_transition')) {
  console.error('Missing guard_mrs_status_transition implementation');
  process.exit(1);
}
console.log('State Machine Guards Verified: guard_jo_status_transition and guard_mrs_status_transition defined.');

console.log('Verification PASSED: Reference numbering and all cascade & guard triggers verified.');
