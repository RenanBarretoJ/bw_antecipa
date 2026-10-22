'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { processarCarteiraVortxAction } from '@/app/gestor/dados-financeiros/carteira-actions'
import type { PosicaoCarteiraVortx, ProcessamentoCarteiraResult } from '@/lib/integracoes/vortx/carteira-operacao'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import styles from './central-bases.module.css'

const money = (value: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value))
export function VortxCarteiraOperacional({ hoje, referenciaInicial, habilitada, podeProcessar, posicaoInicial, capacidadePublicada = true, processarAction = processarCarteiraVortxAction }: {
  hoje: string; referenciaInicial: string; habilitada: boolean; podeProcessar: boolean; posicaoInicial: PosicaoCarteiraVortx | null
  processarAction?: (input: unknown) => Promise<ProcessamentoCarteiraResult>
  capacidadePublicada?: boolean
}) {
  const router = useRouter()
  const [referencia, setReferencia] = useState(referenciaInicial)
  const [result, setResult] = useState<ProcessamentoCarteiraResult | null>(null)
  const [pending, startTransition] = useTransition()
  const inFlight = useRef(false)
  // A missing quota/result never replaces the last canonical publication shown below.
  const posicao = result?.success && (result.estado === 'PUBLICADA' || result.estado === 'JA_REGISTRADA')
    && result.posicao.dataReferencia >= (posicaoInicial?.dataReferencia ?? '') ? result.posicao : posicaoInicial
  function processar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || !habilitada || !podeProcessar || !capacidadePublicada) return
    inFlight.current = true
    startTransition(async () => {
      try {
        const resposta = await processarAction({ dataReferencia: referencia })
        setResult(resposta)
        if (resposta.success && resposta.estado === 'PUBLICADA') router.refresh()
      } catch { setResult({ success: false, message: 'A resposta não foi confirmada. Atualize a página e confira a posição publicada antes de tentar novamente.' }) }
      finally { inFlight.current = false }
    })
  }
  return <div className="space-y-4" data-carteira-operacional>
    <p className={styles.caption}>Carteira D−1 útil, excluindo feriados ANBIMA. Consulta automática às 17h de Brasília, separada do estoque das 9h30. O horário não garante disponibilidade: todas as cotas configuradas precisam estar presentes.</p>
    <div className={styles.stats}>
      <div className={styles.stat}><small>Última posição publicada</small><p>{posicao?.dataReferencia.split('-').reverse().join('/') ?? 'Sem posição'}</p></div>
      <div className={styles.stat}><small>Cotas consolidadas</small><p>{posicao ? `${posicao.cotas.length} cotas` : '—'}</p></div>
      <div className={styles.stat}><small>PL total publicado</small><p>{posicao ? money(posicao.patrimonioLiquidoTotal) : '—'}</p></div>
    </div>
    {posicao && <details className={styles.advanced}><summary>Conferir o PL por cota</summary><dl className="grid gap-2 sm:grid-cols-2">{posicao.cotas.map(cota => <div key={cota.codigoCarteira}><dt>{cota.rotulo} · {cota.codigoCarteira}</dt><dd className="font-semibold">{money(cota.patrimonioLiquido)}</dd></div>)}</dl></details>}
    <form id="carteira-processamento" onSubmit={processar} aria-label="Processar carteira do Fundo ativo" aria-busy={pending}>
      <fieldset disabled={pending || !habilitada || !podeProcessar || !capacidadePublicada} className="space-y-3">
        <div className={styles.fields}><label htmlFor="carteira-posicao-data">Data da posição<Input id="carteira-posicao-data" type="date" required max={hoje} value={referencia} onChange={event => { setReferencia(event.target.value); setResult(null) }} /></label></div>
        <p className={styles.caption}>Consulta a API uma vez e publica o PL somente se a carteira estiver completa. Não envia remessas, não registra aquisições e não exige código TOTP adicional.</p>
        <Button type="submit" className={styles.button + ' ' + styles.primary}>{pending ? 'Consultando e conferindo cotas…' : 'Consultar e publicar carteira completa'}</Button>
      </fieldset>
    </form>
    {!habilitada && <p className={styles.caption}>O processamento operacional ainda não foi habilitado neste ambiente.</p>}
    {habilitada && !podeProcessar && <p className={styles.caption}>Seu acesso permite acompanhar a carteira, sem iniciar o processamento.</p>}
    {habilitada && podeProcessar && !capacidadePublicada && <p role="status" className={styles.caption}>Configuração pendente: publique a capacidade Carteira na integração deste Fundo, mantendo todas as cotas esperadas. Nenhuma consulta à Vórtx foi enviada.</p>}
    <div role="status" aria-live="polite" aria-atomic="true">
      {pending ? <p>Consultando a Vórtx e verificando todas as cotas. Aguarde a confirmação.</p> : result && (!result.success ? <p>{result.message}</p>
        : result.estado === 'AGUARDANDO_COTAS' ? <div><p className="font-semibold">Aguardando cotas da posição de {result.dataReferencia.split('-').reverse().join('/')}</p><p>Faltam: {result.cotasPendentes.map(cota => `${cota.rotulo} (${cota.codigoCarteira})`).join(', ')}.</p><p>Nenhum PL parcial foi publicado. A última posição permanece preservada; consulte novamente após a liberação pela Vórtx.</p></div>
          : result.estado === 'CONFIGURACAO_PENDENTE' ? <p>Peça ao administrador para publicar a capacidade Carteira com a lista completa de cotas esperadas.</p>
            : result.estado === 'REVISAO_NECESSARIA' ? <p>A resposta precisa de conferência. O PL vigente não foi substituído por esta consulta.</p>
              : result.estado === 'CONTEUDO_HISTORICO' ? <p>Este conteúdo já consta no histórico. Uma posição retificada não foi reativada; o PL vigente foi preservado.</p>
                : <p>{result.estado === 'PUBLICADA' ? 'Carteira completa publicada com sucesso.' : 'Carteira já registrada. Nenhuma publicação duplicada foi criada.'}</p>)}
    </div>
  </div>
}
