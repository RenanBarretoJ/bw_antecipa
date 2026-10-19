'use client'

import { useRef, useState, useTransition } from 'react'
import { diagnosticarCarteiraJsonVrs } from '@/app/admin/fundos/carteira-diagnostic-actions'
import type { CarteiraDiagnosticResult } from '@/lib/integracoes/vortx/carteira-diagnostic'
import { SensitiveConfirmDialog } from './sensitive-confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function VortxCarteiraDiagnostic({ fundoId, hoje }: { fundoId: string; hoje: string }) {
  const [dataCarteira, setDataCarteira] = useState(hoje)
  const [confirmar, setConfirmar] = useState(false)
  const [result, setResult] = useState<CarteiraDiagnosticResult | null>(null)
  const [pending, startTransition] = useTransition()
  const inFlight = useRef(false)
  function executar(mfaCode: string) {
    if (inFlight.current) return
    inFlight.current = true
    startTransition(async () => {
      try {
        setResult(await diagnosticarCarteiraJsonVrs({ fundoId, dataCarteira, mfaCode }))
      } catch {
        setResult({ success: false, message: 'Falha ao receber o resultado. Nao repita sem conferir a auditoria.' })
      } finally {
        inFlight.current = false
        setConfirmar(false)
      }
    })
  }
  return <section className="space-y-4 rounded-xl border border-border bg-card p-6">
    <p>Teste de compatibilidade: token do login VRS na API de Carteira JSON de producao da Vortx. Apenas consulta, sem importar dados ou enviar remessas.</p>
    <div className="max-w-xs space-y-2"><Label htmlFor="carteira-data">Data da carteira</Label><Input id="carteira-data" type="date" max={hoje} value={dataCarteira} disabled={pending} onChange={event => { setDataCarteira(event.target.value); setResult(null) }} /></div>
    <Button disabled={pending || !dataCarteira || result !== null} onClick={() => setConfirmar(true)}>Consultar uma vez com token VRS</Button>
    <p className="text-sm text-muted-foreground">Sem retentativa automatica. HTTP 200 vazio nao comprova dados disponiveis. HTTP 401/403 indica consulta negada; o retorno precisa ser analisado para distinguir autenticacao, permissao ou bloqueio da API.</p>
    {result ? <div role="status" aria-live="polite" className="space-y-3">
      {result.success ? <>
        <p className="font-semibold">Retorno HTTP {result.data.statusHttp}</p>
        <p className="break-all text-sm">{result.data.endpoint}</p>
        <p className="text-sm">Consultado em {result.data.consultadoEm}. {result.data.respostaRedigida ? 'Conteudo redigido ou limitado por seguranca.' : 'Tokens e credenciais nao incluidos.'}</p>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-4 text-xs">{result.data.resposta || '(resposta vazia)'}</pre>
        <Button variant="outline" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' }))
          const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'vortx-carteira-diagnostico.json'; anchor.click(); URL.revokeObjectURL(url)
        }}>Baixar resultado sanitizado</Button>
      </> : <p>{result.message}</p>}
    </div> : null}
    {confirmar ? <SensitiveConfirmDialog open onOpenChange={value => { if (!pending) setConfirmar(value) }} title="Consultar Carteira JSON" description="Confirma um login VRS e um unico GET da carteira deste Fundo. Nao envia remessas nem altera a carteira." confirmLabel="Confirmar e consultar" pending={pending} onConfirm={executar} /> : null}
  </section>
}
