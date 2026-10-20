import { inspecionarHostsPreservados } from '@/lib/integracoes/vortx/relatorios-host-inspection.server'

export const runtime = 'nodejs'
export const maxDuration = 145

export async function POST(request: Request) {
  return inspecionarHostsPreservados(request)
}
