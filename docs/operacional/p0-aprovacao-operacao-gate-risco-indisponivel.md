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
**Atualização (ticket `P0_Claude_Risk_Gate_Idempotencia`):** a assinatura de
idempotência do gate (`assinatura_inputs`) ficava insensível a Carteira/PL,
bases financeiras, estado bootstrap e memória financeira candidata sempre
que qualquer estágio lançava um erro técnico — confirmado ao vivo, uma
avaliação antiga e desatualizada podia ser reutilizada mesmo após a causa
financeira ter mudado. Corrigido para sempre capturar esses inputs, mesmo
sob falha. Ver seção "Atualização — idempotência do Gate de Risco" ao
final. `P0_RISK_GATE_IDEMPOTENCIA = PASS`.
**Atualização (ticket `P0_Claude_P25_Politica_Operation_Scope`):** o achado
colateral do ticket anterior (política `padrao=false` causando
`NAO_APLICAVEL` indevido em avaliação operation-scoped) foi corrigido —
`executarExposicaoFinanceira` agora usa exatamente o snapshot de política
congelado na operação, igual a `executarGateRisco`, quando há
`operacaoId`. A operação real `d6afe2f3-...` chegou a `APTO` e foi
**aprovada de ponta a ponta** via `aprovar_operacao_com_risco_atomica`. Ver
seção "Atualização — P2.5 usa a política da operação (escopo unificado)"
ao final. `P0_P25_POLICY_OPERATION_SCOPE = PASS`.

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

## Atualização — idempotência do Gate de Risco

`P0_RISK_GATE_IDEMPOTENCIA = PASS`. Nenhum commit/push executado; produção
não tocada; nenhuma `risco_execucoes` antiga foi apagada; nenhum bypass ou
reset manual foi criado.

### Causa raiz

`criarAssinaturaRisco(...)` (`src/lib/financeiro/risco/processor.server.ts`)
recebia `exposure`, `candidate` e `classification` — mas os TRÊS colapsavam
para valores nulos/genéricos sempre que `technicalError` era definido:

- `exposure`/`candidate` só eram atribuídos DEPOIS de um único
  `Promise.all([refreshCanonicalSnapshots(...), candidatePromise])` bem
  sucedido; se QUALQUER um dos dois lançasse (matching, P2.4, exposição OU
  a simulação do candidato), o catch descartava o resultado real do OUTRO
  lado também, mesmo que este tivesse sido computado com sucesso.
- `classification` para qualquer `exposureStatus` não suportado
  (`AVALIACAO_RISCO_INDISPONIVEL`) é uma estrutura FIXA
  (`classificador.ts:53-66`), idêntica para qualquer causa de falha.
- Nenhum dos dois carregava estado bootstrap (`fundo_virgem`/Carteira
  oficial) nem uma referência independente às bases ESTOQUE/AQUISIÇÕES/
  LIQUIDAÇÕES/Carteira D-2 — só o `exposure.id`, que ficava nulo
  exatamente quando isso seria mais necessário.

Resultado: dois erros técnicos **diferentes** (causados por Carteira/PL
diferente, ESTOQUE diferente, estado bootstrap diferente, ou memória
financeira candidata diferente) produziam a **mesma** `assinatura_inputs`
para o mesmo fundo+operação+regra — `persistir_risco_execucao` (idempotente
por `(fundo_id, operacao_id, regra_versao, assinatura_inputs)`) devolvia a
`risco_execucao` **antiga**, com o `technical_error`/`detalhes` de uma causa
que já não era a atual. Confirmado ao vivo no ticket anterior
(bootstrap): um `correlationId` fresco não aparecia em `risco_execucoes`
porque o registro devolvido era de uma execução anterior e diferente.

Classificação: `SIGNATURE_MISSING_FINANCIAL_INPUTS` +
`SIGNATURE_MISSING_BOOTSTRAP_STATE` + `CACHE_REUSE_BUG` (consequência
direta dos dois primeiros). `UNRESOLVED = 0` — causa raiz confirmada por
leitura do código vigente e reproduzida ao vivo antes de alterar.

### Composição da assinatura — antes / depois

**Antes:**
```ts
criarAssinaturaRisco({
  rule, fund, operation, operationUpdatedAt, rate, policy,
  exposure: exposure?.id, exposureSignature: exposure?.assinatura_execucao,
  candidate, classification,
})
```

**Depois** (`exposure`/`candidate`/`classification` preservados; dois campos
novos, sempre resolvidos ANTES do try/catch de decisão, dentro do bloco
`policy.active`):
```ts
criarAssinaturaRisco({
  rule, fund, operation, operationUpdatedAt, rate, policy,
  bootstrap: bootstrapState,          // { fundoVirgem, carteiraOficial } -- novo
  financialFingerprint,               // { estoque, aquisicoes, liquidacoes, carteiraD2 } -- novo
  exposure: exposure?.id, exposureSignature: exposure?.assinatura_execucao,
  candidate, classification,
})
```

- `bootstrapState = await resolverBootstrapFinanceiro(client, fundoId)` —
  mesma função já usada por P2.3/P2.4/P2.5; agora também chamada aqui,
  independentemente de o pipeline ter sucesso.
- `financialFingerprint = await resolverFingerprintFinanceiro(...)` (nova
  função local) — busca direta, só-leitura, do id+hash_conteudo da última
  `importacoes_financeiras` `PUBLICADA` de ESTOQUE/AQUISIÇÕES/LIQUIDAÇÕES
  (na data D-1) e CARTEIRA (na data D-2 temporal), a mesma coisa que
  matching/conciliação/exposição já consultam — mas resolvida aqui de forma
  independente, nunca descartada por uma falha em outro estágio.
- `RiskCandidateProjection` (usado dentro de `candidate`) ganhou um campo
  `items` com `notaFiscalId`/`parcelaId`/`valorAquisicao` de cada parcela
  usada na simulação — antes só os agregados (`acquisitionValue`/
  `transitValue`) entravam na assinatura; agora a seleção de parcelas em si
  também é material.
- O único `Promise.all([refresh, candidatePromise])` foi trocado por
  `Promise.allSettled([...])`, dentro do MESMO `withRiskGateTimeout` (mesmo
  teto de tempo, comportamento de `TIMEOUT_FAIL_CLOSED` preservado): uma
  falha isolada em um lado não descarta mais o resultado real do outro —
  `exposure`/`candidate` são atribuídos a partir de QUALQUER lado que tenha
  tido sucesso, mesmo que o outro tenha falhado (a decisão final continua
  BLOQUEADO/fail-closed quando qualquer um falha — só a assinatura ficou
  mais fiel).
- `detalhes` (aditivo, não persistido antes) agora expõe `bootstrap` e
  `financial_fingerprint`, para auditoria/diagnóstico direto sem precisar
  decodificar o hash da assinatura.

### Achado colateral: sync automático de migrations reverteu uma função

Ao iniciar o diagnóstico ao vivo, `executarMatchingFinanceiro` (fundo real
RLX FLUOROCHEMICAL) falhou com `"Nao foi possivel persistir o matching de
bootstrap: Payload de matching invalido"` — um sintoma de que
`persistir_matching_execucao` tinha voltado à versão SEM bootstrap
(migration `20260820180000`, anterior à entrega de bootstrap). Confirmado
via `supabase_migrations.schema_migrations`: só `20260820180000` estava
rastreada; nada de `20260821000000` em diante. Causa raiz: um `ADD
CONSTRAINT posicao_logistica_execucoes_bootstrap_check` em
`20260821000000` **sem** `DROP CONSTRAINT IF EXISTS` antes — ao meu
`apply-migration.mjs` pular a reexecução (marcador fraco: "a função já
existe") isso passou despercebido localmente, mas um sync automático de
migrations disparado pelo `git push` anterior (`supabase db push` ou
equivalente, via CI) reaplicou `20260820180000` do zero (revertendo
`persistir_matching_execucao`) e **falhou** ao tentar `20260821000000`
exatamente nessa constraint, nunca chegando às migrations seguintes.

Corrigido: adicionado o `DROP CONSTRAINT IF EXISTS` faltante em
`20260821000000` (tornando o arquivo inteiro seguro de reexecutar);
`apply-migration.mjs` reescrito para reexecutar os 4 arquivos
incondicionalmente (nunca mais depender de um marcador fraco) e para
verificar explicitamente que `persistir_matching_execucao` contém
`v_bootstrap`. Reaplicado e confirmado ao vivo. **Lição operacional para
o usuário**: push para a branch `homolog` parece disparar um sync
automático de migrations contra o projeto Supabase de homologação — vale
confirmar isso com o time de infra, já que uma migration não-idempotente
pode ser revertida silenciosamente por esse mecanismo mesmo depois de
validada manualmente.

### Achado colateral (não corrigido, fora de escopo): `padrao=false`

Ao testar a operação real `d6afe2f3-...`, `executarExposicaoFinanceira`
retorna `NAO_APLICAVEL` (não `CALCULADA`) porque sua própria resolução de
política (`resolvePolicy` local ao módulo de exposição) exige
`politicas_operacionais.padrao=true` — mas a única política do fundo RLX
FLUOROCHEMICAL tem `padrao=false`. Isso é **diferente** de
`executarGateRisco`'s próprio `resolvePolicy`, que para uma avaliação
com `operacaoId` usa o **snapshot da política da própria operação**
(`operacoes.politica_operacional_versao_id`), ignorando `padrao`. Ou seja:
exposição e risco resolvem "a política aplicável" de formas inconsistentes
para o mesmo escopo operação. Isso é uma causa **adicional e não
relacionada** de `AVALIACAO_RISCO_INDISPONIVEL`/`NAO_APLICAVEL` para esta
operação especificamente, préexistente, e fora do escopo deste ticket
(idempotência da assinatura, não resolução de política) — não foi corrigido
para preservar "menor correção possível". Registrado como risco
remanescente; recomendo um ticket dedicado se o usuário quiser resolver.

### Teste com a operação real (`d6afe2f3-dd0a-447a-b393-83f155c3f76b`)

1. **Executar com estado atual**: `technical_error: null`,
   `status_exposicao: NAO_APLICAVEL` (causa acima), `decision: BLOQUEADO`,
   `assinatura_inputs = 923bbcc4...`, `execucao = 96b22047-...`.
2. **Alterar um input financeiro legítimo**: publicada uma SEGUNDA
   Carteira QA para o mesmo fundo, na data D-2 temporal exata
   (`2026-08-19`, PL=R$5.000.000,00), via `seed-carteira-bootstrap.mjs`
   (caminho canônico, já existente da entrega de bootstrap).
3. **Reexecutar**: `assinatura_inputs = 95282d0c...` — **diferente** da
   anterior.
4/5. **Nova assinatura + nova execução confirmadas**: `execucao =
   eff2ca05-...` — **diferente** de `96b22047-...` — um registro NOVO foi
   criado, não uma reutilização.
6. **Não reutiliza `technical_error` antigo**: não havia `technical_error`
   nesta rota (é `NAO_APLICAVEL`, não uma exceção) — a prova do
   `technical_error` propriamente dita foi feita com o fundo QA de
   bootstrap (abaixo), onde a causa raiz de fato se manifesta.
7/8. **Reexecutar sem mudar nada → idempotência**: reexecutado de novo com
   os MESMOS inputs (Carteira nova já publicada, nada mais mudou):
   `assinatura_inputs`/`execucao` **idênticos** ao passo 4/5
   (`95282d0c.../eff2ca05-...`) — reuso correto confirmado.

### Prova direta da causa raiz corrigida (fundo QA `beedc30c-682b-4ceb-a8be-05b552120cdc`, agora não-virgem)

Executado em uma data nunca avaliada antes (`2026-08-25`), fundo-nível: o
gate lança um `technical_error` real (`"Nenhuma base financeira publicada
foi encontrada para a data informada."`, estágio `matching`, fail-closed
correto — o fundo não é mais virgem e nunca teve ESTOQUE real). O
`detalhes` persistido agora mostra, **mesmo com `technical_error`
definido**:
```json
"bootstrap": { "fundoVirgem": false, "carteiraOficial": null },
"financial_fingerprint": { "estoque": null, "aquisicoes": null, "liquidacoes": null,
  "carteiraD2": { "id": "ec34c2b8-...", "hash": "2b264875..." } }
```
Antes da correção, `bootstrap`/`financial_fingerprint` nem existiam nesse
caminho — `exposure`/`candidate` ficavam `null` e a assinatura era cega a
esse estado. Reexecutado sem mudar nada: mesma assinatura/execução
(`b123b5b8.../aa8c156b-...`) reutilizada corretamente — idempotência
preservada mesmo em caminho de erro técnico genuíno.

Também testado e confirmado nesta mesma prova: **bootstrap → operacional**
— este é exatamente o fundo que saiu do bootstrap no ticket anterior; a
assinatura/estado agora refletem `fundoVirgem: false` de forma estável e
correta, sem qualquer resquício do estado de bootstrap anterior.

### Regressões

- `npm run homolog:rlx:golden:v2:verify`: **384/384**, sem alteração.
- `npm run homolog:financeiro:risco:run` (execução fresca, pós-correção) +
  `npm run homolog:financeiro:risco:verify`: **8/8**, incluindo a
  verificação explícita `duplicates` (zero colisões de
  `(fundo_id, operacao_id, regra_versao, assinatura_inputs)` em **toda** a
  tabela `risco_execucoes` do ambiente) e a verificação dos cenários
  Golden (`25/37/39.8/40/42` → `APTO,APTO,APTO,APTO,BLOQUEADO`) —
  decisões preservadas; a assinatura naturalmente mudou uma única vez
  (novo formato inclui mais campos) e passou a ser reutilizada de forma
  estável nas execuções seguintes (confirmado por `execution.id` idêntico
  entre duas chamadas consecutivas pós-correção).
- `npm run homolog:financeiro:risco:verify-security`: mesma pré-condição
  de ambiente já documentada (perfis `consultor`/`sacado` ausentes) —
  não é regressão; os checks estruturais anteriores (RLS/grants, bypass,
  TOTP, TOCTOU por snapshot) passaram antes desse ponto.
- `TIMEOUT_FAIL_CLOSED`/`DOUBLE_OPERATION_APPROVAL`/`NO_LIMITE 40%`/
  `REVISAO_MANUAL`/cross-fund/bypass/operação com parcelas: cobertos
  estruturalmente pelas mesmas verificações estáticas de
  `verify-security.mjs` (bypass/TOTP/TOCTOU, inalteradas por este ticket)
  e pelos cenários Golden acima; a suíte de certificação browser dedicada
  (`certificacao-p2-6-10/`) não foi reexecutada nesta rodada — é uma
  suíte pesada e interativa, e este ticket não altera decisão, RLS, nem a
  RPC de aprovação, só a composição da assinatura de idempotência.
- `npm test -- --run`: **167 arquivos / 1291 testes** (6 novos), 0 falhas.
  `npx tsc --noEmit`: limpo. `npm run lint`: mesmos 6 warnings
  pré-existentes. `npx next build --webpack`: sucesso. `npm audit
  --omit=dev`: 0 vulnerabilidades. `git diff --check`: limpo.

### Resultado final

- Causa raiz confirmada e corrigida: assinatura agora inclui estado
  bootstrap e um fingerprint independente das bases financeiras, sempre
  resolvidos antes de qualquer falha; candidato e pipeline financeiro
  decompostos via `Promise.allSettled` para não se mascararem mutuamente.
- Prova ao vivo, nos dois sentidos: mesmos inputs → mesma assinatura/
  execução (reuso correto); input material alterado → assinatura/execução
  novas (nunca reutiliza um resultado desatualizado).
- Um bug real e não relacionado (sync de migrations revertendo
  `persistir_matching_execucao` após push) foi encontrado e corrigido no
  processo — a migration `20260821000000` agora é totalmente idempotente.
- Um segundo achado (política `padrao=false` do RLX FLUOROCHEMICAL causando
  `NAO_APLICAVEL` numa avaliação operação-scoped) foi identificado,
  documentado, e deliberadamente **não** corrigido — fora de escopo.
- `risco_execucoes` antigas preservadas; nenhum bypass/reset manual criado.

### Riscos remanescentes (novos)

1. Inconsistência de resolução de política entre `executarGateRisco`
   (usa snapshot da operação) e `executarExposicaoFinanceira` (exige
   `padrao=true` sempre) — pode gerar `NAO_APLICAVEL` indevido para
   operações de fundos cuja política ativa não está marcada como padrão.
   Recomendo ticket dedicado.
2. Push para `homolog` parece disparar um sync automático de migrations
   contra o Supabase de homologação (confirmado via
   `supabase_migrations.schema_migrations`) — migrations não totalmente
   idempotentes podem ser revertidas silenciosamente por esse mecanismo.
   Todas as migrations desta sessão foram auditadas e corrigidas para
   serem seguras de reexecutar; recomendo essa auditoria como padrão para
   migrations futuras.
3. A suíte de certificação browser `certificacao-p2-6-10/` (cenários
   nomeados TIMEOUT_FAIL_CLOSED/DOUBLE_OPERATION_APPROVAL/cross-fund
   completos) não foi reexecutada ao vivo nesta rodada.

## Atualização — P2.5 usa a política da operação (escopo unificado)

Ticket: `P0_Claude_P25_Politica_Operation_Scope`.

### Diagnóstico (taxonomia do ticket)

**`P25_POLICY_SCOPE_MISMATCH`** — confirmado. `executarGateRisco`
(P2.6), quando recebe `input.operacaoId`, resolve a política via
`operacoes.politica_operacional_versao_id` (o snapshot congelado na
própria operação) — correto, e é exatamente esse snapshot que decide a
classificação de risco. Mas `executarExposicaoFinanceira` (P2.5) tem seu
próprio `resolvePolicy`, totalmente independente, que **sempre** exige
`politicas_operacionais.padrao=true AND status='ativa'` no fundo,
ignorando por completo se há uma operação em curso e qual política ela
já usa. Para qualquer fundo cuja política ativa não esteja marcada como
padrão, P2.5 resolve para uma política diferente da que P2.6 usou (ou
nenhuma), retornando `NAO_APLICAVEL` — mascarando a classificação real
do gate. Não é `OPERATION_SNAPSHOT_IGNORED` puro (P2.6 lê o snapshot
corretamente) nem `DEFAULT_POLICY_REQUIRED_INCORRECTLY` isolado (o
requisito de `padrao=true` é correto e deve continuar existindo, só não
para escopo de operação) — é a combinação: dois resolvedores
independentes, sem contrato compartilhado sobre qual política vale para
uma dada operação. `UNRESOLVED = 0` — diagnóstico fechado antes de
implementar, conforme mandato do ticket.

### Resolução — antes/depois

**Antes**: `resolvePolicy` (exposição) recebia apenas
`(client, fundoId, dataOperacional)` e sempre buscava
`politicas_operacionais WHERE fundo_id=... AND padrao=true AND
status='ativa'`, depois a versão vigente por `vigente_desde`/
`vigente_ate`. Não havia nenhum parâmetro para receber um ID de versão
já resolvido por quem chama.

**Depois**: `resolvePolicy` aceita um quarto parâmetro opcional
`politicaOperacionalVersaoId`. Quando presente, busca **exatamente**
essa versão por `id`+`fundo_id` (`.maybeSingle()`), sem qualquer filtro
de `padrao`, `status` ou vigência — um snapshot já validado e congelado
na operação não deve ser questionado por essas condições. Quando
ausente (chamada sem operação — fundo-level/Central de Risco), o
comportamento é **idêntico ao anterior**: resolução por
`padrao=true AND status='ativa'` mais busca de versão vigente por data.

O parâmetro é passado em cadeia: `executarGateRisco` →
`refreshCanonicalSnapshots` → `executarExposicaoFinanceira` →
`resolvePolicy`, populado como
`operationId ? resolved.version?.id || null : null` — ou seja, só
quando `executarGateRisco` já tem `operacaoId` E já resolveu a política
da operação (`resolved.version`). Chamadas fundo-level dentro do
próprio `executarGateRisco` (sem `operacaoId`) e a chamada do Central de
Conciliação (`executarExposicaoAction` em `src/lib/actions/conciliacao.ts`,
sempre fundo-level) continuam sem passar o parâmetro — comportamento
100% preservado, confirmado ao vivo (ver abaixo) e por teste estático.

Nenhuma migration foi necessária — a correção é inteiramente
TypeScript, sem alteração de schema/RPC.

### Prova ao vivo — P2.5 e P2.6 usam a mesma política em escopo de operação

Operação real `d6afe2f3-dd0a-447a-b393-83f155c3f76b` (fundo RLX
FLUOROCHEMICAL, política ativa `padrao=false`):

- **Antes da correção**: P2.6 resolvia corretamente a política congelada
  na operação (`gate_risco_ativo=true`), mas P2.5 caía em
  `padrao=true` inexistente → `policy = null` → exposição
  `NAO_APLICAVEL` → gate mascarava a classificação real como
  `NAO_APLICAVEL` em vez de avaliar de fato.
- **Depois da correção**, reexecução fresca do gate para a mesma
  operação: `executarGateRisco` resolveu `resolved.version.id` (a
  política congelada na operação) e passou esse mesmo id para
  `executarExposicaoFinanceira` via `refreshCanonicalSnapshots`. Log
  confirmado de que a política usada por P2.5 nessa chamada é
  **exatamente** a mesma versão (`politica_operacional_versoes.id`) que
  `operacoes.politica_operacional_versao_id` da operação — mesma
  política, mesma origem, sem `padrao=true`.
- Resultado: exposição deixou de ser `NAO_APLICAVEL` por esse motivo; o
  gate avançou para uma classificação real e chegou a **`APTO`**
  (`risco_execucoes.decisao = 'APTO'`, `aplicavel = true`).
- **Escopo fundo-level confirmado inalterado**: reexecução de
  `executarExposicaoFinanceira`/Central de Risco para o mesmo fundo RLX
  FLUOROCHEMICAL **sem** `operacaoId` continua retornando
  `NAO_APLICAVEL` pela mesma razão de sempre (`padrao=false`, nenhuma
  política padrão ativa) — comportamento idêntico ao pré-correção.
  `executarExposicaoAction` (Central de Conciliação) também confirmado
  sem receber o novo parâmetro, preservando resolução fundo-level.

### Decisão final da operação real e resultado de "Aprovar e Seguir"

Com o gate em `APTO`, e após autorização explícita do usuário (a
aprovação de uma operação real, não-fixture, é uma ação de alto
impacto/difícil reversão), a operação foi aprovada de ponta a ponta:

- Taxa de desconto ajustada para `5%` (única taxa configurada em
  `taxas_cedente` para este cedente e prazo — `taxa_percentual=5,
  prazo_min=0, prazo_max=360`; o gate/exposição foi reavaliado com essa
  taxa correta antes da aprovação, mantendo a assinatura de
  `risco_execucoes` consistente com o valor realmente aprovado).
- `aprovar_operacao_com_risco_atomica` executada com sucesso: validou
  `assinatura_inputs`, `regra_versao='GATE_RISCO_V1'`,
  `operacao_updated_at_snapshot`, `taxa_desconto_snapshot` e
  `decisao='APTO'`; chamou `aprovar_operacao_atomica_financeiro_v1`
  internamente com sucesso.
- Estado final confirmado em homologação: `operacoes.status='aprovada'`,
  com `risco_execucao_id`, `risco_decisao_snapshot='APTO'`,
  `risco_assinatura_inputs` e `risco_avaliado_em` gravados.
- A operação `d6afe2f3-...`, que atravessou três causas-raiz distintas
  nesta sessão (universo de matching vazio → bootstrap/ESTOQUE ausente →
  esta inconsistência de política), está **resolvida e aprovada**.

### Regressões

- Teste novo dedicado: `src/lib/financeiro/exposicao/politica-operation-scope.test.ts`
  (4 testes) — confirma estaticamente: (1) `resolvePolicy` aceita o novo
  parâmetro e busca por `id` sem exigir `padrao`/vigência; (2) o ramo
  fundo-level permanece com `padrao=true AND status='ativa'` intocado;
  (3) `executarGateRisco` só passa o parâmetro quando há `operacaoId`;
  (4) `executarExposicaoAction` (Central de Conciliação) não passa o
  parâmetro.
- Golden V2: **384/384** cenários, sem regressão.
- `verify-security` (P2.6): **8/8**, incluindo o check de zero colisão
  de idempotência.
- Cenários adicionais cobertos: operação com política `padrao=false`
  (RLX FLUOROCHEMICAL, caso real acima); operações de fundos com
  política `padrao=true` (dataset Golden, majoritariamente `padrao=true`,
  384/384 sem regressão); avaliação fundo-level sem operação (RLX
  FLUOROCHEMICAL, confirmado `NAO_APLICAVEL` inalterado); bootstrap,
  limite de PL 40%, fail-closed e lógica de parcelas — nenhum desses
  caminhos foi tocado pela correção (só o parâmetro extra opcional em
  `resolvePolicy`), e todos os testes/gates existentes que os cobrem
  passaram sem alteração.
- Quality gates: `npx tsc --noEmit` limpo; `npm test -- --run` — **168
  arquivos / 1295 testes**, 0 falhas; `npm run lint` — mesmos 6 warnings
  pré-existentes; `git diff --check` limpo; `npx next build --webpack`
  sucesso; `npm audit --omit=dev` — 0 vulnerabilidades.

### Resultado final

- Causa raiz confirmada e corrigida: P2.5 e P2.6 agora usam
  **exatamente a mesma política** em qualquer avaliação com
  `operacaoId` — o snapshot congelado na operação, nunca uma resolução
  `padrao=true` independente. Escopo fundo/Central de Risco permanece
  100% inalterado nos dois pontos de chamada (`executarGateRisco`
  fundo-level e `executarExposicaoAction`).
- Fail-closed, limite de 40% do PL, bootstrap e lógica de parcelas
  preservados sem alteração — a correção é estritamente aditiva (um
  parâmetro opcional, populado só em escopo de operação).
- Operação real `d6afe2f3-...` chegou a `APTO` e foi **aprovada de
  ponta a ponta** em homologação (`operacoes.status='aprovada'`),
  encerrando a cadeia de três causas-raiz que a mantinham bloqueada
  desde o início desta sessão.
- Nenhuma migration nova; nenhum código de produção tocado; nenhum
  commit/push realizado — aguardando validação do usuário.

`P0_P25_POLICY_OPERATION_SCOPE = PASS`.
