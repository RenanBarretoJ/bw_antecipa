import { processarPrazosEntrega } from '@/lib/actions/logistica'

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!CRON_SECRET || token !== CRON_SECRET) {
    return Response.json({ error: 'Nao autorizado.' }, { status: 401 })
  }

  const hoje = new Date().toISOString().slice(0, 10)
  const result = await processarPrazosEntrega(hoje)

  if (!result?.success) {
    return Response.json({ error: result?.message || 'Erro ao processar entregas.' }, { status: 500 })
  }

  return Response.json({
    success: true,
    ...result.data,
    timestamp: new Date().toISOString(),
  })
}
