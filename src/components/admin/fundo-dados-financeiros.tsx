'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Database, FileUp, Loader2 } from 'lucide-react'
import { importarBaseFinanceiraAction, publicarBaseFinanceiraAction, registrarBaseSemMovimentoAction } from '@/app/admin/fundos/dados-financeiros-actions'
import { SensitiveConfirmDialog } from '@/components/admin/sensitive-confirm-dialog'
import { EmptyState, StatusBadge } from '@/components/data-display/primitives'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AdminDadosFinanceirosFundo } from '@/lib/admin/dados-financeiros'
import { TIPOS_BASE_FINANCEIROS } from '@/lib/financeiro/ingestao/types'

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Nao publicada'
const formatValue = (value: string | number | null) => value == null ? 'Nao calculado' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value))

export function FundoDadosFinanceiros({ state }: { state: AdminDadosFinanceirosFundo }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [pending, startTransition] = useTransition()
  const [publishId, setPublishId] = useState<string | null>(null)

  function upload(formData: FormData) {
    startTransition(async () => {
      const result = await importarBaseFinanceiraAction(formData)
      notifications.fromActionResult(result)
      if (result.success) router.refresh()
    })
  }

  function publish(mfaCode: string) {
    if (!publishId) return
    startTransition(async () => {
      const result = await publicarBaseFinanceiraAction({ fundoId: state.fundoId, importacaoId: publishId, mfaCode })
      notifications.fromActionResult(result)
      if (result.success) { setPublishId(null); router.refresh() }
    })
  }

  function declareEmpty(formData: FormData) {
    startTransition(async () => {
      const result = await registrarBaseSemMovimentoAction(Object.fromEntries(formData.entries()))
      notifications.fromActionResult(result)
      if (result.success) router.refresh()
    })
  }

  return <div className="space-y-5">
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Database className="size-5" />Bases financeiras vigentes</CardTitle><CardDescription>Somente publicacoes atomicas aparecem como fonte canonica. Arquivos e staging permanecem restritos ao Super Admin.</CardDescription></CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {TIPOS_BASE_FINANCEIROS.map((type) => {
          const item = state.vigentes[type]
          return <div key={type} className="rounded-xl border border-border p-4"><p className="text-xs font-semibold tracking-wide text-muted-foreground">{type}</p><p className="mt-2 font-semibold">{item ? item.data_referencia : 'Nao publicada'}</p><p className="text-sm text-muted-foreground">{item ? `${item.linhas_publicadas} linhas · ${formatValue(item.valor_total)}` : 'Sem base vigente'}</p><p className="mt-1 truncate text-xs text-muted-foreground" title={item?.fonte || 'Nao configurada'}>Fonte: {item?.fonte || 'Nao configurada'}</p></div>
        })}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Importacao manual</CardTitle><CardDescription>O arquivo bruto e preservado de forma privada. A validacao nao publica dados automaticamente.</CardDescription></CardHeader>
      <CardContent><form action={upload} className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <input type="hidden" name="fundoId" value={state.fundoId} />
        <label className="space-y-1"><Label>Base</Label><select name="tipoBase" required className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">{TIPOS_BASE_FINANCEIROS.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label className="space-y-1"><Label>Data de referencia</Label><Input name="dataReferencia" type="date" required /></label>
        <label className="space-y-1"><Label>Provedor</Label><Input name="provedor" defaultValue="rlx" required pattern="[a-zA-Z0-9._-]+" /></label>
        <label className="space-y-1 xl:col-span-2"><Label>Arquivo CSV</Label><Input name="arquivo" type="file" accept=".csv,text/csv,text/plain" required /></label>
        <Button type="submit" disabled={pending} className="md:w-fit">{pending ? <Loader2 className="animate-spin" /> : <FileUp />}Validar arquivo</Button>
      </form></CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Declarar base sem movimento</CardTitle><CardDescription>Disponivel somente para Aquisicoes e Liquidacoes. A declaracao nao cria arquivo ficticio e exige publicacao posterior com MFA.</CardDescription></CardHeader>
      <CardContent><form action={declareEmpty} className="grid gap-3 md:grid-cols-4 md:items-end">
        <input type="hidden" name="fundoId" value={state.fundoId} />
        <label className="space-y-1"><Label>Base</Label><select name="tipoBase" required className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="AQUISICOES">AQUISICOES</option><option value="LIQUIDACOES">LIQUIDACOES</option></select></label>
        <label className="space-y-1"><Label>Data de referencia</Label><Input name="dataReferencia" type="date" required /></label>
        <label className="space-y-1"><Label>Provedor</Label><Input name="provedor" defaultValue="rlx" required pattern="[a-zA-Z0-9._-]+" /></label>
        <Button type="submit" variant="outline" disabled={pending}>Registrar sem movimento</Button>
      </form></CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Historico de importacoes</CardTitle><CardDescription>Retificacoes, falhas e duplicidades permanecem rastreaveis.</CardDescription></CardHeader>
      <CardContent>{state.importacoes.length === 0 ? <EmptyState title="Nenhum dado financeiro importado" description="Carteira, Estoque, Aquisições e Liquidações ainda não possuem posição publicada para este fundo." icon={Database} /> : <div className="divide-y divide-border">{state.importacoes.map((item) => {
        const retificaraPublicacao = item.status === 'VALIDA' && state.importacoes.some((other) => other.id !== item.id && other.status === 'PUBLICADA' && other.tipo_base === item.tipo_base && other.data_referencia === item.data_referencia)
        return <div key={item.id} className="grid gap-3 py-3 md:grid-cols-[110px_120px_minmax(0,1fr)_140px_auto] md:items-center">
        <div><p className="font-semibold">{item.tipo_base}</p><p className="text-xs text-muted-foreground">{item.data_referencia}</p></div>
        <StatusBadge status={item.status === 'PUBLICADA' ? 'ativo' : item.status === 'VALIDA' ? 'pendente' : item.status === 'FALHA' ? 'rejeitado' : 'desativada'} label={item.status} />
        <div className="min-w-0"><p className="truncate text-sm font-medium" title={item.nome_arquivo || 'Declaracao sem movimento'}>{item.nome_arquivo || 'Declaracao sem movimento'}</p><p className="truncate text-xs text-muted-foreground" title={item.fonte}>Fonte: {item.fonte}</p><p className="text-xs text-muted-foreground">{item.layout_nome} · {item.encoding_detectado}</p><p className="text-xs text-muted-foreground">{item.linhas_validas}/{item.linhas_total} validas · {item.linhas_invalidas} invalidas · {item.linhas_warning} avisos</p><p className="truncate font-mono text-[10px] text-muted-foreground" title={item.hash_conteudo}>SHA-256 {item.hash_conteudo}</p>{item.substitui_importacao_id && <p className="text-xs text-warning">Retifica uma publicacao anterior.</p>}{retificaraPublicacao && <p className="text-xs font-medium text-warning">Já existe uma publicação para esta base e data. A versão vigente será preservada como retificada.</p>}{(item.erros.length > 0 || item.amostras_linhas.length > 0) && <details className="text-xs text-destructive"><summary className="cursor-pointer">Ver inconsistencias</summary>{item.erros.length > 0 && <pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(item.erros, null, 2)}</pre>}{item.amostras_linhas.map((sample) => <div key={sample.numero_linha} className="mt-1 rounded border border-destructive/20 p-2"><p className="font-medium">Linha {sample.numero_linha} · {sample.status}</p><p className="whitespace-pre-wrap">{[...sample.erros, ...sample.avisos].map(String).join(' · ')}</p></div>)}</details>}</div>
        <div className="text-xs text-muted-foreground"><p>{formatValue(item.valor_total)}</p><p>{formatDate(item.publicada_em || item.recebida_em)}</p></div>
        {item.status === 'VALIDA' && <Button size="sm" onClick={() => setPublishId(item.id)}>Publicar</Button>}
      </div>})}</div>}</CardContent>
    </Card>
    {publishId && <SensitiveConfirmDialog open onOpenChange={(open) => !open && setPublishId(null)} title="Publicar base financeira" description="A publicacao substitui atomicamente a base vigente do mesmo fundo, tipo e data. O historico anterior sera preservado como retificacao." confirmLabel="Publicar" pending={pending} onConfirm={publish} />}
  </div>
}
