'use client'

import Link from 'next/link'
import { Settings, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function ConfiguracoesGestorPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Settings size={24} className="text-muted-foreground" />
          Configuracoes
        </h1>
        <p className="text-muted-foreground">Parametros gerais do sistema.</p>
      </div>

      <div className="space-y-6">
        {/* Info do sistema */}
        <Card>
          <CardHeader>
            <CardTitle>Informacoes do Sistema</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Sistema</span>
                <p className="font-medium">BW Antecipa - Portal de Antecipacao de NF</p>
              </div>
              <div>
                <span className="text-muted-foreground">Versao</span>
                <p className="font-medium">1.0.0</p>
              </div>
              <div>
                <span className="text-muted-foreground">Ambiente</span>
                <p className="font-medium">{process.env.NODE_ENV || 'development'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Taxas padrao */}
        <Card>
          <CardHeader>
            <CardTitle>Taxas e Parametros</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              As taxas sao configuradas individualmente por cedente na pagina de detalhe de cada cedente
              (Cedentes &gt; Detalhe &gt; Taxas Pre-configuradas).
            </p>
            <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-700">
              Para configurar taxas de um cedente, acesse <strong>Cedentes</strong> &gt; clique no cedente &gt;
              seccao <strong>Taxas Pre-configuradas</strong>.
            </div>
          </CardContent>
        </Card>

        {/* Testemunhas */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users size={18} />
              Testemunhas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Gerencie a lista de testemunhas usadas nos Termos de Cessao. Ao aprovar uma operacao,
              o gestor seleciona 2 testemunhas antes de gerar o PDF.
            </p>
            <Link
              href="/gestor/configuracoes/testemunhas"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline font-medium"
            >
              <Users size={14} />
              Gerenciar Testemunhas
            </Link>
          </CardContent>
        </Card>

        {/* API */}
        <Card>
          <CardHeader>
            <CardTitle>Integracoes API</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="font-medium text-foreground">Sync Escrow (API Externa)</p>
                <p className="text-muted-foreground mt-1">POST /api/escrow/sync — Atualizar movimentos da conta escrow via sistema bancario externo.</p>
                <p className="text-muted-foreground/70 mt-1 text-xs">Requer: ESCROW_API_KEY e SUPABASE_SERVICE_ROLE_KEY no .env.local</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="font-medium text-foreground">Cron Vencimentos</p>
                <p className="text-muted-foreground mt-1">GET /api/cron/vencimentos — Verificar vencimentos diarios, enviar alertas D-5/D-1, marcar inadimplentes.</p>
                <p className="text-muted-foreground/70 mt-1 text-xs">Requer: CRON_SECRET no .env.local</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
