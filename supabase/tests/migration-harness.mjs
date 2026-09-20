#!/usr/bin/env node
/**
 * FixFlow-ERP migration harness.
 *
 * Boots a REAL PostgreSQL (embedded-postgres), replays `supabase/migrations` in
 * order, seeds the roles/departments the RLS policies need, and asserts the
 * behaviour of the guards the app depends on — each case run as a signed-in role
 * inside a rolled-back transaction with per-step savepoints.
 *
 * WHY THIS EXISTS
 *   Two audit findings were only visible by EXECUTING the SQL, not by reading it:
 *     · A4 — 0011's `cascade_jo_cancellation()` was broken twice over (an
 *       `EXTRACT` numeric→int resolution failure, and RLS blindness inside a
 *       non-DEFINER trigger). Each defect masked the other, so no reader caught
 *       either; the harness ran the cascade as MANAGER / STAFF / SUPER_ADMIN and
 *       compared the resulting `transmittal_forms` rows.
 *     · A3 — the spend ceiling: `spare_change_required = disbursed − spent` makes
 *       a self-reported figure subtractive, which only bites when you write one.
 *   Every migration since is asserted here before it is handed to the owner.
 *
 * USAGE
 *   cd supabase/tests && npm install && npm test
 *
 * `embedded-postgres` is a devDependency of THIS folder only and must never enter
 * the app's package.json (agent_handoff §10.9). The cluster lives in `.pg-data/`
 * (gitignored) and is destroyed on every run.
 *
 * ASSERTION RULE (important)
 *   A negative case passes when the attempt RAISED **or** the probed value is
 *   provably unchanged. RLS hiding a row makes an attack a silent 0-row no-op,
 *   which would otherwise look like a pass for the wrong reason — so every
 *   negative re-reads the row as postgres (RLS bypassed) before and after, and
 *   the report says *how* the attempt was stopped.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import EmbeddedPostgres from 'embedded-postgres'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MIG = path.resolve(HERE, '..', 'migrations')
const DATA = path.join(HERE, '.pg-data')
const PORT = 55432

// Storage-schema migrations (0001_storage_buckets, 0008) need Supabase's `storage`
// schema and the auth seed (0006) needs a real auth.users row — none of which exist
// in a bare cluster. Everything else is applied, in order.
const APPLY = [
  '0001_initial_schema.sql', '0002_rls_policies.sql', '0003_reference_numbering.sql',
  '0004_cascade_triggers.sql', '0005_fix_rls_recursion.sql',
  '0007_fix_users_rls_for_transmittals.sql', '0009_audit_events.sql',
  '0010_fix_jo_delivery_transition.sql', '0011_jo_mrs_flow_enhancements.sql',
  '0012_strong_mrs_flow_gates.sql', '0013_availability_and_spare_change_gates.sql',
  '0014_delivery_signoff_gate.sql', '0015_cash_chain_gates.sql',
  '0016_gate_input_protection.sql', '0017_fix_jo_cancellation_cascade.sql',
  '0018_add_trip_completed_by.sql', '0019_spend_ceiling_and_overspend_reason.sql',
]

const VERIFY = ['0016_verify.sql', '0017_verify.sql', '0018_verify.sql', '0019_verify.sql']

// Fixed UUIDs so a case can name an actor without a lookup.
const U = {
  SUPER_ADMIN:    '11111111-1111-1111-1111-111111111111',
  MANAGER:        '22222222-2222-2222-2222-222222222222',
  BUDGET_OFFICER: '33333333-3333-3333-3333-333333333333',
  ACCOUNTING:     '44444444-4444-4444-4444-444444444444',
  PURCHASER:      '55555555-5555-5555-5555-555555555555', // dept 2 — outsider
  PURCHASER_SAME: '55555555-5555-5555-5555-555555555556', // dept 1 — A1c residual
  STOREKEEPER:    '66666666-6666-6666-6666-666666666666',
  MAINTENANCE:    '77777777-7777-7777-7777-777777777777',
  FRONT_DESK:     '88888888-8888-8888-8888-888888888888',
  STAFF:          '99999999-9999-9999-9999-999999999999', // dept 1 — the requester
  STAFF_OTHER:    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', // dept 2 — outsider
}

const results = []
const record = (kind, name, ok, note) => results.push({ kind, name, ok, note })

async function main() {
  fs.rmSync(DATA, { recursive: true, force: true })
  const db = new EmbeddedPostgres({
    databaseDir: DATA, user: 'postgres', password: 'postgres', port: PORT,
    persistent: false, postgresOptions: { listen_addresses: 'localhost' },
  })
  await db.initialise(); await db.start(); await db.createDatabase('fixflow')

  const client = new pg.Client({
    host: 'localhost', port: PORT, user: 'postgres', password: 'postgres', database: 'fixflow',
  })
  await client.connect()

  // Supabase provides the `auth` schema and `auth.uid()`; a bare cluster does not.
  // Every guard calls auth.uid(), and get_my_role() is SECURITY DEFINER over
  // public.users, so this is the only auth surface the migrations need.
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')         THEN CREATE ROLE anon         NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role  NOLOGIN BYPASSRLS; END IF;
    END $$;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT COALESCE(current_setting('request.jwt.claim.sub', true),
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
    $$;`)

  console.log('Replaying migrations…')
  for (const f of APPLY) {
    try {
      await client.query(fs.readFileSync(path.join(MIG, f), 'utf8'))
      console.log(`  ok   ${f}`)
    } catch (e) {
      console.log(`  FAIL ${f}: ${e.message.split('\n')[0]}`)
      await client.end(); await db.stop(); process.exit(1)
    }
  }

  // In Supabase, tables are granted to `authenticated` and RLS is the real gate.
  await client.query(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT ALL ON ALL TABLES    IN SCHEMA public TO authenticated;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;`)

  // ── fixtures: two departments, one user per role ──────────────────────────
  await client.query(`
    INSERT INTO departments (id, department_name) VALUES (1,'Housekeeping'),(2,'Kitchen')
      ON CONFLICT (id) DO NOTHING;
    SELECT setval(pg_get_serial_sequence('departments','id'), 2);
    INSERT INTO users (id, email, full_name, role, department_id, account_status) VALUES
      ('${U.SUPER_ADMIN}',    'sa@fixflow.test',       'Super Admin',    'SUPER_ADMIN',    1, 'ACTIVE'),
      ('${U.MANAGER}',        'manager@fixflow.test',  'Manager',        'MANAGER',        1, 'ACTIVE'),
      ('${U.BUDGET_OFFICER}', 'bo@fixflow.test',       'Budget Officer', 'BUDGET_OFFICER', 1, 'ACTIVE'),
      ('${U.ACCOUNTING}',     'acct@fixflow.test',     'Accounting',     'ACCOUNTING',     1, 'ACTIVE'),
      ('${U.PURCHASER}',      'purch@fixflow.test',    'Purchaser',      'PURCHASER',      2, 'ACTIVE'),
      ('${U.PURCHASER_SAME}', 'purch2@fixflow.test',   'Purchaser Same', 'PURCHASER',      1, 'ACTIVE'),
      ('${U.STOREKEEPER}',    'sk@fixflow.test',       'Storekeeper',    'STOREKEEPER',    1, 'ACTIVE'),
      ('${U.MAINTENANCE}',    'maint@fixflow.test',    'Maintenance',    'MAINTENANCE',    2, 'ACTIVE'),
      ('${U.FRONT_DESK}',     'fd@fixflow.test',       'Front Desk',     'FRONT_DESK',     1, 'ACTIVE'),
      ('${U.STAFF}',          'staff@fixflow.test',    'Requester',      'STAFF',          1, 'ACTIVE'),
      ('${U.STAFF_OTHER}',    'other@fixflow.test',    'Outsider',       'STAFF',          2, 'ACTIVE');`)

  /**
   * Seed a requisition (and optionally its cash) in a state the guards would
   * otherwise refuse to produce. Fixture setup only: 0015's cash-entry gates
   * legitimately reject INSERTing a SENT transmittal onto an already-shipped
   * requisition, which is exactly the historical state several cases need.
   * Triggers are live for every assertion.
   */
  async function seedMRS(id, o = {}) {
    const {
      status = 'PURCHASING', verification = 'PENDING_DELIVERY', spent = 0, disbursed = 0,
      dept = 1, required = 0, returned = 0, allocated = 1000, sender = 'SENT',
      joId = null, fastTrack = false, cap = null, reason = null, tripBy = null,
      online = false,
    } = o
    for (const t of ['transmittal_forms', 'mrs_line_items', 'material_requisitions'])
      await client.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`)
    try {
      await client.query(`DELETE FROM transmittal_forms WHERE mrs_id = $1`, [id])
      await client.query(`DELETE FROM mrs_line_items WHERE mrs_id = $1`, [id])
      await client.query(`DELETE FROM material_requisitions WHERE id = $1`, [id])
      await client.query(
        `INSERT INTO material_requisitions
           (id, mrs_number, request_type, jo_id, department_id, requester_id, purpose,
            overall_status, allocated_budget, total_actual_spent, requester_verification,
            spare_change_required, spare_change_returned, is_emergency_fast_track,
            fast_track_cap_amount, overspend_reason, trip_completed_by, is_online_purchase)
         VALUES ($1,$2,'STANDALONE',$3,$4,$5,'fixture',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [id, 'MRS-2026-' + String(id).padStart(6, '0'), joId, dept, U.STAFF, status,
         allocated, spent, verification, required, returned, fastTrack, cap, reason, tripBy, online])
      await client.query(
        `INSERT INTO mrs_line_items (mrs_id, item_description, qty_requested, unit, est_unit_price)
         VALUES ($1,'Fixture item',10,'pcs',100.00)`, [id])
      if (disbursed > 0) await client.query(
        `INSERT INTO transmittal_forms
           (transmittal_number, mrs_id, transmittal_type, amount, sender_user_id, sender_status,
            receiver_user_id, receiver_status)
         VALUES ($1,$2,'INITIAL_DISBURSEMENT',$3,$4,$5,$6,'PENDING')`,
        ['TR-2026-' + String(id).padStart(6, '0'), id, disbursed, U.ACCOUNTING, sender, U.PURCHASER])
    } finally {
      for (const t of ['transmittal_forms', 'mrs_line_items', 'material_requisitions'])
        await client.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`)
    }
  }

  async function seedJO(id, o = {}) {
    const { status = 'IN_PROGRESS', requester = U.STAFF } = o
    await client.query(`ALTER TABLE job_orders DISABLE TRIGGER USER`)
    try {
      await client.query(`DELETE FROM job_orders WHERE id = $1`, [id])
      await client.query(
        `INSERT INTO job_orders (id, jo_number, location, title, description, requester_id, status, priority)
         VALUES ($1,$2,'Kitchen','Fixture JO','fixture',$3,$4,'NORMAL')`,
        [id, 'JO-2026-' + String(id).padStart(4, '0'), requester, status])
    } finally {
      await client.query(`ALTER TABLE job_orders ENABLE TRIGGER USER`)
    }
  }

  /** Run steps as signed-in roles inside ONE transaction (always rolled back). */
  async function runTx(steps) {
    await client.query('BEGIN')
    const log = []
    try {
      for (const st of steps) {
        // Each step gets a savepoint: a rejected statement aborts the transaction,
        // and without ROLLBACK TO SAVEPOINT every later probe would fail with
        // "current transaction is aborted".
        await client.query('SAVEPOINT step_sp')
        if (st.as === 'postgres') {
          await client.query('RESET ROLE')
        } else {
          await client.query('SET LOCAL ROLE authenticated')
          await client.query(`SELECT set_config('request.jwt.claims', '{"sub":"${U[st.as]}"}', true)`)
        }
        if (st.read) {
          const rows = (await client.query(st.read)).rows
          log.push({ label: st.label, read: true, rows })
          await client.query('RELEASE SAVEPOINT step_sp')
          continue
        }
        try {
          const r = await client.query(st.sql)
          log.push({ label: st.label, ok: true, rowCount: r.rowCount })
          await client.query('RELEASE SAVEPOINT step_sp')
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT step_sp')
          log.push({ label: st.label, ok: false, error: e.message.split('\n')[0] })
        }
      }
    } finally {
      await client.query('RESET ROLE')
      await client.query('ROLLBACK')
    }
    return log
  }

  const asOk = async (kind, name, as, sql) => {
    const [r] = await runTx([{ as, sql, label: 'attempt' }])
    record(kind, name, r.ok,
      r.ok ? `allowed (${r.rowCount} row)` : `WRONGLY BLOCKED → ${r.error.slice(0, 170)}`)
  }

  /** Negative case: the defence holds if the attempt raised OR nothing changed. */
  const asBlocked = async (kind, name, as, sql, probe) => {
    const steps = [{ as: 'postgres', read: probe, label: 'before' }, { as, sql, label: 'attack' }]
    if (probe) steps.push({ as: 'postgres', read: probe, label: 'after' })
    const log = await runTx(steps)
    const attack = log.find(l => l.label === 'attack')
    const before = log.find(l => l.label === 'before')?.rows
    const after = log.find(l => l.label === 'after')?.rows
    const unchanged = !probe || JSON.stringify(before) === JSON.stringify(after)
    const blocked = !attack.ok || unchanged
    const how = !attack.ok ? `raised → ${attack.error.slice(0, 150)}`
              : unchanged  ? 'silent no-op (RLS hid the row; value provably unchanged)'
              : `WROTE THROUGH → ${JSON.stringify(after).slice(0, 140)}`
    record(kind, name, blocked, how)
  }

  /**
   * GAP — a PRE-EXISTING defect the harness reproduces on purpose, as executable
   * evidence for a §13 finding that needs an owner decision (a policy widening
   * is not the harness's call to make). `ok` means "reproduced exactly as
   * documented". GAPs are reported in their own section and do NOT gate the run:
   * a red run must always mean "a migration regressed", never "a known defect is
   * still known". Once the owner applies the fix, delete the case (or flip it to
   * a POSITIVE one asserting the new behaviour).
   */
  const gapRead = async (name, as, readSql, why) => {
    const [r] = await runTx([{ as, label: 'read', read: readSql }])
    const blind = r.rows.length === 0
    record('GAP', name, blind,
      blind ? `reproduced — 0 rows visible to ${as}: ${why}`
            : `NOT reproduced → ${JSON.stringify(r.rows).slice(0, 120)}`)
  }

  const gapNoop = async (name, as, sql, probe, why) => {
    const log = await runTx([
      { as: 'postgres', label: 'before', read: probe },
      { as, label: 'write', sql },
      { as: 'postgres', label: 'after', read: probe },
    ])
    const w = log[1]
    const unchanged = JSON.stringify(log[0].rows) === JSON.stringify(log[2].rows)
    const reproduced = unchanged && (w.ok ? w.rowCount === 0 : true)
    record('GAP', name, reproduced,
      reproduced
        ? `reproduced — ${w.ok ? `wrote 0 rows (RLS hid the row, so ${why} never fired; value provably unchanged)`
                               : `raised → ${w.error.slice(0, 120)}`}`
        : `NOT reproduced → wrote through: ${JSON.stringify(log[2].rows).slice(0, 120)}`)
  }

  /** Documents behaviour the DB deliberately still allows (a recorded residual). */
  const asResidual = async (name, as, sql, probe) => {
    const log = await runTx([{ as: 'postgres', read: probe, label: 'before' }, { as, sql, label: 'attempt' }])
    const attempt = log.find(l => l.label === 'attempt')
    record('RESIDUAL', name, attempt.ok, attempt.ok ? 'allowed, as documented' : `now blocked → ${attempt.error.slice(0, 140)}`)
  }

  const spendOf = id =>
    `SELECT total_actual_spent, overspend_reason FROM material_requisitions WHERE id = ${id}`

  console.log('\nRunning cases…\n')

  // ════════════════════════════════════════════════════════════════════════
  // 0019 — A3: spend is bounded by the cash released, or justified
  // ════════════════════════════════════════════════════════════════════════
  await seedMRS(101, { status: 'PURCHASING', spent: 0, disbursed: 1000 })
  await seedMRS(102, { status: 'PURCHASING', spent: 0, disbursed: 0, fastTrack: true, cap: 3000 })
  await seedMRS(103, { status: 'PURCHASING', spent: 0, disbursed: 0 })
  // Legacy damage: already over the ceiling with no justification on file.
  await seedMRS(104, { status: 'FULFILLED', spent: 1500, disbursed: 1000 })

  await asOk('POS', 'P1  0019 purchaser records actuals within the cash released', 'PURCHASER',
    `UPDATE material_requisitions SET total_actual_spent = 950.00 WHERE id = 101`)
  await asOk('POS', 'P2  0019 spend exactly equal to the cash released', 'PURCHASER',
    `UPDATE material_requisitions SET total_actual_spent = 1000.00 WHERE id = 101`)
  await asBlocked('NEG', 'N1  A3 purchaser inflates spend past the cash released', 'PURCHASER',
    `UPDATE material_requisitions SET total_actual_spent = 4000.00 WHERE id = 101`, spendOf(101))
  await asOk('POS', 'P3  0019 the same over-spend WITH a reason is accepted', 'PURCHASER',
    `UPDATE material_requisitions SET total_actual_spent = 4000.00,
       overspend_reason = 'Store price inflation; purchaser topped up from own pocket'
     WHERE id = 101`)
  await asBlocked('NEG', 'N2  0019 a blank reason is not a reason', 'PURCHASER',
    `UPDATE material_requisitions SET total_actual_spent = 5000.00, overspend_reason = '   '
     WHERE id = 101`, spendOf(101))
  await asBlocked('NEG', 'N3  A3 spend with NO cash released (ceiling 0 fails closed)', 'PURCHASER',
    `UPDATE material_requisitions SET total_actual_spent = 250.00 WHERE id = 103`, spendOf(103))
  await asOk('POS', 'P4  0019 fast-track may spend up to its own cap', 'PURCHASER',
    `UPDATE material_requisitions SET total_actual_spent = 2999.00 WHERE id = 102`)
  await asBlocked('NEG', 'N4  0019 fast-track over its cap needs a reason too', 'PURCHASER',
    `UPDATE material_requisitions SET total_actual_spent = 4500.00 WHERE id = 102`, spendOf(102))
  await asOk('POS', 'P5  0019 SQL Editor / service_role path is waved through', 'postgres',
    `UPDATE material_requisitions SET total_actual_spent = 9999.00 WHERE id = 103`)
  // The trigger guards the spend figure only: a row that is ALREADY over the
  // ceiling (pre-0019 damage) must stay updatable, or 0019 would freeze it
  // against every future write — the NOT VALID CHECK hazard, avoided.
  await asOk('POS', 'P6  0019 legacy over-ceiling rows are not frozen', 'ACCOUNTING',
    `UPDATE material_requisitions SET verification_notes = 'reviewed' WHERE id = 104`)

  // ════════════════════════════════════════════════════════════════════════
  // Regression — 0016 gate inputs, 0017 cascade, 0018 stamp
  // ════════════════════════════════════════════════════════════════════════
  await seedMRS(110, { status: 'IN_TRANSIT', spent: 640, disbursed: 1000, required: 360 })
  await asBlocked('NEG', 'N5  A1 requester zeroes their own Gate B debt', 'STAFF',
    `UPDATE material_requisitions SET spare_change_required = 0 WHERE id = 110`,
    `SELECT spare_change_required FROM material_requisitions WHERE id = 110`)
  await asBlocked('NEG', 'N6  A1 outsider-department purchaser zeroes the debt', 'PURCHASER',
    `UPDATE material_requisitions SET spare_change_required = 0 WHERE id = 110`,
    `SELECT spare_change_required FROM material_requisitions WHERE id = 110`)
  await asOk('POS', 'P7  0016 Accounting may record returned spare change', 'ACCOUNTING',
    `UPDATE material_requisitions SET spare_change_returned = 360.00 WHERE id = 110`)
  await asBlocked('NEG', 'N7  A1 outsider purchaser self-stamps Gate C', 'PURCHASER',
    `UPDATE material_requisitions SET requester_verification = 'VERIFIED' WHERE id = 110`,
    `SELECT requester_verification FROM material_requisitions WHERE id = 110`)
  await asBlocked('NEG', 'N8  A1 receiver inflates the cash ledger amount', 'PURCHASER',
    `UPDATE transmittal_forms SET amount = 999999 WHERE mrs_id = 110`,
    `SELECT amount FROM transmittal_forms WHERE mrs_id = 110`)

  // 0018 — the stamp Form 14 reads to refuse a self-sign-off.
  await asOk('POS', 'P8  0018 purchaser stamps the trip executor', 'PURCHASER',
    `UPDATE material_requisitions SET trip_completed_by = '${U.PURCHASER}' WHERE id = 110`)
  {
    const [col] = await runTx([{ as: 'postgres', label: 'col', read: `
      SELECT data_type, is_nullable,
             (SELECT count(*) FROM pg_constraint c
               WHERE c.contype = 'f' AND c.conrelid = 'material_requisitions'::regclass
                 AND c.confrelid = 'users'::regclass
                 AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                     WHERE attrelid = 'material_requisitions'::regclass
                       AND attname = 'trip_completed_by')]) AS fks
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'material_requisitions'
        AND column_name = 'trip_completed_by'` }])
    const c = col.rows?.[0] ?? {}
    const good = c.data_type === 'uuid' && c.is_nullable === 'YES' && Number(c.fks) === 1
    record('POS', 'P9  0018 trip_completed_by is a nullable UUID FK to users', good,
      good ? 'column present · FK enforced' : `MISSING/WRONG → ${JSON.stringify(c)}`)
  }

  // 0017 — Rule 3: cancelling a JO that disbursed cash must mint the return.
  // Run as the roles whose RLS used to blind the cascade (defect 2) and as the
  // role whose cast used to hard-fail (defect 1).
  for (const [id, role] of [[501, 'MANAGER'], [502, 'STAFF'], [503, 'SUPER_ADMIN']]) {
    await seedJO(id)
    await seedMRS(id, { status: 'PURCHASING', spent: 0, disbursed: 1000, joId: id, sender: 'SENT' })
    const log = await runTx([
      { as: role, label: 'cancel',
        sql: `UPDATE job_orders SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP,
                cancellation_reason = 'fixture' WHERE id = ${id}` },
      { as: 'postgres', label: 'after', read: `
          SELECT (SELECT overall_status FROM material_requisitions WHERE id = ${id})   AS mrs_status,
                 (SELECT count(*) FROM transmittal_forms
                   WHERE mrs_id = ${id} AND transmittal_type = 'SPARE_CHANGE_RETURN')  AS returns,
                 (SELECT amount FROM transmittal_forms
                   WHERE mrs_id = ${id} AND transmittal_type = 'SPARE_CHANGE_RETURN'
                   LIMIT 1)                                                            AS returned_amount,
                 (SELECT receiver_user_id = '${U.ACCOUNTING}' FROM transmittal_forms
                   WHERE mrs_id = ${id} AND transmittal_type = 'SPARE_CHANGE_RETURN'
                   LIMIT 1)                                                            AS mirrored_to_sender` },
    ])
    const cancel = log[0], after = log[1]?.rows?.[0] ?? {}
    const good = cancel.ok && after.mrs_status === 'VOIDED' && Number(after.returns) === 1
      && Number(after.returned_amount) === 1000 && after.mirrored_to_sender === true
    record('POS', `P1${id - 497} 0017 Rule 3: ${role.padEnd(11)} cancel mints the return`, good,
      good ? `MRS VOIDED · 1 SPARE_CHANGE_RETURN of ₱${Number(after.returned_amount).toFixed(2)} mirrored to the original sender`
           : `${cancel.ok ? '' : 'CANCEL FAILED → ' + cancel.error.slice(0, 150) + ' | '} state=${JSON.stringify(after)}`)
  }

  // Documented residual (§13.2 A1c): department authority is role-blind at the DB
  // layer, so a purchaser who sits IN the requester's department still holds
  // Form 9 / Form 14 authority. The app now refuses the *self*-approval case
  // (0018 + availability_reported_by); 0016 deliberately mirrors the app rather
  // than inventing a stricter policy, so this remains allowed at the DB.
  await asResidual('R1  A1c same-department purchaser may still stamp Gate C', 'PURCHASER_SAME',
    `UPDATE material_requisitions SET requester_verification = 'VERIFIED' WHERE id = 110`,
    `SELECT requester_verification FROM material_requisitions WHERE id = 110`)

  // ════════════════════════════════════════════════════════════════════════
  // Phase 4 — B1: settling a requisition an EARLIER receipt already CLOSED
  //
  // A requisition paid through two disbursements is CLOSED by the first
  // receipt (Gate B is satisfied), which used to dead-end every later one:
  // verifyCashAndMarkReceivedImpl() threw unless overall_status was FULFILLED.
  // These cases prove the DATABASE never required that — the block was purely
  // app-layer — and that the resume stays inside 0016 Rules 2/3 and 0014 Gate C.
  // ════════════════════════════════════════════════════════════════════════
  await seedMRS(120, {
    status: 'CLOSED', verification: 'VERIFIED', spent: 500, disbursed: 1000,
    required: 500, returned: 500, sender: 'SENT',
  })
  // The second (supplemental) disbursement, SENT before the first was verified.
  // Seeded with triggers suspended: 0015 legitimately refuses to ISSUE cash
  // against a CLOSED requisition, and this row models cash already in flight.
  await client.query(`ALTER TABLE transmittal_forms DISABLE TRIGGER USER`)
  try {
    await client.query(
      `INSERT INTO transmittal_forms
         (transmittal_number, mrs_id, transmittal_type, amount, sender_user_id, sender_status,
          receiver_user_id, receiver_status)
       VALUES ('TR-2026-000190', 120, 'SUPPLEMENTAL_DISBURSEMENT', 300, $1, 'SENT', $2, 'PENDING')`,
      [U.ACCOUNTING, U.PURCHASER])
  } finally {
    await client.query(`ALTER TABLE transmittal_forms ENABLE TRIGGER USER`)
  }

  await asOk('POS', 'P17 B1 a second receipt on an already-CLOSED MRS is permitted', 'ACCOUNTING',
    `UPDATE transmittal_forms
        SET receiver_status = 'RECEIVED', received_at = CURRENT_TIMESTAMP
      WHERE mrs_id = 120 AND transmittal_type = 'SUPPLEMENTAL_DISBURSEMENT'`)

  // The resume payload writes the RUNNING TOTALS and deliberately omits
  // overall_status (it is already CLOSED). Writing only this receipt's slice
  // would erase the earlier ₱500.00 from spare_change_amount, which Form 17 sums.
  {
    const probe = `SELECT spare_change_amount, spare_change_returned, overall_status
                     FROM material_requisitions WHERE id = 120`
    const log = await runTx([
      { as: 'postgres', label: 'before', read: probe },
      { as: 'ACCOUNTING', label: 'settle',
        sql: `UPDATE material_requisitions
                 SET spare_change_amount = 500.00, spare_change_returned = 500.00
               WHERE id = 120` },
      { as: 'postgres', label: 'after', read: probe },
    ])
    const settle = log[1], after = log[2].rows[0] ?? {}
    const good = settle.ok && settle.rowCount === 1
      && Number(after.spare_change_amount) === 500
      && Number(after.spare_change_returned) === 500
      && after.overall_status === 'CLOSED'
    record('POS', 'P18 B1 resume settle keeps the running total (0016 Rules 2 & 3)', good,
      good ? `₱500.00 preserved in spare_change_amount (Form 17's Σ) · status untouched at CLOSED`
           : `${settle.ok ? '' : 'REJECTED → ' + settle.error.slice(0, 150) + ' | '} state=${JSON.stringify(after)}`)
  }

  await asBlocked('NEG', 'N9  B1 a resume cannot reduce already-recorded returns', 'ACCOUNTING',
    `UPDATE material_requisitions SET spare_change_returned = 100.00 WHERE id = 120`,
    `SELECT spare_change_returned FROM material_requisitions WHERE id = 120`)

  // Relaxing the app-layer status check must not weaken the DB gate: a CLOSED
  // requisition whose delivery was never signed off still refuses the receipt.
  await seedMRS(121, {
    status: 'CLOSED', verification: 'PENDING_DELIVERY', spent: 0, disbursed: 500, sender: 'SENT',
  })
  await asBlocked('NEG', 'N10 0014 Gate C still blocks a receipt on an unverified CLOSED MRS', 'ACCOUNTING',
    `UPDATE transmittal_forms SET receiver_status = 'RECEIVED' WHERE mrs_id = 121`,
    `SELECT receiver_status FROM transmittal_forms WHERE mrs_id = 121`)

  // ════════════════════════════════════════════════════════════════════════
  // A5 (found while fixing B2) — the MRS row policies omit roles the app routes
  // and 0016 sanctions as writers.
  //
  // 0005 replaced the 0002 policies with mrs_select_safe / mrs_update_safe and
  // dropped "Staff read own dept MRS" to break the RLS recursion, never
  // restoring own-department read once 0016 added the safe helper
  // get_my_department_id(). Net effect on material_requisitions:
  //   SELECT: requester · SA · MANAGER · BUDGET_OFFICER · ACCOUNTING · PURCHASER
  //   UPDATE: requester · SA · MANAGER · STOREKEEPER · BUDGET_OFFICER · ACCOUNTING · PURCHASER
  //   INSERT: requester only            (transmittal_insert_safe omits FRONT_DESK)
  // So STOREKEEPER (Form 6), FRONT_DESK (Forms 12/14), MAINTENANCE (Form 14) and
  // any same-department colleague who is not the requester (Form 14) cannot read
  // the rows their own forms list — and 0016 Rules 5 and 9 name two of them as
  // the legitimate column writers. Reproduced below as GAPs: fixing it widens
  // who can see requisition data, which is the owner's decision (proposed 0020).
  // ════════════════════════════════════════════════════════════════════════
  await seedMRS(122, { status: 'IN_TRANSIT', spent: 640, disbursed: 1000, required: 360, dept: 2 })
  await seedMRS(123, { status: 'PURCHASING', spent: 0, disbursed: 0, dept: 1, online: true })

  await gapRead('G1  A5 STOREKEEPER cannot read the Form 6 stock-check queue', 'STOREKEEPER',
    `SELECT id FROM material_requisitions WHERE id = 110`,
    'mrs_select_safe omits STOREKEEPER, so the In-House Stock Bypass (§6.B) lists nothing')

  await gapRead('G2  A5 FRONT_DESK cannot read the Form 12 COD candidate list', 'FRONT_DESK',
    `SELECT id FROM material_requisitions WHERE id = 123`,
    'mrs_select_safe omits FRONT_DESK, so fdCodDisbursement() dies on "MRS not found."')

  {
    const codInsert = trNumber =>
      `INSERT INTO transmittal_forms
         (transmittal_number, mrs_id, transmittal_type, amount, sender_user_id, sender_status,
          receiver_user_id, receiver_status, courier_tracking_barcode)
       VALUES ('${trNumber}', 123, 'FD_REVOLVING_DISBURSEMENT', 450, '${U.FRONT_DESK}', 'SENT',
               '${U.STAFF}', 'PENDING', 'COD-BARCODE-1')`
    const log = await runTx([
      { as: 'postgres', label: 'exists',
        read: `SELECT id, is_online_purchase, overall_status FROM material_requisitions WHERE id = 123` },
      { as: 'FRONT_DESK', label: 'insert', sql: codInsert('TR-2026-000901') },
    ])
    const ins = log[1]
    record('GAP', 'G3  A5 FRONT_DESK cannot insert the COD leg of Form 12', !ins.ok,
      !ins.ok
        ? `reproduced — raised → ${ins.error.slice(0, 120)} · yet the requisition exists and is an online order in flight: ${JSON.stringify(log[0].rows[0])}`
        : 'NOT reproduced → the insert succeeded')
    // Control: the same row is accepted for a role the INSERT policy admits, so
    // G3 is provably about FRONT_DESK's RLS and not about the fixture or 0015.
    await asOk('POS', 'P19 control: the same COD insert succeeds for ACCOUNTING', 'ACCOUNTING',
      codInsert('TR-2026-000902'))
  }

  await gapNoop('G4  A5 FRONT_DESK cannot write the Form 12 delivery flags', 'FRONT_DESK',
    `UPDATE material_requisitions SET delivery_status = 'DELIVERED', revolving_fund_used = TRUE WHERE id = 123`,
    `SELECT delivery_status, revolving_fund_used FROM material_requisitions WHERE id = 123`,
    '0016 Rule 9 — which names FRONT_DESK the only legitimate writer')

  await gapRead('G5  A5 MAINTENANCE cannot read its OWN department\'s Form 14 queue', 'MAINTENANCE',
    `SELECT id FROM material_requisitions WHERE id = 122`,
    'MAINTENANCE is dept 2 and MRS-2026-000122 is dept 2, but mrs_select_safe omits both the role and any own-department branch')

  await gapNoop('G6  A5 MAINTENANCE cannot sign off Form 14 on its own department', 'MAINTENANCE',
    `UPDATE material_requisitions SET requester_verification = 'VERIFIED' WHERE id = 122`,
    `SELECT requester_verification FROM material_requisitions WHERE id = 122`,
    '0016 Rule 5 — which grants delivery sign-off to the requesting department')

  await gapNoop('G7  A5 a same-department colleague cannot sign off Form 14 either', 'STAFF_OTHER',
    `UPDATE material_requisitions SET requester_verification = 'VERIFIED' WHERE id = 122`,
    `SELECT requester_verification FROM material_requisitions WHERE id = 122`,
    '0016 Rule 5 — whose own error text says "ask a colleague from that department", advice RLS makes unactionable')

  // STOREKEEPER *is* named in mrs_update_safe, and the write still lands on
  // nothing: under RLS a row the SELECT policy hides cannot be updated either
  // (PostgreSQL evaluates the SELECT policy over the rows an UPDATE reads). So
  // mrs_select_safe is the binding gate for every MRS write — widening only the
  // UPDATE policy would not restore Form 6, and no follow-up SELECT could ever
  // confirm a write for these roles. That is exactly why B2 verifies its writes
  // with `count: 'exact'` (the affected-row count PostgREST reports) instead.
  {
    const log = await runTx([
      { as: 'postgres', label: 'policy',
        read: `SELECT qual FROM pg_policies
                WHERE tablename = 'material_requisitions' AND policyname = 'mrs_update_safe'` },
      { as: 'STOREKEEPER', label: 'role', read: `SELECT get_my_role()::text AS role` },
      { as: 'STOREKEEPER', label: 'write',
        sql: `UPDATE material_requisitions SET purpose = 'sk probe' WHERE id = 110` },
      { as: 'postgres', label: 'after', read: `SELECT purpose FROM material_requisitions WHERE id = 110` },
    ])
    const named = String(log[0].rows[0]?.qual ?? '').includes('STOREKEEPER')
    const isSk = log[1].rows[0]?.role === 'STOREKEEPER'
    const w = log[2]
    const untouched = log[3].rows[0]?.purpose === 'fixture'
    const reproduced = named && isSk && w.ok && w.rowCount === 0 && untouched
    record('GAP', 'G8  A5 STOREKEEPER is named in mrs_update_safe yet still cannot write', reproduced,
      reproduced
        ? 'reproduced — the UPDATE policy admits STOREKEEPER and get_my_role() resolves to STOREKEEPER, but the write hit 0 rows because mrs_select_safe hides the row: SELECT visibility gates writes too'
        : `NOT reproduced → named=${named} role=${log[1].rows[0]?.role} write=${JSON.stringify(w).slice(0, 110)} purpose=${log[3].rows[0]?.purpose}`)
  }

  // Control for the whole GAP block: a role the policy DOES admit sees the row,
  // so the blindness above is role-specific and not a fixture artefact.
  {
    const [r] = await runTx([{ as: 'PURCHASER', label: 'read',
      read: `SELECT id FROM material_requisitions WHERE id = 110` }])
    record('POS', 'P20 control: PURCHASER (in mrs_select_safe) sees the same row', r.rows.length === 1,
      r.rows.length === 1 ? '1 row visible — the GAP probes are reading a real, populated row'
                          : `0 rows → the fixtures are broken, the GAPs above prove nothing`)
  }

  // ── report ────────────────────────────────────────────────────────────────
  // GAP cases are findings, not regressions: excluded from the pass gate below.
  const gated = results.filter(r => r.kind !== 'GAP')
  const pass = gated.filter(r => r.ok).length
  console.log('─'.repeat(112))
  const HEADS = {
    POS: 'POSITIVE (legitimate writes still work)',
    NEG: 'NEGATIVE (bypass closed)',
    RESIDUAL: 'RESIDUAL (documented, not a gap)',
    GAP: 'GAP (pre-existing defect REPRODUCED — evidence for §13.8, awaiting an owner decision; does not gate the run)',
  }
  for (const kind of ['POS', 'NEG', 'RESIDUAL', 'GAP']) {
    const rows = results.filter(r => r.kind === kind)
    if (!rows.length) continue
    console.log(`\n${HEADS[kind]}`)
    for (const r of rows) {
      const mark = kind === 'GAP' ? (r.ok ? '⚠️ ' : '❌') : (r.ok ? '✅' : '❌')
      console.log(`   ${mark} ${r.name.padEnd(62)} ${r.note}`)
    }
  }

  // ── the owner-facing verify scripts must run clean and report PASS ────────
  console.log('\n' + '─'.repeat(112))
  let verifyOk = true
  for (const v of VERIFY) {
    try {
      const { rows } = await client.query(fs.readFileSync(path.join(MIG, v), 'utf8'))
      console.log(`\n${v}`)
      for (const r of rows) {
        const bad = String(r.status).startsWith('FAIL')
        if (bad) verifyOk = false
        console.log(`   ${bad ? '❌' : '·'} ${String(r.check_name).padEnd(40)} ${String(r.status).padEnd(8)} ${String(r.detail).slice(0, 92)}`)
      }
    } catch (e) {
      verifyOk = false
      console.log(`   ❌ ${v} FAILED TO RUN → ${e.message.split('\n')[0]}`)
    }
  }
  console.log('─'.repeat(112))

  const counts = k => `${results.filter(r => r.kind === k && r.ok).length}/${results.filter(r => r.kind === k).length}`
  console.log(`\n${pass}/${gated.length} passed  ·  POSITIVE ${counts('POS')}  ·  NEGATIVE ${counts('NEG')}  ·  RESIDUAL ${counts('RESIDUAL')}`
    + `  ·  GAP ${counts('GAP')} reproduced (§13.8 — not gated)`)

  await client.end(); await db.stop()
  process.exit(pass === gated.length && verifyOk ? 0 : 1)
}

main().catch(async e => {
  console.error('HARNESS ERROR:', e.message, '\n', e.stack?.split('\n')[1])
  process.exit(2)
})
