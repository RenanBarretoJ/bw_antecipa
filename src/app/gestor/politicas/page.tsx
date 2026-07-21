'use client'

import { FileCog } from 'lucide-react'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { PoliticasDoFundo } from '@/components/politicas/PoliticasDoFundo'

export default function PoliticasPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Visao geral"
        title="Politicas operacionais"
        description="Visao consolidada para consulta e auditoria. A edicao principal acontece no cadastro do fundo."
        action={<FileCog size={20} className="text-primary" aria-hidden="true" />}
      />
      <PoliticasDoFundo />
    </PageContainer>
  )
}
