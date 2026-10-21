'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ClipboardList, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { acompanharRelatorio } from '@/lib/integracoes/vortx/relatorios-acompanhamento'
import { ESTADOS_PEDIDO, hrefBases, lerFiltrosBases, TAMANHO_PAGINA_BASES, type FiltrosBases } from '@/lib/integracoes/vortx/central-bases'
import { RELATORIOS_OPERADOR, podeSolicitarNovamente, relatorioDePosicao, type ContextoRelatorios, type HistoricoRelatorio, type SolicitacaoRelatorio } from '@/lib/integracoes/vortx/relatorios-operacao'

const selectClass = 'h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring'
export const dataCivil = (data: string) => data.split('-').reverse().join('/')
export const instante = (data: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(data))

export function ResumoBases({ resumo }: { resumo: HistoricoRelatorio['resumo'] }) {
  return <section aria-label="Últimos pedidos por base, independentemente dos filtros" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {[
      { titulo: 'Estoque', tipos: ['PosicaoParcela', 'PosicaoAtivo'] },
      { titulo: 'Cessões', tipos: ['Inclusao'] },
      { titulo: 'Liquidações', tipos: ['Exclusao'] },
    ].map(base => <Card key={base.titulo} className="gap-3 py-5">
      <CardHeader className="px-5"><CardTitle className="text-sm text-muted-foreground">{base.titulo}</CardTitle></CardHeader>
      <CardContent className="space-y-3 px-5">{base.tipos.map(tipo => {
        const row = resumo?.find(item => item.pedido.tipoRelatorio === tipo)
        return <div key={tipo} className="space-y-1">
          <p className="text-xs text-muted-foreground">{tipo === 'PosicaoParcela' ? 'Por parcela' : tipo === 'PosicaoAtivo' ? 'Por ativo' : 'Último pedido'}</p>
          <p className="text-lg font-semibold tabular-nums">{row ? dataCivil(row.pedido.dataReferencia) : '—'}</p>
          <p className="text-xs">{row ? acompanharRelatorio(row).titulo : resumo ? 'Sem pedidos registrados' : 'Resumo indisponível'}</p>
        </div>
      })}</CardContent>
    </Card>)}
    <Card className="gap-3 py-5"><CardHeader className="px-5"><CardTitle className="text-sm text-muted-foreground">Carteira</CardTitle></CardHeader>
      <CardContent className="space-y-2 px-5"><p className="text-lg font-semibold">Consulta separada</p><p className="text-xs text-muted-foreground">A consulta JSON não é o estoque de parcelas. Ainda não há persistência operacional de carteira nesta integração.</p><a className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4" href="#carteira-bases">Ver disponibilidade</a></CardContent>
    </Card>
  </section>
}

function DetalhesPedido({ row }: { row: SolicitacaoRelatorio }) {
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
        <div><dt className="font-medium">Pedido BW</dt><dd className="break-all font-mono">{row.id}</dd></div>
        <div><dt className="font-medium">Protocolo Vórtx</dt><dd className="break-all font-mono">{row.protocolo_externo || 'Não confirmado'}</dd></div>
        <div><dt className="font-medium">Retorno HTTP do relatório</dt><dd>{row.codigo_http ?? 'Sem retorno registrado'}</dd></div>
        <div><dt className="font-medium">Carteira VRS</dt><dd className="break-all">{row.pedido.codigoCarteira}</dd></div>
      </dl>
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
  return <Card id="historico-bases" className="min-w-0 scroll-mt-6">
    <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div className="space-y-1"><CardTitle className="flex items-center gap-2"><ClipboardList aria-hidden="true" className="size-5" />Solicitações e processamentos</CardTitle><CardDescription>{historico.total} pedido(s) {filtrado ? 'encontrado(s)' : 'neste Fundo'} · histórico e versões anteriores preservados.</CardDescription></div>
      <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={onRefresh}><RefreshCw aria-hidden="true" className={`size-4 ${pending ? 'animate-spin motion-reduce:animate-none' : ''}`} />Atualizar histórico</Button></div></CardHeader>
    <CardContent className="min-w-0 space-y-4">
      <form key={JSON.stringify(filtros)} aria-label="Filtrar histórico completo" className="grid gap-3 rounded-xl bg-muted/50 p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto]" onSubmit={event => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        router.push(hrefBases(historicoHref, lerFiltrosBases(Object.fromEntries(['tipo', 'origem', 'estado', 'referencia'].map(key => [key, String(form.get(key) || '')])))))
      }}>
        <div className="min-w-0 space-y-2"><Label htmlFor="bases-tipo">Tipo de base</Label><select id="bases-tipo" name="tipo" defaultValue={filtros.tipo || ''} className={selectClass}><option value="">Todos os tipos</option>{RELATORIOS_OPERADOR.map(tipo => <option key={tipo.tipo} value={tipo.tipo}>{tipo.titulo}</option>)}</select></div>
        <div className="min-w-0 space-y-2"><Label htmlFor="bases-origem">Origem do pedido</Label><select id="bases-origem" name="origem" defaultValue={filtros.origem || ''} className={selectClass}><option value="">Todas as origens</option><option value="MANUAL">Operador · API</option><option value="CRON">Rotina diária · API</option></select></div>
        <div className="min-w-0 space-y-2"><Label htmlFor="bases-estado">Situação do pedido</Label><select id="bases-estado" name="estado" defaultValue={filtros.estado || ''} className={selectClass}><option value="">Todas as situações</option>{ESTADOS_PEDIDO.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="min-w-0 space-y-2"><Label htmlFor="bases-referencia">Data de referência</Label><Input id="bases-referencia" name="referencia" type="date" defaultValue={filtros.referencia || ''} className="h-11 min-w-0" /></div>
        <Button type="submit" variant="outline" className="min-h-11 self-end" disabled={pending}>Aplicar filtros</Button>
      </form>
      {filtrado && <Link href={hrefBases(historicoHref, {})} className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">Limpar filtros</Link>}
      <p className="text-xs leading-relaxed text-muted-foreground">O protocolo confirma o pedido, não a importação. Para obter uma correção da mesma data, use “Solicitar novamente”: arquivos idênticos não duplicarão o estoque. Solicite ativo e parcela da mesma data. Atualizar esta lista não refaz consultas na Vórtx.</p>
      {historico.solicitacoes.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center"><ClipboardList aria-hidden="true" className="mx-auto mb-3 size-7 text-muted-foreground" /><p className="font-medium">{filtrado ? 'Nenhum pedido corresponde aos filtros' : 'Nenhum pedido nesta página'}</p><p className="mt-1 text-sm text-muted-foreground">{filtrado ? 'Altere os filtros ou limpe a busca. O histórico não foi apagado.' : 'Escolha um relatório abaixo para começar. Abrir esta tela não faz solicitações automaticamente.'}</p></div> :
        <div className="min-w-0 overflow-hidden rounded-xl border"><Table className="min-w-[820px]" containerProps={{ tabIndex: 0, role: 'region', 'aria-label': 'Histórico de pedidos; role horizontalmente em telas menores' }}>
          <TableHeader><TableRow className="bg-muted/50"><TableHead className="px-4">Base e solicitação</TableHead><TableHead>Referência</TableHead><TableHead>Origem</TableHead><TableHead>Etapa atual</TableHead><TableHead className="pr-4">Ações</TableHead></TableRow></TableHeader>
          <TableBody>{historico.solicitacoes.map(row => {
            const tipo = RELATORIOS_OPERADOR.find(item => item.tipo === row.pedido.tipoRelatorio)!
            const situacao = acompanharRelatorio(row)
            return <TableRow key={row.id} className="align-top">
              <TableCell className="max-w-64 px-4 align-top whitespace-normal"><p className="font-semibold">{tipo.titulo}</p><p className="mt-1 text-xs text-muted-foreground">{instante(row.criada_em)} · {row.pedido.extensaoArquivo === 2 ? 'CSV' : 'Excel'}</p><p className="mt-1 text-xs text-muted-foreground">{row.ambiente === 'producao' ? 'Produção do provedor' : 'Homologação do provedor'}</p></TableCell>
              <TableCell className="align-top text-xs tabular-nums">{relatorioDePosicao(row.pedido.tipoRelatorio) ? dataCivil(row.pedido.dataReferencia) : <>{dataCivil(row.pedido.dataInicio)}<br />a {dataCivil(row.pedido.dataFim)}</>}</TableCell>
              <TableCell className="max-w-40 align-top whitespace-normal"><Badge variant="outline">{row.origem === 'CRON' ? 'Rotina diária' : 'Solicitação manual'}</Badge><p className="mt-2 text-xs text-muted-foreground">Via API · versão {row.revisao ?? 1}{row.solicitacao_anterior_id ? ' · nova consulta vinculada à anterior' : ' · original'}</p></TableCell>
              <TableCell className="max-w-64 align-top whitespace-normal"><Badge variant={situacao.tom === 'erro' ? 'destructive' : 'outline'} className="whitespace-normal text-left">{situacao.titulo}</Badge><DetalhesPedido row={row} /></TableCell>
              <TableCell className="pr-4 align-top"><Button type="button" size="sm" variant="outline" className="min-h-11" disabled={pending || contexto.podeSolicitar === false || !podeSolicitarNovamente(row) || !contexto.versoes.some(v => v.id === row.integracao_versao_id)} onClick={() => onRepeat(row)} aria-label={`Solicitar novamente ${tipo.titulo} de ${dataCivil(row.pedido.dataReferencia)}`}><RefreshCw aria-hidden="true" className="size-4" />Solicitar novamente</Button></TableCell>
            </TableRow>
          })}</TableBody>
        </Table></div>}
      <nav aria-label="Páginas do histórico" className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm"><span className="text-muted-foreground">{historico.solicitacoes.length ? `${(pagina - 1) * TAMANHO_PAGINA_BASES + 1}–${(pagina - 1) * TAMANHO_PAGINA_BASES + historico.solicitacoes.length} de ${historico.total}` : `0 registros nesta página · ${historico.total} no resultado`} · até 20 por página</span><div className="flex items-center gap-3">{pagina > 1 && <Link className="inline-flex min-h-11 items-center text-primary underline" href={hrefBases(historicoHref, filtros, pagina - 1)}>Anterior</Link>}<span>Página {pagina} de {paginas}</span>{pagina < paginas && <Link className="inline-flex min-h-11 items-center text-primary underline" href={hrefBases(historicoHref, filtros, pagina + 1)}>Próxima</Link>}</div></nav>
    </CardContent>
  </Card>
}
