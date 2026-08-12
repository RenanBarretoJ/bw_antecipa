import Link from 'next/link'
import { FundoStructuralForm } from '@/components/admin/fundo-structural-form'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'

export default function NovoFundoPage() {
  return (
    <PageContainer>
      <PageHeader eyebrow="Estrutura global" title="Novo fundo" description="O fundo sera criado inativo e sem vinculos, papeis ou configuracoes operacionais automaticas." action={<Link href="/admin/fundos" className="text-sm font-medium text-primary hover:underline">Voltar aos fundos</Link>} />
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm"><FundoStructuralForm /></section>
    </PageContainer>
  )
}
