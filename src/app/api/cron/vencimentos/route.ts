import { createClient } from '@supabase/supabase-js'

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
      .select('id, data_vencimento, cedente_id, cedentes(user_id, razao_social)')
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
        cedentes: { user_id: string; razao_social: string }
      }

      try {
        const vencimento = op.data_vencimento

        // D-5 alert
        if (vencimento === formatDate(em5dias)) {
          const { error } = await supabaseAdmin.from('notificacoes').insert([
            {
              usuario_id: op.cedentes.user_id,
              titulo: 'Vencimento em 5 dias',
              mensagem: `A operacao #${op.id.substring(0, 8)} vence em 5 dias (${vencimento}).`,
              tipo: 'alerta_vencimento',
            },
          ] as never[])
          if (error) {
            console.error(`[cron/vencimentos] Erro notificacao D-5 op ${op.id}:`, error.message)
            resultados.erros++
          }

          // Notificar sacados vinculados
          await notificarSacadosVinculados(supabaseAdmin, op.id, 'Vencimento em 5 dias',
            `Pagamento da operacao #${op.id.substring(0, 8)} vence em 5 dias. Favor providenciar.`,
            'alerta_vencimento')

          resultados.alertas_d5++
        }

        // D-1 alert
        if (vencimento === formatDate(em1dia)) {
          const { error } = await supabaseAdmin.from('notificacoes').insert({
            usuario_id: op.cedentes.user_id,
            titulo: 'VENCIMENTO AMANHA',
            mensagem: `A operacao #${op.id.substring(0, 8)} vence AMANHA (${vencimento}).`,
            tipo: 'alerta_vencimento_urgente',
          } as never)
          if (error) {
            console.error(`[cron/vencimentos] Erro notificacao D-1 op ${op.id}:`, error.message)
            resultados.erros++
          }

          // Notificar gestores
          await notificarGestoresCron(supabaseAdmin,
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
          await notificarGestoresCron(supabaseAdmin,
            'ALERTA URGENTE: Operacao inadimplente',
            `A operacao #${op.id.substring(0, 8)} do cedente ${op.cedentes.razao_social} venceu em ${vencimento} e o sacado NAO pagou.`,
            'inadimplencia_urgente')

          const { error: notifError } = await supabaseAdmin.from('notificacoes').insert({
            usuario_id: op.cedentes.user_id,
            titulo: 'Operacao inadimplente',
            mensagem: `A operacao #${op.id.substring(0, 8)} esta inadimplente. O sacado nao efetuou o pagamento no vencimento.`,
            tipo: 'operacao_inadimplente',
          } as never)
          if (notifError) {
            console.error(`[cron/vencimentos] Erro notificacao inadimplente op ${op.id}:`, notifError.message)
            resultados.erros++
          }

          const { error: logError } = await supabaseAdmin.from('logs_auditoria').insert({
            usuario_id: null,
            tipo_evento: 'OPERACAO_INADIMPLENTE_AUTO',
            entidade_tipo: 'operacoes',
            entidade_id: op.id,
            dados_antes: { status: 'em_andamento' },
            dados_depois: { status: 'inadimplente', source: 'cron' },
          } as never)
          if (logError) {
            console.error(`[cron/vencimentos] Erro log auditoria op ${op.id}:`, logError.message)
          }

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

// Helpers para o cron (nao usam createClient do server pois nao ha contexto de request auth)

async function notificarGestoresCron(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  titulo: string,
  mensagem: string,
  tipo: string
) {
  try {
    const { data: gestores } = await supabase.from('profiles').select('id').eq('role', 'gestor')
    if (!gestores || gestores.length === 0) return

    const notificacoes = (gestores as Array<{ id: string }>).map((g) => ({
      usuario_id: g.id, titulo, mensagem, tipo,
    }))

    const { error } = await supabase.from('notificacoes').insert(notificacoes as never[])
    if (error) {
      console.error('[cron/notificarGestores] Erro:', error.message)
    }
  } catch (err) {
    console.error('[cron/notificarGestores] Erro inesperado:', err)
  }
}

async function notificarSacadosVinculados(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  operacaoId: string,
  titulo: string,
  mensagem: string,
  tipo: string
) {
  try {
    const { data: opNfs } = await supabase
      .from('operacoes_nfs')
      .select('nota_fiscal_id')
      .eq('operacao_id', operacaoId)

    if (!opNfs) return

    const nfIds = (opNfs as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
    const { data: nfs } = await supabase
      .from('notas_fiscais')
      .select('cnpj_destinatario')
      .in('id', nfIds)

    if (!nfs) return

    const cnpjs = [...new Set((nfs as Array<{ cnpj_destinatario: string }>).map((n) => n.cnpj_destinatario))]

    for (const cnpj of cnpjs) {
      const { data: sacado } = await supabase
        .from('sacados')
        .select('user_id')
        .eq('cnpj', cnpj)
        .single()

      if (sacado) {
        const { error } = await supabase.from('notificacoes').insert({
          usuario_id: (sacado as { user_id: string }).user_id,
          titulo, mensagem, tipo,
        } as never)
        if (error) {
          console.error(`[cron/notificarSacados] Erro para CNPJ ${cnpj}:`, error.message)
        }
      }
    }
  } catch (err) {
    console.error('[cron/notificarSacados] Erro inesperado:', err)
  }
}
