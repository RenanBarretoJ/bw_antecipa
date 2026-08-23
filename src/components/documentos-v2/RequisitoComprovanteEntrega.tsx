'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, ChevronDown, ChevronUp, FileSignature, Loader2, ShieldAlert, XCircle } from 'lucide-react'
import { carregarContextoCanhotoDaNota, type CanhotoDaEntregaRegistro } from '@/lib/actions/canhoto-remessa'
import { analisarCanhoto, enviarCanhoto } from '@/lib/actions/logistica'
import { listarRemessasDaNota, type RemessaDaNotaRegistro } from '@/lib/actions/nota-fiscal-remessa'
import { inferirVinculoRemessaCanhoto } from '@/lib/documentos-v2/canhoto-vinculo-remessa'
import { statusVisual } from './ChecklistCedente'
import type { ChecklistDocumentoItem } from '@/lib/actions/documento-v2'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { DocumentDropzone } from './DocumentDropzone'
import { formatDate } from '@/lib/utils'

type ChecklistMode = 'cedente' | 'gestor'

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  enviado: 'Enviado',
  em_analise: 'Em analise',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  substituido: 'Substituido',
  cancelado: 'Cancelado',
}

const MENSAGEM_AMBIGUIDADE = 'Múltiplas NF de remessa válidas para esta venda — vínculo com uma remessa específica não pôde ser determinado automaticamente; revisão manual necessária.'

/**
 * Componente especializado do requisito de comprovante de entrega (canhoto)
 * dentro de Requisitos Documentais. Substitui o card avulso
 * `CanhotoDaEntrega` que existia fora do checklist -- o upload de canhoto
 * passa a acontecer exclusivamente aqui, com o vinculo com NF de remessa
 * resolvido automaticamente (nunca por selecao manual do usuario). Segue o
 * mesmo padrao visual/estrutural de `RequisitoNfRemessa`: hooks proprios
 * chamados sempre antes de qualquer return, sem lancar erro no handler de
 * upload (feedback via toast).
 */
export function RequisitoComprovanteEntrega({
  item,
  notaFiscalId,
  mode,
}: {
  item: ChecklistDocumentoItem
  notaFiscalId: string
  mode: ChecklistMode
}) {
  const notifications = useNotifications()
  const [canhotos, setCanhotos] = useState<CanhotoDaEntregaRegistro[] | null>(null)
  const [remessasValidadas, setRemessasValidadas] = useState<RemessaDaNotaRegistro[]>([])
  const [enviando, setEnviando] = useState(false)
  const [processing, setProcessing] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const load = async () => {
    const contexto = await carregarContextoCanhotoDaNota(notaFiscalId)
    if (!contexto.success || !contexto.data || !contexto.data.aplicavel) {
      if (!contexto.success) notifications.error(contexto.message)
      setCanhotos([])
      return
    }
    setCanhotos(contexto.data.canhotos)

    const remessas = await listarRemessasDaNota(notaFiscalId)
    if (remessas.success && remessas.data) {
      setRemessasValidadas(remessas.data.filter((remessa) => remessa.status_validacao === 'VALIDADA'))
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notaFiscalId])

  const enviarArquivo = async (arquivo: File) => {
    if (!item.entregaId) return
    setEnviando(true)
    const vinculo = inferirVinculoRemessaCanhoto(remessasValidadas)
    const formData = new FormData()
    formData.set('entregaId', item.entregaId)
    formData.set('arquivo', arquivo)
    formData.set('requisitoId', item.id)
    if (vinculo.notaFiscalRemessaId) formData.set('notaFiscalRemessaId', vinculo.notaFiscalRemessaId)
    if (vinculo.ambiguo) {
      formData.set('possuiRessalva', 'true')
      formData.set('descricaoRessalva', MENSAGEM_AMBIGUIDADE)
    }
    const result = await enviarCanhoto(formData)
    notifications.fromActionResult(result, 'Canhoto enviado para analise.')
    if (result?.success) await load()
    setEnviando(false)
  }

  const analisar = async (canhoto: CanhotoDaEntregaRegistro, resultado: 'aprovado' | 'rejeitado') => {
    const versaoId = canhoto.documento_versao_atual_id
    if (!versaoId) return
    const motivo = resultado === 'rejeitado' ? window.prompt('Informe o motivo da rejeição:') || '' : undefined
    if (resultado === 'rejeitado' && !motivo?.trim()) return
    setProcessing(canhoto.id)
    const result = await analisarCanhoto(canhoto.id, versaoId, resultado, motivo)
    notifications.fromActionResult(result, resultado === 'aprovado' ? 'Canhoto aprovado.' : 'Canhoto rejeitado.')
    if (result?.success) await load()
    setProcessing(null)
  }

  if (canhotos === null) {
    return (
      <article className="rounded-xl border bg-background">
        <div className="flex items-center gap-3 px-3 py-2.5 md:min-h-16">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><FileSignature size={17} /></span>
          <span className="text-sm text-muted-foreground">Carregando comprovante de entrega...</span>
        </div>
      </article>
    )
  }

  const visual = statusVisual(item)
  const StatusIcon = visual.icon
  const podeEnviar = mode === 'cedente'
  const shouldShowUpload = podeEnviar && canhotos.length === 0
  const shouldShowBody = expanded || shouldShowUpload
  const ExpandedIcon = expanded ? ChevronUp : ChevronDown

  return (
    <article className="rounded-xl border bg-background">
      <div className="flex flex-col gap-2 px-3 py-2.5 md:min-h-16 md:flex-row md:items-center md:justify-between">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><FileSignature size={17} /></span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate font-semibold text-foreground">{item.nome}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${item.obrigatorio ? 'bg-warning/15 text-warning-foreground' : 'bg-muted text-muted-foreground'}`}>
                {item.obrigatorio ? 'Obrigatório' : 'Opcional'}
              </span>
              {item.bloqueiaFluxo && mode === 'gestor' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                  <ShieldAlert size={11} /> Bloqueia
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {canhotos.length === 0 ? 'Nenhum canhoto enviado ainda.' : `${canhotos.length} canhoto(s) enviado(s)`}
            </span>
          </span>
        </button>

        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${visual.tone}`}>
            <StatusIcon size={13} />
            {visual.label}
          </span>
          {podeEnviar && canhotos.length > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={() => setExpanded(true)}>
              Enviar nova versão
            </Button>
          )}
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => setExpanded((current) => !current)} title={expanded ? 'Recolher' : 'Expandir'}>
            <ExpandedIcon size={15} />
          </Button>
        </div>
      </div>

      {shouldShowBody && (
        <div className="border-t border-border px-3 py-3">
          <div className="space-y-3 rounded-lg bg-muted/25 p-3">
            {item.descricao && <p className="text-sm text-muted-foreground">{item.descricao}</p>}

            {mode === 'gestor' && canhotos.length === 0 && (
              <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
                Documento ainda não enviado pelo cedente. Impacto: {item.bloqueiaFluxo ? 'bloqueia a conclusão logística.' : 'não bloqueia o fluxo.'}
              </div>
            )}

            {canhotos.length > 0 && (
              <div className="divide-y divide-border rounded-lg border bg-card">
                {canhotos.map((canhoto) => {
                  const aguardandoAnalise = ['enviado', 'em_analise'].includes(canhoto.status)
                  return (
                    <div key={canhoto.id} className="flex flex-col gap-1.5 px-3 py-2.5 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{formatDate(canhoto.created_at)}</span>
                        <span className="text-muted-foreground">{STATUS_LABEL[canhoto.status] || canhoto.status}</span>
                      </div>
                      {canhoto.nome_recebedor && <span className="text-muted-foreground">Recebido por: {canhoto.nome_recebedor}</span>}
                      {canhoto.remessa_numero && (
                        <p className="font-medium text-primary">Entrega comprovada via NF de Remessa {canhoto.remessa_numero}</p>
                      )}
                      {canhoto.possui_ressalva && <p className="text-amber-700">Ressalva: {canhoto.descricao_ressalva}</p>}
                      {mode === 'gestor' && aguardandoAnalise && (
                        <div className="mt-1 flex items-center gap-2">
                          <Button type="button" size="sm" onClick={() => analisar(canhoto, 'aprovado')} disabled={processing === canhoto.id}>
                            {processing === canhoto.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                            Aprovar
                          </Button>
                          <Button type="button" size="sm" variant="destructive" onClick={() => analisar(canhoto, 'rejeitado')} disabled={processing === canhoto.id}>
                            <XCircle size={13} />
                            Rejeitar
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {podeEnviar && (
              <DocumentDropzone
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                sending={enviando}
                label={canhotos.length === 0 ? 'Arraste o arquivo aqui ou clique para selecionar' : 'Enviar nova versão do canhoto'}
                onUpload={enviarArquivo}
              />
            )}
          </div>
        </div>
      )}
    </article>
  )
}
