'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Copy, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SensitiveConfirmDialog } from '@/components/admin/sensitive-confirm-dialog'
import { TokenOnceDialog } from '@/components/admin/token-once-dialog'
import { EmptyState, StatusBadge } from '@/components/data-display/primitives'
import type { AdminIntegracaoTransportadora } from '@/lib/admin/integracoes-transportadoras'
import { mascararTokenDisplay } from '@/lib/admin/integracoes-transportadoras'
import { formatDateTimeSaoPaulo } from '@/lib/utils'
import {
  ativarIntegracaoTransportadoraAdmin,
  criarIntegracaoTransportadoraAdmin,
  desativarIntegracaoTransportadoraAdmin,
  revogarTokenIntegracaoTransportadoraAdmin,
  rotacionarTokenIntegracaoTransportadoraAdmin,
} from '@/app/admin/integracoes-transportadoras/actions'

type Fundo = { id: string; nome: string }
type Confirmacao = { tipo: 'ativar' | 'desativar' | 'rotacionar' | 'revogar'; integracao: AdminIntegracaoTransportadora }

const textareaClass = 'min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
const outlineButton = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-50'

function endpointDoProvider(provider: string): string {
  if (typeof window === 'undefined') return `/api/integracoes/transportadoras/${provider}/comprovantes-entrega`
  return `${window.location.origin}/api/integracoes/transportadoras/${provider}/comprovantes-entrega`
}

export function IntegracaoTransportadoraManager({ integracoes, fundos }: { integracoes: AdminIntegracaoTransportadora[]; fundos: Fundo[] }) {
  const [criarAberto, setCriarAberto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null)
  const [motivoRevogacao, setMotivoRevogacao] = useState('')
  const [tokenDialog, setTokenDialog] = useState<{ titulo: string; token: string } | null>(null)

  const [novoFundoId, setNovoFundoId] = useState('')
  const [novoProvider, setNovoProvider] = useState('')
  const [novoNome, setNovoNome] = useState('')
  const [novoCnpj, setNovoCnpj] = useState('')
  const [novoMfaCode, setNovoMfaCode] = useState('')

  function limparFormularioCriacao() {
    setNovoFundoId('')
    setNovoProvider('')
    setNovoNome('')
    setNovoCnpj('')
    setNovoMfaCode('')
  }

  function submeterCriacao() {
    setErro(null)
    startTransition(async () => {
      const resultado = await criarIntegracaoTransportadoraAdmin({
        fundoId: novoFundoId,
        provider: novoProvider,
        nome: novoNome || undefined,
        cnpjTransportadora: novoCnpj || undefined,
        mfaCode: novoMfaCode,
      })
      if (!resultado.success) {
        setErro(resultado.message)
        return
      }
      limparFormularioCriacao()
      setCriarAberto(false)
      if (resultado.data?.token) setTokenDialog({ titulo: 'Token da nova integracao', token: resultado.data.token })
    })
  }

  function confirmarAcaoSensivel(mfaCode: string) {
    if (!confirmacao) return
    setErro(null)
    startTransition(async () => {
      const { tipo, integracao } = confirmacao
      const resultado = await (
        tipo === 'ativar' ? ativarIntegracaoTransportadoraAdmin({ id: integracao.id, mfaCode })
        : tipo === 'desativar' ? desativarIntegracaoTransportadoraAdmin({ id: integracao.id, mfaCode })
        : tipo === 'rotacionar' ? rotacionarTokenIntegracaoTransportadoraAdmin({ id: integracao.id, mfaCode })
        : revogarTokenIntegracaoTransportadoraAdmin({ id: integracao.id, motivo: motivoRevogacao, mfaCode })
      )
      if (!resultado.success) {
        setErro(resultado.message)
        return
      }
      setConfirmacao(null)
      setMotivoRevogacao('')
      if (resultado.data?.token) setTokenDialog({ titulo: 'Novo token da integracao', token: resultado.data.token })
    })
  }

  return (
    <div className="space-y-5">
      {erro && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}

      <div className="flex justify-end">
        <Button type="button" onClick={() => setCriarAberto((v) => !v)} variant={criarAberto ? 'outline' : 'default'}>
          <Plus className="size-4" />{criarAberto ? 'Cancelar' : 'Nova integracao'}
        </Button>
      </div>

      {criarAberto && (
        <div className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="novo-fundo" className="mb-1.5">Fundo</Label>
              <select id="novo-fundo" value={novoFundoId} onChange={(e) => setNovoFundoId(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm">
                <option value="">Selecione...</option>
                {fundos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="novo-provider" className="mb-1.5">Provider</Label>
              <Input id="novo-provider" value={novoProvider} onChange={(e) => setNovoProvider(e.target.value.toLowerCase())} placeholder="ex.: braspress" />
            </div>
            <div>
              <Label htmlFor="novo-nome" className="mb-1.5">Nome da transportadora (opcional)</Label>
              <Input id="novo-nome" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="novo-cnpj" className="mb-1.5">CNPJ da transportadora (opcional)</Label>
              <Input id="novo-cnpj" value={novoCnpj} onChange={(e) => setNovoCnpj(e.target.value)} />
            </div>
          </div>
          <div className="max-w-40">
            <Label htmlFor="novo-mfa" className="mb-1.5">Codigo TOTP</Label>
            <Input id="novo-mfa" value={novoMfaCode} onChange={(e) => setNovoMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="font-mono tracking-[0.35em]" />
          </div>
          <div>
            <Button type="button" onClick={submeterCriacao} disabled={pending || !novoFundoId || !novoProvider || novoMfaCode.length !== 6}>
              {pending && <Loader2 className="animate-spin" />}Criar integracao
            </Button>
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {integracoes.length === 0 ? (
          <EmptyState title="Nenhuma integracao cadastrada" description="Crie a primeira integracao de transportadora acima." />
        ) : (
          <div className="divide-y divide-border">
            {integracoes.map((it) => (
              <div key={it.id} className="grid items-start gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{it.nome || it.provider} <span className="text-muted-foreground">({it.provider})</span></p>
                  <p className="truncate text-xs text-muted-foreground">{it.nome_fundo} {it.cnpj_transportadora ? `• CNPJ ${it.cnpj_transportadora}` : ''}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Token {mascararTokenDisplay(it.token_display)} ({it.token_status || 'sem token'}) •{' '}
                    {it.ultimo_recebimento_em ? `ultimo recebimento ${formatDateTimeSaoPaulo(it.ultimo_recebimento_em)}` : 'sem eventos ainda'}
                    {it.eventos_com_erro_7d > 0 && <span className="text-amber-600"> • {it.eventos_com_erro_7d} evento(s) com erro (7d)</span>}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <StatusBadge status={it.ativo ? 'ativo' : 'desativada'} label={it.ativo ? 'Ativa' : 'Inativa'} />
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button type="button" className={outlineButton} onClick={() => setConfirmacao({ tipo: it.ativo ? 'desativar' : 'ativar', integracao: it })}>
                    {it.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                  <button type="button" className={outlineButton} onClick={() => setConfirmacao({ tipo: 'rotacionar', integracao: it })}>Rotacionar token</button>
                  <button type="button" className={outlineButton} onClick={() => setConfirmacao({ tipo: 'revogar', integracao: it })}>Revogar token</button>
                  <button
                    type="button"
                    className={outlineButton}
                    onClick={async () => { try { await navigator.clipboard.writeText(endpointDoProvider(it.provider)) } catch { /* clipboard indisponivel */ } }}
                  >
                    <Copy className="size-3.5" />Endpoint
                  </button>
                  <Link href={`/admin/integracoes-transportadoras/eventos?integracaoId=${it.id}`} className={outlineButton}>Eventos</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <SensitiveConfirmDialog
        open={confirmacao !== null}
        onOpenChange={(open) => { if (!open) { setConfirmacao(null); setMotivoRevogacao('') } }}
        title={
          confirmacao?.tipo === 'ativar' ? 'Ativar integracao'
          : confirmacao?.tipo === 'desativar' ? 'Desativar integracao'
          : confirmacao?.tipo === 'rotacionar' ? 'Rotacionar token'
          : 'Revogar token'
        }
        description={
          confirmacao?.tipo === 'revogar'
            ? 'O webhook desta integracao deixara de autenticar imediatamente. Informe o motivo e confirme com o codigo TOTP.'
            : 'Confirme com o codigo TOTP para continuar.'
        }
        confirmLabel="Confirmar"
        destructive={confirmacao?.tipo === 'desativar' || confirmacao?.tipo === 'revogar'}
        pending={pending}
        onConfirm={confirmarAcaoSensivel}
      >
        {confirmacao?.tipo === 'revogar' && (
          <div>
            <Label htmlFor="motivo-revogacao" className="mb-1.5">Motivo (opcional)</Label>
            <textarea id="motivo-revogacao" className={textareaClass} value={motivoRevogacao} onChange={(e) => setMotivoRevogacao(e.target.value)} />
          </div>
        )}
      </SensitiveConfirmDialog>

      {tokenDialog && (
        <TokenOnceDialog open onOpenChange={() => setTokenDialog(null)} title={tokenDialog.titulo} token={tokenDialog.token} />
      )}
    </div>
  )
}
