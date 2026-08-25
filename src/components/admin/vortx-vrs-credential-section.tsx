'use client'

import { type FormEvent, useState, useTransition } from 'react'
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import { configurarCredencialVortxVrsAdmin, testarConexaoVortxVrsAdmin } from '@/app/admin/fundos/vortx-vrs-actions'
import { SensitiveConfirmDialog } from '@/components/admin/sensitive-confirm-dialog'
import { StatusBadge } from '@/components/data-display/primitives'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { VortxAmbiente, VortxConfiguracaoStatus } from '@/lib/admin/vortx-vrs'

const AMBIENTES: VortxAmbiente[] = ['homologacao', 'producao']
const AMBIENTE_LABEL: Record<VortxAmbiente, string> = { homologacao: 'Homologação', producao: 'Produção' }
const dataHora = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))

type CredencialFormValues = { baseUrl: string; key: string; secret: string; certFile: File | null; keyFile: File | null }
type TesteResultado = { status: 'sucesso' | 'erro'; mensagem: string; expiraEm?: string; horario: string }

async function lerArquivoComoTexto(file: File | null): Promise<string> {
  if (!file) return ''
  return file.text()
}

function CredentialForm({
  ambiente,
  baseUrlPadrao,
  pending,
  onSubmit,
  onCancel,
}: {
  ambiente: VortxAmbiente
  baseUrlPadrao: string
  pending: boolean
  onSubmit: (values: CredencialFormValues) => void
  onCancel: () => void
}) {
  const [baseUrl, setBaseUrl] = useState(baseUrlPadrao)
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [certFile, setCertFile] = useState<File | null>(null)
  const [keyFile, setKeyFile] = useState<File | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    onSubmit({ baseUrl, key, secret, certFile, keyFile })
  }

  return <form onSubmit={handleSubmit} className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 md:grid-cols-2">
    <div className="md:col-span-2"><p className="font-semibold">Configurar credencial Vórtx VRS — {AMBIENTE_LABEL[ambiente]}</p><p className="text-xs text-muted-foreground">Key, Secret, certificado e chave privada nunca sao reexibidos apos salvos. Informe os 4 novamente para substituir.</p></div>
    <label className="space-y-1"><Label>Base URL</Label><Input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api-stg.vortx.com.br" required /></label>
    <label className="space-y-1"><Label>Key</Label><Input type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" required /></label>
    <label className="space-y-1"><Label>Secret</Label><Input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="off" required /></label>
    <label className="space-y-1"><Label>Certificado mTLS (.pem)</Label><Input type="file" accept=".pem" onChange={(event) => setCertFile(event.target.files?.[0] || null)} required /><span className="block text-xs text-muted-foreground">{certFile ? certFile.name : 'Nenhum arquivo selecionado'}</span></label>
    <label className="space-y-1"><Label>Chave privada mTLS (.key)</Label><Input type="file" accept=".key" onChange={(event) => setKeyFile(event.target.files?.[0] || null)} required /><span className="block text-xs text-muted-foreground">{keyFile ? keyFile.name : 'Nenhum arquivo selecionado'}</span></label>
    <div className="flex items-end gap-2 md:col-span-2"><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Continuar</Button><Button type="button" variant="outline" onClick={onCancel} disabled={pending}>Cancelar</Button></div>
  </form>
}

export function VortxCredentialSection({
  fundoId,
  vortxConfig,
  onChanged,
}: {
  fundoId: string
  vortxConfig: VortxConfiguracaoStatus[]
  onChanged: () => void
}) {
  const notifications = useNotifications()
  const [pending, startTransition] = useTransition()
  const [formAmbiente, setFormAmbiente] = useState<VortxAmbiente | null>(null)
  const [pendingCredencial, setPendingCredencial] = useState<{ ambiente: VortxAmbiente; values: CredencialFormValues } | null>(null)
  const [testeConfirmAmbiente, setTesteConfirmAmbiente] = useState<VortxAmbiente | null>(null)
  const [resultados, setResultados] = useState<Partial<Record<VortxAmbiente, TesteResultado>>>({})

  function configuracaoDoAmbiente(ambiente: VortxAmbiente) {
    return vortxConfig.find((item) => item.ambiente === ambiente && item.status === 'ativa') || null
  }

  function confirmarCredencial(mfaCode: string) {
    if (!pendingCredencial) return
    startTransition(async () => {
      const { ambiente, values } = pendingCredencial
      const [certificadoPem, chavePrivadaPem] = await Promise.all([lerArquivoComoTexto(values.certFile), lerArquivoComoTexto(values.keyFile)])
      const result = await configurarCredencialVortxVrsAdmin({
        fundoId, ambiente, baseUrl: values.baseUrl, key: values.key, secret: values.secret, certificadoPem, chavePrivadaPem, mfaCode,
      })
      notifications.fromActionResult(result)
      if (result.success) {
        setFormAmbiente(null)
        setPendingCredencial(null)
        setResultados((current) => ({ ...current, [ambiente]: undefined }))
        onChanged()
      }
    })
  }

  function confirmarTeste(mfaCode: string) {
    if (!testeConfirmAmbiente) return
    const ambiente = testeConfirmAmbiente
    startTransition(async () => {
      const result = await testarConexaoVortxVrsAdmin({ fundoId, ambiente, mfaCode })
      notifications.fromActionResult(result)
      setResultados((current) => ({
        ...current,
        [ambiente]: {
          status: result.success ? 'sucesso' : 'erro',
          mensagem: result.message,
          expiraEm: result.data?.expiraEm,
          horario: new Date().toISOString(),
        },
      }))
      setTesteConfirmAmbiente(null)
    })
  }

  return <div className="space-y-3">
    {AMBIENTES.map((ambiente) => {
      const config = configuracaoDoAmbiente(ambiente)
      const resultado = resultados[ambiente]
      const estado = resultado?.status === 'sucesso' ? 'Conexão validada' : resultado?.status === 'erro' ? 'Erro no último teste' : config ? 'Configurado' : 'Não configurado'
      return <div key={ambiente} className="rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><p className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4" />Vórtx — VRS 2.0 · {AMBIENTE_LABEL[ambiente]}</p><p className="text-xs text-muted-foreground">{config ? `Configurada em ${dataHora(config.criada_em)}` : 'Nenhuma credencial ativa'}</p></div>
          <StatusBadge status={resultado?.status === 'sucesso' ? 'ativo' : resultado?.status === 'erro' ? 'reprovada' : config ? 'ativo' : 'pendente'} label={estado} />
        </div>
        {config && <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <div><dt className="font-medium text-foreground">Credencial</dt><dd>Configurada</dd></div>
          <div><dt className="font-medium text-foreground">Certificado</dt><dd>Configurado</dd></div>
          <div><dt className="font-medium text-foreground">Chave privada</dt><dd>Configurada</dd></div>
        </dl>}
        {resultado && <p className={`mt-2 flex items-center gap-2 text-xs ${resultado.status === 'sucesso' ? 'text-success-foreground' : 'text-destructive'}`}>
          {resultado.status === 'sucesso' ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
          {resultado.mensagem} · testado em {dataHora(resultado.horario)}{resultado.expiraEm ? ` · expira em ${dataHora(resultado.expiraEm)}` : ''}
        </p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setFormAmbiente(formAmbiente === ambiente ? null : ambiente)} disabled={pending}>{config ? 'Substituir credencial' : 'Configurar credencial'}</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setTesteConfirmAmbiente(ambiente)} disabled={!config || pending}>Testar conexão</Button>
        </div>
        {formAmbiente === ambiente && <div className="mt-3">
          <CredentialForm ambiente={ambiente} baseUrlPadrao={config?.base_url || (ambiente === 'homologacao' ? 'https://api-stg.vortx.com.br' : '')} pending={pending} onSubmit={(values) => setPendingCredencial({ ambiente, values })} onCancel={() => setFormAmbiente(null)} />
        </div>}
      </div>
    })}

    {pendingCredencial && <SensitiveConfirmDialog
      open
      onOpenChange={(open) => !open && setPendingCredencial(null)}
      title="Confirmar credencial Vórtx VRS"
      description="A credencial anterior deste ambiente sera revogada e substituida imediatamente por esta."
      confirmLabel="Salvar credencial"
      pendingLabel="Salvando..."
      pending={pending}
      onConfirm={confirmarCredencial}
    />}

    {testeConfirmAmbiente && <SensitiveConfirmDialog
      open
      onOpenChange={(open) => !open && setTesteConfirmAmbiente(null)}
      title="Testar conexão Vórtx VRS"
      description="Executa um login real (mTLS + VRS Auth V2) contra o ambiente selecionado. O token nunca e exibido."
      confirmLabel="Executar teste"
      pendingLabel="Testando..."
      pending={pending}
      onConfirm={confirmarTeste}
    />}
  </div>
}
