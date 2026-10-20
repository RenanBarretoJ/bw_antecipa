import { executarWorkerEstoque } from '@/lib/integracoes/vortx/estoque-worker-http.server'

export const maxDuration = 300
export async function POST(request: Request) {
  return executarWorkerEstoque(request)
}
