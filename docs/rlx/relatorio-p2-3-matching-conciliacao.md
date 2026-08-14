# P2.3 — Matching e Conciliação Financeira da RLX

## 1. Objetivo

O P2.3 transforma as bases canônicas publicadas pelo P2.2 em duas camadas auditáveis: identificação da Nota Fiscal correspondente a cada título externo e reconciliação dos movimentos financeiros entre D-2 e D-1. O escopo não altera a evidência financeira importada e não implementa logística, exposição, limite de 40% ou gates operacionais.

## 2. Arquitetura

```text
P2.2: Estoque / Aquisições / Liquidações publicadas
                         |
                         +--> P2.3A Matching --> Crosswalk título x NF
                         |
                         +--> P2.3B Reconciliação D-2/D-1
                                      |
                                      +--> resultados e exceções imutáveis
```

O processador server-side lê versões publicadas do P2.2, executa regras puras e persiste por RPC restrita a `service_role`. Gestores apenas consultam resultados do fundo ativo e resolvem matches excepcionais por RPC autorizada.

## 3. Separação entre matching e conciliação

Matching responde “qual é a NF?”. Conciliação responde “o movimento financeiro é coerente?”. Um título pode ter `MATCH_FORTE` e simultaneamente `DIVERGENCIA_VALOR`. Nenhum resultado de reconciliação pode ser editado manualmente; correções exigem novo match ou retificação P2.2 seguida de nova execução.

## 4. Crosswalk

`rlx_titulo_nf_vinculos` preserva o vínculo entre identidade financeira e NF. A origem é `AUTOMATICO` ou `MANUAL`; revogação é lógica, motivada e auditável. Não existe `DELETE` operacional.

## 5. Chaves

`rlx_titulo_nf_vinculo_chaves` armazena chaves normalizadas por `fundo_id + provedor`: `CHAVE_NFE`, `ID_RECEBIVEL`, `SEU_NUMERO`, `EXTERNAL_TITLE_KEY`, `DOCUMENTO` e `NOSSO_NUMERO`. Não há unicidade global para identificadores externos.

## 6. Regra CHAVE_NFE

Uma chave com 44 dígitos somente produz `MATCH_FORTE` quando encontra exatamente uma NF com a mesma chave no mesmo fundo. Chaves malformadas são descartadas como evidência e NFs de outro fundo nunca entram no conjunto de candidatas.

## 7. Regra SEU_NUMERO

`SEU_NUMERO` é consultado no crosswalk do mesmo fundo e provedor. Uma única NF associada permite match; zero associações continua para a próxima regra; duas ou mais NFs produzem `AMBIGUO`. O motor não presume unicidade universal nem reconstrói retrospectivamente valores CNAB sem evidência persistida.

## 8. ID_RECEBIVEL

O identificador é sempre `string`, inclusive acima do limite seguro de `Number`. Ele propaga uma associação comprovada dentro do mesmo fundo/provedor, mas não identifica uma NF isoladamente.

## 9. Match composto

`RLX_MATCH_V1` compara deterministicamente CNPJ do cedente, CNPJ do sacado, vencimento, valor Decimal exato e, quando aplicável, documento/tipo. Só uma candidata gera vínculo. Não existem fuzzy match, tolerância financeira implícita, Levenshtein, aproximação de CNPJ ou decisão por IA.

## 10. Ambiguidade

Zero candidatas gera `NAO_CONCILIADO`; duas ou mais geram `AMBIGUO`. As candidatas e evidências são persistidas em `rlx_matching_candidatos`; nenhum vínculo ativo é criado nesses casos.

## 11. Vínculo manual

Gestor vinculado ao fundo pode associar uma exceção a uma NF do mesmo fundo, com motivo e TOTP fresco. A busca de NFs é novamente limitada por fundo no servidor. A ação cria um novo vínculo manual e não modifica o registro financeiro original.

## 12. Precedência

Vínculo manual ativo prevalece. O motor automático não o sobrescreve; evidência incompatível é tratada como conflito. Revogar o vínculo mantém seu histórico e permite uma associação posterior em novo registro.

## 13. Execução de matching

`rlx_matching_execucoes` registra data, `RLX_MATCH_V1`, IDs exatos das importações, assinatura idempotente, contagens, valores de cobertura, timestamps e `correlation_id`. `rlx_matching_resultados` registra cada linha e a decisão. Lock transacional por fundo/data impede concorrência duplicada.

## 14. Reconciliação

O motor `RLX_RECON_V1` avalia a estrutura técnica:

```text
Estoque D-2 + Aquisições D-1 - Liquidações D-1 ~= Estoque D-1
```

Ela não é usada para calcular saldo contábil, baixa jurídica ou exposição.

## 15. Inputs

`rlx_conciliacao_execucoes` referencia explicitamente estoque D-2, estoque D-1, aquisições D-1, liquidações D-1 e a execução de matching aplicável. Movimento `COMPLETO_VAZIO` é um input válido e explícito; ausência não é interpretada como zero.

## 16. Status

São suportados: `MANTIDO_CORRETO`, `ENTRADA_INCORPORADA`, `ENTRADA_NAO_INCORPORADA`, `ENTRADA_SEM_AQUISICAO`, `SAIDA_REFLETIDA`, `SAIDA_NAO_REFLETIDA`, `SAIDA_SEM_LIQUIDACAO`, `LIQUIDADO_AINDA_NO_ESTOQUE`, `DIVERGENCIA_VALOR`, `NAO_CONCILIADO`, `BASE_INCOMPLETA`, `RETIFICACAO_ESTOQUE`, `RETIFICACAO_AQUISICAO`, `LIQUIDACAO_REPETIDA_MESMO_DIA`, `LIQUIDACAO_PARCIAL_SALDO`, `DIA_SEM_MOVIMENTO` e `ARQUIVO_DUPLICADO_HASH`.

## 17. Parcialidade

Todos os movimentos coexistem. O motor registra quantidade e soma Decimal de `valor_pago`, mas marca explicitamente que não calculou saldo remanescente nem concluiu encerramento de exposição.

## 18. Divergência de valor

Valores correlatos são comparados por `Decimal`/`numeric`, sem `float` e sem tolerância escondida. O detalhe preserva valores, diferença e origem; nenhum valor canônico é sobrescrito.

## 19. Base incompleta

Falta ou incompletude de qualquer uma das quatro bases gera execução `BASE_INCOMPLETA`, com a lista exata dos inputs ausentes/inválidos. Não são produzidos resultados aparentemente normais.

## 20. UI

`/gestor/conciliacao` opera no fundo ativo e reúne as tabs Visão geral, Matching, Reconciliação e Exceções. Filtros e paginação são server-side. O matching manual apresenta evidências, comparação com a NF, motivo e confirmação TOTP.

## 21. RLS

As sete tabelas têm RLS. Gestor lê somente fundos com `usuario_fundos` ativo e perfil gestor. Cedente, consultor, sacado e anônimo não recebem visão global. Super Admin puro não herda acesso operacional; perfil híbrido precisa do mesmo vínculo de fundo.

## 22. MFA

Confirmação e revogação manual reutilizam a infraestrutura de ação sensível existente, com os tipos `confirmar_match_manual` e `revogar_match_manual`. Não foi criado mecanismo MFA paralelo.

## 23. Auditoria

São registrados `MATCHING_EXECUTADO`, `MATCH_MANUAL_CONFIRMADO`, `MATCH_MANUAL_REVOGADO`, `CONCILIACAO_EXECUTADA` e `CONCILIACAO_BASE_INCOMPLETA`. A auditoria contém IDs, totais, contexto, ator e `correlation_id`, sem copiar payload financeiro integral.

## 24. Golden contracts

Os arquivos `expected-matching.json` e `expected-reconciliation.json` permaneceram inalterados. Os testes de domínio cobrem todos os métodos/statuses, cross-fund e BIGINT textual.

Foi identificada uma divergência factual no P2.1: casos esperados como `SEU_NUMERO`, `COMPOSTO` ou `AMBIGUO` ainda possuem `CHAVE_NFE` válida e única na base canônica publicada; pela precedência obrigatória, o motor deve escolher `CHAVE_NFE`. Além disso, o golden espera entradas em 2026-08-09, enquanto a aquisição publicada desse dia é `COMPLETO_VAZIO`, e associa estados de execução/importação a títulos individuais sem evidência correspondente. O verificador registra essas divergências como ressalvas, sem hardcode por ID e sem editar os expected files.

## 25. Performance

Índices cobrem fundo, execução, status, NF, provedor e chaves normalizadas. JSONB não recebeu índice genérico. A assinatura única torna reexecuções idempotentes e locks consultivos serializam fundo/data/tipo.

## 26. Migration

`20260814141629_p2_3_matching_conciliacao_rlx.sql` é incremental e não altera migrations P2.2. Ela foi validada dentro de transação com rollback e aplicada somente ao projeto de homologação `fhgkmggthxikfpogrvaa`. Produção não foi acessada.

## 27. Testes

Testes unitários validam precedência, unicidade, ambiguidade, composto Decimal, BIGINT, chave malformada, cross-fund, statuses, parcialidade, alertas explícitos e base incompleta. O teste contratual impede acoplamento ao P2.2 e concessões inseguras. Verificadores adicionais:

```text
npm run homolog:rlx:conciliacao:verify -- --expected-project-ref <REF_HOMOLOG>
npm run homolog:rlx:conciliacao:verify-security -- --expected-project-ref <REF_HOMOLOG>
```

## 28. Limitações

- O catálogo definitivo de tipos de liquidação não existe; `SAIDA_NAO_REFLETIDA` só pode ser emitido com evidência explícita.
- Não há fila assíncrona; o volume inicial usa processamento server-side síncrono controlado.
- O crosswalk retrospectivo por `SEU_NUMERO` depende de evidência persistida; não é inferido.
- A inconsistência dos golden files impede afirmar equivalência caso a caso sem corrigir a massa/contrato P2.1.

## 29. Riscos

- Classificações de saída continuam técnicas, não jurídicas.
- Uma taxonomia futura de movimentos pode exigir `RLX_RECON_V2`.
- O smoke manual com sessão real, TOTP e fundo QA deve ser executado após a massa estar disponível.
- Alterar a prioridade de evidências exige nova versão de regra, nunca atualização silenciosa do histórico.

## 30. Próximos passos

Primeiro reconciliar o gerador P2.1 com as evidências publicadas e regenerar os expected por processo formal, preservando versionamento. Depois, P2.4 poderá sobrepor logística à NF e P2.5 poderá calcular exposição usando PL D-2, sem incorporar essas regras ao P2.3.

## 31. Parecer

A arquitetura P2.3 está separada, multifundo, versionada e auditável. Matching e reconciliação não mutam P2.2; vínculos manuais são protegidos por autorização de fundo e MFA; resultados históricos são imutáveis. O motor está tecnicamente apto para homologação, mas o aceite integral dos golden contracts depende da correção formal das inconsistências do dataset P2.1, não de exceções no código.
