# P0 — Aprovação bloqueada por AVALIACAO_RISCO_INDISPONIVEL

## Resultado

`P0_APROVACAO_OPERACAO_RISCO = PARCIAL` — ver seção "Status final".
**Atualização (ticket `P0_Claude_P23_Sem_Movimento_Matching_Vazio`):** o gap
nº 1 dos "Riscos remanescentes" abaixo (P2.3 não reconhecer universo vazio
legítimo) foi diagnosticado e corrigido — ver seção "Atualização — P2.3
aceita universo vazio legítimo" ao final deste documento.
`P0_P23_SEM_MOVIMENTO_MATCHING_VAZIO = PASS`.
**Atualização (ticket `P0_Claude_Bootstrap_Fundo_Virgem_Carteira_QA`):** o
risco remanescente nº 3 abaixo ("nenhum fundo em homologação tem ESTOQUE D-1
publicado") permanece verdadeiro para fundos operacionais, mas agora um
fundo **recém-criado e sem histórico** consegue aprovar sua primeira
operação usando a primeira Carteira oficial pós-aporte como ponto zero —
ver seção "Atualização — BOOTSTRAP fundo virgem + Carteira QA homolog" ao
final. `P0_BOOTSTRAP_FUNDO_VIRGEM = PASS`.
**Atualização (ticket `P0_Claude_Ajuste_Final_Bootstrap_Fundo_Virgem`):**
`financeiro_fundo_virgem` foi corrigido para olhar evidência econômica real
(linha real em estoque/aquisição/liquidação, ou operação com cessão
efetivada) em vez de mera existência de base publicada — o fundo real RLX
FLUOROCHEMICAL, que só tinha uma declaração de sem-movimento e nenhuma
operação incorporada, estava sendo classificado como não-virgem
indevidamente; agora é corretamente virgem. Saída de bootstrap (após
operação incorporada) testada ao vivo, sem reentrada. Ver seção
"Atualização — ajuste final do BOOTSTRAP (evidência econômica real)" ao
final. `P0_BOOTSTRAP_FUNDO_VIRGEM = PASS` (definitivo).

- Ambiente: homologação Supabase `fhgkmggthxikfpogrvaa`. Produção
  (`wwsndnuvnjuabpbjwlck`) não foi tocada.
- Branch: `homolog`. **Nenhum commit ou push foi executado.**
- Operação real diagnosticada: `d6afe2f3-dd0a-447a-b393-83f155c3f76b`.

## Diagnóstico (ao vivo, antes de qualquer alteração de código)

Consulta direta a `risco_execucoes`/`risco_motivos` para a operação real
mostrou, sem ambiguidade, o erro técnico exato:

```
detalhes.technical_error = "Nenhuma base financeira publicada foi
encontrada para a data informada."
```

Esse texto é lançado por `executarMatchingFinanceiro`
(`src/lib/financeiro/conciliacao/processor.server.ts:183`), estágio P2.3
do pipeline, quando nenhum `importacoes_financeiras` (ESTOQUE/AQUISIÇÕES/
LIQUIDAÇÕES) com `status='PUBLICADA'` existe para o fundo na data de
referência esperada. Confirmado por query direta: **este fundo (RLX
FLUOROCHEMICAL) nunca teve nenhuma base financeira publicada, para
nenhuma data — e nenhum fundo em todo o ambiente de homologação tem
qualquer importação `PUBLICADA`.**

Esse erro, como qualquer exceção lançada dentro do bloco
`try { await withRiskGateTimeout(...) } catch (error) { technicalError = ... }`
em `executarGateRisco` (`src/lib/financeiro/risco/processor.server.ts:226-253`),
é convertido indiscriminadamente em `exposureStatus:
'AVALIACAO_RISCO_INDISPONIVEL'` (`processor.server.ts:260`) e
`decisao: 'BLOQUEADO'` — o mesmo catch-all cobre P2.3 matching, P2.3
conciliação, P2.4 logística, P2.5 exposição **e** a simulação do
candidato de risco, sem distinguir qual estágio falhou nem se a causa é
uma condição de negócio já modelada (como `PL_D2_INDISPONIVEL`) ou uma
falha técnica genuína. Essa característica arquitetural em si não foi
alterada (ver seção "Riscos remanescentes").

Classificação: **`P23_MATCHING_ERROR`**, causa raiz **ausência de dado
de precondição** (não um bug de lógica no matching em si) — o gate está
corretamente fail-closed diante de zero base financeira para avaliar.
`UNRESOLVED = 0`: a causa técnica real foi confirmada, não presumida.

## Auditoria obrigatória da regressão causada por parcelas (Parte 2 do ticket)

Confirmadas **duas incompatibilidades reais**, incluídas no escopo mesmo
não sendo a causa do bloqueio desta operação específica (mandato
explícito do ticket, "auditar explicitamente qualquer suposição 1 NF = 1
item"):

1. **`public.simular_memoria_financeira_operacao`** (única definição em
   `20260814230000_p2_6_gate_risco_decisao_operacional.sql`, anterior às
   migrations de parcelas — Fase 1/2, `20260819210000`..`20260820120000`
   — e nunca revisitada). Usada por `candidateProjection`
   (`processor.server.ts:152-156`), a simulação do candidato ANTES da
   aprovação. Iterava só `operacoes_nfs` (1 linha por NF) e chamava
   `calcular_memoria_financeira_nf` com o `valor_bruto`/`data_vencimento`
   **agregado da NF inteira**, ignorando `operacoes_nf_parcelas`/
   `nota_fiscal_parcelas`. Efeito: para uma NF com parcelas, podia
   sobrestimar o valor de aquisição do candidato (usando o valor
   integral quando só parte das parcelas foi cedida) ou lançar "NF
   vencida" indevidamente quando o vencimento agregado já passou mas a
   parcela cedida não.
   **Corrigido**: `supabase/migrations/20260820170000_simular_memoria_
   financeira_operacao_parcelas.sql` — corpo reproduzido integralmente
   da versão vigente; NF com parcelas cedidas a esta operação agora gera
   1 item **por parcela** (valor_nominal/data_vencimento próprios); NF
   sem parcelas mantém o comportamento legado byte a byte. Mesmo padrão
   já validado em `aprovar_operacao_atomica_financeiro_v1` (Fase 2).
2. **Map colapsando parcelas na exposição (P2.5)** —
   `resolveOverlay`/`simularExposicaoOperacao`
   (`src/lib/financeiro/exposicao/processor.server.ts`) agregavam
   `operacao_calculo_nfs.valor_presente` num `Map` chaveado só por
   `nota_fiscal_id` (ou `operacao_id:nota_fiscal_id`). Desde a Fase 2,
   essa tabela pode ter **múltiplas linhas por NF** (uma por
   `parcela_id`) — um `Map` sem soma mantém só a última, descartando
   silenciosamente o valor das demais parcelas e **subestimando a
   exposição real** de operações com parcelas já em andamento. Mesmo
   padrão de bug já visto e corrigido nesta sessão em outro contexto
   (colapso de `Map` por chave não-única).
   **Corrigido**: as duas funções agora somam `valor_presente` por
   chave em vez de sobrescrever.

Nenhuma das duas foi a causa do bloqueio da operação `d6afe2f3-...`
(o candidato nem chegou a rodar por completo antes de P2.3 matching
falhar — a simulação corrigida foi confirmada rodando com sucesso, 873ms,
numa execução isolada ao vivo, ver seção de testes), mas ambas são
incompatibilidades reais e confirmadas, corrigidas por serem exigidas
explicitamente pelo escopo do ticket.

## O que falta para desbloquear esta operação especificamente

O esquema já modela exatamente "fundo sem nenhum movimento de
aquisição/liquidação no dia" via `declaracao_sem_movimento`
(`importacoes_financeiras`, migration `20260813193629`, restrito a
`tipo_base IN ('AQUISICOES','LIQUIDACOES')`). Testei ao vivo (com
autorização explícita do usuário) publicar uma declaração vazia e
legítima para este fundo na data D-1 esperada pelo pipeline
(`2026-08-19` — `resolverExpectativasCicloFinanceiro`, não a data
operacional em si) — isso **de fato resolve o "Nenhuma base financeira
publicada"** (confirmado isolando `executarMatchingFinanceiro`, que
passou dessa checagem).

Porém isso revelou um **segundo problema real, não corrigido aqui**: com
zero posições externas (nenhuma linha em `aquisicao_movimentos` para o
fundo), `executarMatchingFinanceiro` produz `resultados: []`, e a RPC
`persistir_matching_execucao` **rejeita explicitamente** payloads com
`resultados` vazio (`RAISE EXCEPTION ... 'Payload de matching invalido'`,
`20260814141629_p2_3_matching_conciliacao_rlx.sql:385-386`). Ou seja:
`executarMatchingFinanceiro` não tem nenhuma lógica que reconheça
`declaracao_sem_movimento` e trate "zero posições porque o fundo genuinamente
não teve movimento" como um resultado válido (zero matches, sucesso) —
ele sempre espera que o matching produza pelo menos um resultado,
mesmo quando a única base publicada é uma declaração de zero movimento.
Essa é uma lacuna real no P2.3 (a flag existe no esquema desde
`20260813193629`, mas o processador nunca foi atualizado para
reconhecê-la), **fora do escopo de parcelas** e da causa original
apontada pelo ticket — corrigi-la exigiria alterar a semântica do
matching para tratar "sem movimento" como um caso terminal válido, o
que não fiz sem alinhamento explícito, por ser uma mudança de escopo
maior do que "a menor correção possível".

A declaração de sem-movimento publicada (`importacoes_financeiras.id =
06478bbd-1e0c-44d8-8fee-8c6b2083f910`, `AQUISICOES`, `2026-08-19`,
`COMPLETO_VAZIO`) permanece em homologação — é uma afirmação verdadeira
(este fundo de teste realmente não teve nenhuma aquisição nesse dia) e
inofensiva, mas **não é suficiente, isoladamente, para desbloquear a
operação real** até que o gap acima seja corrigido.

## Testes / evidência ao vivo

- **Query direta em homolog**: `risco_execucoes`/`risco_motivos` da
  operação real confirmaram o `technical_error` exato antes de qualquer
  alteração.
- **Execução isolada, ao vivo, estágio por estágio**
  (`executarMatchingFinanceiro` → `executarConciliacaoFinanceira` →
  `executarPosicaoLogisticaFinanceira` → `executarExposicaoFinanceira`,
  chamados diretamente via `tsx`, mesmo padrão de
  `scripts/homologacao/financeiro/risco/run-worker.ts`): confirmou que,
  após publicar a declaração de sem movimento, `executarMatchingFinanceiro`
  passa da checagem "nenhuma base" e falha em seguida com "Payload de
  matching invalido" — a causa raiz exata do próximo bloqueio, não uma
  suposição.
- **Execução real do gate completo** (`executarGateRisco`, mesmo
  `origem: 'APROVACAO_OPERACAO'` que a aprovação real usa) para a
  operação `d6afe2f3-...`: `candidateSimulationMs: 873` (a simulação do
  candidato — já corrigida — completou com sucesso, sem lançar erro),
  confirmando que o fix de `simular_memoria_financeira_operacao` não
  introduziu regressão nem depende do gap de matching para funcionar.
- `npx tsc --noEmit`: limpo. `npm test -- --run`: **163 arquivos / 1260
  testes, 0 falhas** (12 testes novos de arquitetura em
  `src/lib/financeiro/risco/arquitetura.test.ts`, cobrindo os dois fixes
  de parcela). `npm run lint`: mesmos 6 warnings pré-existentes e não
  relacionados. `npx next build --webpack`: sucesso. `npm audit
  --omit=dev`: 0 vulnerabilidades. `git diff --check`: limpo. Varredura
  de segredos nos arquivos alterados: nenhum encontrado.
- **Regressões do P2.6** (APTO/NO_LIMITE/REVISAO_MANUAL/BLOQUEADO/
  TIMEOUT_FAIL_CLOSED/DOUBLE_OPERATION_APPROVAL/cross-fund/bypass) **não
  foram reexecutadas** — a suíte de regressão dedicada
  (`scripts/homologacao/financeiro/risco/`) roda contra o dataset golden
  RLX_GOLDEN_V2 isolado, que já publica suas próprias bases financeiras
  sintéticas e não é afetado pelos dois fixes de parcela (que só mudam
  comportamento quando `operacoes_nf_parcelas` tem linhas para a
  operação — o dataset golden usa NFs legado sem parcelas). Não executei
  essa suíte nesta rodada por não ter certeza se ela está no estado
  esperado para reexecução sem mutar dados do dataset golden sem
  confirmação prévia; recomendo rodá-la (`npm run homolog:rlx:golden:v2:*`
  em modo dry-run primeiro) antes de considerar este ticket
  definitivamente fechado.

## Status final

`P0_APROVACAO_OPERACAO_RISCO = PARCIAL`:

- **Causa raiz da operação real identificada com certeza** (não
  presumida): `P23_MATCHING_ERROR` por ausência de base financeira
  publicada — dado de precondição ausente, não bug de código no
  matching em si.
- **Duas incompatibilidades reais de parcelas confirmadas e corrigidas**
  (auditoria obrigatória da Parte 2 do ticket), com testes de
  arquitetura novos.
- **A operação real ainda está bloqueada**: seguir a cadeia até o fim
  revelou um SEGUNDO gap real e não corrigido (`executarMatchingFinanceiro`
  não reconhece `declaracao_sem_movimento` como um resultado válido),
  que está fora do escopo de "menor correção possível" sem alinhamento
  explícito — não é causado por parcelas nem é a suposição original do
  ticket, é um gap arquitetural pré-existente no P2.3 revelado só ao
  tentar restabelecer a precondição de dado.
- Fail-closed **não foi enfraquecido** em nenhum momento: nenhum bypass,
  nenhum aumento de timeout, nenhuma alteração no comportamento de
  bloqueio para erro técnico genuíno.

## Riscos remanescentes

1. **Gap do P2.3 com `declaracao_sem_movimento`** (descrito acima) —
   precisa de decisão explícita sobre como tratar "zero posições
   externas porque o fundo realmente não teve movimento" no matching:
   tratar como sucesso trivial (zero matches) em vez de erro de payload,
   ou definir que `declaracao_sem_movimento` nunca deveria ter sido
   suficiente por si só (precisaria sempre de ESTOQUE real, mesmo vazio
   seria inválido) — decisão de produto/arquitetura, não só de código.
2. **Catch-all indiferenciado em `executarGateRisco`**
   (`processor.server.ts:226-253`) continua tratando QUALQUER exceção de
   qualquer um dos 5 estágios (P2.3 matching, P2.3 conciliação, P2.4
   logística, P2.5 exposição, candidato) como o mesmo
   `AVALIACAO_RISCO_INDISPONIVEL` genérico — não alterado aqui, por ser
   uma mudança de escopo maior (diferenciar por estágio/tipo de erro)
   não pedida explicitamente para implementação neste ticket, mas seguirá
   mascarando a causa raiz real de qualquer falha futura em qualquer um
   desses estágios, exatamente como mascarou o gap de matching até esta
   investigação ao vivo.
3. **Nenhum fundo em homologação tem base financeira publicada** — isso
   pode afetar qualquer outra operação/fundo de teste que dependa do gate
   de risco, não só a operação `d6afe2f3-...`.
4. Regressões dedicadas do P2.6 (golden dataset) não foram reexecutadas
   nesta rodada — ver seção de testes.
5. `docs/financeiro/relatorio-p2-6-gate-risco.md`/`production-readiness`
   não mencionam este gap de `declaracao_sem_movimento` — pode ser um
   indício de que esse caminho nunca foi exercitado nem em teste
   automatizado, reforçando que fundos sem ingestão de custodiante real
   nunca puderam aprovar operações nesse ambiente.

## Atualização — P2.3 aceita universo vazio legítimo

`P0_P23_SEM_MOVIMENTO_MATCHING_VAZIO = PASS`. Escopo: exatamente o gap nº 1
descrito acima. Nenhum commit/push foi executado; produção não foi tocada.

### Diagnóstico (leitura da definição LIVE da função, não só da migration histórica)

Consulta direta a `pg_get_functiondef` em homologação confirmou que o corpo
vigente de `public.persistir_matching_execucao` é idêntico ao texto da
migration `20260814141629_p2_3_matching_conciliacao_rlx.sql` (módulo o
rename de tabelas `rlx_*` → canônico, já documentado nesta sessão) — ou
seja, a guarda abaixo é exatamente a causa do "Payload de matching invalido"
observado na investigação anterior, sem nenhuma reescrita posterior oculta:

```sql
IF v_fundo_id IS NULL OR jsonb_array_length(coalesce(p_payload -> 'resultados', '[]'::jsonb)) = 0 THEN
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payload de matching invalido';
END IF;
```

Comparando com o RPC irmão da mesma migration, `persistir_conciliacao_execucao`
— que já persiste `resultados: []` sem qualquer checagem de tamanho quando
`status='CONCLUIDA'` (usa apenas `FOR v_item IN ... jsonb_array_elements(...)`,
que simplesmente não itera com array vazio) — ficou provado que a rejeição de
`resultados` vazio em `persistir_matching_execucao` é uma **inconsistência
entre RPCs irmãos da mesma migration**, não um invariante de segurança
intencional. A prova de legitimidade de um universo vazio já existe
independentemente: todo `input_import_ids` é obrigado (checagem já existente,
inalterada) a corresponder a uma importação `PUBLICADA` do mesmo fundo — ou
seja, "`resultados=[]` + `input_import_ids` não vazio e 100% publicado" já é
prova suficiente de universo genuinamente vazio, nunca de payload forjado
(o RPC só pode ser chamado por `service_role`, nunca por um agente externo).

**Classificação (taxonomia do ticket): `EMPTY_RESULT_PERSISTENCE_GAP`.**
`UNRESOLVED = 0` — confirmado ao vivo antes de qualquer alteração.

### A / B / C — distinção preservada

- **(A) Base ausente** (nenhuma importação `PUBLICADA` daquele tipo/data) —
  **continua erro fail-closed, inalterado**: `executarMatchingFinanceiro`
  ainda lança `'Nenhuma base financeira publicada...'` se **nenhum** dos
  três tipos (ESTOQUE/AQUISIÇÕES/LIQUIDAÇÕES) foi encontrado; e
  `executarPosicaoLogisticaFinanceira` (P2.4) ainda lança `'Nenhum Estoque
  D-1 publicado...'` se o ESTOQUE especificamente estiver ausente — ESTOQUE
  nunca tem escape de `declaracao_sem_movimento` (constraint do schema,
  migration `20260813193629`, restrito a `AQUISICOES`/`LIQUIDACOES`), então
  sua ausência **nunca** é tratada como "vazio legítimo": permanece bloqueio
  real, não fabricado.
- **(B) Zero movimento real** (base publicada, mas com zero linhas —
  via `declaracao_sem_movimento` ou uma publicação real de zero linhas) —
  **agora é sucesso trivial no matching**: `resultados=[]`,
  `total_registros=0`, `status='CONCLUIDA'`, sem lançar excecão.
- **(C) SEM_MATCH** (posições existem mas nenhuma casa com NF do fundo) —
  **comportamento inalterado**: cada posição gera um resultado
  `NAO_CONCILIADO` normalmente contabilizado; `resultados` nunca fica vazio
  neste caso, então nunca dependeu da guarda alterada.

### Correção (menor mudança possível)

`supabase/migrations/20260820180000_persistir_matching_execucao_universo_vazio.sql`
— `CREATE OR REPLACE FUNCTION`, corpo integralmente reproduzido da versão
vigente; a única linha alterada troca a guarda de payload inválido para
validar `input_import_ids` vazio em vez de `resultados` vazio:

```sql
IF v_fundo_id IS NULL OR jsonb_array_length(coalesce(p_payload -> 'input_import_ids', '[]'::jsonb)) = 0 THEN
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payload de matching invalido';
END IF;
```

Nenhuma outra linha foi tocada. A constraint da tabela
`matching_execucoes_inputs_check CHECK (cardinality(input_import_ids) > 0)`
permanece inalterada e redundante-mas-defensiva com a nova guarda. Nenhum
dado de ESTOQUE ou PL foi fabricado — a correção é estritamente sobre
aceitar um resultado vazio já comprovadamente legítimo pelas checagens
existentes, não sobre relaxar qualquer precondição de dado.

Aditivo, opcional (pedido explícito do ticket se de baixo risco):
`src/lib/financeiro/risco/processor.server.ts` agora rastreia em qual
estágio (`policy|matching|reconciliation|logistics|exposure|
candidateSimulation|classification|persistence`) um erro técnico ocorreu
(`lastStage`/`trackStage`) e persiste isso em
`risco_execucoes.detalhes.technical_error_stage` — só quando
`technical_error` não é nulo; não altera nenhuma decisão, apenas melhora o
diagnóstico de qual dos 5 estágios do catch-all (risco remanescente nº 2,
inalterado) realmente falhou.

### Estado real (ESTOQUE D-1 e PL D-2) — não fabricado

Confirmado ao vivo, sem alteração: para o fundo RLX FLUOROCHEMICAL,
`2026-08-19` (D-1 esperado pelo ciclo financeiro):

- **PL D-2** (`2026-08-18`): presente — `carteira_snapshots` com
  `patrimonio_liquido=10000000.0000`, `vigente=true` (seed anterior desta
  sessão, publicado via `publicar_importacao_financeira` real).
- **ESTOQUE D-1** (`2026-08-19`): **ausente** — nenhuma
  `importacoes_financeiras` `tipo_base='ESTOQUE'` `PUBLICADA` para esta data
  existe. Não fabricado, conforme mandato explícito do ticket.
- **AQUISIÇÕES D-1**: presente, `declaracao_sem_movimento=true`,
  `COMPLETO_VAZIO` (seed do ticket anterior).
- **LIQUIDAÇÕES D-1**: ausente (nunca publicada).

### Resultado ao vivo para a operação real (`d6afe2f3-dd0a-447a-b393-83f155c3f76b`)

Reexecução fresca, isolada, estágio por estágio (mesmo padrão
`tsx`-worker já usado nesta sessão), **depois** da correção:

```json
{
  "matching_fresh": { "execucaoId": "f7f7ed68-344f-4b74-9404-a22955500cc7", "total": 0 },
  "gate": {
    "technicalStatus": "AVALIACAO_RISCO_INDISPONIVEL",
    "decision": "BLOQUEADO",
    "detalhes": {
      "technical_error": "Nenhum Estoque D-1 publicado foi encontrado para a data informada.",
      "technical_error_stage": "logistics"
    }
  }
}
```

Confirmado por query direta em `matching_execucoes`/`conciliacao_execucoes`:

- `matching_execucoes` (`f7f7ed68-...`): `status='CONCLUIDA'`,
  `total_registros=0`, `input_import_ids=[06478bbd-...]` (a declaração de
  sem-movimento) — **antes da correção isso lançava "Payload de matching
  invalido"; agora persiste com sucesso.**
- `conciliacao_execucoes` (execução seguinte, mesma corrida):
  `status='BASE_INCOMPLETA'`, `detalhes.bases_ausentes_ou_incompletas =
  ["ESTOQUE_D2","ESTOQUE_D1","LIQUIDACOES_D1"]` — tratamento **já
  existente e correto** de `avaliarCompletudeBases`
  (`src/lib/financeiro/conciliacao/reconciliation.ts`), sem lançar exceção.
- O gate avança corretamente até P2.4 (`executarPosicaoLogisticaFinanceira`),
  onde lança o erro real e específico ("Nenhum Estoque D-1 publicado...").
  `technical_error_stage: "logistics"` aponta exatamente para esse estágio.

**Decisão final para esta operação: permanece `BLOQUEADO`** — correto e
esperado. O gap que este ticket cobria (P2.3 rejeitar universo vazio
legítimo) está resolvido; o motivo real e remanescente do bloqueio
(`MISSING_MANDATORY_STOCK`: ESTOQUE D-1 nunca publicado para este fundo)
é uma ausência de dado de precondição genuína, não deve ser fabricada, e
agora é diagnosticada com precisão (`technical_error_stage: "logistics"`)
em vez de morrer de forma indiferenciada em P2.3.

### Regressões P2.6 (reexecutadas nesta rodada, ao vivo, dataset `RLX_GOLDEN_V2`)

Pré-requisito resolvido: `.env.homolog`/`SUPABASE_DB_URL` tinha uma senha
divergente e stale (não coincidia com `SUPABASE_PASSWORD`), bloqueando os
scripts `homolog:*` que dependem de `connectDb`. Corrigida localmente
(arquivo gitignorado, fora do controle de versão, nenhum commit envolvido)
para o valor de `SUPABASE_PASSWORD`, já validado nesta sessão via conexão
direta bem-sucedida.

- `npm run homolog:rlx:golden:v2:e2e -- --execute ...`: **384/384
  verificações, cobertura esperada 100%**; inclui os cenários
  `ADVERSARIAL/AQUISICOES` e `ADVERSARIAL/LIQUIDACOES` com
  `completeness: COMPLETO_VAZIO` — exercitando exatamente o caminho vazio
  corrigido, com matching não-vazio (`total: 24`/`total: 1`) convivendo sem
  regressão. `Security Golden V2 aprovado: 5/5 verificações transacionais.`
- `npm run homolog:financeiro:risco:configure-golden -- --execute ...`:
  aplicado com sucesso.
- `npm run homolog:financeiro:risco:run -- --execute ...`: os dois fundos
  golden concluem com `technicalStatus: CONCLUIDA` (não
  `AVALIACAO_RISCO_INDISPONIVEL`) — fundo principal `BLOQUEADO` por
  `POSICAO_SEM_MATCH`/`EXPOSICAO_INDETERMINADA` (motivos de negócio
  esperados do dataset), fundo adversarial `BLOQUEADO` por
  `PL_D2_INDISPONIVEL` — ambos com `technical_error: null,
  technical_error_stage: null`, confirmando que o novo campo aditivo não
  introduz ruído quando não há erro técnico.
- `npm run homolog:financeiro:risco:verify -- ...`: **8/8 verificações
  read-only aprovadas**, `expected-risk-gate.json` preservado.
- `npm run homolog:financeiro:risco:verify-security -- ...`: **falhou numa
  pré-condição não relacionada a este fix** — o ambiente de homologação
  não tem nenhum `profiles` ativo com `role IN ('consultor','sacado')`
  (gap de dado do ambiente, não introduzido por esta mudança; os checks
  estruturais anteriores — RLS/grants P2.6, SECURITY DEFINER sem `anon`,
  ausência de rotas antigas, TOTP fresco, proibição de Super Admin puro,
  TOCTOU — todos passaram antes desse ponto). Registrado como risco
  remanescente, não bloqueia este ticket (o fix não toca RLS/perfis).

### Testes de arquitetura (novo arquivo)

`src/lib/financeiro/conciliacao/matching-universo-vazio.test.ts` — 10
testes novos cobrindo: guarda antiga removida/nova guarda presente;
prova de legitimidade preservada; corpo da função intacto fora da guarda;
constraint de tabela inalterada; precedente do RPC irmão; restrição de
`declaracao_sem_movimento` a AQUISIÇÕES/LIQUIDAÇÕES; fail-closed intacto em
`executarMatchingFinanceiro` (base totalmente ausente) e em
`executarPosicaoLogisticaFinanceira` (ESTOQUE ausente); catch-all do P2.6
inalterado; novo campo `technical_error_stage`.

### Gates de qualidade

`npx tsc --noEmit`: limpo. `npm test -- --run`: **165 arquivos / 1270
testes** (10 novos), 0 falhas, 3 skips pré-existentes. `npm run lint`:
mesmos 6 warnings pré-existentes, 0 erros. `npx next build --webpack`:
sucesso. `npm audit --omit=dev`: 0 vulnerabilidades. `git diff --check`:
limpo (só aviso benigno de CRLF/LF). Varredura de segredos no diff:
nenhum encontrado.

### Riscos remanescentes (atualizados)

1. ~~Gap do P2.3 com `declaracao_sem_movimento`~~ — **resolvido por este
   ticket.**
2. Catch-all indiferenciado em `executarGateRisco` continua tratando
   qualquer erro dos 5 estágios como `AVALIACAO_RISCO_INDISPONIVEL` — agora
   com `technical_error_stage` para diagnóstico, mas a **decisão**
   continua indiferenciada (sempre `BLOQUEADO`, correto/fail-closed, porém
   sem granularidade de motivo estruturado). Diferenciar por estágio na
   classificação em si continua fora do escopo pedido.
3. **ESTOQUE D-1 nunca publicado para nenhum fundo em homologação**
   (incluindo o RLX FLUOROCHEMICAL) — nenhuma operação real poderá
   avançar além de P2.4 nesse ambiente até que uma massa de ESTOQUE seja
   publicada (real ou de teste, nunca fabricada silenciosamente pelo
   código).
4. Gap de dado do ambiente de segurança (nº "verify-security" acima):
   ausência de perfis `consultor`/`sacado` ativos impede a suíte de
   segurança P2.6 completa de rodar — não é uma regressão de RLS, é
   ausência de fixture; recomendo endereçar separadamente se a suíte de
   segurança precisar rodar de ponta a ponta novamente.
5. `SUPABASE_DB_URL` em `.env.homolog` estava stale/divergente da senha
   real — corrigida localmente nesta sessão (arquivo não versionado); se
   outro ambiente/desenvolvedor tiver o mesmo arquivo desatualizado, os
   scripts `homolog:*` que dependem de `connectDb` falharão do mesmo jeito
   até serem corrigidos manualmente.

## Atualização — BOOTSTRAP fundo virgem + Carteira QA homolog

`P0_BOOTSTRAP_FUNDO_VIRGEM = PASS`. Nenhum commit/push foi executado;
produção não foi tocada; nenhum ESTOQUE/AQUISIÇÕES/LIQUIDAÇÕES/PL foi
fabricado em nenhum ambiente.

### Diagnóstico

Mapeado ao vivo antes de qualquer alteração:

- **Origem de `carteira_snapshots`**: inserida exclusivamente pela RPC
  `publicar_importacao_financeira`, branch `ELSE` (tipo_base=CARTEIRA),
  lendo `importacao_linhas.dados_normalizados->>'patrimonio_liquido'`.
- **Resolução do PL oficial**: `executarExposicaoFinanceira`
  (`src/lib/financeiro/exposicao/processor.server.ts`) sempre buscava
  `importacoes_financeiras` CARTEIRA na data `d2` **temporal** (D-2 relativo
  à `dataOperacional`, via `resolverExpectativasCicloFinanceiro`) — nunca a
  primeira Carteira que o fundo já teve, o que é estruturalmente incompatível
  com um fundo cujo aporte/primeira Carteira não coincide com esse D-2.
- **Identificação de operação incorporada/desembolsada**: já modelada e
  usada por `resolveOverlay` — `operacoes.status IN ('em_andamento',
  'inadimplente') AND cessao_efetivada_em IS NOT NULL` (estendido aqui para
  incluir `'liquidada'`, um estado posterior que herda o mesmo fato). Este é
  um fato histórico irreversível: uma vez verdadeiro, nunca volta a falso —
  garante que não há reentrada em bootstrap.
- **Pontos que exigiam ESTOQUE D-1**: `executarPosicaoLogisticaFinanceira`
  (P2.4, lança erro duro se ausente) e, indiretamente,
  `executarExposicaoFinanceira` (exige P2.4 `CONCLUIDA`).
- **Campo/status reutilizável**: nenhum existia; `declaracao_sem_movimento`
  (ticket anterior) é exclusivo de `AQUISICOES`/`LIQUIDACOES` e não modela
  bootstrap (que também cobre ausência total de ESTOQUE e ausência de
  qualquer Carteira).
- **Distinção fundo virgem vs. operacional com dado faltante**: nenhuma
  existia — `imports.length===0`/ausência de Estoque eram tratados como o
  mesmo erro genérico independentemente do histórico do fundo, exatamente o
  gap que motivou este ticket.

Classificação: `BOOTSTRAP_STATE_MISSING` (nenhum estado derivado existia) +
`PL_RESOLUTION_NOT_BOOTSTRAP_AWARE` (P2.5 só conhecia PL D-2 temporal) +
`MANDATORY_STOCK_NOT_BOOTSTRAP_AWARE` (P2.4 exigia Estoque incondicionalmente).
`UNRESOLVED = 0`.

### Regra de entrada/saída

Estado **inteiramente derivado**, nunca uma flag manual permanente:

- **`fundo_virgem`** (`private.financeiro_fundo_virgem(p_fundo_id)`, SQL) =
  NÃO existe operação do fundo com `status IN ('em_andamento','inadimplente',
  'liquidada') AND cessao_efetivada_em IS NOT NULL` **E** NÃO existe nenhuma
  `importacoes_financeiras` `PUBLICADA` de `tipo_base IN ('ESTOQUE',
  'AQUISICOES','LIQUIDACOES')` para o fundo, em nenhuma data. Usado por
  P2.3 (matching) e P2.4 (posição logística) para decidir se um universo
  totalmente ausente é sucesso trivial (bootstrap) ou erro fail-closed.
- **`carteira_oficial`** (`public.resolver_bootstrap_financeiro(p_fundo_id)`,
  SQL, só chamada por `service_role`) = a **primeira** `importacoes_
  financeiras` CARTEIRA `PUBLICADA`/`COMPLETO_COM_DADOS` com `carteira_
  snapshots.patrimonio_liquido > 0` `vigente=true`, ordenada por
  `data_referencia ASC, publicada_em ASC`. Usado só por P2.5 (exposição).
- **Bootstrap propriamente** (habilitado a calcular exposição) = `fundo_
  virgem AND carteira_oficial IS NOT NULL`. Sem Carteira oficial ainda, o
  fundo é virgem mas P2.3/P2.4 já podem concluir trivialmente; P2.5 bloqueia
  com o motivo canônico dedicado `PL_OFICIAL_INDISPONIVEL` (nunca o genérico
  `AVALIACAO_RISCO_INDISPONIVEL`).
- **Saída, definitiva**: no instante em que qualquer operação do fundo
  alcança `em_andamento`/`inadimplente`/`liquidada` com `cessao_efetivada_em`
  preenchido, `fundo_virgem` passa a `false` para sempre (fato histórico
  irreversível) — não há flag para resetar, logo não há reentrada.

### Tratamento de estoque zero e distinção fundo virgem vs. operacional

- **P2.3 matching** (`executarMatchingFinanceiro`): se nenhuma base
  (ESTOQUE/AQUISIÇÕES/LIQUIDAÇÕES) foi publicada, verifica `fundo_virgem`;
  se sim, persiste `matching_execucoes` `CONCLUIDA`/`bootstrap=true` com
  `input_import_ids=[]`/`resultados=[]`; se não, **continua lançando o
  mesmo erro de sempre** ("Nenhuma base financeira publicada...").
- **P2.3 conciliação** (`executarConciliacaoFinanceira`): só quando as
  4 bases (`ESTOQUE_D2/D1`, `AQUISICOES_D1`, `LIQUIDACOES_D1`) estão
  **todas** ausentes (`missing.length===4`) e `fundo_virgem`, persiste
  `conciliacao_execucoes` `CONCLUIDA`/`bootstrap=true` com `resultados=[]`;
  qualquer ausência parcial (fundo operacional com dado faltante) continua
  `BASE_INCOMPLETA`, comportamento pré-existente e inalterado.
- **P2.4 posição logística** (`executarPosicaoLogisticaFinanceira`): se o
  Estoque D-1 não foi encontrado, verifica `fundo_virgem`; se sim, persiste
  `posicao_logistica_execucoes` `CONCLUIDA`/`bootstrap=true` com zero
  posições e `estoque_importacao_id`/`matching_execucao_id` `NULL`
  (colunas relaxadas para nullable só com `CHECK (bootstrap OR ambas não
  nulas)`); se não, **continua lançando o mesmo erro de sempre** ("Nenhum
  Estoque D-1 publicado...").
- **P2.5 exposição** (`executarExposicaoFinanceira`): se `fundo_virgem` e
  há `carteira_oficial`, usa o `importacao_id`/`snapshot_id`/`data_
  referencia`/`patrimonio_liquido` dessa Carteira **em vez** da busca
  temporal D-2, e segue pelo **mesmo** código de cálculo `CALCULADA`
  (posição em trânsito=0, overlay vazio pois `resolveOverlay` já retorna
  `[]` para um fundo sem operação economicamente viva) — decisão final
  (APTO/REVISAO_MANUAL/BLOQUEADO) sai do **mesmo** `classificarGateRisco`
  inalterado. Se `fundo_virgem` e NÃO há `carteira_oficial`, persiste
  `PL_OFICIAL_INDISPONIVEL`. Se NÃO `fundo_virgem` (fundo operacional,
  mesmo com dado faltante), segue o fluxo temporal D-2 de sempre, sem
  qualquer atalho — nunca assume zero.

### Motivos canônicos

- Sem primeira Carteira/PL oficial → `PL_OFICIAL_INDISPONIVEL` (novo status
  em `exposicao_execucoes`/`ExposureExecutionStatus`, novo motivo em
  `risco_motivos`/`RiskReasonCode`, tratado por `classificarGateRisco` como
  bloqueio distinto — nunca cai no fallback genérico de `PL_D2_INDISPONIVEL`
  porque o `if` dedicado vem antes na cadeia).
- Fundo operacional sem ESTOQUE obrigatório → motivo canônico vigente,
  inalterado (erro "Nenhum Estoque D-1 publicado..." → catch-all →
  `AVALIACAO_RISCO_INDISPONIVEL`, com `technical_error_stage: "logistics"`
  desde o ticket anterior).
- Erro técnico genuíno → `AVALIACAO_RISCO_INDISPONIVEL`, inalterado.

Fail-closed preservado em toda a cadeia: nenhum bypass, nenhuma fabricação
de dado, nenhuma alteração no comportamento de bloqueio para fundo
operacional ou erro técnico genuíno.

### Fixture de homologação — Carteira QA

Nenhum PL artificial foi criado pelo fluxo de produção. Em homologação, a
Carteira QA utiliza PL sintético explicitamente identificado para testes,
publicado pelo pipeline canônico.

`scripts/homologacao/bootstrap-fundo-virgem/`:

- `seed-fixture-fundo.mjs` — cria (idempotente por nome) o fundo QA
  dedicado `QA BOOTSTRAP FUNDO VIRGEM FIDC` + política mínima
  (`gate_risco_ativo`/`controle_exposicao_logistica_ativo`/limite 40%),
  necessária só para exercitar o gate ao vivo; aborta se o fundo não
  nascer virgem.
- `seed-carteira-bootstrap.mjs` (+ `seed-worker.ts`) — publica a primeira
  Carteira oficial usando o **mesmo caminho canônico** de uma Carteira
  real: `ingerirArquivoFinanceiro` (parser + validação P2.2, upload real no
  Storage) seguido de `publicarImportacaoFinanceira` (RPC
  `publicar_importacao_financeira`) — nenhum INSERT manual em
  `importacoes_financeiras`/`importacao_linhas`/`carteira_snapshots`. Uso:
  `node seed-carteira-bootstrap.mjs --fundo=<uuid> --pl=<numero>
  --data-base=<YYYY-MM-DD> --expected-project-ref <ref> [--execute
  --confirm ...]`. Zero posições sempre (é uma Carteira, não uma base de
  posições); origem claramente marcada como QA via `provedor=
  'qa_bootstrap_fundo_virgem'` e `nomeArquivo=QA_BOOTSTRAP_CARTEIRA_
  <data>.csv`; idempotente (mesmo hash de conteúdo → mesma importação).
- `apply-migration.mjs` — aplica as 3 migrations desta entrega
  (idempotente).
- `verify.mjs` — read-only: confirma que o fundo QA continua virgem, que
  matching/P2.4/P2.5 de bootstrap persistiram como esperado, e que o fundo
  real RLX FLUOROCHEMICAL (com histórico) continua corretamente
  **não-virgem**.

**Trava dura de ambiente** (todos os scripts, via `assertHomologEnvironment`):
`NEXT_PUBLIC_APP_ENV=homolog`, `--expected-project-ref` deve bater com a
referência real do projeto (API e DB) E não pode ser a referência de
produção (`wwsndnuvnjuabpbjwlck`, checada explicitamente contra
`.env.producao`) — qualquer divergência aborta antes de qualquer conexão.

### Testes — evidência ao vivo (fundo `beedc30c-682b-4ceb-a8be-05b552120cdc`)

1. **Fundo virgem sem Carteira** → `executarGateRisco` (escopo fundo,
   `origem: CENTRAL_RISCO`) retornou `technicalStatus: CONCLUIDA` (não
   `AVALIACAO_RISCO_INDISPONIVEL`), `decision: BLOQUEADO`, `reasons:
   [{code: 'PL_OFICIAL_INDISPONIVEL', severity: 'BLOQUEIO'}]`,
   `technical_error: null`. Confirmado por query direta:
   `exposicao_execucoes.status='PL_OFICIAL_INDISPONIVEL'`,
   `patrimonio_liquido_d2=null`.
2. **Carteira QA publicada (PL=1.000.000,00) via `seed-carteira-bootstrap.mjs`**
   → reexecução do gate: `technicalStatus: CONCLUIDA`, `decision: APTO`,
   `reasons: []`. Confirmado por query direta: `matching_execucoes`
   (`bootstrap=true`, `total_registros=0`, `input_import_ids=[]`),
   `posicao_logistica_execucoes` (`bootstrap=true`, `total_posicoes=0`,
   `estoque_importacao_id`/`matching_execucao_id` `NULL`),
   `exposicao_execucoes` (`status='CALCULADA'`, `bootstrap=true`,
   `patrimonio_liquido_d2=1000000.0000`, `classificacao_limite=
   'ABAIXO_LIMITE'`, `data_referencia_pl` = a data real da Carteira QA,
   **não** a data D-2 temporal).
3/4/5. **Limites de 40% (PL alto/calibrado/baixo)**: a matemática
   (`calcularExposicao`/`classificarPercentualExposicao`) é código
   pré-existente e inalterado por este ticket — só a *origem* do PL mudou
   (Carteira de bootstrap em vez de D-2 temporal); verificado
   analiticamente (0% de exposição classificado `ABAIXO_LIMITE` no teste
   #2 acima) e coberto pelos testes unitários pré-existentes de
   `calculo.test.ts`, que não foram alterados.
6. **Bootstrap encerra após operação incorporada**: verificado por
   arquitetura/predicado — `financeiro_fundo_virgem` depende de um fato
   histórico irreversível (`cessao_efetivada_em`), não de uma flag; não foi
   exercitado ao vivo com uma operação real incorporada nesta rodada (exigiria
   todo o fluxo de cedente/NF/aprovação/desembolso), registrado como risco
   remanescente nº 1 abaixo.
7. **Fundo operacional com dados faltantes → NÃO assume zero**: confirmado
   ao vivo com o fundo real RLX FLUOROCHEMICAL
   (`c0f501d1-acec-4626-b024-283f03cae392`, que já tem uma publicação
   histórica de `AQUISICOES` sem-movimento do ticket anterior) —
   `resolver_bootstrap_financeiro` retornou `fundo_virgem: false`; o gate
   permanece bloqueado pela ausência real de Estoque D-1, sem qualquer
   atalho de bootstrap.

Regressões reexecutadas ao vivo após as mudanças (mesmos RPCs
`persistir_matching_execucao`/`persistir_conciliacao_execucao`/
`persistir_posicao_logistica_execucao`/`persistir_exposicao_execucao`
tocados): `homolog:financeiro:risco:run`+`verify` (8/8, mesma assinatura
cacheada, sem erro), `homolog:rlx:golden:v2:verify` (384/384),
`homolog:rlx:golden:v2:verify-security` (5/5) — nenhuma regressão.

**Dois bugs reais encontrados e corrigidos só por causa do teste ao vivo**
(nenhum dos dois seria pego por teste de arquitetura/string):

1. `risco_motivos_codigo_check` não aceitava o novo motivo
   `PL_OFICIAL_INDISPONIVEL` — `persistir_risco_execucao` falhava ao tentar
   gravá-lo. Corrigido em `20260821010000_bootstrap_risco_motivos_pl_
   oficial_indisponivel.sql` (alarga a constraint).
2. A consulta de liquidações parciais em `executarExposicaoFinanceira`
   fazia `.eq('matching_execucao_id', String(position.matching_execucao_id))`
   — para uma posição de bootstrap (`matching_execucao_id=NULL`),
   `String(null)` produz a string `"null"`, que o Postgres rejeita como
   UUID inválido antes mesmo de buscar "sem resultado". Corrigido pulando a
   consulta inteiramente quando `matching_execucao_id` é nulo.
   Adicionalmente, a coluna `exposicao_execucoes.bootstrap` existia no
   schema mas nunca era de fato gravada pelo RPC — corrigido em
   `20260821020000_bootstrap_exposicao_flag_persistido.sql`.

### Decisão final da operação real (`d6afe2f3-dd0a-447a-b393-83f155c3f76b`)

Inalterada por este ticket: o fundo RLX FLUOROCHEMICAL **não é virgem**
(tem publicação histórica de `AQUISICOES` sem-movimento), então a lógica de
bootstrap não se aplica a ele — corretamente, por já ter "graduado" para o
fluxo normal do ticket anterior. Ele permanece bloqueado pela ausência real
de Estoque D-1 (`technical_error_stage: "logistics"`), exatamente como
documentado na atualização anterior. Nenhuma Carteira QA foi publicada para
este fundo especificamente (já tinha uma Carteira D-2 real, seedada
anteriormente) — bootstrap não é a ferramenta certa para desbloqueá-lo;
ESTOQUE D-1 real (ou de teste) é o único caminho, e não deve ser fabricado.

### Testes de arquitetura

`src/lib/financeiro/bootstrap/bootstrap-fundo-virgem.test.ts` — 14 testes
novos cobrindo: predicado `financeiro_fundo_virgem` (ambas condições),
`resolver_bootstrap_financeiro` (PL>0, ordenação pela mais antiga,
restrição a `service_role`), re-verificação server-side em todas as 3 RPCs
de persistência (nunca confiam só no flag do chamador), colunas/constraints
`bootstrap` relaxadas corretamente, novo status/motivo `PL_OFICIAL_
INDISPONIVEL` em todas as camadas, fix da coluna `bootstrap` não persistida,
fix do `risco_motivos_codigo_check`, `resolverBootstrapFinanceiro` (TS) como
única fonte de leitura, os 4 branches de bootstrap (matching/conciliação/
P2.4/P2.5) preservando fail-closed para fundo não-virgem, e o fix do bug de
UUID nulo em liquidações parciais.

### Gates de qualidade

`npx tsc --noEmit`: limpo. `npm test -- --run`: **166 arquivos / 1284
testes** (14 novos), 0 falhas, 3 skips pré-existentes. `npm run lint`:
mesmos 6 warnings pré-existentes, 0 erros novos. `npx next build
--webpack`: sucesso. `npm audit --omit=dev`: 0 vulnerabilidades. `git diff
--check`: limpo (só avisos benignos de CRLF/LF). Varredura de segredos no
diff: nenhum encontrado (as duas ocorrências de "SUPABASE_PASSWORD" são
referências ao NOME da variável de ambiente em prosa de uma atualização
anterior, não a um valor).

### Riscos remanescentes

1. **Saída de bootstrap (após operação incorporada) não foi exercitada ao
   vivo** — depende de `cessao_efetivada_em`/status da operação, um fato
   histórico irreversível já usado em produção por `resolveOverlay`; a
   lógica é a mesma, mas o cenário completo (cedente + NF + aprovação +
   desembolso real) não foi montado nesta rodada. Recomendo validar quando
   a primeira operação real de um fundo QA de bootstrap for efetivamente
   desembolsada.
2. O fundo fixture `QA BOOTSTRAP FUNDO VIRGEM FIDC`
   (`beedc30c-682b-4ceb-a8be-05b552120cdc`) e sua Carteira QA permanecem em
   homologação para uso contínuo de QA — inofensivos e claramente
   identificados (nome do fundo, `provedor`/`nomeArquivo` da importação).
3. Catch-all indiferenciado em `executarGateRisco` (risco remanescente nº 2
   da atualização anterior) continua sem diferenciação de decisão por
   estágio — inalterado por este ticket.
4. `ESTOQUE D-1` continua nunca publicado para nenhum fundo **operacional**
   em homologação — bootstrap não resolve isso para fundos que já têm
   histórico (nem deveria); permanece um risco à parte.

## Atualização — ajuste final do BOOTSTRAP (evidência econômica real)

`P0_BOOTSTRAP_FUNDO_VIRGEM = PASS` (definitivo). Nenhum commit/push
executado; produção não tocada; nenhum ESTOQUE/AQUISIÇÕES/LIQUIDAÇÕES/PL
fabricado.

### Diagnóstico

`private.financeiro_fundo_virgem` (entrega anterior) checava a **existência**
de qualquer `importacoes_financeiras` `PUBLICADA` de `tipo_base IN
('ESTOQUE','AQUISICOES','LIQUIDACOES')` — mas essa existência não implica
movimento real: uma `declaracao_sem_movimento=true` ou um ESTOQUE publicado
com zero posições são, por definição, a **ausência** de posição/movimento,
não a presença. Confirmado ao vivo antes de alterar: o fundo real RLX
FLUOROCHEMICAL (`c0f501d1-acec-4626-b024-283f03cae392`), que só tem uma
`declaracao_sem_movimento` em AQUISIÇÕES e **nunca** teve nenhuma operação
incorporada, estava classificado como `fundo_virgem=false` só por essa
declaração vazia existir — exatamente a distorção que este ticket pede
para corrigir.

### Predicado final

`private.financeiro_fundo_virgem(p_fundo_id)` (migration
`20260821030000_bootstrap_fundo_virgem_evidencia_economica.sql`, `CREATE OR
REPLACE`, mesma assinatura):

```sql
SELECT NOT (
  EXISTS (
    SELECT 1 FROM operacoes o JOIN cedente_fundos cf ON cf.id = o.cedente_fundo_id
    WHERE cf.fundo_id = p_fundo_id
      AND o.status IN ('em_andamento', 'inadimplente', 'liquidada')
      AND o.cessao_efetivada_em IS NOT NULL
  )
  OR EXISTS (SELECT 1 FROM estoque_posicoes p WHERE p.fundo_id = p_fundo_id)
  OR EXISTS (SELECT 1 FROM aquisicao_movimentos m WHERE m.fundo_id = p_fundo_id)
  OR EXISTS (SELECT 1 FROM liquidacao_movimentos m WHERE m.fundo_id = p_fundo_id)
)
```

**NÃO encerram bootstrap** (nenhuma linha real inserida por construção de
`publicar_importacao_financeira` quando `linhas_total=0`): primeira
Carteira oficial pós-aporte; AQUISIÇÕES/LIQUIDAÇÕES com
`declaracao_sem_movimento=true`; ESTOQUE publicado com zero posições.
**ENCERRAM bootstrap** (fato econômico real, irreversível, sem
reentrada): primeira operação com `cessao_efetivada_em` válida; primeira
linha real em `estoque_posicoes`; primeira linha real em
`aquisicao_movimentos`; primeira linha real em `liquidacao_movimentos`
(mesmo fato de `resolveOverlay`, estendido de `em_andamento`/`inadimplente`
para incluir `liquidada`).

### E2E de saída do bootstrap (ao vivo, fundo `beedc30c-682b-4ceb-a8be-05b552120cdc`)

1. Fundo QA virgem (entrega anterior) → 2. Carteira QA publicada pelo fluxo
   canônico (entrega anterior) → 3. gate → `CALCULADA`/`APTO` (entrega
   anterior, reconfirmado inalterado pelo novo predicado).
4. Criada operação sintética já incorporada (`status='em_andamento'`,
   `cessao_efetivada_em` preenchido) via
   `seed-fixture-operacao-incorporada.mjs` — insere diretamente o mesmo
   fato histórico que `desembolsar_operacao_com_logistica` (fluxo real de
   usuário) produziria; o fluxo de UI/termo assinado/comprovante/desembolso
   em si é código pré-existente e inalterado, fora do escopo deste ticket
   focado no predicado.
5. `resolver_bootstrap_financeiro` confirmado ao vivo: `fundo_virgem=false`.
6/7/8. Chamada direta e isolada de `executarMatchingFinanceiro` (mesmo
   `dataReferencia` já cacheado por uma execução de bootstrap anterior,
   para provar que **não há bootstrap silencioso via cache**) — resultado
   ao vivo: `ERRO (esperado): Nenhuma base financeira publicada foi
   encontrada para a data informada.` — a mesma mensagem fail-closed de
   sempre, confirmando que bootstrap não é mais usado e que o bloqueio
   segue o fluxo normal/precondição real.
9. Sem reentrada: `fundo_virgem` permanece `false` (fato histórico
   irreversível — não há flag para resetar).

**Nota sobre o teste ao nível do gate completo**: a mesma chamada via
`executarGateRisco` (em vez de `executarMatchingFinanceiro` isolado) devolveu
um `technical_error` **desatualizado** (da execução de exposição antes do fix
de `matching_execucao_id` nulo, ver entrega anterior) porque
`persistir_risco_execucao` tem idempotência por `assinatura_inputs`, e essa
assinatura colidiu com uma execução anterior — **risco arquitetural
pré-existente já documentado** ("risco remanescente nº 2", catch-all
indiferenciado; a assinatura não inclui a mensagem de erro técnico em si).
Não é uma regressão deste ticket. A chamada direta e isolada de
`executarMatchingFinanceiro` (acima) confirma o comportamento real e fresco,
sem esse ruído de cache.

Também confirmado ao vivo, via transação `BEGIN`/`ROLLBACK` sem resíduo
(prova sem efeito permanente): inserir uma linha real em
`estoque_posicoes` para o fundo RLX FLUOROCHEMICAL (que hoje é virgem)
produz `fundo_virgem=false` imediatamente; após o `ROLLBACK`, volta a
`fundo_virgem=true` — confirma "ESTOQUE com posição real → deixa de ser
virgem" simetricamente ao caso de operação incorporada.

Os casos "AQUISIÇÕES sem movimento antes da primeira cessão" e "LIQUIDAÇÕES
sem movimento antes da primeira cessão → continua virgem" são garantidos
pela mesma simetria estrutural: `publicar_importacao_financeira` nunca
insere linha em `aquisicao_movimentos`/`liquidacao_movimentos` quando
`linhas_total=0` (branch `COMPLETO_COM_DADOS` só roda com linhas reais);
o caso AQUISIÇÕES já está confirmado ao vivo pela reclassificação do RLX
FLUOROCHEMICAL acima.

### Documentação

Frase solicitada incluída na seção "Fixture de homologação — Carteira QA".

### Testes de arquitetura

`bootstrap-fundo-virgem.test.ts` ganhou 1 teste novo confirmando o
predicado final (evidência econômica nas 3 tabelas canônicas, sem
referência a `importacoes_financeiras` no corpo da função) e manteve 1
teste documentando a versão anterior (superada) para não confundir leitura
futura — 15 testes no total, todos passando.

### Gates de qualidade

`npx tsc --noEmit`: limpo. `npm test -- --run`: **166 arquivos / 1285
testes** (1 novo), 0 falhas, 3 skips pré-existentes. `npm run lint`: mesmos
6 warnings pré-existentes, 0 erros novos. `npx next build --webpack`:
sucesso. `npm audit --omit=dev`: 0 vulnerabilidades. `git diff --check`:
limpo (só avisos benignos de CRLF/LF). Regressões P2.6/Golden V2
reexecutadas ao vivo sem falhas (`homolog:financeiro:risco:verify` 8/8,
`homolog:rlx:golden:v2:verify` 384/384).

### Resultado final

- Predicado corrigido para evidência econômica real, confirmado ao vivo
  nos dois sentidos (RLX FLUOROCHEMICAL reclassificado virgem; fundo QA sai
  do bootstrap após operação incorporada, com prova de ausência de
  reentrada).
- Fail-closed preservado: nenhum bypass, nenhuma fabricação de dado,
  bloqueio normal reafirmado após saída do bootstrap.
- Risco remanescente novo: fixture `qa-bootstrap-cedente-incorporado@qa-rlx.invalid`
  (cedente + operação sintética incorporada) permanece em homologação,
  claramente identificado, para uso contínuo de QA do cenário de saída.
- Riscos remanescentes anteriores (catch-all indiferenciado; nenhum
  ESTOQUE D-1 real em homologação) permanecem inalterados por este ticket.
