'use client'

import { Settings } from 'lucide-react'

export default function ConfiguracoesGestorPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Settings size={24} className="text-gray-600" />
          Configuracoes
        </h1>
        <p className="text-gray-500">Parametros gerais do sistema.</p>
      </div>

      <div className="space-y-6">
        {/* Info do sistema */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Informacoes do Sistema</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Sistema</span>
              <p className="font-medium">BW Antecipa - Portal de Antecipacao de NF</p>
            </div>
            <div>
              <span className="text-gray-500">Versao</span>
              <p className="font-medium">1.0.0</p>
            </div>
            <div>
              <span className="text-gray-500">Ambiente</span>
              <p className="font-medium">{process.env.NODE_ENV || 'development'}</p>
            </div>
          </div>
        </div>

        {/* Taxas padrao */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Taxas e Parametros</h2>
          <p className="text-sm text-gray-500 mb-4">
            As taxas sao configuradas individualmente por cedente na pagina de detalhe de cada cedente
            (Cedentes &gt; Detalhe &gt; Taxas Pre-configuradas).
          </p>
          <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-700">
            Para configurar taxas de um cedente, acesse <strong>Cedentes</strong> &gt; clique no cedente &gt;
            seccao <strong>Taxas Pre-configuradas</strong>.
          </div>
        </div>

        {/* API */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Integracoes API</h2>
          <div className="space-y-3 text-sm">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="font-medium text-gray-900">Sync Escrow (API Externa)</p>
              <p className="text-gray-500 mt-1">POST /api/escrow/sync — Atualizar movimentos da conta escrow via sistema bancario externo.</p>
              <p className="text-gray-400 mt-1 text-xs">Requer: ESCROW_API_KEY e SUPABASE_SERVICE_ROLE_KEY no .env.local</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="font-medium text-gray-900">Cron Vencimentos</p>
              <p className="text-gray-500 mt-1">GET /api/cron/vencimentos — Verificar vencimentos diarios, enviar alertas D-5/D-1, marcar inadimplentes.</p>
              <p className="text-gray-400 mt-1 text-xs">Requer: CRON_SECRET no .env.local</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
