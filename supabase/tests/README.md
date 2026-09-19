# Migration harness

Executes `supabase/migrations/*.sql` against a **real PostgreSQL** and asserts the
behaviour of every guard the application depends on.

```bash
cd supabase/tests
npm install     # 17 packages, this folder only
npm test        # boots a cluster, replays the migrations, runs the cases
```

Exit code `0` = every case passed **and** every `*_verify.sql` reported PASS.

## Why it exists

Two audit findings were only visible by *running* the SQL:

- **A4** — 0011's `cascade_jo_cancellation()` was broken twice over: an
  `EXTRACT(YEAR …)` numeric→integer resolution failure (PostgreSQL 14+ returns
  NUMERIC, and numeric→int is an *assignment* cast, not an implicit one), and RLS
  blindness inside a non-`SECURITY DEFINER` trigger, so its `INSERT … SELECT FROM
  transmittal_forms` saw zero rows for most roles. Each defect masked the other:
  the empty SELECT never evaluated the broken function call, so only SUPER_ADMIN
  ever saw a failure — and only as a cancelled-cancellation, never as missing cash.
- **A3** — `spare_change_required = mrs_disbursed_total − total_actual_spent`
  makes a self-reported figure *subtractive*. That only bites when you write one.

Reading migrations does not find these. Writing them does.

## Isolation from the app

`embedded-postgres` and `pg` are devDependencies of **this folder's** own
`package.json`. They must never enter the app's `package.json` (agent_handoff
§10.9) — the Next.js build would try to trace a native PostgreSQL binary.

The cluster lives in `.pg-data/` (gitignored) and is destroyed at the start of
every run. Nothing here connects to the live Supabase project.

## What a bare cluster needs that Supabase provides

The harness recreates three things before applying the migrations, because the
guard functions depend on them:

1. `auth.uid()` — reads `request.jwt.claims` → `sub`, exactly like Supabase's.
2. The `anon` / `authenticated` / `service_role` roles (`service_role` is
   `BYPASSRLS`, as in production).
3. Table/sequence/function grants to `authenticated`, so **RLS is the gate being
   tested, not missing privileges**. Plus `GRANT USAGE ON SCHEMA auth` and
   `GRANT EXECUTE ON FUNCTION auth.uid()` — without those, any trigger calling
   `auth.uid()` dies with `permission denied for schema auth`.

Skipped: `0001_storage_buckets.sql`, `0006_seed_admin_user.sql`,
`0008_make_storage_buckets_public.sql` (they need Supabase's `storage` schema and
a real `auth.users` row).

## Assertion rule

Each case runs as a signed-in role inside one transaction that is always rolled
back, with a `SAVEPOINT` per step — after a rejected statement every later query
in the same transaction would otherwise fail with *current transaction is
aborted*.

A **negative** case passes when the attempt `raised` **or** the probed value is
provably unchanged. That distinction matters: RLS hiding a row turns an attack
into a silent 0-row no-op, which looks exactly like a successful defence for the
wrong reason. So every negative re-reads the row as `postgres` (RLS bypassed)
before and after, and the report prints *how* the attempt was stopped.

`RESIDUAL` cases assert behaviour the database **deliberately still allows** —
documented policy, not a gap (see agent_handoff §13.2 A1c). They are here so a
future migration that accidentally tightens them fails loudly instead of
silently changing who can do their job.

## Coverage

| Group | Cases |
|---|---|
| 0019 — spend ceiling (`A3`) | actuals within / exactly at the ceiling; inflated spend refused; refused with a blank reason; accepted with a reason; ceiling-0 fails closed; fast-track capped at its own amount; SQL-Editor wave-through; legacy over-ceiling rows stay updatable (no freeze) |
| 0016 — gate inputs (`A1`) | requester and outsider cannot zero the Gate B debt; Accounting can record a return; outsider cannot self-stamp Gate C; receiver cannot inflate the ledger amount |
| 0018 — trip executor (`A1c`) | column is a nullable UUID FK to `users`; a purchaser may stamp it |
| 0017 — Rule 3 cascade (`A4`) | MANAGER, STAFF and SUPER_ADMIN each cancelling a JO with disbursed cash must void the MRS **and** mint one `SPARE_CHANGE_RETURN` for the full amount, mirrored to the original sender |
| verify scripts | `0016`–`0019_verify.sql` are executed, and any `FAIL` status fails the run — so the owner-facing scripts are known-good SQL, not eyeballed SQL |

Add a case whenever a migration changes what the database accepts. The
`seedMRS()` / `seedJO()` helpers disable user triggers while inserting fixtures
(0015's cash-entry gates would otherwise refuse to create the historical states
several cases need) and re-enable them before any assertion runs.
