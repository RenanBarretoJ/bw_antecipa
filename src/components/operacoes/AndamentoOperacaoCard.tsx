'use client'

import { CalendarDays, CheckCircle2, Clock3, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { construirEtapasOperacao, type EtapaOperacao, type CapabilitiesOperacao, type DocumentoOperacaoParaPolitica, type LogisticaOperacaoParaPolitica, type OperacaoParaPolitica } from '@/lib/operacoes/politica-operacao'

const classes = {
  concluida: 'border-success/40 bg-success/10 text-success-foreground',
  atual: 'border-primary/40 bg-primary/10 text-primary',
  pendente: 'border-border bg-muted/40 text-muted-foreground',
  bloqueada: 'border-destructive/35 bg-destructive/10 text-destructive',
  rejeitada: 'border-destructive/35 bg-destructive/10 text-destructive',
}

function iconFor(status: EtapaOperacao['status']) {
  if (status === 'concluida') return <CheckCircle2 size={16} />
  if (status === 'rejeitada' || status === 'bloqueada') return <XCircle size={16} />
  if (status === 'atual') return <Clock3 size={16} />
  return <CalendarDays size={16} />
}

export function AndamentoOperacaoCard({
  operacao,
  capacidades,
  documentos,
  logistica,
  compact = false,
}: {
  operacao: OperacaoParaPolitica
  capacidades: CapabilitiesOperacao
  documentos: DocumentoOperacaoParaPolitica[]
  logistica: LogisticaOperacaoParaPolitica[]
  compact?: boolean
}) {
  const etapas = construirEtapasOperacao({ operacao, capacidades, documentos, logistica })

  return (
    <Card>
      <CardHeader className={compact ? 'pb-3' : undefined}>
        <CardTitle className="flex items-center gap-2"><Clock3 size={18} /> Andamento da operação</CardTitle>
      </CardHeader>
      <CardContent className={compact ? 'pt-0' : undefined}>
        <ol className="space-y-3">
          {etapas.map((step) => (
            <li key={step.id} className={`flex items-start gap-3 rounded-xl border p-3 ${classes[step.status]}`}>
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-background/70">
                {iconFor(step.status)}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{step.titulo}</p>
                <p className="text-xs opacity-80">{step.data ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(step.data)) : step.descricao}</p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
