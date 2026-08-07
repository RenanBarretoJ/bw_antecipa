import type { AppSupabaseClient } from '@/lib/auth/authorization'
import { requireNotaFiscalAccess } from '@/lib/auth/authorization'
import { registrarLog } from '@/lib/actions/auditoria'
import {
  DOCUMENTO_V2_BUCKET,
  extensaoArquivo,
  mimeArquivo,
  nomeSeguro,
  sha256Arquivo,
  validarArquivoContraTipo,
  type TipoDocumentoV2,
} from '@/lib/documentos-v2/tipos'
import {
  enviarObjetoDocumento,
  gerarCaminhoDocumentoLogistico,
  removerObjetoDocumento,
} from '@/lib/documentos-v2/storage'
import { parseCteXml } from './cte-parser'
import {
  mensagemValidacaoCte,
  validarCteContraNfes,
  type NfeParaValidacaoCte,
} from './validacao-cte-nfe'
import {
  resolverFamiliaDocumentalLogistica,
  type FamiliaDocumentalLogistica,
} from './evidencias-logisticas'
import { nfsCompartilhamContextoCte } from './candidatas-cte.server'

interface UploadLogisticoAntecipadoInput {
  notaFiscalIds: string[]
  politicaRequisitoId: string
  arquivo: File
}

type NotaFiscalLogisticaRow = NfeParaValidacaoCte & {
  cedente_id: string
  cedente_fundo_id: string | null
  fundo_id: string | null
}

function codigoCatalogoParaArquivo(
  familia: FamiliaDocumentalLogistica,
  arquivo: File,
): string[] {
  if (familia === 'cte') {
    return extensaoArquivo(arquivo.name) === 'xml'
      ? ['cte_xml']
      : ['cte_pdf_dacte', 'cte_dacte_pdf']
  }
  return ['comprovante_entrega', 'canhoto']
}

async function carregarNfsAutorizadas(
  notaFiscalIds: string[],
  client: AppSupabaseClient,
): Promise<NotaFiscalLogisticaRow[]> {
  const ids = [...new Set(notaFiscalIds.filter(Boolean))]
  if (ids.length === 0) throw new Error('Informe ao menos uma NF para o documento logistico.')

  const firstContext = await requireNotaFiscalAccess(ids[0], client)
  if (firstContext.profile.role !== 'cedente') {
    throw new Error('Somente o cedente pode enviar documentos logisticos antecipadamente.')
  }
  for (const id of ids.slice(1)) await requireNotaFiscalAccess(id, client)

  const { data, error } = await client
    .from('notas_fiscais')
    .select('id, cedente_id, cedente_fundo_id, fundo_id, chave_acesso, data_emissao, cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, descricao_itens')
    .in('id', ids)

  if (error) throw new Error(`Erro ao consultar as NFs selecionadas: ${error.message}`)
  const rows = (data || []) as NotaFiscalLogisticaRow[]
  if (rows.length !== ids.length) throw new Error('Uma ou mais NFs selecionadas nao foram encontradas.')

  if (!nfsCompartilhamContextoCte(rows)) {
    throw new Error('As NFs selecionadas precisam pertencer ao mesmo cedente, fundo e vinculo ativo.')
  }
  return rows
}

async function resolverTipoDocumento(
  familia: FamiliaDocumentalLogistica,
  arquivo: File,
  client: AppSupabaseClient,
): Promise<TipoDocumentoV2> {
  const codigos = codigoCatalogoParaArquivo(familia, arquivo)
  const { data, error } = await client
    .from('documento_tipos')
    .select('id, codigo, nome, mime_types_aceitos, extensoes_aceitas, tamanho_max_bytes, permite_multiplas_versoes, ativo')
    .in('codigo', codigos)
    .eq('ativo', true)

  if (error) throw new Error(`Erro ao resolver o tipo documental: ${error.message}`)
  const tipos = (data || []) as TipoDocumentoV2[]
  const tipo = codigos.map((codigo) => tipos.find((item) => item.codigo === codigo)).find(Boolean)
  if (!tipo) throw new Error('Tipo documental logistico nao catalogado para este arquivo.')
  const validationError = validarArquivoContraTipo(arquivo, tipo)
  if (validationError) throw new Error(validationError)
  return tipo
}

async function expandirNfsDoCteCompartilhado(
  nfs: NotaFiscalLogisticaRow[],
  politicaVersaoId: string,
  client: AppSupabaseClient,
): Promise<NotaFiscalLogisticaRow[]> {
  const idsSelecionados = nfs.map((nf) => nf.id)
  const { data: evidenciasAtuais, error: evidenciasError } = await client
    .from('evidencias_logisticas_antecipadas')
    .select('documento_id')
    .in('nota_fiscal_id', idsSelecionados)
    .eq('politica_operacional_versao_id', politicaVersaoId)
    .eq('familia_documental', 'cte')

  if (evidenciasError) throw new Error(`Erro ao resolver o CT-e compartilhado: ${evidenciasError.message}`)
  const documentos = Array.from(new Set((evidenciasAtuais || []).map((item) => String(item.documento_id)).filter(Boolean)))
  if (documentos.length === 0) return nfs

  const { data: evidenciasRelacionadas, error: relacionadasError } = await client
    .from('evidencias_logisticas_antecipadas')
    .select('nota_fiscal_id')
    .in('documento_id', documentos)
    .eq('politica_operacional_versao_id', politicaVersaoId)
    .eq('familia_documental', 'cte')

  if (relacionadasError) throw new Error(`Erro ao carregar as NFs do CT-e compartilhado: ${relacionadasError.message}`)
  const idsExpandidos = Array.from(new Set([
    ...idsSelecionados,
    ...(evidenciasRelacionadas || []).map((item) => String(item.nota_fiscal_id)).filter(Boolean),
  ]))
  return idsExpandidos.length === idsSelecionados.length
    ? nfs
    : carregarNfsAutorizadas(idsExpandidos, client)
}

export async function uploadDocumentoLogisticoAntecipado(
  input: UploadLogisticoAntecipadoInput,
  client: AppSupabaseClient,
) {
  let nfs = await carregarNfsAutorizadas(input.notaFiscalIds, client)
  const { data: requisito, error: requisitoError } = await client
    .from('politica_requisitos_documentais')
    .select('id, politica_operacional_versao_id, tipo_documento_codigo, escopo, ativo')
    .eq('id', input.politicaRequisitoId)
    .maybeSingle()

  if (requisitoError) throw new Error(`Erro ao validar o requisito logistico: ${requisitoError.message}`)
  const familia = resolverFamiliaDocumentalLogistica(requisito?.tipo_documento_codigo)
  if (!requisito || !requisito.ativo || !['pos_cessao', 'entrega'].includes(String(requisito.escopo)) || !familia) {
    throw new Error('Requisito logistico oficial nao encontrado para envio antecipado.')
  }
  if (familia === 'cte') {
    nfs = await expandirNfsDoCteCompartilhado(nfs, String(requisito.politica_operacional_versao_id), client)
  }

  const tipo = await resolverTipoDocumento(familia, input.arquivo, client)
  let dadosLogisticos: Record<string, unknown> = {}
  let mensagem: string | undefined

  if (familia === 'cte' && tipo.codigo === 'cte_xml') {
    const parsed = await parseCteXml(input.arquivo)
    if (!parsed.valido) throw new Error(parsed.erros.join(' '))
    const resultado = validarCteContraNfes({ cte: parsed, nfs })
    if (resultado.status === 'rejeitado') throw new Error(mensagemValidacaoCte(resultado))
    dadosLogisticos = {
      ...parsed,
      resultado_validacao: resultado,
    }
    mensagem = mensagemValidacaoCte(resultado)
  }

  const hash = await sha256Arquivo(input.arquivo)
  const mimeType = mimeArquivo(input.arquivo)
  const path = gerarCaminhoDocumentoLogistico({
    cedenteId: nfs[0].cedente_id,
    contextoTipo: 'antecipado',
    contextoId: nfs[0].id,
    tipoCodigo: tipo.codigo,
    nomeOriginal: input.arquivo.name,
  })

  let uploaded = false
  try {
    await enviarObjetoDocumento(path, input.arquivo, mimeType)
    uploaded = true
    const { data, error } = await client.rpc('registrar_documento_logistico_antecipado', {
      p_nota_fiscal_ids: nfs.map((nf) => nf.id),
      p_politica_requisito_id: input.politicaRequisitoId,
      p_documento_tipo_codigo: tipo.codigo,
      p_nome_original: nomeSeguro(input.arquivo.name),
      p_mime_type: mimeType,
      p_tamanho_bytes: input.arquivo.size,
      p_sha256: hash,
      p_bucket: DOCUMENTO_V2_BUCKET,
      p_path: path,
      p_dados_logisticos: dadosLogisticos,
    })
    if (error) throw new Error(`Erro ao registrar documento logistico antecipado: ${error.message}`)

    const result = data as Record<string, unknown>
    if (result.arquivo_utilizado === false) {
      await removerObjetoDocumento(path)
      uploaded = false
    }
    await registrarLog({
      tipo_evento: 'DOCUMENTO_LOGISTICO_ANTECIPADO_ENVIADO',
      entidade_tipo: 'documento_versoes',
      entidade_id: String(result.versao_id),
      dados_depois: {
        nota_fiscal_ids: nfs.map((nf) => nf.id),
        familia_documental: familia,
        politica_requisito_id: input.politicaRequisitoId,
        idempotent_replay: result.idempotent_replay === true,
      },
    }).catch(() => {})
    return {
      ...result,
      nome: input.arquivo.name,
      message: mensagem || 'Documento logistico enviado antecipadamente para analise.',
    }
  } catch (error) {
    if (uploaded) await removerObjetoDocumento(path)
    throw error
  }
}
