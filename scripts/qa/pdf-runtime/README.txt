PDF runtime: Linux ETXTBSY reproduction and regression

Scope
  Exercise the actual htmlParaPdf function from the repository, without database,
  Storage, routes, legal templates, real documents or credentials. The TypeScript
  AST selects that function; the harness does not reimplement its rendering flow.
  The only interception records native executable writes and spawn calls.

Inputs (outside Git)
  /qa/baseline-generator.ts and /qa/baseline-telemetry.ts: exact source files from
  the reviewed pre-fix commit. For this investigation: b20c18386a88db6557287011a175b331ba3efbff.
  /qa/assets/configured-chromium-pack.tar: approved, locally cached Chromium pack.
  Record its SHA-256 before running. Do not put signed URLs or environment files
  in Git or evidence output. Bundled package binaries can instead be exercised
  with QA_PACK_MODE=bundled.

Container contract
  Use a disposable Linux x64 container, Node 22 or 24, with NODE_ENV=production
  and VERCEL=1. The investigation used public.ecr.aws/lambda/nodejs images;
  record their resolved image IDs, digests and exact Node versions.
  Mount the repository read-only at /source, node_modules read-only at
  /deps/node_modules, and a private evidence directory read-write at /qa.
  Run node /source/scripts/qa/pdf-runtime/etxtbsy-linux.mjs.
  Set QA_VARIANT=baseline or fixed. Disable network after caching the pack.
  Use --rm, resource limits, and a unique owned container name. Never remove
  shared containers, images, volumes, or live executables to run this test.

Scenario
  The first generation naturally creates the executable write stream. On its
  real open event, the harness starts a second generation, without delaying or
  modifying the writer. It records /proc/self/fdinfo, writer PID, resolved spawn
  argument and the ORIGINAL error.path separately. The unmodified provider's
  existsSync shortcut can expose the executable before the write stream closes.
  Then exercise three sequential warm generations and four parallel generations.
  Compare executable device/inode, size, timestamps and SHA-256 before/after.
  Every synthetic document has three pages with independent text markers.

Independent PDF validation
  Node 22 also checks PDFs with the existing pdf-parse dependency. Its legacy
  PDF.js reader produced bad-XRef errors/unhandled rejections under Node 24 in
  this investigation, even for files accepted by PDFium. Node 24 rendering is
  therefore explicitly PENDING until independent validation is complete.
  In a separate disposable Python environment install pypdfium2 and Pillow, and
  run validate-pdfs.py <private-evidence-directory>. Inspect the rendered PNGs.
  Do not change application PDF readers or dependencies as part of this fix.

Acceptance
  Baseline: native ETXTBSY reproduced while a writer holds the same executable.
  Fixed: all nine generations complete, no spawn with a writer in flight, one
  preparation per runtime, unchanged executable identity, all browsers closed,
  all pages/text markers validated independently. Separately exercise all four
  authenticated generation routes against dedicated synthetic QA fixtures.
  This harness does not certify concurrent persistence of the same document.

Failure and rollback
  Preparation failure is retained for that process: do not launch a partial
  executable or automatically repeat materialization. Recovery requires a fresh
  clean runtime after investigating the original error. Do not delete /tmp files
  while another request may be using them. The global preparation key shares the
  promise across route bundles in ONE Node process; coordination of independent
  OS processes sharing a filesystem is not certified by this patch.
  Rollback is application-code rollback to the pre-fix deployment, with a fresh
  runtime. No migration, financial recalculation or document rollback is needed.
  Rolling back restores the known race; stop generation if it recurs. Do not
  restore or overwrite previously generated business documents during rollback.

Historical evidence boundary
  The Linux experiment identifies the library writer for a reproduced failure.
  It does not identify the process that caused the historical production event
  on 08/10/2026. A configured executable path is not the original error.path.
  Production rollout requires separate explicit approval and controlled smoke.
