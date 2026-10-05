import { resolverContextoSacado } from '@/lib/sacado/contexto.server'
import { formatCNPJ } from '@/lib/utils'

export async function FiltroEmpresaSacado({ cnpj = '' }: { cnpj?: string }) {
  const { acessos } = await resolverContextoSacado()
  const empresas = [...new Map(acessos.map(a => [a.cnpj, a])).values()]
  return <form method="get" className="mx-auto mb-5 flex max-w-6xl flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
    <label className="min-w-0 flex-1 text-sm" htmlFor="sacado-empresa">Empresa / CNPJ
      <select id="sacado-empresa" name="cnpj" defaultValue={empresas.some(e => e.cnpj === cnpj) ? cnpj : ''} className="mt-1 block min-h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3">
        <option value="">Todos os meus CNPJs</option>
        {empresas.map(e => <option key={e.cnpj} value={e.cnpj}>{e.razao_social} — {formatCNPJ(e.cnpj)}</option>)}
      </select>
    </label>
    <button type="submit" className="min-h-10 rounded-lg bg-primary px-4 text-sm text-primary-foreground dark:bg-blue-700">Filtrar empresa</button>
    {empresas.length === 0 && <p role="status" className="w-full text-sm text-muted-foreground">Nenhuma empresa autorizada. Solicite ao Gestor a revisao dos seus acessos.</p>}
  </form>
}
