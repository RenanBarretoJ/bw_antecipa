import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const smtpMocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}))

vi.mock('nodemailer', () => ({
  default: { createTransport: smtpMocks.createTransport },
}))

const SMTP_ENV_KEYS = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_ALLOW_INSECURE_LOCAL',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'EMAIL_FROM',
] as const

beforeEach(() => {
  for (const key of SMTP_ENV_KEYS) delete process.env[key]
  smtpMocks.sendMail.mockReset()
  smtpMocks.createTransport.mockReset().mockReturnValue({ sendMail: smtpMocks.sendMail })
  vi.resetModules()
})

afterEach(() => {
  for (const key of SMTP_ENV_KEYS) delete process.env[key]
})

describe('transporte SMTP IONOS', () => {
  it('permanece desabilitado sem credenciais', async () => {
    const { resolverConfiguracaoSmtp } = await import('./email')

    expect(resolverConfiguracaoSmtp({})).toEqual({
      enabled: false,
      errorCode: 'EMAIL_DISABLED',
      errorMessage: 'Transporte SMTP nao configurado.',
    })
  })

  it('rejeita configuracao parcial e remetente de outro dominio', async () => {
    const { resolverConfiguracaoSmtp } = await import('./email')

    expect(resolverConfiguracaoSmtp({ SMTP_USER: 'notificacoes@betterwith.com.br' })).toMatchObject({
      enabled: false,
      errorCode: 'SMTP_CONFIG_INVALID',
    })
    expect(resolverConfiguracaoSmtp({
      SMTP_USER: 'notificacoes@betterwith.com.br',
      SMTP_PASSWORD: 'test-secret',
      EMAIL_FROM: 'BETTER WITH <noreply@outro-dominio.example>',
    })).toMatchObject({
      enabled: false,
      errorCode: 'SMTP_CONFIG_INVALID',
    })
  })

  it('usa os defaults seguros da IONOS na porta 465', async () => {
    const { resolverConfiguracaoSmtp } = await import('./email')

    expect(resolverConfiguracaoSmtp({
      SMTP_USER: 'notificacoes@betterwith.com.br',
      SMTP_PASSWORD: 'test-secret',
    })).toEqual({
      enabled: true,
      config: {
        host: 'smtp.ionos.com',
        port: 465,
        secure: true,
        requireTls: false,
        ignoreTls: false,
        user: 'notificacoes@betterwith.com.br',
        password: 'test-secret',
        from: 'BETTER WITH <notificacoes@betterwith.com.br>',
      },
    })
  })

  it('permite SMTP sem TLS somente para sink loopback explicitamente marcado como rehearsal', async () => {
    const { resolverConfiguracaoSmtp } = await import('./email')
    const result = resolverConfiguracaoSmtp({
      NEXT_PUBLIC_APP_ENV: 'rehearsal/local',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '55325',
      SMTP_SECURE: 'false',
      SMTP_ALLOW_INSECURE_LOCAL: 'true',
      SMTP_USER: 'rehearsal@bw-antecipa.invalid',
      SMTP_PASSWORD: 'local-only',
      EMAIL_FROM: 'BETTER WITH <rehearsal@bw-antecipa.invalid>',
    })

    expect(result).toMatchObject({ enabled: true, config: { requireTls: false, ignoreTls: true } })
  })

  it('mantem TLS obrigatorio em host remoto ou fora do rehearsal', async () => {
    const { resolverConfiguracaoSmtp } = await import('./email')
    const base = {
      SMTP_PORT: '2525',
      SMTP_SECURE: 'false',
      SMTP_ALLOW_INSECURE_LOCAL: 'true',
      SMTP_USER: 'mailer@example.com',
      SMTP_PASSWORD: 'test-secret',
      EMAIL_FROM: 'BETTER WITH <mailer@example.com>',
    }

    expect(resolverConfiguracaoSmtp({ ...base, SMTP_HOST: 'smtp.example.com', NEXT_PUBLIC_APP_ENV: 'rehearsal/local' }))
      .toMatchObject({ enabled: true, config: { requireTls: true, ignoreTls: false } })
    expect(resolverConfiguracaoSmtp({ ...base, SMTP_HOST: '127.0.0.1', NEXT_PUBLIC_APP_ENV: 'homolog' }))
      .toMatchObject({ enabled: true, config: { requireTls: true, ignoreTls: false } })
  })

  it('envia texto, HTML, CC, Message-ID e chave de idempotencia via SMTP', async () => {
    process.env.SMTP_USER = 'notificacoes@betterwith.com.br'
    process.env.SMTP_PASSWORD = 'test-secret'
    process.env.EMAIL_FROM = 'BETTER WITH <notificacoes@betterwith.com.br>'
    smtpMocks.sendMail.mockResolvedValue({
      accepted: ['destinatario@example.com'],
      rejected: [],
      messageId: '<comunicacao@example.com>',
    })
    const { enviarEmailOperacional } = await import('./email')

    const result = await enviarEmailOperacional({
      to: 'destinatario@example.com',
      cc: ['gestor@example.com'],
      fromName: 'RX ASSET',
      subject: 'Teste operacional',
      html: '<p>Teste</p>',
      text: 'Teste',
      messageId: '<comunicacao@example.com>',
      idempotencyKey: 'idempotency-test',
    })

    expect(smtpMocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.ionos.com',
      port: 465,
      secure: true,
      requireTLS: false,
    }))
    expect(smtpMocks.sendMail).toHaveBeenCalledWith({
      from: { name: 'RX ASSET', address: 'notificacoes@betterwith.com.br' },
      to: 'destinatario@example.com',
      cc: ['gestor@example.com'],
      subject: 'Teste operacional',
      html: '<p>Teste</p>',
      text: 'Teste',
      messageId: '<comunicacao@example.com>',
      headers: { 'X-BW-Idempotency-Key': 'idempotency-test' },
    })
    expect(result).toEqual({
      success: true,
      providerId: '<comunicacao@example.com>',
      errorCode: null,
      errorMessage: null,
    })
  })

  it('altera somente o nome visivel e preserva a conta SMTP autenticada', async () => {
    process.env.SMTP_USER = 'notificacoes@betterwith.com.br'
    process.env.SMTP_PASSWORD = 'test-secret'
    smtpMocks.sendMail.mockResolvedValue({
      accepted: ['destinatario@example.com'],
      rejected: [],
      messageId: '<fundo-b@example.com>',
    })
    const { enviarEmailOperacional } = await import('./email')

    await enviarEmailOperacional({
      to: 'destinatario@example.com',
      fromName: 'GESTORA B\r\nBcc: intruso@example.com',
      subject: 'Comunicacao do fundo B',
      html: '<p>Teste</p>',
    })

    expect(smtpMocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: {
        name: 'GESTORA B Bcc: intruso@example.com',
        address: 'notificacoes@betterwith.com.br',
      },
    }))
    expect(smtpMocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      auth: { user: 'notificacoes@betterwith.com.br', pass: 'test-secret' },
    }))
  })

  it('retorna erro sanitizado quando o SMTP rejeita o destinatario', async () => {
    process.env.SMTP_USER = 'notificacoes@betterwith.com.br'
    process.env.SMTP_PASSWORD = 'test-secret'
    smtpMocks.sendMail.mockResolvedValue({
      accepted: [],
      rejected: ['destinatario@example.com'],
      messageId: '<comunicacao@example.com>',
    })
    const { enviarEmailOperacional } = await import('./email')

    const result = await enviarEmailOperacional({
      to: 'destinatario@example.com',
      subject: 'Teste operacional',
      html: '<p>Teste</p>',
    })

    expect(result).toMatchObject({
      success: false,
      errorCode: 'SMTP_RECIPIENT_REJECTED',
    })
  })
})
