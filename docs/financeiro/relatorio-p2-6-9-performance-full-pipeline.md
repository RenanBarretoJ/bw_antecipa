# P2.6.9 — Performance Full Pipeline pós-rotação de credenciais

## Parecer executivo

O gate **PERFORMANCE_FULL_PIPELINE foi aprovado em homologação**. No mesmo caso Golden V2, o p95 caiu de **7957 ms** para **6839 ms** (14.05% de redução), ficando 517 ms abaixo do limite formal de 7356 ms e 161 ms abaixo da meta desejada de 7000 ms.

Foram executados 5 warm-ups e 20 ciclos medidos antes e depois, sem remoção de outliers. Não houve timeout, erro técnico ou mudança no resultado semântico. Produção não foi acessada nem alterada.

O readiness global permanece **NO-GO** porque ainda há gates autenticados e de concorrência de outras fases classificados como bloqueadores pendentes. Esse parecer não rebaixa o PASS específico da P2.6.9.

## Retomada pós-rotação

- Ambiente: homologação.
- Project ref validado: `fhgkmggthxikfpogrvaa`.
- `credential_rotation_required=false`.
- `credential_rotation_completed=true`.
- Credencial administrativa utilizada somente pelo runner controlado.
- Nenhuma credencial, token ou URL com segredo foi gravada em logs ou artefatos.
- A tentativa anterior bloqueada por rotação foi preservada em `previous_attempt` nos artefatos oficiais.

## Protocolo reproduzível

- Dataset: `RLX_GOLDEN_V2`.
- Caso: `RLX_GOLDEN_V2:ca8b721e-333c-4051-a87b-9359e51449c4:80bd0bec-88eb-fb5e-b585-7cc7e6ac8ce0:2026-08-10`.
- Data operacional: `2026-08-10`.
- Antes: 5 warm-ups + 20 amostras.
- Depois: 5 warm-ups + 20 amostras.
- Percentil: nearest-rank.
- Outliers removidos: zero.
- Todas as amostras estão preservadas em `performance-full-pipeline-p2-6-9.json`.

## Baseline antes da otimização

| Métrica | Resultado |
|---|---:|
| p50 | 6867 ms |
| p95 | 7957 ms |
| máximo | 8864 ms |
| média | 7024.6 ms |
| desvio-padrão | 542.73 ms |
| round-trips | 66 |
| erros/timeouts | 0 / 0 |

O baseline não atendia o limite formal de 7356 ms.

## Profiling e causa da latência

O tracing real contabilizou 66 chamadas por execução antes da alteração: 6 RPCs e 60 chamadas REST/Data API. `pg_stat_statements` mostrou consultas individuais rápidas, predominantemente entre sub-milisegundos e poucos milissegundos. O plano da busca da última importação publicada utilizou `importacoes_publicada_unica_idx` e executou em 0,185 ms com buffers em cache.

Conclusão: a principal causa era o acúmulo de latência de rede em leituras repetidas entre matching, conciliação, exposição e projeção candidata. Não havia evidência para criar índice, migration ou reescrever RPC.

## Alterações aplicadas

1. Cache de leitura estritamente limitado à execução corrente, compartilhando dados publicados e imutáveis entre matching e conciliação.
2. Paralelização da projeção candidata com a atualização canônica independente.
3. Paralelização de leituras independentes na exposição.
4. Instrumentação formal do benchmark com guard de homologação, warm-up, amostras completas, percentis e tracing por etapa.

Não foram alterados: regras financeiras, classificadores, snapshots, contratos SQL/RPC, RLS, auditoria, locks, idempotência, fail-closed ou timeouts. Nenhuma migration ou índice foi criado.

## Resultado depois da otimização

| Métrica | Antes | Depois | Variação |
|---|---:|---:|---:|
| p50 | 6867 ms | 6065 ms | -11.68% |
| p95 | 7957 ms | 6839 ms | -14.05% |
| máximo | 8864 ms | 6916 ms | -21.98% |
| média | 7024.6 ms | 6127.85 ms | -12.77% |
| round-trips | 66 | 58 | -12.12% |

O resultado semântico permaneceu idêntico nos 40 ciclos formais: status técnico `CONCLUIDA`, decisão `BLOQUEADO`, motivos `POSICAO_SEM_MATCH`, `EXPOSICAO_INDETERMINADA` e `LIQUIDACAO_PARCIAL_PRESENTE`.

## Gates executados

- Golden clean-room: PASS.
- Data API/RLS: 118/118, PASS.
- Isolamento cross-fund: 39/39, zero vazamento.
- Storage privado/cross-fund: 15/15, PASS.
- Cron sem credencial: 401; rotas canônica e alias: 200.
- TypeScript: PASS.
- Testes: 145 arquivos aprovados, 1 skipped; 1033 testes aprovados, 3 skipped.
- Testes financeiros direcionados: 65 PASS.
- Estatística do benchmark: 2 PASS.
- Lint: PASS, zero erros e 6 warnings preexistentes.
- Build Next.js 16.3.1 com webpack: PASS.
- Dependency audit de produção: zero vulnerabilidades.
- Secret scan: 1077 arquivos, zero achados.
- Clean-room cleanup: PASS.

## Migrations e paridade

Não há migration na P2.6.9. O inventário MCP autenticado confirmou 127 migrations locais e 127 em homologação, com primeiro e último registros equivalentes. A P2.6.8.1 já havia comprovado paridade material zero e não houve alteração de schema desde então.

O snapshot PostgreSQL direto desta execução ficou como `DEFERRED_STALE_DB_PASSWORD_AFTER_ROTATION`: a senha de conexão direta mantida localmente era anterior à rotação. Isso não invalida o benchmark, os gates de API ou a paridade por MCP, mas deve ser atualizado antes de uma nova auditoria que exija conexão PostgreSQL direta.

## Riscos residuais e readiness

- O gate de performance P2.6.9 está concluído e aprovado.
- O readiness global continua NO-GO por smokes autenticados/MFA e cenários E2E de concorrência pendentes, documentados em `production-readiness-p2-6-1.json`.
- A margem desejada é de apenas 161 ms; recomenda-se monitorar p95 em homologação após mudanças futuras no pipeline.
- Não houve execução em produção, commit, push, reset ou repair de migration nesta fase.

## Arquivos principais

- `performance-baseline-p2-6-9.json`: todas as amostras e estatísticas antes.
- `performance-profile-p2-6-9.json`: profiling, planos, round-trips e decisões de otimização.
- `performance-changes-p2-6-9.json`: alterações e salvaguardas.
- `performance-full-pipeline-p2-6-9.json`: evidência consolidada antes/depois e gate formal.
- `production-readiness-p2-6-1.json`: matriz de readiness atualizada.
