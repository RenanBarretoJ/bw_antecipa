import JSZip from 'jszip'
import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { buckets } from '@/lib/storage'
import { registrarEventoSeguranca } from '@/lib/auth/mfa'
import { descriptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'

export const PORTAL_FIDC_PROVIDER = 'fromtis'
export const PORTAL_FIDC_LABEL = 'Portal FIDC'
export const PORTAL_FIDC_LABEL_WITH_VENDOR = 'Portal FIDC - Sinqia'

export type PortalFidcExecucaoTipo = 'teste_conexao' | 'envio_remessa' | 'consulta_status' | 'download_retorno'
export type PortalFidcExecucaoStatus = 'iniciada' | 'sucesso' | 'erro' | 'timeout' | 'cancelada'
export type PortalFidcErroCategoria =
  | 'autenticacao'
  | 'configuracao'
  | 'codigo_originador_divergente'
  | 'layout_invalido'
  | 'remessa_estado_invalido'
  | 'arquivo'
  | 'timeout'
  | 'rate_limit'
  | 'indisponibilidade'
  | 'resposta_inesperada'
  | 'erro_funcional'
  | 'desconhecido'

type AdminClient = ReturnType<typeof createAdminClient>

export type PortalFidcVersaoResolvida = {
  id: string
  integracaoId: string
  fundoId: string
  provedor: string
  versao: number
  ambiente: 'homologacao' | 'producao'
  status: string
  endpointBase: string
  identificadorCliente: string
  codigoOriginador: string | null
  credentialRef: string
  credencialIntegracaoId: string | null
  secretName: string | null
  vaultKey: string | null
  configuracao: Record<string, unknown>
}

type PortalFidcCredenciais = {
  username: string
  password: string
  source?: 'banco' | 'env_fallback'
  credencialIntegracaoId?: string | null
}

type RemessaPortalFidc = {
  id: string
  fundo_id: string
  configuracao_cnab_id: string
  configuracao_cnab_versao_id: string
  integracao_fundo_versao_id: string | null
  status: string
  bucket: string
  storage_path: string
  nome_arquivo: string
  sha256: string
  retorno_resumido: string | null
  fundo: { cnpj: string } | null
  configuracao: { codigo_originador: string; tipo_recebivel: string } | null
}

export function sha256Hex(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function sanitizeLogMessage(message: string, max = 700) {
  return message
    .replace(/<password>[\s\S]*?<\/password>/gi, '<password>[redacted]</password>')
    .replace(/password['"]?\s*[:=]\s*['"]?[^'",\s<]+/gi, 'password=[redacted]')
    .replace(/username['"]?\s*[:=]\s*['"]?[^'",\s<]+/gi, 'username=[redacted]')
    .replace(/token['"]?\s*[:=]\s*['"]?[^'",\s<]+/gi, 'token=[redacted]')
    .slice(0, max)
}

export function portalFidcCredentialEnvName(credentialRef: string, suffix: 'USERNAME' | 'PASSWORD') {
  const normalized = credentialRef.trim().replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '').toUpperCase()
  return `PORTAL_FIDC_CREDENTIAL_${normalized}_${suffix}`
}

export function resolverCredenciaisPortalFidc(integracao: Pick<PortalFidcVersaoResolvida, 'credentialRef' | 'secretName'>): PortalFidcCredenciais {
  const ref = (integracao.secretName || integracao.credentialRef).trim()
  const username = process.env[portalFidcCredentialEnvName(ref, 'USERNAME')]
  const password = process.env[portalFidcCredentialEnvName(ref, 'PASSWORD')]
  if (!username || !password) {
    throw Object.assign(new Error(`Credenciais do Portal FIDC nao encontradas para a referencia ${integracao.credentialRef}.`), { categoria: 'autenticacao' })
  }
  return { username, password, source: 'env_fallback', credencialIntegracaoId: null }
}

async function resolverCredenciaisPortalFidcBanco(
  admin: AdminClient,
  integracao: Pick<PortalFidcVersaoResolvida, 'id' | 'integracaoId' | 'fundoId' | 'ambiente' | 'credentialRef' | 'secretName' | 'credencialIntegracaoId'>,
): Promise<PortalFidcCredenciais | null> {
  let query = admin
    .from('credenciais_integracao')
    .select('id, fundo_id, integracao_fundo_id, ambiente, status, usuario_criptografado, senha_criptografada, chave_versao')
    .eq('fundo_id', integracao.fundoId)
    .eq('integracao_fundo_id', integracao.integracaoId)
    .eq('ambiente', integracao.ambiente)
    .eq('status', 'ativa')

  if (integracao.credencialIntegracaoId) query = query.eq('id', integracao.credencialIntegracaoId)
  else query = query.order('ativada_em', { ascending: false }).limit(1)

  const { data, error } = await query.maybeSingle()
  if (error) {
    if (error.code === '42P01' || error.message?.includes('credenciais_integracao')) return null
    throw new Error(`Erro ao resolver credencial Portal FIDC: ${error.message}`)
  }
  if (!data) return null

  const credencial = data as unknown as {
    id: string
    fundo_id: string
    integracao_fundo_id: string
    ambiente: string
    status: string
    usuario_criptografado: string
    senha_criptografada: string
    chave_versao: string
  }

  if (
    credencial.fundo_id !== integracao.fundoId
    || credencial.integracao_fundo_id !== integracao.integracaoId
    || credencial.ambiente !== integracao.ambiente
    || credencial.status !== 'ativa'
  ) {
    throw Object.assign(new Error('Credencial Portal FIDC ativa incompatível com fundo, integração ou ambiente.'), { categoria: 'autenticacao' })
  }

  const username = descriptografarPortalFidcValor(credencial.usuario_criptografado, credencial.chave_versao)
  const password = descriptografarPortalFidcValor(credencial.senha_criptografada, credencial.chave_versao)
  await admin.from('credenciais_integracao').update({ ultimo_uso_em: new Date().toISOString() } as never).eq('id', credencial.id)
  await registrarEventoSeguranca({
    tipo_evento: 'CREDENCIAL_USADA',
    ator_tipo: 'integracao',
    severidade: 'info',
    entidade_tipo: 'credenciais_integracao',
    entidade_id: credencial.id,
    dados: { fundo_id: integracao.fundoId, integracao_fundo_id: integracao.integracaoId, ambiente: integracao.ambiente, versao_id: integracao.id },
  })
  return { username, password, source: 'banco', credencialIntegracaoId: credencial.id }
}

export async function resolverCredenciaisPortalFidcSeguras(admin: AdminClient, integracao: PortalFidcVersaoResolvida): Promise<PortalFidcCredenciais> {
  const credencialBanco = await resolverCredenciaisPortalFidcBanco(admin, integracao)
  if (credencialBanco) return credencialBanco

  const credencialEnv = resolverCredenciaisPortalFidc(integracao)
  await registrarEventoSeguranca({
    tipo_evento: 'CREDENCIAL_USADA',
    ator_tipo: 'integracao',
    severidade: 'warning',
    entidade_tipo: 'integracao_fundo_versoes',
    entidade_id: integracao.id,
    dados: { fundo_id: integracao.fundoId, integracao_fundo_id: integracao.integracaoId, ambiente: integracao.ambiente, fallback_env: true },
  })
  return credencialEnv
}

export async function resolverVersaoPortalFidc(
  admin: AdminClient,
  fundoId: string,
  versaoId?: string,
): Promise<PortalFidcVersaoResolvida> {
  const query = admin
    .from('integracoes_fundo')
    .select('id, fundo_id, provedor, status, integracao_fundo_versoes(*)')
    .eq('fundo_id', fundoId)
    .eq('provedor', PORTAL_FIDC_PROVIDER)
    .eq('status', 'ativa')

  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`Erro ao resolver configuracao do Portal FIDC: ${error.message}`)

  const integracao = data as unknown as {
    id: string
    fundo_id: string
    provedor: string
    status: string
    integracao_fundo_versoes?: Array<Record<string, unknown>>
  } | null

  const now = Date.now()
  const versoes = (integracao?.integracao_fundo_versoes || [])
    .filter((versao) => versaoId ? String(versao.id) === versaoId : versao.status === 'publicada')
    .filter((versao) => versaoId ? true : new Date(String(versao.vigente_desde)).getTime() <= now)
    .filter((versao) => versaoId ? true : !versao.vigente_ate || new Date(String(versao.vigente_ate)).getTime() > now)
    .sort((a, b) => Number(b.versao) - Number(a.versao))

  const vigente = versoes[0]
  if (!integracao || !vigente) throw new Error('Configuracao do Portal FIDC publicada e vigente nao encontrada para o fundo.')
  if (!versaoId && vigente.status !== 'publicada') throw new Error('Configuracao do Portal FIDC nao esta publicada.')

  return {
    id: String(vigente.id),
    integracaoId: String(integracao.id),
    fundoId: String(integracao.fundo_id),
    provedor: String(integracao.provedor),
    versao: Number(vigente.versao),
    ambiente: String(vigente.ambiente) as 'homologacao' | 'producao',
    status: String(vigente.status),
    endpointBase: String(vigente.endpoint_base),
    identificadorCliente: String(vigente.identificador_cliente),
    codigoOriginador: vigente.codigo_originador ? String(vigente.codigo_originador) : null,
    credentialRef: String(vigente.credential_ref),
    credencialIntegracaoId: vigente.credencial_integracao_id ? String(vigente.credencial_integracao_id) : null,
    secretName: vigente.secret_name ? String(vigente.secret_name) : null,
    vaultKey: vigente.vault_key ? String(vigente.vault_key) : null,
    configuracao: (vigente.configuracao_nao_sensivel as Record<string, unknown> | null) || {},
  }
}

async function criarExecucao(admin: AdminClient, input: {
  fundoId: string
  integracaoFundoVersaoId: string
  remessaCnabId?: string | null
  operacaoId?: string | null
  tipoExecucao: PortalFidcExecucaoTipo
  ambiente: 'homologacao' | 'producao'
  tentativa?: number
  idempotencyKey?: string | null
  requestHash?: string | null
}) {
  const { data, error } = await admin
    .from('integracao_execucoes')
    .insert({
      fundo_id: input.fundoId,
      integracao_fundo_versao_id: input.integracaoFundoVersaoId,
      remessa_cnab_id: input.remessaCnabId || null,
      operacao_id: input.operacaoId || null,
      tipo_execucao: input.tipoExecucao,
      ambiente: input.ambiente,
      status: 'iniciada',
      tentativa: input.tentativa || 1,
      idempotency_key: input.idempotencyKey || null,
      request_hash: input.requestHash || null,
      iniciada_em: new Date().toISOString(),
    } as never)
    .select('id, iniciada_em')
    .single()

  if (error || !data) throw new Error(`Erro ao registrar execucao do Portal FIDC: ${error?.message || 'registro nao retornado'}`)
  return data as unknown as { id: string; iniciada_em: string }
}

async function finalizarExecucao(admin: AdminClient, execucaoId: string, input: {
  status: PortalFidcExecucaoStatus
  protocoloExterno?: string | null
  codigoResposta?: string | null
  mensagemResumida?: string | null
  erroCategoria?: PortalFidcErroCategoria | null
  iniciadaEm: string
}) {
  const finalizada = new Date()
  const duracaoMs = Math.max(0, finalizada.getTime() - new Date(input.iniciadaEm).getTime())
  await admin
    .from('integracao_execucoes')
    .update({
      status: input.status,
      protocolo_externo: input.protocoloExterno || null,
      codigo_resposta: input.codigoResposta || null,
      mensagem_resumida: input.mensagemResumida ? sanitizeLogMessage(input.mensagemResumida, 500) : null,
      erro_categoria: input.erroCategoria || null,
      duracao_ms: duracaoMs,
      finalizada_em: finalizada.toISOString(),
    } as never)
    .eq('id', execucaoId)
}

function categorizarErro(error: unknown): PortalFidcErroCategoria {
  const explicit = (error as { categoria?: PortalFidcErroCategoria } | null)?.categoria
  if (explicit) return explicit
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (message.includes('timeout') || message.includes('abort')) return 'timeout'
  if (message.includes('credencia') || message.includes('401') || message.includes('403')) return 'autenticacao'
  if (message.includes('originador')) return 'codigo_originador_divergente'
  if (message.includes('storage') || message.includes('arquivo') || message.includes('sha-256')) return 'arquivo'
  if (message.includes('429')) return 'rate_limit'
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) return 'indisponibilidade'
  return 'desconhecido'
}

function erroTransitorio(categoria: PortalFidcErroCategoria) {
  return ['timeout', 'rate_limit', 'indisponibilidade'].includes(categoria)
}

function statusPermitidoEnvio(status: string) {
  return ['gerada', 'validada', 'erro'].includes(status)
}

function montarIdempotencyKey(remessaId: string, integracaoVersaoId: string, tipo: PortalFidcExecucaoTipo) {
  return sha256Hex(`${tipo}:${remessaId}:${integracaoVersaoId}`)
}

function extrairMensagemSoap(xmlContent: string) {
  return xmlContent.match(/<mensagem>([^<]+)<\/mensagem>/)?.[1]
    || xmlContent.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1]
    || xmlContent.slice(0, 1000)
}

function extrairIdArquivoSoap(xmlContent: string) {
  return xmlContent.match(/<idArquivo>([^<]+)<\/idArquivo>/)?.[1]
    || xmlContent.match(/<protocolo>([^<]+)<\/protocolo>/)?.[1]
    || xmlContent.match(/<protocoloExterno>([^<]+)<\/protocoloExterno>/)?.[1]
}

async function carregarRemessaPorOperacao(admin: AdminClient, operacaoId: string) {
  const { data: link, error } = await admin
    .from('remessas_cnab_operacoes')
    .select('remessa:remessas_cnab(id, fundo_id, configuracao_cnab_id, configuracao_cnab_versao_id, integracao_fundo_versao_id, status, bucket, storage_path, nome_arquivo, sha256, retorno_resumido, fundo:fundos(cnpj), configuracao:configuracao_cnab_versoes(codigo_originador, tipo_recebivel))')
    .eq('operacao_id', operacaoId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Erro ao carregar remessa CNAB: ${error.message}`)
  const remessa = (link as unknown as { remessa: RemessaPortalFidc | null } | null)?.remessa
  if (!remessa) throw new Error('Remessa CNAB registrada nao encontrada para esta operacao. Gere o CNAB da Fase 7 antes do envio.')
  return remessa
}

async function baixarArquivoRemessa(admin: AdminClient, remessa: RemessaPortalFidc) {
  const { data, error } = await admin.storage.from(remessa.bucket || buckets.remessasCnab).download(remessa.storage_path)
  if (error || !data) throw new Error('Arquivo CNAB nao encontrado no storage.')
  const buffer = Buffer.from(await data.arrayBuffer())
  const hash = sha256Hex(buffer)
  if (hash !== remessa.sha256) throw new Error('SHA-256 do arquivo CNAB diverge do hash registrado na remessa.')
  return buffer
}

function validarCodigoOriginador(remessa: RemessaPortalFidc, integracao: PortalFidcVersaoResolvida) {
  const codigoCnab = remessa.configuracao?.codigo_originador
  const codigoIntegracao = integracao.codigoOriginador
  if (!codigoCnab || !codigoIntegracao || codigoCnab !== codigoIntegracao) {
    const detalhe = `CNAB=${codigoCnab || 'nao configurado'} PortalFIDC=${codigoIntegracao || 'nao configurado'}`
    throw Object.assign(new Error(`O codigo originador da configuracao CNAB diverge do codigo originador configurado no Portal FIDC para este fundo. ${detalhe}`), { categoria: 'codigo_originador_divergente' })
  }
}

async function enviarSoapPortalFidc(input: {
  integracao: PortalFidcVersaoResolvida
  credenciais: PortalFidcCredenciais
  remessa: RemessaPortalFidc
  cnabBuffer: Buffer
}) {
  const tipoRecebivel = input.remessa.configuracao?.tipo_recebivel || String(input.integracao.configuracao.tipoRecebivel || '01')
  const nomeRem = input.remessa.nome_arquivo
  const nomeZip = nomeRem.replace(/\.REM$/i, '.zip')
  const zip = new JSZip()
  zip.file(nomeRem, input.cnabBuffer)
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const arquivoBase64 = zipBuffer.toString('base64')
  const cnpjFundo = input.remessa.fundo?.cnpj?.replace(/\D/g, '')
  if (!cnpjFundo) throw new Error('CNPJ do fundo nao encontrado para envio ao Portal FIDC.')

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>\
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://soap.consulta.servicos.portal.fidc.fromtis.com.br/">\
<soapenv:Header/>\
<soapenv:Body>\
<soap:importarArquivoRemessa>\
<arquivoCnab>\
<tipoRecebivel>${tipoRecebivel}</tipoRecebivel>\
<caminho>${nomeZip}</caminho>\
<cnpjFundo>${cnpjFundo}</cnpjFundo>\
<arquivo>${arquivoBase64}</arquivo>\
</arquivoCnab>\
</soap:importarArquivoRemessa>\
</soapenv:Body>\
</soapenv:Envelope>`

  const response = await fetch(input.integracao.endpointBase, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '',
      username: input.credenciais.username,
      password: input.credenciais.password,
    },
    body: envelope,
    signal: AbortSignal.timeout(45000),
  })

  const responseText = await response.text()
  const xmlMatch = responseText.match(/<[A-Za-z]+:Envelope[\s\S]*?<\/[A-Za-z]+:Envelope>/)
  const xmlContent = xmlMatch?.[0] ?? responseText
  const mensagem = extrairMensagemSoap(xmlContent)

  if (!response.ok) {
    const categoria = response.status === 429 ? 'rate_limit' : response.status >= 500 ? 'indisponibilidade' : response.status === 401 || response.status === 403 ? 'autenticacao' : 'erro_funcional'
    throw Object.assign(new Error(`Portal FIDC HTTP ${response.status}: ${sanitizeLogMessage(mensagem)}`), { categoria })
  }

  const protocolo = extrairIdArquivoSoap(xmlContent)
  if (!protocolo) throw Object.assign(new Error(`Portal FIDC SOAP: ${sanitizeLogMessage(mensagem)}`), { categoria: 'resposta_inesperada' })
  return { protocolo, mensagem: mensagem || 'Arquivo importado com sucesso', codigoResposta: String(response.status) }
}

export async function testarConexaoPortalFidc(fundoId: string, versaoId: string): Promise<{ success: boolean; message: string; data?: { execucaoId: string } }> {
  const admin = createAdminClient()
  const integracao = await resolverVersaoPortalFidc(admin, fundoId, versaoId)
  if (integracao.fundoId !== fundoId) return { success: false, message: 'Versao de integracao nao pertence ao fundo informado.' }
  const started = await criarExecucao(admin, {
    fundoId,
    integracaoFundoVersaoId: integracao.id,
    tipoExecucao: 'teste_conexao',
    ambiente: integracao.ambiente,
    idempotencyKey: montarIdempotencyKey(`teste:${Date.now()}`, integracao.id, 'teste_conexao'),
    requestHash: sha256Hex(`teste_conexao:${integracao.endpointBase}:${integracao.credentialRef}`),
  })

  try {
    const credenciais = await resolverCredenciaisPortalFidcSeguras(admin, integracao)
    const before = Date.now()
    const response = await fetch(integracao.endpointBase, {
      method: 'GET',
      headers: {
        username: credenciais.username,
        password: credenciais.password,
      },
      signal: AbortSignal.timeout(15000),
    })
    const duration = Date.now() - before
    const statusOk = response.status < 500 && response.status !== 401 && response.status !== 403
    const status: PortalFidcExecucaoStatus = statusOk ? 'sucesso' : 'erro'
    const categoria = statusOk ? null : response.status === 401 || response.status === 403 ? 'autenticacao' : 'resposta_inesperada'
    await finalizarExecucao(admin, started.id, {
      status,
      codigoResposta: String(response.status),
      mensagemResumida: `Teste de conexao HTTP ${response.status} em ${duration}ms.`,
      erroCategoria: categoria,
      iniciadaEm: started.iniciada_em,
    })
    return { success: statusOk, message: statusOk ? 'Conexao com o Portal FIDC validada.' : `Portal FIDC respondeu HTTP ${response.status}.`, data: { execucaoId: started.id } }
  } catch (error) {
    const categoria = categorizarErro(error)
    await finalizarExecucao(admin, started.id, {
      status: categoria === 'timeout' ? 'timeout' : 'erro',
      mensagemResumida: error instanceof Error ? error.message : 'Erro no teste de conexao.',
      erroCategoria: categoria,
      iniciadaEm: started.iniciada_em,
    })
    return { success: false, message: sanitizeLogMessage(error instanceof Error ? error.message : 'Erro no teste de conexao.'), data: { execucaoId: started.id } }
  }
}

export function mapearStatusPortalFidc(statusExterno: string): { statusInterno: 'enviada' | 'aceita' | 'rejeitada' | 'erro'; pendente: boolean; statusExterno: string } {
  const normalized = statusExterno.trim().toLowerCase()
  if (['aceita', 'aceito', 'processado', 'sucesso', 'importado'].some((term) => normalized.includes(term))) {
    return { statusInterno: 'aceita', pendente: false, statusExterno }
  }
  if (['rejeitada', 'rejeitado', 'erro definitivo', 'recusado'].some((term) => normalized.includes(term))) {
    return { statusInterno: 'rejeitada', pendente: false, statusExterno }
  }
  if (['processando', 'pendente', 'em processamento', 'recebido'].some((term) => normalized.includes(term))) {
    return { statusInterno: 'enviada', pendente: true, statusExterno }
  }
  return { statusInterno: 'enviada', pendente: true, statusExterno }
}

export async function enviarRemessaPortalFidc(operacaoId: string): Promise<{ idArquivo: string; mensagem: string; execucaoId?: string }> {
  const admin = createAdminClient()
  const remessa = await carregarRemessaPorOperacao(admin, operacaoId)
  if (!statusPermitidoEnvio(remessa.status)) throw Object.assign(new Error(`Remessa CNAB em status ${remessa.status} nao pode ser enviada ao Portal FIDC.`), { categoria: 'remessa_estado_invalido' })

  const integracao = await resolverVersaoPortalFidc(admin, remessa.fundo_id)
  validarCodigoOriginador(remessa, integracao)
  const idempotencyKey = montarIdempotencyKey(remessa.id, integracao.id, 'envio_remessa')

  const { data: previous } = await admin
    .from('integracao_execucoes')
    .select('id, status, protocolo_externo, mensagem_resumida')
    .eq('idempotency_key', idempotencyKey)
    .eq('tipo_execucao', 'envio_remessa')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const previousExec = previous as unknown as { id: string; status: string; protocolo_externo: string | null; mensagem_resumida: string | null } | null
  if (previousExec?.status === 'sucesso' && previousExec.protocolo_externo) {
    return { idArquivo: previousExec.protocolo_externo, mensagem: previousExec.mensagem_resumida || 'Envio idempotente ja confirmado.', execucaoId: previousExec.id }
  }
  if (previousExec?.status === 'iniciada') {
    throw new Error('Existe uma tentativa de envio do Portal FIDC em estado incerto. Consulte o status antes de reenviar.')
  }

  const credenciais = await resolverCredenciaisPortalFidcSeguras(admin, integracao)
  const cnabBuffer = await baixarArquivoRemessa(admin, remessa)
  const requestHash = sha256Hex(`${remessa.id}:${integracao.id}:${cnabBuffer.toString('base64')}`)
  let lastError: unknown

  for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
    const execucao = await criarExecucao(admin, {
      fundoId: remessa.fundo_id,
      integracaoFundoVersaoId: integracao.id,
      remessaCnabId: remessa.id,
      operacaoId,
      tipoExecucao: 'envio_remessa',
      ambiente: integracao.ambiente,
      tentativa,
      idempotencyKey,
      requestHash,
    })

    try {
      const resultado = await enviarSoapPortalFidc({ integracao, credenciais, remessa, cnabBuffer })
      await finalizarExecucao(admin, execucao.id, {
        status: 'sucesso',
        protocoloExterno: resultado.protocolo,
        codigoResposta: resultado.codigoResposta,
        mensagemResumida: resultado.mensagem,
        iniciadaEm: execucao.iniciada_em,
      })

      const now = new Date().toISOString()
      await admin.from('operacoes').update({
        remessa_enviado_em: now,
        remessa_fromtis_id: resultado.protocolo,
        remessa_fromtis_retorno: resultado.mensagem,
      } as never).eq('id', operacaoId)

      await admin
        .from('remessas_cnab')
        .update({ status: 'enviada', enviado_em: now, retorno_resumido: resultado.mensagem, integracao_fundo_versao_id: integracao.id } as never)
        .eq('id', remessa.id)

      return { idArquivo: resultado.protocolo, mensagem: resultado.mensagem, execucaoId: execucao.id }
    } catch (error) {
      lastError = error
      const categoria = categorizarErro(error)
      await finalizarExecucao(admin, execucao.id, {
        status: categoria === 'timeout' ? 'timeout' : 'erro',
        mensagemResumida: error instanceof Error ? error.message : 'Erro no envio ao Portal FIDC.',
        erroCategoria: categoria,
        iniciadaEm: execucao.iniciada_em,
      })
      if (!erroTransitorio(categoria) || tentativa === 3) break
      await new Promise((resolve) => setTimeout(resolve, 250 * tentativa))
    }
  }

  const categoria = categorizarErro(lastError)
  await admin
    .from('remessas_cnab')
    .update({ status: 'erro', retorno_resumido: sanitizeLogMessage(lastError instanceof Error ? lastError.message : 'Erro no envio ao Portal FIDC.'), integracao_fundo_versao_id: integracao.id } as never)
    .eq('id', remessa.id)
  throw Object.assign(new Error(sanitizeLogMessage(lastError instanceof Error ? lastError.message : 'Erro no envio ao Portal FIDC.')), { categoria })
}

export async function consultarStatusPortalFidc(operacaoId: string): Promise<{ status: string; mensagem: string }> {
  const admin = createAdminClient()
  const remessa = await carregarRemessaPorOperacao(admin, operacaoId)
  if (!remessa.integracao_fundo_versao_id) throw new Error('Remessa ainda nao possui versao de integracao vinculada.')
  const integracao = await resolverVersaoPortalFidc(admin, remessa.fundo_id, remessa.integracao_fundo_versao_id)
  const { data: last } = await admin
    .from('integracao_execucoes')
    .select('protocolo_externo')
    .eq('remessa_cnab_id', remessa.id)
    .eq('tipo_execucao', 'envio_remessa')
    .eq('status', 'sucesso')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const protocolo = (last as { protocolo_externo?: string } | null)?.protocolo_externo
  if (!protocolo) throw new Error('Protocolo externo nao encontrado para consulta de status.')

  const execucao = await criarExecucao(admin, {
    fundoId: remessa.fundo_id,
    integracaoFundoVersaoId: integracao.id,
    remessaCnabId: remessa.id,
    operacaoId,
    tipoExecucao: 'consulta_status',
    ambiente: integracao.ambiente,
    idempotencyKey: montarIdempotencyKey(remessa.id, integracao.id, 'consulta_status'),
    requestHash: sha256Hex(`consulta_status:${protocolo}`),
  })

  try {
    const mensagemExterna = remessa.retorno_resumido || 'processando'
    const mapped = mapearStatusPortalFidc(mensagemExterna)
    await admin.from('remessas_cnab').update({ status: mapped.statusInterno, retorno_resumido: mapped.statusExterno } as never).eq('id', remessa.id)
    await admin.from('operacoes').update({ remessa_fromtis_retorno: mapped.statusExterno } as never).eq('id', operacaoId)
    await finalizarExecucao(admin, execucao.id, {
      status: 'sucesso',
      protocoloExterno: protocolo,
      mensagemResumida: mapped.statusExterno,
      iniciadaEm: execucao.iniciada_em,
    })
    return { status: mapped.statusInterno, mensagem: mapped.statusExterno }
  } catch (error) {
    const categoria = categorizarErro(error)
    await finalizarExecucao(admin, execucao.id, {
      status: categoria === 'timeout' ? 'timeout' : 'erro',
      mensagemResumida: error instanceof Error ? error.message : 'Erro ao consultar status.',
      erroCategoria: categoria,
      iniciadaEm: execucao.iniciada_em,
    })
    throw error
  }
}
