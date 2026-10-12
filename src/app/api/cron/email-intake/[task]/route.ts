import { authorizeAutomationJob } from '@/lib/email-intake/automation/environment.server'
import { runEmailAutomationTask } from '@/lib/email-intake/automation/worker.server'

export const runtime = 'nodejs'
export const maxDuration = 240

export async function POST(request: Request, context: { params: Promise<{ task: string }> }) {
  if (!authorizeAutomationJob(request)) return Response.json({ error: 'Não autorizado.' }, { status: 401 })
  const { task } = await context.params
  if (!['delta', 'reconciliation', 'subscriptions', 'health', 'attachments', 'visual'].includes(task)) {
    return Response.json({ error: 'Tarefa não encontrada.' }, { status: 404 })
  }
  try {
    const result = await runEmailAutomationTask(task)
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    console.error('email_automation_job_failed', { task })
    return Response.json({ error: 'Não foi possível concluir o processamento.' }, { status: 503 })
  }
}
