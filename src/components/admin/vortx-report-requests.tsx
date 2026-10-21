'use client'

import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, ClipboardList, RefreshCw, ShieldCheck } from 'lucide-react'
import { solicitarRelatorioVortx } from '@/app/admin/fundos/relatorios-vortx-actions'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { formatCNPJ } from '@/lib/utils'
import { acompanharRelatorio } from '@/lib/integracoes/vortx/relatorios-acompanhamento'
import { prepararSolicitacaoRelatorioVortx } from '@/lib/integracoes/vortx/relatorios-contrato'
import { RELATORIOS_OPERADOR, podeSolicitarNovamente, relatorioDePosicao, situacaoRelatorio, type ContextoRelatorios, type HistoricoRelatorio, type RelatorioFormulario, type SolicitacaoRelatorio, type SolicitacaoRelatorioResult } from '@/lib/integracoes/vortx/relatorios-operacao'

const dataCivil = (data: string) => data.split('-').reverse().join('/')
const instante = (data: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(data))

export function VortxReportRequests({ contexto, historico, pagina, hoje, historicoHref = '', configuracaoHref }: {
  contexto: ContextoRelatorios; historico: HistoricoRelatorio; pagina: number; hoje: string; historicoHref?: string; configuracaoHref?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const inFlight = useRef(false)
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
  const versao = contexto.versoes.find(v => v.id === versaoId)
  const descricao = RELATORIOS_OPERADOR.find(r => r.tipo === tipo)!
  const disponivel = contexto.podeSolicitar !== false && Boolean(versao?.capabilities.includes(descricao.capability))
  const totalPaginas = Math.max(1, Math.ceil(historico.total / 20))
  const hrefPagina = (value: number) => `${historicoHref}${historicoHref.includes('?') ? '&' : '?'}pagina=${value}`
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

  return <div className="space-y-6">
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 shrink-0" />Relatórios do Fundo · Vórtx VRS</p>
      <p className="mt-1 text-muted-foreground">O pedido usa a credencial do ambiente indicado abaixo e não envia remessas. Quando os dois relatórios de estoque da mesma data chegam, o sistema valida e salva uma versão privada. A publicação nos módulos é uma etapa separada.</p>
    </div>
    <Card><CardHeader><CardTitle>Atualização diária D−1</CardTitle><CardDescription>9h30 de Brasília · dias úteis, excluindo feriados ANBIMA.</CardDescription></CardHeader><CardContent className="space-y-2 text-sm"><p>Estoque consolidado, estoque por parcela, cessões e exclusões do dia útil anterior.</p><p className="text-muted-foreground">A rotina está preparada. A agenda Vercel executa apenas no deployment de produção; nesta Preview, o disparo é técnico e controlado. A rotina não publica estoque nem registra baixas financeiras.</p></CardContent></Card>
    {contexto.podeSolicitar === false && <p role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">Seu perfil permite acompanhar os relatórios deste Fundo, sem iniciar novas solicitações.</p>}
    <Card>
      <CardHeader><CardTitle>1. Escolha o que deseja conferir</CardTitle><CardDescription>{contexto.fundo.nome} · {formatCNPJ(contexto.fundo.cnpj)}</CardDescription></CardHeader>
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
              <div className="space-y-3"><h2 className="font-semibold">2. Informe as datas</h2>
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
    {result && <div role="status" aria-live="polite" className="rounded-xl border bg-card p-4 text-sm">
      {result.success ? <><p className="font-semibold">{!result.criada ? 'Pedido idêntico já registrado — não reenviado' : situacaoRelatorio(result.solicitacao).titulo}</p><p className="mt-1 text-muted-foreground">{situacaoRelatorio(result.solicitacao).descricao}</p>{result.solicitacao.protocolo_externo && <p className="mt-2 break-all font-mono text-xs">Protocolo Vórtx: {result.solicitacao.protocolo_externo}</p>}</> : <p>{result.message}</p>}
      {result.success && !result.criada && contexto.podeSolicitar !== false && podeSolicitarNovamente(result.solicitacao) && <Button type="button" variant="outline" className="mt-3 min-h-11" disabled={pending} onClick={() => solicitarNovamente(result.solicitacao)}>Solicitar uma versão atualizada</Button>}
    </div>}
    <Card>
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><ClipboardList className="size-5" />3. Acompanhe os pedidos</CardTitle><CardDescription>{historico.total} pedido(s) neste Fundo · histórico e versões anteriores preservados.</CardDescription></div><Button type="button" variant="outline" disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw className={`size-4 ${pending ? 'animate-spin' : ''}`} />Atualizar histórico</Button></div></CardHeader>
      <CardContent className="space-y-4">
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">O protocolo confirma o pedido, não a importação. Para obter uma correção da mesma data, use “Solicitar novamente”. O pedido anterior não será apagado e arquivos idênticos não duplicarão o estoque. Para conferir uma posição corrigida, solicite ativo e parcela da mesma data. Atualizar esta lista não refaz consultas na Vórtx.</p>
        {historico.solicitacoes.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center"><ClipboardList className="mx-auto mb-3 size-7 text-muted-foreground" /><p className="font-medium">Nenhum pedido nesta página</p><p className="mt-1 text-sm text-muted-foreground">Escolha um relatório acima para começar. Abrir esta tela não faz solicitações automaticamente.</p></div> :
          <div className="divide-y rounded-xl border">{historico.solicitacoes.map(row => {
            const situacao = acompanharRelatorio(row)
            return <article key={row.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold">{RELATORIOS_OPERADOR.find(r => r.tipo === row.pedido.tipoRelatorio)?.titulo}</h3><p className="text-xs text-muted-foreground">Solicitado em {instante(row.criada_em)} · {row.ambiente === 'producao' ? 'Produção do provedor' : 'Homologação do provedor'}</p></div><Badge variant={situacao.tom === 'erro' ? 'destructive' : 'outline'}>{situacao.titulo}</Badge></div>
              <p className="text-sm">{relatorioDePosicao(row.pedido.tipoRelatorio) ? `Posição de ${dataCivil(row.pedido.dataReferencia)}` : `${dataCivil(row.pedido.dataInicio)} a ${dataCivil(row.pedido.dataFim)}`} · {row.pedido.extensaoArquivo === 2 ? 'CSV' : 'Excel'}</p>
              <p className="text-sm text-muted-foreground">{situacao.descricao}</p>
              {row.acompanhamento && <dl className="grid gap-3 rounded-lg bg-muted p-3 text-xs sm:grid-cols-3"><div><dt className="font-medium">Recebimento do callback</dt><dd>{row.acompanhamento.recebidoEm ? instante(row.acompanhamento.recebidoEm) : 'Aguardando'}</dd></div><div><dt className="font-medium">Download concluído</dt><dd>{row.acompanhamento.downloadEm ? instante(row.acompanhamento.downloadEm) : row.acompanhamento.processadoEm ? 'Confirmado pela importação · horário não registrado' : 'Ainda não confirmado'}</dd></div><div><dt className="font-medium">Processamento concluído</dt><dd>{row.acompanhamento.processadoEm ? instante(row.acompanhamento.processadoEm) : 'Ainda não confirmado'}</dd></div>{row.acompanhamento.processadoEm && <div className="sm:col-span-3">{row.acompanhamento.ativos} ativos · {row.acompanhamento.parcelas} parcelas · {row.acompanhamento.publicadoEm ? 'Publicado' : 'Sem publicação'}</div>}</dl>}
              <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{row.origem === 'CRON' ? 'Rotina diária' : 'Solicitação manual'} {row.revisao ?? 1}{row.solicitacao_anterior_id ? ' · nova consulta vinculada à anterior' : ' · original'}</span><Button type="button" variant="outline" className="min-h-11" disabled={pending || contexto.podeSolicitar === false || !podeSolicitarNovamente(row) || !contexto.versoes.some(v => v.id === row.integracao_versao_id)} onClick={() => solicitarNovamente(row)} aria-label={`Solicitar novamente ${RELATORIOS_OPERADOR.find(r => r.tipo === row.pedido.tipoRelatorio)?.titulo} de ${dataCivil(row.pedido.dataReferencia)}`}><RefreshCw className="size-4" />Solicitar novamente</Button></div>
              <details className="text-xs text-muted-foreground"><summary className="cursor-pointer text-primary">Detalhes e protocolo</summary><dl className="mt-2 grid gap-2 break-all"><div><dt className="font-medium">Pedido BW</dt><dd className="font-mono">{row.id}</dd></div><div><dt className="font-medium">Protocolo Vórtx</dt><dd className="select-all font-mono">{row.protocolo_externo || 'Não confirmado'}</dd></div><div><dt className="font-medium">Retorno HTTP do relatório</dt><dd>{row.codigo_http ?? 'Sem retorno registrado'}</dd></div><div><dt className="font-medium">Carteira VRS</dt><dd>{row.pedido.codigoCarteira}</dd></div></dl></details>
            </article>
          })}</div>}
        {totalPaginas > 1 && <nav aria-label="Páginas do histórico" className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>Página {pagina} de {totalPaginas}</span><div className="flex gap-4">{pagina > 1 && <Link className="text-primary underline" href={hrefPagina(pagina - 1)}>Anterior</Link>}{pagina < totalPaginas && <Link className="text-primary underline" href={hrefPagina(pagina + 1)}>Próxima</Link>}</div></nav>}
      </CardContent>
    </Card>
    {confirmacao && <Dialog open onOpenChange={value => { if (!pending && !value) setConfirmacao(null) }}><DialogContent><DialogHeader><DialogTitle>{confirmacao.solicitacaoAnteriorId ? 'Solicitar uma versão atualizada' : 'Confirmar solicitação de relatório'}</DialogTitle><DialogDescription>{confirmacao.solicitacaoAnteriorId ? 'Um novo pedido, com os mesmos parâmetros, sem apagar o anterior. Se o retorno anterior foi indeterminado, os dois poderão chegar. Nenhum estoque é publicado automaticamente.' : 'Um pedido à Vórtx, sem envio de cessão. Pedidos idênticos são bloqueados; uma nova consulta deve ser confirmada pelo histórico.'}</DialogDescription></DialogHeader>
      <dl className="space-y-2 rounded-lg bg-muted p-4 text-sm"><div><dt className="text-xs text-muted-foreground">Fundo</dt><dd>{contexto.fundo.nome}</dd></div><div><dt className="text-xs text-muted-foreground">Relatório · ambiente do provedor</dt><dd>{confirmado?.descricao.titulo} · {confirmado?.versao?.ambiente === 'producao' ? 'Produção' : 'Homologação'}</dd></div><div><dt className="text-xs text-muted-foreground">{relatorioDePosicao(confirmacao.tipo) ? 'Data da posição · formato' : 'Período · formato'}</dt><dd>{relatorioDePosicao(confirmacao.tipo) ? dataCivil(confirmacao.referencia) : `${dataCivil(confirmacao.inicio)} a ${dataCivil(confirmacao.fim)}`} · {confirmacao.extensao === 2 ? 'CSV' : 'Excel'}</dd></div></dl>
      <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmacao(null)}>Cancelar</Button><Button type="button" disabled={pending} onClick={executar}>{pending ? 'Solicitando uma vez…' : 'Confirmar e solicitar'}</Button></DialogFooter></DialogContent></Dialog>}
  </div>
}
