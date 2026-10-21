'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, CalendarClock, FileUp, ShieldCheck, Wallet } from 'lucide-react'
import { solicitarRelatorioVortx } from '@/app/admin/fundos/relatorios-vortx-actions'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CentralBasesHistory, ResumoBases, dataCivil } from './central-bases-history'
import { formatCNPJ } from '@/lib/utils'
import type { FiltrosBases } from '@/lib/integracoes/vortx/central-bases'
import { prepararSolicitacaoRelatorioVortx } from '@/lib/integracoes/vortx/relatorios-contrato'
import { RELATORIOS_OPERADOR, podeSolicitarNovamente, relatorioDePosicao, situacaoRelatorio, type ContextoRelatorios, type HistoricoRelatorio, type RelatorioFormulario, type SolicitacaoRelatorio, type SolicitacaoRelatorioResult } from '@/lib/integracoes/vortx/relatorios-operacao'

export function VortxReportRequests({ contexto, historico, pagina, hoje, historicoHref = '', configuracaoHref, filtros, carteira, headingLevel = 2 }: {
  contexto: ContextoRelatorios; historico: HistoricoRelatorio; pagina: number; hoje: string; historicoHref?: string; configuracaoHref?: string
  filtros?: FiltrosBases; carteira?: ReactNode; headingLevel?: 1 | 2
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const inFlight = useRef(false)
  const resultRef = useRef<HTMLDivElement>(null)
  const [versaoId, setVersaoId] = useState(contexto.versoes[0]?.id || '')
  const [tipo, setTipo] = useState<RelatorioFormulario['tipo']>('PosicaoParcela')
  const [inicio, setInicio] = useState(() => {
    const data = new Date(`${hoje}T12:00:00Z`); data.setUTCDate(data.getUTCDate() - 7); return data.toISOString().slice(0, 10)
  })
  const [fim, setFim] = useState(hoje)
  const [referencia, setReferencia] = useState(hoje)
  const [extensao, setExtensao] = useState<1|2>(2)
  const [confirmacao, setConfirmacao] = useState<RelatorioFormulario|null>(null)
  const [erro, setErro] = useState('')
  const [result, setResult] = useState<SolicitacaoRelatorioResult|null>(null)
  const Title = headingLevel === 1 ? 'h1' : 'h2'
  useEffect(() => { if (result) resultRef.current?.focus() }, [result])
  const versao = contexto.versoes.find(v => v.id === versaoId)
  const descricao = RELATORIOS_OPERADOR.find(r => r.tipo === tipo)!
  const disponivel = contexto.podeSolicitar !== false && Boolean(versao?.capabilities.includes(descricao.capability))
  const confirmado = confirmacao && {
    descricao: RELATORIOS_OPERADOR.find(r => r.tipo === confirmacao.tipo)!,
    versao: contexto.versoes.find(v => v.id === confirmacao.versaoId),
  }

  function solicitarNovamente(row: SolicitacaoRelatorio) {
    if (contexto.podeSolicitar === false || !podeSolicitarNovamente(row) || pending) return
    setErro(''); setResult(null)
    setConfirmacao({ fundoId: contexto.fundo.id, versaoId: row.integracao_versao_id,
      tipo: row.pedido.tipoRelatorio, inicio: row.pedido.dataInicio, fim: row.pedido.dataFim,
      referencia: row.pedido.dataReferencia, extensao: row.pedido.extensaoArquivo,
      solicitacaoAnteriorId: row.id })
  }

  function revisar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErro(''); setResult(null)
    if (!versao || !disponivel) { setErro('Publique uma integração Vórtx com a funcionalidade deste relatório habilitada.'); return }
    try {
      const pedido = prepararSolicitacaoRelatorioVortx({ codigoCarteira: versao.carteira, tipoRelatorio: tipo,
        ...(!relatorioDePosicao(tipo) ? { dataInicio: inicio, dataFim: fim } : {}),
        dataReferencia: relatorioDePosicao(tipo) ? referencia : fim, extensaoArquivo: extensao }, hoje)
      setConfirmacao({ fundoId: contexto.fundo.id, versaoId, tipo, inicio: pedido.dataInicio, fim: pedido.dataFim, referencia: pedido.dataReferencia, extensao })
    } catch (error) { setErro(error instanceof Error ? error.message : 'Confira as datas do pedido.') }
  }

  function executar() {
    if (contexto.podeSolicitar === false || inFlight.current || !confirmacao) return
    inFlight.current = true
    const pedido = confirmacao
    startTransition(async () => {
      try {
        setResult(await solicitarRelatorioVortx(pedido))
        router.refresh()
      } catch {
        setResult({ success: false, message: 'A resposta não chegou ao navegador. Atualize o histórico e confira com o suporte antes de reenviar o pedido.' })
      } finally { inFlight.current = false; setConfirmacao(null) }
    })
  }

  return <div className="min-w-0 space-y-6">
    <section className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl space-y-2"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recebimento e processamento</p><Title className="text-2xl font-semibold tracking-tight sm:text-3xl">Central de Bases</Title><p className="text-sm leading-relaxed text-muted-foreground">Solicite bases pela integração e acompanhe cada etapa até os dados estarem prontos para uso.</p></div>
      <div className="flex flex-wrap gap-2"><a href="#importacao-bases" className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}><FileUp aria-hidden="true" />Importação manual</a><a href="#solicitar-bases" className={buttonVariants({ className: 'min-h-11' })}>Solicitar pela API<ArrowRight aria-hidden="true" /></a></div>
    </section>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm"><div className="min-w-0"><p className="font-semibold">{contexto.fundo.nome}</p><p className="mt-1 text-xs text-muted-foreground">{formatCNPJ(contexto.fundo.cnpj)} · Vórtx VRS 2.0</p></div><span className="text-xs text-muted-foreground">Fundo herdado do portal · sem nova seleção</span></div>
    <ResumoBases resumo={historico.resumo} />
    <nav aria-label="Seções da Central de Bases" className="flex flex-wrap gap-x-5 gap-y-1 border-b text-sm font-medium">{[
      ['historico-bases', 'Acompanhamento'], ['solicitar-bases', 'Nova solicitação'], ['importacao-bases', 'Importação manual'], ['carteira-bases', 'Carteira'],
    ].map(([id, label]) => <a key={id} href={`#${id}`} className="inline-flex min-h-11 items-center border-b-2 border-transparent text-muted-foreground hover:border-primary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">{label}</a>)}</nav>
    <CentralBasesHistory contexto={contexto} historico={historico} pagina={pagina} filtros={filtros} historicoHref={historicoHref} pending={pending} onRefresh={() => startTransition(() => router.refresh())} onRepeat={solicitarNovamente} />
    <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-4 text-sm"><ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" /><p className="leading-relaxed text-muted-foreground">Pedido aceito, arquivo recebido, download, processamento e publicação são etapas distintas. Ativo e parcela da mesma data são validados em conjunto e salvos como versão privada. A publicação nos módulos é separada; nenhuma remessa é enviada por esta tela.</p></div>
    {contexto.podeSolicitar === false && <p role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">Seu perfil permite acompanhar os relatórios deste Fundo, sem iniciar novas solicitações.</p>}
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
    <Card id="solicitar-bases" className="min-w-0 scroll-mt-6">
      <CardHeader><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Via integração</p><CardTitle>Solicitar uma nova base</CardTitle><CardDescription>A credencial e a carteira vêm da integração publicada deste Fundo.</CardDescription></CardHeader>
      <CardContent>
        {contexto.versoes.length === 0 ? <div className="space-y-3 rounded-lg border border-dashed p-6 text-sm"><p>Nenhuma integração Vórtx publicada com código de carteira válido para este Fundo.</p>{configuracaoHref ? <Link className="text-primary underline" href={configuracaoHref}>Configurar integração</Link> : <p className="text-muted-foreground">Peça ao administrador para conferir a configuração da integração deste Fundo.</p>}</div> :
          <form onSubmit={revisar} className="space-y-6">
            <fieldset disabled={pending || confirmacao !== null} className="space-y-5">
              <div className="space-y-2"><Label htmlFor="relatorio-versao">Integração publicada</Label><select id="relatorio-versao" value={versaoId} onChange={event => setVersaoId(event.target.value)} className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
                {contexto.versoes.map(v => <option key={v.id} value={v.id}>Vórtx VRS · versão {v.versao} · {v.ambiente === 'producao' ? 'Produção do provedor' : 'Homologação do provedor'}</option>)}
              </select><p className="break-all text-xs text-muted-foreground">Carteira VRS: {versao?.carteira}. Obtida da integração; não são os códigos de classe da Carteira JSON.</p></div>
              <fieldset><legend className="mb-3 text-sm font-medium">Relatório</legend><div className="grid gap-3 md:grid-cols-2">
                {RELATORIOS_OPERADOR.map(item => {
                  const habilitado = versao?.capabilities.includes(item.capability)
                  return <label key={item.tipo} className={`flex items-start gap-3 rounded-xl border p-4 ${tipo === item.tipo ? 'border-primary bg-primary/5' : 'border-border'} ${habilitado ? 'cursor-pointer' : 'opacity-60'}`}>
                    <input type="radio" name="tipoRelatorio" value={item.tipo} checked={tipo === item.tipo} disabled={!habilitado} onChange={() => setTipo(item.tipo)} className="mt-1 accent-primary" />
                    <span><span className="block text-sm font-semibold">{item.titulo}</span><span className="block text-xs text-muted-foreground">{item.subtitulo}</span><span className="mt-2 block text-sm text-muted-foreground">{item.descricao}</span>{!habilitado && <span className="mt-2 block text-xs font-medium">Não habilitado nesta integração</span>}</span>
                  </label>
                })}
              </div></fieldset>
              <div className="space-y-3"><h3 className="font-semibold">Informe as datas</h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {!relatorioDePosicao(tipo) && <>
                    <div className="space-y-2"><Label htmlFor="relatorio-inicio">Início do período</Label><Input required id="relatorio-inicio" type="date" max={hoje} value={inicio} onChange={event => setInicio(event.target.value)} /></div>
                    <div className="space-y-2"><Label htmlFor="relatorio-fim">Fim do período</Label><Input required id="relatorio-fim" type="date" max={hoje} value={fim} onChange={event => setFim(event.target.value)} /></div>
                  </>}
                  {relatorioDePosicao(tipo) && <div className="space-y-2"><Label htmlFor="relatorio-referencia">Data da posição</Label><Input required id="relatorio-referencia" type="date" max={hoje} value={referencia} onChange={event => setReferencia(event.target.value)} /></div>}
                </div>
                <p className="text-xs text-muted-foreground">{relatorioDePosicao(tipo) ? 'O estoque será consultado somente na data da posição. Não há período a selecionar.' : 'O período define os movimentos consultados. O fim deve ser posterior ao início.'} Não são aceitas datas futuras.</p>
              </div>
              <div className="max-w-xs space-y-2"><Label htmlFor="relatorio-formato">Formato do arquivo</Label><select id="relatorio-formato" value={extensao} onChange={event => setExtensao(event.target.value === '1' ? 1 : 2)} className="h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="2">CSV (.csv) — recomendado</option><option value="1">Excel (.xlsx)</option></select></div>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex flex-wrap items-center gap-3 border-t pt-5"><Button type="submit" disabled={!disponivel}>Revisar e solicitar<ArrowRight className="size-4" /></Button><p className="text-xs text-muted-foreground">Confira o resumo antes de enviar. Não exige código TOTP adicional.</p></div>
            </fieldset>
          </form>}
      </CardContent>
    </Card>
    <div className="min-w-0 space-y-5">
      <Card id="importacao-bases" className="scroll-mt-6"><CardHeader><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Alternativa à API</p><CardTitle className="flex items-center gap-2"><FileUp aria-hidden="true" className="size-5" />Importação manual</CardTitle><CardDescription>Arquivos precisam seguir o layout do provedor deste Fundo.</CardDescription></CardHeader><CardContent className="space-y-4 text-sm"><p>Para estoque Vórtx, são necessários os CSVs de posição de ativo e parcela da mesma carteira e data.</p><div role="status" className="rounded-xl border border-dashed bg-muted/30 p-4 leading-relaxed text-muted-foreground">O envio manual de arquivos Vórtx ainda não está conectado nesta tela. O importador CSV legado foi preservado para os demais provedores e não deve ser usado para estes arquivos. Enquanto isso, use a solicitação pela API.</div><p className="text-xs text-muted-foreground">Nenhum arquivo será enviado a um parser incompatível ou publicado automaticamente.</p></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarClock aria-hidden="true" className="size-5" />Atualização diária D−1</CardTitle><CardDescription>9h30 de Brasília · dias úteis, excluindo feriados ANBIMA.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><p>Estoque consolidado, estoque por parcela, cessões e exclusões do dia útil anterior.</p><p className="text-muted-foreground">A rotina está preparada. A agenda Vercel executa apenas no deployment de produção; nesta Preview, o disparo é técnico e controlado. A rotina não publica estoque nem registra baixas financeiras.</p></CardContent></Card>
    </div></div>
    {result && <div ref={resultRef} tabIndex={-1} role="status" aria-live="polite" className="rounded-xl border bg-card p-4 text-sm focus-visible:outline-2 focus-visible:outline-ring">
      {result.success ? <><p className="font-semibold">{!result.criada ? 'Pedido idêntico já registrado — não reenviado' : situacaoRelatorio(result.solicitacao).titulo}</p><p className="mt-1 text-muted-foreground">{situacaoRelatorio(result.solicitacao).descricao}</p>{result.solicitacao.protocolo_externo && <p className="mt-2 break-all font-mono text-xs">Protocolo Vórtx: {result.solicitacao.protocolo_externo}</p>}</> : <p>{result.message}</p>}
      {result.success && !result.criada && contexto.podeSolicitar !== false && podeSolicitarNovamente(result.solicitacao) && <Button type="button" variant="outline" className="mt-3 min-h-11" disabled={pending} onClick={() => solicitarNovamente(result.solicitacao)}>Solicitar uma versão atualizada</Button>}
    </div>}
    <Card id="carteira-bases" className="min-w-0 scroll-mt-6"><CardHeader><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Posição patrimonial</p><CardTitle className="flex items-center gap-2"><Wallet aria-hidden="true" className="size-5" />Carteira na mesma central</CardTitle><CardDescription>A Carteira JSON é distinta do estoque de parcelas. Consultar não importa nem publica dados.</CardDescription></CardHeader><CardContent>{carteira || <p role="status" className="rounded-xl border border-dashed p-4 text-sm leading-relaxed text-muted-foreground">O processamento operacional da carteira ainda não está conectado. A consulta diagnóstica existente continua restrita ao administrador autorizado; nenhum valor de carteira é inferido dos relatórios de estoque.</p>}</CardContent></Card>
    {confirmacao && <Dialog open onOpenChange={value => { if (!pending && !value) setConfirmacao(null) }}><DialogContent><DialogHeader><DialogTitle>{confirmacao.solicitacaoAnteriorId ? 'Solicitar uma versão atualizada' : 'Confirmar solicitação de relatório'}</DialogTitle><DialogDescription>{confirmacao.solicitacaoAnteriorId ? 'Um novo pedido, com os mesmos parâmetros, sem apagar o anterior. Se o retorno anterior foi indeterminado, os dois poderão chegar. Nenhum estoque é publicado automaticamente.' : 'Um pedido à Vórtx, sem envio de cessão. Pedidos idênticos são bloqueados; uma nova consulta deve ser confirmada pelo histórico.'}</DialogDescription></DialogHeader>
      <dl className="space-y-2 rounded-lg bg-muted p-4 text-sm"><div><dt className="text-xs text-muted-foreground">Fundo</dt><dd>{contexto.fundo.nome}</dd></div><div><dt className="text-xs text-muted-foreground">Relatório · ambiente do provedor</dt><dd>{confirmado?.descricao.titulo} · {confirmado?.versao?.ambiente === 'producao' ? 'Produção' : 'Homologação'}</dd></div><div><dt className="text-xs text-muted-foreground">{relatorioDePosicao(confirmacao.tipo) ? 'Data da posição · formato' : 'Período · formato'}</dt><dd>{relatorioDePosicao(confirmacao.tipo) ? dataCivil(confirmacao.referencia) : `${dataCivil(confirmacao.inicio)} a ${dataCivil(confirmacao.fim)}`} · {confirmacao.extensao === 2 ? 'CSV' : 'Excel'}</dd></div></dl>
      <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmacao(null)}>Cancelar</Button><Button type="button" disabled={pending} onClick={executar}>{pending ? 'Solicitando uma vez…' : 'Confirmar e solicitar'}</Button></DialogFooter></DialogContent></Dialog>}
  </div>
}
