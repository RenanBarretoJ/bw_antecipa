import 'server-only'

import { randomUUID } from 'node:crypto'
import { AuthorizationError, requireGestor } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import { createAdminClient } from '@/lib/supabase/server'
import { buckets } from '@/lib/storage'
import { DocumentoAssinadoOperacaoError, isUuid, validarPdfAssinado } from '@/lib/operacoes/documentos-assinados'
import { MAX_CONTRATO_ASSINADO_BYTES } from './contrato-assinado-config'

export async function autorizarContratoAssinadoCedente(cedenteId: string) {
  if (!isUuid(cedenteId)) throw new DocumentoAssinadoOperacaoError('Cedente inválido.', 400, 'INVALID_CEDENTE_ID')
  const auth = await requireGestor() // Inclui perfil ativo e sessao MFA canonica.
  await exigirSessaoElevada(auth)
  const fundo = await resolverContextoFundoGestor(auth)
  if (!['gestor', 'administrador', 'operador', 'plataforma'].includes(fundo.perfilNoFundo)) {
    throw new AuthorizationError('Seu acesso ao Fundo não permite anexar contratos.', 'FORBIDDEN')
  }
  const [{ data: cedente, error }, { data: vinculo, error: vinculoError }] = await Promise.all([
    auth.supabase.from('cedentes').select('id, contrato_assinado_url').eq('id', cedenteId).maybeSingle(),
    auth.supabase.from('cedente_fundos').select('id')
      .eq('cedente_id', cedenteId).eq('fundo_id', fundo.fundoId).eq('status', 'ativo').maybeSingle(),
  ])
  if (error || vinculoError) throw new Error('CONTRACT_CONTEXT_QUERY_FAILED')
  if (!cedente || !vinculo) {
    throw new AuthorizationError('Cedente indisponível no Fundo ativo.', 'NOT_FOUND')
  }
  return { auth, fundo, cedente }
}

export async function anexarContratoAssinadoCedente(cedenteId: string, arquivo: File) {
  const contexto = await autorizarContratoAssinadoCedente(cedenteId)
  if (arquivo.size > MAX_CONTRATO_ASSINADO_BYTES) {
    throw new DocumentoAssinadoOperacaoError('O contrato excede o limite de 4 MB.', 400, 'FILE_TOO_LARGE')
  }
  const pdf = await validarPdfAssinado(arquivo)
  const path = `cedentes/${cedenteId}/assinados/contrato-cessao/${randomUUID()}.pdf`
  // Apenas o transporte privado usa o backend. A mutacao do cadastro roda com
  // JWT real numa RPC estreita que revalida MFA/Fundo e grava auditoria atomica.
  const admin = createAdminClient()
  const storage = admin.storage.from(buckets.contratos)
  const { error: uploadError } = await storage.upload(path, pdf.buffer, {
    contentType: 'application/pdf', upsert: false,
    metadata: { sha256: pdf.sha256, usuario_id: contexto.auth.user.id, fundo_id: contexto.fundo.fundoId },
  })
  if (uploadError) throw new Error('CONTRACT_UPLOAD_FAILED')

  const { data, error } = await contexto.auth.supabase.rpc('registrar_contrato_assinado_cedente', {
    p_cedente_id: cedenteId, p_fundo_id: contexto.fundo.fundoId,
    p_path_anterior: contexto.cedente.contrato_assinado_url, p_path_novo: path,
    p_sha256: pdf.sha256, p_tamanho: arquivo.size, p_nome_original: pdf.nomeOriginal,
  })
  if (!error && data === path) return { path }

  // Em falha de transporte o commit pode ter ocorrido. Antes de compensar,
  // confirme o estado com JWT real; nunca apague um documento referenciado.
  const { data: atual, error: leituraError } = await contexto.auth.supabase.from('cedentes')
    .select('contrato_assinado_url').eq('id', cedenteId).maybeSingle()
  if (!leituraError && atual?.contrato_assinado_url === path) return { path }
  const rollbackConfirmado = error && /^(?:[0-9]{2}[0-9A-Z]{3}|P[0-9]{4})$/.test(error.code)
  if (rollbackConfirmado && !leituraError && atual) {
    const { error: limpezaError } = await storage.remove([path])
    if (limpezaError) console.error('[contrato-assinado-cedente] limpeza pendente', { cedenteId })
  } else {
    console.error('[contrato-assinado-cedente] resultado incerto; objeto privado preservado', { cedenteId })
  }
  if (error?.code === '40001') {
    throw new DocumentoAssinadoOperacaoError('O contrato foi alterado por outra solicitação. Atualize a página.', 409, 'CONCURRENT_REPLACEMENT')
  }
  if (error?.code === '42501') {
    throw new AuthorizationError('Não foi possível confirmar sua permissão. Atualize a sessão e o Fundo ativo.', 'FORBIDDEN')
  }
  throw new Error('CONTRACT_REGISTRATION_FAILED')
}
