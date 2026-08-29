# P2.6.1 — Homologação Operacional, Concorrência, Performance e Production Readiness

Data da execução: 17/08/2026
Ambiente mutável utilizado: homologação (`fhgkmggthxikfpogrvaa`)
Produção alterada: não
Recomendação final: **NO-GO**

## 1. Objetivo

O P2.6.1 avaliou, sem introduzir regra de negócio, se a cadeia P2.2–P2.6 está pronta para promoção futura. Foram examinados migrations, contratos Golden, RLS, Storage, cron, concorrência, fail-closed, performance, dependências, build e testes.

O trabalho encerra com evidência suficiente para uma decisão objetiva, mas não satisfaz todos os critérios de aceite de produção. O resultado correto é **NO-GO**.

## 2. Estado inicial

O estado inicial estabelecido pelo escopo era produção em NO-GO. Nenhum teste tinha autorização para alterar produção, reparar artificialmente o histórico de migrations ou trocar senha/MFA de usuário real.

Os guards de ambiente confirmaram homologação em todas as ações mutáveis. Nenhuma conexão mutável foi feita contra o project ref de produção.

## 3. Escopo executado

Foram executados:

- inventário determinístico das 115 migrations locais;
- comparação do histórico local com o histórico remoto de homologação;
- tentativa dos runners clean-room de banco e full-stack;
- auditoria estrutural read-only de schema, RLS, grants, Storage, cron e aliases;
- verificadores oficiais P2.2–P2.6, Golden V1 e Golden V2;
- concorrência real do gate no mesmo fundo e entre fundos;
- timeout real fail-closed;
- benchmark computacional 10k/25k/50k e benchmark do pipeline em homologação;
- varredura de segredos;
- TypeScript, testes, lint, diff check, build e auditoria de dependências.

Não foram executados por ausência de pré-condições seguras:

- smoke autenticado com Gestor QA e TOTP controlado;
- cenários E2E APTO, 40% exato e revisão manual;
- dupla aprovação autenticada e corridas TOCTOU completas;
- clean-room, parity, seed e RLS em base zero;
- smoke externo Sinqia.

## 4. Migrations

O repositório contém 115 migrations SQL ativas. O histórico remoto de homologação contém somente 6 versões reconhecidas. Há 109 migrations locais ausentes no histórico remoto, sem versões remotas excedentes nem conflito de nome detectado.

Isso não significa necessariamente que o schema de homologação não contém os objetos: o projeto possui histórico de aplicações manuais pelo SQL Editor. Significa que **a rastreabilidade da cadeia não comprova como o schema atual foi produzido**. Pelas regras do escopo, essa divergência é condição automática de NO-GO.

Não foram usados `supabase migration repair`, `--include-all` ou qualquer artifício para declarar paridade sem prova.

Evidência: `migration-inventory-p2-6-1.json` e `production-readiness-p2-6-1-read-only.json`.

## 5. Checksums

O inventário registra, para cada migration:

- ordem efetiva;
- versão/timestamp;
- nome do arquivo;
- SHA-256.

Resumo:

| Item | Valor |
|---|---:|
| Migrations locais | 115 |
| Versões no histórico remoto | 6 |
| Ausentes no histórico remoto | 109 |
| SHA-256 do manifesto | `a8f165b54ffe759851cea7fd52e086590d0eb55771222a08feee85a5fa911a09` |
| SHA-256 da migration P2.6 | `923ce02a83773e9e07715c549bf39004c2c4e622fd7904421b1810a3e0352b` |

Migrations aplicadas não foram editadas.

## 6. Clean-room

Os dois runners clean-room possuíam uma contagem fixa de 74 migrations. A causa raiz era uma expectativa obsoleta: o repositório já possui 115 migrations. A correção mínima tornou a descoberta e o denominador dinâmicos, sem alterar migrations nem regras do domínio.

Após a correção, os runners reconheceram 115 arquivos, mas o bootstrap não iniciou porque o Docker Desktop Linux Engine estava indisponível. O runner reportou `LegacyDockerLifecycleInspectError`/ausência do pipe do engine.

Resultado: **FAIL bloqueante**. Não houve bootstrap do zero, seed, E2E, RLS ou Golden em clean-room.

Evidência: `clean-room-p2-6-1.json`.

## 7. Schema parity

A auditoria read-only de homologação confirmou o domínio genérico e ausência estrutural de `rlx_*` ativo. Porém, schema parity exige comparar homologação com uma base reconstruída exclusivamente pela cadeia canônica.

Como o clean-room não foi criado, não foi possível comparar de forma completa:

- tabelas e colunas;
- tipos, defaults, constraints, FKs e índices;
- views, RPCs e triggers;
- policies, RLS e grants;
- configuração de Storage.

Resultado: **PENDENTE bloqueante**.

## 8. Golden

Em homologação existente:

- Golden V1: PASS;
- Golden V2: **384/384 PASS**;
- Golden V2 security: **5/5 PASS**;
- expected-logistics: PASS;
- expected-exposure: PASS;
- expected-risk-gate: PASS.

O Golden atual mantém PL D-2 de R$ 50.000.000 e exposição indeterminada/sem match, produzindo decisão BLOQUEADO com os motivos esperados.

A equivalência Golden homologação × clean-room não pôde ser provada. Portanto, Golden em homologação passa, mas Golden clean-room permanece pendente e bloqueante.

## 9. Smoke autenticado

Não havia no ambiente local credencial completa e controlada de Gestor QA (senha + TOTP) autorizada para automação. O escopo proíbe alterar senha/MFA de usuário real. Por isso não foi improvisado acesso privilegiado.

Não foram certificados por browser autenticado:

- login senha → TOTP → sessão;
- acesso exclusivo ao fundo autorizado;
- `/gestor/conciliacao` e suas subtabs;
- filtros, paginação, cards, históricos e links;
- ausência de hydration errors em sessão real.

Resultado: **PENDENTE bloqueante**.

## 10. APTO

O classificador e os verificadores cobrem o resultado APTO, mas não existia uma operação QA isolada, autenticada e com todos os sinais limpos para executar o fluxo oficial:

```text
gate JIT → RPC atômica → aprovação
```

Sem esse smoke real, o gate obrigatório de GO permanece pendente.

## 11. NO_LIMITE

O contrato do classificador preserva a regra de exatamente 40% como `NO_LIMITE + APTO`. Não foi criada uma massa operacional autenticada com percentual exatamente igual ao limite e sem qualquer outro bloqueio.

Resultado E2E: **PENDENTE bloqueante**.

## 12. BLOQUEADO

O cenário Golden vigente foi processado e retornou BLOQUEADO, incluindo motivos `POSICAO_SEM_MATCH` e `EXPOSICAO_INDETERMINADA`. Os testes de segurança confirmaram que decisão bloqueada não possui override e não permite aprovação.

O cenário acima do limite também está coberto pelos verificadores do gate. Resultado do contrato em homologação: PASS.

## 13. Revisão manual

Os contratos de `REVISAO_MANUAL`, liberação, recusa, expiração e assinatura foram verificados em código/SQL e pelas suites oficiais. A revisão exige justificativa, autorização por fundo e TOTP fresco; decisão BLOQUEADO não pode ser liberada.

Não houve execução autenticada real de liberar e recusar revisão. Resultado operacional: **PENDENTE bloqueante**.

## 14. TOTP

As ações críticas usam as verificações de sessão e TOTP previstas no domínio. A matriz de segurança negou revisão sem autorização fresca e confirmou a restrição do super admin puro.

Não foi possível demonstrar em browser/API autenticada:

- AAL antes e depois do TOTP;
- liberação e recusa reais;
- tentativa de reutilização do mesmo código/autorização.

Resultado E2E: **PENDENTE bloqueante**.

## 15. Bypass

Os verificadores confirmaram:

- RPC antiga de aprovação sem permissão de execução;
- persistência/simulação interna não exposta ao gestor;
- aprovação oficial chama o gate antes da mutação atômica;
- decisão bloqueada não possui override;
- super admin puro não aprova nem revisa;
- UI não é a fronteira de segurança.

Nenhum caminho antigo ativo capaz de contornar o P2.6 foi encontrado. Resultado estrutural/security suite: PASS.

## 16. Concorrência

### Gate duplo no mesmo fundo

Duas chamadas começaram exatamente em `2026-08-17T12:44:15.426Z`, terminaram em `12:44:15.570Z`, duraram 144 ms e retornaram o mesmo resultado `6f5795e4-f7b3-41cc-8af9-ac20e9eba80c`. O estado final possui uma única linha para a assinatura.

Resultado: PASS para advisory lock e idempotência do gate.

### Dupla aprovação

A RPC final possui advisory lock, lock da operação, validação de status, fundo, assinatura, `updated_at`, snapshot da taxa, decisão e revisão liberada. A suite de segurança confirma essas proteções.

Entretanto, duas aprovações oficiais simultâneas, autenticadas e sobre uma operação APTO, não foram executadas. Resultado E2E: PENDENTE bloqueante.

Evidência: `concurrency-p2-6-1.json`.

## 17. TOCTOU

O uso final valida novamente a assinatura e os snapshots antes da mutação. Mudanças de `updated_at`, taxa ou insumos invalidam o estado avaliado. A proteção existe no banco, não somente na UI.

Não foi possível executar a corrida completa thread A aprovação × thread B alteração em operação APTO autenticada. Resultado E2E: PENDENTE bloqueante.

## 18. Stale

Revisões são vinculadas à assinatura avaliada. Alteração de insumo relevante impede o uso de revisão anterior. A suite confirma o contrato, mas a corrida real revisão liberada × alteração × aprovação não foi executada.

Também permaneceram sem corrida E2E os cenários de retificação de PL, mudança logística e publicação concorrente de política. Resultado: PENDENTE bloqueante.

## 19. Timeout

Foi aplicado `RISK_GATE_TIMEOUT_MS=5000` apenas ao processo de teste. O pipeline excedeu o limite e produziu:

| Campo | Resultado |
|---|---|
| Status técnico | `AVALIACAO_RISCO_INDISPONIVEL` |
| Decisão | `BLOQUEADO` |
| Duração | 5.844 ms |
| Aprovado | não |

A configuração temporária foi removida em `finally`. Resultado: **PASS fail-closed**.

Evidência: `timeout-p2-6-1.json`.

## 20. Performance

Baseline P2.6 informado: p50 aproximado de 6,5 s e p95/máximo de 7,356 s.

Cinco execuções do pipeline real em homologação apresentaram:

| Etapa | p50 (ms) | p95/máximo (ms) |
|---|---:|---:|
| Matching | 754 | 1.388 |
| Reconciliação | 1.097 | 1.197 |
| Logística | 1.394 | 2.404 |
| Exposição | 2.312 | 2.580 |
| Simulação | 555 | 902 |
| Classificação | 0 | 0 |
| Persistência | 382 | 597 |
| **Total** | **7.284** | **9.692** |

Há regressão observada contra o baseline, especialmente no p95 total. Resultado: **FAIL bloqueante** até investigação de consultas, variabilidade de rede/ambiente e plano de capacidade.

Benchmark computacional isolado:

| Posições | Overlay | p50 (ms) | p95/máximo (ms) | Heap delta |
|---:|---:|---:|---:|---:|
| 10.000 | 1.000 | 10,89 | 17,68 | +1,34 MB |
| 25.000 | 2.500 | 21,99 | 27,15 | +3,43 MB |
| 50.000 | 5.000 | 43,61 | 56,30 | -1,73 MB |

Esse teste mede somente custo computacional em memória e não substitui o pipeline completo com banco.

## 21. Memória

O crescimento observado foi baixo nos volumes de 10k e 25k. O delta negativo em 50k decorre de coleta de lixo entre as amostras e não deve ser interpretado como consumo negativo real.

Recomendação técnica: manter medição de RSS/heap em runner Node 22, fixar warm-up e coletar p95 com amostra maior antes de definir timeout e capacidade de produção.

## 22. Multifundo

Duas avaliações em fundos distintos iniciaram simultaneamente em `12:44:15.709Z`, duraram 139 ms e 142 ms e produziram IDs distintos. Não houve compartilhamento de resultado nem serialização global observável.

RLS e grants também confirmam que super admin híbrido depende de `usuario_fundos` para operação. Resultado: PASS em homologação existente.

## 23. RLS

Foram executadas as matrizes vigentes P2.2–P2.6. As verificações cobriram 13 tabelas financeiras esperadas, policies e isolamento por fundo.

Confirmado em homologação:

- gestor não acessa raw/staging técnico;
- gestor não escreve histórico append-only;
- gestor A não lê recursos operacionais do fundo B;
- super admin puro administra infraestrutura, mas não opera carteira;
- perfil híbrido ainda exige vínculo ao fundo;
- operações internas não são executáveis por papéis indevidos.

RLS homologação: PASS. RLS clean-room: PENDENTE bloqueante.

## 24. Storage

O bucket `financeiro-importacoes` está privado, sem public access, com paths/policies orientados por fundo. A matriz vigente nega acesso cross-fund e mantém raw/staging fora do alcance do gestor.

Storage em homologação: PASS. A equivalência clean-room não pôde ser revalidada.

## 25. Cron

A rota canônica `/api/cron/financeiro` foi verificada quanto a:

- `CRON_SECRET`;
- dia útil ANBIMA;
- seleção de fundos ativos;
- capability resolution;
- ausência de provider;
- erro parcial e observabilidade.

`/api/cron/rlx-financeiro` funciona apenas como alias fino e não contém segundo motor. Os envs `FINANCEIRO_*` têm precedência.

Fallbacks inventariados:

| Fallback | Consumidor | Retirada recomendada | Condição |
|---|---|---|---|
| `RLX_MAX_PARSE_MS` | parsing financeiro legado | próximo ciclo de configuração | todos os ambientes com `FINANCEIRO_MAX_PARSE_MS` |
| `RLX_MAX_IMPORT_ROWS` | limite de importação legado | próximo ciclo de configuração | todos os ambientes com `FINANCEIRO_MAX_IMPORT_ROWS` |
| `RLX_PROVIDER_TIMEOUT_MS` | timeout de provider legado | antes de remover alias RLX | todos os ambientes com `FINANCEIRO_PROVIDER_TIMEOUT_MS` |

## 26. Auditoria

Os eventos do risco estão presentes no domínio: avaliação, bloqueio, solicitação, liberação, recusa e expiração de revisão. O fluxo carrega correlation ID entre estágios financeiros, exposição, risco e aprovação quando aplicável.

Os testes concorrentes persistentes usam namespace determinístico `P2.6.1_CONCURRENCY_EVIDENCE`. Não foram removidos porque constituem evidência append-only de QA.

## 27. Segredos

A varredura examinou 952 arquivos textuais versionados ou novos não ignorados e encontrou zero segredos. O scanner persiste apenas caminho, linha e classe do achado; nunca o valor.

O teste não registrou senha, TOTP, token, connection string ou secret. Evidência: `secret-scan-p2-6-1.json`.

## 28. Rollback

Plano obrigatório para futura promoção:

1. congelar mudanças e confirmar commit/tag exatos;
2. capturar backup/snapshot verificável do banco e inventário de Storage;
3. validar restauração em ambiente separado;
4. definir triggers de abortar: erro de migration, divergência de checksum, RLS/cross-fund, falha de build/smoke, regressão de gate;
5. em falha após início, interromper tráfego mutável e restaurar snapshot;
6. não improvisar down-migration sobre objetos append-only/versionados;
7. reconciliar objetos de Storage criados após o snapshot antes de reabrir tráfego.

O plano está READY, mas não foi ensaiado integralmente porque o dry-run clean-room falhou.

## 29. Deployment dry-run

Resultado por etapa:

| Etapa | Status |
|---|---|
| checkout/working tree | PASS |
| install existente | PASS operacional |
| build | PASS |
| migrations do zero | FAIL — Docker indisponível |
| seed bootstrap mínimo | PENDENTE |
| post-deploy checks | PENDENTE |

O build Next.js 16.2.6 gerou 78 páginas com sucesso. Há warnings do Handlebars sobre `require.extensions`.

O processo local usa Node v24.19.0, enquanto `package.json` exige Node 22.x. A suite e o build devem ser repetidos em Node 22.x/CI antes de promoção.

Auditoria de produção (`npm audit --omit=dev`): 23 vulnerabilidades, sendo 1 crítica, 16 altas, 4 moderadas e 2 baixas. Dependências diretas afetadas: Handlebars (crítica), Next (alta) e Puppeteer Core (alta). Não foram atualizadas nesta fase para evitar upgrade amplo sem regressão dedicada.

## 30. Providers externos

Sinqia não foi testada externamente porque não havia credencial segura de homologação fornecida ao runner. Isso é pendência não bloqueante para o core genérico, mas torna-se bloqueante para qualquer fundo cuja ativação dependa dessa integração.

Vórtx e Portal Custódia não fazem parte do runtime habilitado deste escopo. Layout real de Carteira deve ser homologado por administradora/fundo; o Golden prova apenas o contrato canônico.

## 31. Checklist de produção

O checklist machine-readable contém 48 gates:

| Status | Quantidade |
|---|---:|
| PASS | 27 |
| FAIL | 6 |
| PENDENTE | 14 |
| N/A | 1 |

Evidência: `production-readiness-p2-6-1.json`.

Gates obrigatórios ainda não PASS: migration history, clean-room, schema parity, Golden/RLS clean-room, smoke autenticado, APTO, 40%, revisão/TOTP, dupla aprovação, TOCTOU/stale, performance e deployment dry-run.

## 32. Blockers

1. **Migration history inconsistente:** 109 migrations locais não aparecem no histórico remoto.
2. **Clean-room indisponível:** Docker Desktop Linux Engine não iniciou; migrations do zero não foram provadas.
3. **Schema parity, Golden e RLS clean-room ausentes.**
4. **Smoke autenticado/MFA ausente:** não havia credencial Gestor QA controlada.
5. **Fluxos APTO, 40%, revisão, dupla aprovação e TOCTOU sem evidência E2E.**
6. **Performance:** p95 total de 9,692 s supera o baseline de 7,356 s.
7. **Dependências:** 1 vulnerabilidade crítica e 16 altas em dependências de produção.
8. **Toolchain:** execução local em Node 24, diferente do Node 22.x declarado.
9. **Deployment dry-run incompleto.**

Qualquer um dos cinco primeiros itens já impede GO pelas regras do escopo.

## 33. Pendências não bloqueantes

- smoke Sinqia enquanto nenhum fundo dependente for promovido;
- adapters Vórtx e Portal Custódia fora do runtime atual;
- homologação de layouts reais por administradora;
- retirada programada dos fallbacks `RLX_*`;
- limpeza dos 6 warnings de lint preexistentes;
- remoção futura do alias `/api/cron/rlx-financeiro` após consumidores migrarem.

## 34. Decisão GO/NO-GO

**NO-GO**.

A decisão é obrigatória, não discricionária. Há divergência no histórico de migrations e falha de clean-room, duas condições automáticas de NO-GO. Também faltam smoke autenticado, concorrência de aprovação E2E e comprovação de stale/TOCTOU.

## 35. Próximos passos

Ordem recomendada:

1. recuperar Docker Desktop/Linux Engine e repetir os dois clean-room runners;
2. diagnosticar a origem das 109 divergências do histórico sem usar repair para mascará-las;
3. definir cadeia canônica e procedimento de bootstrap reproduzível;
4. executar parity, seed, Golden, RLS e dry-run em clean-room;
5. fornecer Gestor QA isolado com senha/TOTP controlados;
6. executar matriz E2E APTO, 40%, bloqueado, revisão, dupla aprovação, TOCTOU e stale;
7. investigar o p95 do pipeline, com amostra maior e Node 22;
8. corrigir vulnerabilidades em branch/escopo dedicado e reexecutar PDFs/templates, testes e build;
9. homologar Sinqia/layout real somente para os fundos candidatos;
10. reemitir este checklist; considerar GO apenas com todos os blockers em PASS.

## 36. Parecer

O domínio financeiro demonstra boa proteção estrutural em homologação existente: Golden passa, RLS e Storage isolam fundos, o gate é idempotente, multifundo não serializa globalmente, timeout falha fechado, não há bypass conhecido e o build/testes passam.

Esses resultados não compensam a falta de reprodutibilidade do schema. Sem histórico confiável e sem reconstrução clean-room, não há prova de que produção possa ser criada ou atualizada de forma determinística. A ausência dos smokes autenticados e das corridas críticas também impede afirmar que a aprovação operacional está pronta sob concorrência real.

Portanto, o P2.6.1 conclui a auditoria com evidências úteis, mas o sistema permanece **NO-GO para produção** até a resolução e reexecução dos gates bloqueantes.

## Artefatos

- `migration-inventory-p2-6-1.json`
- `production-readiness-p2-6-1-read-only.json`
- `clean-room-p2-6-1.json`
- `concurrency-p2-6-1.json`
- `timeout-p2-6-1.json`
- `performance-p2-6-1.json`
- `secret-scan-p2-6-1.json`
- `dependency-audit-p2-6-1.json`
- `production-readiness-p2-6-1.json`

## Validações locais finais

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm test -- --run` | PASS — 139 arquivos, 1.014 testes |
| `npm run lint` | PASS — 0 erros, 6 warnings |
| `git diff --check` | PASS |
| `npx next build --webpack` | PASS — 78 páginas |

Nenhum commit e nenhum push foram executados.

## Atualização de evidências pelo P2.6.4

O P2.6.4 reconciliou o drift estrutural detectado no P2.6.3 por migrations incrementais normais. O estado atualizado é:

- histórico de migrations: **PASS**, com 120 locais e 120 remotas, sem ausências, excedentes ou divergência de nome;
- reconstrução estrutural clean-room: **PASS**, com bootstrap e 120/120 migrations;
- schema parity: **PASS**, com zero diferença material e 49 diferenças ambientais restritas à allowlist do Storage Iceberg local;
- Node 22: **PASS**, com TypeScript, 1.017 testes, lint e build executados em Node v22.23.2;
- Golden V1, Golden V2, Golden Security, P2.2–P2.6, RLS/ACL de atores e Storage: **PASS em homologação canonicalizada**;
- seed E2E, Golden e matriz autenticada dentro da API do clean-room local: **PENDENTE**;
- dependency audit: permanece **FAIL**, sem alteração nesta fase;
- performance do pipeline: permanece **FAIL** como gate de produção, apesar da melhora para p50 6.927 ms e p95 7.390 ms.

A recomendação do P2.6.1 permanece **NO-GO**. A canonicalização removeu os blockers de migration history, schema drift e toolchain, mas não autoriza promoção enquanto os gates clean-room funcionais, performance e dependências não forem concluídos.

Evidências: `schema-parity-p2-6-4.json`, `clean-room-p2-6-4-final.json`, `homolog-postflight-p2-6-4.json`, `performance-p2-6-4.json` e `production-readiness-p2-6-1.json`.
