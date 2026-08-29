# Relatório — Evolução de Estabelecimentos: reuso documental, workflow, gate e UI escalável

**Resultado final: `EVOLUCAO_ESTABELECIMENTOS_DOCUMENTOS_UI = PASS`**

Ambiente: homologação Supabase `fhgkmggthxikfpogrvaa`. Produção
(`wwsndnuvnjuabpbjwlck`) não foi tocada em nenhum momento. Nenhum commit ou
push foi executado.

## 1. Diagnóstico (classificação por área)

| Área | Classificação | Evidência |
|---|---|---|
| A. Documentação da Matriz | `REUSE_EXISTING` + `NEEDS_LINK` | Onboarding já grava documentos aprovados em `documentos`; faltava só o vínculo de equivalência — resolvido sem nova tabela, via função computada em tempo de consulta. |
| B. Documentos de Estabelecimento | `REUSE_EXISTING` + `NEEDS_LINK` | `registrar_documento_estabelecimento_upload` e o motor `documento_analises`/`documento_versoes` já existiam (criados para NF); faltava uma RPC de análise com escopo de fundo próprio para o contexto de estabelecimento — `analisar_documento_estabelecimento_gestor` (nova, fina, delega no mesmo motor). |
| C. Aprovação de Filial | `NEEDS_GATE` | `decidir_estabelecimento_gestor` confirmado (leitura da migration `20260818200641`) checando apenas Matriz aprovada+ativa — nenhum gate de documento/conta existia. |
| D. UI (Cedente/Gestor) | `NEEDS_UI_REFACTOR` | Ambas as telas eram client-only, carregavam tudo no mount, sem paginação/filtro/busca (confirmado por agente de exploração dedicado). |

`UNRESOLVED = 0` em todas as áreas antes de iniciar a implementação.

## 2. Equivalência documental da Matriz (reuso do onboarding)

Ver detalhe completo em
[`estabelecimentos-reuso-documental.md`](estabelecimentos-reuso-documental.md).
Resumo: mapeamento fixo por `documento_tipos.codigo` → `documentos.tipo`
(enum legado), computado em tempo de consulta dentro de
`listar_requisitos_estabelecimento`, sem duplicar Storage nem criar linha
nova em `documentos_repositorio`. Só a Matriz reusa; a Filial nunca herda.

## 3. Fluxo Matriz / 4. Fluxo Filial / Gestor UI

Documentos de Estabelecimento (Matriz e Filial) reaproveitam integralmente
o motor `documentos_repositorio`/`documento_versoes`/`documento_vinculos`/
`documento_analises` já existente (criado para NF), incluindo
versionamento real (histórico preservado, nunca sobrescrito) e auditoria
append-only. A única peça nova é `analisar_documento_estabelecimento_gestor`
— uma RPC fina que delega no mesmo contrato (`documento_analises`:
`aprovado`/`rejeitado`/`requer_ajuste`, `analisado_por`, `analisado_em`,
`observacoes`) mas adiciona a checagem de acesso multifundo
(`private.gestor_tem_acesso_cedente`) que a RPC genérica de NF
(`analisar_documento_versao`) não tinha, e evita os efeitos colaterais
específicos de NF/entrega dessa RPC. Detalhe completo em
[`estabelecimentos-workflow-documental.json`](estabelecimentos-workflow-documental.json).

A tela do Gestor (`EstabelecimentosGestor.tsx`) ganhou, por estabelecimento
expandido: decisão (Aprovar/Rejeitar/Suspender/Reativar), conta bancária
somente-leitura, checklist com ações de análise (Aprovar/Pedir
ajuste/Reprovar) por documento e "Ver documento" (URL assinada,
funciona tanto para upload próprio quanto para reuso do onboarding). O
toggle Ativo/Inativo → Desativar/Reativar de requisitos, entregue em ticket
anterior, foi preservado.

## 5. Gate de aprovação de Filial

`decidir_estabelecimento_gestor`, ao aprovar uma **Filial**, agora exige em
ordem: Cedente ativo → Matriz aprovada+ativa → todos os requisitos
ativos+obrigatórios com status `aprovado` (considerando reuso da Matriz,
que não se aplica à Filial) → conta bancária principal ativa. Cada falha
levanta uma exceção com código estável antes de `:` —
`CEDENTE_INATIVO`, `MATRIZ_NAO_APROVADA`, `DOCUMENTOS_OBRIGATORIOS_PENDENTES`,
`CONTA_BANCARIA_PENDENTE` — parseável pela UI sem regex fragil. O gate
**não** foi estendido à aprovação da Matriz: o onboarding já aprova a
Matriz antes do checklist cadastral ser configurado pelo Gestor (fluxo
validado em tickets anteriores desta sessão), e estender o gate ali
quebraria esse fluxo sem necessidade — a especificação do ticket também
enquadra o gate como "Aprovação de Filial".

Validado ao vivo (`e2e.mjs`): aprovação bloqueada com
`DOCUMENTOS_OBRIGATORIOS_PENDENTES`, depois com `CONTA_BANCARIA_PENDENTE`
isoladamente, e só então aprovada com sucesso após satisfazer ambos.

## 6. Pendência documental pós-aprovação

Quando o Gestor configura um novo requisito obrigatório/ativo num
estabelecimento já `aprovado` e esse requisito não está satisfeito,
`configurar_requisito_estabelecimento_gestor` retorna
`pendencia_pos_aprovacao: true` (calculado dentro da mesma
`listar_requisitos_estabelecimento`, sem tabela nova). O estabelecimento
**permanece aprovado** — nenhum `UPDATE` em `cedente_estabelecimentos`
acontece nesse caminho, e `estabelecimento_pode_originar` continua
retornando `true` (só depende de `status='aprovado'`, que não mudou).

A camada TypeScript (`configurarRequisitoEstabelecimento`, em
`src/lib/actions/estabelecimento.ts`) detecta esse retorno e chama
`notificarCedente` — o mesmo motor de notificação já usado por
`analisarDocumento` em `src/lib/actions/gestor.ts` — com o tipo
`estabelecimento_pendencia_pos_aprovacao`. A pendência aparece como badge
"Pendência pós-aprovação" tanto na listagem paginada quanto no checklist
expandido. Nenhum SLA/prazo foi inventado (fora do escopo pedido).

## 7 / 8 / 9. UI escalável (Cedente e Gestor) + performance

Ver [`estabelecimentos-ui-escalavel.json`](estabelecimentos-ui-escalavel.json)
para o detalhamento completo. Resumo:

- Uma única RPC (`listar_estabelecimentos_pagina`) serve as duas telas,
  agregando e paginando no banco (busca, tipo, status, pendência
  documental, page/pageSize 10/20/40) — nenhuma delas carrega a lista
  inteira no primeiro render.
- Detalhe (checklist + conta) é buscado sob demanda só ao expandir uma
  linha, com memoização por id (não rebusca se já tem os dados).
- `/cedente/estabelecimentos` foi convertido de Client Component
  fetch-on-mount para Server Component + `searchParams`, seguindo
  literalmente o padrão já usado em `/gestor/cedentes` — nenhum
  componente de listagem/paginação paralelo foi criado.
- Teste de escala com 55 Filiais sintéticas + 1 Matriz (56 estabelecimentos
  no mesmo Cedente): 10/10 checks PASS, resposta em ~294ms, plano de
  execução confirmado como uma única consulta agregada (não 56 scans).

## 10. Segurança

- Toda RPC nova/alterada checa explicitamente
  `private.usuario_tem_acesso_cedente` (Cedente dono) ou
  `private.gestor_tem_acesso_cedente` (Gestor com vínculo de fundo ativo) —
  nunca apenas `role = 'gestor'`.
- Achado de diagnóstico: a RLS multifundo do subsistema
  `documentos_repositorio`/`documento_versoes`/`documento_vinculos`/
  `documento_analises` (migration `20260817171441_p2_6_6...`) já cobre
  estabelecimento corretamente por acidente de design — a função
  `private.gestor_tem_acesso_contexto_documental` tem um branch de
  fallback "sem contexto de NF → cai para `cedente_fundos`" que se aplica
  automaticamente a vínculos de estabelecimento (que não têm
  `nota_fiscal_id`/`operacao_id`/etc.). Nenhuma mudança de RLS foi
  necessária nessas 4 tabelas.
- `analisar_documento_estabelecimento_gestor` foi criada como função nova
  (em vez de reaproveitar `analisar_documento_versao` diretamente)
  justamente porque essa RPC de NF só checa `role = 'gestor'` sem escopo de
  fundo — reaproveitá-la exporia documentos de estabelecimento de Cedentes
  de outros fundos a qualquer Gestor. Esse gap pré-existente na RPC de NF
  **não foi corrigido** (fora do escopo deste ticket, risco de regressão
  em fluxo de NF não solicitado) — ver seção de riscos.
- Validado ao vivo (`e2e.mjs`, 23 checks): cross-fundo (Gestor de outro
  fundo = DENY em checklist, análise e decisão), cross-cedente, Super Admin
  puro sem acesso implícito, anon = DENY (`permission denied`), e trilha de
  auditoria (`logs_auditoria`) para toda mutação.

## 11 / 12. Testes e E2E

- `src/lib/documentos/evolucao-estabelecimentos-architecture.test.ts` (22
  testes novos): reuso documental, workflow, gate, pendência pós-aprovação,
  UI/paginação/N+1, segurança.
- `scripts/homologacao/evolucao-estabelecimentos/e2e.mjs` (23 checks): cenário
  completo — Matriz com reuso automático de 1 tipo e pendência de outro,
  Filial cadastrada, gate bloqueando por documento e depois por conta,
  documento reprovado → reenviado → aprovado (nova versão, histórico
  preservado), aprovação da Filial, pendência pós-aprovação sem downgrade,
  e a matriz de segurança completa. Transação revertida ao final — nenhum
  dado ficou em homologação.
- `scripts/homologacao/evolucao-estabelecimentos/perf-50-filiais.mjs` (10
  checks): escala com 56 estabelecimentos, ver seção 9.
- Cenário de 15+ Filiais para validar busca/filtro/paginação na UI real
  (passo final do roteiro de 17 passos do ticket) foi coberto pelo teste de
  escala com 55 Filiais no nível de RPC/banco (mesmo código que a UI chama)
  — não foi executado via browser automatizado; ver riscos.

## 13. Regressões

- `scripts/homologacao/multi-cnpj/e2e.mjs` (regressão pré-existente, 18
  checks): **quebrou** na primeira execução porque o novo gate
  corretamente passou a exigir conta bancária antes de aprovar a Filial, e
  o retorno de `configurar_requisito_estabelecimento_gestor` mudou de
  `ROWTYPE` para `jsonb` (necessário para carregar
  `pendencia_pos_aprovacao`). Corrigido reordenando o script (conta antes
  da aprovação) e ajustando o acesso ao novo formato de retorno. Reexecutado
  com sucesso — 18/18 PASS.
- `scripts/homologacao/p0-checklist-documental-estabelecimentos/verify.mjs`
  (regressão pré-existente, 13 checks): mesma causa (retorno `jsonb`).
  Corrigido (`requisito.ativo` → `requisito.requisito.ativo`, etc.).
  Reexecutado com sucesso — 13/13 PASS, `production_touched: false`.
- Busca confirmou que nenhum outro script de homologação chama as RPCs
  alteradas (`configurar_requisito_estabelecimento_gestor`,
  `decidir_estabelecimento_gestor`, `listar_requisitos_estabelecimento`).
- Onboarding do Cedente, análise documental do Gestor (documentos legados),
  MFA, APTO/40%, revisão manual, TOCTOU/stale review, Data API/cross-fund e
  RLX Golden não têm nenhuma dependência de código nas RPCs/tabelas
  alteradas por este ticket (confirmado por busca em todo o código-fonte e
  scripts) — não foram re-executados individualmente por não haver
  superfície de risco identificável, mas nenhuma dessas áreas foi tocada.

## 14. Quality gates

Todos executados após a implementação completa (backend + UI):

- `npx tsc --noEmit`: sem erros.
- `npx vitest run`: 157 arquivos / 1116 testes passando, 1 skip (pré-existente), 3 testes skip (pré-existentes). **Nenhum teste removido** — 2 testes pré-existentes que asseravam o markup antigo das telas foram atualizados para o novo markup (mesma garantia funcional: `type="submit"` explícito nos botões dentro de `<form>`, e exibição de obrigatório/opcional + ativo/inativo + desativar/reativar), não deletados.
- `npm run lint`: 0 erros (6 warnings pré-existentes, não relacionados a este ticket).
- `git diff --check`: sem marcadores de conflito; apenas avisos benignos de CRLF (ambiente Windows, já documentado em tickets anteriores desta sessão).
- `npx next build --webpack`: build de produção concluído com sucesso; `/cedente/estabelecimentos` corretamente dinâmico (server-rendered por request, por causa de `searchParams`).
- `npm audit --omit=dev`: 0 vulnerabilidades.
- Varredura manual de segredos nos arquivos novos/alterados: nenhum encontrado.

## Migrations e RPCs (resumo)

- `20260819170000_evolucao_estabelecimentos_reuso_documental.sql`:
  `listar_requisitos_estabelecimento` (nova), `analisar_documento_estabelecimento_gestor`
  (nova), `configurar_requisito_estabelecimento_gestor` (recriada, retorno
  mudou de ROWTYPE para jsonb), `decidir_estabelecimento_gestor` (recriada,
  gate adicionado para Filial).
- `20260819180000_evolucao_estabelecimentos_listagem_paginada.sql`:
  `listar_estabelecimentos_pagina` (nova).
- Ambas aplicadas em homologação via
  `scripts/homologacao/evolucao-estabelecimentos/apply-migration.mjs`
  (mesmo padrão de todos os tickets anteriores desta sessão).

## Riscos e itens fora de escopo

1. **Gap pré-existente em `analisar_documento_versao` (RPC de NF)**: não
   checa fundo, só `role='gestor'`. Não corrigido aqui por ser uma RPC
   compartilhada por um fluxo de NF fora do escopo deste ticket, e uma
   correção ali exigiria retestar regressões de NF não listadas nesta
   entrega. Recomenda-se um ticket dedicado.
2. **E2E do passo 17 do roteiro** (15+ Filiais, busca/filtro/paginação) foi
   validado no nível de RPC/banco (mesma função que a UI chama), não via
   browser automatizado — não há harness de teste E2E de browser no
   projeto hoje.
3. **`pendencia_pos_aprovacao` é puramente derivada** (não armazenada): se
   o volume de estabelecimentos por Cedente crescer muito além do testado
   (56), o custo da agregação em `listar_estabelecimentos_pagina` deve ser
   monitorado, embora o `EXPLAIN` em homologação não tenha mostrado sinal
   de degradação incomum.

## Deliverables

- [`estabelecimentos-reuso-documental.md`](estabelecimentos-reuso-documental.md)
- [`estabelecimentos-workflow-documental.json`](estabelecimentos-workflow-documental.json)
- [`estabelecimentos-ui-escalavel.json`](estabelecimentos-ui-escalavel.json)
- Este relatório.
