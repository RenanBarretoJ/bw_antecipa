# Reference data for the existing SERPRO QA Preview

Exclusive target: `fgttffyrkabpycmbnppi`. This is a bounded QA preparation
contract, not a migration runner or production bootstrap.

The restored schema does not imply seeded reference rows. Preserve the applied
baseline, ACL repair, Auth users, native MFA, notes, history and security catalog.
Insert only missing canonical `nf_xml` / `nf_danfe_pdf` definitions from
`20260722193500_corrigir_catalogo_documental_requisitos_nf.sql`; validate existing
values before any insert. Unexpected values stop the operation, never overwrite.
The caller owns the strict-TLS transaction and an audit entry. No historical
migration is edited or reapplied; no policies/grants are changed.

Create only missing `documentos-v2` and `notas-fiscais` buckets through the
official Storage admin API, with private access and a 20 MiB limit. Never use
the administrative client as an actor for functional upload/RLS tests.
Preexisting incompatible buckets stop the operation; they are not rewritten.

SERPRO stays OFF. Hosted upload, MFA and cross-fund proofs remain separate
from this reference-data preparation and its local tests.

Local unit checks: `node --test scripts/qa/serpro/preview-reference-data/contract.test.mjs`.

## Environment and release boundaries

The existing SERPRO Preview uses `NEXT_PUBLIC_APP_ENV=preview`, but a deployed
Next.js process has `NODE_ENV=production`. Configure `INTEGRATION_RUNTIME_ENV`
explicitly as `homologacao` for this Preview branch only. Do not change the
resolver's fail-closed behavior or reuse a production integration/credential.
Existing immutable deployments require a new authorized build to receive the
new variable; changing project environment configuration does not repair them.

Vortx remains disabled in this isolated SERPRO Preview. Its generic Central de
Bases view does not prove the production provider is available or unavailable.
Do not expand the Vortx Preview database/branch allowlist just to reproduce its
production appearance.

The production Vortx report gate still requires the exact production project,
configured Fund, enabled flag, explicit production runtime and Git ref `main`.
The current archive-based SERPRO release has no native Git-source provenance;
the effective value of its Git-ref environment variable has not been proven.
The next joint production release must therefore verify these runtime inputs
and use authoritative Git-source provenance from the separately approved,
protected `main` synchronization. Reject missing/mismatched provenance; do not
remove the gate or manufacture Git metadata. Production availability remains
unverified until that release and an authenticated smoke.

The Super Admin financial lineage fix reuses
`admin_obter_configuracoes_tecnicas_fundo`, with the existing session/MFA
authorization, instead of granting direct reads on restricted technical tables.
Only requested version labels are projected into the page response. Authenticated
Preview validation remains required after the new code is committed, certified
in CI and deployed under a separate publication authorization.
