'use server'

import { createHash } from 'node:crypto'
import { requireNotaFiscalAccess } from '@/lib/auth/authorization'
import { obterPoliticaAplicavelAoCedenteFundo } from '@/lib/operacoes/politica'
import { extrairDuplicataDePdf } from '@/lib/duplicatas/pdf.server'
import { possuiAssinaturaPdf } from '@/lib/duplicatas/arquivo'
import { agregarDuplicatasDaNota, confrontarDuplicataComNotaFiscal } from '@/lib/duplicatas/validacao'
import type {
  CamposDuplicata,
  DuplicataCorrecaoRegistro,
  DuplicataRegistro,
  DuplicataValidacaoRegistro,
  DuplicataVersaoRegistro,
  NotaFiscalParaConfronto,
  ResultadoValidacaoDuplicata,
  StatusDuplicata,
} from '@/lib/duplicatas/types'
import {
  enviarObjetoDocumento,
  gerarCaminhoDuplicata,
  gerarUrlDocumento,
  removerObjetoDocumento,
} from '@/lib/documentos-v2/storage'
import { DOCUMENTO_V2_BUCKET, nomeSeguro } from '@/lib/documentos-v2/tipos'

const MAX_PDF_BYTES = 20 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ActionResult<T = undefined> = { success: boolean; message: string; data?: T; details?: string }

export type DuplicataComVersoes = DuplicataRegistro & {
  versoes: DuplicataVersaoRegistro[]
  correcoes: DuplicataCorrecaoRegistro[]
  validacoes: DuplicataValidacaoRegistro[]
  validacao: ResultadoValidacaoDuplicata
}

export type DuplicatasDaNotaResult = {
  habilitado: boolean
  tipoAtivoFinanceiro: 'NOTA_FISCAL' | 'DUPLICATA_MERCANTIL'
  politicaVersaoId: string | null
  nota: NotaFiscalParaConfronto
  duplicatas: DuplicataComVersoes[]
  agregado: ReturnType<typeof agregarDuplicatasDaNota>
}

async function carregarContexto(notaFiscalId: string) {
  if (!UUID.test(notaFiscalId)) throw new Error('Nota fiscal invalida.')
  const context = await requireNotaFiscalAccess(notaFiscalId)
  if (!['cedente', 'gestor', 'consultor'].includes(context.profile.role)) {
    throw new Error('Perfil sem acesso ao cadastro de duplicatas.')
  }
  const { data, error } = await context.supabase
    .from('notas_fiscais')
    .select('id, fundo_id, cedente_fundo_id, cedente_id, numero_nf, data_emissao, data_vencimento, cnpj_emitente, cnpj_destinatario, razao_social_emitente, razao_social_destinatario, valor_bruto, status')
    .eq('id', notaFiscalId)
    .maybeSingle()
  if (error) throw new Error(`Nao foi possivel consultar a nota fiscal: ${error.message}`)
  if (!data?.fundo_id || !data.cedente_fundo_id) throw new Error('Nota fiscal sem contexto de fundo e vinculo.')

  const fundoId = data.fundo_id
  const cedenteFundoId = data.cedente_fundo_id
  const nota = data as NotaFiscalParaConfronto & { status: string }
  const politica = await obterPoliticaAplicavelAoCedenteFundo({
    cedenteId: nota.cedente_id,
    cedenteFundoId,
    fundoId,
  }, context.supabase)
  return { context, nota, politica }
}

function camposDoRegistro(row: DuplicataRegistro): CamposDuplicata {
  return {
    numero: row.numero,
    numero_fatura: row.numero_fatura,
    parcela: row.parcela,
    data_emissao: row.data_emissao,
    data_vencimento: row.data_vencimento,
    valor_nominal: row.valor_nominal === null ? null : Number(row.valor_nominal),
    nome_cedente_documento: row.nome_cedente_documento,
    cnpj_cedente_documento: row.cnpj_cedente_documento,
    nome_sacado_documento: row.nome_sacado_documento,
    cnpj_sacado_documento: row.cnpj_sacado_documento,
    local_pagamento: row.local_pagamento,
    aceite_textual: row.aceite_textual,
    aceite_detectado_textualmente: row.aceite_detectado_textualmente,
  }
}

export async function listarDuplicatasDaNota(notaFiscalId: string): Promise<ActionResult<DuplicatasDaNotaResult>> {
  try {
    const { context, nota, politica } = await carregarContexto(notaFiscalId)
    const tipoAtivo = politica.versao.tipo_ativo_financeiro || 'NOTA_FISCAL'
    if (tipoAtivo !== 'DUPLICATA_MERCANTIL') {
      return {
        success: true,
        message: 'Fluxo de Nota Fiscal preservado.',
        data: {
          habilitado: false,
          tipoAtivoFinanceiro: 'NOTA_FISCAL',
          politicaVersaoId: politica.versao.id,
          nota,
          duplicatas: [],
          agregado: agregarDuplicatasDaNota([], Number(nota.valor_bruto)),
        },
      }
    }

    const { data: rows, error } = await context.supabase
      .from('duplicatas')
      .select('*')
      .eq('nota_fiscal_id', notaFiscalId)
      .order('created_at', { ascending: true })
    if (error) throw new Error(`Nao foi possivel consultar as duplicatas: ${error.message}`)
    const duplicatas = (rows || []) as unknown as DuplicataRegistro[]
    const ids = duplicatas.map((row) => row.id)
    const versoesPorDuplicata = new Map<string, DuplicataVersaoRegistro[]>()
    const correcoesPorDuplicata = new Map<string, DuplicataCorrecaoRegistro[]>()
    const validacoesPorDuplicata = new Map<string, DuplicataValidacaoRegistro[]>()
    if (ids.length > 0) {
      const [versionResult, correctionResult, validationResult] = await Promise.all([
        context.supabase.from('duplicata_versoes').select('*').in('duplicata_id', ids).order('numero_versao', { ascending: false }),
        context.supabase.from('duplicata_correcoes').select('*').in('duplicata_id', ids).order('corrigido_em', { ascending: false }),
        context.supabase.from('duplicata_validacoes').select('*').in('duplicata_id', ids).order('validado_em', { ascending: false }),
      ])
      if (versionResult.error) throw new Error(`Nao foi possivel consultar as versoes das duplicatas: ${versionResult.error.message}`)
      if (correctionResult.error) throw new Error(`Nao foi possivel consultar as correcoes das duplicatas: ${correctionResult.error.message}`)
      if (validationResult.error) throw new Error(`Nao foi possivel consultar as validacoes das duplicatas: ${validationResult.error.message}`)
      const versionRows = versionResult.data
      for (const version of (versionRows || []) as unknown as DuplicataVersaoRegistro[]) {
        versoesPorDuplicata.set(version.duplicata_id, [...(versoesPorDuplicata.get(version.duplicata_id) || []), version])
      }
      for (const correction of (correctionResult.data || []) as unknown as DuplicataCorrecaoRegistro[]) {
        correcoesPorDuplicata.set(correction.duplicata_id, [...(correcoesPorDuplicata.get(correction.duplicata_id) || []), correction])
      }
      for (const validation of (validationResult.data || []) as unknown as DuplicataValidacaoRegistro[]) {
        validacoesPorDuplicata.set(validation.duplicata_id, [...(validacoesPorDuplicata.get(validation.duplicata_id) || []), validation])
      }
    }

    const completas = duplicatas.map((row) => ({
      ...row,
      valor_nominal: row.valor_nominal === null ? null : Number(row.valor_nominal),
      versoes: versoesPorDuplicata.get(row.id) || [],
      correcoes: correcoesPorDuplicata.get(row.id) || [],
      validacoes: validacoesPorDuplicata.get(row.id) || [],
      validacao: confrontarDuplicataComNotaFiscal(camposDoRegistro(row), nota),
    }))
    return {
      success: true,
      message: 'Duplicatas carregadas.',
      data: {
        habilitado: true,
        tipoAtivoFinanceiro: 'DUPLICATA_MERCANTIL',
        politicaVersaoId: politica.versao.id,
        nota,
        duplicatas: completas,
        agregado: agregarDuplicatasDaNota(completas, Number(nota.valor_bruto)),
      },
    }
  } catch (error) {
    return { success: false, message: 'Nao foi possivel carregar as duplicatas desta NF.', details: error instanceof Error ? error.message : 'Erro inesperado.' }
  }
}

export async function enviarDuplicataPdf(notaFiscalId: string, formData: FormData): Promise<ActionResult> {
  let uploadedPath: string | null = null
  try {
    const { context, nota, politica } = await carregarContexto(notaFiscalId)
    if (context.profile.role !== 'cedente') throw new Error('Apenas o cedente pode enviar a duplicata.')
    if (politica.versao.tipo_ativo_financeiro !== 'DUPLICATA_MERCANTIL') throw new Error('A politica vigente nao utiliza Duplicata Mercantil.')
    if (!['rascunho', 'requer_ajuste'].includes(nota.status)) throw new Error('O envio deve ocorrer antes da submissao definitiva da NF.')

    const file = formData.get('arquivo')
    const duplicataIdValue = formData.get('duplicataId')
    const duplicataId = typeof duplicataIdValue === 'string' && UUID.test(duplicataIdValue) ? duplicataIdValue : null
    if (!(file instanceof File) || file.size <= 0) throw new Error('Selecione um arquivo PDF.')
    if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) throw new Error('A duplicata deve ser enviada em PDF.')
    if (file.size > MAX_PDF_BYTES) throw new Error('O PDF excede o limite de 20 MB.')

    const buffer = Buffer.from(await file.arrayBuffer())
    if (!possuiAssinaturaPdf(buffer)) throw new Error('O arquivo selecionado nao possui uma estrutura PDF valida.')
    const extraction = await extrairDuplicataDePdf(buffer)
    const validation = confrontarDuplicataComNotaFiscal(extraction.campos, nota)
    const status: StatusDuplicata = extraction.metodo === 'MANUAL' || validation.resultado !== 'COERENTE' ? 'REVISAR' : 'EXTRAIDA'
    const safeName = nomeSeguro(file.name)
    uploadedPath = gerarCaminhoDuplicata({ cedenteId: nota.cedente_id, notaFiscalId, nomeOriginal: safeName })
    await enviarObjetoDocumento(uploadedPath, file, 'application/pdf')

    const { data, error } = await context.supabase.rpc('registrar_duplicata_versao', {
      p_nota_fiscal_id: notaFiscalId,
      p_duplicata_id: duplicataId,
      p_numero: extraction.campos.numero,
      p_numero_fatura: extraction.campos.numero_fatura,
      p_parcela: extraction.campos.parcela,
      p_data_emissao: extraction.campos.data_emissao,
      p_data_vencimento: extraction.campos.data_vencimento,
      p_valor_nominal: extraction.campos.valor_nominal,
      p_nome_cedente: extraction.campos.nome_cedente_documento,
      p_cnpj_cedente: extraction.campos.cnpj_cedente_documento,
      p_nome_sacado: extraction.campos.nome_sacado_documento,
      p_cnpj_sacado: extraction.campos.cnpj_sacado_documento,
      p_local_pagamento: extraction.campos.local_pagamento,
      p_aceite_textual: extraction.campos.aceite_textual,
      p_aceite_detectado: extraction.campos.aceite_detectado_textualmente,
      p_status: status,
      p_metodo_extracao: extraction.metodo,
      p_resultado_confronto: validation.resultado,
      p_bucket: DOCUMENTO_V2_BUCKET,
      p_path: uploadedPath,
      p_nome_original: safeName,
      p_mime_type: 'application/pdf',
      p_tamanho_bytes: file.size,
      p_sha256: createHash('sha256').update(buffer).digest('hex'),
      p_texto_extraido: extraction.textoExtraido,
      p_campos_extraidos: extraction.campos as unknown as Record<string, unknown>,
      p_evidencias: extraction.evidencias as unknown as Record<string, unknown>,
      p_resultado_validacao: validation as unknown as Record<string, unknown>,
      p_confianca: extraction.confiancaGeral,
    })
    if (error || !data) throw new Error(error?.message || 'A versao da duplicata nao foi registrada.')
    uploadedPath = null
    return { success: true, message: status === 'REVISAR' ? 'PDF recebido. Revise os campos extraidos antes de submeter a NF.' : 'Duplicata extraida e pronta para conferencia.' }
  } catch (error) {
    let compensationDetails = ''
    if (uploadedPath) {
      try {
        await removerObjetoDocumento(uploadedPath)
      } catch (compensationError) {
        compensationDetails = compensationError instanceof Error
          ? ` Falha adicional na compensacao do Storage: ${compensationError.message}`
          : ' Falha adicional na compensacao do Storage.'
      }
    }
    const details = error instanceof Error ? error.message : 'Erro inesperado.'
    return { success: false, message: 'Nao foi possivel registrar a duplicata.', details: `${details}${compensationDetails}` }
  }
}

export async function corrigirCamposDuplicata(
  notaFiscalId: string,
  duplicataId: string,
  campos: CamposDuplicata,
  motivo: string,
): Promise<ActionResult> {
  try {
    const { context, nota } = await carregarContexto(notaFiscalId)
    if (!['cedente', 'gestor'].includes(context.profile.role)) throw new Error('Perfil sem permissao para corrigir os campos da duplicata.')
    if (!UUID.test(duplicataId)) throw new Error('Duplicata invalida.')
    const validation = confrontarDuplicataComNotaFiscal(campos, nota)
    const { error } = await context.supabase.rpc('corrigir_duplicata', {
      p_duplicata_id: duplicataId,
      p_campos: campos as unknown as Record<string, unknown>,
      p_motivo: motivo,
      p_resultado_confronto: validation.resultado,
    })
    if (error) throw new Error(error.message)
    return { success: true, message: 'Campos corrigidos e trilha de revisao registrada.' }
  } catch (error) {
    return { success: false, message: 'Nao foi possivel salvar a revisao da duplicata.', details: error instanceof Error ? error.message : 'Erro inesperado.' }
  }
}

export async function concluirValidacaoDuplicata(
  notaFiscalId: string,
  duplicataId: string,
  resultado: 'VALIDADA' | 'REJEITADA',
  observacoes?: string,
): Promise<ActionResult> {
  try {
    const { context, nota } = await carregarContexto(notaFiscalId)
    if (context.profile.role !== 'gestor') throw new Error('Apenas o gestor pode concluir a validacao.')
    const { data: row, error: rowError } = await context.supabase.from('duplicatas').select('*').eq('id', duplicataId).eq('nota_fiscal_id', notaFiscalId).maybeSingle()
    if (rowError || !row) throw new Error(rowError?.message || 'Duplicata nao encontrada.')
    const validation = confrontarDuplicataComNotaFiscal(camposDoRegistro(row as unknown as DuplicataRegistro), nota)
    if (resultado === 'VALIDADA' && validation.bloqueios.length > 0) throw new Error('Corrija os bloqueios de confronto antes da validacao final.')
    const { error } = await context.supabase.rpc('validar_duplicata', {
      p_duplicata_id: duplicataId,
      p_resultado: resultado,
      p_observacoes: observacoes?.trim() || null,
      p_resultado_confronto: validation as unknown as Record<string, unknown>,
    })
    if (error) throw new Error(error.message)
    return { success: true, message: resultado === 'VALIDADA' ? 'Duplicata validada.' : 'Duplicata rejeitada.' }
  } catch (error) {
    return { success: false, message: 'Nao foi possivel concluir a validacao.', details: error instanceof Error ? error.message : 'Erro inesperado.' }
  }
}

export async function obterUrlDuplicata(notaFiscalId: string, versaoId: string): Promise<ActionResult<{ url: string }>> {
  try {
    const { context } = await carregarContexto(notaFiscalId)
    if (!UUID.test(versaoId)) throw new Error('Versao invalida.')
    const { data, error } = await context.supabase
      .from('duplicata_versoes')
      .select('id, path, nota_fiscal_id')
      .eq('id', versaoId)
      .eq('nota_fiscal_id', notaFiscalId)
      .maybeSingle()
    if (error || !data) throw new Error(error?.message || 'Versao nao encontrada.')
    return { success: true, message: 'Acesso temporario gerado.', data: { url: await gerarUrlDocumento(data.path) } }
  } catch (error) {
    return { success: false, message: 'Nao foi possivel abrir a duplicata.', details: error instanceof Error ? error.message : 'Erro inesperado.' }
  }
}
