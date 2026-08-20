import { redirect } from 'next/navigation'
import { EscrowDetalhe } from '@/components/escrow/EscrowDetalhe'
import { carregarContaEscrowAutorizada, carregarMovimentosEscrow } from '@/lib/escrow/movimentos.server'

export default async function ExtratoCedentePage() {
  const { auth, conta } = await carregarContaEscrowAutorizada('cedente')
  // get_user_cedente_id() resolve tanto o dono (cedentes.user_id) quanto um
  // usuario convidado via cedente_acessos.
  const { data: cedenteId } = await auth.supabase.rpc('get_user_cedente_id')
  const { data: cedente, error } = cedenteId
    ? await auth.supabase.from('cedentes').select('habilitar_escrow').eq('id', cedenteId).limit(1).maybeSingle()
    : { data: null, error: null }
  if (error) throw new Error(`Nao foi possivel validar o acesso ao extrato: ${error.message}`)
  if (!cedente?.habilitar_escrow) redirect('/cedente/dashboard')
  if (!conta) return <div className="py-20 text-center text-muted-foreground">Sua conta escrow ainda não foi criada.</div>
  const inicial = await carregarMovimentosEscrow('cedente', conta.id)
  return <EscrowDetalhe perfil="cedente" conta={conta} inicial={inicial} />
}
