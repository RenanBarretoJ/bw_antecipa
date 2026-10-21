'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { acompanharRelatorio } from '@/lib/integracoes/vortx/relatorios-acompanhamento'
import { ESTADOS_PEDIDO, hrefBases, lerFiltrosBases, TAMANHO_PAGINA_BASES, type FiltrosBases } from '@/lib/integracoes/vortx/central-bases'
import { RELATORIOS_OPERADOR, podeSolicitarNovamente, relatorioDePosicao, type ContextoRelatorios, type HistoricoRelatorio, type SolicitacaoRelatorio } from '@/lib/integracoes/vortx/relatorios-operacao'
import styles from './central-bases.module.css'

const selectClass = 'h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring'
export const dataCivil = (data: string) => data.split('-').reverse().join('/')
export const instante = (data: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(data))

export function ResumoBases({ resumo }: { resumo: HistoricoRelatorio['resumo'] }) {
  return <section aria-label="Últimos pedidos por base, independentemente dos filtros" className={styles.summary}>
    {[
      { titulo: 'Estoque', tipos: ['PosicaoParcela', 'PosicaoAtivo'] },
      { titulo: 'Cessões', tipos: ['Inclusao'] },
      { titulo: 'Liquidações', tipos: ['Exclusao'] },
    ].map(base => {
      // Stock describes one identified request, never an unproven combined publication.
      const row = base.tipos.map(tipo => resumo?.find(item => item.pedido.tipoRelatorio === tipo)).find(Boolean)
      const situacao = row ? acompanharRelatorio(row) : null
      return <article key={base.titulo} className={styles.metric}>
        <div className={styles.metricTop}><span>{base.titulo}</span><span className={`${styles.badge} ${situacao?.tom === 'erro' ? styles.red : situacao?.tom === 'atencao' ? styles.amber : styles.blue}`}>{situacao?.titulo ?? 'Sem pedidos'}</span></div>
        <p className={styles.value}>{row ? dataCivil(row.pedido.dataReferencia) : '—'}</p>
        <p className={styles.caption}>{row ? `Último pedido${base.titulo === 'Estoque' ? row.pedido.tipoRelatorio === 'PosicaoParcela' ? ' por parcela' : ' por ativo' : ''} · não comprova publicação` : resumo ? 'Sem pedidos registrados' : 'Resumo indisponível'}</p>
      </article>
    })}
    <article className={styles.metric}><div className={styles.metricTop}><span>Carteira</span><span className={styles.badge}>Não processada</span></div>
      <p className={styles.value}>—</p><p className={styles.caption}>Persistência ainda não habilitada. <a href="#carteira-bases" className="underline">Ver disponibilidade</a></p>
    </article>
  </section>
}

function DetalhesPedido({ row, children }: { row: SolicitacaoRelatorio; children?: ReactNode }) {
  const p = row.acompanhamento
  return <details className="max-w-sm text-xs">
    <summary className="min-h-11 cursor-pointer py-3 font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring">Etapas e protocolo</summary>
    <div className="space-y-3 whitespace-normal rounded-lg bg-muted p-3">
      <p className="text-muted-foreground">{acompanharRelatorio(row).descricao}</p>
      <dl className="space-y-2">
        <div><dt className="font-medium">Recebimento do callback</dt><dd>{p?.recebidoEm ? instante(p.recebidoEm) : 'Aguardando'}</dd></div>
        <div><dt className="font-medium">Download concluído</dt><dd>{p?.downloadEm ? instante(p.downloadEm) : p?.processadoEm ? 'Confirmado pela importação · horário não registrado' : 'Ainda não confirmado'}</dd></div>
        <div><dt className="font-medium">Processamento concluído</dt><dd>{p?.processadoEm ? instante(p.processadoEm) : 'Ainda não confirmado'}</dd></div>
        {p?.processadoEm && <div><dt className="font-medium">Dados salvos</dt><dd>{p.ativos} ativos · {p.parcelas} parcelas · {p.publicadoEm ? 'Publicado' : 'Sem publicação'}</dd></div>}
        {p?.pddPendente && <div><dt className="font-medium">Conferência de PDD</dt><dd>Aviso temporário, não bloqueia a persistência. Valores originais preservados, sem rateio. A publicação permanece separada.</dd></div>}
        <div><dt className="font-medium">Pedido BW</dt><dd className="break-all font-mono">{row.id}</dd></div>
        <div><dt className="font-medium">Protocolo Vórtx</dt><dd className="break-all font-mono">{row.protocolo_externo || 'Não confirmado'}</dd></div>
        <div><dt className="font-medium">Retorno HTTP do relatório</dt><dd>{row.codigo_http ?? 'Sem retorno registrado'}</dd></div>
        <div><dt className="font-medium">Carteira VRS</dt><dd className="break-all">{row.pedido.codigoCarteira}</dd></div>
        <div><dt className="font-medium">Solicitado em</dt><dd>{instante(row.criada_em)}</dd></div>
        <div><dt className="font-medium">Ambiente</dt><dd>{row.ambiente === 'producao' ? 'Produção do provedor' : 'Homologação do provedor'}</dd></div>
        {row.solicitacao_anterior_id && <div><dt className="font-medium">Versão {row.revisao ?? 1}</dt><dd>nova consulta vinculada à anterior</dd></div>}
      </dl>
      {children}
    </div>
  </details>
}

export function CentralBasesHistory({ contexto, historico, pagina, filtros = {}, historicoHref, pending, onRefresh, onRepeat }: {
  contexto: ContextoRelatorios; historico: HistoricoRelatorio; pagina: number; filtros?: FiltrosBases
  historicoHref: string; pending: boolean; onRefresh: () => void; onRepeat: (row: SolicitacaoRelatorio) => void
}) {
  const router = useRouter()
  const paginas = Math.max(1, Math.ceil(historico.total / TAMANHO_PAGINA_BASES))
  const filtrado = Object.values(filtros).some(Boolean)
  return <Card id="historico-bases" className={styles.history}>
    <CardHeader><div className={styles.historyHeading}><div><CardTitle>Solicitações e processamentos <span className={styles.badge}>{historico.total}</span></CardTitle><CardDescription>Histórico do Fundo, com etapas de recebimento, conferência e publicação.</CardDescription></div>
      <div className={styles.actions}>{filtrado && <Link href={hrefBases(historicoHref, {})} className="text-xs text-primary underline">Limpar filtros</Link>}<Button type="button" variant="outline" className={styles.button} disabled={pending} onClick={onRefresh}><RefreshCw aria-hidden="true" className={`size-4 ${pending ? 'animate-spin motion-reduce:animate-none' : ''}`} />Atualizar histórico</Button></div></div></CardHeader>
    <CardContent>
      <form key={JSON.stringify(filtros)} aria-label="Filtrar histórico completo" className={styles.toolbar} onSubmit={event => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        router.push(hrefBases(historicoHref, lerFiltrosBases(Object.fromEntries(['tipo', 'origem', 'estado', 'referencia'].map(key => [key, String(form.get(key) || '')])))))
      }}>
        <div className="min-w-0 space-y-2"><Label htmlFor="bases-tipo">Tipo de base</Label><select id="bases-tipo" name="tipo" defaultValue={filtros.tipo || ''} className={selectClass}><option value="">Todos os tipos</option>{RELATORIOS_OPERADOR.map(tipo => <option key={tipo.tipo} value={tipo.tipo}>{tipo.titulo}</option>)}</select></div>
        <div className="min-w-0 space-y-2"><Label htmlFor="bases-origem">Origem do pedido</Label><select id="bases-origem" name="origem" defaultValue={filtros.origem || ''} className={selectClass}><option value="">Todas as origens</option><option value="MANUAL">Operador · API</option><option value="CRON">Rotina diária · API</option></select></div>
        <div className="min-w-0 space-y-2"><Label htmlFor="bases-estado">Situação do pedido</Label><select id="bases-estado" name="estado" defaultValue={filtros.estado || ''} className={selectClass}><option value="">Todas as situações</option>{ESTADOS_PEDIDO.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="min-w-0 space-y-2"><Label htmlFor="bases-referencia">Data de referência</Label><Input id="bases-referencia" name="referencia" type="date" defaultValue={filtros.referencia || ''} className="h-11 min-w-0" /></div>
        <Button type="submit" variant="outline" className={styles.button} disabled={pending}>Aplicar filtros</Button>
      </form>
      {historico.solicitacoes.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center"><ClipboardList aria-hidden="true" className="mx-auto mb-3 size-7 text-muted-foreground" /><p className="font-medium">{filtrado ? 'Nenhum pedido corresponde aos filtros' : 'Nenhum pedido nesta página'}</p><p className="mt-1 text-sm text-muted-foreground">{filtrado ? 'Altere os filtros ou limpe a busca. O histórico não foi apagado.' : 'Escolha um relatório abaixo para começar. Abrir esta tela não faz solicitações automaticamente.'}</p></div> :
        <Table containerProps={{ tabIndex: 0, role: 'region', 'aria-label': 'Histórico de pedidos; role horizontalmente em telas menores' }}>
          <TableHeader><TableRow><TableHead>Base / arquivo</TableHead><TableHead>Referência</TableHead><TableHead>Origem</TableHead><TableHead>Etapa atual</TableHead><TableHead>Conferência</TableHead></TableRow></TableHeader>
          <TableBody>{historico.solicitacoes.map(row => {
            const tipo = RELATORIOS_OPERADOR.find(item => item.tipo === row.pedido.tipoRelatorio)!
            const situacao = acompanharRelatorio(row)
            return <TableRow key={row.id} className="align-top">
              <TableCell className="max-w-64"><p className="font-semibold">{tipo.titulo}</p><p>{row.pedido.extensaoArquivo === 2 ? 'CSV' : 'Excel'} · versão {row.revisao ?? 1}</p></TableCell>
              <TableCell className="align-top text-xs tabular-nums">{relatorioDePosicao(row.pedido.tipoRelatorio) ? dataCivil(row.pedido.dataReferencia) : <>{dataCivil(row.pedido.dataInicio)}<br />a {dataCivil(row.pedido.dataFim)}</>}</TableCell>
              <TableCell className="max-w-40"><span className={`${styles.badge} ${styles.blue}`}>API</span><p>{row.origem === 'CRON' ? 'Rotina diária' : 'Solicitação manual'}</p></TableCell>
              <TableCell className="max-w-64"><span className={`${styles.badge} ${situacao.tom === 'erro' ? styles.red : situacao.tom === 'atencao' ? styles.amber : styles.blue}`}>{situacao.titulo}</span></TableCell>
              <TableCell><DetalhesPedido row={row}><Button type="button" size="sm" variant="outline" className={styles.button} disabled={pending || contexto.podeSolicitar === false || !podeSolicitarNovamente(row) || !contexto.versoes.some(v => v.id === row.integracao_versao_id)} onClick={() => onRepeat(row)} aria-label={`Solicitar novamente ${tipo.titulo} de ${dataCivil(row.pedido.dataReferencia)}`}><RefreshCw aria-hidden="true" className="size-4" />Solicitar novamente</Button></DetalhesPedido></TableCell>
            </TableRow>
          })}</TableBody>
        </Table>}
      <details className={styles.historyNote}><summary>Como acompanhar e solicitar novamente</summary><p>O protocolo confirma o pedido, não a importação. Para obter uma correção da mesma data, use “Solicitar novamente”: arquivos idênticos não duplicarão o estoque. Solicite ativo e parcela da mesma data. Atualizar esta lista não refaz consultas na Vórtx.</p></details>
      <nav aria-label="Páginas do histórico" className={styles.pagination}><span className="text-muted-foreground">{historico.solicitacoes.length ? `${(pagina - 1) * TAMANHO_PAGINA_BASES + 1}–${(pagina - 1) * TAMANHO_PAGINA_BASES + historico.solicitacoes.length} de ${historico.total}` : `0 registros nesta página · ${historico.total} no resultado`} · até 20 por página</span><div className="flex items-center gap-3">{pagina > 1 && <Link className="inline-flex min-h-11 items-center text-primary underline" href={hrefBases(historicoHref, filtros, pagina - 1)}>Anterior</Link>}<span>Página {pagina} de {paginas}</span>{pagina < paginas && <Link className="inline-flex min-h-11 items-center text-primary underline" href={hrefBases(historicoHref, filtros, pagina + 1)}>Próxima</Link>}</div></nav>
    </CardContent>
  </Card>
}
