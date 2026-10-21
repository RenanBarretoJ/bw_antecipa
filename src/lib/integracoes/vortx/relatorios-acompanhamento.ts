import { relatorioDePosicao, situacaoRelatorio, type SolicitacaoRelatorio } from './relatorios-operacao'

/** Receipt, download, persistence and publication are distinct facts, not inferred from an HTTP protocol. */
export function acompanharRelatorio(row: SolicitacaoRelatorio) {
  const p = row.acompanhamento
  if (p?.publicacao === 'PUBLICADA') return { titulo: 'Publicado nos módulos', descricao: 'Estoque validado e publicado explicitamente.', tom: 'neutro' as const }
  if (p?.processamento === 'REVISAO') return { titulo: 'Importado · em revisão', descricao: 'Arquivos baixados e dados salvos. Há divergências para conferir; o estoque não foi publicado.', tom: 'atencao' as const }
  if (p?.processamento === 'PERSISTIDO' && p.pddPendente) return {
    titulo: p.duplicada ? 'Conteúdo já importado · PDD a conferir' : 'Importado · PDD a conferir',
    descricao: 'Arquivos baixados e dados salvos. Nominal, aquisição e valor presente conferidos. A diferença de PDD foi preservada como aviso temporário, sem bloquear a persistência. O estoque não foi publicado.',
    tom: 'atencao' as const,
  }
  if (p?.processamento === 'PERSISTIDO') return { titulo: p.duplicada ? 'Conteúdo já importado' : 'Importado', descricao: p.duplicada ? 'A importação existente foi reutilizada, sem duplicar o estoque.' : 'Arquivos baixados e dados salvos. A publicação é uma etapa separada.', tom: 'neutro' as const }
  if (p?.processamento === 'FALHA') return { titulo: 'Processamento requer atenção', descricao: p.erro === 'DOWNLOAD_FALHOU' ? 'O download não foi concluído. O pedido e seu histórico foram preservados.' : 'O processamento não foi confirmado. Confira o histórico antes de solicitar outra versão.', tom: 'erro' as const }
  if (p?.processamento === 'PROCESSANDO') return { titulo: p.downloadEm ? 'Validando e salvando' : 'Baixando arquivos', descricao: 'O processamento está em andamento; ainda não há conclusão confirmada.', tom: 'neutro' as const }
  if (p?.arquivoStatus === 'Disponível') return relatorioDePosicao(row.pedido.tipoRelatorio)
    ? { titulo: 'Arquivo recebido · aguardando par', descricao: 'O estoque precisa de ativo e parcela da mesma data para iniciar a importação.', tom: 'neutro' as const }
    : { titulo: 'Arquivo disponível', descricao: 'Callback recebido. A importação financeira deste tipo ainda não está habilitada; nenhuma aquisição ou baixa foi criada.', tom: 'atencao' as const }
  if (p?.arquivoStatus === 'Expirado') return { titulo: 'Link do relatório expirado', descricao: 'Solicite uma nova versão para obter outro link. Importações anteriores permanecem preservadas.', tom: 'atencao' as const }
  return situacaoRelatorio(row)
}
