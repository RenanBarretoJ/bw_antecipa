# Dívida técnica — transações financeiras

## Escopo

Este registro descreve o comportamento existente na Fase 1. Nenhuma rotina financeira foi refatorada nesta fase; as correções ficam para uma etapa posterior, com decisão funcional e testes de concorrência/reconciliação.

## 1. `solicitarAntecipacao`

- **Arquivo/função:** `src/lib/actions/operacao.ts` — `solicitarAntecipacao`.
- **Tabelas envolvidas:** `notas_fiscais`, `operacoes`, `operacoes_nfs`.
- **Comportamento atual:** lê NFs aprovadas, calcula valores, insere a operação, insere os vínculos e altera as NFs para `em_antecipacao` em chamadas separadas.
- **Risco:** uma falha entre as escritas pode deixar operação sem todos os itens, NFs sem operação ou NFs em estado financeiro incompatível.
- **Correção futura:** transação/RPC única com validação de estado e proteção contra dupla submissão; retornar o ID apenas após todas as mudanças confirmadas.
- **Prioridade:** alta.

## 2. `aprovarOperacao`

- **Arquivo/função:** `src/lib/actions/operacao.ts` — `aprovarOperacao`.
- **Tabelas envolvidas:** `operacoes`, `operacoes_nfs`, `notas_fiscais`, `profiles`, `notificacoes`.
- **Comportamento atual:** verifica a operação e NFs, atualiza termos/valores da operação e grava dados financeiros por NF em chamadas distintas; depois notifica o sacado.
- **Risco:** aprovação parcial, valores de operação divergentes dos valores por NF ou notificação sem aprovação completa.
- **Correção futura:** separar cálculo puro de persistência e encapsular alterações financeiras em transação; notificações devem ser outbox/evento após commit.
- **Prioridade:** alta.

## 3. `desembolsarOperacao`

- **Arquivo/função:** `src/lib/actions/operacao.ts` — `desembolsarOperacao`.
- **Tabelas envolvidas:** `operacoes`, `contas_escrow`, `movimentos_escrow`, `notas_fiscais`, `notificacoes`.
- **Comportamento atual:** valida documentos, altera operação para `em_andamento`, atualiza saldo escrow e insere movimento em etapas separadas.
- **Risco:** saldo atualizado sem movimento correspondente, movimento sem saldo, desembolso repetido ou operação marcada como desembolsada sem crédito confirmado.
- **Correção futura:** operação idempotente por `operacao_id`/evento, lock da conta, transação única e constraint para impedir crédito duplicado.
- **Prioridade:** crítica.

## 4. `liquidarOperacao`

- **Arquivo/função:** `src/lib/actions/liquidacao.ts` — `liquidarOperacao`.
- **Tabelas envolvidas:** `operacoes`, `operacoes_nfs`, `notas_fiscais`, `contas_escrow`, `movimentos_escrow`, `notificacoes`, `logs_auditoria`.
- **Comportamento atual:** marca a operação como `liquidada`, marca as NFs como liquidadas, calcula `receita = valor_bruto_total - valor_liquido_desembolso`, soma a receita ao saldo e registra um movimento cujo `valor` é `valor_bruto_total`.
- **Risco:** divergência entre o saldo incrementado e o valor registrado no movimento; falhas intermediárias podem deixar operação liquidada sem NFs/escrow coerentes; repetição pode creditar novamente.
- **Correção futura:** decisão funcional sobre qual valor o movimento deve representar, reconciliação de ledger, transação com lock e idempotência explícita.
- **Prioridade:** crítica.

## 5. `marcarInadimplente`

- **Arquivo/função:** `src/lib/actions/liquidacao.ts` — `marcarInadimplente`.
- **Tabelas envolvidas:** `operacoes`, `notificacoes`, `logs_auditoria`.
- **Comportamento atual:** lê a operação, atualiza o status e envia notificações/log em passos separados; a ação pode ser repetida sem uma condição de transição atômica.
- **Risco:** notificações duplicadas e alteração de uma operação em estado já incompatível.
- **Correção futura:** `UPDATE ... WHERE status = ...` com verificação do número de linhas, evento idempotente e tabela/outbox de notificações.
- **Prioridade:** média-alta.

## 6. `registrarMovimentoEscrow` e `registrarMovimentosLote`

- **Arquivo/função:** `src/lib/actions/escrow.ts` — `registrarMovimentoEscrow` e `registrarMovimentosLote`.
- **Tabelas envolvidas:** `contas_escrow`, `movimentos_escrow`, `logs_auditoria`.
- **Comportamento atual:** lê saldo, calcula novo saldo, insere/atualiza em chamadas distintas; o lote insere movimentos antes de atualizar o saldo final.
- **Risco:** concorrência entre movimentos, saldo negativo em cenário concorrente, movimento sem saldo correspondente e inconsistência se a segunda escrita falhar.
- **Correção futura:** função SQL transacional com lock `FOR UPDATE`, validação de saldo, inserção e atualização na mesma transação; idempotency key para integrações.
- **Prioridade:** crítica.

## 7. API `/api/escrow/sync`

- **Arquivo:** `src/app/api/escrow/sync/route.ts`.
- **Tabelas envolvidas:** `contas_escrow`, `movimentos_escrow`, `logs_auditoria`.
- **Comportamento atual:** autentica por API key, calcula todos os movimentos em memória, insere o lote, atualiza o saldo e registra auditoria em chamadas separadas.
- **Risco:** retry da integração duplica movimentos; falha após insert antes do saldo cria divergência; não há chave de idempotência persistida.
- **Correção futura:** exigir referência externa única por movimento/lote, persistir protocolo de integração, usar transação e reconciliar saldo antes de aceitar novo lote.
- **Prioridade:** crítica.

## Não alterar nesta Fase 1

Não foram alterados cálculos de deságio, desembolso, liquidação, saldo, escrow ou status financeiros. O objetivo desta fase é somente registrar o risco, criar autorização/auditoria explícitas e preparar testes de caracterização para a correção futura.
