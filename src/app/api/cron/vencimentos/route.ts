import { createClient } from '@supabase/supabase-js'

// Cron job: verificar vencimentos e enviar alertas D-5, D-1 e inadimplencia
// Chamar diariamente via Supabase Edge Function, Vercel Cron, ou cron externo
//
// GET /api/cron/vencimentos
// Header: Authorization: Bearer <CRON_SECRET>

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!CRON_SECRET || token !== CRON_SECRET) {
    return Response.json({ error: 'Nao autorizado.' }, { status: 401 })
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const hoje = new Date()
  const formatDate = (d: Date) => d.toISOString().split('T')[0]

  const em5dias = new Date(hoje)
  em5dias.setDate(em5dias.getDate() + 5)
  const em1dia = new Date(hoje)
  em1dia.setDate(em1dia.getDate() + 1)

  const resultados = { alertas_d5: 0, alertas_d1: 0, inadimplentes: 0 }

  // Buscar operacoes em_andamento
  const { data: ops } = await supabaseAdmin
    .from('operacoes')
    .select('id, data_vencimento, cedente_id, cedentes(user_id, razao_social)')
    .eq('status', 'em_andamento')

  if (!ops) return Response.json({ ...resultados, message: 'Sem operacoes ativas.' })

  for (const opRaw of ops) {
    const op = opRaw as unknown as {
      id: string; data_vencimento: string; cedente_id: string;
      cedentes: { user_id: string; razao_social: string }
    }

    const vencimento = op.data_vencimento

    // D-5 alert
    if (vencimento === formatDate(em5dias)) {
      await supabaseAdmin.from('notificacoes').insert([
        {
          usuario_id: op.cedentes.user_id,
          titulo: 'Vencimento em 5 dias',
          mensagem: `A operacao #${op.id.substring(0, 8)} vence em 5 dias (${vencimento}).`,
          tipo: 'alerta_vencimento',
        },
      ])

      // Notificar sacados vinculados
      const { data: opNfs } = await supabaseAdmin
        .from('operacoes_nfs')
        .select('nota_fiscal_id')
        .eq('operacao_id', op.id)

      if (opNfs) {
        const nfIds = (opNfs as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
        const { data: nfs } = await supabaseAdmin
          .from('notas_fiscais')
          .select('cnpj_destinatario')
          .in('id', nfIds)

        if (nfs) {
          const cnpjs = [...new Set((nfs as Array<{ cnpj_destinatario: string }>).map((n) => n.cnpj_destinatario))]
          for (const cnpj of cnpjs) {
            const { data: sacado } = await supabaseAdmin
              .from('sacados')
              .select('user_id')
              .eq('cnpj', cnpj)
              .single()

            if (sacado) {
              await supabaseAdmin.from('notificacoes').insert({
                usuario_id: (sacado as { user_id: string }).user_id,
                titulo: 'Vencimento em 5 dias',
                mensagem: `Pagamento da operacao #${op.id.substring(0, 8)} vence em 5 dias. Favor providenciar.`,
                tipo: 'alerta_vencimento',
              })
            }
          }
        }
      }

      resultados.alertas_d5++
    }

    // D-1 alert
    if (vencimento === formatDate(em1dia)) {
      await supabaseAdmin.from('notificacoes').insert({
        usuario_id: op.cedentes.user_id,
        titulo: 'VENCIMENTO AMANHA',
        mensagem: `A operacao #${op.id.substring(0, 8)} vence AMANHA (${vencimento}).`,
        tipo: 'alerta_vencimento_urgente',
      })

      // Notificar gestores
      const { data: gestores } = await supabaseAdmin.from('profiles').select('id').eq('role', 'gestor')
      if (gestores) {
        for (const g of gestores as Array<{ id: string }>) {
          await supabaseAdmin.from('notificacoes').insert({
            usuario_id: g.id,
            titulo: 'Vencimento amanha',
            mensagem: `Operacao #${op.id.substring(0, 8)} do cedente ${op.cedentes.razao_social} vence amanha.`,
            tipo: 'alerta_vencimento_gestor',
          })
        }
      }

      resultados.alertas_d1++
    }

    // Inadimplencia — vencido e ainda em_andamento
    if (vencimento < formatDate(hoje)) {
      await supabaseAdmin
        .from('operacoes')
        .update({ status: 'inadimplente' })
        .eq('id', op.id)

      // Alerta urgente ao gestor
      const { data: gestores } = await supabaseAdmin.from('profiles').select('id').eq('role', 'gestor')
      if (gestores) {
        for (const g of gestores as Array<{ id: string }>) {
          await supabaseAdmin.from('notificacoes').insert({
            usuario_id: g.id,
            titulo: 'ALERTA URGENTE: Operacao inadimplente',
            mensagem: `A operacao #${op.id.substring(0, 8)} do cedente ${op.cedentes.razao_social} venceu em ${vencimento} e o sacado NAO pagou.`,
            tipo: 'inadimplencia_urgente',
          })
        }
      }

      await supabaseAdmin.from('notificacoes').insert({
        usuario_id: op.cedentes.user_id,
        titulo: 'Operacao inadimplente',
        mensagem: `A operacao #${op.id.substring(0, 8)} esta inadimplente. O sacado nao efetuou o pagamento no vencimento.`,
        tipo: 'operacao_inadimplente',
      })

      await supabaseAdmin.from('logs_auditoria').insert({
        usuario_id: null,
        tipo_evento: 'OPERACAO_INADIMPLENTE_AUTO',
        entidade_tipo: 'operacoes',
        entidade_id: op.id,
        dados_antes: { status: 'em_andamento' },
        dados_depois: { status: 'inadimplente', source: 'cron' },
      })

      resultados.inadimplentes++
    }
  }

  return Response.json({
    success: true,
    ...resultados,
    processadas: ops.length,
    timestamp: new Date().toISOString(),
  })
}
