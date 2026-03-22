import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// API Route para sincronizar movimentos da conta escrow com sistema externo.
// Autenticada via API key no header Authorization.
//
// POST /api/escrow/sync
// Headers: { Authorization: "Bearer <ESCROW_API_KEY>" }
// Body: {
//   conta_escrow_identificador: "ESC-12345678000199-0001",
//   movimentos: [
//     { tipo: "credito", descricao: "Pagamento NF 001", valor: 15000.00, data: "2026-03-21", referencia_externa: "TED-123" },
//     { tipo: "debito", descricao: "Taxa operacao", valor: 500.00, data: "2026-03-21", referencia_externa: "TAXA-456" }
//   ]
// }

const ESCROW_API_KEY = process.env.ESCROW_API_KEY

export async function POST(request: NextRequest) {
  // Autenticacao via API key
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!ESCROW_API_KEY || token !== ESCROW_API_KEY) {
    return Response.json({ error: 'Nao autorizado.' }, { status: 401 })
  }

  // Usar service_role para bypass de RLS (API interna server-to-server)
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  try {
    const body = await request.json()
    const { conta_escrow_identificador, movimentos } = body as {
      conta_escrow_identificador: string
      movimentos: Array<{
        tipo: 'credito' | 'debito'
        descricao: string
        valor: number
        data?: string
        referencia_externa?: string
      }>
    }

    if (!conta_escrow_identificador) {
      return Response.json({ error: 'conta_escrow_identificador e obrigatorio.' }, { status: 400 })
    }

    if (!movimentos || !Array.isArray(movimentos) || movimentos.length === 0) {
      return Response.json({ error: 'movimentos deve ser um array nao vazio.' }, { status: 400 })
    }

    // Buscar conta escrow pelo identificador
    const { data: conta, error: contaError } = await supabaseAdmin
      .from('contas_escrow')
      .select('id, saldo_disponivel, status, cedente_id')
      .eq('identificador', conta_escrow_identificador)
      .single()

    if (contaError || !conta) {
      return Response.json({ error: 'Conta escrow nao encontrada.' }, { status: 404 })
    }

    const contaData = conta as { id: string; saldo_disponivel: number; status: string; cedente_id: string }

    if (contaData.status !== 'ativa') {
      return Response.json({ error: 'Conta escrow nao esta ativa.' }, { status: 400 })
    }

    // Validar movimentos
    for (const mov of movimentos) {
      if (!mov.tipo || !['credito', 'debito'].includes(mov.tipo)) {
        return Response.json({ error: `tipo invalido: ${mov.tipo}. Use "credito" ou "debito".` }, { status: 400 })
      }
      if (!mov.valor || mov.valor <= 0) {
        return Response.json({ error: 'valor deve ser positivo.' }, { status: 400 })
      }
      if (!mov.descricao) {
        return Response.json({ error: 'descricao e obrigatoria.' }, { status: 400 })
      }
    }

    // Processar movimentos
    let saldoAtual = contaData.saldo_disponivel
    const rows = []

    for (const mov of movimentos) {
      const novoSaldo = mov.tipo === 'credito'
        ? saldoAtual + mov.valor
        : saldoAtual - mov.valor

      if (mov.tipo === 'debito' && novoSaldo < 0) {
        return Response.json({
          error: `Saldo insuficiente para debito de ${mov.valor}. Saldo atual: ${saldoAtual}.`,
        }, { status: 400 })
      }

      rows.push({
        conta_escrow_id: contaData.id,
        tipo: mov.tipo,
        descricao: mov.referencia_externa
          ? `${mov.descricao} [Ref: ${mov.referencia_externa}]`
          : mov.descricao,
        valor: mov.valor,
        saldo_apos: novoSaldo,
        operacao_id: null,
      })

      saldoAtual = novoSaldo
    }

    // Inserir movimentos
    const { error: insertError } = await supabaseAdmin
      .from('movimentos_escrow')
      .insert(rows)

    if (insertError) {
      return Response.json({ error: `Erro ao inserir movimentos: ${insertError.message}` }, { status: 500 })
    }

    // Atualizar saldo final
    const { error: updateError } = await supabaseAdmin
      .from('contas_escrow')
      .update({ saldo_disponivel: saldoAtual })
      .eq('id', contaData.id)

    if (updateError) {
      return Response.json({ error: `Erro ao atualizar saldo: ${updateError.message}` }, { status: 500 })
    }

    // Registrar log
    await supabaseAdmin.from('logs_auditoria').insert({
      usuario_id: null,
      tipo_evento: 'ESCROW_SYNC_API',
      entidade_tipo: 'contas_escrow',
      entidade_id: contaData.id,
      dados_depois: {
        movimentos_count: rows.length,
        saldo_final: saldoAtual,
        source: 'api_externa',
      },
    })

    return Response.json({
      success: true,
      conta_escrow_identificador,
      movimentos_processados: rows.length,
      saldo_anterior: contaData.saldo_disponivel,
      saldo_atual: saldoAtual,
    })
  } catch {
    return Response.json({ error: 'Erro interno ao processar requisicao.' }, { status: 500 })
  }
}

// GET /api/escrow/sync?identificador=ESC-xxx — consultar saldo e ultimos movimentos
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!ESCROW_API_KEY || token !== ESCROW_API_KEY) {
    return Response.json({ error: 'Nao autorizado.' }, { status: 401 })
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const identificador = request.nextUrl.searchParams.get('identificador')
  if (!identificador) {
    return Response.json({ error: 'parametro identificador e obrigatorio.' }, { status: 400 })
  }

  const { data: conta } = await supabaseAdmin
    .from('contas_escrow')
    .select('id, identificador, saldo_disponivel, saldo_bloqueado, status, created_at')
    .eq('identificador', identificador)
    .single()

  if (!conta) {
    return Response.json({ error: 'Conta nao encontrada.' }, { status: 404 })
  }

  const contaData = conta as { id: string; identificador: string; saldo_disponivel: number; saldo_bloqueado: number; status: string; created_at: string }

  const { data: movimentos } = await supabaseAdmin
    .from('movimentos_escrow')
    .select('tipo, descricao, valor, saldo_apos, created_at')
    .eq('conta_escrow_id', contaData.id)
    .order('created_at', { ascending: false })
    .limit(50)

  return Response.json({
    conta: {
      identificador: contaData.identificador,
      saldo_disponivel: contaData.saldo_disponivel,
      saldo_bloqueado: contaData.saldo_bloqueado,
      status: contaData.status,
      created_at: contaData.created_at,
    },
    movimentos: movimentos || [],
  })
}
