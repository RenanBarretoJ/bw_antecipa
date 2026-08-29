import 'server-only'

import { randomUUID } from 'node:crypto'
import { carregarContextoCnab444, gerarRemessaCnab444ComSequencial } from '@/lib/cnab/gerarCnab444'
import { createAdminClient } from '@/lib/supabase/server'
import { buckets } from '@/lib/storage'
import { registrarLog } from '@/lib/actions/auditoria'

export interface ArquivoCnabLegadoGerado {
  remessaCnabId: string
  fundoId: string
  nomeArquivo: string
  bucket: string
  storagePath: string
  sha256: string
  payloadHash: string
  idempotencyKey: string
  conteudo: Buffer
  idempotentReplay: boolean
}

export class CnabPayloadConflictError extends Error {}

function storagePathRemessa(input: { fundoId: string; configuracaoId: string; remessaId: string; nomeArquivo: string; dataGeracao: string }) {
  const data = new Date(input.dataGeracao)
  return `${input.fundoId}/${input.configuracaoId}/${data.getUTCFullYear()}/${String(data.getUTCMonth() + 1).padStart(2, '0')}/${input.remessaId}/${input.nomeArquivo}`
}

async function baixar(admin: ReturnType<typeof createAdminClient>, path: string) {
  const { data, error } = await admin.storage.from(buckets.remessasCnab).download(path)
  if (error || !data) throw new Error('Remessa idempotente registrada, mas arquivo nao encontrado no Storage.')
  return Buffer.from(await data.arrayBuffer())
}

export async function gerarArquivoCnabLegado(input: { operacaoId: string; userId: string }): Promise<ArquivoCnabLegadoGerado> {
  const admin = createAdminClient()
  const contexto = await carregarContextoCnab444({ operacaoIds: [input.operacaoId], supabase: admin })
  const { data: existing, error: existingError } = await admin
    .from('remessas_cnab')
    .select('id, fundo_id, payload_hash, storage_path, nome_arquivo, sha256')
    .eq('idempotency_key', contexto.idempotencyKey)
    .maybeSingle()
  if (existingError) throw new Error(`Erro ao consultar remessa CNAB idempotente: ${existingError.message}`)
  if (existing) {
    const remessa = existing as { id: string; fundo_id: string; payload_hash: string; storage_path: string; nome_arquivo: string; sha256: string }
    if (remessa.payload_hash !== contexto.payloadHash) throw new CnabPayloadConflictError('Ja existe remessa CNAB para a chave de idempotencia com payload diferente.')
    const { error: replayUpdateError } = await admin.from('operacoes').update({
      remessa_url: remessa.storage_path,
      remessa_gerado_em: new Date().toISOString(),
    } as never).eq('id', input.operacaoId)
    if (replayUpdateError) throw new Error(`Erro ao atualizar a operacao com a remessa CNAB idempotente: ${replayUpdateError.message}`)
    return {
      remessaCnabId: remessa.id,
      fundoId: remessa.fundo_id,
      nomeArquivo: remessa.nome_arquivo,
      bucket: buckets.remessasCnab,
      storagePath: remessa.storage_path,
      sha256: remessa.sha256,
      payloadHash: remessa.payload_hash,
      idempotencyKey: contexto.idempotencyKey,
      conteudo: await baixar(admin, remessa.storage_path),
      idempotentReplay: true,
    }
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
  const path = storagePathRemessa({
    fundoId: remessa.fundoId,
    configuracaoId: remessa.configuracaoCnabId,
    remessaId,
    nomeArquivo: remessa.nomeArquivo,
    dataGeracao: contexto.dataGeracao,
  })
  const conteudo = Buffer.from(remessa.resultado.conteudo, 'utf8')
  const upload = await admin.storage.from(buckets.remessasCnab).upload(path, conteudo, { contentType: 'text/plain; charset=utf-8', upsert: false })
  if (upload.error) throw new Error(`Erro ao salvar CNAB no Storage: ${upload.error.message}`)

  const compensar = async () => { await admin.storage.from(buckets.remessasCnab).remove([path]) }
  const { error: insertError } = await admin.from('remessas_cnab').insert({
    id: remessaId,
    fundo_id: remessa.fundoId,
    configuracao_cnab_id: remessa.configuracaoCnabId,
    configuracao_cnab_versao_id: remessa.configuracaoCnabVersaoId,
    configuracao_versao: remessa.input.configuracao.versao,
    configuracao_hash: remessa.input.configuracao.hash,
    status: 'validada',
    bucket: buckets.remessasCnab,
    storage_path: path,
    sha256: remessa.resultado.sha256,
    quantidade_registros: remessa.resultado.quantidadeRegistros,
    quantidade_titulos: remessa.resultado.quantidadeTitulos,
    valor_total: remessa.resultado.valorTotal,
    nome_arquivo: remessa.nomeArquivo,
    sequencial,
    idempotency_key: remessa.idempotencyKey,
    payload_hash: remessa.payloadHash,
    gerado_por: input.userId,
  } as never)
  if (insertError) {
    await compensar()
    throw new Error(`Erro ao registrar remessa CNAB: ${insertError.message}`)
  }
  const { error: linkError } = await admin.from('remessas_cnab_operacoes').insert({ remessa_cnab_id: remessaId, operacao_id: input.operacaoId } as never)
  if (linkError) {
    await admin.from('remessas_cnab').delete().eq('id', remessaId)
    await compensar()
    throw new Error(`Erro ao vincular operacao a remessa CNAB: ${linkError.message}`)
  }
  const { error: updateError } = await admin.from('operacoes').update({ remessa_url: path, remessa_gerado_em: new Date().toISOString() } as never).eq('id', input.operacaoId)
  if (updateError) {
    await admin.from('remessas_cnab_operacoes').delete().eq('remessa_cnab_id', remessaId)
    await admin.from('remessas_cnab').delete().eq('id', remessaId)
    await compensar()
    throw new Error(`Erro ao atualizar operacao com remessa CNAB: ${updateError.message}`)
  }
  await registrarLog({
    tipo_evento: 'REMESSA_CNAB_GERADA',
    entidade_tipo: 'remessas_cnab',
    entidade_id: remessaId,
    dados_depois: { operacao_id: input.operacaoId, fundo_id: remessa.fundoId, configuracao_cnab_versao_id: remessa.configuracaoCnabVersaoId, sequencial },
  })
  return {
    remessaCnabId: remessaId,
    fundoId: remessa.fundoId,
    nomeArquivo: remessa.nomeArquivo,
    bucket: buckets.remessasCnab,
    storagePath: path,
    sha256: remessa.resultado.sha256,
    payloadHash: remessa.payloadHash,
    idempotencyKey: remessa.idempotencyKey,
    conteudo,
    idempotentReplay: false,
  }
}
