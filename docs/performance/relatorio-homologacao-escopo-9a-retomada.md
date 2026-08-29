# Relatório de homologação — Escopo 9A.2 (retomada)

**Data da execução:** 31/07/2026

**Ambiente:** homologação

**Projeto Supabase:** `fhgkmggthxikfpogrvaa`

**Branch:** `homolog`

**Commit-base:** `15e379a fix: corrige isolamento multifundo nas policies RLS`

**Parecer:** **NO-GO**

## 1. Resumo executivo

Esta execução retomou os gates de homologação que permaneceram pendentes no
Escopo 9A histórico, após a aprovação formal do Escopo 9B. A massa PERF9A foi
preservada; não houve recriação, cleanup efetivo ou alteração de dados de
negócio permanentes.

Os pontos aprovados foram a matriz RLS pós-9B, as validações automatizadas do
projeto, o build, o EXPLAIN com a massa carregada, o Realtime direto entre
usuários e os 11 indicadores financeiros cobertos pelo golden dataset.

O gate não pode ser aprovado porque:

- o Storage permitiu que um usuário de outro fundo criasse URL assinada e
  baixasse um objeto do Fundo A;
- o smoke autenticado encontrou erros 500 em ações client-side de telas do
  cedente e do consultor;
- notificações reproduziram `CursorPayload inválido`;
- várias rotas excederam as metas de TTFB;
- ações críticas mutáveis e React Profiler não foram executados, portanto não
  há evidência suficiente para declarar consistência operacional completa.

O relatório histórico
[`relatorio-homologacao-escopo-9a.md`](./relatorio-homologacao-escopo-9a.md)
continua sendo o registro original e permanece NO-GO. Este documento registra
somente a retomada 9A.2.

## 2. Referência ao Escopo 9B

O Escopo 9B foi considerado pré-condição desta retomada. As migrations
informadas como aplicadas em homologação foram:

- `supabase/migrations/20260730190000_escopo9b_corrigir_isolamento_rls.sql`;
- `supabase/migrations/20260730194500_escopo9b_policies_explicitas.sql`;
- `supabase/migrations/20260730200000_escopo9b_corrigir_recursao_sacado_rls.sql`.

A documentação do isolamento está em
[`relatorio-escopo-9b-isolamento-rls.md`](./relatorio-escopo-9b-isolamento-rls.md).
Não foram editadas migrations antigas nem refeita a implementação do 9B.

## 3. Ambiente e pré-condições

Comandos executados:

```text
npm run perf9a:status -- --env-file .env.homolog
npm run perf9b:verify -- --env-file .env.homolog
npm run perf9a:cleanup -- --confirm PERF9A_fhgkmggthxikfpogrvaa
```

Resultado do ambiente:

| Item | Resultado |
|---|---:|
| Ambiente/branch | `homolog` / `homolog` |
| Projeto | `fhgkmggthxikfpogrvaa` |
| Usuários Auth PERF9A | 20 |
| Fundo A / Fundo B | 2 |
| RLS pós-9B | 50/50 testes aprovados |
| Cleanup | dry-run; 0 registros removidos |

Volumes registrados:

| Entidade | Volume |
|---|---:|
| `cedentes` | 180 |
| `cedente_fundos` | 121 |
| `politicas_operacionais` | 2 |
| `operacoes` | 250 |
| `notas_fiscais` | 1.000 |
| `documento_versoes` | 900 |
| `contas_escrow` | 80 |
| `movimentos_escrow` | 5.000 |
| `notificacoes` | 4.500 |
| `logs_auditoria` | 1.000 |
| `eventos_dominio` | 200 |

As credenciais da massa permaneceram fora do repositório, em arquivo local
restrito. Nenhuma credencial é reproduzida neste relatório.

## 4. Gate RLS pós-9B

**Resultado: PASS — 50/50.**

Foram repetidos os cenários de gestor A/B/multi-fundo, consultor A/B, cedente,
sacado e anon. Foram confirmados acesso autorizado, ocultação de dados do
outro fundo/carteira/CNPJ, bloqueio de escritas cruzadas e rejeição de RPCs
fora do contexto autorizado.

Evidência restrita mais recente:

```text
%LOCALAPPDATA%\BWAntecipa\perf9a\evidence\rls-escopo9b-fhgkmggthxikfpogrvaa-2026-07-31T13-40-48.450Z.json
```

Este resultado não neutraliza o achado de Storage, que é uma camada distinta
das policies das tabelas públicas.

## 5. Smoke autenticado das 26 rotas

O smoke foi executado por navegador headless com login e MFA TOTP para os
quatro perfis PERF9A A. O automatizador foi ajustado para consultar os fundos
PERF9A e fixar o cookie de fundo ativo do gestor antes das rotas.

Rotas testadas:

- Gestor: `/gestor/dashboard`, `/gestor/operacoes`,
  `/gestor/onboarding-cedentes`, `/gestor/notas-fiscais`,
  `/gestor/documentos`, `/gestor/cedentes`, `/gestor/escrow`,
  `/gestor/auditoria`, `/gestor/notificacoes`, `/gestor/relatorios`.
- Cedente: `/cedente/dashboard`, `/cedente/notas-fiscais`,
  `/cedente/operacoes`, `/cedente/operacoes/nova`, `/cedente/extrato`,
  `/cedente/notificacoes`.
- Consultor: `/consultor/dashboard`, `/consultor/operacoes`,
  `/consultor/escrow`, `/consultor/notificacoes`, `/consultor/relatorios`.
- Sacado: `/sacado/dashboard`, `/sacado/notas-fiscais`, `/sacado/aprovacao`,
  `/sacado/pagamentos`, `/sacado/notificacoes`.

As 26 navegações retornaram HTTP 200 e renderização sem tela de erro. Isso não
significa que todas as ações carregadas pela página passaram: o navegador
registrou falhas de Server Actions/client fetch em algumas rotas.

| Perfil | TTFB mínimo | Mediana | Máximo | Rotas com erro client-side |
|---|---:|---:|---:|---:|
| Gestor | 896 ms | 1.063 ms | 2.314 ms | 2 |
| Cedente | 951 ms | 3.075 ms | 6.009 ms | 6 |
| Consultor | 739 ms | 1.589 ms | 2.502 ms | 4 |
| Sacado | 767 ms | 900 ms | 1.113 ms | 2 |

Achados reproduzidos:

- `CursorPayload inválido` em notificações do gestor, cedente, consultor e
  sacado;
- respostas 500 em ações client-side de dashboard/listagens do cedente e do
  consultor;
- no primeiro carregamento do dashboard do gestor ainda foi observado o
  estado `Selecione um fundo ativo para continuar.` em uma chamada concorrente
  do contexto de fundo;
- não foram observados, na segunda rodada, bloqueios CSP do WebSocket do
  Realtime.

Evidência restrita mais recente:

```text
%LOCALAPPDATA%\BWAntecipa\perf9a\evidence\smoke-escopo9a2-fhgkmggthxikfpogrvaa-2026-07-31T13-35-23.495Z.json
```

**Parecer do gate: FAIL / NO-GO.** HTTP 200 isolado não é suficiente quando
ações necessárias da tela retornam 500 ou erro de cursor.

## 6. Paginação offset

**Resultado: PARTIAL.**

Os contratos e helpers de paginação foram cobertos pelos testes existentes e
pelos testes executados nesta retomada. Foram validados tipos, ordenação
determinística e composição server-side das consultas. A cobertura automatizada
não reproduziu todos os cenários de navegador exigidos na especificação, como
última página, página inexistente, troca de filtro na página 2, refresh e
retorno do detalhe em todas as oito listagens.

Arquivos de referência e testes:

- `src/lib/pagination/pagination.test.ts`;
- `src/lib/pagination/keyset.test.ts`;
- `src/lib/escrow/listagem.test.ts`;
- `src/lib/onboarding-cedentes/listagem.test.ts`;
- `src/lib/onboarding-cedentes/listagem.server.test.ts`.

Não foi introduzida alteração de regra ou migration de paginação nesta
retomada.

## 7. Paginação por cursor

**Resultado: FAIL / NO-GO.**

Os testes unitários de cursor e contratos passaram, mas o smoke autenticado
reproduziu `TypeError: CursorPayload inválido` no feed de notificações em mais
de um perfil. Assim, não é possível declarar aprovados os cenários de cursor
antigo, cursor inválido, filtro, cliques rápidos e refresh no navegador.

O contrato esperado continua sendo `created_at + id`, com ordem descendente e
desempate determinístico. A falha deve ser investigada no caminho de leitura
das notificações antes da liberação.

## 8. Realtime com duas sessões

**Resultado backend: PASS; resultado do gate completo: PARTIAL / NO-GO.**

O teste direto criou duas sessões Supabase independentes, enviou uma
notificação temporária ao usuário A, confirmou recebimento por A e ausência
para B, e confirmou isolamento backend. A atualização foi observada no canal
direto. O objeto temporário de teste foi removido.

Evidência restrita:

```text
%LOCALAPPDATA%\BWAntecipa\perf9a\evidence\realtime-escopo9a2-fhgkmggthxikfpogrvaa-2026-07-31T13-41-12.581Z.json
```

Durante o smoke web inicial foi identificado que o CSP autorizava HTTPS, mas
não `wss://*.supabase.co`. A correção direta foi aplicada em
`next.config.ts`, adicionando `wss://*.supabase.co` à diretiva `connect-src`.
Após reiniciar o servidor e repetir o smoke, o bloqueio CSP não voltou a ser
observado.

Ainda não houve validação completa em duas janelas reais com contador visual,
logout/login, reconexão, mudança de rota, deduplicação e ausência de reload
integral. Portanto o gate completo permanece pendente.

## 9. Ações críticas

**Resultado: NÃO EXECUTADO.**

Não foram executadas mutações operacionais como solicitar/aprovar operação,
aprovar/rejeitar documentos, aceite do sacado, confirmação de pagamento,
vinculação de fundo ou atribuição de política. A execução exigiria autorização
operacional explícita para alterar a massa PERF9A e um plano de restauração
individual por ação. Não foi feita inferência de aprovação a partir de testes
de leitura ou RLS.

Esse gate obrigatório continua sem evidência e contribui para o NO-GO.

## 10. Batch e N+1

**Resultado: NÃO EXECUTADO.**

Não foi realizada a matriz mutável de operações com 1, 10 e 50 NFs, lote com
20 NFs, concorrência, documento alterado entre tela e action ou requisito
pendente. Os testes existentes cobrem contratos e partes do domínio, mas não
substituem a medição de requests/queries do fluxo completo.

Não há autorização neste escopo para criar novas massas ou alterar a massa
PERF9A apenas para completar este gate.

## 11. Métricas reais de navegador

O automatizador capturou TTFB, tempo de carregamento, requests, bytes,
erros de console, `pageerror` e requests abortados nas 26 rotas.

- 26 rotas;
- 875 requests observadas;
- 2.517.374 bytes transferidos conforme a métrica disponível no navegador;
- somente 3 de 26 rotas ficaram dentro da referência de TTFB de 800 ms;
- nenhuma rota retornou LCP no modo headless utilizado (`lcpMs` nulo);
- rotas acima de 800 ms foram investigadas e registradas, não ocultadas.

As metas de referência não foram atingidas, especialmente em cedente,
consultor e listagens de gestor. O resultado permanece FAIL/PENDENTE.

## 12. React Profiler

**Resultado: NÃO EXECUTADO.**

Não foi incorporado React Profiler ao produto nem executada uma sessão DevTools
com coleta de commits. Não há evidência segura sobre componentes mais caros,
renders redundantes, efeitos duplicados ou custo do seletor remoto. Nenhuma
otimização especulativa foi aplicada.

## 13. EXPLAIN pós-volume

**Resultado: PASS parcial para o conjunto medido.**

Foram executados `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` com role
`authenticated` e claims dos usuários PERF9A para movimentos escrow,
relacionamentos operação/NF, operações, NFs, notificações, auditoria, RPCs de
onboarding, dashboards e relatórios.

Principais tempos observados na execução mais recente:

| Consulta | Tempo | Observação |
|---|---:|---|
| movimentos escrow por cursor | 0,075 ms | index scan/index only scan |
| operação por NF | 3,298 ms | index scans |
| operação por vínculo/status/data | 2,567 ms | sort limitado; index scan |
| NF por vínculo/status/data | 10,169 ms | seq scan observado |
| notificações do usuário | 0,869 ms | bitmap heap/index |
| notificações lidas | 0,539 ms | bitmap heap/index |
| auditoria por cursor | 19,847 ms | seq scan + sort |
| dashboard gestor | 106,701 ms | RPC |
| dashboard cedente | 22,518 ms | RPC |
| dashboard consultor | 15,974 ms | RPC |
| dashboard sacado | 71,750 ms | RPC |
| relatório gestor | 30,335 ms | RPC |
| relatório consultor | 19,407 ms | RPC |

Evidência restrita:

```text
%LOCALAPPDATA%\BWAntecipa\perf9a\evidence\explain-escopo9a2-fhgkmggthxikfpogrvaa-2026-07-31T13-41-38.605Z.json
```

## 14. Decisão sobre índices

**Decisão: não criar migration de índices nesta retomada.**

Os volumes atuais e os tempos das consultas RPC não demonstraram benefício
inequívoco que justifique alteração de schema durante a homologação. Foram
identificados candidatos para monitoramento:

| Candidato | Evidência atual | Decisão |
|---|---|---|
| `movimentos_escrow(conta_escrow_id, created_at DESC, id DESC)` | consulta medida rápida e sem volume retornado | monitorar |
| `operacoes_nfs(nota_fiscal_id, operacao_id)` | acesso por PK/joins medidos | monitorar |
| `notificacoes(usuario_id, created_at DESC, id DESC)` | bitmap index existente; tempo sub-ms | rejeitar por enquanto |
| `notificacoes(usuario_id, lida, created_at DESC, id DESC)` | bitmap index existente; tempo sub-ms | rejeitar por enquanto |
| `logs_auditoria(created_at DESC, id DESC)` | seq scan + sort em 1.125 linhas | avaliar com crescimento |
| `logs_auditoria(entidade_tipo, entidade_id, created_at DESC, id DESC)` | consulta por entidade já usa índice | rejeitar por enquanto |
| `operacoes(cedente_fundo_id, created_at DESC, id DESC)` | consulta medida em poucos ms | monitorar |
| `notas_fiscais(cedente_fundo_id, created_at DESC, id DESC)` | seq scan em 61 linhas; volume pequeno | monitorar |

Qualquer criação futura deve ser migration incremental, aplicada primeiro em
homologação e comparada com EXPLAIN antes/depois.

## 15. Golden dataset financeiro

**Resultado: 11/11 indicadores cobertos aprovados.**

O cálculo independente cobriu contagens, valores monetários, saldo escrow,
volume mensal, receita, operações totais e entregas em trânsito no Fundo A.
As comparações foram feitas com arredondamento monetário oficial e período
`2026-07`.

Indicadores aprovados:

- total de cedentes do gestor;
- operações ativas;
- volume ativo;
- volume do mês;
- saldo escrow;
- NFs pendentes;
- entregas em trânsito;
- volume bruto mensal do relatório gestor;
- receita mensal;
- volume total geral;
- total geral de operações.

Evidência restrita:

```text
%LOCALAPPDATA%\BWAntecipa\perf9a\evidence\golden-escopo9a2-fhgkmggthxikfpogrvaa-2026-07-31T13-41-51.704Z.json
```

O golden não cobre todos os campos de todos os dashboards nem resolve a
inconsistência histórica conhecida do consultor entre card mensal bruto e
linha mensal líquida. Essa regra não foi alterada neste escopo.

## 16. URLs assinadas e Storage

**Resultado: FAIL CRÍTICO / NO-GO.**

Foi criado um objeto temporário no bucket `documentos-v2`, sob um documento da
massa PERF9A do Fundo A. O usuário autorizado obteve URL assinada e download
HTTP 200. O usuário adversário do Fundo B também conseguiu criar URL assinada,
baixar o objeto com HTTP 200 e não foi bloqueado na listagem de `perf9a`.

O objeto temporário foi removido ao final do teste. A evidência indica falha de
isolamento no Storage/signed URL, mesmo com a matriz RLS das tabelas públicas
aprovada. Não há base para tratar isso como falso positivo sem revisar as
policies do bucket, a função de geração de URL e o contexto de autorização.

Evidência restrita:

```text
%LOCALAPPDATA%\BWAntecipa\perf9a\evidence\storage-escopo9a2-fhgkmggthxikfpogrvaa-2026-07-31T13-42-01.668Z.json
```

## 17. Logs e erros observados

O servidor Next.js foi executado com saída redirecionada para arquivo local
restrito, sem incluir logs no repositório. Foram observados:

- HTTP 200 nas navegações principais;
- Server Actions `POST` 500 em páginas do cedente e consultor;
- `CursorPayload inválido` no fluxo de notificações;
- requests abortados durante carregamento de alguns dashboards;
- bloqueio CSP de `wss` na primeira rodada, corrigido e não reproduzido na
  segunda rodada.

Não foram incluídos no relatório tokens, cookies, senhas, URLs assinadas,
paths completos de objetos ou stack traces. A revisão não encontrou motivo
para declarar o conjunto de erros como apenas warning preexistente; eles foram
classificados como funcionais/performance até correção e nova evidência.

## 18. Correções realizadas nesta retomada

Correções pequenas e diretamente ligadas aos gates:

- `next.config.ts`: autorização explícita de `wss://*.supabase.co` em
  `connect-src`, necessária para a conexão Realtime no navegador;
- `scripts/perf9a/smoke-escopo9a2-browser.mjs`: resolução dinâmica dos fundos
  PERF9A e fixação do cookie de fundo ativo do gestor no smoke;
- `scripts/perf9a/realtime-escopo9a2-homolog.mjs`: nota da evidência ajustada
  para não afirmar um bloqueio CSP após a correção;
- `scripts/perf9a/explain-escopo9a2-homolog.mjs`: remoção de variável não usada.

Scripts de evidência adicionados:

- `scripts/perf9a/smoke-escopo9a2-browser.mjs`;
- `scripts/perf9a/realtime-escopo9a2-homolog.mjs`;
- `scripts/perf9a/explain-escopo9a2-homolog.mjs`;
- `scripts/perf9a/golden-escopo9a2-homolog.mjs`;
- `scripts/perf9a/storage-escopo9a2-homolog.mjs`.

Não foram criadas migrations, RPCs, tabelas, índices ou alterações de regra de
negócio nesta retomada.

## 19. Validações automatizadas

| Comando | Resultado |
|---|---|
| `node --check scripts/perf9a/*.mjs` | PASS |
| `npx tsc --noEmit` | PASS |
| `npm test -- --run` | PASS — 65 arquivos, 442 testes |
| `npm run lint` | PASS — 0 erros, 6 avisos preexistentes |
| `git diff --check` | PASS — apenas avisos de normalização LF/CRLF |
| `npx next build --webpack` | PASS — build completo; warnings de `handlebars` |
| `npm run perf9a:status -- --env-file .env.homolog` | PASS; volumes preservados |
| `npm run perf9b:verify -- --env-file .env.homolog` | PASS — 50/50 |
| `npm run perf9a:cleanup -- --confirm PERF9A_fhgkmggthxikfpogrvaa` | PASS — dry-run, 0 removidos |

Testes direcionados adicionais executados antes do conjunto final: 8 arquivos,
104 testes aprovados, cobrindo paginação, cursor, notificações, escrow,
auditoria e onboarding.

## 20. Riscos residuais

Prioridade crítica:

1. isolamento de Storage por fundo/CNPJ aparentemente quebrado em URL assinada;
2. ausência de evidência de ações críticas e atomicidade sob clique duplo/retry.

Prioridade alta:

3. `CursorPayload inválido` em notificações;
4. erros 500 em Server Actions de cedente e consultor;
5. contexto de fundo ativo ainda produz erro concorrente no primeiro dashboard
   do gestor;
6. TTFB acima das referências em diversas listagens;
7. React Profiler não executado;
8. batch/N+1 não medido no cenário operacional completo.

Prioridade média:

9. LCP não coletado no modo headless;
10. cobertura financeira limitada aos 11 indicadores do golden desta retomada;
11. cenário real com duas janelas visuais, reconexão e contador do sino ainda
    pendente.

## 21. Rollback e preservação da massa

Não houve migration nem alteração permanente em dados de negócio. O rollback
da implementação local consiste em:

- remover os cinco scripts de evidência adicionados;
- reverter a inclusão de `wss://*.supabase.co` em `next.config.ts`, caso a
  correção seja rejeitada;
- preservar o relatório histórico 9A e o relatório 9B já modificado pelo
  usuário/agentes anteriores.

O objeto temporário do teste Storage e a notificação temporária do teste
Realtime foram removidos. A massa PERF9A **deve permanecer em homologação**;
não executar cleanup efetivo nesta etapa.

## 22. Arquivos alterados nesta execução

Arquivos criados ou alterados pela retomada:

- `docs/performance/relatorio-homologacao-escopo-9a-retomada.md`;
- `docs/performance/relatorio-homologacao-escopo-9a.md` — somente referência
  para este relatório;
- `next.config.ts`;
- os cinco scripts em `scripts/perf9a/` listados na seção 18.

O arquivo `docs/performance/relatorio-escopo-9b-isolamento-rls.md` já estava
modificado no início desta execução e foi preservado sem sobrescrever seu
conteúdo. O arquivo local não rastreado `teste_SMTP_ionos.py` também foi
preservado e não foi incluído nesta retomada.

## 23. Parecer final

**NO-GO para produção e para encerramento do Escopo 9A.2.**

O isolamento RLS das tabelas públicas foi aprovado, mas há um vazamento de
arquivo reproduzido no Storage, além de falhas funcionais de cursor e ações
client-side, metas de performance não atendidas e gates críticos sem execução.
O resultado não pode ser promovido por inferência a GO ou GO COM RESSALVAS.

Próximos bloqueios mínimos antes de nova avaliação:

1. corrigir e testar policies/autoridade de URL assinada no Storage com dois
   fundos;
2. corrigir `CursorPayload inválido` e repetir paginação no navegador;
3. investigar os 500 de Server Actions e o contexto inicial de fundo ativo;
4. executar ações críticas somente com autorização operacional e restauração
   comprovável;
5. executar batch/N+1, React Profiler e teste Realtime visual completo;
6. repetir smoke, Storage, golden, EXPLAIN e validações finais após as
   correções.

Não executar commit ou push nesta entrega, conforme o escopo 9A.2.

## Atualização posterior — Escopo 9C

Os bloqueadores críticos registrados neste relatório foram tratados e
retestados no Escopo 9C. O histórico e o parecer NO-GO desta execução 9A.2
permanecem inalterados. Consulte o relatório posterior:

[`relatorio-escopo-9c-bloqueadores-9a2.md`](./relatorio-escopo-9c-bloqueadores-9a2.md).

## Atualização posterior — Escopo 9A.3

A homologação final e o parecer de produção estão documentados em
[`relatorio-homologacao-escopo-9a-final.md`](./relatorio-homologacao-escopo-9a-final.md).
