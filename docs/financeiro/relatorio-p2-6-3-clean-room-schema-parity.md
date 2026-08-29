# P2.6.3 — Clean-room, Schema Parity e Bootstrap Reprodutível

## 1. Objetivo

Provar que o BW Antecipa pode ser reconstruído do zero pelos artefatos versionados e que o resultado é estruturalmente equivalente à homologação. Resultado final: **FAIL**.

## 2. Estado de entrada

- Branch: `homolog`.
- Homologação autorizada: `fhgkmggthxikfpogrvaa`, usada somente para snapshot `READ ONLY`.
- Produção: não consultada nem alterada.
- Cadeia ativa: 115 migrations, de `003_storage_buckets_env.sql` a `20260814230000_p2_6_gate_risco_decisao_operacional.sql`.

## 3. P2.6.2

O artefato `migration-history-repair-result.json` confirma 115 versões locais e 115 remotas após o repair histórico, sem mudança de schema ou dados naquele procedimento. O P2.6.3 confirmou que **paridade de histórico não equivale a paridade de schema**: SQL marcado como aplicado pode não estar materializado.

## 4. Node

O host possuía Node 24.19.0. Foi usado Node portátil oficial `v22.23.2`, com SHA-256 validado, para todo o runner clean-room. A suíte final não foi executada porque o gate de schema parity falhou antes dela.

## 5. Docker

Docker Desktop 4.86.0, Engine 29.7.2, contexto `desktop-linux`, `OSType=linux`. Nenhuma imagem, volume ou configuração normal do desenvolvedor foi removida.

## 6. WSL2

WSL2 foi comprovado com Ubuntu 24.04 e `docker-desktop` em versão 2.

## 7. Supabase local

Supabase CLI 2.111.0. O projeto descartável usou `project_id=bw-antecipa-p263-clean-room`, banco em `127.0.0.1:54322` e workspace temporário fora do repositório.

## 8. Inventário

Os 115 arquivos foram detectados dinamicamente. Foram validados nome, versão, ordem, duplicidade, conteúdo e SHA-256 contra o inventário P2.6.1. Nenhuma migration histórica foi editada.

## 9. Migrations

Na execução válida foram aplicadas 115/115 migrations ativas, sem retry. O histórico local descartável terminou com 116 linhas: bootstrap estrutural `001` + 115 migrations canônicas.

## 10. Primeira execução

A primeira tentativa parou em `003_storage_buckets_env.sql`: a migration pressupõe funções e tabelas-base que não existem em uma instalação Supabase vazia.

## 11. Falhas encontradas

1. **Dependência histórica ausente** antes da migration `003`.
2. **Schema parity**: 690 diferenças materiais entre clean-room e homologação.
3. O repair do P2.6.2 alinhou o histórico, mas não executou os 109 SQLs históricos marcados como aplicados.

## 12. Correções

O runner passou a reutilizar o bootstrap estrutural oficial e versionado do Escopo 9E, `scripts/perf9e/bootstrap/schema-base-candidate.sql`, copiado apenas para o projeto descartável como versão `001`. Não houve SQL manual, dump de homologação ou tolerância artificial a erros.

O comparador recebeu allowlist por nome exato para objetos internos do Supabase Storage local. Nenhuma diferença de domínio BW foi ignorada.

## 13. Migrations incrementais

Nenhuma migration incremental foi criada. Não é seguro sintetizar automaticamente uma migration de reconciliação com 690 diferenças, especialmente 671 grants, sem revisão de autorização e impacto operacional.

## 14. Execução final do zero

- Bootstrap estrutural: PASS.
- Migrations ativas: 115/115 PASS.
- Retry: 0.
- `supabase db push --dry-run --local`: banco atualizado, zero migrations pendentes.
- Schema parity: FAIL.

## 15. Snapshot de homologação

Capturado novamente em transação `BEGIN READ ONLY`, abrangendo `public`, `private` e `storage`. Nenhuma credencial ou connection string foi persistida.

## 16. Snapshot clean-room

Capturado com as mesmas consultas do snapshot remoto após a reconstrução integral.

## 17. Parity

| Métrica | Homolog | Clean-room |
|---|---:|---:|
| Relações | 111 | 113 |
| Colunas | 1.760 | 1.778 |
| Constraints | 845 | 851 |
| Índices | 408 | 412 |
| Rotinas | 213 | 215 |
| Triggers | 93 | 94 |
| Policies | 195 | 190 |
| Grants | 2.007 | 1.353 |
| Buckets | 7 | 7 |

Resultado: 690 diferenças materiais.

## 18. Diferenças allowlisted

Foram permitidas 49 diferenças ambientais, todas explicitamente identificadas:

- tabelas internas `storage.iceberg_namespaces` e `storage.iceberg_tables` e seus 18 campos, 5 constraints, 5 índices e 18 grants;
- definição interna da rotina `storage.filename(text)`, preservando a assinatura.

As policies `storage_contratos_gestor_insert/update` não foram allowlisted e permanecem materiais.

## 19. Bootstrap

O schema-base versionado e as 115 migrations foram aplicados. O bootstrap aplicacional foi bloqueado pela falha de parity.

## 20. Super Admin

Não executado. O gate estrutural anterior falhou; nenhuma credencial real foi reutilizada.

## 21. Fundos QA

Não criados. Não houve seed após a falha de parity.

## 22. Golden V1

Não executado por bloqueio estrutural.

## 23. Golden V2

Não executado; portanto não há evidência clean-room de 384/384.

## 24. P2.2

Verificadores funcionais e de segurança não executados no clean-room divergente.

## 25. P2.3

Matching, conciliação e security não executados.

## 26. P2.4

Posição logística e security não executados.

## 27. P2.5

PL D-2, exposição, overlay e security não executados.

## 28. P2.6

Gate, expected-risk-gate e security não executados.

## 29. RLS

Não executada a matriz de atores. A própria comparação já encontrou drift material: `devedores_solidarios` possui RLS/policies em homolog e não no clean-room; `eventos_dominio` e `logs_auditoria` têm policies semanticamente diferentes.

## 30. Multifundo

Cross-fund não executado porque a equivalência estrutural exigida antes do seed não foi atingida.

## 31. Storage

Os sete buckets relevantes estão presentes em ambos os snapshots. Testes reais de upload/download não foram executados. Duas policies de `contratos` existem apenas em homolog e são diferenças materiais.

## 32. Cron

Não executado. Nenhum provider externo foi chamado.

## 33. Build

Executado no Node 22.23.2: TypeScript PASS, 140 arquivos/1.017 testes PASS, lint sem erros e build Next.js 16.2.6 com webpack PASS (78 páginas). Permanecem apenas 6 warnings de lint e os warnings preexistentes de `require.extensions` do Handlebars.

## 34. Node 22

O runner estrutural foi executado com Node 22.23.2. O check `NODE_VERSION` permanece FAIL no readiness porque a matriz completa de TypeScript, testes, lint e build não chegou a ser executada.

## 35. Deployment dry-run

Supabase start, reconstrução, `db push --dry-run` local e build Node 22 passaram. `npm ci` em checkout novo, bootstrap aplicacional e post-deploy verify não foram executados; o dry-run completo está bloqueado.

## 36. Cleanup

A stack `bw-antecipa-p263-clean-room` foi parada e o workspace temporário removido. Ambientes normais do desenvolvedor foram preservados.

## 37. Atualização P2.6.1

- `MIGRATION_HISTORY_PARITY`: PASS, preservando evidência P2.6.2.
- `CLEAN_ROOM_MIGRATIONS`: PASS.
- `CLEAN_ROOM_SCHEMA_PARITY`: FAIL.
- `CLEAN_ROOM_SEED_E2E`, `GOLDEN_CLEAN_ROOM`, `RLS_CLEAN_ROOM`: PENDENTE/bloqueado.
- `DEPLOYMENT_DRY_RUN`: FAIL/incompleto.
- `NODE_VERSION`: FAIL até a matriz completa rodar em Node 22.

## 38. Blockers restantes

- 671 diferenças de grants em `public`.
- 10 diferenças de policies.
- 4 diferenças materiais de rotinas.
- 2 constraints, 1 índice, 1 trigger e o estado RLS de uma tabela divergentes.
- Golden, RLS, Storage, cron e full-stack ainda sem evidência clean-room.
- Dependency audit permanece gate independente.

## 39. Riscos

O principal risco é considerar homologação atual como representação fiel das migrations apenas porque os históricos estão alinhados. Grants amplos presentes somente no remoto também exigem revisão de segurança antes de qualquer reconciliação.

## 40. Parecer

**P2.6.3 = FAIL.** A cadeia versionada é aplicável do zero com o bootstrap estrutural oficial, mas o schema produzido não é materialmente equivalente à homologação. Não houve mutação de homologação ou produção, commit ou push. O próximo trabalho deve definir o estado canônico objeto a objeto e criar uma migration incremental revisada; somente então todo o clean-room deve ser reexecutado desde zero.
