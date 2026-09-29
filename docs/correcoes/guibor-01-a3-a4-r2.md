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

## Remote certification — STOP on real PDF B

- Remote branch: `feature/guibor-nfse-base-valor-comissao`.
- Published application/repair SHA: `c9ec5e5ad964f6da302d53e7bbd75d2588a0c7fe`.
- Draft validation PR: https://github.com/RenanBarretoJ/bw_antecipa/pull/71 .
  This is not authorization to merge into main/production.
- Real Node 22 CI passed TypeScript, full tests, lint and build:
  https://github.com/RenanBarretoJ/bw_antecipa/actions/runs/36597895009 .
- Supabase Preview check passed. Integration created isolated branch
  `prnudoydwiramsxjnxzn`, with P17, GUIBOR migration and four constraints.
  No manual DDL replay occurred in homolog or Preview during R2.
- Focused local suite: 82 tests passed; Docker RLS/fiscal/audit suite: 16 passed.
- Branch-specific Vercel configuration points exclusively at this Preview DB;
  `NFSE_UPLOAD_ENABLED=true` is restricted to the GUIBOR branch. No global
  variables, production variables or homolog flag were changed by this execution.
- Existing inherited Preview `OPENAI_API_KEY` is a Secret. Its metadata was
  checked without exporting its value. The initial branch-only list omitted this
  inherited key; complete JSON metadata corrected that readiness diagnosis.
  No provider credential was extracted or changed. Model uses the code default.
- Authenticated real A/B smoke deployment:
  https://bw-antecipa-e5yc5ho0h-renanbarretoj.vercel.app .
  CSP verified `prnudoydwiramsxjnxzn.supabase.co` in the deployed response.

### PDF A: initial review passed, persistence not yet certified

Real file `NF 202649 - CONSISA.pdf`, real Auth login plus TOTP/AAL2:
UI returned NFS-e 49 for review, gross 39,521.98 and net 37,229.70.
The due-date input was blank and required, with the missing-date message.
Both before and after this upload: zero NFs and zero Storage objects.
No manual date was submitted in this pass. The earlier native parser baseline
separately verifies the auxiliary net-plus-IBS/CBS 37,376.52; that is not a
remote persistence assertion.

### PDF B: critical gate failed

Real file `232- HOSPITAL VIDA.pdf`, separate QA cedente and real AAL2 login:
the upload returned a safe failure message instead of `REQUIRES_REVIEW`.
Runtime diagnostic: **`NFSE_VISUAL_LABEL_WITHOUT_VALUE`**.
`src/lib/nfse/visual-contract.ts` rejects any extracted field whose value is null
but whose label is non-null. Thus the real visual response did not satisfy the
implemented contract. The exact offending field was not logged; no claim is
made about that field or extracted amounts. Raw provider output was not exposed.

The R2 STOP rule was applied immediately: no retry claimed as PASS, no parser
change, no homolog app promotion, no production change. The next authorized
iteration needs to reconcile the visual contract with absent/blank values and
repeat the real B gate before resuming the remaining certification.

## QA cleanup — PASS

Removed only this execution's two isolated fixture groups: eight Auth users,
two cedentes, two funds, two consultorias and their scoped links/policies.
Cleanup used exact manifest UUIDs plus identity checks, verified zero associated
NFs/operations, and the repository's existing transaction-local QA cleanup
pattern for immutable test policy versions. No global trigger changes occurred.
After cleanup: zero matching users, cedentes, funds, sessions, MFA factors or
audit rows; zero Storage objects. No actual NFs/operations or Storage objects
needed deletion. QA data can be recreated by the test scripts; deleted Auth
identities/passwords are not retained. Homolog had no R2 QA fixtures to remove.

Ignored evidence (no credentials):

- `rehearsal/reports/GUIBOR_PREVIEW_A.json`
- `rehearsal/reports/GUIBOR_PREVIEW_A_REVIEW.png`
- `rehearsal/reports/GUIBOR_PREVIEW_B.json`
- `rehearsal/reports/GUIBOR_PREVIEW_B_UI_ERROR.txt`
- `rehearsal/reports/GUIBOR_PREVIEW_B_ERROR.png`
- `rehearsal/reports/GUIBOR_REVIEW_CLEANUP.json`

## Mandatory final status

FAIL means an unpassed gate; except the actual PDF B failure described above,
the remaining FAIL gates are **not executed/not certified because of STOP**.
Local/unit/Docker results are not substituted for remote/homolog certification.
`GUIBOR_OPERATIONAL_DML=ZERO` refers to the history-repair transaction; the later
isolated Preview fixture setup/cleanup is explicitly described above.

```text
GUIBOR_HISTORY_ENVELOPE_FIX = PASS
GUIBOR_HISTORY_PRECHECK_BAD_HASH_MATCH = PASS
GUIBOR_HISTORY_REPAIR = PASS
GUIBOR_HISTORY_FINAL_HASH_MATCH = PASS
GUIBOR_SCHEMA_UNCHANGED_BY_REPAIR = PASS
GUIBOR_OPERATIONAL_DML = ZERO
GUIBOR_REMOTE_BRANCH_PUSH = PASS
GUIBOR_A3_A4_CI = PASS
GUIBOR_A3_A4_PREVIEW = PASS
GUIBOR_PREVIEW_NFSE_FLAG = PASS
GUIBOR_NFSE_TEXT_PDF = PASS
GUIBOR_NFSE_IMAGE_PDF = FAIL
GUIBOR_NFSE_FILE_A_REAL = PASS
GUIBOR_NFSE_FILE_B_REAL = FAIL
GUIBOR_A4_NO_TODAY_FALLBACK = PASS
GUIBOR_A4_MANUAL_DUE_DATE_UI = FAIL
GUIBOR_A4_MANUAL_DUE_DATE_REQUIRED = PASS
GUIBOR_A4_MANUAL_DUE_DATE_AUDIT = FAIL
GUIBOR_A4_DUPLICATION = FAIL
GUIBOR_A4_STORAGE_INTEGRITY = FAIL
GUIBOR_A4_RLS_REMOTE = FAIL
GUIBOR_PARSER_REGRESSION_MK = FAIL
GUIBOR_PARSER_REGRESSION_BAHIAMED = FAIL
GUIBOR_PARSER_REGRESSION_GENERIC = FAIL
GUIBOR_PARSER_REGRESSION_XML = FAIL
GUIBOR_A3_A4_HOMOLOG = FAIL
GUIBOR_A3_A4_HOMOLOG_CLEANUP = PASS
GUIBOR_A3_A4_HOMOLOG_READY = NO
GUIBOR_PRODUCTION_CHANGED = NO
P17_CHANGED = NO
RLX_VORTX_CHANGED = NO
CERC_CHANGED = NO
RLX_EMAIL_CHANGED = NO
```

Preview=PASS identifies the isolated ready deployment, not full functional
certification. A=PASS identifies actual review/extraction, not persistence.
No-today and required-date PASS are backed by the real A UI and unit tests;
the full A/B manual interaction and audit remain unpassed. Legacy parser unit
regressions passed CI, but the four listed regression gates require homolog
smokes and therefore remain FAIL/not executed. Supabase/Postgres skills guided
the guarded history transaction and exact QA cleanup; OpenAI Docs guided secure
provider validation without credential extraction.
