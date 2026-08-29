# P2.5.1 — Generalização estrutural do domínio financeiro

Data da validação: 14/08/2026
Branch: `homolog`
Projeto Supabase alterado: `fhgkmggthxikfpogrvaa` (homologação)
Produção: não acessada
Commit/push: não executados

## 1. Motivo

P2.2 a P2.5 criaram uma infraestrutura reutilizável de ingestão, matching, conciliação, logística e exposição. O prefixo estrutural `rlx_` fazia essa infraestrutura parecer propriedade do primeiro fundo consumidor. P2.5.1 corrige a semântica sem alterar cálculos ou regras.

## 2. Problema arquitetural

Tabelas, views, RPCs, helpers e módulos compartilháveis estavam acoplados nominalmente à RLX. Isso dificultava leitura multifundo, induzia novos desenvolvimentos a criar exceções por fundo e tornava o schema incompatível com a arquitetura de capabilities já existente.

## 3. Regra de classificação

- **Renomear:** objeto que existiria igual para qualquer fundo.
- **Manter Golden:** dataset, fixture, provider ou script de QA especificamente RLX.
- **Manter histórico:** migration anterior, relatório anterior e versão de regra já persistida.
- **Manter compatibilidade:** rota antiga fina e fallback temporário de env, sem fonte de verdade paralela.

## 4. Inventário `rlx`

O diagnóstico cobriu `pg_class`, `pg_views`, `pg_indexes`, `pg_constraint`, `pg_proc`, `pg_trigger`, `pg_policies`, código, scripts, testes, `package.json`, `vercel.json` e documentação. Foram classificados 19 tabelas, 4 views, 19 funções/RPCs e identificadores estruturais de constraints, índices, policies e triggers.

Após a migration, o verificador encontrou `0` relações, funções, policies ou triggers estruturais residuais com prefixo `rlx_` nos schemas `public` e `private`.

## 5. Objetos renomeados

A migration utiliza `ALTER ... RENAME`, preservando identidade física. Foram renomeadas 23 relações (19 tabelas e 4 views), 19 funções e todos os identificadores estruturais encontrados em constraints, índices, policies e triggers.

## 6. Tabelas

| Antes | Depois |
|---|---|
| `rlx_importacoes_financeiras` | `importacoes_financeiras` |
| `rlx_importacao_arquivos` | `importacao_arquivos` |
| `rlx_importacao_linhas` | `importacao_linhas` |
| `rlx_importacao_ciclos` | `importacao_ciclos` |
| `rlx_estoque_posicoes` | `estoque_posicoes` |
| `rlx_aquisicao_movimentos` | `aquisicao_movimentos` |
| `rlx_liquidacao_movimentos` | `liquidacao_movimentos` |
| `rlx_carteira_snapshots` | `carteira_snapshots` |
| `rlx_matching_execucoes` | `matching_execucoes` |
| `rlx_matching_resultados` | `matching_resultados` |
| `rlx_matching_candidatos` | `matching_candidatos` |
| `rlx_titulo_nf_vinculos` | `titulo_nf_vinculos` |
| `rlx_titulo_nf_vinculo_chaves` | `titulo_nf_vinculo_chaves` |
| `rlx_conciliacao_execucoes` | `conciliacao_execucoes` |
| `rlx_conciliacao_resultados` | `conciliacao_resultados` |
| `rlx_posicao_logistica_execucoes` | `posicao_logistica_execucoes` |
| `rlx_posicao_logistica_resultados` | `posicao_logistica_resultados` |
| `rlx_exposicao_execucoes` | `exposicao_execucoes` |
| `rlx_exposicao_overlay_itens` | `exposicao_overlay_itens` |

Nenhuma tabela recebeu prefixo `financeiro_`, `bw_` ou `core_`.

## 7. Views

Foram renomeadas `rlx_estoque_atual`, `rlx_aquisicoes_atuais`, `rlx_liquidacoes_atuais` e `rlx_carteira_atual` para `estoque_atual`, `aquisicoes_atuais`, `liquidacoes_atuais` e `carteira_atual`. O OID e a configuração `security_invoker` foram preservados.

## 8. RPCs

Foram generalizadas as RPCs de início de ciclo, validação de linhagem, persistência de matching, confirmação/revogação manual, conciliação, posição logística e exposição. Todos os consumidores ativos foram migrados; não há RPC estrutural `rlx_*` como fonte de verdade paralela.

## 9. Helpers

Helpers privados passaram para nomes `financeiro_*` quando tratam autorização/auditoria compartilhada, ou para nomes de domínio (`matching_*`, `titulo_nf_*`, `posicao_logistica_*`, `exposicao_*`) quando específicos de uma etapa. Corpos dependentes foram atualizados sem alterar comportamento.

## 10. Constraints

Constraints com prefixo estrutural foram renomeadas dinamicamente após preflight de colisão. Tipo, expressão, deferrability, validação, `ON DELETE` e `ON UPDATE` não foram recriados. A migration aborta se detectar qualquer constraint pública não validada.

## 11. Índices

Índices `rlx_*` e `idx_rlx_*` foram renomeados para identificadores sem RLX. Definições, colunas, predicados parciais, unicidade e OIDs permaneceram intactos.

## 12. Policies

Policies `rlx_*` foram renomeadas com `ALTER POLICY`. Roles, expressões `USING` e `WITH CHECK` permaneceram ligadas aos mesmos OIDs de tabela e helpers generalizados. O estado final contém 19 policies para as 19 tabelas generalizadas.

## 13. Triggers

Triggers estruturais foram renomeados com `ALTER TRIGGER`; funções e condições permaneceram as mesmas. O inventário pós-migration não encontrou trigger residual com `rlx`.

## 14. Código

O código compartilhável saiu de `src/lib/rlx/` e está em:

```text
src/lib/financeiro/ingestao
src/lib/financeiro/matching
src/lib/financeiro/conciliacao
src/lib/financeiro/logistica
src/lib/financeiro/exposicao
```

Actions, loaders, admin, conciliação, políticas e tipos de banco foram migrados para os nomes canônicos. O teste estrutural `src/lib/financeiro/estrutura.test.ts` bloqueia reintrodução de `CREATE TABLE rlx_`, `CREATE VIEW rlx_` e `src/lib/rlx/` fora do allowlist.

## 15. Rotas

O cron canônico passou a ser `/api/cron/financeiro`, configurado em `vercel.json`. `/api/cron/rlx-financeiro` é apenas alias temporário que reexporta o mesmo handler; não existe segundo motor. Rotas do gestor e admin já eram genéricas e foram mantidas.

## 16. Scripts

Scripts compartilháveis foram agrupados em `scripts/homologacao/financeiro/{ingestao,conciliacao,logistica,exposicao}`. Scripts e fixtures `rlx-golden`/`rlx-golden-v2` foram mantidos por serem artefatos deliberadamente específicos de QA. Foram adicionados `apply-generalizacao.mjs` e `verify-generalizacao.mjs`.

## 17. Envs

As configurações canônicas são `FINANCEIRO_MAX_IMPORT_ROWS`, `FINANCEIRO_MAX_PARSE_MS` e `FINANCEIRO_PROVIDER_TIMEOUT_MS`. Os nomes `RLX_*` equivalentes permanecem apenas como fallback temporário de homologação, com precedência dos nomes genéricos.

## 18. Golden preservado

`RLX_GOLDEN_V1`, `RLX_GOLDEN_V2`, nomes de fundos QA, fixtures, providers Golden e diretórios Golden continuam RLX. Resultado: Golden V1 aprovado e Golden V2 aprovado em `384/384`, com segurança `5/5`.

## 19. Rule versions preservadas

`RLX_MATCH_V1`, `RLX_RECON_V1`, `RLX_LOGISTICA_V1` e `RLX_EXPOSICAO_V1` foram preservadas. Layouts e fingerprints RLX já congelados também não foram falsamente renomeados. Uma nova versão só deverá surgir quando houver mudança semântica real.

## 20. Audit events

Novos eventos/origens estruturais usam nomes genéricos, como `IMPORTACAO_FINANCEIRA_*`, `POSICAO_LOGISTICA_*`, `EXPOSICAO_*`, `ingestao_financeira`, `financeiro_logistica` e `financeiro_exposicao`. Eventos históricos persistidos não foram reescritos.

## 21. Migration

Arquivo: `supabase/migrations/20260814220000_p2_5_1_generalizacao_dominio_financeiro.sql`.

A migration possui `BEGIN`, preflight de colisões, snapshots de OID/RLS/ACL/contagem, renames, atualização segura de corpos dependentes, validações finais e `NOTIFY pgrst, 'reload schema'`. Migrations anteriores não foram editadas.

## 22. Integridade pré/pós

O aplicador registrou igualdade explícita nos agregados principais:

| Conjunto | Antes | Depois |
|---|---:|---:|
| Importações | 40 | 40 |
| Resultados de matching | 49 | 49 |
| Resultados de conciliação | 36 | 36 |
| Resultados logísticos | 16 | 16 |
| Execuções de exposição | 3 | 3 |

A migration comparou contagem e OID para cada uma das 23 relações. Qualquer divergência teria revertido a transação. Contagens atuais das 19 tabelas: `40, 40, 576, 0, 487, 51, 30, 8, 3, 49, 51, 21, 77, 2, 36, 2, 16, 3, 0`, na ordem documentada na seção 6.

## 23. RLS

O verificador pós-migration confirmou 19/19 tabelas com RLS, 19 policies e 72 FKs. As matrizes de segurança P2.2, P2.3, P2.4 e P2.5 passaram com 29, 22, 26 e 16 verificações, respectivamente. Escrita direta em tabelas derivadas continua bloqueada.

## 24. Multifundo

O schema não contém constraint exigindo RLX e todas as entidades operacionais mantêm `fundo_id`. O estado homologado contém dados financeiros representando quatro fundos nas execuções principais, provando reutilização da mesma estrutura.

## 25. Regressões P2.2

Verificador funcional: `44/44`. Segurança: `29/29`. Ingestão, capabilities, publicação, linhagem e isolamento mantiveram resultado após os renames.

## 26. Regressões P2.3

Verificador funcional: `28/28`. Segurança: `22/22`. Matching e conciliação mantiveram precedência e valores. Permanecem duas ressalvas conhecidas do dataset: precedência mais forte por chave NF-e e cenário D-1 `COMPLETO_VAZIO`; não foram introduzidas por P2.5.1.

## 27. Regressões P2.4

Verificador funcional: `13/13`, cobertura `expected-logistics` de 100% e segurança `26/26`. Snapshots, fingerprints e classificações logísticas permaneceram iguais.

## 28. Regressões P2.5

Verificador funcional: `19/19`; segurança: `16/16`. O cenário validado preservou PL D-2 de R$ 50.000.000, posição de R$ 1.169.452,36 e limite de 40%, sem alteração do cálculo ou overlay.

## 29. Testes

- `npx tsc --noEmit`: passou.
- `npm test -- --run`: 136 arquivos e 988 testes passaram.
- `npm run lint`: passou sem erros; seis warnings preexistentes fora do escopo.
- `git diff --check`: passou.
- Golden V1: passou.
- Golden V2: 384/384.
- Golden V2 security: 5/5.
- `npx next build --webpack`: passou; os avisos remanescentes são do uso preexistente de Handlebars/`require.extensions`.

## 30. Limitações

- O alias `/api/cron/rlx-financeiro` e fallbacks de env antigos ainda existem por compatibilidade temporária.
- Parsers, layouts, datasets e providers que são realmente RLX-specific mantêm seus nomes.
- Scripts financeiros reutilizam helpers de segurança de homologação localizados no pacote Golden; isso não afeta runtime nem schema, mas pode ser extraído para um helper comum em evolução futura.
- Este escopo não altera regras, não cria gate final e não inicia P2.6.

## 31. Riscos

- Ambientes que ainda chamam exclusivamente a rota ou env antiga dependem dos aliases temporários até sua retirada planejada.
- Produção ainda precisará executar a migration incremental em janela controlada; não foi acessada nesta fase.
- Os dois desvios conhecidos de expectativa do dataset P2.3 devem permanecer documentados para não serem confundidos com regressão.

## 32. Parecer

O domínio financeiro está estruturalmente generalizado e pronto para ser consumido por múltiplos fundos e providers sem namespace RLX. Dados, UUIDs/OIDs, RLS, grants, FKs, snapshots, rule versions e resultados funcionais foram preservados. A migration foi aplicada exclusivamente em homologação, o schema cache foi recarregado e não restaram objetos estruturais ativos `rlx_*`. O build final passou. O parecer é favorável ao encerramento da P2.5.1, sem commit, push ou início da P2.6.
