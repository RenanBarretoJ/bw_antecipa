# P2.6.6 — Hardening RLS Multifundo e Correção da Matriz Funcional

## Parecer executivo

O P2.6.6 eliminou os três vazamentos cross-fund críticos comprovados no P2.6.5, removeu o mesmo padrão vulnerável de outras superfícies documentais, logísticas, jurídicas e CNAB, restaurou acessos financeiros legítimos e reexecutou integralmente o clean-room. O resultado final é **PASS**, com zero policy multifundo vulnerável, zero diferença material de schema e zero vazamento na matriz autenticada.

O relatório histórico do P2.6.5 permanece como FAIL crítico. Esta documentação registra uma nova execução posterior à correção. O parecer global de produção continua **NO-GO**, pois os blockers independentes descritos na seção 44 não pertencem ao P2.6.6.

## 1. Objetivo

Eliminar autorização operacional baseada somente no papel global `gestor`, exigir vínculo ativo em `usuario_fundos`, corrigir falsos negativos da matriz funcional sem ampliar indevidamente acessos e provar o resultado em ambiente reconstruído do zero.

## 2. Estado de entrada

- Homolog e repositório possuíam 120 migrations alinhadas.
- Schema parity estava em PASS, com zero diferença material.
- Golden V1, V2 e Security estavam em PASS.
- O P2.6.5 foi interrompido por três vazamentos reais encontrados pela Data API autenticada.

## 3. Vazamentos encontrados no P2.6.5

Os três casos abaixo retornavam HTTP 200 com uma linha visível quando deveriam ficar isolados por RLS:

- `GESTOR_B -> documento_requisito_instancias do FUNDO_A`;
- `GESTOR_B -> ctes do FUNDO_A`;
- `GESTOR_B -> canhotos do FUNDO_A`.

Esses resultados são preservados como evidência de entrada em `rls-hardening-p2-6-6.json`.

## 4. Causa raiz

Policies históricas concediam acesso usando apenas o papel global de gestor. O papel identificava a função do usuário, mas não o fundo ao qual o registro pertencia nem o vínculo ativo do usuário com esse fundo.

## 5. Policies permissivas do PostgreSQL

Policies permissivas aplicáveis ao mesmo comando são combinadas por `OR`. Logo, uma policy `gestor global -> ALL` tornava irrelevante qualquer policy paralela mais restritiva por fundo. A correção removeu a concessão global e concentrou o predicado operacional em uma regra contextual canônica.

## 6. Auditoria global de gestor

A auditoria pós-migration catalogou 146 ocorrências: 80 policies e 66 helpers. Resultado:

- `GLOBAL_LEGITIMO`: 47;
- `MULTIFUNDO_CORRETO`: 33;
- `HELPER_INTERNO`: 66;
- `MULTIFUNDO_VULNERAVEL`: 0;
- `UNRESOLVED`: 0.

O inventário completo contém schema, tabela, policy, comando, definição, uso de gestor global, escopo de fundo e classificação.

## 7. documento_requisito_instancias

A policy global foi removida. O acesso do gestor agora resolve o fundo pela cadeia documental real, inclusive entrega e NF, e exige `usuario_fundos` ativo. O acesso legítimo do cedente à própria NF foi preservado. Resultado final: gestor A vê o fixture do fundo A; gestor B vê zero linhas do fundo A.

## 8. CT-e

As policies `ctes_select` e `ctes_gestor_all` deixaram de conceder acesso por papel global. O fundo é resolvido pelo contexto direto do CT-e ou pela relação CT-e/NF. O caminho positivo do gestor A e o isolamento do gestor B passaram.

## 9. Canhoto

O acesso do gestor é resolvido pela entrega/NF e pelo fundo correspondente, sem duplicar `fundo_id` artificial. O teste positivo do fundo A e o negativo cross-fund passaram.

## 10. Helpers logísticos

`public.logistica_usuario_pode_ler_entrega` foi corrigida para usar a regra canônica de fundo. Também foram revisados helpers de documento gerado, remessa CNAB, contexto documental, requisito, entrega e CT-e. Helpers privados usam `search_path` explícito e não introduzem uma concessão direta a browser.

## 11. Demais tabelas documentais

O hardening abrangeu `documentos_repositorio`, `documento_versoes`, `documento_vinculos`, `documento_requisito_instancias`, `documento_analises`, `nota_fiscal_entregas`, `eventos_entrega`, `ctes`, `cte_notas_fiscais` e `canhotos`. A varredura também encontrou e corrigiu concessões globais residuais em política operacional, requisitos, templates, documentos gerados, remessas e Storage documental.

## 12. Análise P1

Cada DENY inesperado foi confrontado com o runtime antes de qualquer mudança. O resultado foi 10 `POLICY_BUG`, um `FIXTURE_BUG` e zero itens sem resolução. Nenhum recurso foi aberto apenas para satisfazer o runner.

## 13. Operação do cedente

O portal consulta `operacoes` diretamente com a sessão do cedente. O expected ALLOW era correto; o defeito estava no fixture, que não assegurava uma operação pertencente ao ator. A seleção passou a usar a cadeia operacional real. Resultado: uma operação própria visível e nenhuma ampliação cross-cedente.

## 14. Domínio financeiro

`matching_resultados`, `conciliacao_resultados`, `exposicao_execucoes`, `risco_execucoes` e `posicao_logistica_*` têm consumidores autenticados na Central Financeira. O helper antigo exigia literalmente `perfil_no_fundo='gestor'` e bloqueava um gestor legítimo com perfil de administrador do fundo. A helper financeira agora delega à regra canônica operacional e continua exigindo fundo ativo e atribuição ativa.

## 15. Views financeiras

`estoque_atual`, `aquisicoes_atuais`, `liquidacoes_atuais` e `carteira_atual` permanecem read-only. SELECT contextual por fundo passou; UPDATE e DELETE foram testados e negados com SQLSTATE 42501. Nenhum grant de escrita foi introduzido.

## 16. Runner CT-e

O runner deixou de consultar uma coluna `id` inexistente em `cte_notas_fiscais` e passou a usar a chave composta `cte_id` + `nota_fiscal_id`. Isso foi uma correção exclusiva de teste, sem mudança de autorização.

## 17. Runner bypass

O teste agora parte de `solicitada`, tenta `aprovada` por Data API autenticada e relê o estado. Evidência: `status_before=solicitada`, `attempted_status=aprovada`, `actual=DENY`, `status_after=solicitada`. A fixture é descartável e o cleanup é defensivo.

## 18. Migrations

Foram criadas três migrations incrementais, sem editar histórico:

1. `20260817171441_p2_6_6_hardening_rls_multifundo_documental_logistico.sql` — hardening P0;
2. `20260817171442_p2_6_6_corrigir_acessos_financeiros_legitimos.sql` — correções P1 comprovadas;
3. `20260817174233_p2_6_6_remover_gestor_global_politicas_operacionais.sql` — três policies adicionais detectadas pela auditoria global.

As migrations alteram policies, helpers e grants; não modificam NFs, operações, CT-es, canhotos ou Golden data.

## 19. Clean-room técnico

As duas primeiras migrations passaram no clean-room técnico antes de homolog. Depois da auditoria global, a terceira migration também passou em novo clean-room técnico antes de ser aplicada.

## 20. Testes P0

Os três vazamentos prioritários foram os primeiros casos de segurança revalidados. Todos retornaram HTTP 200 com zero linhas — isolamento RLS esperado para SELECT — e os controles positivos simétricos do gestor A retornaram registros.

## 21. Aplicação em homolog

As migrations foram aplicadas pelo fluxo normal do Supabase CLI no projeto autorizado `fhgkmggthxikfpogrvaa`, somente depois do clean-room técnico e dos gates P0. Nenhum `migration repair` e nenhum SQL Editor manual foram usados nesta fase.

## 22. Migration history

Resultado final detectado dinamicamente: 123 migrations locais e 123 remotas, sem ausentes, remotas extras ou divergência de ordem. A última versão é `20260817174233`. A contagem e a última versão também foram confirmadas de forma read-only pela MCP autenticada do Supabase.

## 23. Parity

Homolog pós-P2.6.6 e clean-room pós-P2.6.6 possuem zero diferença material BW. As 49 diferenças restantes estão explicitamente classificadas como ambientais do Supabase Storage local/Iceberg.

## 24. Clean-room final

A reexecução usou novo workspace, novo stack Supabase, novo Auth, JWTs novos, atores novos e seed novo. Resultado PASS. Ao final, o stack foi parado e o workspace removido.

## 25. Golden

Golden V1, Golden V2, Golden Security e os contratos P2.2, P2.3, P2.4, P2.5 e P2.6 passaram no clean-room final.

## 26. Data API

A matriz autenticada cresceu para 86 checks e terminou 86/86 PASS. Para SELECT isolado, HTTP 200 com zero linhas foi corretamente tratado como DENY; para fixtures positivos conhecidos, zero linhas seria falha.

## 27. RLS

A regra canônica exige ator autenticado, perfil ativo, papel operacional gestor e vínculo ativo em `usuario_fundos` para o fundo do registro. Super Admin puro não satisfaz a regra implicitamente.

## 28. Cross-fund

A matriz final executou 39 checks: 39/39 PASS, `zero_leak=true`. As nove superfícies documentais/logísticas exigidas foram cobertas explicitamente.

## 29. Storage

Os 15 cenários de Storage passaram. O bucket continua privado, inserções documentais do gestor são resolvidas pelo fundo e tentativas cross-fund permanecem negadas.

## 30. Gestor

Gestor A acessa recursos do fundo A e não acessa fundo B; gestor B segue a relação inversa. Os testes positivos evitam a falsa solução de bloquear todos os atores.

## 31. Cedente

O cedente preserva acesso ao próprio contexto documental e à própria operação. Não houve ampliação para documentos ou logística de outro cedente/fundo.

## 32. Consultor

A matriz não identificou novo acesso documental/logístico para consultor. O hardening não incluiu consultor na helper operacional de gestor.

## 33. Sacado

Nenhuma policy corrigida passou a usar o papel de sacado como autorização genérica. Os acessos existentes continuaram limitados ao vínculo funcional já definido.

## 34. Super Admin

Super Admin puro administra a estrutura, mas não ganha leitura operacional de carteira. Nos controles P2.6.6, permaneceu com zero linha nas superfícies operacionais testadas.

## 35. Híbrido

`SUPER_ADMIN_GESTOR_A` recebe acesso somente quando também possui papel operacional gestor e `usuario_fundos` ativo para o fundo A. O papel administrativo isolado não é suficiente.

## 36. Approval bypass

A tentativa direta de alteração de status foi negada e o estado permaneceu `solicitada`. O trigger `operacoes_bloquear_aprovacao_financeira_direta` foi confirmado ativo.

## 37. Service role

O service role continua restrito ao runner/backend. O check corrigido confirmou leitura da linhagem CT-e/NF pela chave composta. Isso não foi convertido em grant de browser.

## 38. Cron

`/api/cron/financeiro` e o alias `/api/cron/rlx-financeiro` retornaram 200 no ambiente local; requisição sem segredo retornou 401. Nenhum provider externo foi chamado.

## 39. Node

Todo o ciclo final foi executado com Node `v22.23.2`, compatível com `engines: 22.x`.

## 40. Testes

- TypeScript: PASS;
- Vitest: 141 arquivos e 1.019 testes PASS;
- lint: PASS, zero erros e seis warnings preexistentes;
- `git diff --check`: PASS.

## 41. Build

`next build --webpack` passou no Node 22. Permanecem apenas warnings conhecidos de `require.extensions` do Handlebars; nenhuma falha de build foi introduzida.

## 42. P2.6.5 reexecutado

O P2.6.5 foi reexecutado integralmente sob a fase de artefatos P2.6.6 e terminou PASS. O resultado histórico original não foi alterado e continua registrado como FAIL crítico.

## 43. P2.6.1 atualizado

Somente gates com nova evidência foram alterados para PASS: `CLEAN_ROOM_SCHEMA_PARITY`, `CLEAN_ROOM_SEED_E2E`, `GOLDEN_CLEAN_ROOM`, `RLS_CLEAN_ROOM`, `NODE_VERSION` e `DEPLOYMENT_DRY_RUN`. A recomendação permanece NO-GO.

## 44. Blockers restantes

- `AUTHENTICATED_SMOKE_LOGIN_MFA`;
- `CENTRAL_VISUAL_SMOKE`;
- `SMOKE_APTO_APPROVAL`;
- `SMOKE_NO_LIMITE_40`;
- `SMOKE_REVISAO_MANUAL`;
- `DOUBLE_OPERATION_APPROVAL`;
- `TOCTOU_OPERATION`;
- `STALE_REVIEW`;
- `PERFORMANCE_FULL_PIPELINE` (FAIL);
- `DEPENDENCY_AUDIT` (FAIL).

## 45. Riscos

- A credencial de homologação deve ser rotacionada fora destes artefatos: `credential_rotation_required=true`.
- A recomendação global continua NO-GO enquanto houver smoke autenticado, concorrência, performance e dependências pendentes/falhando.
- As 49 diferenças ambientais de Storage devem continuar na allowlist explícita; não devem ser promovidas a diferenças funcionais ignoradas genericamente.
- As policies futuras devem usar a helper canônica, evitando recriar OR permissivo por papel global.
- A consulta read-only dos Advisors do Supabase encontrou backlog fora do escopo: 103 avisos de segurança (93 WARN e 10 INFO) e 367 de performance (166 WARN e 201 INFO). As classes incluem `function_search_path_mutable`, execução autenticada de funções `SECURITY DEFINER`, RLS sem policy, FKs sem índice e múltiplas policies permissivas. Elas exigem triagem própria; não correspondem a vazamento cross-fund residual da matriz P2.6.6.

## 46. Parecer

O escopo de segurança do P2.6.6 está concluído. Os vazamentos documentais/logísticos foram eliminados, os acessos positivos legítimos foram restaurados com evidência de runtime, a auditoria global não deixou vulnerabilidade multifundo sem resolução e o estado foi reproduzido do zero com parity material zero. Produção não foi consultada nem alterada; não houve commit nem push.

**P2.6.6 = PASS**

## Artefatos principais

- `docs/financeiro/rls-hardening-p2-6-6.json`
- `docs/financeiro/rls-global-gestor-audit-p2-6-6.json`
- `docs/financeiro/access-denials-analysis-p2-6-6.json`
- `docs/financeiro/access-matrix-p2-6-6.json`
- `docs/financeiro/cross-fund-api-p2-6-6.json`
- `docs/financeiro/storage-api-p2-6-6.json`
- `docs/financeiro/runner-fixes-p2-6-6.json`
- `docs/financeiro/clean-room-e2e-p2-6-6.json`
- `docs/financeiro/golden-clean-room-p2-6-6.json`
