import { createClient } from '@supabase/supabase-js'
import { registrarLog } from '@/lib/actions/auditoria'
import { notificarEntidade } from '@/lib/actions/notificacao'

// Cron job: verificar vencimentos e enviar alertas D-5, D-1 e inadimplencia
// Executado diariamente as 08:00 UTC via Vercel Cron (vercel.json)
// Tambem pode ser chamado manualmente com header Authorization: Bearer <CRON_SECRET>
//
// GET /api/cron/vencimentos

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(request: Request) {
  // Vercel Cron envia o header automaticamente; chamadas manuais usam Bearer token
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!CRON_SECRET || token !== CRON_SECRET) {
    return Response.json({ error: 'Nao autorizado.' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('[cron/vencimentos] SUPABASE_URL ou SERVICE_ROLE_KEY nao configurados')
    return Response.json({ error: 'Configuracao de ambiente incompleta.' }, { status: 500 })
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey)

  const hoje = new Date()
  const formatDate = (d: Date) => d.toISOString().split('T')[0]

  const em5dias = new Date(hoje)
  em5dias.setDate(em5dias.getDate() + 5)
  const em1dia = new Date(hoje)
  em1dia.setDate(em1dia.getDate() + 1)

  const resultados = { alertas_d5: 0, alertas_d1: 0, inadimplentes: 0, erros: 0 }

  try {
    // Buscar operacoes em_andamento
    const { data: ops, error: opsError } = await supabaseAdmin
      .from('operacoes')
      .select('id, data_vencimento, cedente_id, cedentes(razao_social)')
      .eq('status', 'em_andamento')

    if (opsError) {
      console.error('[cron/vencimentos] Erro ao buscar operacoes:', opsError.message)
      return Response.json({ error: `Erro ao buscar operacoes: ${opsError.message}` }, { status: 500 })
    }

    if (!ops || ops.length === 0) {
      return Response.json({ ...resultados, message: 'Sem operacoes ativas.', timestamp: new Date().toISOString() })
    }

    for (const opRaw of ops) {
      const op = opRaw as unknown as {
        id: string; data_vencimento: string; cedente_id: string;
        cedentes: { razao_social: string }
      }

      try {
        const vencimento = op.data_vencimento
        const contexto = { entidadeTipo: 'operacao' as const, entidadeId: op.id }
        const notificar = async (destino: 'cedente' | 'gestor' | 'sacado', titulo: string, mensagem: string, tipo: string) => {
          const aviso = await notificarEntidade(contexto, destino, titulo, mensagem, tipo,
            `cron:operacao:${op.id}:${vencimento}:${tipo}`)
          if (!aviso.success) resultados.erros++
        }

        // D-5 alert
        if (vencimento === formatDate(em5dias)) {
          await notificar('cedente', 'Vencimento em 5 dias',
            `A operacao #${op.id.substring(0, 8)} vence em 5 dias (${vencimento}).`, 'alerta_vencimento')

          // Notificar sacados vinculados
          await notificar('sacado', 'Vencimento em 5 dias',
            `Pagamento da operacao #${op.id.substring(0, 8)} vence em 5 dias. Favor providenciar.`,
            'alerta_vencimento')

          resultados.alertas_d5++
        }

        // D-1 alert
        if (vencimento === formatDate(em1dia)) {
          await notificar('cedente', 'VENCIMENTO AMANHA',
            `A operacao #${op.id.substring(0, 8)} vence AMANHA (${vencimento}).`, 'alerta_vencimento_urgente')

          // Notificar gestores
          await notificar('gestor',
            'Vencimento amanha',
            `Operacao #${op.id.substring(0, 8)} do cedente ${op.cedentes.razao_social} vence amanha.`,
            'alerta_vencimento_gestor')

          resultados.alertas_d1++
        }

        // Inadimplencia — vencido e ainda em_andamento
        if (vencimento < formatDate(hoje)) {
          const { error: updateError } = await supabaseAdmin
            .from('operacoes')
            .update({ status: 'inadimplente' } as never)
            .eq('id', op.id)

          if (updateError) {
            console.error(`[cron/vencimentos] Erro ao marcar inadimplente op ${op.id}:`, updateError.message)
            resultados.erros++
            continue
          }

          // Alerta urgente ao gestor
          await notificar('gestor',
            'ALERTA URGENTE: Operacao inadimplente',
            `A operacao #${op.id.substring(0, 8)} do cedente ${op.cedentes.razao_social} venceu em ${vencimento} e o sacado NAO pagou.`,
            'inadimplencia_urgente')

          await notificar('cedente', 'Operacao inadimplente',
            `A operacao #${op.id.substring(0, 8)} esta inadimplente. O sacado nao efetuou o pagamento no vencimento.`, 'operacao_inadimplente')

          await registrarLog({
            tipo_evento: 'OPERACAO_INADIMPLENTE_AUTO',
            entidade_tipo: 'operacoes',
            entidade_id: op.id,
            dados_antes: { status: 'em_andamento' },
            dados_depois: { status: 'inadimplente', source: 'cron' },
            ator: { tipo: 'cron', origem: 'cron/vencimentos', identificador: 'vencimentos' },
          })

          resultados.inadimplentes++
        }
      } catch (opErr) {
        console.error(`[cron/vencimentos] Erro ao processar op ${op.id}:`, opErr)
        resultados.erros++
      }
    }

    console.log('[cron/vencimentos] Resultado:', { ...resultados, processadas: ops.length })

    return Response.json({
      success: true,
      ...resultados,
      processadas: ops.length,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[cron/vencimentos] Erro geral:', err)
    return Response.json({ error: 'Erro interno no processamento.' }, { status: 500 })
  }
}
