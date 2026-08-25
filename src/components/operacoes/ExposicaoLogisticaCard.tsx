import { AlertTriangle, Gauge, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  classificacaoExposicaoLabel,
  statusExposicaoDashboardLabel,
  type ProformaExposicaoSelecao,
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
  return value === null ? 'Indisponível' : formatCurrency(value)
}

function percent(value: number | null) {
  return value === null ? 'Indisponível' : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`
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
  variante:
    | 'gestor-operacao'
    | 'cedente-operacao'
    | 'cedente-dashboard'
    | 'gestor-listagem'
    | 'cedente-listagem'
    | 'proforma-solicitacao'
}) {
  const resumoFundo = ['cedente-dashboard', 'gestor-listagem', 'cedente-listagem'].includes(variante)
  const proforma = variante === 'proforma-solicitacao'
    ? visao as ProformaExposicaoSelecao
    : null
  const title = resumoFundo
    ? 'Exposição logística do fundo'
    : proforma
      ? 'Impacto estimado na exposição'
      : 'Impacto na exposição logística'
  const status = resumoFundo
    ? statusExposicaoDashboardLabel[visao.statusDashboard]
    : classificacaoExposicaoLabel[visao.classificacao]
  const alerta = visao.classificacao === 'ACIMA_LIMITE' && proforma
    ? 'A exposição projetada ultrapassa o limite da política. Esta solicitação poderá ser bloqueada na análise.'
    : visao.motivo

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
        <div className={cn('grid gap-2 sm:grid-cols-2', resumoFundo ? 'lg:grid-cols-4' : 'xl:grid-cols-4')}>
          <Item label="PL de referência" value={money(visao.patrimonioLiquido)} />
          <Item label="Data-base" value={visao.dataBasePl ? formatDate(visao.dataBasePl) : 'Indisponível'} />
          <Item label="Defasagem" value={visao.defasagemPl || 'Indisponível'} />
          <Item label="Origem" value={visao.origemPl || 'Indisponível'} />
          <Item label="Exposição atual" value={`${money(visao.exposicaoAtualValor)} · ${percent(visao.exposicaoAtualPct)}`} />
          {proforma && <Item label="NFs selecionadas" value={String(proforma.quantidadeNfs)} />}
          {proforma && <Item label="Parcelas selecionadas" value={String(proforma.quantidadeParcelas)} />}
          {!resumoFundo && <Item label={proforma ? 'Valor candidato' : 'Operação candidata'} value={`${money(visao.candidatoValor)} · ${percent(visao.candidatoPct)}`} emphasize />}
          {!resumoFundo && <Item label="Exposição projetada" value={visao.exposicaoProjetadaValor === null || visao.exposicaoProjetadaPct === null ? 'Indeterminada' : `${money(visao.exposicaoProjetadaValor)} · ${percent(visao.exposicaoProjetadaPct)}`} emphasize />}
          <Item label="Limite da política" value={percent(visao.limitePct)} />
          <Item label="Margem disponível" value={visao.margemValor === null || visao.margemPct === null ? 'Indisponível' : `${money(visao.margemValor)} · ${visao.margemPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} p.p.`} />
        </div>
        {alerta && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{alerta}</p>
          </div>
        )}
        {!resumoFundo && visao.exposicaoAtualPct !== null && visao.exposicaoProjetadaPct !== null && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingUp size={14} aria-hidden="true" />
            Com a aprovação, a exposição passa de {percent(visao.exposicaoAtualPct)} para {percent(visao.exposicaoProjetadaPct)}.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
