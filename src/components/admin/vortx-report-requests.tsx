'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, CalendarClock, AlertTriangle } from 'lucide-react'
import { solicitarRelatorioVortx } from '@/app/admin/fundos/relatorios-vortx-actions'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import styles from './central-bases.module.css'
import { CentralBasesHistory, ResumoBases, dataCivil } from './central-bases-history'
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
  const carteiraRef = useRef<HTMLDetailsElement>(null)
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
  const [section, setSection] = useState('historico-bases')
  const review = historico.resumo?.find(row => row.acompanhamento?.processamento === 'REVISAO' && row.acompanhamento.publicacao !== 'PUBLICADA')
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

  return <div className={styles.page} data-bases-layout="option-1">
    <section className={styles.heading}>
      <div><p className={styles.eyebrow}>Recebimento e processamento</p><Title>Central de Bases</Title><p className={styles.intro}>Consulte a integração ou importe um arquivo. Acompanhe cada etapa até a base estar pronta para uso.</p></div>
      <div className={styles.actions}><a href="#importacao-bases" className={styles.button}>Importar arquivos</a><a href="#solicitar-bases" className={styles.button + ' ' + styles.primary}>Solicitar pela API<ArrowRight aria-hidden="true" /></a></div>
    </section>
    <div className={styles.context}><span><strong>{contexto.fundo.nome}</strong><span className={styles.divider} />Vórtx VRS 2.0</span><span>Fundo herdado do portal · sem nova seleção</span></div>
    <ResumoBases resumo={historico.resumo} />
    {review && <div className={styles.notice + ' ' + styles.noticeAmber} role="status"><AlertTriangle aria-hidden="true" /><div><strong>Estoque importado, mas ainda não publicado</strong>Há divergências na posição de {dataCivil(review.pedido.dataReferencia)}. Confira os detalhes antes de disponibilizar essa base nos módulos.</div><a href="#historico-bases">Conferir pedidos →</a></div>}
    <nav aria-label="Seções da Central de Bases" className={styles.tabs}>{[
      ['historico-bases', 'Acompanhamento'], ['solicitar-bases', 'Nova solicitação'], ['importacao-bases', 'Importação manual'], ['carteira-bases', 'Carteira'],
    ].map(([id, label]) => <a key={id} href={'#' + id} onClick={() => setSection(id)} aria-current={section === id ? 'location' : undefined} className={section === id ? styles.active : undefined}>{label}</a>)}</nav>
    <CentralBasesHistory contexto={contexto} historico={historico} pagina={pagina} filtros={filtros} historicoHref={historicoHref} pending={pending} onRefresh={() => startTransition(() => router.refresh())} onRepeat={solicitarNovamente} />
    {contexto.podeSolicitar === false && <p role="status" className={styles.notice}>Seu perfil permite acompanhar os relatórios deste Fundo, sem iniciar novas solicitações.</p>}
    <div className={styles.panels}>
      <section id="solicitar-bases" className={styles.panel}>
        <div className={styles.sectionTitle}><p className={styles.eyebrow}>Via integração</p><h2>Solicitar uma nova base</h2><p>A credencial e o provedor vêm da integração do Fundo.</p></div>
        {contexto.versoes.length === 0 ? <div className={styles.notice}><div><p>Nenhuma integração Vórtx publicada com código de carteira válido para este Fundo.</p>{configuracaoHref ? <Link href={configuracaoHref}>Configurar integração</Link> : <p>Peça ao administrador para conferir a configuração da integração deste Fundo.</p>}</div></div> :
          <form onSubmit={revisar} aria-label="Nova solicitação pela API">
            <fieldset disabled={pending || confirmacao !== null || contexto.podeSolicitar === false}>
              <div className={styles.fields}>
                <label htmlFor="relatorio-tipo">Base<select id="relatorio-tipo" value={tipo} onChange={event => setTipo(event.target.value as RelatorioFormulario['tipo'])}>{RELATORIOS_OPERADOR.map(item => <option key={item.tipo} value={item.tipo} disabled={!versao?.capabilities.includes(item.capability)}>{item.titulo} · {item.subtitulo}</option>)}</select></label>
                {relatorioDePosicao(tipo) && <label htmlFor="relatorio-referencia">Data da posição<Input required id="relatorio-referencia" type="date" max={hoje} value={referencia} onChange={event => setReferencia(event.target.value)} /></label>}
                {!relatorioDePosicao(tipo) && <label htmlFor="relatorio-inicio">Início do período<Input required id="relatorio-inicio" type="date" max={hoje} value={inicio} onChange={event => setInicio(event.target.value)} /></label>}
              </div>
              {!relatorioDePosicao(tipo) && <div className={styles.fields} style={{ marginTop: 12 }}><label htmlFor="relatorio-fim">Fim do período<Input required id="relatorio-fim" type="date" max={hoje} value={fim} onChange={event => setFim(event.target.value)} /></label></div>}
              <div className={styles.notice}>{relatorioDePosicao(tipo) ? 'Para estoque, ativo e parcela são confrontados na mesma data. Solicite cada arquivo. Nenhuma remessa é enviada.' : descricao.descricao}</div>
              <details className={styles.advanced}><summary>Opções da integração e formato · {extensao === 2 ? 'CSV' : 'Excel'}</summary><div className={styles.fields}>
                <label htmlFor="relatorio-versao">Integração publicada<select id="relatorio-versao" value={versaoId} onChange={event => setVersaoId(event.target.value)}>{contexto.versoes.map(v => <option key={v.id} value={v.id}>Vórtx VRS · versão {v.versao} · {v.ambiente === 'producao' ? 'Produção do provedor' : 'Homologação do provedor'}</option>)}</select></label>
                <label htmlFor="relatorio-formato">Formato do arquivo<select id="relatorio-formato" value={extensao} onChange={event => setExtensao(event.target.value === '1' ? 1 : 2)}><option value="2">CSV (.csv) — recomendado</option><option value="1">Excel (.xlsx)</option></select></label>
              </div><p>Carteira VRS: {versao?.carteira}. Obtida da integração; não são os códigos de classe da Carteira JSON. Não são aceitas datas futuras.</p></details>
              {erro && <p role="alert" className="mt-3 text-destructive">{erro}</p>}
              <div className={styles.footer}><small>Não exige código TOTP adicional.</small><Button className={styles.button + ' ' + styles.primary} type="submit" disabled={!disponivel}>Revisar e solicitar</Button></div>
            </fieldset>
          </form>}
      </section>
      <section id="importacao-bases" className={styles.panel}>
        <div className={styles.sectionTitle}><p className={styles.eyebrow}>Alternativa à API</p><h2>Importar e processar manualmente</h2><p>Posição de ativo e parcela da mesma carteira e data.</p></div>
        <div className={styles.fileGrid}>
          <label className={styles.fileZone} htmlFor="manual-ativo"><strong>1. Posição de ativo</strong><p>CSV do provedor, na data escolhida.</p><input id="manual-ativo" type="file" accept=".csv" disabled aria-describedby="manual-disponibilidade" /></label>
          <label className={styles.fileZone} htmlFor="manual-parcela"><strong>2. Posição de parcela</strong><p>CSV da mesma carteira e referência.</p><input id="manual-parcela" type="file" accept=".csv" disabled aria-describedby="manual-disponibilidade" /></label>
        </div>
        <p id="manual-disponibilidade" className={styles.caption} style={{ marginTop: 12 }} role="status">O envio manual de arquivos Vórtx ainda não está conectado nesta tela. O importador CSV legado foi preservado para os demais provedores.</p>
        <div className={styles.footer}><small>Upload indisponível até a conexão com o pipeline nativo.</small><Button className={styles.button + ' ' + styles.primary} disabled>Validar e processar</Button></div>
      </section>
    </div>
    {result && <div ref={resultRef} tabIndex={-1} role="status" aria-live="polite" className={styles.panel + ' ' + styles.result}>
      {result.success ? <><p className="font-semibold">{!result.criada ? 'Pedido idêntico já registrado — não reenviado' : situacaoRelatorio(result.solicitacao).titulo}</p><p>{situacaoRelatorio(result.solicitacao).descricao}</p>{result.solicitacao.protocolo_externo && <p className="break-all font-mono text-xs">Protocolo Vórtx: {result.solicitacao.protocolo_externo}</p>}</> : <p>{result.message}</p>}
      {result.success && !result.criada && contexto.podeSolicitar !== false && podeSolicitarNovamente(result.solicitacao) && <Button type="button" variant="outline" className={styles.button} disabled={pending} onClick={() => solicitarNovamente(result.solicitacao)}>Solicitar uma versão atualizada</Button>}
    </div>}
    <section id="carteira-bases" className={styles.panel + ' ' + styles.wallet}>
      <div className={styles.heading}><div className={styles.sectionTitle}><p className={styles.eyebrow}>Posição patrimonial</p><h2>Carteira na mesma central</h2><p>Consulte a carteira por data e classe, sem confundir com estoque de parcelas.</p></div><div className={styles.actions}><Button className={styles.button} disabled>Importar arquivo compatível</Button>{carteira ? <a className={styles.button + ' ' + styles.primary} href="#carteira-consulta" onClick={() => { if (carteiraRef.current) carteiraRef.current.open = true }}>Consultar carteira</a> : <Button className={styles.button + ' ' + styles.primary} disabled>Consultar carteira</Button>}</div></div>
      <div className={styles.stats}><div className={styles.stat}><small>Data da carteira</small><p>—</p></div><div className={styles.stat}><small>Classes identificadas</small><p>Sem posição persistida</p></div><div className={styles.stat}><small>Conferência</small><p>Processamento pendente</p></div></div>
      {carteira ? <details id="carteira-consulta" ref={carteiraRef} className={styles.advanced}><summary>Consulta diagnóstica autorizada · sem persistência</summary><div>{carteira}</div></details> : <p role="status" className={styles.caption} style={{ marginTop: 12 }}>O processamento operacional da carteira ainda não está conectado. A consulta diagnóstica existente continua restrita ao administrador autorizado.</p>}
    </section>
    <details className={styles.advanced}><summary><CalendarClock aria-hidden="true" className="mr-2 inline" />Atualização diária D−1 · 9h30 de Brasília</summary><div>Estoque consolidado, estoque por parcela, cessões e exclusões do dia útil anterior, excluindo feriados ANBIMA. A agenda Vercel executa apenas no deployment de produção; nesta Preview, o disparo é técnico e controlado. A rotina não publica estoque nem registra baixas financeiras.</div></details>
    {confirmacao && <Dialog open onOpenChange={value => { if (!pending && !value) setConfirmacao(null) }}><DialogContent><DialogHeader><DialogTitle>{confirmacao.solicitacaoAnteriorId ? 'Solicitar uma versão atualizada' : 'Confirmar solicitação de relatório'}</DialogTitle><DialogDescription>{confirmacao.solicitacaoAnteriorId ? 'Um novo pedido, com os mesmos parâmetros, sem apagar o anterior. Se o retorno anterior foi indeterminado, os dois poderão chegar. Nenhum estoque é publicado automaticamente.' : 'Um pedido à Vórtx, sem envio de cessão. Pedidos idênticos são bloqueados; uma nova consulta deve ser confirmada pelo histórico.'}</DialogDescription></DialogHeader>
      <dl className="space-y-2 rounded-lg bg-muted p-4 text-sm"><div><dt className="text-xs text-muted-foreground">Fundo</dt><dd>{contexto.fundo.nome}</dd></div><div><dt className="text-xs text-muted-foreground">Relatório · ambiente do provedor</dt><dd>{confirmado?.descricao.titulo} · {confirmado?.versao?.ambiente === 'producao' ? 'Produção' : 'Homologação'}</dd></div><div><dt className="text-xs text-muted-foreground">{relatorioDePosicao(confirmacao.tipo) ? 'Data da posição · formato' : 'Período · formato'}</dt><dd>{relatorioDePosicao(confirmacao.tipo) ? dataCivil(confirmacao.referencia) : dataCivil(confirmacao.inicio) + ' a ' + dataCivil(confirmacao.fim)} · {confirmacao.extensao === 2 ? 'CSV' : 'Excel'}</dd></div></dl>
      <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmacao(null)}>Cancelar</Button><Button type="button" disabled={pending} onClick={executar}>{pending ? 'Solicitando uma vez…' : 'Confirmar e solicitar'}</Button></DialogFooter></DialogContent></Dialog>}
  </div>
}
