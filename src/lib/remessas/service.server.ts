import 'server-only'

import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import { registrarLog } from '@/lib/actions/auditoria'
import { resolverDefinicaoRemessaOperacional } from '@/lib/integracoes/registry.server'
import { createAdminClient } from '@/lib/supabase/server'
import { buckets } from '@/lib/storage'
import { agruparRemessa, hashRemessa, stableStringify, type EstrategiaAgrupamentoRemessa, type RemessaFormato } from './domain'
import { gerarArquivoCnabLegado } from './adapters/cnab444.server'
import { carregarLoteRemessaCanonico } from './loader.server'
import { gerarExcelConferenciaRemessa } from './xlsx'
import { mapearGrupoParaVrs } from './vrs/mapper'
import { serializarVrsInclusaoCsv } from './vrs/csv'
import { enviarRemessaPortalFidc } from '@/lib/portal-fidc/integracao'

type AdminClient = ReturnType<typeof createAdminClient>

interface ArquivoGerado {
  id: string
  cedenteId: string | null
  remessaCnabId: string | null
  formato: RemessaFormato
  nomeArquivo: string
  bucket: string
  storagePath: string
  sha256: string
  idempotencyKey: string
  conteudo: Buffer
  chaves: Array<{
    operacaoId: string
    notaFiscalId: string
    parcelaId: string | null
    chaveUnicaAtivo: string
    chaveUnicaParcela: string | null
  }>
  uploadNovo: boolean
}

export interface RemessaOperacionalResultado {
  remessaId: string
  formato: RemessaFormato
  estrategiaAgrupamento: EstrategiaAgrupamentoRemessa
  adapterKey: string
  arquivos: Array<{ id: string; cedenteId: string | null; nomeArquivo: string; status: string }>
  excelDisponivel: boolean
  envioAutomaticoSuportado: boolean
  motivoBloqueioEnvio: string | null
  idempotentReplay: boolean
}

function nomeSeguro(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
}

async function carregarResultadoExistente(admin: AdminClient, id: string, idempotentReplay: boolean): Promise<RemessaOperacionalResultado> {
  const { data: remessaRaw, error: remessaError } = await admin
    .from('remessas_operacionais')
    .select('id, adapter_key, estrategia_agrupamento, excel_storage_path')
    .eq('id', id)
    .single()
  if (remessaError || !remessaRaw) throw new Error(`Remessa operacional nao encontrada: ${remessaError?.message ?? id}`)
  const remessa = remessaRaw as { id: string; adapter_key: string; estrategia_agrupamento: EstrategiaAgrupamentoRemessa; excel_storage_path: string | null }
  const definition = resolverDefinicaoRemessaOperacional(remessa.adapter_key)
  if (!definition) throw new Error(`Adapter ${remessa.adapter_key} nao possui gerador de remessa registrado.`)
  const { data: arquivosRaw, error: arquivosError } = await admin
    .from('remessa_operacional_arquivos')
    .select('id, cedente_id, nome_arquivo, status')
    .eq('remessa_operacional_id', id)
    .order('nome_arquivo')
  if (arquivosError) throw new Error(`Nao foi possivel carregar os arquivos da remessa: ${arquivosError.message}`)
  return {
    remessaId: id,
    formato: definition.formato,
    estrategiaAgrupamento: remessa.estrategia_agrupamento,
    adapterKey: remessa.adapter_key,
    arquivos: ((arquivosRaw ?? []) as Array<{ id: string; cedente_id: string | null; nome_arquivo: string; status: string }>).map((arquivo) => ({
      id: arquivo.id, cedenteId: arquivo.cedente_id, nomeArquivo: arquivo.nome_arquivo, status: arquivo.status,
    })),
    excelDisponivel: Boolean(remessa.excel_storage_path),
    envioAutomaticoSuportado: definition.envioAutomaticoSuportado,
    motivoBloqueioEnvio: definition.motivoBloqueioEnvio ?? null,
    idempotentReplay,
  }
}

export async function gerarRemessaOperacional(input: { operacaoIds: string[]; userId: string }): Promise<RemessaOperacionalResultado> {
  const admin = createAdminClient()
  const lote = await carregarLoteRemessaCanonico(input.operacaoIds, admin)
  const definition = resolverDefinicaoRemessaOperacional(lote.integracao.adapterKey)
  if (!definition) throw new Error(`Adapter ${lote.integracao.adapterKey} nao possui gerador de remessa implementado.`)
  const payloadHash = hashRemessa(stableStringify(lote))
  const idempotencyKey = hashRemessa(stableStringify({
    tipo: 'remessa_operacional',
    fundoId: lote.fundo.id,
    integracaoVersaoId: lote.integracao.versaoId,
    adapterKey: lote.integracao.adapterKey,
    operacaoIds: [...new Set(input.operacaoIds)].sort(),
  }))
  const { data: existenteRaw, error: existenteError } = await admin
    .from('remessas_operacionais')
    .select('id, payload_hash')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (existenteError) throw new Error(`Nao foi possivel consultar a idempotencia da remessa: ${existenteError.message}`)
  if (existenteRaw) {
    const existente = existenteRaw as { id: string; payload_hash: string }
    if (existente.payload_hash !== payloadHash) throw new Error('A mesma cessao ja possui remessa com payload diferente. Revise os dados antes de reprocessar.')
    return carregarResultadoExistente(admin, existente.id, true)
  }

  const remessaId = randomUUID()
  const arquivos: ArquivoGerado[] = []
  const uploadsNovos: string[] = []
  if (lote.integracao.adapterKey === 'vortx_vrs') {
    const grupos = agruparRemessa(lote.operacoes, definition.estrategiaAgrupamento)
    for (const grupo of grupos) {
      const mapped = mapearGrupoParaVrs(grupo, lote.integracao.configuracao)
      const csv = serializarVrsInclusaoCsv(mapped)
      const nomeArquivo = `${mapped.cedenteCnpj}.csv`
      const storagePath = `operacionais/${lote.fundo.id}/${remessaId}/${nomeArquivo}`
      arquivos.push({
        id: randomUUID(),
        cedenteId: mapped.cedenteId,
        remessaCnabId: null,
        formato: 'VRS_CSV',
        nomeArquivo,
        bucket: buckets.remessasCnab,
        storagePath,
        sha256: csv.sha256,
        idempotencyKey: hashRemessa(`${idempotencyKey}:${mapped.cedenteId}`),
        conteudo: csv.conteudo,
        uploadNovo: true,
        chaves: [
          ...mapped.ativos.map((item) => ({ operacaoId: item.operacaoId, notaFiscalId: item.notaFiscalId, parcelaId: null, chaveUnicaAtivo: item.chaveUnicaAtivo, chaveUnicaParcela: null })),
          ...mapped.fluxos.map((item) => ({ operacaoId: item.operacaoId, notaFiscalId: item.notaFiscalId, parcelaId: item.parcelaId, chaveUnicaAtivo: item.chaveUnicaAtivo, chaveUnicaParcela: item.chaveUnicaParcela })),
        ],
      })
    }
  } else if (lote.integracao.adapterKey === 'sinqia_portal_fidc') {
    if (input.operacaoIds.length !== 1) throw new Error('O gerador CNAB legado atualmente suporta uma operacao por lote; o core nao aplicou agrupamento por Cedente.')
    const cnab = await gerarArquivoCnabLegado({ operacaoId: input.operacaoIds[0], userId: input.userId })
    arquivos.push({
      id: randomUUID(), cedenteId: null, remessaCnabId: cnab.remessaCnabId, formato: 'CNAB444',
      nomeArquivo: cnab.nomeArquivo, bucket: cnab.bucket, storagePath: cnab.storagePath,
      sha256: cnab.sha256, idempotencyKey: hashRemessa(`${idempotencyKey}:lote`), conteudo: cnab.conteudo,
      uploadNovo: false, chaves: [],
    })
  } else {
    throw new Error(`Gerador de remessa do adapter ${lote.integracao.adapterKey} ainda nao implementado.`)
  }
  if (arquivos.length === 0) throw new Error('O adapter nao produziu arquivos de remessa.')

  const excel = await gerarExcelConferenciaRemessa(lote, definition.formato, definition.estrategiaAgrupamento)
  const excelNome = `conferencia_remessa_${remessaId.slice(0, 8)}.xlsx`
  const excelPath = `operacionais/${lote.fundo.id}/${remessaId}/${excelNome}`
  try {
    for (const arquivo of arquivos.filter((item) => item.uploadNovo)) {
      const upload = await admin.storage.from(arquivo.bucket).upload(arquivo.storagePath, arquivo.conteudo, {
        contentType: arquivo.formato === 'VRS_CSV' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8', upsert: false,
      })
      if (upload.error) throw new Error(`Erro ao salvar ${arquivo.nomeArquivo} no Storage: ${upload.error.message}`)
      uploadsNovos.push(arquivo.storagePath)
    }
    const excelUpload = await admin.storage.from(buckets.remessasCnab).upload(excelPath, excel, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: false,
    })
    if (excelUpload.error) throw new Error(`Erro ao salvar Excel de conferencia: ${excelUpload.error.message}`)
    uploadsNovos.push(excelPath)

    const { error: remessaError } = await admin.from('remessas_operacionais').insert({
      id: remessaId,
      fundo_id: lote.fundo.id,
      integracao_fundo_versao_id: lote.integracao.versaoId,
      adapter_key: lote.integracao.adapterKey,
      estrategia_agrupamento: definition.estrategiaAgrupamento,
      status: 'validada',
      idempotency_key: idempotencyKey,
      payload_hash: payloadHash,
      excel_bucket: buckets.remessasCnab,
      excel_storage_path: excelPath,
      excel_sha256: hashRemessa(excel),
      gerado_por: input.userId,
    })
    if (remessaError) throw new Error(`Erro ao registrar a remessa operacional: ${remessaError.message}`)

    const { error: operacoesError } = await admin.from('remessa_operacional_operacoes').insert(
      [...new Set(input.operacaoIds)].map((operacaoId) => ({ remessa_operacional_id: remessaId, operacao_id: operacaoId })),
    )
    if (operacoesError) throw new Error(`Erro ao vincular operacoes a remessa: ${operacoesError.message}`)

    const { error: arquivosError } = await admin.from('remessa_operacional_arquivos').insert(arquivos.map((arquivo) => ({
      id: arquivo.id,
      remessa_operacional_id: remessaId,
      cedente_id: arquivo.cedenteId,
      remessa_cnab_id: arquivo.remessaCnabId,
      formato: arquivo.formato,
      nome_arquivo: arquivo.nomeArquivo,
      bucket: arquivo.bucket,
      storage_path: arquivo.storagePath,
      sha256: arquivo.sha256,
      status: 'validada' as const,
      idempotency_key: arquivo.idempotencyKey,
    })))
    if (arquivosError) throw new Error(`Erro ao registrar os arquivos da remessa: ${arquivosError.message}`)

    const chaves = arquivos.flatMap((arquivo) => arquivo.chaves.map((chave) => ({
      remessa_operacional_arquivo_id: arquivo.id,
      operacao_id: chave.operacaoId,
      nota_fiscal_id: chave.notaFiscalId,
      parcela_id: chave.parcelaId,
      chave_unica_ativo: chave.chaveUnicaAtivo,
      chave_unica_parcela: chave.chaveUnicaParcela,
    })))
    if (chaves.length > 0) {
      const { error: chavesError } = await admin.from('remessa_operacional_chaves').insert(chaves)
      if (chavesError) throw new Error(`Erro ao persistir as chaves VRS: ${chavesError.message}`)
    }

    await admin.from('operacoes').update({ remessa_url: arquivos[0].storagePath, remessa_gerado_em: new Date().toISOString() } as never).in('id', input.operacaoIds)
    await registrarLog({
      tipo_evento: 'REMESSA_OPERACIONAL_GERADA',
      entidade_tipo: 'remessas_operacionais',
      entidade_id: remessaId,
      dados_depois: {
        fundo_id: lote.fundo.id,
        adapter_key: lote.integracao.adapterKey,
        formato: definition.formato,
        estrategia_agrupamento: definition.estrategiaAgrupamento,
        operacao_ids: input.operacaoIds,
        quantidade_arquivos: arquivos.length,
        payload_hash: payloadHash,
      },
    })
    return carregarResultadoExistente(admin, remessaId, false)
  } catch (error) {
    await admin.from('remessas_operacionais').delete().eq('id', remessaId)
    if (uploadsNovos.length > 0) await admin.storage.from(buckets.remessasCnab).remove(uploadsNovos)
    throw error
  }
}

async function carregarRemessaParaDownload(admin: AdminClient, remessaId: string) {
  const { data: remessaRaw, error: remessaError } = await admin
    .from('remessas_operacionais')
    .select('id, fundo_id, adapter_key, excel_bucket, excel_storage_path, excel_sha256')
    .eq('id', remessaId)
    .single()
  if (remessaError || !remessaRaw) throw new Error('Remessa operacional nao encontrada.')
  return remessaRaw as { id: string; fundo_id: string; adapter_key: string; excel_bucket: string | null; excel_storage_path: string | null; excel_sha256: string | null }
}

export async function baixarExcelRemessa(remessaId: string) {
  const admin = createAdminClient()
  const remessa = await carregarRemessaParaDownload(admin, remessaId)
  if (!remessa.excel_bucket || !remessa.excel_storage_path || !remessa.excel_sha256) throw new Error('Excel de conferencia nao disponivel para esta remessa.')
  const { data, error } = await admin.storage.from(remessa.excel_bucket).download(remessa.excel_storage_path)
  if (error || !data) throw new Error('Excel de conferencia nao encontrado no Storage.')
  const conteudo = Buffer.from(await data.arrayBuffer())
  if (hashRemessa(conteudo) !== remessa.excel_sha256) throw new Error('Hash do Excel de conferencia diverge da trilha persistida.')
  await registrarLog({ tipo_evento: 'REMESSA_OPERACIONAL_EXCEL_BAIXADO', entidade_tipo: 'remessas_operacionais', entidade_id: remessaId, dados_depois: { fundo_id: remessa.fundo_id } })
  return { conteudo, nomeArquivo: nomeSeguro(remessa.excel_storage_path.split('/').at(-1) ?? `conferencia_${remessaId}.xlsx`), fundoId: remessa.fundo_id }
}

export async function baixarPacoteRemessa(remessaId: string) {
  const admin = createAdminClient()
  const remessa = await carregarRemessaParaDownload(admin, remessaId)
  const { data: arquivosRaw, error: arquivosError } = await admin
    .from('remessa_operacional_arquivos')
    .select('nome_arquivo, bucket, storage_path, sha256')
    .eq('remessa_operacional_id', remessaId)
    .order('nome_arquivo')
  if (arquivosError) throw new Error(`Nao foi possivel carregar o pacote: ${arquivosError.message}`)
  const arquivos = (arquivosRaw ?? []) as Array<{ nome_arquivo: string; bucket: string; storage_path: string; sha256: string }>
  if (arquivos.length === 0) throw new Error('Remessa sem arquivos para download.')
  const zip = new JSZip()
  for (const arquivo of arquivos) {
    const { data, error } = await admin.storage.from(arquivo.bucket).download(arquivo.storage_path)
    if (error || !data) throw new Error(`Arquivo ${arquivo.nome_arquivo} nao encontrado no Storage.`)
    const conteudo = Buffer.from(await data.arrayBuffer())
    if (hashRemessa(conteudo) !== arquivo.sha256) throw new Error(`Hash do arquivo ${arquivo.nome_arquivo} diverge da trilha persistida.`)
    zip.file(nomeSeguro(arquivo.nome_arquivo), conteudo)
  }
  const conteudo = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await registrarLog({ tipo_evento: 'REMESSA_OPERACIONAL_PACOTE_BAIXADO', entidade_tipo: 'remessas_operacionais', entidade_id: remessaId, dados_depois: { fundo_id: remessa.fundo_id, quantidade_arquivos: arquivos.length } })
  return { conteudo, nomeArquivo: `remessas_lote_${remessaId}.zip`, fundoId: remessa.fundo_id }
}

export async function carregarUltimaRemessaDaOperacao(operacaoId: string) {
  const admin = createAdminClient()
  const { data: link, error } = await admin
    .from('remessa_operacional_operacoes')
    .select('remessa_operacional_id')
    .eq('operacao_id', operacaoId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Nao foi possivel consultar a remessa da operacao: ${error.message}`)
  return link ? carregarResultadoExistente(admin, (link as { remessa_operacional_id: string }).remessa_operacional_id, false) : null
}

export class EnvioRemessaNaoSuportadoError extends Error {
  readonly status = 422
}

export function consolidarStatusSubremessas(statuses: Array<'enviada' | 'erro'>) {
  if (statuses.length === 0 || statuses.every((status) => status === 'erro')) return 'erro' as const
  if (statuses.every((status) => status === 'enviada')) return 'enviada' as const
  return 'parcial' as const
}

export async function enviarRemessaOperacional(operacaoId: string) {
  const admin = createAdminClient()
  const remessa = await carregarUltimaRemessaDaOperacao(operacaoId)
  if (!remessa) throw new Error('Gere a remessa antes de envia-la para a administradora.')
  const definition = resolverDefinicaoRemessaOperacional(remessa.adapterKey)
  if (!definition) throw new EnvioRemessaNaoSuportadoError(`Adapter ${remessa.adapterKey} sem contrato de envio registrado.`)
  if (!definition.envioAutomaticoSuportado) {
    throw new EnvioRemessaNaoSuportadoError(definition.motivoBloqueioEnvio ?? 'O adapter atual nao suporta envio automatico.')
  }
  if (remessa.adapterKey !== 'sinqia_portal_fidc') {
    throw new EnvioRemessaNaoSuportadoError(`Envio automatico do adapter ${remessa.adapterKey} ainda nao implementado.`)
  }
  try {
    const resultado = await enviarRemessaPortalFidc(operacaoId)
    const now = new Date().toISOString()
    await admin.from('remessa_operacional_arquivos').update({ status: 'enviada', id_externo: resultado.idArquivo, enviado_em: now, erro_tecnico: null }).eq('remessa_operacional_id', remessa.remessaId)
    await admin.from('remessas_operacionais').update({ status: 'enviada', enviado_em: now, erro_tecnico: null }).eq('id', remessa.remessaId)
    await registrarLog({
      tipo_evento: 'REMESSA_OPERACIONAL_ENVIADA', entidade_tipo: 'remessas_operacionais', entidade_id: remessa.remessaId,
      dados_depois: { operacao_id: operacaoId, adapter_key: remessa.adapterKey, protocolo_externo: resultado.idArquivo },
    })
    return { ...resultado, remessaId: remessa.remessaId, statusGlobal: 'enviada' as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido no envio da remessa.'
    await admin.from('remessa_operacional_arquivos').update({ status: 'erro', erro_tecnico: message.slice(0, 1000) }).eq('remessa_operacional_id', remessa.remessaId)
    await admin.from('remessas_operacionais').update({ status: 'erro', erro_tecnico: message.slice(0, 1000) }).eq('id', remessa.remessaId)
    throw error
  }
}
