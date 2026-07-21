import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { carregarContextoCnab444, gerarRemessaCnab444ComSequencial } from '@/lib/cnab/gerarCnab444'
import { AuthorizationError, requireGestor } from '@/lib/auth/authorization'
import { createAdminClient } from '@/lib/supabase/server'
import { buckets } from '@/lib/storage'
import { registrarLog } from '@/lib/actions/auditoria'

export const maxDuration = 60

function storagePathRemessa({
  fundoId,
  configuracaoId,
  remessaId,
  nomeArquivo,
  dataGeracao,
}: {
  fundoId: string
  configuracaoId: string
  remessaId: string
  nomeArquivo: string
  dataGeracao: string
}) {
  const data = new Date(dataGeracao)
  const ano = String(data.getUTCFullYear())
  const mes = String(data.getUTCMonth() + 1).padStart(2, '0')
  return `${fundoId}/${configuracaoId}/${ano}/${mes}/${remessaId}/${nomeArquivo}`
}
async function baixarRemessaExistente(storagePath: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.storage.from(buckets.remessasCnab).download(storagePath)
  if (error || !data) throw new Error('Remessa idempotente ja registrada, mas arquivo nao encontrado no storage.')
  return Buffer.from(await data.arrayBuffer()).toString('utf8')
}

export async function POST(req: NextRequest) {
  try {
    const context = await requireGestor()

    const { operacao_id } = await req.json()
    if (!operacao_id) return NextResponse.json({ error: 'operacao_id obrigatorio' }, { status: 400 })

    const admin = createAdminClient()
    const contexto = await carregarContextoCnab444({ operacaoIds: [operacao_id], supabase: admin })

    const { data: existing } = await admin
      .from('remessas_cnab')
      .select('id, payload_hash, storage_path, nome_arquivo')
      .eq('idempotency_key', contexto.idempotencyKey)
      .maybeSingle()

    if (existing) {
      const remessa = existing as { id: string; payload_hash: string; storage_path: string; nome_arquivo: string }
      if (remessa.payload_hash !== contexto.payloadHash) {
        return NextResponse.json({ error: 'Ja existe remessa para esta chave de idempotencia com payload diferente.' }, { status: 409 })
      }
      const cnabContent = await baixarRemessaExistente(remessa.storage_path)
      await admin.from('operacoes').update({
        remessa_url: remessa.storage_path,
        remessa_gerado_em: new Date().toISOString(),
      } as never).eq('id', operacao_id)
      return new NextResponse(cnabContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${remessa.nome_arquivo}"`,
          'X-Remessa-Cnab-Id': remessa.id,
          'X-Idempotent-Replay': 'true',
        },
      })
    }

    const { data: sequencialData, error: sequencialError } = await admin.rpc('reservar_sequencial_remessa', {
      p_configuracao_cnab_id: contexto.configuracao.configuracaoId,
      p_data_referencia: new Date(contexto.dataGeracao).toISOString().slice(0, 10),
    } as never)

    if (sequencialError) throw new Error(`Erro ao reservar sequencial CNAB: ${sequencialError.message}`)
    const sequencial = Number(sequencialData)
    if (!Number.isInteger(sequencial) || sequencial <= 0) throw new Error('Sequencial CNAB invalido retornado pelo banco.')

    const remessa = gerarRemessaCnab444ComSequencial(contexto, sequencial)
    const remessaId = randomUUID()
    const caminho = storagePathRemessa({
      fundoId: remessa.fundoId,
      configuracaoId: remessa.configuracaoCnabId,
      remessaId,
      nomeArquivo: remessa.nomeArquivo,
      dataGeracao: contexto.dataGeracao,
    })

    const upload = await admin.storage.from(buckets.remessasCnab).upload(
      caminho,
      Buffer.from(remessa.resultado.conteudo, 'utf8'),
      { contentType: 'text/plain; charset=utf-8', upsert: false },
    )
    if (upload.error) throw new Error(`Erro ao salvar CNAB no storage: ${upload.error.message}`)

    const { error: insertError } = await admin.from('remessas_cnab').insert({
      id: remessaId,
      fundo_id: remessa.fundoId,
      configuracao_cnab_id: remessa.configuracaoCnabId,
      configuracao_cnab_versao_id: remessa.configuracaoCnabVersaoId,
      configuracao_versao: remessa.input.configuracao.versao,
      configuracao_hash: remessa.input.configuracao.hash,
      status: 'validada',
      bucket: buckets.remessasCnab,
      storage_path: caminho,
      sha256: remessa.resultado.sha256,
      quantidade_registros: remessa.resultado.quantidadeRegistros,
      quantidade_titulos: remessa.resultado.quantidadeTitulos,
      valor_total: remessa.resultado.valorTotal,
      nome_arquivo: remessa.nomeArquivo,
      sequencial,
      idempotency_key: remessa.idempotencyKey,
      payload_hash: remessa.payloadHash,
      gerado_por: context.user.id,
    } as never)

    if (insertError) throw new Error(`Erro ao registrar remessa CNAB: ${insertError.message}`)

    const { error: linkError } = await admin.from('remessas_cnab_operacoes').insert({
      remessa_cnab_id: remessaId,
      operacao_id,
    } as never)
    if (linkError) throw new Error(`Erro ao vincular operacao a remessa CNAB: ${linkError.message}`)

    await admin.from('operacoes').update({
      remessa_url: caminho,
      remessa_gerado_em: new Date().toISOString(),
    } as never).eq('id', operacao_id)

    await registrarLog({
      tipo_evento: 'REMESSA_CNAB_GERADA',
      entidade_tipo: 'remessas_cnab',
      entidade_id: remessaId,
      dados_depois: {
        operacao_id,
        fundo_id: remessa.fundoId,
        configuracao_cnab_versao_id: remessa.configuracaoCnabVersaoId,
        sequencial,
        quantidade_titulos: remessa.resultado.quantidadeTitulos,
        valor_total: remessa.resultado.valorTotal,
        idempotency_key: remessa.idempotencyKey,
      },
    })

    return new NextResponse(remessa.resultado.conteudo, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${remessa.nomeArquivo}"`,
        'X-Remessa-Cnab-Id': remessaId,
      },
    })
  } catch (error: unknown) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    console.error('[api/contratos/gerar-cnab]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
