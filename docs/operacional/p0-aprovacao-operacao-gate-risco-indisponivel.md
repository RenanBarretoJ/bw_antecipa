# P0 — Aprovação bloqueada por AVALIACAO_RISCO_INDISPONIVEL

## Resultado

`P0_APROVACAO_OPERACAO_RISCO = PARCIAL` — ver seção "Status final".

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
