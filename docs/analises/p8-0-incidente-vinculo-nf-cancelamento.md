# P8.0 — vínculo histórico de NF após cancelamento

## Diagnóstico

Em leitura de produção, sem escrita, foi confirmado que uma operação cancelada e uma nova operação solicitada compartilhavam 49 NFs. Cada NF tinha dois registros em `operacoes_nfs`, mas somente um vínculo operacional ativo. O cancelamento havia removido os vínculos operacionais de parcelas; o histórico NF × operação antiga permaneceu, conforme o modelo do projeto.

O pré-validador em `src/lib/actions/sacado.ts` contava os dois vínculos sem consultar o status da operação. A RPC `public.processar_aceite_sacado` repetia essa contagem e poderia percorrer a operação cancelada se apenas a primeira validação fosse removida. A regra existente exclui `cancelada` e `reprovada`; `liquidada` não libera a NF.

O defeito é de código, não de dados. Uma consulta agregada identificou 64 NFs com vínculo histórico cancelado e outro vínculo não cancelado, distribuídas por dois cedentes e um fundo. Não é necessário apagar histórico nem executar data repair. IDs, CNPJ, chaves e números fiscais reais não são versionados neste repositório público.

## Correção e validação

O domínio e a Server Action agora contam apenas vínculos operacionais ativos. A migration `20260916150333_corrigir_aceite_sacado_vinculo_nf_cancelada.sql` aplica a mesma regra à RPC e preserva os grants: `anon` sem `EXECUTE`; `authenticated` com `EXECUTE`. A migration foi aplicada somente em homologação durante a validação.

O golden `scripts/homologacao/p8-0-aceite-sacado/e2e.mjs` executou em homologação em 16/09/2026, em transação reversível: criou duas NFs sintéticas, vinculou-as à operação A, cancelou A, criou B solicitada com as mesmas NFs e chamou a RPC como Sacado QA autenticado. As 12 verificações passaram: A isolada bloqueada, duas operações ativas bloqueadas, aceite de B em lote, duas NFs aceitas, A inalterada, histórico e auditoria preservados, retry negado e nenhum resíduo após `ROLLBACK`. Não houve envio externo nem efeito financeiro. Reexecutar com `node scripts/homologacao/p8-0-aceite-sacado/e2e.mjs` e `.env.homolog` local.

Esta evidência cobre RPC e banco com claims simulados; não equivale a uma sessão de navegador. Smoke no portal e release controlado ainda são necessários antes de declarar o incidente encerrado em produção. Nenhum agente deve aprovar NFs reais pelo Sacado.

Qualidade anterior à promoção: TypeScript e build passaram; testes direcionados P8.0 passaram. A suíte completa tem uma falha preexistente fora deste escopo em um teste textual da migration de convite de cedente.

## Gates

| Gate | Resultado |
| --- | --- |
| Escopo e causa raiz | Confirmados por leitura de produção |
| Classificação | `CODE_ONLY`; nenhum data repair necessário |
| Reproduzibilidade do cenário | PASS em homologação |
| Fix validado em non-prod | PASS para RPC/banco; navegador pendente |
| Histórico preservado | PASS |
| Autorização para aceite real | Não concedida; nenhuma NF real foi aceita |
| Smoke de produção | Não executado |
