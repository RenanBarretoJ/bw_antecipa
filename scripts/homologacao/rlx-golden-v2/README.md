# RLX Golden Dataset V2

Massa sintética determinística de homologação do P2.2/P2.3. O namespace `RLX_GOLDEN_V2` é exclusivo e não altera o Golden V1.

## Fluxo

1. `npm run homolog:rlx:golden:v2:fixtures`
2. `npm run homolog:rlx:golden:v2:e2e -- --expected-project-ref <REF>` (dry-run)
3. execução mutável somente com `--execute` e a confirmação exata exibida pelo dry-run;
4. `npm run homolog:rlx:golden:v2:verify -- --expected-project-ref <REF>`;
5. cleanup opcional primeiro em preview com `npm run homolog:rlx:golden:v2:cleanup -- --expected-project-ref <REF>`.

O E2E usa a ingestão real P2.2 e os processadores reais P2.3, executa a fase A, aplica as retificações, executa a fase B e preserva ambas para auditoria.
