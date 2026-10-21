import { executarWorkerEstoque } from '@/lib/integracoes/vortx/estoque-worker-http.server'
import { retomarDownloadEstoqueVortx } from '@/lib/integracoes/vortx/estoque-recuperacao.server'

export const maxDuration = 300
export async function POST(request: Request) {
  return executarWorkerEstoque(request, process.env, retomarDownloadEstoqueVortx)
}
