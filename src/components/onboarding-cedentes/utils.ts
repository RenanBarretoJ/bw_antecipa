import type {
  CedenteBase,
  CedenteFundoResumo,
  EtapaOnboarding,
  FundoResumo,
  OnboardingCedente,
  OrdenacaoOnboarding,
  PoliticaResumo,
  PoliticaVersaoResumo,
  PoliticaVinculoResumo,
  RequisitoResumo,
} from './types'

export const ETAPAS: Array<{ key: EtapaOnboarding; label: string }> = [
  { key: 'pendencias', label: 'Pendencias' },
  { key: 'sem_fundo', label: 'Sem fundo' },
  { key: 'sem_politica', label: 'Sem politica' },
  { key: 'aptos', label: 'Aptos' },
  { key: 'suspensos', label: 'Suspensos' },
  { key: 'todos', label: 'Todos' },
]

export function formatCnpj(cnpj: string) {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14) return cnpj
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

export function shortName(value: string | null | undefined, max = 34) {
  const text = (value || '').trim()
  if (!text) return 'Nao informado'
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}

export function etapaFromStatus(status: OnboardingCedente['onboardingStatus']): EtapaOnboarding {
  if (status === 'aguardando_vinculo_fundo') return 'sem_fundo'
  if (status === 'aguardando_politica') return 'sem_politica'
  if (status === 'apto_operar') return 'aptos'
  return 'suspensos'
}

function versaoVigente(version: PoliticaVersaoResumo, now: string) {
  return version.status === 'publicada'
    && Boolean(version.publicada_em)
    && version.vigente_desde <= now
    && (!version.vigente_ate || version.vigente_ate > now)
}

export function montarCedentesOnboarding(input: {
  cedentes: CedenteBase[]
  links: CedenteFundoResumo[]
  fundos: FundoResumo[]
  vinculosPolitica: PoliticaVinculoResumo[]
  politicas: PoliticaResumo[]
  versoes: PoliticaVersaoResumo[]
  requisitos: RequisitoResumo[]
}): OnboardingCedente[] {
  const now = new Date().toISOString()
  return input.cedentes.map((cedente) => {
    const cedenteLinks = input.links.filter((link) => link.cedente_id === cedente.id)
    const activeLinks = cedenteLinks.filter((link) => link.status === 'ativo')
    const suspendedLinks = cedenteLinks.filter((link) => link.status === 'suspenso')

    let politicaPrincipal: PoliticaResumo | null = null
    let versaoPrincipal: PoliticaVersaoResumo | null = null
    let fundoPrincipal: FundoResumo | null = null

    for (const link of activeLinks) {
      const vinculo = input.vinculosPolitica.find((item) =>
        item.cedente_fundo_id === link.id
        && item.status === 'ativa'
        && item.vigente_desde <= now
        && (!item.vigente_ate || item.vigente_ate > now)
      )
      if (!vinculo) continue
      const politica = input.politicas.find((item) => item.id === vinculo.politica_operacional_id && item.status === 'ativa') || null
      const versao = input.versoes
        .filter((item) => item.politica_operacional_id === vinculo.politica_operacional_id && versaoVigente(item, now))
        .sort((a, b) => b.versao - a.versao)[0] || null
      if (politica && versao) {
        politicaPrincipal = politica
        versaoPrincipal = versao
        fundoPrincipal = input.fundos.find((fundo) => fundo.id === link.fundo_id) || null
        break
      }
    }

    if (!fundoPrincipal && activeLinks.length > 0) {
      fundoPrincipal = input.fundos.find((fundo) => fundo.id === activeLinks[0].fundo_id) || null
    }

    const onboardingStatus = activeLinks.length === 0
      ? (suspendedLinks.length > 0 ? 'suspenso' : 'aguardando_vinculo_fundo')
      : (politicaPrincipal && versaoPrincipal ? 'apto_operar' : 'aguardando_politica')

    const requisitoCount = versaoPrincipal
      ? input.requisitos.filter((req) => req.politica_operacional_versao_id === versaoPrincipal.id).length
      : 0

    return {
      ...cedente,
      onboardingStatus,
      activeLinks,
      suspendedLinks,
      fundoPrincipal,
      politicaPrincipal,
      versaoPrincipal,
      requisitoCount,
    }
  })
}

export function filtrarCedentes(input: {
  rows: OnboardingCedente[]
  etapa: EtapaOnboarding
  busca: string
  fundoId: string
  politicaId: string
  status: string
  ordenar: OrdenacaoOnboarding
}) {
  const query = input.busca.trim().toLowerCase()
  const queryDigits = query.replace(/\D/g, '')
  const filtered = input.rows.filter((row) => {
    const etapa = etapaFromStatus(row.onboardingStatus)
    if (input.etapa === 'pendencias' && etapa !== 'sem_fundo' && etapa !== 'sem_politica') return false
    if (input.etapa !== 'pendencias' && input.etapa !== 'todos' && etapa !== input.etapa) return false
    if (input.fundoId !== 'todos' && !row.activeLinks.some((link) => link.fundo_id === input.fundoId)) return false
    if (input.politicaId !== 'todos' && row.politicaPrincipal?.id !== input.politicaId) return false
    if (input.status !== 'todos' && row.status !== input.status) return false
    if (query) {
      const text = `${row.razao_social} ${row.nome_fantasia || ''} ${row.cnpj}`.toLowerCase()
      const cnpj = row.cnpj.replace(/\D/g, '')
      if (!text.includes(query) && (!queryDigits || !cnpj.includes(queryDigits))) return false
    }
    return true
  })

  return filtered.sort((a, b) => {
    if (input.ordenar === 'razao_social') return a.razao_social.localeCompare(b.razao_social)
    if (input.ordenar === 'mais_antigo') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}
