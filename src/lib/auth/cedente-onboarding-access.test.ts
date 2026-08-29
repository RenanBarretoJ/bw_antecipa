import { describe, expect, it } from 'vitest'
import {
  isCedenteAprovado,
  isCedentePathPermitidoDuranteOnboarding,
  resolverRedirectOnboardingCedente,
} from './cedente-onboarding-access'

describe('gate de onboarding do cedente', () => {
  it('considera somente o cadastro ativo como aprovado', () => {
    expect(isCedenteAprovado('ativo')).toBe(true)
    expect(isCedenteAprovado('pendente')).toBe(false)
    expect(isCedenteAprovado('reprovado')).toBe(false)
    expect(isCedenteAprovado('suspenso')).toBe(false)
    expect(isCedenteAprovado(null)).toBe(false)
  })

  it.each([
    '/cedente/cadastro',
    '/cedente/documentos',
    '/cedente/notificacoes',
    '/cedente/minha-conta/seguranca',
  ])('permite %s durante o onboarding', (pathname) => {
    expect(isCedentePathPermitidoDuranteOnboarding(pathname)).toBe(true)
    expect(resolverRedirectOnboardingCedente({ pathname, status: 'pendente' })).toBeNull()
  })

  it.each([
    '/cedente/dashboard',
    '/cedente/notas-fiscais',
    '/cedente/notas-fiscais/nota-1',
    '/cedente/operacoes',
    '/cedente/operacoes/nova',
    '/cedente/extrato',
  ])('redireciona %s para o cadastro enquanto nao aprovado', (pathname) => {
    expect(resolverRedirectOnboardingCedente({ pathname, status: null })).toBe('/cedente/cadastro')
    expect(resolverRedirectOnboardingCedente({ pathname, status: 'pendente' })).toBe('/cedente/cadastro')
  })

  it('libera todas as rotas do portal quando o cedente esta ativo', () => {
    expect(resolverRedirectOnboardingCedente({
      pathname: '/cedente/notas-fiscais',
      status: 'ativo',
    })).toBeNull()
  })
})
