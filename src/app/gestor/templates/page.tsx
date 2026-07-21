'use client'

import { FileText } from 'lucide-react'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { TemplatesDoFundo } from '@/components/templates/TemplatesDoFundo'

export default function TemplatesJuridicosPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Visao geral"
        title="Templates juridicos"
        description="Visao consolidada para consulta e auditoria. A edicao principal acontece no cadastro do fundo."
        action={<FileText size={20} className="text-primary" aria-hidden="true" />}
      />
      <TemplatesDoFundo />
    </PageContainer>
  )
}
