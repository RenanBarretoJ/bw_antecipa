'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileCode2, Loader2, ShieldAlert } from 'lucide-react'
import { desativarCnabAdmin, publicarCnabAdmin, salvarCnabRascunhoAdmin } from '@/app/admin/fundos/configuracoes-tecnicas-actions'
import { SensitiveConfirmDialog } from '@/components/admin/sensitive-confirm-dialog'
import { DetailField, EmptyState, FieldGrid, StatusBadge } from '@/components/data-display/primitives'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AdminConfiguracoesTecnicasFundo } from '@/lib/admin/configuracoes-tecnicas'

export function FundoCnabTecnico({ state }: { state: AdminConfiguracoesTecnicasFundo }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [pending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState<{ action: 'publish' | 'disable'; id: string } | null>(null)
  const config = state.cnab[0]
  const versions = config?.versoes || []
  const draft = versions.find((item) => item.status === 'rascunho')
  const published = versions.find((item) => item.status === 'publicada')
  const base = draft || published

  function save(formData: FormData) {
    startTransition(async () => {
      let extra: Record<string, unknown> = {}
      try { extra = JSON.parse(String(formData.get('configuracao') || '{}')) as Record<string, unknown> } catch { notifications.error('O JSON de parametros adicionais nao e valido.'); return }
      const result = await salvarCnabRascunhoAdmin({
        fundoId: state.fundo.id, configuracaoId: config?.id || null, versaoId: draft?.id || null,
        codigo: formData.get('codigo'), nome: formData.get('nome'), descricao: formData.get('descricao') || null,
        layout: 'cnab444', versaoLayout: formData.get('versaoLayout'), codigoBanco: formData.get('codigoBanco'), banco: formData.get('banco'), agencia: formData.get('agencia'), conta: formData.get('conta'), digitoConta: formData.get('digitoConta'), carteira: formData.get('carteira'), convenio: formData.get('convenio'), codigoOriginador: formData.get('codigoOriginador'), codigoEmpresa: formData.get('codigoEmpresa'), tipoInscricao: formData.get('tipoInscricao'), numeroInscricao: formData.get('numeroInscricao'), especieTitulo: formData.get('especieTitulo'), tipoRecebivel: formData.get('tipoRecebivel'), configuracao: extra, updatedAtEsperado: draft?.updated_at || null, mfaCode: formData.get('mfaCode'),
      })
      notifications.fromActionResult(result)
      if (result.success) router.refresh()
    })
  }

  function execute(mfaCode: string) {
    if (!confirm) return
    startTransition(async () => {
      const fn = confirm.action === 'publish' ? publicarCnabAdmin : desativarCnabAdmin
      const result = await fn({ fundoId: state.fundo.id, id: confirm.id, mfaCode })
      notifications.fromActionResult(result)
      if (result.success) { setConfirm(null); router.refresh() }
    })
  }

  const fields: Array<[string, string, string, boolean?]> = [
    ['versaoLayout', 'Versao do layout', base?.versao_layout || '1'], ['codigoBanco', 'Codigo do banco', base?.codigo_banco || ''], ['banco', 'Banco', base?.banco || ''], ['agencia', 'Agencia', base?.agencia || ''], ['conta', 'Conta', base?.conta || ''], ['digitoConta', 'Digito da conta', base?.digito_conta || ''], ['carteira', 'Carteira', base?.carteira || ''], ['convenio', 'Convenio', base?.convenio || ''], ['codigoOriginador', 'Codigo originador', base?.codigo_originador || '', true], ['codigoEmpresa', 'Codigo da empresa', base?.codigo_empresa || ''], ['tipoInscricao', 'Tipo de inscricao', base?.tipo_inscricao || ''], ['numeroInscricao', 'Numero de inscricao', base?.numero_inscricao || ''], ['especieTitulo', 'Especie do titulo', base?.especie_titulo || ''], ['tipoRecebivel', 'Tipo de recebivel', base?.tipo_recebivel || ''],
  ]

  return <div className="space-y-5">
    {!state.fundo.ativo && <div className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"><ShieldAlert className="size-5 shrink-0" /><p>Fundo inativo: o cadastro tecnico e permitido, mas a configuracao nao sera usada por operacoes.</p></div>}
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileCode2 className="size-5" />CNAB do fundo</CardTitle><CardDescription>Configuracao versionada e historicamente vinculada as remessas. O codigo originador nunca e inferido.</CardDescription></CardHeader><CardContent><FieldGrid><DetailField label="Versao publicada" value={published ? `v${published.versao}` : 'Nao publicada'} /><DetailField label="Layout" value={published ? `${published.layout} / ${published.versao_layout}` : 'Nao definido'} /><DetailField label="Codigo originador" value={published?.codigo_originador || 'Nao definido'} /><DetailField label="Banco e conta" value={published ? `${published.codigo_banco} · ${published.agencia} · ${published.conta}-${published.digito_conta}` : 'Nao definido'} /></FieldGrid></CardContent></Card>
    <Card><CardHeader><CardTitle>{draft ? `Editar rascunho v${draft.versao}` : 'Nova versao CNAB'}</CardTitle><CardDescription>Os valores permanecem como texto para preservar zeros a esquerda.</CardDescription></CardHeader><CardContent>
      <form action={save} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1"><Label>Codigo da configuracao</Label><Input name="codigo" required pattern="[a-z0-9_-]+" defaultValue={config?.codigo || 'cnab_principal'} /></label>
        <label className="space-y-1"><Label>Nome</Label><Input name="nome" required defaultValue={config?.nome || 'CNAB principal'} /></label>
        <label className="space-y-1"><Label>Layout</Label><Input value="CNAB 444" disabled /></label>
        <label className="space-y-1 md:col-span-2 lg:col-span-3"><Label>Descricao</Label><Input name="descricao" defaultValue={config?.descricao || ''} /></label>
        {fields.map(([name, label, value, numeric]) => <label key={name} className="space-y-1"><Label>{label}</Label><Input name={name} required={name !== 'digitoConta'} defaultValue={value} inputMode={numeric ? 'numeric' : undefined} /></label>)}
        <label className="space-y-1"><Label>Codigo TOTP</Label><Input name="mfaCode" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} /></label>
        <label className="space-y-1 md:col-span-2 lg:col-span-3"><Label>Parametros adicionais (JSON)</Label><textarea name="configuracao" defaultValue={JSON.stringify(base?.configuracao || {}, null, 2)} className="min-h-24 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs" /></label>
        <Button className="md:w-fit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Salvar rascunho</Button>
      </form>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Historico de versoes</CardTitle><CardDescription>Versoes publicadas permanecem imutaveis e remessas antigas conservam a referencia usada.</CardDescription></CardHeader><CardContent>{versions.length === 0 ? <EmptyState title="Nenhuma versao CNAB" description="Salve o primeiro rascunho para iniciar." icon={FileCode2} /> : <div className="divide-y divide-border">{versions.map((version) => <div key={version.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="font-semibold">v{version.versao} · {version.layout} {version.versao_layout}</p><p className="text-xs text-muted-foreground">Originador {version.codigo_originador} · hash {version.conteudo_hash.slice(0, 12)}…</p></div><StatusBadge status={version.status === 'publicada' ? 'ativo' : version.status === 'rascunho' ? 'pendente' : 'desativada'} label={version.status} />{version.status === 'rascunho' && <Button size="sm" onClick={() => setConfirm({ action: 'publish', id: version.id })}>Publicar</Button>}{version.status === 'publicada' && <Button size="sm" variant="destructive" onClick={() => setConfirm({ action: 'disable', id: version.id })}>Desativar</Button>}</div>)}</div>}</CardContent></Card>
    {confirm && <SensitiveConfirmDialog open onOpenChange={(open) => !open && setConfirm(null)} title={confirm.action === 'publish' ? 'Publicar versao CNAB' : 'Desativar versao CNAB'} description={confirm.action === 'publish' ? 'Novas remessas passarao a congelar esta versao. O historico anterior sera preservado.' : 'A configuracao deixara de estar disponivel para novas remessas.'} confirmLabel={confirm.action === 'publish' ? 'Publicar' : 'Desativar'} destructive={confirm.action === 'disable'} pending={pending} onConfirm={execute} />}
  </div>
}
