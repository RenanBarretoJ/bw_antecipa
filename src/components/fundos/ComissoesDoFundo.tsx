import { z } from 'zod'
import { requireGestor } from '@/lib/auth/authorization'
import { ComissaoConsultoriaToggle } from './ComissaoConsultoriaToggle'

const configSchema = z.array(z.object({ consultor_id: z.string().uuid(), fundo_id: z.string().uuid(), nome: z.string(), comissao_habilitada: z.boolean() }))

export async function ComissoesDoFundo({ fundoId }: { fundoId: string }) {
  const context = await requireGestor()
  const { data, error } = await context.supabase.rpc('listar_configuracao_comissao_fundo', { p_fundo_id: fundoId })
  if (error) throw new Error('Não foi possível carregar as configurações das Consultorias deste fundo.')
  const configuracoes = configSchema.parse(data)
  return <section className="space-y-4">
    <h2 className="text-lg font-semibold">Comissão por Consultoria</h2>
    {configuracoes.length === 0 ? <p className="text-muted-foreground">Nenhuma Consultoria ativa vinculada ao fundo.</p> : configuracoes.map((config) =>
      <ComissaoConsultoriaToggle key={config.consultor_id} consultorId={config.consultor_id} fundoId={config.fundo_id} nome={config.nome} habilitada={config.comissao_habilitada} />)}
  </section>
}
