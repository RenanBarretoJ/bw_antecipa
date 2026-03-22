'use server'

import { createClient } from '@/lib/supabase/server'
import { notaFiscalSchema, type NotaFiscalFormData } from '@/lib/validations/nf'
import { parseNFeXML } from '@/lib/nf-parser'
import { registrarLog } from './auditoria'
import { notificarGestores, criarNotificacao } from './notificacao'

export type NfActionState = {
  success?: boolean
  errors?: Record<string, string[]>
  message?: string
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
    .eq('user_id', user.id)
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
          .from('notas-fiscais')
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
        // PDF ou imagem — cria como rascunho para preenchimento manual
        const cnpjLimpo = cedente.cnpj.replace(/\D/g, '')
        const timestamp = Date.now()
        const cleanName = arquivo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const filePath = `${cnpjLimpo}/nf/${timestamp}_${cleanName}`

        const { error: uploadError } = await supabase.storage
          .from('notas-fiscais')
          .upload(filePath, arquivo)

        if (uploadError) {
          erros.push(`${arquivo.name}: erro no upload - ${uploadError.message}`)
          continue
        }

        // Criar rascunho — cedente precisa preencher dados manualmente
        const { data: nf, error: dbError } = await supabase
          .from('notas_fiscais')
          .insert({
            cedente_id: cedente.id,
            numero_nf: '',
            data_emissao: new Date().toISOString().split('T')[0],
            data_vencimento: new Date().toISOString().split('T')[0],
            cnpj_emitente: cnpjLimpo,
            razao_social_emitente: cedente.razao_social,
            cnpj_destinatario: '',
            razao_social_destinatario: '',
            valor_bruto: 0,
            valor_liquido: 0,
            valor_icms: 0,
            valor_iss: 0,
            valor_pis: 0,
            valor_cofins: 0,
            valor_ipi: 0,
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
  }
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
    .update({ status: 'aprovada' } as never)
    .eq('id', nfId)

  if (error) {
    return { success: false, message: `Erro ao aprovar: ${error.message}` }
  }

  // Buscar user_id do cedente para notificar
  const { data: cedenteInfo } = await supabase
    .from('cedentes')
    .select('user_id, razao_social')
    .eq('id', nfData.cedente_id)
    .single()

  if (cedenteInfo) {
    const cedenteUser = cedenteInfo as { user_id: string; razao_social: string }
    await criarNotificacao({
      usuario_id: cedenteUser.user_id,
      titulo: 'NF aprovada',
      mensagem: `Sua NF ${nfData.numero_nf} foi aprovada e esta disponivel para antecipacao.`,
      tipo: 'nf_aprovada',
    })
  }

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

  const { data: cedenteInfo } = await supabase
    .from('cedentes')
    .select('user_id')
    .eq('id', nfData.cedente_id)
    .single()

  if (cedenteInfo) {
    const cedenteUser = cedenteInfo as { user_id: string }
    await criarNotificacao({
      usuario_id: cedenteUser.user_id,
      titulo: 'NF reprovada',
      mensagem: `Sua NF ${nfData.numero_nf} foi reprovada. Motivo: ${motivo}`,
      tipo: 'nf_reprovada',
    })
  }

  await registrarLog({
    tipo_evento: 'NF_REPROVADA',
    entidade_tipo: 'notas_fiscais',
    entidade_id: nfId,
    dados_antes: { status: nfData.status },
    dados_depois: { status: 'cancelada', motivo },
  })

  return { success: true, message: 'NF reprovada.' }
}
