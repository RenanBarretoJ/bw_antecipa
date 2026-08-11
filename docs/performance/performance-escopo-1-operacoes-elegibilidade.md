# Rota de performance — Escopo 1: operações e elegibilidade documental

## Objetivo e limite do escopo

Este escopo migra as listagens de operações do gestor, cedente e consultor para paginação no servidor e remove o padrão N+1 da elegibilidade documental usada na nova solicitação e na aprovação. Nenhuma regra de política, snapshot, aceite, logística, CNAB, Portal FIDC ou RLS foi alterada.

## Arquitetura anterior

```text
Browser
  -> baixa todas as operações visíveis
  -> filtra, ordena e calcula cards localmente

Nova solicitação
  -> baixa todas as NFs aprovadas
  -> para cada NF chama verificarElegibilidadeDocumental()
  -> N consultas completas de checklist
```

As três listagens cresciam em memória e tráfego proporcionalmente ao histórico. Na nova solicitação e na aprovação, a quantidade de consultas documentais crescia proporcionalmente ao número de NFs.

### Causas exatas dos N+1

- `/cedente/operacoes/nova`: o browser executava `verificarElegibilidadeDocumental(nf.id)` dentro de `Promise.all` para cada NF retornada.
- Solicitação: a validação documental era repetida NF a NF antes da RPC atômica.
- Aprovação/revalidação: o checklist completo era verificado separadamente para cada NF.
- Detalhes: os requisitos da operação, das NFs e das entregas eram consultados em leituras independentes por escopo.
- Listagens: gestor, cedente e consultor carregavam a coleção integral e aplicavam busca, filtros, ordenação e cards em memória.

## Arquitetura implementada

```text
Server Component
  -> autenticação e role
  -> fundo ativo / cedente / carteira do consultor
  -> filtros validados por allowlist
  -> count + order estável + range
  -> contrato compacto
  -> Client Component somente para interação e URL

Nova solicitação / aprovação
  -> carrega NFs autorizadas
  -> carrega requisitos da política uma vez
  -> carrega instâncias por lista de NF IDs
  -> carrega versões por lista de documento IDs
  -> carrega análises por lista de versão IDs
  -> aplica a mesma função pura por NF
```

## Contratos e componentes

- `src/lib/operacoes/listagem.ts`: filtros, allowlists, contrato compacto e métricas de página.
- `src/lib/operacoes/listagem.server.ts`: autorização e consultas paginadas para os três perfis.
- `src/components/operacoes/OperacoesPaginadas.tsx`: filtros via URL, paginação e ações de interação.
- `src/lib/operacoes/elegibilidade-documental.ts`: regra pura de elegibilidade para operação.
- `src/lib/operacoes/elegibilidade-documental.server.ts`: hidratação documental em lote.
- `src/lib/operacoes/nova-solicitacao.server.ts`: NFs candidatas paginadas e hidratadas em lote.
- `src/lib/operacoes/nova-solicitacao.ts`: allowlist e parsing puro dos parâmetros da seleção de NFs.
- `src/lib/operacoes/calculo.ts`: cálculo financeiro puro, compartilhado entre tela e action.

## Autorização e isolamento

- Gestor: operações limitadas aos `cedente_fundos` do fundo ativo autorizado.
- Cedente: operações limitadas ao cedente e ao `cedente_fundo` ativo/selecionado; não há fallback por `cedentes.fundo_id`.
- Consultor: operações limitadas aos cedentes da tabela `consultor_cedente`.
- Todas as consultas usam o client da sessão e continuam sujeitas à RLS.
- Não foi adicionado uso de `service_role`.
- Ordenação, status, paginação e limites usam allowlists e normalização centralizadas.
- As URLs seguem o padrão do Escopo 0: `page`, `pageSize`, `q`, `sort` e `direction`.

## Semântica dos indicadores

O total do filtro vem de `count: exact`. Indicadores derivados de valores/status são explicitamente rotulados como “(página)”, evitando carregar todas as operações apenas para produzir cards. Isso remove a dependência de agregação em memória sem introduzir RPC ou migration prematura.

## Comparativo de complexidade

| Fluxo | Antes | Depois |
|---|---:|---:|
| Listagem gestor | todas as linhas do fundo no browser | no máximo 10/20/40 linhas |
| Listagem cedente | todas as linhas do cedente no browser | no máximo 10/20/40 linhas |
| Listagem consultor | todas as linhas permitidas pela RLS no browser | no máximo 10/20/40 linhas e carteira explícita |
| Elegibilidade de N NFs | N checklists completos | número constante de consultas em lote |
| Aprovação de operação | N chamadas de elegibilidade | uma hidratação documental em lote |
| Requisitos no detalhe | consultas separadas por escopo | uma consulta com filtros combinados |

O número exato de round-trips varia quando existe busca por cedente e conforme o contexto de autorização, mas não cresce mais linearmente com a quantidade de NFs validada.

Não foram afirmados ganhos de tempo ou payload sem medição em homologação. Pelo código, a nova solicitação passou de `1 + N × checklist` para um conjunto constante de leituras: página de NFs, requisitos, instâncias, versões, análises e taxas. Cada listagem retorna no máximo 10, 20 ou 40 operações.

## Compatibilidade

- A RPC atômica `solicitar_operacao_antecipacao_atomica` foi preservada.
- A action reconsulta as NFs selecionadas, valida propriedade/status/fundo e recalcula os valores.
- A action revalida documentalmente todas as NFs selecionadas em lote antes da RPC.
- A aprovação usa a mesma regra documental pura e o mesmo loader em lote.
- A seleção da nova solicitação armazena IDs e dados compactos; o resumo não depende apenas da página visível.
- Se uma NF reaparece inelegível em uma página atualizada, ela é removida da seleção local; qualquer mudança fora da página ainda é revalidada pela action.
- A action revalida no servidor todos os IDs selecionados, inclusive os preservados entre páginas.
- O retorno dos detalhes preserva filtros e paginação por `returnTo`, aceitando apenas a rota exata da listagem ou sua query string.

## Índices candidatos

Não foi criada migration de índice porque não houve acesso ao banco de homologação nem evidência de `EXPLAIN (ANALYZE, BUFFERS)`. Candidatos para validação:

- `operacoes (cedente_fundo_id, created_at DESC, id)`;
- `operacoes (cedente_id, created_at DESC, id)`;
- `consultor_cedente (consultor_id, cedente_id)`;
- `documento_requisito_instancias (politica_operacional_versao_id, nota_fiscal_id, escopo_snapshot)`;
- `documento_versoes (documento_id, numero_versao DESC)`;
- `documento_analises (documento_versao_id, analisado_em DESC)`.

Antes de qualquer índice, executar `EXPLAIN (ANALYZE, BUFFERS)` com volumes representativos, verificar índices existentes e medir escrita/bloat.

## Testes

Foram adicionados testes para:

- normalização e allowlist dos filtros;
- defaults e allowlist da busca/ordenação da nova solicitação;
- métricas calculadas apenas sobre a página;
- requisito ausente, enviado/em análise, aprovado e rejeitado;
- requisito opcional e pós-cessão sem bloqueio indevido;
- lote com 20 NFs;
- equivalência entre avaliação individual e batch;
- cálculo financeiro e médias ponderadas.

As validações finais executadas são registradas no handoff da implementação.

## Validações técnicas

- `npx tsc --noEmit`: aprovado.
- `npm test -- --run`: 47 arquivos e 331 testes aprovados.
- `npm run lint`: zero erros; 19 avisos preexistentes fora do Escopo 1.
- `git diff --check`: aprovado; somente avisos de conversão LF/CRLF do Git no Windows.
- `npx next build --webpack`: aprovado; permanecem os avisos preexistentes do Handlebars sobre `require.extensions`.

Não foi executada homologação autenticada contra dados reais nem `EXPLAIN (ANALYZE, BUFFERS)`. Portanto, métricas temporais, payload real e decisão sobre índices continuam pendentes de medição no ambiente de homologação.

## Próximo escopo

O Escopo 2 não foi iniciado. Permanecem fora desta entrega dashboards, relatórios, onboarding, listagens de NFs do gestor, documentos, sacado, notificações, auditoria, escrow, logística, integrações, CNAB e alterações de schema.
