import { createClient } from '@supabase/supabase-js'
import { VALIDADE_DIAS } from '@/lib/documentos'

// Cron job: verificar documentos aprovados vencidos ou a vencer em 30 dias
// Executado diariamente as 08:30 UTC via Vercel Cron (vercel.json)
//
// Comportamento:
// - Documentos vencidos sem solicitacao pendente: notifica gestores + marca atualizacao_solicitada_em
// - Documentos a vencer em ate 30 dias: notifica gestores (aviso preventivo)
//
// GET /api/cron/documentos-vencidos

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!CRON_SECRET || token !== CRON_SECRET) {
    return Response.json({ error: 'Nao autorizado.' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('[cron/documentos-vencidos] SUPABASE_URL ou SERVICE_ROLE_KEY nao configurados')
    return Response.json({ error: 'Configuracao de ambiente incompleta.' }, { status: 500 })
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey)
  const hoje = new Date()
  const resultados = { vencidos: 0, a_vencer_30: 0, cedentes_alertados: 0, erros: 0 }

  try {
    const { data: docs, error: docsError } = await supabaseAdmin
      .from('documentos')
      .select('id, tipo, analisado_em, cedente_id, atualizacao_solicitada_em, cedentes(razao_social, user_id)')
      .eq('status', 'aprovado')
      .not('analisado_em', 'is', null)

    if (docsError) {
      console.error('[cron/documentos-vencidos] Erro ao buscar documentos:', docsError.message)
      return Response.json({ error: docsError.message }, { status: 500 })
    }

    if (!docs || docs.length === 0) {
      return Response.json({ ...resultados, message: 'Sem documentos aprovados para verificar.', timestamp: hoje.toISOString() })
    }

    // Agrupar por cedente para consolidar alertas
    const vencidosPorCedente: Record<string, { razao_social: string; tipos: string[] }> = {}
    const aVencer30PorCedente: Record<string, { razao_social: string; tipos: string[] }> = {}

    for (const raw of docs) {
      const doc = raw as unknown as {
        id: string; tipo: string; analisado_em: string; cedente_id: string
        atualizacao_solicitada_em: string | null
        cedentes: { razao_social: string; user_id: string }
      }

      try {
        const validadeDias = VALIDADE_DIAS[doc.tipo]
        if (!validadeDias) continue

        const expiracao = new Date(doc.analisado_em)
        expiracao.setDate(expiracao.getDate() + validadeDias)

        const diffMs = expiracao.getTime() - hoje.getTime()
        const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

        if (diasRestantes < 0 && !doc.atualizacao_solicitada_em) {
          // Vencido sem solicitação pendente: marcar e alertar
          const { error: updateError } = await supabaseAdmin
            .from('documentos')
            .update({ atualizacao_solicitada_em: hoje.toISOString() } as never)
            .eq('id', doc.id)

          if (updateError) {
            console.error(`[cron/documentos-vencidos] Erro ao marcar doc ${doc.id}:`, updateError.message)
            resultados.erros++
            continue
          }

          // Registrar log de auditoria
          await supabaseAdmin.from('logs_auditoria').insert({
            usuario_id: null,
            tipo_evento: 'DOCUMENTO_VENCIDO_AUTO',
            entidade_tipo: 'documentos',
            entidade_id: doc.id,
            dados_antes: { atualizacao_solicitada_em: null },
            dados_depois: { tipo: doc.tipo, cedente_id: doc.cedente_id, dias_vencido: Math.abs(diasRestantes), source: 'cron' },
          } as never)

          if (!vencidosPorCedente[doc.cedente_id]) {
            vencidosPorCedente[doc.cedente_id] = { razao_social: doc.cedentes.razao_social, tipos: [] }
          }
          vencidosPorCedente[doc.cedente_id].tipos.push(doc.tipo)
          resultados.vencidos++
        }

        // A vencer em ate 30 dias (independente de solicitacao existente)
        if (diasRestantes >= 0 && diasRestantes <= 30) {
          if (!aVencer30PorCedente[doc.cedente_id]) {
            aVencer30PorCedente[doc.cedente_id] = { razao_social: doc.cedentes.razao_social, tipos: [] }
          }
          aVencer30PorCedente[doc.cedente_id].tipos.push(doc.tipo)
          resultados.a_vencer_30++
        }
      } catch (docErr) {
        console.error(`[cron/documentos-vencidos] Erro ao processar doc ${doc.id}:`, docErr)
        resultados.erros++
      }
    }

    // Notificar gestores — docs vencidos (um alerta por cedente)
    for (const [, info] of Object.entries(vencidosPorCedente)) {
      await notificarGestoresCron(
        supabaseAdmin,
        `ALERTA: Documentos vencidos — ${info.razao_social}`,
        `O cedente ${info.razao_social} possui ${info.tipos.length} documento(s) vencido(s): ${info.tipos.join(', ')}. Acesse o cadastro e solicite a atualizacao.`,
        'documento_vencido'
      )
      resultados.cedentes_alertados++
    }

    // Notificar gestores — docs a vencer em 30 dias
    for (const [, info] of Object.entries(aVencer30PorCedente)) {
      await notificarGestoresCron(
        supabaseAdmin,
        `Documentos a vencer — ${info.razao_social}`,
        `O cedente ${info.razao_social} possui ${info.tipos.length} documento(s) a vencer nos proximos 30 dias: ${info.tipos.join(', ')}.`,
        'documento_a_vencer'
      )
    }

    console.log('[cron/documentos-vencidos] Resultado:', resultados)

    return Response.json({
      success: true,
      ...resultados,
      timestamp: hoje.toISOString(),
    })
  } catch (err) {
    console.error('[cron/documentos-vencidos] Erro geral:', err)
    return Response.json({ error: 'Erro interno no processamento.' }, { status: 500 })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notificarGestoresCron(supabase: any, titulo: string, mensagem: string, tipo: string) {
  try {
    const { data: gestores } = await supabase.from('profiles').select('id').eq('role', 'gestor')
    if (!gestores || gestores.length === 0) return

    const notificacoes = (gestores as Array<{ id: string }>).map((g) => ({
      usuario_id: g.id, titulo, mensagem, tipo,
    }))

    const { error } = await supabase.from('notificacoes').insert(notificacoes as never[])
    if (error) console.error('[cron/documentos-vencidos/notificarGestores] Erro:', error.message)
  } catch (err) {
    console.error('[cron/documentos-vencidos/notificarGestores] Erro inesperado:', err)
  }
}
