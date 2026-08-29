export const LIMITE_PADRAO_POSTERGACAO_CANHOTO_DIAS = 5

export type ConfiguracaoPostergacaoCanhoto = {
  permite: boolean
  limiteDias: number | null
}

export type StatusPrazoUploadCanhoto =
  | 'sem_prazo'
  | 'pendente'
  | 'vence_hoje'
  | 'vencido'
  | 'atendido_no_prazo'
  | 'atendido_em_atraso'

export type AvaliacaoPostergacaoCanhoto = {
  permitida: boolean
  motivoBloqueio: string | null
  limiteDiasAplicado: number | null
  dataMinima: string | null
  dataMaxima: string | null
}

type SnapshotRequirement = {
  ativo?: boolean
  obrigatorio?: boolean
  escopo?: string
  codigo?: string
  tipo_documento_codigo?: string
}

type SnapshotLike = {
  permite_postergacao_upload_canhoto?: unknown
  limite_postergacao_upload_canhoto_dias?: unknown
  requisitos?: SnapshotRequirement[]
} | null | undefined

function normalizeDocumentCode(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function addCalendarDays(value: string, days: number): string | null {
  const date = parseDateOnly(value)
  if (!date || !Number.isInteger(days)) return null
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function snapshotExigeCanhoto(snapshot: SnapshotLike): boolean {
  return (snapshot?.requisitos ?? []).some((requirement) => {
    const code = normalizeDocumentCode(requirement.tipo_documento_codigo ?? requirement.codigo)
    return requirement.ativo !== false
      && requirement.obrigatorio === true
      && ['pos_cessao', 'entrega'].includes(requirement.escopo ?? '')
      && ['canhoto', 'comprovante_entrega'].includes(code)
  })
}

export function resolverConfiguracaoPostergacaoCanhoto(snapshot: SnapshotLike): ConfiguracaoPostergacaoCanhoto {
  if (snapshot?.permite_postergacao_upload_canhoto !== true) {
    return { permite: false, limiteDias: null }
  }

  const configuredLimit = snapshot.limite_postergacao_upload_canhoto_dias
  if (configuredLimit === null || configuredLimit === undefined || configuredLimit === '') {
    return { permite: true, limiteDias: LIMITE_PADRAO_POSTERGACAO_CANHOTO_DIAS }
  }

  const parsed = Number(configuredLimit)
  if (!Number.isInteger(parsed) || parsed <= 0) return { permite: false, limiteDias: null }
  return { permite: true, limiteDias: parsed }
}

export function avaliarPossibilidadePostergacaoCanhoto(input: {
  snapshot: SnapshotLike
  prazoOriginal: string | null
  hoje: string
  postergacaoJaUtilizada: boolean
  primeiroUploadEm: string | null
  notaCedida: boolean
}): AvaliacaoPostergacaoCanhoto {
  if (!input.notaCedida) return bloquear('A nota fiscal ainda não foi cedida.')
  if (!snapshotExigeCanhoto(input.snapshot)) return bloquear('O canhoto não é obrigatório no snapshot desta operação.')

  const config = resolverConfiguracaoPostergacaoCanhoto(input.snapshot)
  if (!config.permite || !config.limiteDias) return bloquear('A política registrada na operação não permite postergação.')
  if (input.postergacaoJaUtilizada) return bloquear('A nova previsão já foi informada para esta nota fiscal.', config.limiteDias)
  if (input.primeiroUploadEm) return bloquear('O primeiro upload do canhoto já foi realizado.', config.limiteDias)
  if (!input.prazoOriginal || !parseDateOnly(input.prazoOriginal) || !parseDateOnly(input.hoje)) {
    return bloquear('O prazo original do canhoto não está disponível.', config.limiteDias)
  }

  const originalPlusOne = addCalendarDays(input.prazoOriginal, 1)
  const dataMaxima = addCalendarDays(input.prazoOriginal, config.limiteDias)
  if (!originalPlusOne || !dataMaxima) return bloquear('Não foi possível calcular a janela de postergação.', config.limiteDias)
  if (input.hoje > dataMaxima) return bloquear('O prazo máximo para informar a nova previsão já foi ultrapassado.', config.limiteDias, input.hoje, dataMaxima)

  return {
    permitida: true,
    motivoBloqueio: null,
    limiteDiasAplicado: config.limiteDias,
    dataMinima: input.hoje > originalPlusOne ? input.hoje : originalPlusOne,
    dataMaxima,
  }
}

function bloquear(
  motivoBloqueio: string,
  limiteDiasAplicado: number | null = null,
  dataMinima: string | null = null,
  dataMaxima: string | null = null,
): AvaliacaoPostergacaoCanhoto {
  return { permitida: false, motivoBloqueio, limiteDiasAplicado, dataMinima, dataMaxima }
}

export function calcularStatusPrazoUploadCanhoto(input: {
  prazo: string | null
  hoje: string
  primeiroUploadEm: string | null
}): StatusPrazoUploadCanhoto {
  if (!input.prazo || !parseDateOnly(input.prazo) || !parseDateOnly(input.hoje)) return 'sem_prazo'
  const uploadDate = input.primeiroUploadEm?.slice(0, 10) ?? null
  if (uploadDate) return uploadDate <= input.prazo ? 'atendido_no_prazo' : 'atendido_em_atraso'
  if (input.hoje === input.prazo) return 'vence_hoje'
  return input.hoje > input.prazo ? 'vencido' : 'pendente'
}

export function validarNovaPrevisaoCanhoto(input: {
  novaPrevisao: string
  prazoOriginal: string
  hoje: string
  dataMinima: string
  dataMaxima: string
}): string | null {
  if (!parseDateOnly(input.novaPrevisao)) return 'Informe uma data válida.'
  if (input.novaPrevisao <= input.prazoOriginal) return 'A nova previsão deve ser posterior ao prazo original.'
  if (input.novaPrevisao < input.hoje) return 'A nova previsão não pode estar no passado.'
  if (input.novaPrevisao < input.dataMinima || input.novaPrevisao > input.dataMaxima) {
    return `A nova previsão deve estar entre ${input.dataMinima} e ${input.dataMaxima}.`
  }
  return null
}
