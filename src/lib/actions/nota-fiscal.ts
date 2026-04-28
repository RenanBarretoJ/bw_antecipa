'use server'

import { createClient } from '@/lib/supabase/server'
import { notaFiscalSchema, type NotaFiscalFormData } from '@/lib/validations/nf'
import { parseNFeXML } from '@/lib/nf-parser'
import { extractDanfeFromPdf, type NfPdfExtracted } from '@/lib/pdf-nf-parser'
import { registrarLog } from './auditoria'
import { notificarGestores, notificarCedente } from './notificacao'
import { buckets } from '@/lib/storage'

export type NfActionState = {
  success?: boolean
  errors?: Record<string, string[]>
  message?: string
  ids?: string[]
  rascunhos?: string[]
  data?: {
    id: string
    parsed?: Record<string, unknown>
  }
} | undefined

async function getCedenteDoUsuario() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: cedente } = await supabase
    .from('cedentes')
    .select('id, cnpj, razao_social, status')
    .single()

  if (!cedente) return null
  return cedente as { id: string; cnpj: string; razao_social: string; status: string }
}

// Upload multiplo de arquivos de NF (XML ou PDF)
// Retorna IDs das NFs criadas como rascunho
export async function uploadNFs(formData: FormData): Promise<NfActionState> {
  const supabase = await createClient()
  const cedente = await getCedenteDoUsuario()

  if (!cedente) {
    return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  }

  if (cedente.status !== 'ativo') {
    return { success: false, message: 'Seu cadastro precisa estar ativo para enviar NFs.' }
  }

  const arquivos = formData.getAll('arquivos') as File[]

  if (!arquivos || arquivos.length === 0) {
    return { success: false, message: 'Nenhum arquivo selecionado.' }
  }

  const allowedTypes = ['text/xml', 'application/xml', 'application/pdf', 'image/jpeg', 'image/png']
  const maxSize = 20 * 1024 * 1024

  const erros: string[] = []
  const nfsCriadas: string[] = []
  const nfsRascunho: string[] = []

  for (const arquivo of arquivos) {
    // Validar tipo e tamanho
    const isXml = arquivo.name.toLowerCase().endsWith('.xml') ||
      arquivo.type === 'text/xml' || arquivo.type === 'application/xml'
    const isPdf = arquivo.type === 'application/pdf'
    const isImage = arquivo.type === 'image/jpeg' || arquivo.type === 'image/png'

    if (!isXml && !isPdf && !isImage) {
      erros.push(`${arquivo.name}: formato invalido. Aceitos: XML, PDF, JPG, PNG.`)
      continue
    }

    if (arquivo.size > maxSize) {
      erros.push(`${arquivo.name}: arquivo muito grande (max 20MB).`)
      continue
    }

    try {
      if (isXml) {
        // Parse XML da NF-e
        const xmlContent = await arquivo.text()
        const parsed = parseNFeXML(xmlContent)

        // Validar CNPJ emitente = CNPJ do cedente
        const cnpjLimpo = cedente.cnpj.replace(/\D/g, '')
        if (parsed.cnpj_emitente !== cnpjLimpo) {
          erros.push(`${arquivo.name}: CNPJ emitente (${parsed.cnpj_emitente}) diferente do seu CNPJ (${cnpjLimpo}).`)
          continue
        }

        // Verificar duplicidade por chave de acesso
        if (parsed.chave_acesso) {
          const { data: existing } = await supabase
            .from('notas_fiscais')
            .select('id')
            .eq('chave_acesso', parsed.chave_acesso)
            .limit(1)

          if (existing && existing.length > 0) {
            erros.push(`${arquivo.name}: NF com chave de acesso ja cadastrada.`)
            continue
          }
        }

        // Upload do arquivo XML
        const timestamp = Date.now()
        const cleanName = arquivo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const filePath = `${cnpjLimpo}/nf/${timestamp}_${cleanName}`

        const { error: uploadError } = await supabase.storage
          .from(buckets.notasFiscais)
          .upload(filePath, arquivo)

        if (uploadError) {
          erros.push(`${arquivo.name}: erro no upload - ${uploadError.message}`)
          continue
        }

        // Inserir NF com dados parseados — status submetida (XML ja tem dados completos)
        const { data: nf, error: dbError } = await supabase
          .from('notas_fiscais')
          .insert({
            cedente_id: cedente.id,
            numero_nf: parsed.numero_nf,
            serie: parsed.serie || null,
            chave_acesso: parsed.chave_acesso || null,
            data_emissao: parsed.data_emissao,
            data_vencimento: parsed.data_vencimento || parsed.data_emissao,
            cnpj_emitente: parsed.cnpj_emitente,
            razao_social_emitente: parsed.razao_social_emitente,
            cnpj_destinatario: parsed.cnpj_destinatario,
            razao_social_destinatario: parsed.razao_social_destinatario,
            valor_bruto: parsed.valor_bruto,
            valor_liquido: parsed.valor_liquido,
            valor_icms: parsed.valor_icms,
            valor_iss: parsed.valor_iss,
            valor_pis: parsed.valor_pis,
            valor_cofins: parsed.valor_cofins,
            valor_ipi: parsed.valor_ipi,
            descricao_itens: parsed.descricao_itens || null,
            condicao_pagamento: parsed.condicao_pagamento || null,
            arquivo_url: filePath,
            status: 'submetida',
          } as never)
          .select('id')
          .single()

        if (dbError) {
          erros.push(`${arquivo.name}: erro ao salvar - ${dbError.message}`)
          continue
        }

        const nfData = nf as { id: string }
        nfsCriadas.push(nfData.id)

        await registrarLog({
          tipo_evento: 'NF_CADASTRADA',
          entidade_tipo: 'notas_fiscais',
          entidade_id: nfData.id,
          dados_depois: parsed as unknown as Record<string, unknown>,
        })

      } else {
        // PDF ou imagem — tenta extrair dados automaticamente, cria rascunho
        const cnpjLimpo = cedente.cnpj.replace(/\D/g, '')
        const timestamp = Date.now()
        const cleanName = arquivo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const filePath = `${cnpjLimpo}/nf/${timestamp}_${cleanName}`

        const { error: uploadError } = await supabase.storage
          .from(buckets.notasFiscais)
          .upload(filePath, arquivo)

        if (uploadError) {
          erros.push(`${arquivo.name}: erro no upload - ${uploadError.message}`)
          continue
        }

        // Tentar extração de dados do DANFE (falha silenciosa para PDFs escaneados)
        const today = new Date().toISOString().split('T')[0]
        let extracted: NfPdfExtracted = { campos_extraidos: [] }
        console.log('[uploadNFs] arquivo:', arquivo.name, '| isPdf:', isPdf, '| isImage:', isImage, '| type:', arquivo.type)
        if (isPdf) {
          try {
            console.log('[uploadNFs] iniciando extracao do PDF...')
            const buffer = Buffer.from(await arquivo.arrayBuffer())
            console.log('[uploadNFs] buffer size:', buffer.length)
            extracted = await extractDanfeFromPdf(buffer)
            console.log('[uploadNFs] extracao concluida:', extracted.campos_extraidos)
          } catch (parseErr) {
            console.warn('[uploadNFs] extracao pdf falhou:', parseErr)
          }
        }

        const { data: nf, error: dbError } = await supabase
          .from('notas_fiscais')
          .insert({
            cedente_id: cedente.id,
            numero_nf: extracted.numero_nf ?? '',
            serie: extracted.serie ?? null,
            chave_acesso: extracted.chave_acesso ?? null,
            data_emissao: extracted.data_emissao ?? today,
            data_vencimento: extracted.data_vencimento ?? today,
            // emitente sempre vem do cadastro — não confiar no PDF
            cnpj_emitente: cnpjLimpo,
            razao_social_emitente: cedente.razao_social,
            cnpj_destinatario: extracted.cnpj_destinatario ?? '',
            razao_social_destinatario: extracted.razao_social_destinatario ?? '',
            valor_bruto: extracted.valor_bruto ?? 0,
            valor_liquido: extracted.valor_liquido ?? 0,
            valor_icms: 0,
            valor_iss: 0,
            valor_pis: 0,
            valor_cofins: 0,
            valor_ipi: 0,
            condicao_pagamento: extracted.condicao_pagamento ?? null,
            descricao_itens: extracted.descricao_itens ?? null,
            arquivo_url: filePath,
            status: 'rascunho',
          } as never)
          .select('id')
          .single()

        if (dbError) {
          erros.push(`${arquivo.name}: erro ao salvar - ${dbError.message}`)
          continue
        }

        const nfData = nf as { id: string }
        nfsCriadas.push(nfData.id)
        nfsRascunho.push(nfData.id)
      }
    } catch (e) {
      erros.push(`${arquivo.name}: erro inesperado ao processar.`)
      console.error('[uploadNFs]', e)
    }
  }

  // Notificar gestores se houver NFs submetidas
  const submetidas = nfsCriadas.length - erros.length
  if (nfsCriadas.length > 0) {
    await notificarGestores(
      'Novas NFs enviadas',
      `O cedente ${cedente.razao_social} enviou ${nfsCriadas.length} nota(s) fiscal(is) para analise.`,
      'nf_enviada'
    )
  }

  if (erros.length > 0 && nfsCriadas.length === 0) {
    return { success: false, message: erros.join('\n') }
  }

  const msg = nfsCriadas.length === 1
    ? '1 nota fiscal enviada com sucesso!'
    : `${nfsCriadas.length} notas fiscais enviadas com sucesso!`

  return {
    success: true,
    message: erros.length > 0
      ? `${msg} (${erros.length} erro(s): ${erros.join('; ')})`
      : msg,
    ids: nfsCriadas,
    rascunhos: nfsRascunho,
  }
}

// Criar NF a partir de PDF/imagem com dados preenchidos manualmente pelo cedente
export async function criarNFManual(formData: FormData): Promise<NfActionState> {
  const supabase = await createClient()
  const cedente = await getCedenteDoUsuario()

  if (!cedente) {
    return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  }

  if (cedente.status !== 'ativo') {
    return { success: false, message: 'Seu cadastro precisa estar ativo para enviar NFs.' }
  }

  const arquivo = formData.get('arquivo') as File | null
  if (!arquivo) {
    return { success: false, message: 'Arquivo nao encontrado.' }
  }

  const maxSize = 20 * 1024 * 1024
  if (arquivo.size > maxSize) {
    return { success: false, message: `${arquivo.name}: arquivo muito grande (max 20MB).` }
  }

  const numero_nf = (formData.get('numero_nf') as string || '').trim()
  const data_emissao = formData.get('data_emissao') as string
  const data_vencimento = formData.get('data_vencimento') as string
  const cnpj_destinatario = (formData.get('cnpj_destinatario') as string || '').replace(/\D/g, '')
  const razao_social_destinatario = (formData.get('razao_social_destinatario') as string || '').trim()
  const valor_bruto = parseFloat(formData.get('valor_bruto') as string) || 0
  const descricao_itens = (formData.get('descricao_itens') as string || '').trim()
  const condicao_pagamento = (formData.get('condicao_pagamento') as string || '').trim()

  if (!numero_nf) return { success: false, message: 'Numero da NF e obrigatorio.' }
  if (!data_emissao) return { success: false, message: 'Data de emissao e obrigatoria.' }
  if (!data_vencimento) return { success: false, message: 'Data de vencimento e obrigatoria.' }
  if (!cnpj_destinatario || cnpj_destinatario.length < 14) return { success: false, message: 'CNPJ do destinatario invalido.' }
  if (!razao_social_destinatario) return { success: false, message: 'Razao social do destinatario e obrigatoria.' }
  if (valor_bruto <= 0) return { success: false, message: 'Valor bruto deve ser maior que zero.' }

  const cnpjLimpo = cedente.cnpj.replace(/\D/g, '')
  const timestamp = Date.now()
  const cleanName = arquivo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const filePath = `${cnpjLimpo}/nf/${timestamp}_${cleanName}`

  const { error: uploadError } = await supabase.storage
    .from(buckets.notasFiscais)
    .upload(filePath, arquivo)

  if (uploadError) {
    return { success: false, message: `Erro no upload: ${uploadError.message}` }
  }

  const { data: nf, error: dbError } = await supabase
    .from('notas_fiscais')
    .insert({
      cedente_id: cedente.id,
      numero_nf,
      serie: null,
      chave_acesso: null,
      data_emissao,
      data_vencimento,
      cnpj_emitente: cnpjLimpo,
      razao_social_emitente: cedente.razao_social,
      cnpj_destinatario,
      razao_social_destinatario,
      valor_bruto,
      valor_liquido: valor_bruto,
      valor_icms: 0,
      valor_iss: 0,
      valor_pis: 0,
      valor_cofins: 0,
      valor_ipi: 0,
      descricao_itens: descricao_itens || null,
      condicao_pagamento: condicao_pagamento || null,
      arquivo_url: filePath,
      status: 'submetida',
    } as never)
    .select('id')
    .single()

  if (dbError) {
    return { success: false, message: `Erro ao salvar: ${dbError.message}` }
  }

  const nfData = nf as { id: string }

  await registrarLog({
    tipo_evento: 'NF_CADASTRADA',
    entidade_tipo: 'notas_fiscais',
    entidade_id: nfData.id,
    dados_depois: { numero_nf, valor_bruto, cnpj_destinatario } as Record<string, unknown>,
  })

  await notificarGestores(
    'Nova NF enviada',
    `O cedente ${cedente.razao_social} enviou a NF ${numero_nf} para analise.`,
    'nf_enviada'
  )

  return { success: true, message: 'Nota fiscal enviada com sucesso!', ids: [nfData.id] }
}

// Salvar/atualizar dados de NF rascunho (preenchimento manual para PDF)
export async function salvarDadosNF(nfId: string, data: NotaFiscalFormData): Promise<NfActionState> {
  const supabase = await createClient()
  const cedente = await getCedenteDoUsuario()

  if (!cedente) {
    return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  }

  const validated = notaFiscalSchema.safeParse(data)

  if (!validated.success) {
    return {
      success: false,
      errors: validated.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  // Verificar CNPJ emitente
  const cnpjLimpo = cedente.cnpj.replace(/\D/g, '')
  const cnpjEmitenteLimpo = validated.data.cnpj_emitente.replace(/\D/g, '')
  if (cnpjEmitenteLimpo !== cnpjLimpo) {
    return { success: false, message: 'CNPJ emitente deve ser igual ao CNPJ do seu cadastro.' }
  }

  // Verificar duplicidade por chave de acesso
  if (validated.data.chave_acesso) {
    const { data: existing } = await supabase
      .from('notas_fiscais')
      .select('id')
      .eq('chave_acesso', validated.data.chave_acesso)
      .neq('id', nfId)
      .limit(1)

    if (existing && existing.length > 0) {
      return { success: false, message: 'Ja existe uma NF com esta chave de acesso.' }
    }
  }

  const { error } = await supabase
    .from('notas_fiscais')
    .update({
      numero_nf: validated.data.numero_nf,
      serie: validated.data.serie || null,
      chave_acesso: validated.data.chave_acesso || null,
      data_emissao: validated.data.data_emissao,
      data_vencimento: validated.data.data_vencimento,
      cnpj_emitente: cnpjEmitenteLimpo,
      razao_social_emitente: validated.data.razao_social_emitente,
      cnpj_destinatario: validated.data.cnpj_destinatario.replace(/\D/g, ''),
      razao_social_destinatario: validated.data.razao_social_destinatario,
      valor_bruto: validated.data.valor_bruto,
      valor_liquido: validated.data.valor_liquido,
      valor_icms: validated.data.valor_icms,
      valor_iss: validated.data.valor_iss,
      valor_pis: validated.data.valor_pis,
      valor_cofins: validated.data.valor_cofins,
      valor_ipi: validated.data.valor_ipi,
      descricao_itens: validated.data.descricao_itens || null,
      condicao_pagamento: validated.data.condicao_pagamento || null,
    } as never)
    .eq('id', nfId)
    .eq('cedente_id', cedente.id)

  if (error) {
    console.error('[salvarDadosNF]', error.message)
    return { success: false, message: `Erro ao salvar: ${error.message}` }
  }

  return { success: true, message: 'Dados da NF salvos com sucesso.' }
}

// Submeter NF rascunho para analise
export async function submeterNF(nfId: string): Promise<NfActionState> {
  const supabase = await createClient()
  const cedente = await getCedenteDoUsuario()

  if (!cedente) {
    return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  }

  // Buscar NF para validar se esta completa
  const { data: nf } = await supabase
    .from('notas_fiscais')
    .select('*')
    .eq('id', nfId)
    .eq('cedente_id', cedente.id)
    .eq('status', 'rascunho')
    .single()

  if (!nf) {
    return { success: false, message: 'NF nao encontrada ou nao esta em rascunho.' }
  }

  const nfData = nf as Record<string, unknown>

  // Validar campos obrigatorios
  if (!nfData.numero_nf || !nfData.cnpj_destinatario || !nfData.razao_social_destinatario || !(nfData.valor_bruto as number > 0)) {
    return { success: false, message: 'Preencha todos os campos obrigatorios antes de submeter.' }
  }

  const { error } = await supabase
    .from('notas_fiscais')
    .update({ status: 'submetida' } as never)
    .eq('id', nfId)
    .eq('cedente_id', cedente.id)

  if (error) {
    return { success: false, message: `Erro ao submeter: ${error.message}` }
  }

  await registrarLog({
    tipo_evento: 'NF_SUBMETIDA',
    entidade_tipo: 'notas_fiscais',
    entidade_id: nfId,
  })

  await notificarGestores(
    'NF submetida para analise',
    `O cedente ${cedente.razao_social} submeteu a NF ${nfData.numero_nf} para analise.`,
    'nf_submetida'
  )

  return { success: true, message: 'NF submetida para analise com sucesso!' }
}

// Cedente: excluir rascunho
export async function excluirRascunho(nfId: string): Promise<NfActionState> {
  const supabase = await createClient()
  const cedente = await getCedenteDoUsuario()

  if (!cedente) {
    return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  }

  const { data: nf } = await supabase
    .from('notas_fiscais')
    .select('id, arquivo_url')
    .eq('id', nfId)
    .eq('cedente_id', cedente.id)
    .eq('status', 'rascunho')
    .single()

  if (!nf) {
    return { success: false, message: 'Rascunho nao encontrado ou ja foi submetido.' }
  }

  const nfData = nf as { id: string; arquivo_url: string | null }

  // Remover arquivo do storage antes de excluir o registro
  if (nfData.arquivo_url) {
    await supabase.storage.from(buckets.notasFiscais).remove([nfData.arquivo_url])
  }

  const { error } = await supabase
    .from('notas_fiscais')
    .delete()
    .eq('id', nfId)
    .eq('cedente_id', cedente.id)

  if (error) {
    return { success: false, message: `Erro ao excluir: ${error.message}` }
  }

  return { success: true, message: 'Rascunho excluido.' }
}

// Cedente: excluir múltiplos rascunhos em lote
export async function excluirRascunhos(nfIds: string[]): Promise<NfActionState> {
  if (!nfIds.length) return { success: false, message: 'Nenhuma NF selecionada.' }

  const supabase = await createClient()
  const cedente = await getCedenteDoUsuario()

  if (!cedente) {
    return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  }

  const { data: nfs } = await supabase
    .from('notas_fiscais')
    .select('id, arquivo_url')
    .in('id', nfIds)
    .eq('cedente_id', cedente.id)
    .eq('status', 'rascunho')

  if (!nfs || nfs.length === 0) {
    return { success: false, message: 'Nenhum rascunho encontrado.' }
  }

  const nfsData = nfs as { id: string; arquivo_url: string | null }[]
  const arquivos = nfsData.map((n) => n.arquivo_url).filter(Boolean) as string[]
  if (arquivos.length > 0) {
    await supabase.storage.from(buckets.notasFiscais).remove(arquivos)
  }

  const idsConfirmados = nfsData.map((n) => n.id)
  const { error } = await supabase
    .from('notas_fiscais')
    .delete()
    .in('id', idsConfirmados)
    .eq('cedente_id', cedente.id)

  if (error) {
    return { success: false, message: `Erro ao excluir: ${error.message}` }
  }

  return { success: true, message: `${idsConfirmados.length} rascunho(s) excluido(s).` }
}

// Gestor: aprovar NF
export async function aprovarNF(nfId: string): Promise<NfActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  const { data: nfAntes } = await supabase
    .from('notas_fiscais')
    .select('status, numero_nf, cedente_id')
    .eq('id', nfId)
    .single()

  if (!nfAntes) {
    return { success: false, message: 'NF nao encontrada.' }
  }

  const nfData = nfAntes as { status: string; numero_nf: string; cedente_id: string }

  const { error } = await supabase
    .from('notas_fiscais')
    .update({ status: 'aprovada', aprovada_gestor_em: new Date().toISOString() } as never)
    .eq('id', nfId)

  if (error) {
    return { success: false, message: `Erro ao aprovar: ${error.message}` }
  }

  await notificarCedente(
    nfData.cedente_id,
    'NF aprovada',
    `Sua NF ${nfData.numero_nf} foi aprovada e esta disponivel para antecipacao.`,
    'nf_aprovada',
  )

  await registrarLog({
    tipo_evento: 'NF_APROVADA',
    entidade_tipo: 'notas_fiscais',
    entidade_id: nfId,
    dados_antes: { status: nfData.status },
    dados_depois: { status: 'aprovada' },
  })

  return { success: true, message: 'NF aprovada com sucesso!' }
}

// Gestor: reprovar NF
export async function reprovarNF(nfId: string, motivo: string): Promise<NfActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  if (!motivo || motivo.trim().length === 0) {
    return { success: false, message: 'Motivo da reprovacao e obrigatorio.' }
  }

  const { data: nfAntes } = await supabase
    .from('notas_fiscais')
    .select('status, numero_nf, cedente_id')
    .eq('id', nfId)
    .single()

  if (!nfAntes) {
    return { success: false, message: 'NF nao encontrada.' }
  }

  const nfData = nfAntes as { status: string; numero_nf: string; cedente_id: string }

  const { error } = await supabase
    .from('notas_fiscais')
    .update({ status: 'cancelada' } as never)
    .eq('id', nfId)

  if (error) {
    return { success: false, message: `Erro ao reprovar: ${error.message}` }
  }

  await notificarCedente(
    nfData.cedente_id,
    'NF reprovada',
    `Sua NF ${nfData.numero_nf} foi reprovada. Motivo: ${motivo}`,
    'nf_reprovada',
  )

  await registrarLog({
    tipo_evento: 'NF_REPROVADA',
    entidade_tipo: 'notas_fiscais',
    entidade_id: nfId,
    dados_antes: { status: nfData.status },
    dados_depois: { status: 'cancelada', motivo },
  })

  return { success: true, message: 'NF reprovada.' }
}
