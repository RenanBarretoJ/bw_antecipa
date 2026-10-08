'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Mail, ShieldCheck, Save } from 'lucide-react'
import { salvarIntegracaoEmail } from '@/app/actions/email-operations'
import { emailConfigurationSchema, type EmailConfiguration, type EmailDashboard, type EmailIntegration } from '@/lib/email-intake/operations/contracts'
import { emailDateLabel } from '@/lib/email-intake/operations/presentation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmailCredentialDialog } from './credential-dialog'
import { EmailCedentePicker } from './cedente-picker'

const steps = ['Identificação', 'Conta de e-mail', 'Credencial', 'Cedentes', 'Data inicial', 'Revisão']
const stepDescriptions = ['Nome e ambiente', 'Caixa que receberá as notas', 'Acesso seguro ao Outlook', 'Quem pode receber documentos', 'A partir de quando ler', 'Conferência antes de salvar']
export const emailSelectClass = 'h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring'

export function EmailConfigurationWizard({ fundoId, basePath, dashboard, initial }: {
  fundoId: string; basePath: string; dashboard: EmailDashboard; initial?: EmailIntegration
}) {
  const router = useRouter(), heading = useRef<HTMLHeadingElement>(null), [step, setStep] = useState(0)
  const [value, setValue] = useState<EmailConfiguration>(() => initial ?? ({ name: '', provider: 'OUTLOOK_GRAPH', environment: 'homologacao', mailbox: null,
    mailboxObjectId: null, folderId: 'inbox', credentialId: null, routingMode: 'ALLOWLIST', cedenteIds: [], startAt: null }))
  const [credentials, setCredentials] = useState(dashboard.credentials), [credentialOpen, setCredentialOpen] = useState(false)
  const [pending, start] = useTransition(), [message, setMessage] = useState(''), [code, setCode] = useState('')
  const [preset, setPreset] = useState(initial?.startAt ? 'CUSTOM' : 'NOW'), [customDate, setCustomDate] = useState('')
  const [dateReference, setDateReference] = useState<number | null>(null)
  const [confirmed, setConfirmed] = useState(false), [invalidField, setInvalidField] = useState('')
  const [requestId] = useState(() => crypto.randomUUID())
  function update<K extends keyof EmailConfiguration>(key: K, next: EmailConfiguration[K]) { setValue(old => ({ ...old, [key]: next })); setConfirmed(false) }
  function navigate(next: number, now?: number) { if (next >= 4 && dateReference === null && now !== undefined) setDateReference(now); setStep(next); requestAnimationFrame(() => heading.current?.focus()) }
  function startAt(now: number) {
    if (preset === 'CUSTOM') return customDate ? new Date(`${customDate}:00-03:00`).toISOString() : value.startAt
    const hours = preset === 'DAY' ? 24 : preset === 'WEEK' ? 168 : 0
    return new Date(now - hours * 60 * 60_000).toISOString()
  }
  let previewStartAt: string | null = null
  try { if (dateReference !== null || preset === 'CUSTOM') previewStartAt = startAt(dateReference ?? 0) } catch { /* Invalid custom dates are explained beside the field. */ }
  function save() {
    setMessage('')
    setInvalidField('')
    if (initial && !confirmed) { setMessage('Confirme as alterações antes de salvar.'); return }
    start(async () => {
      let boundary: string | null
      try { boundary = startAt(dateReference ?? Date.now()) } catch { setMessage('Informe uma data e hora válidas no horário de Brasília.'); return }
      const configuration = emailConfigurationSchema.safeParse({ ...value, startAt: boundary })
      if (!configuration.success) {
        const field = String(configuration.error.issues[0]?.path[0] ?? '')
        const fieldSteps: Record<string, number> = { name: 0, environment: 0, mailbox: 1, mailboxObjectId: 1, folderId: 1, credentialId: 2, cedenteIds: 3, startAt: 4 }
        setInvalidField(field); setMessage('Confira o campo indicado. Seus dados foram preservados.')
        navigate(fieldSteps[field] ?? 0, Date.now())
        requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
        return
      }
      const result = await salvarIntegracaoEmail({ fundoId, id: initial?.id ?? null, revision: initial?.revision ?? null,
        config: configuration.data, mfaCode: code, requestId })
      setCode('')
      if (!result.ok) { setMessage(result.message); return }
      router.push(`${basePath}?fundo=${fundoId}&integration=${result.data.id}`)
      router.refresh()
    })
  }
  return <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
    <header className="flex items-start gap-3 border-b px-5 py-5 sm:px-7"><span className="rounded-lg bg-primary/10 p-2.5 text-primary"><Mail className="size-5" aria-hidden="true" /></span><div><h2 className="text-xl font-semibold tracking-tight">{initial ? 'Editar integração de e-mail' : 'Configure sua caixa de e-mail'}</h2><p className="mt-1 text-sm text-muted-foreground">Preencha por etapas. A leitura automática só será liberada depois do teste e da ativação.</p></div></header>
    <div className="grid lg:grid-cols-[250px_minmax(0,1fr)]">
    <nav className="border-b bg-muted/20 p-4 lg:border-r lg:border-b-0 lg:p-5" aria-label="Etapas do cadastro"><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Etapa {step + 1} de {steps.length}</p><ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">{steps.map((label, index) => <li key={label}>
      <button type="button" onClick={() => navigate(index, Date.now())} aria-label={`${index + 1}. ${label}`} aria-describedby={`email-step-${index}-help`} aria-current={index === step ? 'step' : undefined} className={`flex min-h-14 w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${index === step ? 'border-primary/30 bg-card text-primary shadow-sm dark:text-blue-300' : 'border-transparent text-muted-foreground hover:bg-muted'}`}><span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${index === step ? 'bg-primary text-primary-foreground' : 'border bg-background'}`}>{index + 1}. </span><span className="font-medium">{label}</span></button><p id={`email-step-${index}-help`} className="mt-1 hidden pl-13 text-xs text-muted-foreground lg:block">{stepDescriptions[index]}</p>
    </li>)}</ol><div className="mt-6 hidden rounded-lg border bg-card p-4 text-xs leading-relaxed text-muted-foreground lg:block"><ShieldCheck className="mb-2 size-5 text-primary" aria-hidden="true" /><p className="font-medium text-foreground">Acesso protegido</p><p className="mt-1">O fundo selecionado será mantido. A credencial fica criptografada e o salvamento exige confirmação MFA.</p></div></nav>
    <div className="min-w-0 space-y-5 p-5 sm:p-7">
    <div><p className="mb-1 text-xs font-medium text-muted-foreground">{stepDescriptions[step]}</p><h3 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">{step + 1}. {steps[step]}</h3></div>
    {message && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{message}</p>}
    <form onSubmit={e => { e.preventDefault(); if (step < 5) navigate(step + 1, Date.now()); else save() }} className="space-y-5 [&_label]:text-sm [&_label]:font-medium [&_input]:min-h-11 [&_select]:min-h-11">
      {step === 0 && <>
        <p className="text-sm text-muted-foreground">Dê um nome que ajude sua equipe a identificar esta caixa. O fundo selecionado será preservado.</p>
        <label className="block space-y-1">Nome da integração<Input value={value.name} onChange={e => update('name', e.target.value)} required minLength={2} maxLength={120} aria-invalid={invalidField === 'name'} placeholder="Ex.: Notas fiscais — contas a receber" />{invalidField === 'name' && <span className="text-sm text-destructive">Use de 2 a 120 caracteres.</span>}</label>
        <label className="block space-y-1">Serviço de e-mail<select className={emailSelectClass} value={value.provider} onChange={() => undefined}><option value="OUTLOOK_GRAPH">Microsoft Outlook</option></select></label>
        <label className="block space-y-1">Ambiente<select className={emailSelectClass} value={value.environment} onChange={e => { update('environment', e.target.value === 'producao' ? 'producao' : 'homologacao'); update('credentialId', null) }}><option value="homologacao">Homologação</option><option value="producao">Produção</option></select></label>
      </>}
      {step === 1 && <>
        <p className="text-sm text-muted-foreground">Informe a caixa que receberá os documentos fiscais. Seu administrador Microsoft pode fornecer o identificador da caixa.</p>
        <label className="block space-y-1">Endereço de e-mail<Input type="email" value={value.mailbox ?? ''} onChange={e => update('mailbox', e.target.value || null)} maxLength={320} autoComplete="off" aria-invalid={invalidField === 'mailbox'} />{invalidField === 'mailbox' && <span className="text-sm text-destructive">Informe um endereço válido ou deixe vazio para completar depois.</span>}</label>
        <label className="block space-y-1">Identificador da caixa no Microsoft 365 (Object ID)<Input value={value.mailboxObjectId ?? ''} onChange={e => update('mailboxObjectId', e.target.value || null)} pattern="[a-fA-F0-9-]{36}" aria-describedby="mailbox-id-help" aria-invalid={invalidField === 'mailboxObjectId'} />{invalidField === 'mailboxObjectId' && <span className="text-sm text-destructive">Confira o identificador com o administrador Microsoft.</span>}</label>
        <p id="mailbox-id-help" className="text-sm text-muted-foreground">É o identificador único do usuário da caixa no Microsoft Entra. O teste confere se ele corresponde ao endereço informado.</p>
        <details className="rounded border p-3" open={invalidField === 'folderId' ? true : undefined}><summary className="cursor-pointer">Opções avançadas da pasta</summary><label className="mt-3 block space-y-1">Pasta de origem<Input value={value.folderId} onChange={e => update('folderId', e.target.value)} required maxLength={1024} aria-invalid={invalidField === 'folderId'} />{invalidField === 'folderId' && <span className="text-sm text-destructive">Informe inbox ou a pasta indicada pelo administrador.</span>}</label><p className="mt-2 text-sm text-muted-foreground">Use inbox para a Caixa de Entrada. Só altere se seu administrador indicar outra pasta.</p></details>
      </>}
      {step === 2 && <>
        <p className="text-sm text-muted-foreground">A credencial permite acessar o Outlook. A integração define qual caixa ler e quais documentos aceitar.</p>
        <label className="block space-y-1">Credencial compatível<select className={emailSelectClass} value={value.credentialId ?? ''} onChange={e => update('credentialId', e.target.value || null)}><option value="">Selecionar depois — salvar rascunho</option>{credentials.filter(c => c.environment === value.environment).map(c => <option key={c.id} value={c.id}>{c.name} · Outlook · {c.environment === 'homologacao' ? 'Homologação' : 'Produção'} · Ativa · {c.lastTestAt ? `Teste: ${emailDateLabel(c.lastTestAt)}` : 'Ainda não testada'}</option>)}</select></label>
        {dashboard.canManageCredentials ? <Button type="button" variant="outline" onClick={() => setCredentialOpen(true)}>Criar credencial</Button> : <p className="text-sm">Se não houver uma credencial disponível, salve o rascunho e peça o cadastro ao administrador técnico.</p>}
      </>}
      {step === 3 && <>
        <fieldset className="space-y-3"><legend className="mb-2 font-medium">Quais cedentes podem ter documentos importados?</legend>
          <label className="flex gap-3 rounded border p-3"><input type="radio" name="routing" checked={value.routingMode === 'ALL_ACTIVE_CEDENTES'} onChange={() => update('routingMode', 'ALL_ACTIVE_CEDENTES')} /><span>Todos os cedentes ativos deste fundo</span></label>
          <label className="flex gap-3 rounded border p-3"><input type="radio" name="routing" checked={value.routingMode === 'ALLOWLIST'} onChange={() => update('routingMode', 'ALLOWLIST')} /><span>Apenas cedentes selecionados</span></label>
        </fieldset>
        <p className="text-sm text-muted-foreground">O remetente do e-mail não define o cedente. O sistema usa o CNPJ identificado no documento fiscal.</p>
        {value.routingMode === 'ALLOWLIST' && <EmailCedentePicker fundoId={fundoId} selected={value.cedenteIds} onChange={ids => update('cedenteIds', ids)} />}
      </>}
      {step === 4 && <>
        <label className="block space-y-1">A partir de quando ler os e-mails?<select className={emailSelectClass} value={preset} onChange={e => { setPreset(e.target.value); setDateReference(Date.now()); setConfirmed(false) }}><option value="NOW">A partir de agora</option><option value="DAY">Últimas 24 horas</option><option value="WEEK">Últimos 7 dias</option><option value="CUSTOM">Escolher data e hora</option></select></label>
        {preset === 'CUSTOM' && <label className="block space-y-1">Data e hora de Brasília (UTC−03:00)<Input type="datetime-local" value={customDate} onChange={e => { setCustomDate(e.target.value); setConfirmed(false) }} required={!value.startAt} />{value.startAt && !customDate && <span className="text-sm">Mantida: {emailDateLabel(value.startAt)}</span>}</label>}
        <p className="text-sm">Início calculado · Brasília: {previewStartAt ? emailDateLabel(previewStartAt) : 'Escolha uma data e hora válidas.'}</p>
        {previewStartAt && <details className="text-sm"><summary className="cursor-pointer">Ver horário em UTC</summary><time dateTime={previewStartAt}>{previewStartAt}</time></details>}
        <p className="rounded border p-3 text-sm">E-mails anteriores a esta data não serão importados. Depois de receber documentos, a data inicial só poderá avançar.</p>
      </>}
      {step === 5 && <>
        <p className="text-sm">Data inicial de leitura · Brasília: {emailDateLabel(previewStartAt)}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Nome</dt><dd>{value.name || 'Ainda não informado'}</dd></div><div><dt className="text-muted-foreground">Caixa</dt><dd className="break-all">{value.mailbox || 'Ainda não informada'}</dd></div><div><dt className="text-muted-foreground">Credencial</dt><dd>{credentials.find(c => c.id === value.credentialId)?.name ?? 'Selecionar depois'}</dd></div><div><dt className="text-muted-foreground">Cedentes</dt><dd>{value.routingMode === 'ALLOWLIST' ? `${value.cedenteIds.length} selecionado(s)` : 'Todos os ativos do fundo'}</dd></div></dl>
        <p className="text-sm">O rascunho ficará desativado. Depois de salvar, teste a conexão para liberar a ativação.</p>
      </>}
      <div className="space-y-4 border-t pt-5"><div className="rounded-lg bg-muted/30 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-primary" aria-hidden="true" />Confirmação para salvar</div><label className="block max-w-xs space-y-2">Código MFA para salvar<Input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" maxLength={6} pattern="[0-9]{6}" autoComplete="one-time-code" placeholder="6 dígitos do autenticador" /></label><p className="mt-2 text-xs text-muted-foreground">Informe o código quando estiver pronto para salvar. Você pode continuar preenchendo as etapas.</p></div>
        {initial && <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1" /><span className="text-sm">Conferi as alterações de credencial, cedentes e data inicial. O próximo processamento usará esta configuração após a ativação.</span></label>}
        <div className="flex flex-wrap gap-2"><Button className="min-h-11 px-4" type="button" variant="outline" disabled={step === 0} onClick={() => navigate(step - 1)}><ArrowLeft aria-hidden="true" />Voltar</Button>
          {step < 5 && <Button className="min-h-11 px-4" type="submit">Continuar<ArrowRight aria-hidden="true" /></Button>}
          <Button className="min-h-11 px-4 sm:ml-auto" type={step === 5 ? 'submit' : 'button'} variant={step === 5 ? 'default' : 'outline'} disabled={pending || !value.name.trim() || code.length !== 6} onClick={step === 5 ? undefined : save}><Save aria-hidden="true" />{pending ? 'Salvando…' : 'Salvar rascunho'}</Button></div>
      </div>
    </form>
    </div></div>
    {credentialOpen && <EmailCredentialDialog open fundoId={fundoId} environment={value.environment} onClose={() => setCredentialOpen(false)} onCreated={(id, name) => { setCredentials(old => [...old, { id, name, provider: 'OUTLOOK_GRAPH', environment: value.environment, status: 'ativa', lastTestAt: null }]); update('credentialId', id) }} />}
  </section>
}
