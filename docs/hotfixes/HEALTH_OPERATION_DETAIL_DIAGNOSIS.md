# HEALTH_OPERATION_DETAIL_DIAGNOSIS

Date: 2026-10-02. Scope: Gestor operation detail only.
Baseline main / application rollback SHA: `0b27c0b9a745a482a81d157badbc47ca9595080f`.
Production deployment baseline: `dpl_FLngKoxLWrFiMVzP7awRxex2VYh8`.

## Confirmed cause

`src/app/gestor/operacoes/[id]/OperacaoDetalheGestorClient.tsx`, loader and
`itensCalculoFinanceiro` memo (baseline lines 535, 597, 626-636).
The async loader publishes NFs to React state before loading ceded parcels.
During the intervening awaited requests, the memo evaluates a partial state:
NFs and base snapshot exist, but `parcelasCedidasPorNf` is still empty.
It therefore requests a frozen item with `parcela_id = null`. All 15 items in
the incident snapshot belong to non-null parcel IDs. The strict fiscal helper
correctly throws; the render crashes before reaching the loading skeleton.

This is a loading-order defect, not a missing operation, missing parcel,
invalid fiscal classification, or broken financial snapshot.

## Read-only production evidence

The exact operation in the authorized incident ticket exists, remains
`solicitada`, and has a cedente-fund link and policy snapshot. It has 15 linked
NFs, 15 linked parcels, 15 snapshot notes and 15 snapshot items. All 15 item
pairs match their persisted NF/parcel links. All fiscal types are null.
Exposure control in the frozen policy is inactive; this component returns
without running exposure calculations. No production records were changed.

The operation list uses `carregarOperacoesPaginadas`; it does not run the
detail's partial-state fiscal lookup, explaining the difference in behavior.
The detail server route composes a client detail plus logistical server
sections. The failure was reproduced in the client render, not in a `.single`
query, date conversion, RSC serialization, or fiscal enum lookup.
No matching server error was returned by the inspected production runtime
logs (last 24h, error level). This is not evidence that browser rendering passed.

## Reproduction before fix

`health-detail-render.test.ts` renders the actual detail component with a
synthetic equivalent fixture: 15 NFs/parcels, current base/policy snapshot,
optional nulls and null fiscal type. Hook-state replay captures the interval
between NF and parcel responses; no pricing or base lookup is mocked.

Before fix: 1 failing / 13 passing tests. The partial-load render throws
`A operação não possui base de antecipação congelada para este item.`
The completed-load fixture renders successfully, including null fiscal types.

## Minimal correction

Skip construction of financial preview items while `loading` is true, and
reset the loading flag when the detail loader runs again. Preserve hook order,
existing loader queries and all existing financial rules. Actual missing frozen
items after loading must still fail closed; no silent substitution of fiscal
values, snapshot inference, broad catch, or new error boundary is introduced.

No migration, DML, Storage writes, status changes, or mutations of NFs,
parcels, snapshots, pricing, P17, integrations, RLX Email, Guibor or CERC.

## Certification boundaries

Local render tests cover loading order, legacy null snapshot, current snapshot,
null/NFE/NFSE/other fiscal types, multiple parcels, and all supported operation
statuses. Source and fixture financial values remain unchanged.
CI, production deployment and authenticated exact-ID/regression smoke must be
recorded separately; no local test substitutes for authenticated production smoke.

Local gates: TypeScript PASS; lint PASS with one pre-existing unused-import
warning in `liquidacao.ts`; webpack production build PASS; focused route/render
and responsive-header tests 18 PASS; full suite 2,587 PASS / 12 skipped;
`git diff --check` PASS. First concurrent suite run hit the existing PDF parser
test's 5s timeout; its isolated run and the full rerun with two workers passed
without changing test timeouts or the PDF code.
