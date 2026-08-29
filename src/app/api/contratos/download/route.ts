import { NextRequest, NextResponse } from 'next/server'
import { requireCedenteAccess, requireOperationAccess, AuthorizationError } from '@/lib/auth/authorization'
import { createAdminClient } from '@/lib/supabase/server'
import { buckets } from '@/lib/storage'
import type { ContratoDocumentType, ContratoEntityType } from '@/lib/types/domain'

const CEDENTE_DOCUMENT_FIELDS: Partial<Record<ContratoDocumentType, 'contrato_url' | 'contrato_assinado_url'>> = {
  contrato: 'contrato_url',
  contrato_assinado: 'contrato_assinado_url',
}

const OPERACAO_DOCUMENT_FIELDS: Partial<Record<ContratoDocumentType, 'termo_url' | 'termo_assinado_url' | 'notificacao_url' | 'notificacao_assinada_url' | 'comprovante_pagamento_url' | 'remessa_url' | 'quitacao_url' | 'quitacao_assinada_url'>> = {
  termo: 'termo_url',
  termo_assinado: 'termo_assinado_url',
  notificacao: 'notificacao_url',
  notificacao_assinada: 'notificacao_assinada_url',
  comprovante_pagamento: 'comprovante_pagamento_url',
  remessa: 'remessa_url',
  quitacao: 'quitacao_url',
  quitacao_assinada: 'quitacao_assinada_url',
}

function isEntityType(value: string | null): value is ContratoEntityType {
  return value === 'cedente' || value === 'operacao'
}

function isDocumentType(value: string | null): value is ContratoDocumentType {
  return value !== null && (
    value === 'contrato' ||
    value === 'contrato_assinado' ||
    value === 'termo' ||
    value === 'termo_assinado' ||
    value === 'notificacao' ||
    value === 'notificacao_assinada' ||
    value === 'comprovante_pagamento' ||
    value === 'remessa' ||
    value === 'quitacao' ||
    value === 'quitacao_assinada'
  )
}

// Gera signed URL apenas para o path privado registrado na entidade.
// GET /api/contratos/download?tipo_entidade=cedente&entidade_id=...&tipo_documento=contrato
export async function GET(req: NextRequest) {
  try {
    const tipoEntidade = req.nextUrl.searchParams.get('tipo_entidade')
    const entidadeId = req.nextUrl.searchParams.get('entidade_id')
    const tipoDocumento = req.nextUrl.searchParams.get('tipo_documento')

    if (!isEntityType(tipoEntidade) || !entidadeId || !isDocumentType(tipoDocumento)) {
      return NextResponse.json(
        { error: 'tipo_entidade, entidade_id e tipo_documento sao obrigatorios.' },
        { status: 400 },
      )
    }

    let filePath: string | null = null
    let bucket: string = buckets.contratos

    if (tipoEntidade === 'cedente') {
      const field = CEDENTE_DOCUMENT_FIELDS[tipoDocumento]
      if (!field) return NextResponse.json({ error: 'Documento nao pertence a um cedente.' }, { status: 400 })

      const context = await requireCedenteAccess(entidadeId)
      filePath = context.cedente[field]
    } else {
      const field = OPERACAO_DOCUMENT_FIELDS[tipoDocumento]
      if (!field) return NextResponse.json({ error: 'Documento nao pertence a uma operacao.' }, { status: 400 })

      const context = await requireOperationAccess(entidadeId)
      if (tipoDocumento === 'remessa') {
        const { data: remessa } = await context.supabase
          .from('remessas_cnab_operacoes')
          .select('remessa:remessas_cnab(bucket, storage_path)')
          .eq('operacao_id', entidadeId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const remessaData = remessa as unknown as { remessa: { bucket: string; storage_path: string } | null } | null
        if (remessaData?.remessa) {
          bucket = remessaData.remessa.bucket
          filePath = remessaData.remessa.storage_path
        }
      }

      if (!filePath) {
        const { data: operacao, error } = await context.supabase
          .from('operacoes')
          .select('termo_url, termo_assinado_url, notificacao_url, notificacao_assinada_url, comprovante_pagamento_url, remessa_url, quitacao_url, quitacao_assinada_url')
          .eq('id', entidadeId)
          .single()

        if (error || !operacao) {
          return NextResponse.json({ error: 'Operacao nao encontrada.' }, { status: 404 })
        }

        filePath = (operacao as Record<string, string | null>)[field] ?? null
      }
    }

    if (!filePath) {
      return NextResponse.json({ error: 'Documento nao encontrado ou nao registrado.' }, { status: 404 })
    }

    const supabaseAdmin = createAdminClient()

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(filePath, 3600)

    if (error) {
      return NextResponse.json({ error: `Erro ao gerar URL: ${error.message}` }, { status: 500 })
    }

    return NextResponse.json({ url: data.signedUrl })
  } catch (error: unknown) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    console.error('[api/contratos/download]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
