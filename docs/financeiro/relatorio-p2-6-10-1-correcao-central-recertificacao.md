# P2.6.10.1 — Correção da Central e recertificação dos gates pendentes

## Parecer executivo

**P2.6.10.1: PASS.** Os quatro gates que estavam em falha na P2.6.10 foram recertificados em homologação e passaram: `CENTRAL_VISUAL_SMOKE`, `SMOKE_REVISAO_MANUAL`, `TOCTOU_OPERATION` e `STALE_REVIEW`.

O readiness evoluiu de **42 PASS / 4 FAIL / 2 PENDENTE / 1 N/A** para **46 PASS / 0 FAIL / 2 PENDENTE / 1 N/A**. A recomendação permanece **NO-GO**, pois `LEGACY_ENV_RETIREMENT` e `SINQIA_EXTERNAL` continuam pendentes e não pertencem ao escopo desta correção.

Somente o projeto Supabase de homologação `fhgkmggthxikfpogrvaa` foi utilizado. Produção não foi acessada ou alterada. Não houve migration, alteração de schema, reset, clean, migration repair, commit ou push.

## 1. Objetivo e baseline

A fase corrigiu duas regressões runtime P0 encontradas na certificação P2.6.10:

- falha 500 ao carregar notificações na Central;
- tentativa de alterar o cookie de fundo ativo durante renderização server-side.

Em seguida, recertificou os quatro gates que dependiam desses caminhos e repetiu as regressões financeiras, de autorização e de qualidade aplicáveis.

Baseline preservado:

- branch: `homolog`;
- migrations: 127 locais e 127 remotas;
- performance full pipeline: PASS;
- MFA, aprovação APTO, limite de 40% e dupla aprovação: PASS;
- readiness anterior: 42 PASS, 4 FAIL, 2 PENDENTE e 1 N/A.

## 2. P0 — Notificações

### Causa raiz

A leitura operacional do sino dependia do cliente da sessão em uma superfície endurecida por RLS e grants. A falha de autorização era propagada até a Central como erro 500. O caminho também dependia de resolução de identidade que não poderia voltar a usar leitura global de `profiles` após o hardening de identidade.

### Correção

A consulta passou a ser executada no servidor com service role, mas obrigatoriamente limitada ao `user.id` obtido da sessão autenticada. O usuário consultado não pode ser informado pelo cliente. Não foi reintroduzido `SELECT` global em `profiles` e nenhuma policy foi ampliada.

Resultado certificado:

- sino e contador carregam sem erro 500;
- usuário sem notificações recebe estado vazio válido;
- contador corresponde à coleção retornada;
- zero vazamento cross-user e cross-fund;
- teste permanente em `src/lib/notificacoes/listagem.server.test.ts`.

## 3. P0 — Fundo ativo e cookie

### Causa raiz

Uma mesma função resolvia o fundo ativo e persistia ou removia o cookie. Como essa função também era chamada durante renderização de Server Components, o fallback tentava executar `cookies().set/delete` fora de Server Action ou Route Handler.

### Correção

A responsabilidade foi separada:

- `src/lib/fundos/fundo-ativo.server.ts`: leitura e resolução read-only, inclusive fallback apenas em memória;
- `src/lib/actions/fundo-ativo.ts`: persistência explícita do fundo selecionado, restrita à Server Action.

Os consumidores server-side passaram a importar a resolução read-only. A troca explícita continua persistindo o cookie e o reload preserva a seleção. Fundo sem acesso continua negado.

Resultado certificado:

- render server-side sem write de cookie;
- leitura e fallback de usuário com um fundo: PASS;
- usuário multifundo e troca explícita: PASS;
- reload após troca: PASS;
- fundo não autorizado: DENY;
- teste permanente em `src/lib/fundos/fundo-ativo-runtime.test.ts`.

## 4. Impacto de autorização

As correções reduziram privilégios no caminho de renderização e não ampliaram RLS:

- notificações são filtradas pela identidade autenticada no servidor;
- fundo ativo é validado contra os vínculos autorizados do usuário;
- testemunhas de operação são carregadas por action que exige gestor e valida o fundo ativo antes da leitura server-side;
- Super Admin puro não obteve permissão operacional implícita;
- gestor de outro fundo e gestor sem vínculo foram negados.

O fluxo oficial de testemunhas foi endurecido em `src/lib/actions/operacao.ts`, com teste permanente em `src/lib/operacoes/testemunhas-runtime.test.ts`.

## 5. Credencial PostgreSQL direta

A credencial local foi atualizada após a rotação e validada diretamente contra homologação, sem registrar senha ou connection string completa.

- credencial atualizada: `true`;
- teste PostgreSQL direto: `PASS`;
- projeto conferido: `fhgkmggthxikfpogrvaa`;
- SQLSTATE de autenticação anterior `28P01`: resolvido.

Evidência: `direct-postgres-p2-6-10-1.json`.

## 6. Cleanup dos atores QA

Quatro atores sintéticos foram inventariados em todas as colunas UUID do schema público antes de qualquer ação. Nenhum `CASCADE` cego foi utilizado e nenhum histórico auditável foi removido.

Todos possuíam referências de fixture ou histórico e, por isso, foram classificados como `BUSINESS_FIXTURE_REQUIRED`. A ação segura foi `RETAINED_AND_DISABLED`:

- vínculos de fundo removidos;
- papéis ativos revogados;
- perfil tornado inativo;
- fatores MFA removidos quando existentes;
- usuário Auth banido;
- credenciais locais da certificação removidas.

Resultado: `UNRESOLVED_QA_ACTORS = 0` e gate de cleanup `PASS`.

Evidência: `qa-cleanup-p2-6-10-1.json`.

## 7. Central visual

A rota `/gestor/conciliacao` foi exercitada em navegador real com gestor QA em AAL2. Foram verificados carregamento, notificações, tabs, filtros, paginação, cards, tabelas, links, estados de loading e vazio, troca de fundo e reload.

Resultado:

- `CENTRAL_VISUAL_SMOKE = PASS`;
- erros HTTP 500: zero;
- hydration errors e redirect loops: zero;
- vazamento cross-fund: zero.

Evidência: `central-visual-smoke-p2-6-10-1.json`.

## 8. Revisão manual

Duas variantes independentes foram certificadas:

- liberar revisão: PASS; operação avançou somente após decisão autorizada;
- recusar revisão: PASS; operação permaneceu sem aprovação.

Controles negativos:

- sem TOTP fresco: DENY;
- TOTP inválido: DENY;
- Super Admin puro: DENY;
- gestor de outro fundo: DENY;
- gestor sem vínculo: DENY.

As revisões, execuções de risco, atores, fundos, estados anterior/posterior, evento de auditoria e correlation ID foram preservados na evidência. A reconciliação final confirmou o estado persistido no banco, evitando classificar como falha uma resposta de interface observada antes da conclusão da transação.

Evidência: `smoke-revisao-manual-p2-6-10-1.json`.

## 9. TOCTOU e overlap

Foi executada corrida autenticada usando fluxo oficial de alteração de testemunhas. Uma avaliação JIT foi iniciada e, durante sua janela, um input coberto pela assinatura/contexto foi legitimamente alterado.

Resultado:

- overlap observado: **21.909 ms**;
- assinatura/contexto mudou;
- conclusão com contexto antigo: DENY;
- operação não ficou aprovada pelo contexto obsoleto;
- nova avaliação foi exigida;
- auditoria preservada.

Evidência: `toctou-operation-p2-6-10-1.json`.

## 10. Stale review

Uma revisão manual válida foi criada, o contexto assinado foi alterado pelo fluxo oficial e a decisão sobre a revisão anterior foi tentada.

Resultado:

- revisão obsoleta: DENY;
- revisão antiga não aprovou a operação;
- histórico permaneceu armazenado;
- nova avaliação/revisão passou a ser necessária.

Evidência: `stale-review-p2-6-10-1.json`.

## 11. Regressões obrigatórias

Permaneceram aprovados:

- login autenticado e MFA;
- aprovação de operação APTO;
- limite de 40%;
- dupla aprovação concorrente;
- tentativa de bypass de aprovação;
- timeout fail-closed;
- Golden V1;
- Golden V2: 384/384;
- Golden Security: 5/5;
- P2.2: 44 verificações read-only e 29 de segurança;
- P2.2.1: schema, isolamento, backfill e linhagem;
- P2.3: 28 read-only, com duas ressalvas esperadas, e 23 de segurança;
- P2.4: 13 read-only e 27 de segurança;
- P2.5: 19 read-only e 16 de segurança;
- P2.6: 8 read-only e 25 de segurança.

O verificador Golden V2 foi corrigido para localizar a versão atualmente publicada pela `politica_operacional_id`, em vez de exigir que uma versão histórica fixa continuasse publicada após uma substituição legítima. A regra de negócio não foi alterada.

## 12. Data API, cross-fund, Storage e identidade

Como esta fase não alterou schema, RLS ou Storage, foram preservadas as matrizes completas certificadas e adicionados controles direcionados autenticados:

- Data API: 118/118 PASS;
- cross-fund: 39/39 PASS, `zero_leak=true`;
- Storage: 15/15 PASS;
- identidade: own profile/roles ALLOW; other profile/roles DENY; mutations e anon DENY;
- gestor: fundo próprio ALLOW e outro fundo DENY;
- Super Admin puro: sem operação de carteira implícita;
- híbrido: acesso operacional somente com papel gestor e vínculo ativo.

A auditoria read-only atual confirmou 127/127 migrations e 9 gates aprovados, zero falhas e uma pendência de ambiente canônico.

## 13. Performance

O P2.6.9 permaneceu PASS. Não houve reabertura de tuning. O sanity foi coberto pelos testes completos e pelo build de produção:

- p95 anterior: 7.957 ms;
- p95 posterior: 6.839 ms;
- melhoria preservada: 14,05%;
- zero timeouts e zero erros técnicos na certificação de performance existente.

## 14. Migrations e schema parity

Nenhuma migration foi criada ou aplicada. O baseline permaneceu em 127 migrations locais e 127 remotas. Não houve mudança de schema, edição de migration histórica ou migration repair.

Como não houve alteração estrutural, clean-room de schema não se aplicava. As mudanças de aplicação foram cobertas por testes, build, verificadores financeiros e recertificação autenticada em homologação.

## 15. Qualidade

Execução em Node **22.23.2**:

- TypeScript: PASS;
- Vitest: 1.040 testes PASS e 3 skipped conhecidos, em 148 arquivos PASS e 1 skipped;
- lint: PASS, 0 erros e 6 warnings preexistentes;
- `git diff --check`: PASS;
- Next.js 16.3.1, build webpack: PASS, 78 rotas geradas;
- `npm audit --omit=dev`: PASS, 0 vulnerabilidades.

O baseline mínimo de 1.033 testes foi superado e nenhum teste foi removido.

## 16. Secret scan

O scan vigente foi reexecutado sobre código e artefatos, incluindo evidências de MFA, navegador, concorrência, PostgreSQL e QA.

- resultado: PASS;
- findings: 0;
- senhas, tokens, connection strings e códigos TOTP não foram persistidos.

Evidência: `secret-scan-p2-6-1.json`.

## 17. Readiness antes e depois

| Estado | PASS | FAIL | PENDENTE | N/A |
|---|---:|---:|---:|---:|
| Antes — P2.6.10 | 42 | 4 | 2 | 1 |
| Depois — P2.6.10.1 | 46 | 0 | 2 | 1 |

Gates promovidos exclusivamente nesta fase:

- `CENTRAL_VISUAL_SMOKE`;
- `SMOKE_REVISAO_MANUAL`;
- `TOCTOU_OPERATION`;
- `STALE_REVIEW`.

Pendências mantidas:

- `LEGACY_ENV_RETIREMENT`;
- `SINQIA_EXTERNAL`.

Recomendação final: **NO-GO**.

## 18. Principais arquivos alterados

Runtime:

- `src/lib/fundos/fundo-ativo.server.ts`;
- `src/lib/actions/fundo-ativo.ts` e consumidores server-side;
- `src/lib/notificacoes/listagem.server.ts`;
- `src/lib/actions/notificacoes-listagem.ts`;
- `src/lib/actions/operacao.ts`;
- `src/app/gestor/operacoes/[id]/OperacaoDetalheGestorClient.tsx`.

Testes permanentes:

- `src/lib/fundos/fundo-ativo-runtime.test.ts`;
- `src/lib/notificacoes/listagem.server.test.ts`;
- `src/lib/operacoes/testemunhas-runtime.test.ts`;
- `src/lib/financeiro/risco/arquitetura.test.ts`;
- `src/test/server-only.ts` e alias correspondente em `vitest.config.ts`.

Runners e verificadores:

- `scripts/homologacao/financeiro/certificacao-p2-6-10-1/`;
- `scripts/perf9a/common.mjs`;
- `scripts/homologacao/rlx-golden-v2/verify.mjs`.

Evidências:

- `runtime-central-fixes-p2-6-10-1.json`;
- `qa-cleanup-p2-6-10-1.json`;
- `operational-recertification-p2-6-10-1.json`;
- evidências individuais dos quatro gates com sufixo `p2-6-10-1`;
- `production-readiness-p2-6-1.json`;
- `secret-scan-p2-6-1.json`.

Os artefatos P2.6.10 foram preservados como histórico.

## 19. Riscos residuais

- a aposentadoria das variáveis e caminhos legados de ambiente ainda não foi concluída;
- a homologação externa com Sinqia depende de credenciais e coordenação do provedor;
- os atores QA usados como fixtures não puderam ser excluídos fisicamente sem romper trilha auditável ou massa de negócio; eles permanecem inativos, sem papéis, sem vínculos, sem MFA e banidos no Auth;
- as matrizes Data API, cross-fund e Storage completas são as evidências vigentes da P2.6.9, complementadas nesta fase por auditoria read-only e negativos autenticados, pois schema/RLS/Storage não foram alterados.

## 20. Git status e encerramento

O working tree permanece com as alterações locais da P2.6.10/P2.6.10.1 e seus artefatos. Nenhum commit ou push foi executado.

Conclusão explícita:

- `P2.6.10.1 = PASS`;
- `CENTRAL_VISUAL_SMOKE = PASS`;
- `SMOKE_REVISAO_MANUAL = PASS`;
- `TOCTOU_OPERATION = PASS`;
- `STALE_REVIEW = PASS`;
- readiness final: **46 PASS / 0 FAIL / 2 PENDENTE / 1 N/A**;
- recommendation: **NO-GO**.
