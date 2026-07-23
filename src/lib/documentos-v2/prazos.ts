export type StatusPrazoDocumento = 'nao_iniciado' | 'dentro_do_prazo' | 'vence_hoje' | 'vencido' | 'concluido'

export interface PrazoDocumentoCalculado {
  statusPrazo: StatusPrazoDocumento
  prazoTexto: string | null
  prazoDetalhe: string | null
  prazoDias: number | null
  marcoPrazo: string | null
  dataInicioPrazo: string | null
  dataLimite: string | null
}

function toDateOnlyUtc(value: string | Date): Date {
  if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
  const [date] = value.split('T')
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export function differenceInCalendarDays(date: string | Date, base: string | Date): number {
  return Math.round((toDateOnlyUtc(date).getTime() - toDateOnlyUtc(base).getTime()) / 86400000)
}

export function calcularPrazoDocumento(input: {
  status: string
  prazoLimite: string | null
  dataInicioPrazo: string | null
  hoje?: string | Date
  marco?: string
}): PrazoDocumentoCalculado {
  const marcoPrazo = input.dataInicioPrazo ? (input.marco || 'desembolso') : null
  if (input.status === 'satisfeito') {
    return {
      statusPrazo: 'concluido',
      prazoTexto: 'Concluido',
      prazoDetalhe: null,
      prazoDias: null,
      marcoPrazo,
      dataInicioPrazo: input.dataInicioPrazo,
      dataLimite: input.prazoLimite,
    }
  }

  if (!input.dataInicioPrazo || !input.prazoLimite) {
    return {
      statusPrazo: 'nao_iniciado',
      prazoTexto: null,
      prazoDetalhe: null,
      prazoDias: null,
      marcoPrazo,
      dataInicioPrazo: input.dataInicioPrazo,
      dataLimite: input.prazoLimite,
    }
  }

  const diff = differenceInCalendarDays(input.prazoLimite, input.hoje || new Date())
  return {
    statusPrazo: diff < 0 ? 'vencido' : diff === 0 ? 'vence_hoje' : 'dentro_do_prazo',
    prazoTexto: `Enviar ate ${input.prazoLimite}`,
    prazoDetalhe: diff < 0
      ? `Em atraso ha ${Math.abs(diff)} dia(s)`
      : diff === 0
        ? 'Vence hoje'
        : `Restam ${diff} dia(s)`,
    prazoDias: Math.max(0, differenceInCalendarDays(input.prazoLimite, input.dataInicioPrazo)),
    marcoPrazo,
    dataInicioPrazo: input.dataInicioPrazo,
    dataLimite: input.prazoLimite,
  }
}
