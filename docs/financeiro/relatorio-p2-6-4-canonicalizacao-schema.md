# P2.6.4 — Canonicalização do Schema e Reconciliação de Drift

Data: 17/08/2026
Branch: `homolog`
Homologação: `fhgkmggthxikfpogrvaa`
Produção alterada: **não**
Resultado final: **P2.6.4 = FAIL**

## 1. Objetivo

Definir um schema canônico a partir de arquitetura, segurança, runtime e contratos vigentes; transformar as diferenças do P2.6.3 em decisões auditáveis; criar migrations incrementais convergentes; aplicar pelo fluxo normal em homologação; e provar reconstrução do zero e paridade estrutural.

## 2. Estado de entrada

O P2.6.3 havia aplicado 115/115 migrations no clean-room, mas comparava esse resultado a uma homologação com 690 diferenças materiais e 49 ambientais. O histórico de migrations estava alinhado, porém o schema produzido pela cadeia não representava o estado efetivo de homologação.

## 3. Evidência P2.6.3

O inventário inicial foi reconstruído a partir de `schema-parity-p2-6-3.json`, sem hardcode da contagem: 1 relation/RLS, 2 constraints, 1 index, 4 routines, 1 trigger, 10 policies e 671 grants. As 49 diferenças ambientais estavam associadas ao Supabase Storage local.

## 4. Metodologia

O trabalho foi dividido em diagnóstico, classificação, preflight, clean-room intermediário, aplicação normal em homologação, clean-room final, parity e regressão. Nenhuma migration histórica foi editada e nenhuma definição foi copiada por dump cego entre ambientes.

## 5. Regra de precedência

A decisão canônica seguiu: segurança/arquitetura aprovadas; runtime atual; contratos P2.2–P2.6; migration deliberada mais recente; homologação; clean-room. Homologação e clean-room foram tratados como evidências, não como fontes automáticas da verdade.

## 6. Inventário inicial

Foram identificadas 690 diferenças materiais e 49 ambientais. A classificação sem pendências resultou em: CANON_HOMOLOG 0; CANON_CLEAN_ROOM 8; CANON_NOVO_ESTADO 4; REMOVER_LEGADO 8; AMBIENTAL_ALLOWLIST 49; UNRESOLVED 0. O detalhamento e a proveniência estão em `schema-canonical-decisions-p2-6-4.json`.

## 7. Classificação

CANON_CLEAN_ROOM foi usado quando hardenings versionados posteriores representavam o contrato atual. CANON_NOVO_ESTADO foi usado para RLS/ACL multifundo e leitura de carteira do consultor. REMOVER_LEGADO cobriu grants, policies e índice sem consumidor legítimo. Nenhum item ficou sem decisão.

## 8. Grants

Os grants não foram tratados como 671 decisões independentes. A matriz foi agrupada por papel e classe de objeto. Homologação passou de 2.007 para 1.200 grants; o clean-room canônico possui 1.218. Os 18 grants restantes de diferença pertencem exclusivamente aos objetos Storage Iceberg permitidos. Em `public`, anon passou de 444 privilégios explícitos para zero.

## 9. Default privileges

Foram auditados `pg_default_acl`, ACL explícita de relations e routines e privilégios efetivos. Objetos futuros do owner `postgres` falham fechados. Defaults históricos de `supabase_admin` foram registrados como infraestrutura Supabase; migrations BW continuam responsáveis por grants nominais e explícitos.

## 10. anon

O estado canônico remove EXECUTE e privilégios de tabela concedidos diretamente a `anon` no domínio BW. Aprovação, helpers internos, escrita documental e rotinas técnicas não são expostos. A contagem antes/depois está em `acl-diff-p2-6-4.json`.

## 11. authenticated

`authenticated` mantém somente acessos necessários à Data API e RPCs públicas deliberadas. Escritas críticas diretas continuam negadas. O SELECT em `public.cedentes` foi restaurado explicitamente porque a matriz autenticada provou que consultores dependem desse grant; a RLS limita cada carteira.

## 12. service_role

`service_role` preserva operações server-side necessárias, sem receber EXECUTE nos motores internos de trigger/aprovação. A contagem final em `public` é 595 privilégios de tabela e 34 de rotina. Os grants são nominais, não globais.

## 13. RLS

A política canônica mantém RLS e ACL como camadas complementares. A matriz cobre gestor, cedente, consultor, sacado, super admin e perfis híbridos. A definição está em `rls-canonical-p2-6-4.json` e `security-matrix-canonical-p2-6-4.json`.

## 14. Devedores solidários

`public.devedores_solidarios` ficou com RLS habilitada, SELECT do cedente sobre o próprio cadastro e SELECT do gestor somente por vínculo ativo e fundo autorizado. A policy legada `gestor_all` foi removida e nenhuma escrita direta de aplicação foi aberta.

## 15. Eventos de domínio

`eventos_dominio_insert` foi canonicalizada para gestor, cedente e sacado. O sacado somente registra eventos com visibilidade permitida e relacionados a NF/operação do próprio CNPJ destinatário. A ausência de contexto válido falha fechada.

## 16. Logs de auditoria

`logs_auditoria` ficou append-only para usuários: SELECT do gestor e INSERT do próprio ator. UPDATE e DELETE não foram concedidos a `authenticated`. O `service_role` mantém capacidade técnica explícita.

## 17. Storage

As policies legadas de INSERT/UPDATE direto no bucket `contratos` foram removidas. Upload e substituição continuam server-side. A matriz PERF9A validou 19 cenários de leitura, escrita autorizada, cross-fund, anon, traversal de path e expiração de URL assinada.

## 18. Constraint de notas fiscais

`notas_fiscais.valor_bruto` foi canonicalizada como `CHECK (valor_bruto > 0)`. O preflight em homologação comprovou zero linhas com valor igual a zero antes da alteração. Nenhum dado de negócio foi corrigido ou removido para acomodar a constraint.

## 19. FK de remessas CNAB

Foi adicionada e validada a FK de `remessas_cnab.integracao_fundo_versao_id` para `integracao_fundo_versoes(id)` com `ON DELETE RESTRICT`. O preflight comprovou zero referências órfãs.

## 20. Índice de cálculo

`idx_operacao_calculo_nfs_operacao` foi removido por ser redundante: o índice UNIQUE `(operacao_id, nota_fiscal_id)` já atende o prefixo `operacao_id`. A remoção foi condicionada à presença do índice equivalente.

## 21. Aprovação financeira

O motor `aprovar_operacao_atomica_financeiro_v1` foi restaurado como rotina interna. `aprovar_operacao_atomica` permanece apenas como wrapper endurecido e sem EXECUTE para browser. A Server Action usa o gate de risco e a RPC atômica atual.

## 22. Gate P2.6

O fluxo canônico permanece: browser → Server Action → gate P2.6 JIT → RPC atômica → motor financeiro. O trigger `operacoes_bloquear_aprovacao_financeira_direta` impede transição direta para aprovada. Os testes de bypass, override bloqueado e persistência interna passaram.

## 23. CT-e

`registrar_cte_documento` foi canonicalizada com repositório, versão, CT-e, vínculo NF, vínculo com `nota_fiscal_entrega` e atualização de `documento_requisito_instancias`. Isso preserva uma única evidência entre documento, logística e checklist.

## 24. Outras RPCs

Helpers usados somente por trigger ou validação tiveram grants de Data API removidos. As RPCs públicas necessárias continuaram nominais. Nenhuma função nova foi criada apenas para igualar contagens.

## 25. Triggers

O trigger de bloqueio de aprovação direta foi restaurado como `BEFORE INSERT OR UPDATE OF status`. Os demais triggers divergentes foram reconciliados por definição versionada e mantiveram timing/eventos originais compatíveis com o runtime atual.

## 26. Estado canônico

O estado canônico final contém 111 relations de domínio/infra comparáveis em homologação, 215 routines, 94 triggers, 192 policies e 1.200 grants. O clean-room possui somente os objetos Iceberg adicionais da infraestrutura Storage local.

## 27. Migration funcional

`20260817150505_p2_6_4_canonicalizar_schema_funcional.sql` trata constraints, FK, índice, rotinas e trigger com prechecks transacionais. Não altera dados de negócio.

## 28. Migration de segurança

`20260817150507_p2_6_4_canonicalizar_acl_rls.sql` define RLS, policies e matriz de grants/revokes por papel. `20260817152140_p2_6_4_fechar_acl_rotinas_internas.sql` fecha a exposição residual de helpers internos.

## 29. Migration de Storage

`20260817150510_p2_6_4_canonicalizar_storage.sql` remove policies legadas de escrita direta. `20260817154500_p2_6_4_restaurar_leitura_carteira_consultor.sql` é um follow-up de segurança funcional: restaura somente SELECT em `cedentes`, mantendo RLS e mutações bloqueadas.

## 30. Preflight

O preflight de homologação passou: projeto correto, transação read-only, zero NF incompatível, zero remessa órfã e objetos esperados presentes. O snapshot foi salvo em `homolog-preflight-p2-6-4.json`.

## 31. Clean-room intermediário

O clean-room intermediário aplicou bootstrap e 119 migrations sem retry, em Node v22.23.2, e encerrou com limpeza do stack/workspace. Ele validou a convergência técnica antes da aplicação remota.

## 32. Aplicação em homologação

As migrations foram aplicadas ao project ref `fhgkmggthxikfpogrvaa` por `supabase db push` normal. Não houve SQL Editor, `migration repair`, `--include-all` ou mutation em produção. Os dois lotes estão registrados em `deployment-p2-6-4.json` e `deployment-p2-6-4-follow-up.json`.

## 33. Migration history

O postflight registra 120 migrations locais e 120 remotas, missing 0, remote-only 0 e name mismatch 0. O `db push --dry-run` retornou banco remoto atualizado e zero migrations pendentes.

## 34. Clean-room final

O ambiente final foi destruído e reconstruído do zero com bootstrap e 120/120 migrations. Os checks canônicos e o `db push --dry-run` local passaram; o stack e o workspace descartável foram removidos ao final.

## 35. Parity

O comparador final retornou PASS, zero diferenças materiais e 49 diferenças ambientais. A allowlist foi revalidada e contém somente `storage.iceberg_namespaces`, `storage.iceberg_tables` e `storage.filename(text)` e seus metadados dependentes.

## 36. Golden

No schema canonicalizado de homologação: Golden V1 PASS; Golden V2 384/384; Golden Security 5/5. Esses contratos não foram executados contra a API do clean-room local final; por isso `GOLDEN_CLEAN_ROOM` permanece PENDENTE e não é convertido artificialmente em PASS.

## 37. RLS

Em homologação canonicalizada, PERF9A passou para Gestor A, Gestor B, gestor multifundo, consultores A/B, cedente e sacado. Cross-fund permaneceu oculto e writes/RPCs indevidos foram negados. A mesma matriz autenticada não foi executada contra a API local do clean-room final.

## 38. ACL

Os testes reais de homologação negaram anon, writes diretos e execução de motores internos. O grant SELECT de consultor em `cedentes` foi o único acesso reaberto após evidência funcional, sempre protegido por RLS. Não há grant BW residual para anon.

## 39. Storage

O Escopo 9C passou em 19 cenários no ambiente canonicalizado: upload/download autorizados, cross-fund negado, anon negado, traversal negado e URLs assinadas com expiração. O clean-room estrutural comprovou policies idênticas, mas não repetiu a matriz via API local.

## 40. P2.2–P2.6

Em homologação: P2.2 read-only 44 e security 29; P2.2.1 capabilities PASS; P2.3 read-only 28 e security 22; P2.4 read-only 13 e security 26; P2.5 read-only 19 e security 16; P2.6 read-only 8 e security 25. Golden e isolamento não regrediram. Os dois diagnósticos P2.3 são de fixture/estado de dados, não falhas de contrato.

## 41. Node 22

Toda a validação final foi executada em Node v22.23.2. O teste específico do comparador passou pelo runner Vitest: 1 arquivo e 3 testes.

## 42. Build

`npx tsc --noEmit` PASS; `npm test -- --run` PASS com 140 arquivos e 1.017 testes; `npm run lint` PASS com zero erro e seis warnings preexistentes; `git diff --check` PASS; `npx next build --webpack` PASS com 78 páginas.

## 43. Regressões

Não houve regressão material de Golden, aprovação, multifundo, CT-e, logística, CNAB, RLS ou Storage em homologação. O seed PERF9A foi removido integralmente após os testes. Produção permaneceu intocada.

## 44. Blockers restantes

Três gates impedem concluir integralmente o aceite do P2.6.4: `CLEAN_ROOM_SEED_E2E`, `GOLDEN_CLEAN_ROOM` e `RLS_CLEAN_ROOM` não foram executados pela API local do ambiente reconstruído. Para production readiness também permanecem a auditoria de dependências (1 critical, 16 high), performance do pipeline e smokes autenticados posteriores.

## 45. Riscos

O risco estrutural de drift foi eliminado. O risco residual principal é confundir equivalência de schema com equivalência funcional full-stack: homologação prova o runtime canonicalizado, mas não substitui a execução autenticada dentro do clean-room. O benchmark melhorou para p50 6.927 ms e p95 7.390 ms, ainda acima do baseline p95 de 7.356 ms.

## 46. Parecer

O schema canônico está definido, versionado, aplicado normalmente em homologação e reproduzível do zero com zero diferença material. Segurança, Golden e P2.2–P2.6 passaram no ambiente canonicalizado. Entretanto, o critério de aceite exige Golden, seed E2E e matriz RLS dentro do clean-room, e essa evidência não foi produzida. Portanto, sem usar “PASS com ressalvas”, o resultado correto é **P2.6.4 = FAIL**. O P2.6.1 foi atualizado somente onde há evidência: migration history, clean-room migrations, schema parity e Node 22 estão PASS; os três gates clean-room funcionais continuam PENDENTE e a recomendação permanece NO-GO.

## Artefatos principais

- `schema-canonical-decisions-p2-6-4.json`
- `schema-drift-p2-6-4.json`
- `acl-diff-p2-6-4.json`
- `security-matrix-canonical-p2-6-4.json`
- `rls-canonical-p2-6-4.json`
- `schema-functional-canonical-p2-6-4.json`
- `homolog-preflight-p2-6-4.json`
- `clean-room-p2-6-4-intermediate.json`
- `deployment-p2-6-4.json`
- `deployment-p2-6-4-follow-up.json`
- `clean-room-p2-6-4-final.json`
- `schema-parity-p2-6-4.json`
- `homolog-postflight-p2-6-4.json`
- `performance-p2-6-4.json`

Nenhum commit e nenhum push foram executados.
