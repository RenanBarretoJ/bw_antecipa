# GUIBOR A3/A4 R2 — history repair and remote certification

## History repair — PASS (2026-09-29)

Authorized target: homolog `fhgkmggthxikfpogrvaa`; production is forbidden.
Only `supabase_migrations.schema_migrations.statements` of version
`20260929154656` was updated. No migration DDL was replayed.

- Precheck SHA-256: `baf58d462397d739f1370c0ea13d7d348936bb52671bcf125ab52f6cb696c69a`.
- Final canonical SHA-256: `6764965cb3be144ff3604f7aa294aafc62e90270a72d2a4d7104689571e31d76`.
- Guarded transaction asserted exactly one updated row and exact canonical SQL.
- Metadata of this migration and every other history row remained unchanged.
- Both function bodies matched the applied source before and after repair.
- Four constraints matched a fresh Docker baseline: MD5
  `c62c506267327e76b806bf6bf3137538`, computed from ordered
  `conname || ':' || pg_get_constraintdef(oid)` joined with `|`.
- Functions/ACLs, constraints, columns, triggers and RLS policies retained their fingerprints.
- Full operational row fingerprints and counts remained unchanged:
  191 NFs, 21 operations, 1,075 audit entries, zero NFS-e rows.
- P17 version `20260929141740` remains present; due date remains NOT NULL.

The repair CLI is read-only by default. `--repair` requires the exact known bad
hash and all invariants both before and inside the transaction. Re-running after
success intentionally stops because that bad hash no longer matches.
The SQL literal encoder never uses replacement-string semantics. Four unit tests
cover `$$`, `$1`, `$&`, `$'`, dollar-backtick, delimiter collisions and the actual
normalized migration hash. All four passed on Node 22.23.3.

Ignored machine evidence: `rehearsal/reports/GUIBOR_HISTORY_PRECHECK.json` and
`rehearsal/reports/GUIBOR_HISTORY_REPAIR.json`. No secrets are included.

## Remaining gates

Remote push/CI, isolated Preview, real PDFs A/B, manual-date UI, persistence,
deduplication, Storage compensation, authenticated RLS, homolog promotion and
cleanup remain pending. No remote QA users/data have been created for R2 yet.
`GUIBOR_A3_A4_HOMOLOG_READY = NO`.
