import { redirect } from 'next/navigation'
import { EscrowDetalhe } from '@/components/escrow/EscrowDetalhe'
import { carregarContaEscrowAutorizada, carregarMovimentosEscrow } from '@/lib/escrow/movimentos.server'

export default async function ExtratoCedentePage() {
  const { auth, conta } = await carregarContaEscrowAutorizada('cedente')
  const { data: cedente, error } = await auth.supabase
    .from('cedentes')
    .select('habilitar_escrow')
    .eq('user_id', auth.user.id)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Nao foi possivel validar o acesso ao extrato: ${error.message}`)
  if (!cedente?.habilitar_escrow) redirect('/cedente/dashboard')
  if (!conta) return <div className="py-20 text-center text-muted-foreground">Sua conta escrow ainda não foi criada.</div>
  const inicial = await carregarMovimentosEscrow('cedente', conta.id)
  return <EscrowDetalhe perfil="cedente" conta={conta} inicial={inicial} />
}
