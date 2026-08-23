'use client'

import { ChangeEvent, DragEvent, KeyboardEvent, MouseEvent, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, FileText, Loader2, Receipt, Upload, X } from 'lucide-react'
import {
  analisarBoletoDaParcela,
  enviarBoletoDaParcela,
  identificarBeneficiarioBoleto,
  listarBeneficiariosElegiveisDaNota,
  listarParcelasBoletosDaNota,
  type ParcelaBoletoItem,
} from '@/lib/actions/parcelas-nf'
import { baixarVersaoDocumento } from '@/lib/actions/documento-v2'
import { deveTentarAutodeteccaoBeneficiario, resolverBeneficiarioEfetivo } from '@/lib/documentos-v2/boleto-beneficiario'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { StatusBadge } from '@/components/data-display/primitives'
import { formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'

type Mode = 'cedente' | 'gestor'
type Beneficiario = { id: string; razaoSocial: string; cnpj: string; tipo: string }

/** Selecao de beneficiario preparada localmente para uma parcela ainda nao
 * enviada. `manual` marca que o proprio cedente escolheu o valor -- usado
 * para nao deixar a deteccao automatica (identificarBeneficiarioBoleto)
 * sobrescrever uma escolha ja feita. */
type BeneficiarioPreparado = { id: string; manual: boolean }

const boletoStatusLabel: Record<string, string> = {
  pendente: 'Aguardando envio',
  enviado: 'Aguardando análise',
  em_analise: 'Aguardando análise',
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

/** `Matriz/Filial • CNPJ • Razão social` -- com CNPJ visivel para
 * distinguir estabelecimentos com a mesma razao social (matriz e filial da
 * mesma empresa, ou duas filiais). */
function formatarBeneficiario(b: Beneficiario): string {
  return `${b.tipo === 'matriz' ? 'Matriz' : 'Filial'} • ${formatCNPJ(b.cnpj)} • ${b.razaoSocial}`
}

function nomeBeneficiario(id: string | null, lista: Beneficiario[]) {
  if (!id) return '—'
  const encontrado = lista.find((b) => b.id === id)
  return encontrado ? formatarBeneficiario(encontrado) : '—'
}

/** Estado visual exibido no badge de status. `Pronto para enviar` e
 * `Enviando` sao estados 100% locais (overlay sobre o status real,
 * `pendente` OU um reenvio apos `rejeitado`/`requer_ajuste`) -- nunca
 * persistidos, servem apenas para refletir o que o cedente preparou no
 * navegador antes de enviar. */
function statusVisual(item: ParcelaBoletoItem, arquivoPreparado: boolean, beneficiarioPreparado: boolean, enviando: boolean) {
  if (item.status !== 'satisfeito' && arquivoPreparado && beneficiarioPreparado) {
    return enviando
      ? { local: true as const, label: 'Enviando', tone: 'bg-info/15 text-info-foreground ring-info/40' }
      : { local: true as const, label: 'Pronto para enviar', tone: 'bg-success/15 text-success-foreground ring-success/40' }
  }
  return { local: false as const, label: boletoStatusLabel[item.status] || item.status }
}

/** Dropzone compacta (uma linha) para anexar o PDF do boleto de UMA
 * parcela. Ao contrario de DocumentDropzone, nao envia nada por conta
 * propria -- apenas guarda o arquivo no estado local do componente pai
 * (permite preparar varias parcelas antes de disparar o envio em lote). */
function CompactPdfDropzone({
  file,
  disabled,
  onSelect,
  onClear,
}: {
  file: File | null
  disabled?: boolean
  onSelect: (file: File) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const receberArquivos = (files: FileList | null) => {
    const selecionado = files?.[0]
    if (selecionado) onSelect(selecionado)
  }

  if (file) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs">
        <FileText size={13} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span>
        {!disabled && (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
            aria-label="Remover arquivo preparado"
          >
            <X size={12} />
          </button>
        )}
      </div>
    )
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      inputRef.current?.click()
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (!disabled) receberArquivos(event.dataTransfer.files)
  }

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    receberArquivos(event.target.files)
    event.currentTarget.value = ''
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={onKeyDown}
      onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragging(true) }}
      onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={(event) => { event.preventDefault(); setDragging(false) }}
      onDrop={onDrop}
      className={[
        'flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs outline-none transition',
        disabled ? 'cursor-not-allowed bg-muted/40 opacity-60' : 'cursor-pointer hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring',
        dragging ? 'border-primary bg-primary/5' : 'border-border bg-background',
      ].join(' ')}
    >
      <input ref={inputRef} type="file" accept="application/pdf" disabled={disabled} className="hidden" onChange={onChange} />
      <Upload size={13} className="shrink-0 text-muted-foreground" />
      <span className="truncate text-muted-foreground">Anexar boleto (PDF)</span>
    </div>
  )
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
  const [expanded, setExpanded] = useState(false)
  const autoExpandiuRef = useRef(false)

  // Estado 100% local (nunca enviado ao servidor ate o envio de fato):
  // arquivo preparado e beneficiario preparado por requisitoId. Chaveado
  // por requisitoId (estavel entre reloads) e nao por indice do array, ja
  // que `items` e substituido por uma referencia nova a cada load().
  const [arquivosPreparados, setArquivosPreparados] = useState<Record<string, File>>({})
  const [beneficiarioPreparado, setBeneficiarioPreparado] = useState<Record<string, BeneficiarioPreparado>>({})
  const [enviandoIds, setEnviandoIds] = useState<Set<string>>(new Set())
  const [analisandoIds, setAnalisandoIds] = useState<Set<string>>(new Set())
  const [enviandoLote, setEnviandoLote] = useState(false)
  // Modal de Reprovar/Solicitar ajuste (gestor) -- motivo obrigatorio, RPC so
  // e chamada apos "Confirmar". Aprovar e uma acao direta, sem modal.
  const [modalAcao, setModalAcao] = useState<{ item: ParcelaBoletoItem; resultado: 'rejeitado' | 'requer_ajuste' } | null>(null)
  const [motivoModal, setMotivoModal] = useState('')

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

  const limparArquivoPreparado = (requisitoId: string) => {
    setArquivosPreparados((current) => {
      const next = { ...current }
      delete next[requisitoId]
      return next
    })
  }

  // Beneficiario efetivo de uma parcela: prevalece a escolha local (manual ou
  // auto-detectada nesta sessao); na ausencia dela, cai para o beneficiario
  // ja persistido na ultima versao enviada (item.beneficiarioEstabelecimentoId)
  // -- e o que garante que um boleto rejeitado/reaberto para reenvio continua
  // mostrando o mesmo beneficiario, em vez de voltar para "Beneficiario...".
  const beneficiarioEfetivoId = (item: ParcelaBoletoItem): string =>
    resolverBeneficiarioEfetivo(beneficiarioPreparado[item.requisitoId]?.id, item.beneficiarioEstabelecimentoId)

  const arquivoSelecionado = (item: ParcelaBoletoItem, file: File) => {
    setArquivosPreparados((current) => ({ ...current, [item.requisitoId]: file }))
    // So tenta autodeteccao por CNPJ quando NAO ha beneficiario ja resolvido
    // (persistido de um envio anterior ou escolhido nesta sessao) -- nunca
    // sobrescreve nem gasta uma chamada ao servidor sem necessidade.
    if (!deveTentarAutodeteccaoBeneficiario(beneficiarioPreparado[item.requisitoId]?.id, item.beneficiarioEstabelecimentoId)) return
    const formData = new FormData()
    formData.set('arquivo', file)
    void identificarBeneficiarioBoleto(notaFiscalId, formData).then((result) => {
      const estabelecimentoId = result.success ? result.data?.estabelecimentoId : null
      if (!estabelecimentoId) return
      setBeneficiarioPreparado((current) => {
        const existente = current[item.requisitoId]
        // Nunca sobrescreve uma escolha manual, nem um valor ja preenchido
        // (inclusive por uma deteccao automatica anterior ou persistido).
        if (existente?.id || item.beneficiarioEstabelecimentoId) return current
        return { ...current, [item.requisitoId]: { id: estabelecimentoId, manual: false } }
      })
    })
  }

  const selecionarBeneficiario = (requisitoId: string, beneficiarioId: string) => {
    setBeneficiarioPreparado((current) => ({ ...current, [requisitoId]: { id: beneficiarioId, manual: true } }))
  }

  const analisar = async (item: ParcelaBoletoItem, formData: FormData) => {
    setAnalisandoIds((current) => new Set(current).add(item.requisitoId))
    const result = await analisarBoletoDaParcela(formData)
    notifications.fromActionResult(result)
    if (result.success) await load()
    setAnalisandoIds((current) => {
      const next = new Set(current)
      next.delete(item.requisitoId)
      return next
    })
    return result
  }

  const aprovarDireto = (item: ParcelaBoletoItem) => {
    const formData = new FormData()
    formData.set('nota_fiscal_id', notaFiscalId)
    formData.set('documento_versao_id', item.documentoVersaoId ?? '')
    formData.set('resultado', 'aprovado')
    void analisar(item, formData)
  }

  const abrirModalAcao = (item: ParcelaBoletoItem, resultado: 'rejeitado' | 'requer_ajuste') => {
    setModalAcao({ item, resultado })
    setMotivoModal('')
  }

  const fecharModalAcao = () => {
    setModalAcao(null)
    setMotivoModal('')
  }

  const confirmarModalAcao = async () => {
    if (!modalAcao || !motivoModal.trim()) return
    const formData = new FormData()
    formData.set('nota_fiscal_id', notaFiscalId)
    formData.set('documento_versao_id', modalAcao.item.documentoVersaoId ?? '')
    formData.set('resultado', modalAcao.resultado)
    formData.set('observacoes', motivoModal.trim())
    const resultado = await analisar(modalAcao.item, formData)
    if (resultado.success) fecharModalAcao()
  }

  // Elegivel para o lote: qualquer parcela que o cedente ainda pode enviar
  // (mesma condicao de podeEnviar -- inclui reenvio apos rejeitado/requer_
  // ajuste, nao so pendente) com arquivo e beneficiario resolvidos.
  const prontos = mode === 'cedente'
    ? items.filter((item) => item.status !== 'satisfeito' && arquivosPreparados[item.requisitoId] && beneficiarioEfetivoId(item))
    : []

  const enviarBoletosProntos = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (prontos.length === 0 || enviandoLote) return
    setEnviandoLote(true)
    for (const item of prontos) {
      const arquivo = arquivosPreparados[item.requisitoId]
      const beneficiarioId = beneficiarioEfetivoId(item)
      if (!arquivo || !beneficiarioId) continue

      setEnviandoIds((current) => new Set(current).add(item.requisitoId))
      const formData = new FormData()
      formData.set('nota_fiscal_id', notaFiscalId)
      formData.set('requisito_id', item.requisitoId)
      formData.set('estabelecimento_beneficiario_id', beneficiarioId)
      formData.set('arquivo', arquivo)

      const resultado = await enviarBoletoDaParcela(formData)
      if (resultado.success) {
        limparArquivoPreparado(item.requisitoId)
      } else {
        notifications.fromActionResult(resultado)
      }
      setEnviandoIds((current) => {
        const next = new Set(current)
        next.delete(item.requisitoId)
        return next
      })
    }
    await load()
    setEnviandoLote(false)
  }

  const obrigatorio = items.some((item) => item.obrigatorio)
  const aprovados = items.filter((item) => item.status === 'satisfeito').length
  const agregado = statusAgregadoConfig[statusAgregado(items)]
  const ExpandedIcon = expanded ? ChevronUp : ChevronDown
  // Gestor ganha uma coluna extra "Ações" (Aprovar/Solicitar ajuste/Reprovar)
  // -- Cedente permanece com as 6 colunas de sempre, sem alteração.
  const gridCols = mode === 'gestor'
    ? 'grid-cols-[3.5rem_5.5rem_7rem_9rem_11rem_5rem_1fr]'
    : 'grid-cols-[3.5rem_5.5rem_7rem_9rem_11rem_1fr]'

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
        {mode === 'cedente' && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <span>
              {prontos.length > 0
                ? `${prontos.length} boleto${prontos.length > 1 ? 's' : ''} pronto${prontos.length > 1 ? 's' : ''} para envio.`
                : 'Anexe o PDF e selecione o beneficiário de cada parcela para enviar.'}
            </span>
            {prontos.length > 0 && (
              <Button type="button" size="sm" onClick={enviarBoletosProntos} disabled={enviandoLote}>
                {enviandoLote ? 'Enviando...' : `Enviar boletos prontos (${prontos.length})`}
              </Button>
            )}
          </div>
        )}
        <div className={`hidden gap-2 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid ${gridCols}`}>
          <span>Parcela</span>
          <span>Vencimento</span>
          <span>Valor</span>
          <span>Status</span>
          <span>Beneficiário</span>
          <span>Documento</span>
          {mode === 'gestor' && <span>Ações</span>}
        </div>
        <div className="divide-y divide-border">
          {items.map((item) => {
            const podeEnviar = mode === 'cedente' && item.status !== 'satisfeito'
            const podeAnalisar = mode === 'gestor' && item.documentoVersaoId && item.status !== 'satisfeito'
            const beneficiario = nomeBeneficiario(item.beneficiarioEstabelecimentoId, beneficiarios)
            const enviandoLinha = enviandoIds.has(item.requisitoId)
            const analisandoLinha = analisandoIds.has(item.requisitoId)
            const arquivoPreparado = arquivosPreparados[item.requisitoId] ?? null
            const beneficiarioIdPreparado = beneficiarioEfetivoId(item)

            const visual = statusVisual(item, Boolean(arquivoPreparado), Boolean(beneficiarioIdPreparado), enviandoLinha)

            const beneficiarioConteudo = podeEnviar ? (
              <select
                className="h-8 w-full max-w-[13rem] rounded-md border bg-background px-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                value={beneficiarioIdPreparado}
                disabled={enviandoLinha}
                onChange={(event) => selecionarBeneficiario(item.requisitoId, event.target.value)}
              >
                <option value="">Beneficiário...</option>
                {beneficiarios.map((b) => (
                  <option key={b.id} value={b.id}>{formatarBeneficiario(b)}</option>
                ))}
              </select>
            ) : (
              <span className="truncate text-muted-foreground" title={beneficiario}>{beneficiario}</span>
            )

            const documentoConteudo = (
              <div className="flex flex-col gap-1.5">
                {item.documentoVersaoId && (
                  <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => verDocumento(item.documentoVersaoId as string)}>
                    Ver<ExternalLink className="ml-1 size-3" />
                  </Button>
                )}
                {podeEnviar && (
                  <CompactPdfDropzone
                    file={arquivoPreparado}
                    disabled={enviandoLinha}
                    onSelect={(file) => arquivoSelecionado(item, file)}
                    onClear={() => limparArquivoPreparado(item.requisitoId)}
                  />
                )}
                {!item.documentoVersaoId && !podeEnviar && !podeAnalisar && <span className="text-muted-foreground">—</span>}
              </div>
            )

            // Coluna "Ações" -- somente Gestor. Aprovar e direto; Reprovar e
            // Solicitar ajuste sempre abrem o modal (motivo obrigatorio, RPC
            // so roda apos confirmar). Nenhum motivo aparece inline na linha.
            const acoesConteudo = podeAnalisar ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" disabled={analisandoLinha} onClick={() => aprovarDireto(item)}>
                  {analisandoLinha && <Loader2 size={13} className="animate-spin" />}
                  Aprovar
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={analisandoLinha} onClick={() => abrirModalAcao(item, 'requer_ajuste')}>
                  Solicitar ajuste
                </Button>
                <Button type="button" size="sm" variant="destructive" disabled={analisandoLinha} onClick={() => abrirModalAcao(item, 'rejeitado')}>
                  Reprovar
                </Button>
              </div>
            ) : mode === 'gestor' ? <span className="text-muted-foreground">—</span> : null

            const statusConteudo = (
              <div className="flex flex-col gap-1">
                {visual.local ? (
                  <span className={`inline-flex h-6 w-fit items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset ${visual.tone}`}>
                    {visual.label === 'Enviando' && <Loader2 size={13} className="animate-spin" />}
                    {visual.label}
                  </span>
                ) : (
                  <StatusBadge status={item.status} label={boletoStatusLabel[item.status] || item.status} />
                )}
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
                  <div className="text-muted-foreground">Beneficiário: {beneficiarioConteudo}</div>
                  <div>{documentoConteudo}</div>
                  {acoesConteudo && <div>{acoesConteudo}</div>}
                </div>

                {/* Desktop: linha de tabela. */}
                <div className={`hidden items-center gap-2 px-3 py-2.5 text-sm md:grid ${gridCols}`}>
                  <span className="font-mono tabular-nums text-muted-foreground">{String(item.parcela.numero_parcela).padStart(3, '0')}</span>
                  <span className="tabular-nums">{formatDate(item.parcela.data_vencimento)}</span>
                  <span className="font-medium tabular-nums">{formatCurrency(item.parcela.valor_nominal)}</span>
                  {statusConteudo}
                  <div className="min-w-0">{beneficiarioConteudo}</div>
                  <div className="min-w-0">{documentoConteudo}</div>
                  {mode === 'gestor' && <div className="min-w-0">{acoesConteudo}</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Dialog open={modalAcao !== null} onOpenChange={(value) => { if (!value) fecharModalAcao() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{modalAcao?.resultado === 'rejeitado' ? 'Reprovar boleto' : 'Solicitar ajuste no boleto'}</DialogTitle>
          </DialogHeader>
          {modalAcao && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Parcela</p>
                  <p className="font-medium tabular-nums">{String(modalAcao.item.parcela.numero_parcela).padStart(3, '0')}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Vencimento</p>
                  <p className="font-medium tabular-nums">{formatDate(modalAcao.item.parcela.data_vencimento)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Valor</p>
                  <p className="font-medium tabular-nums">{formatCurrency(modalAcao.item.parcela.valor_nominal)}</p>
                </div>
              </div>
              <div>
                <Label htmlFor="motivo-acao-boleto">
                  {modalAcao.resultado === 'rejeitado' ? 'Motivo da reprovação' : 'Descreva o ajuste necessário'}
                </Label>
                <textarea
                  id="motivo-acao-boleto"
                  value={motivoModal}
                  maxLength={1000}
                  onChange={(event) => setMotivoModal(event.target.value)}
                  className="mt-2 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder={modalAcao.resultado === 'rejeitado' ? 'Explique o motivo da reprovação.' : 'Explique o que precisa ser corrigido.'}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={fecharModalAcao} disabled={modalAcao ? analisandoIds.has(modalAcao.item.requisitoId) : false}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant={modalAcao?.resultado === 'rejeitado' ? 'destructive' : 'default'}
              onClick={confirmarModalAcao}
              disabled={!motivoModal.trim() || (modalAcao ? analisandoIds.has(modalAcao.item.requisitoId) : false)}
            >
              {modalAcao && analisandoIds.has(modalAcao.item.requisitoId) && <Loader2 size={14} className="animate-spin" />}
              {modalAcao?.resultado === 'rejeitado' ? 'Confirmar reprovação' : 'Confirmar solicitação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
}
