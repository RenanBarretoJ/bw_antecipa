import nodemailer, { type Transporter } from 'nodemailer'

// ============================================================
// BW Antecipa — Servico de Email Transacional via SMTP IONOS
// ============================================================

interface EmailPayload {
  to: string
  subject: string
  html: string
}

export interface EmailOperacionalPayload extends EmailPayload {
  text?: string
  cc?: string[]
  messageId?: string
  idempotencyKey?: string
  fromName?: string
}

export type EmailOperacionalResultado = {
  success: boolean
  providerId: string | null
  errorCode: string | null
  errorMessage: string | null
}

export const EMAIL_PROVIDER = 'ionos_smtp'

type ConfiguracaoSmtp = {
  host: string
  port: number
  secure: boolean
  requireTls: boolean
  ignoreTls: boolean
  user: string
  password: string
  from: string
}

type AmbienteSmtp = Readonly<Record<string, string | undefined>>

export type ResultadoConfiguracaoSmtp =
  | { enabled: true; config: ConfiguracaoSmtp }
  | { enabled: false; errorCode: 'EMAIL_DISABLED' | 'SMTP_CONFIG_INVALID'; errorMessage: string }

type InformacaoSmtp = {
  accepted: string[]
  rejected: string[]
  messageId: string | null
}

let transporter: Transporter | null = null

function extrairEnderecoEmail(value: string): string | null {
  const trimmed = value.trim()
  const angleMatch = trimmed.match(/<\s*([^<>]+)\s*>$/)
  const address = (angleMatch?.[1] || trimmed).trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null
}

function normalizarNomeCabecalho(value: string | undefined): string | null {
  const nome = String(value || '')
    .replace(/[\u0000-\u001F\u007F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return nome ? nome.slice(0, 120) : null
}

function resolverRemetente(from: string, fromName: string | undefined): string | { name: string; address: string } {
  const name = normalizarNomeCabecalho(fromName)
  const address = extrairEnderecoEmail(from)
  return name && address ? { name, address } : from
}

function parseSecure(value: string | undefined, port: number): boolean | null {
  if (value === undefined || value.trim() === '') return port === 465
  if (value.trim().toLowerCase() === 'true') return true
  if (value.trim().toLowerCase() === 'false') return false
  return null
}

export function resolverConfiguracaoSmtp(env: AmbienteSmtp = process.env): ResultadoConfiguracaoSmtp {
  const user = env.SMTP_USER?.trim() || ''
  const password = env.SMTP_PASSWORD || ''
  if (!user && !password) {
    return { enabled: false, errorCode: 'EMAIL_DISABLED', errorMessage: 'Transporte SMTP nao configurado.' }
  }

  const missing = [!user ? 'SMTP_USER' : '', !password ? 'SMTP_PASSWORD' : ''].filter(Boolean)
  if (missing.length) {
    return { enabled: false, errorCode: 'SMTP_CONFIG_INVALID', errorMessage: `Configuracao SMTP incompleta: ${missing.join(', ')}.` }
  }

  const host = env.SMTP_HOST?.trim() || 'smtp.ionos.com'
  const rawPort = env.SMTP_PORT?.trim() || '465'
  const port = Number(rawPort)
  const secure = parseSecure(env.SMTP_SECURE, port)
  const userAddress = extrairEnderecoEmail(user)
  const from = env.EMAIL_FROM?.trim() || `BETTER WITH <${user}>`
  const fromAddress = extrairEnderecoEmail(from)
  const localSinkSemTls = env.NEXT_PUBLIC_APP_ENV === 'rehearsal/local'
    && ['127.0.0.1', 'localhost'].includes(host.toLowerCase())
    && env.SMTP_ALLOW_INSECURE_LOCAL === 'true'

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return { enabled: false, errorCode: 'SMTP_CONFIG_INVALID', errorMessage: 'SMTP_PORT deve ser uma porta valida.' }
  }
  if (secure === null || (port === 465 && !secure) || (port === 587 && secure)) {
    return { enabled: false, errorCode: 'SMTP_CONFIG_INVALID', errorMessage: 'SMTP_SECURE e incompatível com a porta SMTP informada.' }
  }
  if (!userAddress || !fromAddress) {
    return { enabled: false, errorCode: 'SMTP_CONFIG_INVALID', errorMessage: 'SMTP_USER e EMAIL_FROM devem conter enderecos de e-mail validos.' }
  }
  if (userAddress.split('@')[1] !== fromAddress.split('@')[1]) {
    return { enabled: false, errorCode: 'SMTP_CONFIG_INVALID', errorMessage: 'EMAIL_FROM deve usar o mesmo dominio da conta SMTP IONOS.' }
  }

  return {
    enabled: true,
    config: {
      host,
      port,
      secure,
      requireTls: !secure && !localSinkSemTls,
      ignoreTls: localSinkSemTls,
      user,
      password,
      from,
    },
  }
}

function obterTransporter(config: ConfiguracaoSmtp): Transporter {
  if (transporter) return transporter
  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    ignoreTLS: config.ignoreTls,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: 'TLSv1.2', servername: config.host },
  })
  return transporter
}

function normalizarInformacaoSmtp(value: unknown): InformacaoSmtp {
  if (!value || typeof value !== 'object') return { accepted: [], rejected: [], messageId: null }
  const record = value as Record<string, unknown>
  const accepted = Array.isArray(record.accepted) ? record.accepted.map(String) : []
  const rejected = Array.isArray(record.rejected) ? record.rejected.map(String) : []
  return { accepted, rejected, messageId: typeof record.messageId === 'string' ? record.messageId : null }
}

function codigoErroSmtp(value: unknown): string {
  if (!value || typeof value !== 'object') return 'SMTP_ERROR'
  const record = value as Record<string, unknown>
  if (typeof record.responseCode === 'number' && Number.isInteger(record.responseCode)) return `SMTP_${record.responseCode}`
  if (typeof record.code === 'string' && /^[A-Z0-9_]+$/.test(record.code)) return `SMTP_${record.code}`
  return 'SMTP_ERROR'
}

export async function enviarEmail({ to, subject, html }: EmailPayload): Promise<boolean> {
  const result = await enviarEmailOperacional({ to, subject, html })
  return result.success
}

function sanitizarErroProvider(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value || 'Falha desconhecida no provedor.')
  return message.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]').slice(0, 300)
}

export async function enviarEmailOperacional({
  to,
  subject,
  html,
  text,
  cc = [],
  messageId,
  idempotencyKey,
  fromName,
}: EmailOperacionalPayload): Promise<EmailOperacionalResultado> {
  const resolved = resolverConfiguracaoSmtp()
  if (!resolved.enabled) return { success: false, providerId: null, errorCode: resolved.errorCode, errorMessage: resolved.errorMessage }

  try {
    const rawInfo: unknown = await obterTransporter(resolved.config).sendMail({
      from: resolverRemetente(resolved.config.from, fromName),
      to,
      ...(cc.length ? { cc } : {}),
      subject,
      html,
      ...(text ? { text } : {}),
      ...(messageId ? { messageId } : {}),
      ...(idempotencyKey ? { headers: { 'X-BW-Idempotency-Key': idempotencyKey } } : {}),
    })
    const info = normalizarInformacaoSmtp(rawInfo)
    const target = extrairEnderecoEmail(to)
    const accepted = target && info.accepted.some((item) => extrairEnderecoEmail(item) === target)
    if (!accepted) {
      return {
        success: false,
        providerId: info.messageId,
        errorCode: 'SMTP_RECIPIENT_REJECTED',
        errorMessage: info.rejected.length ? 'O servidor SMTP rejeitou o destinatario principal.' : 'O servidor SMTP nao confirmou o destinatario principal.',
      }
    }
    return { success: true, providerId: info.messageId || messageId || null, errorCode: null, errorMessage: null }
  } catch (error) {
    return { success: false, providerId: null, errorCode: codigoErroSmtp(error), errorMessage: sanitizarErroProvider(error) }
  }
}

// ============================================================
// Templates de Email
// ============================================================

function baseTemplate(content: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <div style="background: #1e3a5f; padding: 24px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 22px;">BETTER WITH</h1>
        </div>
        <div style="padding: 32px;">
          ${content}
        </div>
        <div style="background: #f9f9f9; padding: 16px 32px; text-align: center; font-size: 12px; color: #999;">
          <p>BETTER WITH — Portal de Antecipacao de Recebiveis</p>
          <p>Este e um email automatico. Nao responda.</p>
        </div>
      </div>
    </body>
    </html>
  `
}

export const emailTemplates = {
  // Cadastro
  cadastroPendente: (nome: string) => ({
    subject: 'Novo cadastro pendente de analise',
    html: baseTemplate(`
      <h2 style="color: #1e3a5f;">Novo Cadastro de Cedente</h2>
      <p>O cedente <strong>${nome}</strong> realizou o cadastro e aguarda analise.</p>
      <p>Acesse o portal para analisar os documentos e aprovar o cadastro.</p>
    `),
  }),

  cadastroAprovado: (nome: string, contaEscrow: string) => ({
    subject: 'Cadastro aprovado! Conta escrow criada',
    html: baseTemplate(`
      <h2 style="color: #16a34a;">Cadastro Aprovado!</h2>
      <p>Ola <strong>${nome}</strong>,</p>
      <p>Seu cadastro foi aprovado. Sua conta escrow foi criada:</p>
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; text-align: center; margin: 16px 0;">
        <p style="font-size: 20px; font-family: monospace; font-weight: bold; color: #16a34a;">${contaEscrow}</p>
      </div>
      <p>Voce ja pode enviar notas fiscais e solicitar antecipacoes.</p>
    `),
  }),

  // Documentos
  documentoAprovado: (nome: string, tipoDoc: string) => ({
    subject: `Documento aprovado: ${tipoDoc}`,
    html: baseTemplate(`
      <h2 style="color: #16a34a;">Documento Aprovado</h2>
      <p>Ola <strong>${nome}</strong>,</p>
      <p>Seu documento <strong>${tipoDoc}</strong> foi aprovado.</p>
    `),
  }),

  documentoReprovado: (nome: string, tipoDoc: string, motivo: string) => ({
    subject: `Documento reprovado: ${tipoDoc}`,
    html: baseTemplate(`
      <h2 style="color: #dc2626;">Documento Reprovado</h2>
      <p>Ola <strong>${nome}</strong>,</p>
      <p>Seu documento <strong>${tipoDoc}</strong> foi reprovado.</p>
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="color: #dc2626;"><strong>Motivo:</strong> ${motivo}</p>
      </div>
      <p>Acesse o portal para reenviar o documento.</p>
    `),
  }),

  // Operacoes
  operacaoAprovada: (nome: string, valor: string, taxa: string) => ({
    subject: 'Operacao aprovada — desembolso realizado',
    html: baseTemplate(`
      <h2 style="color: #16a34a;">Operacao Aprovada!</h2>
      <p>Ola <strong>${nome}</strong>,</p>
      <p>Sua operacao de antecipacao foi aprovada.</p>
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p><strong>Valor desembolsado:</strong> ${valor}</p>
        <p><strong>Taxa:</strong> ${taxa}% a.m.</p>
      </div>
      <p>Confira o extrato da sua conta escrow no portal.</p>
    `),
  }),

  operacaoReprovada: (nome: string, motivo: string) => ({
    subject: 'Operacao reprovada',
    html: baseTemplate(`
      <h2 style="color: #dc2626;">Operacao Reprovada</h2>
      <p>Ola <strong>${nome}</strong>,</p>
      <p>Sua solicitacao de antecipacao foi reprovada.</p>
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="color: #dc2626;"><strong>Motivo:</strong> ${motivo}</p>
      </div>
      <p>As NFs estao disponiveis para nova solicitacao.</p>
    `),
  }),

  // Cessao
  cessaoCredito: (sacadoNome: string, cedenteNome: string, nfs: string) => ({
    subject: 'Notificacao de cessao de credito',
    html: baseTemplate(`
      <h2 style="color: #7c3aed;">Cessao de Credito</h2>
      <p>Ola <strong>${sacadoNome}</strong>,</p>
      <p>Informamos que as seguintes notas fiscais emitidas contra voce foram cedidas ao cedente <strong>${cedenteNome}</strong>:</p>
      <div style="background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p><strong>NFs:</strong> ${nfs}</p>
      </div>
      <p>O pagamento no vencimento devera ser realizado na conta escrow indicada no portal.</p>
    `),
  }),

  // Vencimento
  alertaVencimento: (nome: string, dias: number, operacaoId: string, valor: string) => ({
    subject: dias === 1 ? 'URGENTE: Vencimento amanha' : `Alerta: Vencimento em ${dias} dias`,
    html: baseTemplate(`
      <h2 style="color: ${dias <= 1 ? '#dc2626' : '#f59e0b'};">Alerta de Vencimento</h2>
      <p>Ola <strong>${nome}</strong>,</p>
      <p>A operacao <strong>#${operacaoId}</strong> vence em <strong>${dias} dia(s)</strong>.</p>
      <div style="background: ${dias <= 1 ? '#fef2f2' : '#fffbeb'}; border: 1px solid ${dias <= 1 ? '#fecaca' : '#fde68a'}; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p><strong>Valor:</strong> ${valor}</p>
      </div>
    `),
  }),

  // Inadimplencia
  alertaInadimplencia: (cedenteNome: string, operacaoId: string) => ({
    subject: 'ALERTA URGENTE: Operacao inadimplente',
    html: baseTemplate(`
      <h2 style="color: #dc2626;">Operacao Inadimplente</h2>
      <p>A operacao <strong>#${operacaoId}</strong> do cedente <strong>${cedenteNome}</strong> esta inadimplente.</p>
      <p>O sacado nao efetuou o pagamento no vencimento.</p>
      <p style="color: #dc2626; font-weight: bold;">Acao imediata necessaria.</p>
    `),
  }),

  // Liquidacao
  operacaoLiquidada: (nome: string, operacaoId: string) => ({
    subject: 'Operacao liquidada com sucesso',
    html: baseTemplate(`
      <h2 style="color: #16a34a;">Operacao Liquidada</h2>
      <p>Ola <strong>${nome}</strong>,</p>
      <p>A operacao <strong>#${operacaoId}</strong> foi liquidada. O sacado efetuou o pagamento.</p>
      <p>Confira o extrato atualizado no portal.</p>
    `),
  }),

  // Seguranca
  senhaAlterada: (nome: string, dataHora: string, navegador: string, ipAproximado: string) => ({
    subject: 'Sua senha foi alterada',
    html: baseTemplate(`
      <h2 style="color: #1e3a5f;">Senha alterada</h2>
      <p>Ola <strong>${nome}</strong>,</p>
      <p>Sua senha de acesso ao BW Antecipa foi alterada.</p>
      <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p><strong>Data e hora:</strong> ${dataHora}</p>
        <p><strong>Navegador:</strong> ${navegador}</p>
        <p><strong>IP aproximado:</strong> ${ipAproximado}</p>
      </div>
      <p>Se nao foi voce, entre em contato imediatamente com a equipe Better With.</p>
    `),
  }),
}
