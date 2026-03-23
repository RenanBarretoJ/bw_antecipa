// ============================================================
// BW Antecipa — Servico de Email Transacional
// Preparado para Resend (https://resend.com)
// Para ativar: npm install resend, preencher RESEND_API_KEY no .env.local
// ============================================================

interface EmailPayload {
  to: string
  subject: string
  html: string
}

const RESEND_API_KEY = process.env.RESEND_API_KEY
const EMAIL_FROM = process.env.EMAIL_FROM || 'BW Antecipa <noreply@bluewaveasset.com.br>'
const EMAIL_ENABLED = !!RESEND_API_KEY

export async function enviarEmail({ to, subject, html }: EmailPayload): Promise<boolean> {
  if (!EMAIL_ENABLED) {
    console.log(`[email] (desabilitado) To: ${to} | Subject: ${subject}`)
    return false
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject,
        html,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('[email] Erro ao enviar:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('[email] Erro:', error)
    return false
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
          <h1 style="color: white; margin: 0; font-size: 22px;">BW Antecipa</h1>
        </div>
        <div style="padding: 32px;">
          ${content}
        </div>
        <div style="background: #f9f9f9; padding: 16px 32px; text-align: center; font-size: 12px; color: #999;">
          <p>BW BI LTDA — Portal de Antecipacao de Recebiveis</p>
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
}
