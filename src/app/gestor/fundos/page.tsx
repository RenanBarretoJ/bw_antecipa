'use client'

import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { useFundoAtivo } from '@/components/fundos/fundo-ativo-provider'
import { DetailSection, EmptyState, ListNameCell, LoadingState, StatusBadge } from '@/components/data-display/primitives'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { formatCNPJ } from '@/lib/utils'

export default function FundosPage() {
  const { loading, fundos, bloqueado } = useFundoAtivo()
  const fundosAtivos = fundos

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        eyebrow="Configuracoes operacionais"
        title="Fundos"
        description="Acesse as configuracoes dos fundos autorizados. Dados estruturais sao administrados pela plataforma."
      />
      <DetailSection title="Fundos autorizados" icon={Building2}>
        {loading ? <LoadingState label="Carregando fundos..." /> : bloqueado || fundosAtivos.length === 0 ? (
          <EmptyState title="Nenhum fundo ativo autorizado" description="Solicite ao administrador da plataforma a ativacao e a autorizacao de acesso a um fundo." icon={Building2} />
        ) : (
          <div className="divide-y divide-border">
            {fundosAtivos.map((fundo) => (
              <div key={fundo.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <ListNameCell name={fundo.nome} subline={fundo.cnpj ? formatCNPJ(fundo.cnpj) : null} className="max-w-xl" />
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status="ativo" />
                  <Link className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted" href={`/gestor/fundos/${fundo.id}`}>Configurar</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </DetailSection>
    </PageContainer>
  )
}
