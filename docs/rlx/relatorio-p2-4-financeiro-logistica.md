# P2.4 — Integração Financeiro × Nota Fiscal × Logística da RLX

## 1. Objetivo

O P2.4 cria uma projeção histórica e auditável que parte de cada posição do Estoque D-1 publicado, reutiliza o matching persistido pelo P2.3 e associa a Nota Fiscal ao estado logístico canônico vigente no instante da execução. O resultado responde quanto da posição está entregue, em trânsito, indeterminada ou sem associação segura com uma NF, sem iniciar o cálculo de PL ou do limite de 40%.

## 2. Arquitetura

```text
Estoque D-1 publicado (P2.2)
  → resultado de matching já persistido (P2.3)
  → Nota Fiscal BW
  → resolvedor logístico canônico
  → snapshot RLX_LOGISTICA_V1 (P2.4)
```

O processador está em `src/lib/rlx/logistica/processor.server.ts`. A coleta de evidências está em `src/lib/rlx/logistica/evidencias.server.ts` e delega a decisão ao resolvedor já utilizado pelo domínio, em `src/lib/logistica/evidencias-logisticas.ts`. Nenhuma coluna logística foi adicionada às tabelas financeiras P2.2.

## 3. Universo financeiro

O universo é exclusivamente a importação `ESTOQUE` com status `PUBLICADA`, do fundo e da data de referência informados. Todas as linhas de `rlx_estoque_posicoes` dessa importação precisam estar cobertas pela execução P2.3 escolhida. Liquidações não removem linhas por inferência; uma posição só sai quando deixa o snapshot publicado.

## 4. Matching

O P2.4 não executa nem altera matching. Ele seleciona a execução `CONCLUIDA` mais recente do mesmo fundo e data que contenha o ID da importação de estoque e exige um `rlx_matching_resultados` para cada posição. São preservados execução, resultado, status, método e vínculo manual quando existente. `RLX_MATCH_V1` e `RLX_RECON_V1` não foram modificados.

## 5. Integração com NF

Somente `MATCH_FORTE` com `nota_fiscal_id` entra como `MATCHED_FINANCEIRO_NF`. A RPC valida que a NF pertence ao mesmo fundo da posição e que o resultado de matching corresponde exatamente à posição, execução, status, método, vínculo e NF recebidos. Estados ambíguo, conflito e não conciliado não escolhem uma NF por aproximação.

## 6. Domínio logístico

A taxonomia permanece `ENTREGUE`, `EM_TRANSITO` e `INDETERMINADA`. As fontes consultadas são requisitos documentais da NF, evidências logísticas antecipadas, relações CT-e × NF, CT-es, entregas, canhotos, versões e análises documentais. O P2.4 só persiste referências e a decisão; não copia XML, PDF ou payload documental.

## 7. ENTREGUE

Comprovante de entrega/canhoto aprovado prevalece sobre qualquer CT-e e resulta em `ENTREGUE`. O snapshot registra família, documento, versão, análise e fundamento quando disponíveis.

## 8. EM_TRANSITO

Sem comprovante aprovado, a presença de CT-e/DACTE aprovado resulta em `EM_TRANSITO`. A relação N:N de `cte_notas_fiscais` é respeitada, e o resolvedor escolhe a evidência aprovada mais recente de forma determinística.

## 9. INDETERMINADA

Uma NF conhecida sem evidência aprovada suficiente recebe `INDETERMINADA`. Evidências pendentes ou rejeitadas não são promovidas a aprovadas.

## 10. Sem match

`AMBIGUO`, `CONFLITO` e `NAO_CONCILIADO` recebem `SEM_MATCH_FINANCEIRO_NF`, com `nota_fiscal_id` e status logístico nulos. Essa dimensão não é combinada com `INDETERMINADA`: a primeira significa identidade financeira não resolvida; a segunda significa NF conhecida sem evidência logística suficiente.

## 11. As-of

Cada execução registra `logistica_as_of` com o instante real de classificação. A data do estoque e o instante logístico são exibidos separadamente na interface para não sugerir que possuem a mesma data-base.

## 12. Snapshot histórico

`rlx_posicao_logistica_execucoes` e `rlx_posicao_logistica_resultados` preservam o resultado de cada combinação relevante de entradas. Triggers bloqueiam atualização ou exclusão após a finalização, impedindo que uma consulta futura reinterprete retroativamente um snapshot antigo.

## 13. Execução

A execução registra fundo, data de referência, importação de estoque, execução de matching, regra `RLX_LOGISTICA_V1`, as-of, fingerprint, assinatura, correlação, totais e valores agregados. A ação explícita “Atualizar logística” usa autorização de gestor no fundo ativo e chama o processador server-side.

## 14. Resultados

Cada posição financeira continua sendo uma linha. O resultado preserva a linhagem financeira, o matching, a NF opcional, classificação logística opcional, identificação externa, partes, vencimento, valores, qualidade do valor e referências documentais controladas.

## 15. Valor de aquisição

Todos os agregados usam somente `rlx_estoque_posicoes.valor_aquisicao`. O valor não é recalculado a partir da operação BW nem substituído pelo valor nominal. A migration incremental de precisão mantém `numeric(24,4)`, preservando a escala do canônico P2.2; a formatação em duas casas ocorre apenas na apresentação monetária.

## 16. Agregados

A execução mantém quantidades e valores para total, matched, sem match, entregue, em trânsito e indeterminada. A RPC calcula os agregados diretamente das linhas persistidas, reduzindo divergência entre detalhe e resumo.

## 17. Valores ausentes

`valor_aquisicao` nulo permanece nulo e recebe qualidade `AUSENTE`. O total soma apenas valores conhecidos; quando nenhum valor é conhecido, permanece nulo em vez de virar zero. A quantidade de posições com valor ausente é preservada separadamente.

## 18. Múltiplas posições

Duas posições apontando para a mesma NF não são deduplicadas. Cada uma conserva seu valor e recebe `nf_compartilhada_entre_posicoes = true`, expondo a anomalia `MULTIPLA_POSICAO_MESMA_NF` na aba de exceções.

## 19. Retificações

Uma nova importação publicada de Estoque possui outro `estoque_importacao_id`, produz outra assinatura e outro snapshot. O histórico anterior permanece imutável. O P2.4 não altera a regra de retificação do P2.2.

## 20. UI

A rota existente `/gestor/conciliacao` ganhou a tab `Logística`, sem novo item principal de menu. Ela apresenta seis cards de quantidade e valor, referência do estoque, as-of, regra, tabela paginada e filtros server-side por status, método, cedente, sacado, NF, número, ID do recebível e vencimento. A tab `Exceções` também inclui sem match, indeterminada, valor ausente e NF compartilhada.

## 21. RLS

As duas tabelas têm RLS habilitada. `authenticated` recebe somente `SELECT`, condicionado por `private.rlx_gestor_tem_acesso_fundo(fundo_id)`. Cedente, consultor, sacado, anônimo e Super Admin puro não ganham visão financeira global. Perfil híbrido só lê fundos com vínculo gestor ativo. Escrita e RPC são exclusivas de `service_role`.

## 22. Auditoria

A RPC registra `RLX_POSICAO_LOGISTICA_EXECUTADA`, `RLX_POSICAO_LOGISTICA_REPROCESSADA` ou `RLX_POSICAO_LOGISTICA_BASE_INCOMPLETA`, com entidade, fundo, data, regra e correlation ID. Os detalhes não incluem documentos, credenciais ou payloads sensíveis.

## 23. Performance

O carregamento de evidências é feito em lotes e mapas server-side, sem consulta por linha. Os índices cobrem fundo, execução, fontes, status, NF e filtros operacionais. O processamento inicial é síncrono e controlado; carteira grande ainda exige medição antes de definir particionamento em lotes.

## 24. Golden V2

O seed `scripts/homologacao/rlx-golden-v2/seed.mjs` passou a materializar evidências documentais canônicas aprovadas para os cenários declarados, sem alterar o expected. O cleanup remove primeiro os snapshots P2.4 e depois as evidências sintéticas, respeitando dependências.

## 25. expected-logistics

`expected-logistics.json` permanece inalterado. As dez operações D0 são usadas para verificar a ponte factual entre NF e evidência canônica, mas permanecem fora do universo P2.4, que é somente Estoque D-1. A divergência anterior foi classificada como fixture incompleta: havia status de entrega sintético, mas não a evidência aprovada consumida pelo resolvedor canônico.

## 26. Idempotência

O fingerprint SHA-256 incorpora NF, classificação e referências da evidência vencedora. A assinatura incorpora fundo, importação de estoque, execução de matching, fingerprint e versão da regra. A constraint única e o advisory lock por fundo/importação impedem duplicação concorrente; reexecução idêntica devolve a execução já persistida.

## 27. Segurança

A RPC `SECURITY DEFINER` valida chamada service-role, fundo, estoque publicado, data, matching concluído, cobertura integral, linhagem de cada resultado e pertencimento da NF ao fundo. O verificador transacional cobre gestor dos dois fundos, Super Admin puro e híbrido, cedente, consultor, sacado, anon, escrita direta, RPC e isolamento cross-fund.

## 28. Limitações

Não há PL D-2, limite de 40%, overlay intraday, posição D0, cálculo de liquidação parcial, automação por cron ou reprocessamento por evento. A UI não corrige matching nem aprova documentos; direciona para os fluxos canônicos existentes. O smoke visual autenticado depende de Gestor QA disponível.

## 29. Riscos

Os principais riscos residuais são volume de carteiras grandes no processamento síncrono, qualidade ausente de `valor_aquisicao`, matching incompleto e evidências documentais inconsistentes. Esses casos falham de forma controlada ou aparecem como exceções, sem aproximação silenciosa.

## 30. Próximos passos

O passo seguinte, fora deste escopo, poderá combinar o snapshot P2.4 com PL D-2 e operações intraday para o gate regulatório. Antes disso, deve medir tempo/memória em carteira representativa e definir a estratégia de atualização imediatamente anterior ao gate.

## 31. Parecer

O desenho mantém evidência financeira, identidade e logística como domínios separados, com uma projeção historicamente reproduzível entre eles. A arquitetura está preparada para reprocessar mudanças logísticas sem alterar P2.2/P2.3 e para servir de entrada ao P2.5, mas não deve ser interpretada como cálculo de exposição regulatória ou autorização operacional.

Evidências finais em homologação: migrations P2.4 aplicadas no projeto `fhgkmggthxikfpogrvaa`; Golden V2 aprovado em 384/384 cenários; verificador P2.4 aprovado em 13/13 checagens read-only e 100% do `expected-logistics`; segurança P2.4 aprovada em 26 checagens transacionais; P2.2 aprovado em 44 checagens; P2.3 aprovado em 28 checagens e segurança em 22; suíte Vitest aprovada em 974 testes; TypeScript, `git diff --check` e build Next.js aprovados. O smoke visual autenticado permanece como validação operacional manual porque não foi fornecida uma sessão QA reutilizável nesta execução.
