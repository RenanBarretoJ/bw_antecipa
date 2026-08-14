# P2.3.1 — Golden Dataset RLX V2

Status: homologado em 14/08/2026 no projeto Supabase de homologação `fhgkmggthxikfpogrvaa`.

## 1. Objetivo

Sanear as inconsistências entre o Golden Dataset P2.1, a ingestão P2.2 e os motores P2.3 sem criar exceções por ID e sem mudar as regras de negócio `RLX_MATCH_V1` e `RLX_RECON_V1`. O resultado é o namespace independente `RLX_GOLDEN_V2`, executável pelo pipeline real e verificável por contratos declarativos independentes.

## 2. Problemas do V1

Foram confirmados três grupos de inconsistência: cenários que esperavam `SEU_NUMERO`, `COMPOSTO` ou `AMBIGUO` apesar de possuírem chave NF-e válida e única; D-1 definido por dia civil, levando movimentos para domingo; e estados de arquivo/importação tratados como se fossem resultado individual de título. Também foi identificado no parser P2.2 que campos opcionais vazios podiam receber indevidamente o UUID do fundo por fallback genérico.

## 3. Decisão de congelamento

O V1 não foi editado. Seus 37 artefatos permanecem congelados e são protegidos por teste de hash SHA-256 agregado (`7b1535954ac84fdce92b521b282717133031ca9ae1fdf708617d44cfd64050d5`). O `git diff` da pasta V1 permaneceu vazio.

## 4. Arquitetura V2

```text
scenario-definitions.mjs
  ├─ dados operacionais determinísticos
  ├─ fixtures CSV
  └─ expected contracts independentes
          ↓
pipeline real P2.2
          ↓
canon financeiro publicado
          ↓
processor real P2.3
  ├─ RLX_MATCH_V1
  └─ RLX_RECON_V1
          ↓
execuções/resultados persistidos
          ↓
verify expected × actual
```

O gerador dos expected não importa `matching.ts`, `reconciliation.ts` nem `processor.server.ts`; portanto, não usa a implementação testada como oráculo.

## 5. Datas operacionais

Base date: `2026-08-10`. Timezone: `America/Sao_Paulo`.

| Marco | Data |
|---|---|
| D-4 | 04/08/2026 |
| D-3 | 05/08/2026 |
| D-2 | 06/08/2026 |
| D-1 | 07/08/2026 |
| D0 | 10/08/2026 |

D-1 é sexta-feira. Há teste concreto que rejeita sábado ou domingo, além do uso do calendário operacional canônico.

## 6. Cenário declarativo

`scenario-definitions.mjs` é a fonte de verdade. IDs são derivados deterministicamente de `RLX_GOLDEN_V2 + entidade + cenário`. O dataset contém 2 fundos, 110 NFs, 10 operações D0, 110 documentos de boleto, 10 memórias financeiras, 10 entregas logísticas, 9 cenários explícitos de matching e 10 cenários-base de reconciliação.

## 7. Matching CHAVE_NFE

O caso `MATCH_CHAVE` possui chave de 44 dígitos, uma única candidata no mesmo fundo e resulta em `MATCH_FORTE / CHAVE_NFE`. Evidências inferiores não substituem a chave.

## 8. Matching SEU_NUMERO

`MATCH_SEU_NUMERO` não possui chave utilizável e possui crosswalk único por fundo/provedor/SEU_NUMERO. O resultado real foi `MATCH_FORTE / SEU_NUMERO`.

## 9. ID_RECEBIVEL

`MATCH_PROPAGACAO` começa no estoque por evidência forte e propaga a associação para aquisição e liquidação por `ID_RECEBIVEL`. O ID `900719925474099312345` excede `Number.MAX_SAFE_INTEGER` e permanece textual de ponta a ponta.

## 10. Composto

`MATCH_COMPOSTO` não possui chave, SEU_NUMERO utilizável ou associação prévia de ID. Fundo, cedente, sacado, documento, vencimento e valor produzem uma candidata. A primeira execução usa `COMPOSTO`; a execução posterior pode usar o crosswalk determinístico criado pelo próprio processamento.

## 11. Ambíguo

`MATCH_AMBIGUO` possui duas NFs indistinguíveis pela composição disponível, sem chave superior. O resultado é `AMBIGUO`, com duas candidatas e sem vínculo automático.

## 12. Não conciliado

`MATCH_NAO_CONCILIADO` é um registro externo do fundo principal sem NF correspondente. Ele está materializado no CSV D-1 e no expected, resulta em zero candidatas e `NAO_CONCILIADO`. Um teste específico impede que esse cenário volte a existir apenas no manifesto sem entrar na execução.

## 13. Cross-fund

Os fundos principal e adversarial compartilham deliberadamente `SEU_NUMERO` e `ID_RECEBIVEL`, mas são processados separadamente. Nenhum vínculo cross-fund foi criado. O fundo adversarial produziu uma execução própria com um resultado.

## 14. Conciliação

O contrato cobre `MANTIDO_CORRETO`, `ENTRADA_INCORPORADA`, `ENTRADA_NAO_INCORPORADA`, `ENTRADA_SEM_AQUISICAO`, `SAIDA_REFLETIDA`, `SAIDA_SEM_LIQUIDACAO`, `LIQUIDADO_AINDA_NO_ESTOQUE`, `LIQUIDACAO_PARCIAL_SALDO`, `LIQUIDACAO_REPETIDA_MESMO_DIA` e `DIVERGENCIA_VALOR`. D-2, movimentos D-1 e estoque D-1 usam datas operacionais coerentes.

## 15. Parcialidade

O caso de liquidação parcial preserva o título no estoque e registra o valor pago como evidência. O dataset não promove o saldo calculado a regra jurídica ou contábil oficial além da semântica já suportada por `RLX_RECON_V1`.

## 16. Divergência

`RECON_DIVERGENCIA_VALOR` usa valores deliberadamente distintos entre bases. A diferença é comparada como decimal e resulta em `DIVERGENCIA_VALOR`.

## 17. Completo vazio

Aquisições e liquidações de D-4, D-3 e D-2 são publicadas como `COMPLETO_VAZIO`. Nenhum expected por título afirma movimento nessas bases. O estado pertence ao lifecycle da importação.

## 18. Eventos por título

Expected de título contém somente identidade, método, candidata/NF, status de matching e estados temporais de reconciliação. Hash duplicado, retificação e completo vazio não aparecem como status de título.

## 19. Eventos de execução

`expected-executions.json` separa fase A (revisões 1) e fase B (revisões 2), exige imutabilidade da fase A e uso das importações vigentes na fase B.

## 20. Eventos de importação

`expected-import-lifecycle.json` descreve reutilização por hash, retificações de estoque/aquisições e bases completas vazias. Esses eventos são validados no P2.2, fora do classificador por título.

## 21. Retificação

Foram executadas as fases antes e depois da publicação de estoque D-1 V2 e aquisições D-1 V2. A fase inicial permaneceu histórica; a fase B recebeu novos inputs e novas assinaturas. A execução inicial de matching teve assinatura `a3badc…709`, e a vigente após retificação `2e99c5…93b4`.

## 22. Expected contracts

Foram gerados 29 arquivos, incluindo:

- `expected-matching.json`;
- `expected-reconciliation.json`;
- `expected-executions.json`;
- `expected-import-lifecycle.json`;
- `expected-logistics.json` (descritivo para P2.4);
- `expected-exposure.json` (descritivo, sem decisão de 40%);
- `manifest.json` com hashes e volumes.

## 23. P2.2

Todos os CSVs foram ingeridos pelo pipeline real P2.2: arquivo, raw/parser, staging e publicação. Não houve insert direto nas tabelas financeiras canônicas. O parser foi corrigido para manter campos opcionais vazios em vez de preenchê-los com `fundo_id`. Hash duplicado reutilizou a importação existente; bigints foram preservados como texto; as revisões vigentes foram selecionadas corretamente.

## 24. P2.3

Matching e reconciliação nasceram exclusivamente do processor real. Foi corrigido um bug de implementação que contrariava a precedência já aprovada: crosswalk não manual era consultado antes de `CHAVE_NFE`. A ordem passou a respeitar `MANUAL_ATIVO → CHAVE_NFE → SEU_NUMERO → propagação → COMPOSTO`. Também foi removida a contaminação do status por título com estados de retificação/importação. As versões das regras permanecem `RLX_MATCH_V1` e `RLX_RECON_V1`.

## 25. Expected × actual

O verificador final aprovou `384/384` verificações. Matching, candidatos, NF vinculada, método, reconciliação, inputs, histórico, import lifecycle e seed operacional coincidiram integralmente com os contratos. A mensagem “cobertura esperada 100%” do verificador significa conformidade expected × actual, não a proporção de títulos automaticamente casados.

Agregado independente do estoque D-1:

| Métrica | Quantidade/valor |
|---|---:|
| Estoque | 15 / R$ 1.169.452,36 |
| Matched | 12 / R$ 147.803,45 |
| Ambíguo | 1 / R$ 10.687,05 |
| Não conciliado | 1 / R$ 999.999,99 |
| Conflito | 1 / R$ 10.961,87 |
| Cobertura por quantidade | 80% |
| Cobertura por valor | 12,6387% |

O valor alto do caso não conciliado é proposital para provar que cobertura por quantidade e por valor são métricas distintas.

## 26. Idempotência

O E2E foi executado duas vezes sem cleanup entre elas. Na segunda execução, arquivos foram reconhecidos como duplicados/reutilizados, e as execuções finais mantiveram os mesmos IDs e assinaturas (`24` resultados de matching principal, `1` adversarial e `18` de reconciliação), sem duplicação desnecessária.

## 27. UI

A massa real e as execuções persistidas foram mantidas em homologação para `/gestor/conciliacao`. O vínculo opcional `RLX_GOLDEN_V2_GESTOR_EMAIL` não estava configurado; portanto, não foi feita validação visual autenticada das quatro tabs nesta execução. Não foram criados mocks de UI.

## 28. Segurança

O verificador V2 aprovou 5/5 verificações de RLS, policies por fundo, isolamento cross-fund e negação ao cedente. A matriz transacional completa P2.3 aprovou 22 verificações: gestor principal, gestor de outro fundo, Super Admin puro, híbrido, cedente, consultor, sacado, anon, escrita direta, RPC interna, match manual cross-fund e exigência de TOTP. Todas as mutações da matriz foram revertidas.

## 29. Limitações

- A logística é apenas contrato descritivo para P2.4 e não interfere no P2.3.1.
- Exposição de 25%, 37%, 39,8%, 40% e 42% é descritiva; não existe regra decisória de 40%.
- O smoke visual autenticado depende de um gestor QA informado explicitamente.
- Match manual não foi usado para fazer o golden passar; os casos ambíguo e não conciliado permanecem disponíveis para smoke manual futuro.

## 30. Riscos

- Alterações futuras no calendário, parser, precedência, RLS ou contratos financeiros devem executar o E2E V2 para detectar regressão.
- A baixa cobertura por valor é intencional e não representa a qualidade de uma carteira real.
- O dataset está em homologação; executar cleanup remove somente o namespace V2, mas deve continuar exigindo project ref e confirmação fechada.

## 31. Próximos passos

O próximo passo permitido após aceite separado é o P2.4, que poderá consumir o contrato logístico já reservado. Antes disso, recomenda-se executar o smoke visual com um gestor QA vinculado e, opcionalmente, os fluxos manuais de confirmar/revogar match com TOTP. P2.4 e P2.5 não foram iniciados.

## 32. Parecer

O `RLX_GOLDEN_V2` está apto como baseline de regressão do P2.2/P2.3. O V1 continua congelado, os oráculos são independentes, o pipeline real foi exercitado em homologação, os resultados foram persistidos, retificação e idempotência foram comprovadas e o isolamento multifundo passou na matriz de segurança. Não foi necessária nem criada migration para o P2.3.1. Nenhum dado de produção foi alterado.

## Execução operacional

Os comandos, proteções e confirmações estão documentados em `scripts/homologacao/rlx-golden-v2/README.md`. O estado final mantém a massa V2 em homologação para QA; o cleanup real não foi executado ao final.
