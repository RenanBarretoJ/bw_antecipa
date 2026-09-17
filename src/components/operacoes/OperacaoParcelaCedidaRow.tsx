import { formatCurrency, formatDate } from '@/lib/utils'

export interface ParcelaCedidaOperacao {
  parcelaId: string
  numeroParcela: number
  dataVencimento: string
  valorNominal: number
  diasAplicados: number | null
  valorPresente: number | null
  desconto: number | null
}

export const PARCELA_CEDIDA_COLUNAS = [
  'Parcela',
  'Vencimento',
  'Valor nominal',
  'Prazo',
  'Antecipado (VP)',
  'Desconto',
] as const

export function OperacaoParcelaCedidaRow({ parcela }: { parcela: ParcelaCedidaOperacao }) {
  const numero = String(parcela.numeroParcela).padStart(3, '0')
  const valores = [
    numero,
    formatDate(parcela.dataVencimento),
    formatCurrency(parcela.valorNominal),
    parcela.diasAplicados !== null ? `${parcela.diasAplicados} dias` : '—',
    parcela.valorPresente !== null ? formatCurrency(parcela.valorPresente) : '—',
    parcela.desconto !== null ? formatCurrency(parcela.desconto) : '—',
  ]

  return (
    <dl aria-label={`Parcela ${numero}`} className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 px-3 py-2 text-xs md:grid-cols-[3.5rem_6rem_7rem_5rem_7rem_7rem] md:gap-2">
      {PARCELA_CEDIDA_COLUNAS.map((label, index) => (
        <div key={label} className="min-w-0">
          <dt className="text-[11px] font-medium text-muted-foreground md:sr-only">{label === 'Prazo' ? 'Prazo aplicado' : label}</dt>
          <dd className={`m-0 min-w-0 tabular-nums ${index === 0 ? 'font-mono' : ''}`}>{valores[index]}</dd>
        </div>
      ))}
    </dl>
  )
}
