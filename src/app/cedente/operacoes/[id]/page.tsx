import OperacaoAcompanhamentoPage from '@/components/operacoes/OperacaoAcompanhamentoPage'

export default function CedenteOperacaoDetalhePage(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ returnTo?: string | string[] }>
}) {
  return <OperacaoAcompanhamentoPage {...props} perfil="cedente" />
}
