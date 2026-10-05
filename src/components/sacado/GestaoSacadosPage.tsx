import Link from 'next/link'
import { carregarGestaoSacados } from '@/lib/sacado/gestao.server'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { GestaoAcessoForm } from './GestaoAcessoForm'
import { formatCNPJ, formatDate } from '@/lib/utils'

export async function GestaoSacadosPage({ params, basePath }: { params: Record<string, string | string[] | undefined>; basePath: string }) {
  const result = await carregarGestaoSacados(params)
  const href = (usuario: string | null, pagina = 1) => `${basePath}?${new URLSearchParams({ fundo: result.fundo.id, busca: result.busca, pagina: String(pagina), ...(usuario ? { usuario } : {}) })}`
  const selected = result.usuarios.find(u => u.id === result.userId)
  return <PageContainer className="space-y-5">
    <PageHeader title="Sacados e acessos" description="Gerencie empresas autorizadas por usuario e Fundo. Cada CNPJ exige um vinculo explicito." />
    <form method="get" className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
      <label className="text-sm">Fundo<select name="fundo" defaultValue={result.fundo.id} className="block min-h-10 w-full rounded-lg border border-input bg-background px-3">{result.fundos.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
      <label className="text-sm">Nome ou e-mail<input name="busca" defaultValue={result.busca} className="block min-h-10 w-full rounded-lg border border-input bg-background px-3" /></label>
      <p className="text-sm text-muted-foreground">Para vincular um usuario ainda sem acesso neste Fundo, busque seu e-mail completo.</p>
      <button className="min-h-10 rounded-lg bg-primary px-4 text-primary-foreground" type="submit">Buscar</button>
    </form>
    {selected ? <>
      <Link className="text-primary underline" href={href(null)}>Voltar aos usuarios</Link>
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">{selected.nome_completo}</h2><p className="break-all text-sm text-muted-foreground">{selected.email} · {result.fundo.nome}</p>
        <p>Este usuario pode aprovar documentos destas empresas:</p>
        {result.acessos.length === 0 && <p className="text-muted-foreground">Nenhuma empresa vinculada neste Fundo.</p>}
        {result.acessos.map(a => <article key={a.id} className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">{a.razao_social}</h3><span className="text-sm capitalize">{a.status}</span></div>
          <p className="text-sm">{formatCNPJ(a.cnpj)} · {result.fundo.nome}</p><p className="text-xs text-muted-foreground">Criado em {formatDate(a.created_at)} · Atualizado em {formatDate(a.updated_at)}</p>
          {result.pode_editar && <details><summary className="cursor-pointer text-primary">Gerenciar acesso</summary><GestaoAcessoForm usuario={selected.id} fundo={result.fundo.id} acesso={a} /></details>}
        </article>)}
      </section>
      {result.pode_editar && <GestaoAcessoForm usuario={selected.id} fundo={result.fundo.id} />}
    </> : <>
      <p className="text-sm text-muted-foreground">{result.total} usuario(s) encontrado(s) · {result.fundo.nome}</p>
      <section className="divide-y divide-border rounded-xl border border-border bg-card">
        {result.usuarios.length === 0 && <p className="p-4">Nenhum usuario encontrado. Confira o Fundo e a busca.</p>}
        {result.usuarios.map(u => <article key={u.id} className="grid items-center gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="min-w-0"><h2 className="font-medium">{u.nome_completo}</h2><p className="break-all text-sm text-muted-foreground">{u.email}</p></div>
          <p className="text-sm">{u.cnpjs_ativos} CNPJ(s) ativo(s) · {u.status}</p><Link className="text-primary underline" href={href(u.id)}>Abrir acessos</Link>
        </article>)}
      </section>
      <nav aria-label="Paginacao dos Sacados" className="flex flex-wrap justify-between gap-3"><span>Pagina {result.pagina}</span>{result.pagina > 1 && <Link href={href(null, result.pagina - 1)}>Anterior</Link>}{result.pagina * 20 < result.total && <Link href={href(null, result.pagina + 1)}>Proxima</Link>}</nav>
    </>}
  </PageContainer>
}
