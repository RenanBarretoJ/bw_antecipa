import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  aceitarNovoCedenteInviteSchema,
  mensagemAceiteConvite,
  mensagemFalhaEnvioConvite,
  novoCedenteInviteSchema,
} from './novo-cedente-invite'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260826190000_p2_invite_first_novo_cedente.sql'),
  'utf8',
)
const compatibilityMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260826193000_p2_invite_first_compatibilidade_convites_existentes.sql'),
  'utf8',
)
const signupAction = readFileSync(resolve(process.cwd(), 'src/app/actions/auth.ts'), 'utf8')
const inviteAction = readFileSync(resolve(process.cwd(), 'src/lib/actions/convite-novo-cedente.ts'), 'utf8')
const authConfirm = readFileSync(resolve(process.cwd(), 'src/app/auth/confirm/route.ts'), 'utf8')
const onboardingPage = readFileSync(resolve(process.cwd(), 'src/app/cedente/cadastro/page.tsx'), 'utf8')

describe('P2 - invite-first para novo Cedente', () => {
  it('normaliza CNPJ e e-mail e rejeita dados invalidos', () => {
    expect(novoCedenteInviteSchema.parse({
      fundoId: '11111111-1111-4111-8111-111111111111',
      cnpj: '11.222.333/0001-81',
      email: ' RESPONSAVEL@EMPRESA.COM.BR ',
    })).toEqual({
      fundoId: '11111111-1111-4111-8111-111111111111',
      cnpj: '11222333000181',
      email: 'responsavel@empresa.com.br',
    })
    expect(novoCedenteInviteSchema.safeParse({ fundoId: 'x', cnpj: '11', email: 'x' }).success).toBe(false)
  })

  it('exige senha forte, confirmacao e token hexadecimal de 256 bits', () => {
    const token = 'a'.repeat(64)
    expect(aceitarNovoCedenteInviteSchema.safeParse({ token, password: 'Senha@123', confirmPassword: 'Senha@123' }).success).toBe(true)
    expect(aceitarNovoCedenteInviteSchema.safeParse({ token, password: 'fraca', confirmPassword: 'fraca' }).success).toBe(false)
    expect(aceitarNovoCedenteInviteSchema.safeParse({ token: 'curto', password: 'Senha@123', confirmPassword: 'Senha@123' }).success).toBe(false)
  })

  it('evolui a tabela da P1 sem expor token plaintext', () => {
    expect(migration).toContain('ALTER COLUMN cedente_id DROP NOT NULL')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS fundo_id uuid')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS cnpj_normalizado text')
    expect(migration).toContain("tipo = 'NOVO_CEDENTE'")
    expect(migration).toContain("token_hash ~ '^[0-9a-f]{64}$'")
    expect(migration).not.toMatch(/token_plain|token_texto|token_original/i)
  })

  it('preserva o contrato dos convites para Cedente existente', () => {
    expect(compatibilityMigration).toContain("tipo = 'NOVO_CEDENTE' AND token_hash ~ '^[0-9a-f]{64}$'")
    expect(compatibilityMigration).toContain("tipo = 'USUARIO_CEDENTE_EXISTENTE'")
    expect(compatibilityMigration).toContain('length(pg_catalog.btrim(token_hash)) >= 32')
  })

  it('cria Cedente, Matriz, vinculo e ADMIN dentro do RPC transacional', () => {
    const accept = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.aceitar_convite_novo_cedente'))
    const onboarding = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.concluir_onboarding_cedente'))
    expect(migration.startsWith('BEGIN;')).toBe(true)
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true)
    expect(accept).toContain('INSERT INTO public.cedentes')
    expect(accept).toContain("WHERE e.cedente_id = v_cedente_id AND e.tipo = 'matriz'")
    expect(accept).toContain('INSERT INTO public.cedente_fundos')
    expect(accept).toContain('INSERT INTO public.cedente_acessos')
    expect(accept).toContain("'ADMIN', 'ATIVO'")
    expect(accept).toContain("status = 'ACEITO'")
    expect(onboarding).not.toContain('INSERT INTO public.cedentes')
  })

  it('bloqueia replay, expiracao, CNPJ duplicado e fundo indisponivel', () => {
    expect(migration).toContain("IF v_convite.status <> 'PENDENTE'")
    expect(migration).toContain("'CONVITE_JA_UTILIZADO'")
    expect(migration).toContain("v_convite.expires_at <= now()")
    expect(migration).toContain("'CONVITE_EXPIRADO'")
    expect(migration).toContain("'CNPJ_JA_CADASTRADO'")
    expect(migration).toContain("'FUNDO_INDISPONIVEL'")
    expect(migration).toContain('pg_advisory_xact_lock')
  })

  it('mantem as tabelas protegidas e valida o fundo no servidor', () => {
    expect(migration).toContain('private.usuario_pode_administrar_fundo_ativo(p_fundo_id)')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.criar_convite_novo_cedente')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.criar_convite_novo_cedente')
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.cedentes')
    expect(inviteAction).toContain('requireGestor()')
    expect(inviteAction).not.toContain(".from('cedentes').insert")
  })

  it('cancela o convite se Auth ou SMTP falhar sem criar Cedente', () => {
    expect(inviteAction).toContain(".rpc('criar_convite_novo_cedente'")
    expect(inviteAction).toContain('gerarLinkAuthNovoCedente')
    expect(inviteAction).toContain('enviarEmailConviteNovoCedente')
    expect(inviteAction).toContain(".rpc('cancelar_convite_novo_cedente'")
    expect(inviteAction).toContain('mensagemFalhaEnvioConvite')
    expect(mensagemFalhaEnvioConvite('SMTP_ERROR')).toContain('Nenhum Cedente foi criado.')
  })

  it('informa a categoria segura da falha de envio sem expor detalhes do provedor', () => {
    expect(mensagemFalhaEnvioConvite('EMAIL_DISABLED')).toContain('nao esta configurado')
    expect(mensagemFalhaEnvioConvite('SMTP_CONFIG_INVALID')).toContain('configuracao do servidor')
    expect(mensagemFalhaEnvioConvite('SMTP_EAUTH')).toContain('autenticar')
    expect(mensagemFalhaEnvioConvite('SMTP_RECIPIENT_REJECTED')).toContain('recusou o destinatario')
    expect(mensagemFalhaEnvioConvite('AUTH_LINK_ERROR')).toContain('Supabase Auth')
    expect(mensagemFalhaEnvioConvite('ERRO_DESCONHECIDO')).toContain('Nao foi possivel enviar')
  })

  it('interrompe signup livre e exige contexto invite-first no onboarding', () => {
    const signup = signupAction.slice(signupAction.indexOf('export async function signup'), signupAction.indexOf('export async function logout'))
    expect(signup).not.toContain('auth.signUp')
    expect(signup).toContain('exclusivamente por convite')
    expect(onboardingPage).toContain('onboarding_concluido_em')
    expect(onboardingPage).toContain('Acesso por convite necessario')
  })

  it('separa invite de recovery na confirmacao Auth', () => {
    expect(authConfirm).toContain("const isInvite = type === 'invite'")
    expect(authConfirm).toContain("const next = isInvite ? '/convite/cedente'")
    expect(authConfirm).toContain("if (type === 'recovery') await marcarFluxoAutenticacao('password_recovery')")
    expect(authConfirm.match(/redirectUrl\.searchParams\.delete\('token'\)/g)).toHaveLength(2)
  })

  it('fornece mensagens fechadas para estados de seguranca', () => {
    expect(mensagemAceiteConvite('CONVITE_EXPIRADO')).toContain('expirou')
    expect(mensagemAceiteConvite('CONVITE_JA_UTILIZADO')).toContain('utilizado')
    expect(mensagemAceiteConvite('CODIGO_DESCONHECIDO')).toContain('Nao foi possivel')
  })
})
