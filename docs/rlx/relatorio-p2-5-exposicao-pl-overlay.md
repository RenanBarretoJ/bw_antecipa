# P2.5 — PL D-2, exposição em trânsito e overlay intraday

Status: implementado e homologado no projeto Supabase `fhgkmggthxikfpogrvaa` em 14/08/2026. Produção não foi alterada.

## 1. Objetivo

O P2.5 cria uma camada histórica e auditável que combina a posição financeira/logística D-1 produzida pelo P2.4, o patrimônio líquido oficial D-2 ingerido pelo P2.2 e operações econômicas D0 ainda não incorporadas ao estoque. O resultado é a exposição conhecida em trânsito e sua proporção sobre o PL, sem aprovar, reprovar ou bloquear operações.

## 2. Arquitetura

```text
Calendário ANBIMA
  ├─ D-1 → snapshot P2.4 (posição + logística)
  ├─ D-2 → snapshot P2.2 (PL oficial)
  └─ D0  → operações econômicas elegíveis ao overlay
               ↓
       RLX_EXPOSICAO_V1
               ↓
  execução imutável + itens de overlay + auditoria
               ↓
       UI Exposição / simulação read-only
```

O motor está em `src/lib/rlx/exposicao/processor.server.ts`; cálculo Decimal e classificação ficam em `calculo.ts`; assinatura canônica em `fingerprint.ts`; persistência protegida em `public.registrar_rlx_exposicao_execucao(jsonb)`.

## 3. Datas operacionais

A data operacional D0 é convertida por calendário ANBIMA canônico, sem subtração civil. A execução persiste D0, estoque D-1 e PL D-2. Na execução homologada: D0 `2026-08-10`, estoque `2026-08-07` e PL `2026-08-06`.

## 4. PL D-2

A fonte exclusiva é `rlx_carteira_snapshots`, associada à importação publicada e vigente do P2.2 para fundo + D-2. A linhagem guarda `carteira_importacao_id`, `carteira_snapshot_id`, data e valor do PL. Não existe fallback. Ausência produz `PL_D2_INDISPONIVEL`; PL menor ou igual a zero produz `PL_D2_INVALIDO`; em ambos os casos não há divisão. O PL usado em homologação foi `R$ 50.000.000,0000`.

## 5. Posição P2.4

O P2.5 consome diretamente a execução vigente de `rlx_posicao_logistica_execucoes` e seus resultados. Não recompõe Estoque, matching ou logística. A execução utilizada foi `2d9430ec-42cb-4535-99d8-3fcfdb27a9b1`, com posição total de `R$ 1.169.452,3600` e 15 itens.

## 6. Buckets

Os buckets `ENTREGUE`, `EM_TRANSITO`, `INDETERMINADA` e `SEM_MATCH_FINANCEIRO_NF` permanecem separados. Na execução homologada: 0 entregues, 0 em trânsito, 12 indeterminados e 3 sem match. Não há conversão implícita entre categorias.

## 7. Numerador

O numerador oficial é `valor_em_transito_estoque + overlay_em_transito`, sempre pelo `valor_aquisicao` já calculado. Apenas `EM_TRANSITO` entra. O valor conhecido na execução atual foi `R$ 0,0000` porque a posição vigente não possuía item conhecido nesse bucket e não havia overlay economicamente elegível.

## 8. Indeterminada

`INDETERMINADA` não entra no numerador e não é tratada como risco zero. São persistidos quantidade e valor. Homologação: 12 itens e `R$ 147.803,4500`, com flag `TEM_INDETERMINADA`.

## 9. Sem match

`SEM_MATCH_FINANCEIRO_NF` não recebe logística inferida. Homologação: 3 itens e `R$ 1.021.648,9100`, com flag `TEM_SEM_MATCH`.

## 10. Overlay

O overlay consulta operações do fundo até `overlay_as_of`, resolve suas NFs pelo vínculo operacional canônico e lê o valor de aquisição em `operacao_calculo_nfs`. Cada candidata é persistida em `rlx_exposicao_overlay_itens`, inclusive quando excluída do numerador por deduplicação. O processamento não executa P2.3 novamente.

## 11. Lifecycle

O marco econômico real encontrado no domínio é uma operação com status `em_andamento` ou `inadimplente`, `cessao_efetivada_em` preenchida e anterior ou igual ao as-of. Estados anteriores — incluindo solicitada/aprovada — não compõem exposição, assim como rejeitada, cancelada e simulações. As dez operações D0 do Golden permanecem em `aprovada`, sem cessão efetivada; por isso não entram economicamente no overlay do banco atual.

## 12. Valor de aquisição

O overlay utiliza exclusivamente a memória financeira canônica por NF em `operacao_calculo_nfs`. Taxa, desconto e valor presente não são recalculados. Valores ausentes permanecem nulos, contam em `quantidade_valor_aquisicao_ausente` e geram `TEM_VALOR_AUSENTE`.

## 13. Logística do overlay

O status de cada NF do overlay é resolvido pelo mesmo domínio logístico canônico do P2.4 no instante `overlay_as_of`. O P2.5 não possui segunda árvore de regras logísticas. `EM_TRANSITO` entra; `ENTREGUE` e `INDETERMINADA` ficam em agregados separados.

## 14. Dupla contagem

A deduplicação compara evidências fortes presentes na posição P2.4, priorizando `nota_fiscal_id`, chave NF-e e crosswalk persistido. Candidata já incorporada é mantida para auditoria com `incluido_overlay=false` e motivo `JA_INCORPORADO_ESTOQUE`. Valor, cedente e vencimento isolados não são usados para identidade.

## 15. Não incorporadas

Operação economicamente assumida antes de D0 e ainda ausente do estoque é classificada `OPERACAO_NAO_INCORPORADA`. Quantidade e valor ficam separados e geram `TEM_OPERACAO_NAO_INCORPORADA`; o valor não é promovido automaticamente ao numerador oficial.

## 16. Percentual

```text
percentual_exposicao =
  exposicao_em_transito_total / patrimonio_liquido_d2 × 100
```

Na execução homologada, `0 / 50.000.000 × 100 = 0,000000000000%`.

## 17. Precisão

O cálculo usa `Decimal` na aplicação e `numeric` no PostgreSQL. A comparação usa o valor persistido, não a apresentação arredondada. Os casos `39.999999999`, `40.000000000` e `40.000000001` foram cobertos em teste.

## 18. Política

A política versionada recebeu `controle_exposicao_logistica_ativo` e `limite_exposicao_em_transito_pct`. A resolução considera a versão publicada vigente e, para reprodução histórica, a versão substituída cuja vigência contenha D0. Versões publicadas continuam imutáveis; a migration complementar estende a proteção existente aos novos campos.

## 19. Limite

O motor não contém limite fixo. O Golden V2 foi configurado com 40%, preservado como snapshot em `limite_referencia_pct`. Fundo sem controle ativo resulta em `NAO_APLICAVEL`.

## 20. NO_LIMITE

A classificação matemática possui somente `ABAIXO_LIMITE`, `NO_LIMITE` e `ACIMA_LIMITE`. Exatamente 40% gera `NO_LIMITE`, visualmente neutro. O P2.5 não converte essa classificação em aprovado, reprovado, elegível ou bloqueado.

## 21. Simulação

A ação de simulação recebe uma operação ainda fora do marco econômico, resolve valores e logística e retorna percentual/classificação atual e projetada, valor adicional em trânsito e indeterminado adicional. Não altera operação, remessa, cessão ou status. Apenas registra auditoria segura `RLX_EXPOSICAO_SIMULADA`, sem payload financeiro integral.

## 22. Histórico

Execuções e itens são append-only para usuários operacionais. A execução preserva as linhagens P2.2/P2.4, datas as-of, regra, limite, agregados, flags, assinatura, timestamps e correlation ID. Mudanças de base geram nova execução e mantêm a anterior.

## 23. Idempotência

A assinatura inclui fundo, execução P2.4, snapshot/importação D-2, estado determinístico do overlay, regra e limite. Duas execuções sem mudança retornaram o mesmo ID `b8994dc5-f01f-4de0-95fe-9bfab9e304a0` e a mesma assinatura `6fab540b33c73696aa3d42c76702158e4c7e350414275c4e90d8483dc5e2f747`.

## 24. Retificação

Nova execução P2.4 por mudança logística altera a assinatura do P2.5. Nova importação/snapshot D-2 também altera a assinatura. A cadeia esperada permanece P2.2 → P2.3 → P2.4 → P2.5; nenhuma exposição antiga é reinterpretada pela política corrente.

## 25. UI

Foi adicionada a aba `Exposição` em `/gestor/conciliacao`. Ela mostra referências D0/D-1/D-2, as-of, regra, PL, posição, buckets, overlay, exposição, percentual, limite, classificação neutra, qualidade, tabela server-side do overlay e simulação. Nenhuma ação de decisão financeira foi adicionada.

## 26. RLS

Gestor vê somente fundos autorizados; híbrido também exige `usuario_fundos` ativo. Super Admin puro, cedente, consultor, sacado e anon não recebem visão global. INSERT/UPDATE/DELETE por JWT operacional são bloqueados; escrita ocorre pelo RPC server-side restrito. A matriz de 16 verificações passou, incluindo cross-fund e rollback das tentativas de mutação.

## 27. Auditoria

O RPC registra `RLX_EXPOSICAO_CALCULADA`, `RLX_EXPOSICAO_RECALCULADA` ou `RLX_EXPOSICAO_PL_INDISPONIVEL`; simulação registra `RLX_EXPOSICAO_SIMULADA`. Os eventos carregam somente referências, regra, status e correlation ID necessários à rastreabilidade.

## 28. Performance

Benchmark controlado final: 10.000 posições e 1.000 candidatas ao overlay processadas em 11,94 ms, com variação de heap de 2,60 MB. Resultado sintético: exposição `R$ 50.972.442,0540`, percentual `10,194488410800%`, classificação `ABAIXO_LIMITE`. O resultado não exige job assíncrono no volume medido, mas produção deve ser monitorada.

## 29. Golden V2

Não foi criado Golden V3 nem alterado `expected/expected-exposure.json`. O Golden V2 permaneceu 384/384. O seed limpo agora grava a política P2.5; para a base homolog já existente, um script explícito e protegido enriqueceu apenas as políticas sintéticas Golden. As dez operações D0 continuam pré-marco econômico, preservando o contrato do dataset; cenários unitários cobrem inclusão, deduplicação e virada de dia.

## 30. Testes

Passaram: verificador P2.5 (19 checks), segurança P2.5 (16), P2.2 (44), P2.3 (28, com duas ressalvas Golden já documentadas), segurança P2.3 (22), P2.4 (13), segurança P2.4 (26) e Golden V2 (384/384). Os testes unitários cobrem 25/37/39,8/40/42, precisão ao redor do limite, PL ausente/inválido, buckets, overlay e dupla contagem. A migration foi validada em transação antes da aplicação permanente.

## 31. Limitações

O baseline Golden não possui operação D0 após cessão efetivada e, portanto, não demonstra overlay econômico positivo no banco sem alterar seu contrato. O smoke visual autenticado depende de Gestor QA reutilizável e não foi improvisado. O processamento permanece síncrono. Não há gate final de aprovação.

## 32. Riscos

Os principais riscos residuais são crescimento real acima do benchmark, atraso de ingestão D-2, qualidade baixa por sem-match/indeterminada, divergência entre lifecycle operacional e eventos externos e operação antiga não incorporada ao estoque. Todos são expostos por status ou flags, sem fallback silencioso.

## 33. Perguntas abertas

Continuam deliberadamente abertas: exatamente 40% aprova ou bloqueia; fallback quando PL D-2 inexiste; se `INDETERMINADA` ou `SEM_MATCH` entram em algum limite prudencial; tratamento definitivo de liquidação parcial e operação anterior não incorporada.

## 34. Próximos passos

Antes de qualquer P2.6: validar smoke com usuário Gestor QA existente, acompanhar tempo/memória com carteira real, homologar com área de risco as perguntas abertas e definir separadamente o gate decisório. Nenhuma dessas decisões deve retroagir sobre as execuções P2.5.

## 35. Parecer

O P2.5 está tecnicamente apto para homologação: usa PL exclusivamente D-2, posição P2.4 imutável, valor de aquisição canônico, Decimal, política por fundo, overlay auditável, deduplicação forte, RLS e idempotência. A execução real homologada ficou `ABAIXO_LIMITE` em 0%, com limite de 40%, 12 posições indeterminadas e 3 sem match claramente sinalizadas. A camada mede e explica exposição; corretamente não decide elegibilidade.

### Inventário técnico

- Migrations: `20260814213000_p2_5_exposicao_pl_overlay.sql` e `20260814214500_p2_5_politica_exposicao_imutavel.sql`.
- Schema: `rlx_exposicao_execucoes`, `rlx_exposicao_overlay_itens`, índices, RLS e RPC `registrar_rlx_exposicao_execucao`.
- Domínio: `src/lib/rlx/exposicao/`.
- Actions/loaders: `src/lib/actions/conciliacao.ts` e `src/lib/rlx/conciliacao/loaders.server.ts`.
- UI: `src/app/gestor/conciliacao/`.
- Política: `src/lib/actions/politica.ts` e `src/components/politicas/PoliticasDoFundo.tsx`.
- QA: `scripts/homologacao/rlx-exposicao/` e seed Golden V2.
- Banco alterado: somente homologação `fhgkmggthxikfpogrvaa`.
- Git: alterações locais sem commit e sem push.
