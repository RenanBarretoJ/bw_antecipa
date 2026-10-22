import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { registrarEventoSeguranca } from '@/lib/auth/mfa'
import { obterDataCivilOperacional } from '@/lib/operacoes/data-operacional.server'
import { integrationRuntimeEnvironment, resolverIntegracaoPorCapability } from '../resolver.server'
import { resolverConfiguracaoVortxVrs } from './credenciais.server'
import { consultarOriginalCarteiraVortx } from './carteira-http.server'
import { conferirCompletudeCarteiraVortx } from './carteira-completude'
import { lerConfiguracaoCarteiraVortx, configuracaoCarteiraConsolidadaSchema } from './carteira-configuracao'

const reservaSchema = z.object({ id: z.uuid(), lease: z.uuid(), fundo_id: z.uuid(), versao_id: z.uuid(),
  ambiente: z.literal('producao'), cnpj_fundo: z.string().regex(/^\d{14}$/), codigo_carteira: z.string(),
  data_referencia: z.iso.date(), cotas_esperadas: configuracaoCarteiraConsolidadaSchema,
  hash_arquivo: z.string().regex(/^[a-f0-9]{64}$/), tamanho_bytes: z.number().int().positive(),
  storage_bucket: z.literal('vortx-carteiras'), storage_path: z.string() })
const resultadoSchema = z.object({ id: z.uuid(), estado: z.enum(['PERSISTIDA','DUPLICADA']), duplicada: z.boolean() })
  .refine(result => result.duplicada === (result.estado === 'DUPLICADA'))
const encerramentoSchema = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('PERSISTIDA'), id: z.uuid(), podeRemoverArquivo: z.literal(false) }),
  z.object({ estado: z.literal('DUPLICADA'), id: z.uuid(), podeRemoverArquivo: z.boolean() }),
  z.object({ estado: z.literal('FALHA'), id: z.null(), podeRemoverArquivo: z.boolean() }),
])
const corpoSchema = z.array(z.record(z.string(), z.unknown()))

type CarteiraAuthorization = (scope: { fundoId: string; versaoId: string }) => Promise<void>

/** Internal use case. Human entrypoints must supply a fresh, Fund-scoped authorization check. */
export async function consultarEPersistirCarteiraVortx(input: { fundoId: string; dataReferencia: string }, authorize?: CarteiraAuthorization) {
  const form = z.object({ fundoId: z.uuid(), dataReferencia: z.iso.date() }).strict().parse(input)
  if (form.dataReferencia > obterDataCivilOperacional()) throw new Error('CARTEIRA_DATA_FUTURA')
  const client = createAdminClient()
  const ambiente = integrationRuntimeEnvironment()
  const resolucao = await resolverIntegracaoPorCapability({ fundoId: form.fundoId, ambiente, capability: 'CARTEIRA' }, client)
  if (resolucao.status !== 'CONFIGURADA') return { estado: 'CONFIGURACAO_PENDENTE' as const }
  const version = resolucao.integrationVersion
  if (version.fundoId !== form.fundoId || version.environment !== ambiente || ambiente !== 'producao'
    || version.adapterKey !== 'vortx_vrs' || version.providerKey !== 'VORTX' || version.capability !== 'CARTEIRA') throw new Error('CARTEIRA_CONTEXTO_INVALIDO')
  const leitura = lerConfiguracaoCarteiraVortx(version.config)
  if (leitura.estado !== 'CONFIGURADA') return { estado: leitura.estado === 'NAO_CONFIGURADA' ? 'CONFIGURACAO_PENDENTE' as const : 'REVISAO_NECESSARIA' as const }
  const scope = { fundoId: form.fundoId, versaoId: version.integrationVersionId }
  await authorize?.(scope)
  const fund = await client.from('fundos').select('id,cnpj,ativo').eq('id', form.fundoId).maybeSingle()
  if (fund.error || !fund.data?.ativo || fund.data.id !== form.fundoId) throw new Error('CARTEIRA_FUNDO_INDISPONIVEL')
  const cnpj = fund.data.cnpj.replace(/\D/g, '')
  const config = await resolverConfiguracaoVortxVrs(form.fundoId, ambiente, client)
  if (config.fundoId !== form.fundoId || config.ambiente !== ambiente) throw new Error('CARTEIRA_CREDENCIAL_FORA_DO_ESCOPO')
  const correlationId = randomUUID()
  await registrarEventoSeguranca({ tipo_evento: 'CREDENCIAL_USADA', ator_tipo: 'integracao', correlation_id: correlationId,
    dados: { fundo_id: form.fundoId, versao_id: version.integrationVersionId, data_referencia: form.dataReferencia, uso: 'CARTEIRA_JSON' } })
  const original = await consultarOriginalCarteiraVortx({ config, cnpjFundo: cnpj, dataReferencia: form.dataReferencia })
  const completo = conferirCompletudeCarteiraVortx({ cnpjFundo: cnpj, dataReferencia: form.dataReferencia,
    configuracao: leitura.configuracao, resposta: original.resposta })
  if (completo.estado !== 'COMPLETA') return completo
  const corpo = corpoSchema.parse(original.resposta)
  const hash = createHash('sha256').update(original.arquivo).digest('hex')
  const reserved = await client.rpc('vortx_reservar_carteira', { p_fundo_id: form.fundoId, p_versao_id: version.integrationVersionId,
    p_referencia: form.dataReferencia, p_hash: hash, p_tamanho: original.arquivo.byteLength })
  if (reserved.error) throw new Error('CARTEIRA_RESERVA_INDISPONIVEL')
  const job = reservaSchema.parse(reserved.data)
  if (job.fundo_id !== form.fundoId || job.versao_id !== version.integrationVersionId || job.cnpj_fundo !== cnpj
    || job.data_referencia !== form.dataReferencia || job.codigo_carteira !== version.config.codigo_carteira
    || JSON.stringify(job.cotas_esperadas) !== JSON.stringify(leitura.configuracao)
    || job.hash_arquivo !== hash || job.tamanho_bytes !== original.arquivo.byteLength
    || job.storage_path !== `${form.fundoId}/carteira/${job.id}/carteira.json`) throw new Error('CARTEIRA_MANIFESTO_FORA_DO_ESCOPO')
  const bucket = client.storage.from(job.storage_bucket), args = { p_id: job.id, p_lease: job.lease }
  async function encerrarComSeguranca() {
    const fenced = await Promise.resolve(client.rpc('vortx_encerrar_carteira', args))
      .catch(() => { throw new Error('CARTEIRA_RESULTADO_INDETERMINADO_ORIGINAL_PRESERVADO') })
    const parsed = encerramentoSchema.safeParse(fenced.data)
    if (fenced.error || !parsed.success) throw new Error('CARTEIRA_RESULTADO_INDETERMINADO_ORIGINAL_PRESERVADO')
    if (parsed.data.podeRemoverArquivo) {
      const removed = await bucket.remove([job.storage_path])
      if (removed.error) throw new Error('CARTEIRA_COMPENSACAO_PENDENTE_MANIFESTO_PRESERVADO')
    }
    return parsed.data
  }
  let resultado: z.infer<typeof resultadoSchema>
  try {
    const upload = await bucket.upload(job.storage_path, original.arquivo, { contentType: 'application/json', upsert: false })
    if (upload.error) throw new Error('CARTEIRA_ORIGINAL_INDISPONIVEL')
    await authorize?.(scope)
    const conclusion = await client.rpc('vortx_concluir_carteira', { ...args, p_resposta: corpo })
    const result = resultadoSchema.safeParse(conclusion.data)
    if (conclusion.error || !result.success || (!result.data.duplicada && result.data.id !== job.id)) throw new Error('CARTEIRA_CONCLUSAO_NAO_CONFIRMADA')
    resultado = result.data
  } catch {
    // Fencing locks the same attempt as conclusion. An absent header alone is never rollback proof.
    const confirmed = await encerrarComSeguranca()
    if (confirmed.estado !== 'FALHA' && confirmed.id) return { id: confirmed.id, estado: confirmed.estado,
      duplicada: confirmed.estado === 'DUPLICADA', patrimonioLiquidoTotal: completo.patrimonioLiquidoTotal }
    throw new Error('CARTEIRA_NAO_PERSISTIDA_EXECUCAO_ENCERRADA')
  }
  if (resultado.duplicada) await encerrarComSeguranca()
  return { ...resultado, patrimonioLiquidoTotal: completo.patrimonioLiquidoTotal }
}
