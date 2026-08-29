import { redirect } from 'next/navigation'

export default function ComunicacoesGestorRedirect() {
  redirect('/gestor/configuracoes?tab=comunicacoes')
}
