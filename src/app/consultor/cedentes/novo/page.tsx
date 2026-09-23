import { NovoCedenteConsultorForm } from '@/components/consultor/novo-cedente-form'
import { listarFundosCriacaoCedenteConsultor } from '@/lib/consultor/cedentes.server'

export default async function NovoCedenteConsultorPage() {
  const fundos = await listarFundosCriacaoCedenteConsultor()
  return <div className="space-y-4">{fundos.length === 0 && <div className="mx-auto max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Nenhum fundo autorizado para cadastro. Solicite ao administrador o vínculo do Consultor a um fundo ativo.</div>}<NovoCedenteConsultorForm fundos={fundos} /></div>
}
