// Both branches use the same disposable database. This is not a production gate.
export function branchPreviewVortxPermitida(branch: string | undefined): boolean {
  return branch === 'feature/vortx-real-data-preview' || branch === 'integration/vortx-main-20261021'
}
