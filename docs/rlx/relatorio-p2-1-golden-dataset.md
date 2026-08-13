# P2.1 — Golden Dataset Temporal e Seeds de Homologação da RLX

> Dataset: `RLX_GOLDEN_V1`
> Data-base: `2026-08-10`
> Timezone: `America/Sao_Paulo`
> Ambiente aplicado: homologação
> Referência técnica: [diagnóstico read-only do SC1](./diagnostico-sc1-bases-financeiras.md)

## 1. Objetivo

O P2.1 cria uma massa oficial de QA sintética, determinística, temporal, auditável, idempotente e removível. Ela fornece dados operacionais no banco BW e arquivos temporais para os futuros P2.2–P2.6, sem antecipar ingestão, matching, conciliação, cálculo de exposição ou decisão de elegibilidade.

## 2. Regras atuais da RLX

A RLX opera com Nota Fiscal como ativo. O seed publica políticas com `tipo_ativo_financeiro = NOTA_FISCAL`, exige status logístico pré-cessão e mantém Boleto / Duplicata Digital como lastro obrigatório. A Duplicata Mercantil do P2.0 não foi removida nem alterada.

## 3. Uso de NF

Foram criadas 123 NFs com UUID, número, série, CNPJ, chave NF-e válida de 44 dígitos, emissão, vencimento, valor e contexto multifundo determinísticos. São 108 NFs no fundo principal e 15 no adversarial. As chaves preservam o CNPJ sintético do emitente e possuem dígito verificador válido.

## 4. Boleto como lastro

O catálogo de homologação não possuía tipo equivalente. Como o catálogo é configurável, o seed criou, sem migration, `boleto_duplicata_digital` com rótulo “Boleto / Duplicata Digital” e domínio documental `nf`. Foram materializadas 111 evidências; as ausências restantes são cenários intencionais. Há casos coerentes, divergência de valor, vencimento, sacado e beneficiário, além de pendente, rejeitado e ausente. Nenhum boleto é pagável e nenhum parser definitivo foi criado.

## 5. Fundos QA

| Fundo | Finalidade |
|---|---|
| QA RLX GOLDEN FIDC | Massa operacional e temporal principal |
| QA RLX GOLDEN ADVERSARIAL FIDC | Colisões multifundo e casos de não associação cruzada |

Os fundos possuem IDs e CNPJs sintéticos determinísticos. Nenhum fundo real ou estrutural foi reutilizado.

## 6. Timeline

| Posição | Carteira | Estoque | Aquisições | Liquidações |
|---|---|---|---|---|
| D-4 | completo | completo | `SEM_MOVIMENTO` | `SEM_MOVIMENTO` |
| D-3 | completo | completo | com movimento | com movimento |
| D-2 | completo | completo | com movimento | `SEM_MOVIMENTO` |
| D-1 | completo | completo | `SEM_MOVIMENTO` | com movimento |
| D0 | operações BW aprovadas, ausentes no estoque D-1 | — | — | — |

A timeline está registrada em `fixtures/manifest.json`; dias sem movimento possuem arquivos explícitos, não ausência silenciosa.

## 7. Carteira

`CARTEIRA_GOLDEN_V1` é um contrato canônico de QA, não um layout atribuído à Administradora. Os PLs são: D-4 R$ 48.000.000, D-3 R$ 49.200.000, D-2 R$ 50.000.000 e D-1 R$ 50.700.000. O resolvedor de PL D-2 não foi implementado.

## 8. Estoque

Cada arquivo representa snapshot completo e declara `COMPLETO_COM_DADOS`. Os campos preservam fundo, cedente, sacado, `ID_RECEBIVEL` textual, `SEU_NUMERO`, `NU_DOCUMENTO`, `CHAVE_NFE`, valores nominal/presente/aquisição/PDD e datas. D-1 contém 90 posições principais. Há ainda 12 posições no fixture adversarial. Campos SC1 omitidos estão explicitados no manifest.

## 9. Aquisições

Foram produzidos 30 movimentos em D-3/D-2, usando IDs externos como string, inclusive acima de `Number.MAX_SAFE_INTEGER`. D-1 é explicitamente `SEM_MOVIMENTO`. O arquivo retificado D-2 preserva a evidência original e altera o primeiro valor de compra em R$ 500,00.

## 10. Liquidações

Foram produzidos 24 movimentos em D-3/D-1, com códigos QA `MOV_FULL` e `MOV_PARTIAL`. D-2 é explicitamente `SEM_MOVIMENTO`. Os códigos carregam apenas `semantic_hint`; não foram convertidos em regra jurídica ou catálogo oficial.

## 11. NFs

O fundo principal contém cinco cedentes; o adversarial, dois. Há 12 sacados sintéticos compartilhados como catálogo de contrapartes. Todos os e-mails técnicos usam domínio `.invalid`. CNPJs possuem checksum válido e não reproduzem clientes reais.

## 12. Logística

As evidências inseridas produzem 49 NFs `ENTREGUE`, 49 `EM_TRANSITO` e 25 `INDETERMINADA`, aproximadamente 40/40/20. O estado é derivado de documento aprovado: comprovante aprovado prevalece; CT-e aprovado sem comprovante resulta em trânsito; evidência insuficiente, pendente ou rejeitada resulta em indeterminada. Não foi criado status paralelo.

## 13. Intraday

Existem dez operações D0 aprovadas. Todas usam NFs com evidência logística compatível com o gate pré-cessão e estão ausentes do estoque D-1. O valor de aquisição foi persistido em `operacao_calculo_nfs` e na memória da operação, calculado por `private.calcular_memoria_financeira_nf`; nenhuma coluna foi adicionada a `notas_fiscais`.

## 14. Cross-fund

Os dois fundos contêm `SEU_NUMERO = QA-000001` e `ID_RECEBIVEL = 900719925474099312345`, associados a NFs distintas. O contrato esperado exige escopo por `fundo_id + provedor`; associação entre fundos é explicitamente proibida.

## 15. Edge cases

Há fixtures com UTF-8 BOM, latin1, `;` em campo cotado, arquivo vazio, coluna extra, data impossível, decimais `1,000.00` e `1.000,00`, obrigatório vazio e header alternativo. Há também chave ausente, malformada, repetida em outro fundo, snapshot incompleto e referência duplicada por hash.

## 16. Retificação

O estoque D-1 preserva V1 e V2; V2 remove um título e altera o valor de outro. Aquisições D-2 também preservam arquivo original e retificado. Nada usa `first-write-wins` como contrato futuro.

## 17. Parcialidade

Há liquidação parcial com título ainda presente no estoque e dois movimentos do mesmo recebível, tipo e dia. O dataset demonstra a insuficiência da chave legada, mas não calcula saldo nem encerra automaticamente o título.

## 18. Matching esperado

`expected/expected-matching.json` registra, por título externo, fundo, provedor, NF esperada, método e status. Os métodos são `CHAVE_NFE`, `SEU_NUMERO`, `COMPOSTO`, `AMBIGUO` e `NAO_CONCILIADO`. É contrato futuro; nenhum matcher foi implementado.

## 19. Conciliação esperada

`expected/expected-reconciliation.json` cobre posição mantida, entradas incorporada/não incorporada/sem aquisição, saída refletida/sem liquidação, liquidado ainda no estoque, divergência de valor, base incompleta, retificações, duplicidade e parcialidade. Cada caso informa data, fundo, título externo e NF. Nenhum reconciliador foi criado.

## 20. Exposição esperada

`expected/expected-exposure.json` contém cenários descritivos de 25%, 37%, 39,8%, 40% e 42%, sem decisão booleana. Também registra os agregados do fixture: estoque D-1 por valor de aquisição, parcela em trânsito, overlay intraday em trânsito, PL D-2 e percentuais descritivos. O limiar de exatamente 40% continua aberto.

## 21. Perguntas abertas

- Qual é o layout oficial da Carteira?
- Qual é o fallback quando não existir PL D-2?
- Exatamente 40,0000% é aprovado ou bloqueado?
- Qual é o tratamento definitivo de posições não conciliadas e liquidações parciais?
- Qual é o catálogo oficial de movimentos?
- `SEU_NUMERO` e `ID_RECEBIVEL` são únicos em qual escopo externo?

Essas decisões não foram hardcoded.

## 22. Idempotência

IDs de banco, documentos, operações e eventos derivam do namespace `RLX_GOLDEN_V1`. O seed usa conflitos controlados, valida colisões externas e foi executado duas vezes com as mesmas contagens, seguido de verify aprovado. Usuários Auth existentes só são reutilizados quando possuem metadata sintético do mesmo dataset.

## 23. Cleanup

O cleanup valida nome, CNPJ e ID dos dois fundos e remove somente IDs determinísticos presentes no dataset/manifest. Não usa `LIKE`, prefixo de nome ou exclusão ampla. O dry-run encontrou exatamente 2 fundos, 123 NFs, 10 operações, 500 documentos, 7 cedentes e 12 sacados. Cleanup real não foi executado; a massa foi preservada para smoke.

## 24. Verify

O verificador abre transação `READ ONLY` e confere schema, fixtures, volumes, chaves NF-e, políticas, catálogo de boleto, ausência de Duplicatas P2.0 no seed RLX, memórias financeiras, estados logísticos, colisões multifundo, IDs grandes e hashes duplicados. Ele não executa matching ou conciliação futura.

## 25. Testes

Foram adicionados testes de determinismo, namespace, volumes, chaves NF-e, cross-fund, strings grandes, timeline, retificação, manifest, expected files, escopo do cleanup, política `NOTA_FISCAL`, ausência de Duplicata no seed e ausência de criação de tabelas financeiras.

## 26. Riscos

- Os layouts externos ainda não foram homologados pela Administradora/Sinqia.
- Metadados de boleto são sintéticos e não substituem parser bancário.
- A massa não grava arquivos no Storage; telas que exigirem bytes reais precisarão de fixtures específicas futuras.
- O usuário gestor opcional não foi vinculado porque `RLX_GOLDEN_GESTOR_EMAIL` não foi informado.
- O ambiente local executou Node 24, enquanto o projeto declara Node 22; os gates de CI/build devem continuar usando a versão do projeto.

## 27. Próximos passos

P2.2 deverá criar a ingestão financeira versionada e auditável das quatro famílias de arquivos, preservando texto/Decimal, fundo, provedor, execução, arquivo, hash, completude e retificação. P2.3 poderá então consumir os expected files para implementar matching e conciliação. P2.4–P2.6 ficam condicionados à validação dessas camadas e das perguntas abertas.

## 28. Parecer

O P2.1 entrega uma base reproduzível e isolada para evolução da RLX: NF permanece o ativo, Boleto é lastro, logística deriva de evidências, operações intraday usam o motor financeiro canônico e colisões multifundo estão representadas. O banco de homologação mantém a massa após duas execuções idempotentes e verify aprovado. Não houve migration, alteração do P2.0, tabela financeira futura, regra de 40% ou implementação antecipada do P2.2.
