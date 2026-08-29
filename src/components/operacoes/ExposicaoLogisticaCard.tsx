import { AlertTriangle, Gauge, Loader2, TrendingUp } from 'lucide-react'
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

function ContextItem({
  label,
  value,
  truncate,
}: {
  label: string
  value: string
  truncate?: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn('mt-0.5 text-sm font-semibold tabular-nums', truncate && 'truncate')}
        title={truncate ? value : undefined}
      >
        {value}
      </p>
    </div>
  )
}

function ProformaMetric({
  label,
  value,
  detail,
  priority,
}: {
  label: string
  value: string
  detail?: string
  priority?: 'primary' | 'secondary'
}) {
  return (
    <div className={cn(
      'min-w-0 rounded-lg border px-3 py-3',
      priority === 'primary' && 'border-primary/40 bg-primary/10',
      priority === 'secondary' && 'border-border bg-muted/35',
    )}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 break-words text-base font-semibold leading-tight tabular-nums',
        priority === 'primary' && 'text-primary',
      )}>
        {value}
      </p>
      {detail && <p className="mt-1 text-sm font-medium tabular-nums text-muted-foreground">{detail}</p>}
    </div>
  )
}

function ProformaCard({
  visao,
  status,
  alerta,
  atualizando,
}: {
  visao: ProformaExposicaoSelecao
  status: string
  alerta: string | null
  atualizando: boolean
}) {
  const exposicaoProjetada = visao.exposicaoProjetadaValor === null || visao.exposicaoProjetadaPct === null
    ? { value: 'Indeterminada', detail: undefined }
    : { value: money(visao.exposicaoProjetadaValor), detail: percent(visao.exposicaoProjetadaPct) }
  const margem = visao.margemValor === null || visao.margemPct === null
    ? { value: 'Indisponível', detail: undefined }
    : {
        value: money(visao.margemValor),
        detail: `${visao.margemPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} p.p.`,
      }

  return (
    <Card data-testid="exposicao-logistica-proforma-solicitacao">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge size={18} /> Impacto estimado na exposição
            </CardTitle>
            {visao.fundoNome && (
              <p className="mt-1 truncate text-sm text-muted-foreground" title={visao.fundoNome}>{visao.fundoNome}</p>
            )}
          </div>
          <Badge variant="outline" className={tone[visao.classificacao]}>{status}</Badge>
        </div>
        <div className="min-h-5" aria-live="polite">
          {atualizando && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Atualizando impacto...
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/25 p-3 sm:grid-cols-2">
          <ContextItem label="PL de referência" value={money(visao.patrimonioLiquido)} />
          <ContextItem label="Data-base" value={visao.dataBasePl ? formatDate(visao.dataBasePl) : 'Indisponível'} />
          <ContextItem label="Defasagem" value={visao.defasagemPl || 'Indisponível'} />
          <ContextItem label="Origem" value={visao.origemPl || 'Indisponível'} truncate />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ProformaMetric
            label="Exposição atual"
            value={money(visao.exposicaoAtualValor)}
            detail={percent(visao.exposicaoAtualPct)}
          />
          <ProformaMetric
            label="Seleção"
            value={`${visao.quantidadeNfs} NF${visao.quantidadeNfs === 1 ? '' : 's'}`}
            detail={`${visao.quantidadeParcelas} parcela${visao.quantidadeParcelas === 1 ? '' : 's'}`}
          />
          <ProformaMetric
            label="Operação candidata"
            value={money(visao.candidatoValor)}
            detail={percent(visao.candidatoPct)}
          />
          <ProformaMetric
            label="Exposição projetada"
            value={exposicaoProjetada.value}
            detail={exposicaoProjetada.detail}
            priority="primary"
          />
          <ProformaMetric
            label="Limite da política"
            value={percent(visao.limitePct)}
            priority="secondary"
          />
          <ProformaMetric
            label="Margem disponível"
            value={margem.value}
            detail={margem.detail}
            priority="secondary"
          />
        </div>

        {alerta && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{alerta}</p>
          </div>
        )}
        {visao.exposicaoAtualPct !== null && visao.exposicaoProjetadaPct !== null && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <TrendingUp className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Com a aprovação, a exposição passa de {percent(visao.exposicaoAtualPct)} para{' '}
              <strong className="font-semibold text-foreground">{percent(visao.exposicaoProjetadaPct)}</strong>.
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function ExposicaoLogisticaCard({
  visao,
  variante,
  atualizando = false,
}: {
  visao: VisaoExposicaoOperacional
  variante:
    | 'gestor-operacao'
    | 'cedente-operacao'
    | 'cedente-dashboard'
    | 'gestor-listagem'
    | 'cedente-listagem'
    | 'proforma-solicitacao'
  atualizando?: boolean
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

  if (proforma) {
    return (
      <ProformaCard
        visao={proforma}
        status={status}
        alerta={alerta}
        atualizando={atualizando}
      />
    )
  }

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
          {!resumoFundo && <Item label="Operação candidata" value={`${money(visao.candidatoValor)} · ${percent(visao.candidatoPct)}`} emphasize />}
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
