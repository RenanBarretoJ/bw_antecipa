const CEDENTE_PATHS_PERMITIDOS_DURANTE_ONBOARDING = [
  '/cedente/cadastro',
  '/cedente/documentos',
  '/cedente/notificacoes',
  '/cedente/minha-conta/seguranca',
] as const

export function isCedenteAprovado(status: string | null | undefined): boolean {
  return status === 'ativo'
}

export function isCedentePathPermitidoDuranteOnboarding(pathname: string): boolean {
  return CEDENTE_PATHS_PERMITIDOS_DURANTE_ONBOARDING.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  )
}

export function resolverRedirectOnboardingCedente({
  pathname,
  status,
}: {
  pathname: string
  status: string | null | undefined
}): string | null {
  if (isCedenteAprovado(status) || isCedentePathPermitidoDuranteOnboarding(pathname)) {
    return null
  }

  return '/cedente/cadastro'
}
