'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Activity, KeyRound, Loader2, PlugZap, ShieldAlert } from 'lucide-react'
import {
  ativarCredencialAdmin,
  cadastrarCredencialAdmin,
  desativarIntegracaoAdmin,
  publicarIntegracaoAdmin,
  revogarCredencialAdmin,
  salvarIntegracaoRascunhoAdmin,
  testarIntegracaoAdmin,
} from '@/app/admin/fundos/configuracoes-tecnicas-actions'
import { SensitiveConfirmDialog } from '@/components/admin/sensitive-confirm-dialog'
import { DetailField, EmptyState, FieldGrid, StatusBadge } from '@/components/data-display/primitives'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AdminConfiguracoesTecnicasFundo } from '@/lib/admin/configuracoes-tecnicas'

type Confirmation = { kind: 'activate' | 'revoke' | 'publish' | 'disable' | 'test'; id: string } | null

const date = (value?: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Nao informado'

export function FundoIntegracoesTecnicas({ state, execPage }: { state: AdminConfiguracoesTecnicasFundo; execPage: number }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [pending, startTransition] = useTransition()
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [reason, setReason] = useState('')
  const [rotationId, setRotationId] = useState<string | null>(null)
  const credentialFormRef = useRef<HTMLFormElement>(null)
  const integration = state.integracoes.find((item) => item.provedor === 'fromtis') || state.integracoes[0]
  const versions = integration?.versoes || []
  const draft = versions.find((item) => item.status === 'rascunho')
  const published = versions.find((item) => item.status === 'publicada')
  const activeCredentials = state.credenciais.filter((item) => item.status === 'ativa')
  const defaultVersion = draft || published
  const defaultCredential = activeCredentials.find((item) => item.ambiente === (defaultVersion?.ambiente || 'homologacao'))
  const confirmContent = useMemo(() => ({
    activate: ['Ativar credencial', 'A credencial passara a estar disponivel para novos rascunhos.', 'Ativar'],
    revoke: ['Revogar credencial', 'A credencial deixa de funcionar imediatamente. Versoes publicadas vinculadas a ela ficarao indisponiveis.', 'Revogar'],
    publish: ['Publicar integracao', 'Esta versao substituira a versao publicada atual e sera usada nas novas execucoes.', 'Publicar'],
    disable: ['Desativar integracao', 'A versao deixara de estar disponivel para execucoes operacionais.', 'Desativar'],
    test: ['Testar integracao', 'O teste usara exatamente a versao e a credencial vinculada, sem fallback.', 'Executar teste'],
  }), [])

  function refresh(result: Awaited<ReturnType<typeof ativarCredencialAdmin>>) {
    notifications.fromActionResult(result)
    if (result.success) {
      setConfirmation(null)
      setReason('')
      router.refresh()
    }
  }

  function executeConfirmation(mfaCode: string) {
    if (!confirmation) return
    startTransition(async () => {
      const input = { fundoId: state.fundo.id, id: confirmation.id, mfaCode, motivo: reason }
      const result = confirmation.kind === 'activate' ? await ativarCredencialAdmin(input)
        : confirmation.kind === 'revoke' ? await revogarCredencialAdmin(input)
          : confirmation.kind === 'publish' ? await publicarIntegracaoAdmin(input)
            : confirmation.kind === 'disable' ? await desativarIntegracaoAdmin(input)
              : await testarIntegracaoAdmin(input)
      refresh(result)
    })
  }

  function createCredential(formData: FormData) {
    startTransition(async () => {
      const result = await cadastrarCredencialAdmin({
        fundoId: state.fundo.id,
        ambiente: formData.get('ambiente'),
        nome: formData.get('nome'),
        usuario: formData.get('usuario'),
        senha: formData.get('senha'),
        credencialAnteriorId: rotationId,
        mfaCode: formData.get('mfaCode'),
      })
      notifications.fromActionResult(result)
      if (result.success) {
        credentialFormRef.current?.reset()
        setRotationId(null)
        router.refresh()
      }
    })
  }

  function saveDraft(formData: FormData) {
    startTransition(async () => {
      let config: Record<string, unknown> = {}
      try { config = JSON.parse(String(formData.get('configuracao') || '{}')) as Record<string, unknown> } catch { notifications.error('O JSON de configuracao nao e valido.'); return }
      const result = await salvarIntegracaoRascunhoAdmin({
        fundoId: state.fundo.id,
        versaoId: draft?.id || null,
        ambiente: formData.get('ambiente'),
        endpointBase: formData.get('endpointBase'),
        identificadorCliente: formData.get('identificadorCliente'),
        credencialIntegracaoId: formData.get('credencialIntegracaoId'),
        configuracaoNaoSensivel: config,
        updatedAtEsperado: draft?.updated_at || null,
        mfaCode: formData.get('mfaCode'),
      })
      notifications.fromActionResult(result)
      if (result.success) router.refresh()
    })
  }

  return <div className="space-y-5">
    {!state.fundo.ativo && <div className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"><ShieldAlert className="size-5 shrink-0 text-warning-foreground" /><p>Fundo inativo: configuracoes e testes tecnicos continuam permitidos, mas execucoes operacionais permanecem bloqueadas.</p></div>}

    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><PlugZap className="size-5" />Portal FIDC / Sinqia</CardTitle><CardDescription>Visao tecnica versionada por fundo. Nao existe credencial ou endpoint global de fallback.</CardDescription></CardHeader>
      <CardContent><FieldGrid><DetailField label="Status tecnico" value={published ? 'Configurado' : 'Nao configurado'} /><DetailField label="Versao publicada" value={published ? `v${published.versao}` : 'Nao publicada'} /><DetailField label="Ambiente" value={published?.ambiente || 'Nao definido'} /><DetailField label="Endpoint" value={published?.endpoint_base || 'Nao definido'} /><DetailField label="Credencial vinculada" value={published?.credencial_integracao_id ? `${state.credenciais.find((item) => item.id === published.credencial_integracao_id)?.nome || 'Nao encontrada'} · ${state.credenciais.find((item) => item.id === published.credencial_integracao_id)?.status || 'invalida'}` : 'Nao definida'} /></FieldGrid></CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-5" />Credenciais</CardTitle><CardDescription>Somente metadados mascarados sao exibidos. Segredos nunca retornam ao navegador.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {state.credenciais.length === 0 ? <EmptyState title="Nenhuma credencial" description="Cadastre uma credencial por ambiente antes de configurar a integracao." icon={KeyRound} /> : <div className="divide-y divide-border rounded-xl border border-border px-4">
          {state.credenciais.map((credential) => {
            const foiRotacionada = state.credenciais.some((item) => item.substituida_por === credential.id)
            return <div key={credential.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1"><p className="truncate font-semibold">{credential.nome}</p><p className="text-xs text-muted-foreground">Portal FIDC · {credential.ambiente} · {credential.usuario_mascarado || 'usuario protegido'}</p><p className="text-xs text-muted-foreground">Criada em {date(credential.criada_em)} · ultima rotacao {foiRotacionada ? date(credential.ativada_em) : 'nao realizada'} · ultimo uso {date(credential.ultimo_uso_em)}</p></div>
            <StatusBadge status={credential.status === 'ativa' ? 'ativo' : credential.status === 'revogada' ? 'reprovada' : 'pendente'} label={credential.status} />
            {credential.status === 'pendente' && <Button size="sm" variant="outline" onClick={() => setConfirmation({ kind: 'activate', id: credential.id })}>Ativar</Button>}
            {credential.status === 'ativa' && <><Button size="sm" variant="outline" onClick={() => setRotationId(credential.id)}>Rotacionar</Button><Button size="sm" variant="destructive" onClick={() => setConfirmation({ kind: 'revoke', id: credential.id })}>Revogar</Button></>}
          </div>})}
        </div>}
        <form ref={credentialFormRef} action={createCredential} className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 md:grid-cols-2">
          <div className="md:col-span-2"><p className="font-semibold">{rotationId ? 'Rotacionar credencial' : 'Nova credencial'}</p>{rotationId && <p className="text-xs text-muted-foreground">A credencial anterior sera substituida somente apos a ativacao da nova.</p>}</div>
          <label className="space-y-1"><Label>Ambiente</Label><select name="ambiente" defaultValue="homologacao" className="h-10 w-full rounded-lg border border-input bg-background px-3"><option value="homologacao">Homologacao</option><option value="producao">Producao</option></select></label>
          <label className="space-y-1"><Label>Nome</Label><Input name="nome" required maxLength={120} /></label>
          <label className="space-y-1"><Label>Usuario</Label><Input name="usuario" required autoComplete="off" /></label>
          <label className="space-y-1"><Label>Senha</Label><Input name="senha" type="password" required autoComplete="new-password" /></label>
          <label className="space-y-1"><Label>Codigo TOTP</Label><Input name="mfaCode" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" /></label>
          <div className="flex items-end gap-2"><Button disabled={pending}>{pending && <Loader2 className="animate-spin" />}{rotationId ? 'Cadastrar rotacao' : 'Cadastrar credencial'}</Button>{rotationId && <Button type="button" variant="outline" onClick={() => setRotationId(null)}>Cancelar</Button>}</div>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Configuracao da integracao</CardTitle><CardDescription>Salvar cria ou atualiza somente o rascunho. Publicacao e teste exigem confirmacao TOTP separada. O teste e tecnico e nao cria remessa nem representa operacao real.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <form action={saveDraft} className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1"><Label>Ambiente</Label><select name="ambiente" defaultValue={defaultVersion?.ambiente || 'homologacao'} className="h-10 w-full rounded-lg border border-input bg-background px-3"><option value="homologacao">Homologacao</option><option value="producao">Producao</option></select></label>
          <label className="space-y-1"><Label>Credencial ativa</Label><select name="credencialIntegracaoId" defaultValue={defaultVersion?.credencial_integracao_id || defaultCredential?.id || ''} required className="h-10 w-full rounded-lg border border-input bg-background px-3"><option value="">Selecione</option>{activeCredentials.map((item) => <option key={item.id} value={item.id}>{item.nome} · {item.ambiente}</option>)}</select></label>
          <label className="space-y-1 md:col-span-2"><Label>Endpoint HTTPS</Label><Input name="endpointBase" type="url" required defaultValue={defaultVersion?.endpoint_base || ''} /></label>
          <label className="space-y-1"><Label>Identificador do cliente</Label><Input name="identificadorCliente" required defaultValue={defaultVersion?.identificador_cliente || ''} /></label>
          <label className="space-y-1"><Label>Codigo TOTP</Label><Input name="mfaCode" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} /></label>
          <label className="space-y-1 md:col-span-2"><Label>Configuracao nao sensivel (JSON)</Label><textarea name="configuracao" defaultValue={JSON.stringify(defaultVersion?.configuracao_nao_sensivel || {}, null, 2)} className="min-h-24 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs" /></label>
          <Button className="md:w-fit" disabled={pending || activeCredentials.length === 0}>{pending && <Loader2 className="animate-spin" />}Salvar rascunho</Button>
        </form>
        <div className="divide-y divide-border rounded-xl border border-border px-4">
          {versions.map((version) => <div key={version.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="font-semibold">Versao {version.versao} · {version.ambiente}</p><p className="truncate text-xs text-muted-foreground" title={version.endpoint_base}>{version.endpoint_base}</p></div><StatusBadge status={version.status === 'publicada' ? 'ativo' : version.status === 'rascunho' ? 'pendente' : 'desativada'} label={version.status} /><Button size="sm" variant="outline" onClick={() => setConfirmation({ kind: 'test', id: version.id })}>Testar</Button>{version.status === 'rascunho' && <Button size="sm" onClick={() => setConfirmation({ kind: 'publish', id: version.id })}>Publicar</Button>}{version.status === 'publicada' && <Button size="sm" variant="destructive" onClick={() => setConfirmation({ kind: 'disable', id: version.id })}>Desativar</Button>}</div>)}
        </div>
      </CardContent>
    </Card>

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-5" />Execucoes recentes</CardTitle><CardDescription>Testes tecnicos e execucoes operacionais permanecem identificados separadamente.</CardDescription></CardHeader><CardContent>{state.execucoes.length === 0 ? <EmptyState title="Nenhuma execucao" description="Os testes e envios aparecerao aqui." icon={Activity} /> : <><div className="divide-y divide-border">{state.execucoes.map((item) => <div key={item.id} className="grid gap-2 py-3 sm:grid-cols-[120px_120px_minmax(0,1fr)_180px]"><StatusBadge status={item.status === 'sucesso' ? 'ativo' : item.status === 'erro' ? 'reprovada' : 'pendente'} label={item.status} /><span className="text-sm font-medium">{item.tipo_execucao}</span><span className="truncate text-sm text-muted-foreground">{item.mensagem_resumida || 'Sem mensagem'}</span><span className="text-sm text-muted-foreground sm:text-right">{date(item.iniciada_em)}</span></div>)}</div><div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-sm"><span>{state.execucoes_total} execucao(oes)</span><div className="flex gap-2"><Link aria-disabled={execPage === 1} className={`rounded-lg border border-border px-3 py-2 ${execPage === 1 ? 'pointer-events-none opacity-50' : 'hover:bg-muted'}`} href={`/admin/fundos/${state.fundo.id}?tab=integracoes&execPage=${execPage - 1}`}>Anterior</Link><Link aria-disabled={execPage * 20 >= state.execucoes_total} className={`rounded-lg border border-border px-3 py-2 ${execPage * 20 >= state.execucoes_total ? 'pointer-events-none opacity-50' : 'hover:bg-muted'}`} href={`/admin/fundos/${state.fundo.id}?tab=integracoes&execPage=${execPage + 1}`}>Proxima</Link></div></div></>}</CardContent></Card>

    {confirmation && <SensitiveConfirmDialog open onOpenChange={(open) => !open && setConfirmation(null)} title={confirmContent[confirmation.kind][0]} description={confirmContent[confirmation.kind][1]} confirmLabel={confirmContent[confirmation.kind][2]} destructive={confirmation.kind === 'revoke' || confirmation.kind === 'disable'} pending={pending} onConfirm={executeConfirmation}>{confirmation.kind === 'revoke' && <div><Label htmlFor="sa3-reason" className="mb-2">Motivo obrigatorio</Label><Input id="sa3-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={500} /></div>}</SensitiveConfirmDialog>}
  </div>
}
