import { AlertTriangle, Gauge, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  classificacaoExposicaoLabel,
  statusExposicaoDashboardLabel,
  type VisaoExposicaoOperacional,
} from '@/lib/financeiro/risco/visao-operacional'
import { cn, formatCurrency, formatDate } from '@/lib/utils'

const tone = {
  ABAIXO_LIMITE: 'border-success/35 bg-success/10 text-success-foreground',
  NO_LIMITE: 'border-warning/35 bg-warning/10 text-warning-foreground',
  ACIMA_LIMITE: 'border-destructive/35 bg-destructive/10 text-destructive',
  INDETERMINADA: 'border-muted-foreground/25 bg-muted text-muted-foreground',
} as const

function money(value: number | null) {
  return value === null ? '—' : formatCurrency(value)
}

function percent(value: number | null) {
  return value === null ? '—' : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`
}

function Item({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background px-3 py-2.5">
      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground" title={label}>{label}</p>
      <p className={cn('mt-1 truncate font-semibold tabular-nums', emphasize && 'text-primary')} title={value}>{value}</p>
    </div>
  )
}

export function ExposicaoLogisticaCard({
  visao,
  variante,
}: {
  visao: VisaoExposicaoOperacional
  variante: 'gestor-operacao' | 'cedente-operacao' | 'cedente-dashboard'
}) {
  const dashboard = variante === 'cedente-dashboard'
  const title = dashboard
    ? 'Exposição logística do fundo'
    : variante === 'gestor-operacao'
      ? 'Exposição logística do fundo'
      : 'Impacto desta operação na exposição'
  const status = dashboard
    ? statusExposicaoDashboardLabel[visao.statusDashboard]
    : classificacaoExposicaoLabel[visao.classificacao]

  return (
    <Card data-testid={`exposicao-logistica-${variante}`}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base"><Gauge size={18} /> {title}</CardTitle>
            {visao.fundoNome && <p className="mt-1 truncate text-sm text-muted-foreground" title={visao.fundoNome}>{visao.fundoNome}</p>}
          </div>
          <Badge variant="outline" className={tone[visao.classificacao]}>{status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={cn('grid gap-2 sm:grid-cols-2', dashboard ? 'lg:grid-cols-4' : 'xl:grid-cols-4')}>
          <Item label="PL base" value={money(visao.patrimonioLiquido)} />
          <Item label="Data-base" value={visao.dataBasePl ? formatDate(visao.dataBasePl) : '—'} />
          <Item label="Exposição atual" value={`${money(visao.exposicaoAtualValor)} · ${percent(visao.exposicaoAtualPct)}`} />
          {!dashboard && <Item label="VP candidato" value={money(visao.candidatoValor)} emphasize />}
          {!dashboard && <Item label="Exposição projetada" value={`${money(visao.exposicaoProjetadaValor)} · ${percent(visao.exposicaoProjetadaPct)}`} emphasize />}
          <Item label="Limite da política" value={percent(visao.limitePct)} />
          <Item label="Margem disponível" value={`${money(visao.margemValor)} · ${visao.margemPct === null ? '—' : `${visao.margemPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} p.p.`}`} />
        </div>
        {visao.motivo && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{visao.motivo}</p>
          </div>
        )}
        {!dashboard && visao.exposicaoAtualPct !== null && visao.exposicaoProjetadaPct !== null && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingUp size={14} aria-hidden="true" />
            Com a aprovação, a exposição passa de {percent(visao.exposicaoAtualPct)} para {percent(visao.exposicaoProjetadaPct)}.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
