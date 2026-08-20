'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, Receipt } from 'lucide-react'
import {
  analisarBoletoDaParcela,
  enviarBoletoDaParcela,
  listarBeneficiariosElegiveisDaNota,
  listarParcelasBoletosDaNota,
  type ParcelaBoletoItem,
} from '@/lib/actions/parcelas-nf'
import { baixarVersaoDocumento } from '@/lib/actions/documento-v2'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/data-display/primitives'
import { formatCurrency, formatDate } from '@/lib/utils'

type Mode = 'cedente' | 'gestor'
type Beneficiario = { id: string; razaoSocial: string; cnpj: string; tipo: string }

const boletoStatusLabel: Record<string, string> = {
  pendente: 'Aguardando envio',
  enviado: 'Aguardando analise',
  em_analise: 'Aguardando analise',
  satisfeito: 'Aprovado',
  rejeitado: 'Rejeitado',
  requer_ajuste: 'Ajuste solicitado',
  vencido: 'Vencido',
  dispensado: 'Dispensado',
  cancelado: 'Cancelado',
}

const PENDENCIA_STATUS = new Set(['rejeitado', 'requer_ajuste'])

function statusAgregado(items: ParcelaBoletoItem[]): 'completo' | 'com_pendencias' | 'aguardando_analise' | 'pendente' {
  if (items.every((item) => item.status === 'satisfeito')) return 'completo'
  if (items.some((item) => PENDENCIA_STATUS.has(item.status))) return 'com_pendencias'
  if (items.some((item) => item.status === 'em_analise')) return 'aguardando_analise'
  return 'pendente'
}

const statusAgregadoConfig: Record<string, { label: string; tone: string }> = {
  completo: { label: 'Completo', tone: 'bg-success/15 text-success-foreground' },
  com_pendencias: { label: 'Com pendências', tone: 'bg-destructive/10 text-destructive' },
  aguardando_analise: { label: 'Aguardando análise', tone: 'bg-info/15 text-info-foreground' },
  pendente: { label: 'Pendente', tone: 'bg-warning/15 text-warning-foreground' },
}

function nomeBeneficiario(id: string | null, lista: Beneficiario[]) {
  if (!id) return '—'
  const encontrado = lista.find((b) => b.id === id)
  if (!encontrado) return '—'
  return `${encontrado.tipo === 'matriz' ? 'Matriz' : 'Filial'} · ${encontrado.razaoSocial}`
}

/**
 * Item compacto e recolhivel de Boleto, renderizado DENTRO do mesmo card
 * "Documentos pre-cessao" (ver ChecklistCedente) -- nao e mais um card
 * separado. So aparece quando a politica da NF realmente exige boleto
 * (items vem vazio caso contrario, ver listarParcelasBoletosDaNota).
 */
export function ParcelasBoletosNota({ notaFiscalId, mode }: { notaFiscalId: string; mode: Mode }) {
  const notifications = useNotifications()
  const [items, setItems] = useState<ParcelaBoletoItem[] | null>(null)
  const [beneficiarios, setBeneficiarios] = useState<Beneficiario[]>([])
  const [pending, setPending] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const autoExpandiuRef = useRef(false)

  const load = async () => {
    const [parcelasResult, beneficiariosResult] = await Promise.all([
      listarParcelasBoletosDaNota(notaFiscalId),
      listarBeneficiariosElegiveisDaNota(notaFiscalId),
    ])
    if (parcelasResult.success) setItems(parcelasResult.data ?? [])
    else notifications.error(parcelasResult.message)
    if (beneficiariosResult.success) setBeneficiarios(beneficiariosResult.data ?? [])
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notaFiscalId])

  // Chama atencao automaticamente na primeira carga se houver pendencia
  // (rejeicao/ajuste) -- nao interfere numa escolha manual de recolher
  // feita depois pelo usuario.
  useEffect(() => {
    if (autoExpandiuRef.current || !items) return
    autoExpandiuRef.current = true
    if (items.some((item) => PENDENCIA_STATUS.has(item.status))) setExpanded(true)
  }, [items])

  if (items === null) return null
  if (items.length === 0) return null

  const verDocumento = async (versaoId: string) => {
    const result = await baixarVersaoDocumento(versaoId)
    if (result.success && result.url) window.open(result.url, '_blank', 'noopener,noreferrer')
    else notifications.error(result.message || 'Nao foi possivel abrir o documento.')
  }

  const enviar = (formData: FormData) => {
    setPending(true)
    void enviarBoletoDaParcela(formData).then(async (result) => {
      notifications.fromActionResult(result)
      if (result.success) await load()
      setPending(false)
    })
  }

  const analisar = (formData: FormData) => {
    setPending(true)
    void analisarBoletoDaParcela(formData).then(async (result) => {
      notifications.fromActionResult(result)
      if (result.success) await load()
      setPending(false)
    })
  }

  const obrigatorio = items.some((item) => item.obrigatorio)
  const aprovados = items.filter((item) => item.status === 'satisfeito').length
  const agregado = statusAgregadoConfig[statusAgregado(items)]
  const ExpandedIcon = expanded ? ChevronUp : ChevronDown

  return (
    <article className="rounded-xl border bg-background">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full flex-col gap-2 px-3 py-2.5 text-left md:min-h-16 md:flex-row md:items-center md:justify-between"
        aria-expanded={expanded}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Receipt size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate font-semibold text-foreground">Boleto</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${obrigatorio ? 'bg-warning/15 text-warning-foreground' : 'bg-muted text-muted-foreground'}`}>
                {obrigatorio ? 'Obrigatório' : 'Opcional'}
              </span>
              <span className="text-xs text-muted-foreground">{aprovados}/{items.length} aprovados</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${agregado.tone}`}>{agregado.label}</span>
            </span>
          </span>
        </span>
        <ExpandedIcon size={15} className="shrink-0 self-end text-muted-foreground md:self-auto" />
      </button>

      {/* Renderizado sempre (apenas oculto via CSS) para nao perder selecao
          de beneficiario/arquivo ja feita ao recolher/expandir. */}
      <div className={expanded ? 'border-t border-border' : 'hidden'}>
        <div className="hidden grid-cols-[3.5rem_5.5rem_7rem_9rem_11rem_4.5rem_1fr] gap-2 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Parcela</span>
          <span>Vencimento</span>
          <span>Valor</span>
          <span>Status</span>
          <span>Beneficiário</span>
          <span>Documento</span>
          <span>Ação</span>
        </div>
        <div className="divide-y divide-border">
          {items.map((item) => {
            const podeEnviar = mode === 'cedente' && item.status !== 'satisfeito'
            const podeAnalisar = mode === 'gestor' && item.documentoVersaoId && item.status !== 'satisfeito'
            const beneficiario = nomeBeneficiario(item.beneficiarioEstabelecimentoId, beneficiarios)

            const documentoConteudo = item.documentoVersaoId ? (
              <Button type="button" size="sm" variant="outline" onClick={() => verDocumento(item.documentoVersaoId as string)}>
                Ver<ExternalLink className="ml-1 size-3" />
              </Button>
            ) : (
              <span className="text-muted-foreground">—</span>
            )

            const acaoConteudo = podeEnviar ? (
              <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); enviar(new FormData(event.currentTarget)) }}>
                <input type="hidden" name="nota_fiscal_id" value={notaFiscalId} />
                <input type="hidden" name="requisito_id" value={item.requisitoId} />
                <select name="estabelecimento_beneficiario_id" required defaultValue={item.beneficiarioEstabelecimentoId || ''} className="h-8 max-w-32 rounded-md border bg-background px-2 text-xs">
                  <option value="">Beneficiário...</option>
                  {beneficiarios.map((b) => (
                    <option key={b.id} value={b.id}>{b.tipo === 'matriz' ? 'Matriz' : 'Filial'} - {b.razaoSocial}</option>
                  ))}
                </select>
                <Input className="h-8 w-32" type="file" name="arquivo" accept="application/pdf" required />
                <Button type="submit" size="sm" variant="outline" disabled={pending}>Enviar</Button>
              </form>
            ) : podeAnalisar ? (
              <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); analisar(new FormData(event.currentTarget)) }}>
                <input type="hidden" name="nota_fiscal_id" value={notaFiscalId} />
                <input type="hidden" name="documento_versao_id" value={item.documentoVersaoId ?? undefined} />
                <Input className="h-8 w-32" name="observacoes" placeholder="Motivo (ajuste/reprova)" />
                <Button type="button" size="sm" disabled={pending} onClick={(event) => submeterAnaliseBoleto(event, 'aprovado')}>Aprovar</Button>
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={(event) => submeterAnaliseBoleto(event, 'requer_ajuste')}>Ajuste</Button>
                <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={(event) => submeterAnaliseBoleto(event, 'rejeitado')}>Reprovar</Button>
              </form>
            ) : (
              <span className="text-muted-foreground">—</span>
            )

            const statusConteudo = (
              <div className="flex flex-col gap-1">
                <StatusBadge status={item.status} label={boletoStatusLabel[item.status] || item.status} />
                {item.motivo && <span className="text-xs text-destructive">Motivo: {item.motivo}</span>}
              </div>
            )

            return (
              <div key={item.parcela.id}>
                {/* Mobile: card empilhado com rotulos, sem scroll horizontal. */}
                <div className="flex flex-col gap-2 px-3 py-3 text-sm md:hidden">
                  <div className="flex items-center justify-between">
                    <span className="font-mono tabular-nums text-muted-foreground">Parcela {String(item.parcela.numero_parcela).padStart(3, '0')}</span>
                    <span className="font-medium tabular-nums">{formatCurrency(item.parcela.valor_nominal)}</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Venc. {formatDate(item.parcela.data_vencimento)}</span>
                    {statusConteudo}
                  </div>
                  <div className="text-muted-foreground">Beneficiário: {beneficiario}</div>
                  <div className="flex flex-wrap items-center gap-2">{documentoConteudo}{acaoConteudo}</div>
                </div>

                {/* Desktop: linha de tabela. */}
                <div className="hidden grid-cols-[3.5rem_5.5rem_7rem_9rem_11rem_4.5rem_1fr] items-center gap-2 px-3 py-2.5 text-sm md:grid">
                  <span className="font-mono tabular-nums text-muted-foreground">{String(item.parcela.numero_parcela).padStart(3, '0')}</span>
                  <span className="tabular-nums">{formatDate(item.parcela.data_vencimento)}</span>
                  <span className="font-medium tabular-nums">{formatCurrency(item.parcela.valor_nominal)}</span>
                  {statusConteudo}
                  <span className="truncate text-muted-foreground" title={beneficiario}>{beneficiario}</span>
                  <span>{documentoConteudo}</span>
                  <div className="min-w-0">{acaoConteudo}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </article>
  )
}

function submeterAnaliseBoleto(event: { currentTarget: HTMLButtonElement }, resultado: 'aprovado' | 'rejeitado' | 'requer_ajuste') {
  const form = event.currentTarget.form
  if (!form) return
  const hidden = form.querySelector<HTMLInputElement>('input[name="resultado"]') || document.createElement('input')
  hidden.type = 'hidden'
  hidden.name = 'resultado'
  hidden.value = resultado
  if (!hidden.isConnected) form.appendChild(hidden)
  form.requestSubmit()
}
