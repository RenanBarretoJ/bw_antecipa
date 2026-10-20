import 'server-only'

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { integrationRuntimeEnvironment, resolverIntegracaoPorCapability } from '../resolver.server'
import { prepararSnapshotEstoqueVortx, type ArquivoPosicaoVortx } from './estoque-snapshot'
import { blocosEstoqueVortx } from './estoque-blocos'

const resultadoSchema = z.object({ id: z.uuid(), status: z.string(), duplicada: z.boolean(), reconciliado: z.boolean().optional() })
const execucaoSchema = z.object({ id: z.uuid(), lease: z.uuid(), ambiente: z.enum(['producao', 'homologacao']),
  versaoId: z.uuid(), codigoCarteira: z.string().min(1).max(100) }).strict()

/** Internal ingestion worker, not a Server Action/API. No webhook or remote download is implemented here. */
export async function ingerirEstoqueNativoVortx(input: {
  fundoId: string
  dataReferencia: string
  ativo: ArquivoPosicaoVortx
  parcela: ArquivoPosicaoVortx
  /** Only the internal callback processor supplies a database-issued lease. SQL revalidates it atomically. */
  execucao?: z.infer<typeof execucaoSchema>
}) {
  const client = createAdminClient()
  const execucao = input.execucao ? execucaoSchema.parse(input.execucao) : null
  const ambiente = execucao?.ambiente ?? integrationRuntimeEnvironment()
  const resolucao = await resolverIntegracaoPorCapability({ fundoId: input.fundoId, ambiente, capability: 'ESTOQUE' }, client)
  if (resolucao.status !== 'CONFIGURADA' || resolucao.integrationVersion.providerKey !== 'VORTX'
    || resolucao.integrationVersion.adapterKey !== 'vortx_vrs') throw new Error('Integracao de estoque Vortx indisponivel.')
  const version = resolucao.integrationVersion
  const codigoCarteira = version.config.codigo_carteira
  if (typeof codigoCarteira !== 'string') throw new Error('Carteira Vortx nao configurada.')
  if (execucao && (version.integrationVersionId !== execucao.versaoId || codigoCarteira !== execucao.codigoCarteira)) {
    throw new Error('Integracao de estoque Vortx indisponivel para esta execucao.')
  }
  const prepared = prepararSnapshotEstoqueVortx({
    contexto: { fundoId: input.fundoId, ambiente, codigoCarteira, dataReferencia: input.dataReferencia,
      dataInicio: input.dataReferencia, dataFim: input.dataReferencia },
    integracaoFundoVersaoId: version.integrationVersionId, ativo: input.ativo, parcela: input.parcela,
  })
  const { ativos, parcelas, ...manifesto } = prepared.payload
  const manifestoEstagiado = execucao ? { ...manifesto, processamento_id: execucao.id, processamento_lease: execucao.lease,
    ativos_total: ativos.length, parcelas_total: parcelas.length } : null
  if (execucao && manifestoEstagiado) {
    // Persist object identities BEFORE upload so a process crash never leaves an untraceable object.
    const intent = await client.rpc('vortx_reservar_manifesto_estoque', { p_id: execucao.id, p_lease: execucao.lease, p_manifesto: manifestoEstagiado })
    if (intent.error || intent.data !== true) throw new Error('Nao foi possivel reservar os arquivos privados Vortx.')
  }
  const uploaded: string[] = []
  const bucket = client.storage.from('financeiro-importacoes')
  async function compensar() {
    if (!uploaded.length) return
    const removed = await bucket.remove(uploaded)
    if (removed.error) throw new Error('Falha na compensacao dos arquivos Vortx; requer reconciliacao interna.')
  }
  try {
    for (const [index, arquivo] of prepared.arquivos.entries()) {
      const conteudo = index === 0 ? input.ativo.conteudo : input.parcela.conteudo
      const upload = await bucket.upload(arquivo.storage_path, conteudo, { contentType: 'text/csv', upsert: false })
      if (upload.error) throw new Error('Nao foi possivel preservar os arquivos privados Vortx.')
      uploaded.push(arquivo.storage_path)
    }
  } catch (error) {
    await compensar()
    throw error
  }
  if (execucao) {
    try {
      for (const tipo of ['ativos', 'parcelas'] as const) for (const bloco of blocosEstoqueVortx(prepared.payload[tipo])) {
        const staged = await client.rpc('vortx_estagiar_linhas_estoque', { p_id: execucao.id, p_lease: execucao.lease,
          p_tipo: tipo, p_ordem: bloco.ordem, p_linhas: bloco.linhas })
        if (staged.error || staged.data !== bloco.linhas.length) throw new Error('Nao foi possivel preservar o bloco de estoque.')
      }
    } catch (error) {
      // Staging cannot commit a financial import. Only uploads owned by this attempt are removed.
      await compensar(); throw error
    }
  }
  const persisted = execucao && manifestoEstagiado
    ? await client.rpc('vortx_concluir_processamento_estoque', { p_id: execucao.id, p_lease: execucao.lease,
      p_payload: manifestoEstagiado })
    : await client.rpc('persistir_estoque_vortx', { p_payload: prepared.payload })
  const result = resultadoSchema.safeParse(persisted.data)
  if (persisted.error || !result.success) {
    // A transport failure is not proof of rollback. Never delete a possibly committed original.
    const confirmed = await client.from('importacoes_financeiras').select('id')
      .eq('id', prepared.payload.id).eq('fundo_id', input.fundoId).maybeSingle()
    if (confirmed.error) throw new Error('Resultado da persistencia indeterminado; arquivos preservados para reconciliacao.')
    if (!confirmed.data) await compensar()
    throw new Error('Nao foi possivel confirmar a persistencia do estoque Vortx.')
  }
  if (result.data.duplicada && result.data.id !== prepared.payload.id) await compensar()
  return { ...result.data, resumo: prepared.composicao.resumo, divergencias: prepared.composicao.divergencias }
}

/** Explicit internal publication; PostgreSQL rechecks completeness, scope and reconciliation. */
export async function publicarEstoqueNativoVortx(importacaoId: string) {
  const id = z.uuid().parse(importacaoId)
  const result = await createAdminClient().rpc('publicar_estoque_vortx', { p_importacao_id: id })
  if (result.error) throw new Error('Estoque Vortx nao publicado. Confira escopo, cobertura e divergencias.')
  return result.data
}
