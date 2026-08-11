# Histórico operacional unificado

O BW Antecipa mantém dois níveis de rastreabilidade:

- `logs_auditoria`: trilha técnica de auditoria, com detalhes de alteração e suporte a investigação interna.
- `eventos_dominio`: histórico operacional de leitura, usado nas telas de Nota Fiscal e Operação para explicar a jornada do usuário.

## Entidades atendidas

O histórico é exibido em:

- `/gestor/notas-fiscais/[id]`
- `/cedente/notas-fiscais/[id]`
- `/gestor/operacoes/[id]`
- `/cedente/operacoes/[id]`

## Modelo

A tabela `eventos_dominio` guarda eventos com:

- contexto multifundo: `fundo_id`, `cedente_id`, `cedente_fundo_id`;
- entidade: `nota_fiscal_id` e/ou `operacao_id`;
- classificação: `tipo_evento` e `categoria`;
- ator em snapshot: nome, perfil e usuário;
- descrição operacional;
- `metadata` sanitizável para exibição resumida;
- `visibilidade`: `interno`, `cedente` ou `ambos`.

## Segurança

A RLS permite:

- gestor: leitura/inserção apenas quando autorizado no fundo do evento;
- cedente: leitura apenas dos eventos do próprio cedente e com visibilidade `cedente` ou `ambos`.

A tela do gestor também filtra os eventos pelo fundo ativo no backend.

## Interface

O componente `HistoricoTimelineCard`:

- inicia recolhido;
- carrega resumo primeiro;
- busca eventos somente ao expandir;
- pagina por cursor;
- agrupa por data;
- limita altura com rolagem interna;
- não exibe JSON bruto, UUID, hash, bucket, storage path, token ou stacktrace.

## Instrumentação inicial

Eventos instrumentados nesta fase:

- NF cadastrada;
- NF submetida;
- NF aprovada;
- NF reprovada;
- ajuste solicitado;
- NF resubmetida;
- documento de NF enviado;
- documento pós-cessão enviado;
- CT-e XML enviado e validado;
- documento aprovado/rejeitado;
- operação solicitada;
- operação aprovada;
- operação desembolsada;
- operação reprovada;
- operação cancelada;
- NF removida da operação.

## Backfill

A migration cria eventos iniciais para:

- notas fiscais existentes;
- operações existentes;
- versões documentais já registradas.

O backfill é idempotente por `origem_evento`, `origem_registro_id` e `tipo_evento`.

## Limitação conhecida

Eventos legados sem registro persistido específico são representados por backfill conservador. O histórico novo passa a ser persistido a partir das Server Actions instrumentadas.
