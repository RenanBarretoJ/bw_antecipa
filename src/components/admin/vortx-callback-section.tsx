'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Copy, Eye, EyeOff, Link2, Loader2, RefreshCw, ShieldCheck, Unplug } from 'lucide-react'
import { alterarCallbackVortx, obterCallbackVortx } from '@/app/admin/fundos/callback-vortx-actions'
import { SensitiveConfirmDialog } from '@/components/admin/sensitive-confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { situacaoCallback, type CallbackAcao, type CallbackAdminResult } from '@/lib/integracoes/vortx/callback-admin'

const date = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Ainda não registrado'
const confirmations: Record<CallbackAcao, { title: string; description: string; label: string }> = {
  gerar: { title: 'Gerar URL de callback', description: 'A URL terá um segredo exclusivo desta carteira. Ela será exibida uma única vez, para envio privado à Vórtx.', label: 'Gerar URL' },
  rotacionar: { title: 'Rotacionar segredo do callback', description: 'A URL anterior deixa de funcionar imediatamente. Encaminhe a nova URL à Vórtx para substituir o cadastro. O histórico recebido será preservado.', label: 'Rotacionar e gerar nova URL' },
  revogar: { title: 'Revogar recebimento', description: 'Novos callbacks serão recusados imediatamente. O histórico permanece preservado e as credenciais mTLS da integração não mudam.', label: 'Revogar recebimento' },
  informar_cadastro: { title: 'Informar cadastro na Vórtx', description: 'Confirme apenas após a equipe da Vórtx informar o cadastro desta URL. A confirmação técnica ocorrerá quando um evento for recebido.', label: 'Confirmar informação de cadastro' },
}

/** Secret exists only in transient component memory; never a prop, URL navigation, or browser storage. */
export function VortxCallbackSection({ fundoId, versaoId }: { fundoId: string; versaoId?: string }) {
  const [result, setResult] = useState<CallbackAdminResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [pending, startTransition] = useTransition()
  const [action, setAction] = useState<CallbackAcao | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const mutationLock = useRef(false)
  const load = useCallback(async () => {
    if (!versaoId) return
    setLoading(true); setError('')
    try { const value = await obterCallbackVortx({ fundoId, versaoId }); setResult(value); if (!value.success) setError(value.message) }
    catch { setError('Não foi possível consultar o callback. Tente atualizar os dados.') }
    finally { setLoading(false) }
  }, [fundoId, versaoId])
  useEffect(() => { void load() }, [load])
  const status = result?.success ? result.status : null
  const enabled = result?.success && result.habilitado

  function confirm(mfaCode: string) {
    if (!action || !status || !versaoId || mutationLock.current) return
    mutationLock.current = true
    const acao = action
    startTransition(async () => {
      setError(''); setMessage('')
      try {
        const value = await alterarCallbackVortx({ fundoId, versaoId, acao, revisao: status.revisao, mfaCode })
        if (!value.success) { setError(value.message); return }
        const { urlUnica, ...safe } = value
        setResult(safe); setMessage(value.message); setAction(null)
        if (urlUnica) { setUrl(urlUnica); setRevealed(false); setCopied(false) }
      } catch { setError('A resposta foi interrompida. Atualize o estado antes de repetir; se uma URL foi gerada, será necessário rotacionar para obtê-la novamente.') }
      finally { mutationLock.current = false }
    })
  }
  async function copy() {
    if (!url) return
    try { await navigator.clipboard.writeText(url); setCopied(true); setError('') }
    catch { setError('A cópia automática não está disponível. Use Mostrar URL e copie o campo manualmente.') }
  }

  return <section aria-labelledby="vortx-callback-title" className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 id="vortx-callback-title" className="flex items-center gap-2 font-semibold"><Link2 aria-hidden="true" className="size-5 shrink-0 text-primary" />Callback de relatórios</h3>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Gere o endereço que a Vórtx usará para avisar quando um relatório estiver disponível. Uma URL por carteira.</p></div>
      {versaoId && <Button type="button" variant="outline" className="min-h-11" disabled={loading || pending} onClick={() => void load()}><RefreshCw aria-hidden="true" className="size-4" />Atualizar estado</Button>}
    </div>
    {!versaoId ? <p className="rounded-lg bg-muted/50 p-4 text-sm">Publique a integração Vórtx VRS 2.0 com o código da carteira para configurar o callback. O rascunho não altera o callback publicado.</p> : <>
      <ol className="grid gap-3 text-sm sm:grid-cols-3" aria-label="Como ativar o callback">{['Gere a URL com TOTP', 'Encaminhe à equipe da Vórtx', 'Acompanhe o primeiro evento'].map((step, i) => <li key={step} className="rounded-lg border border-border px-3 py-3"><span className="mr-2 font-semibold text-primary">{i + 1}.</span>{step}</li>)}</ol>
      {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />Consultando configuração…</p>}
      {status && <>
        <div className="rounded-lg bg-muted/40 p-4"><p className="flex items-center gap-2 font-medium"><ShieldCheck aria-hidden="true" className="size-4 text-primary" />{situacaoCallback(status)}</p>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Carteira · {status.ambiente === 'producao' ? 'Produção VRS' : 'Homologação VRS'}</dt><dd className="mt-1 break-all font-mono">{status.carteira}</dd></div>
            <div><dt className="text-muted-foreground">Última geração da URL</dt><dd className="mt-1">{date(status.geradaEm)}</dd></div>
            <div><dt className="text-muted-foreground">Cadastro informado pelo operador</dt><dd className="mt-1">{date(status.cadastroInformadoEm)}</dd></div>
            <div><dt className="text-muted-foreground">Último evento desde a geração</dt><dd className="mt-1">{date(status.ultimoEventoEm)}</dd></div></dl></div>
        {!enabled && result?.success && <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{result.bloqueio}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="min-h-11" disabled={pending || loading || !enabled} onClick={() => setAction(status.ativo ? 'rotacionar' : 'gerar')}><Link2 aria-hidden="true" className="size-4" />{status.ativo ? 'Rotacionar e gerar nova URL' : 'Gerar URL de callback'}</Button>
          {status.ativo && <Button type="button" variant="outline" className="min-h-11" disabled={pending || loading || !enabled} onClick={() => setAction('informar_cadastro')}>Informar cadastro na Vórtx</Button>}
          {status.ativo && <Button type="button" variant="outline" className="min-h-11 text-destructive" disabled={pending || loading} onClick={() => setAction('revogar')}><Unplug aria-hidden="true" className="size-4" />Revogar recebimento</Button>}
        </div>
        <p className="text-sm text-muted-foreground">A URL completa não fica disponível para consulta. Se perdê-la, gere uma nova por rotação. Receber um evento não significa importar ou publicar dados financeiros.</p>
      </>}
    </>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && !action && !url && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {action && <SensitiveConfirmDialog open pending={pending} onOpenChange={open => { if (!open && !pending) { setAction(null); setError('') } }} title={confirmations[action].title}
      description={confirmations[action].description} confirmLabel={confirmations[action].label} pendingLabel="Confirmando…" destructive={action === 'revogar' || action === 'rotacionar'} onConfirm={confirm}>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </SensitiveConfirmDialog>}
    <Dialog open={Boolean(url)} onOpenChange={open => { if (!open) { setUrl(null); setRevealed(false); setCopied(false); setError('') } }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Copie a URL antes de fechar</DialogTitle><DialogDescription>Este endereço contém um segredo. Encaminhe-o à Vórtx por canal privado junto ao código da carteira. Não coloque em prints ou chamados públicos.</DialogDescription></DialogHeader>
        <div className="space-y-2"><Label htmlFor="vortx-callback-url">URL de callback · exibição única</Label><Input id="vortx-callback-url" className="min-h-11 font-mono" value={url ?? ''} readOnly type={revealed ? 'text' : 'password'} autoComplete="off" aria-describedby="vortx-callback-once" />
          <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" onClick={() => void copy()}><Copy aria-hidden="true" className="size-4" />{copied ? 'URL copiada' : 'Copiar URL'}</Button><Button type="button" variant="outline" className="min-h-11" aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>{revealed ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}{revealed ? 'Ocultar URL' : 'Mostrar URL'}</Button></div>
          <p id="vortx-callback-once" className="text-sm text-muted-foreground">Ao fechar, a URL não poderá ser recuperada. Gerar aqui não cadastra automaticamente na Vórtx. Esta é uma Preview descartável, não um endereço definitivo de produção.</p>
          {copied && <p role="status" className="text-sm">URL copiada para a área de transferência.</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div><DialogFooter><Button type="button" variant="outline" className="min-h-11" onClick={() => { setUrl(null); setRevealed(false); setCopied(false); setError('') }}>Concluir e ocultar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
}
