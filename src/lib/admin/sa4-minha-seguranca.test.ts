import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(path, 'utf8')
const page = source('src/app/admin/minha-seguranca/page.tsx')
const legacyPage = source('src/app/admin/minha-conta/seguranca/page.tsx')
const menu = source('src/components/auth/sidebar.tsx')
const sharedPage = source('src/components/auth/security-page.tsx')
const passwordActions = source('src/app/actions/password.ts')
const mfaActions = source('src/app/actions/mfa.ts')
const adminUserActions = source('src/app/admin/usuarios/actions.ts')
const gestorPage = source('src/app/gestor/minha-conta/seguranca/page.tsx')

describe('SA4 - Minha Seguranca do Super Admin', () => {
  it('protege a rota canonica com requireSuperAdmin e nao depende de fundo', () => {
    expect(page).toContain('await requireSuperAdmin()')
    expect(page).toContain('<SecurityPage />')
    expect(page).not.toMatch(/usuario_fundos|fundoAtivo|resolverContextoFundo/i)
    expect(legacyPage).toContain("redirect('/admin/minha-seguranca')")
  })

  it('preserva a entrada de seguranca no menu Admin ampliado', () => {
    const adminMenu = menu.slice(menu.indexOf('export const adminMenuItems'))
    expect(adminMenu).toContain("href: '/admin/minha-seguranca'")
    expect((adminMenu.match(/href:/g) || [])).toHaveLength(5)
  })

  it('reutiliza o mesmo nucleo visual e a mesma conta do Gestor', () => {
    expect(page).toContain("@/components/auth/security-page")
    expect(gestorPage).toContain("@/components/auth/security-page")
    expect(sharedPage).toContain('alterarSenhaAutenticado')
    expect(sharedPage).toContain('regenerarCodigosRecuperacao')
    expect(sharedPage).toContain('encerrarOutrasSessoes')
  })

  it('deriva sempre o alvo da sessao e exige TOTP fresco nas mutacoes proprias', () => {
    const passwordChange = passwordActions.slice(passwordActions.indexOf('export async function alterarSenhaAutenticado'), passwordActions.indexOf('export async function solicitarNonceAlteracaoSenha'))
    const recovery = mfaActions.slice(mfaActions.indexOf('export async function regenerarCodigosRecuperacao'), mfaActions.indexOf('export async function desativarMfaProprio'))
    const sessions = mfaActions.slice(mfaActions.indexOf('export async function encerrarOutrasSessoes'), mfaActions.indexOf('export async function listarFatoresMfa'))

    expect(passwordChange).toContain("autorizarEConsumirAcaoSensivel(context, 'alterar_senha', mfaCode)")
    expect(passwordChange).toContain('context.user.id')
    expect(passwordChange).not.toMatch(/formData\.get\(['\"]userId/)
    expect(recovery).toContain("autorizarEConsumirAcaoSensivel(context, 'regenerar_recovery_codes', mfaCode)")
    expect(sessions).toContain("autorizarEConsumirAcaoSensivel(context, 'encerrar_outras_sessoes', mfaCode)")
  })

  it('preserva a janela AAL2, a reautenticacao formal e o payload oficial de senha', () => {
    expect(sharedPage).toContain('estado.serverNow')
    expect(sharedPage).toContain('estado.sessaoExpiraEm')
    expect(passwordActions).toContain('reautenticarSenhaAtual(email, currentPassword)')
    expect(passwordActions).toContain('auth.updateUser(criarAtributosUpdateSenha(password, nonce))')
    expect(passwordActions).not.toContain('updateUser({ password, currentPassword')
  })

  it('exibe somente metadados seguros da propria conta', () => {
    expect(mfaActions).toContain('status: context.profile.status')
    expect(mfaActions).toContain('mfaConfiguradoEm: context.profile.mfa_ativado_em')
    expect(mfaActions).toContain('senhaAlteradaEm: context.profile.senha_alterada_em')
    expect(sharedPage).toContain('MFA configurado em')
    expect(sharedPage).toContain('Ultima alteracao de senha em')
  })

  it('mantem o self-reset administrativo bloqueado e nao oferece desativacao propria', () => {
    expect(adminUserActions).toContain('O reset administrativo do proprio MFA esta bloqueado. Use Minha Seguranca.')
    expect(sharedPage).not.toContain('desativarMfaProprio')
    expect(sharedPage).toContain('Obrigatorio pela politica')
  })

  it('explicita submit no formulario de senha para evitar regressao do Base UI', () => {
    expect(sharedPage).toContain('<Button type="submit"')
  })
})
