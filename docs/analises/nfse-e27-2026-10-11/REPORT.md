# NFS-e Nacional — E2.7

Data: 11/10/2026.

**Etapa: BLOCKED. Integração operacional: BLOCKED. E2.6: BLOCKED.**

As três correções autorizadas foram implementadas na PoC. Nenhum candidato mantido atende a todos os gates; não recomendar substituição.

## Preservação

Branch `homolog`, commit `364c5ad2db6db9134be9e08added44299fff7a87`; dois stashes intactos. 112 arquivos E1/E2, 33 arquivos E2.5 e a migration histórica conferidos por SHA-256. 146 arquivos do snapshot inicial permanecem iguais. Backups anteriores não foram sobrescritos.

## Resultados comparativos

| Engine | Vetores XML | Corpus canônico/árvore | Campos completos | Recursos |
| --- | ---: | ---: | ---: | ---: |
| saxes | 84/84 | 26/26 e 26/26 | 3276/3276 | 10/11 |
| sax | 83/84 | 26/26 e 26/26 | 3276/3276 | 11/11 |
| fast | 76/84 | 26/26 e 26/26 | 3276/3276 | 10/11 |

São os mesmos 26 XMLs da E2.5: 15 sintéticos e 11 públicos sem comprovação fiscal suficiente. 24 reconhecidos e duas rejeições de domínio preservadas em cada engine. Nenhum documento novo foi coletado. Matching de campos inclui ausência, zero, original, normalização, derivação e evidências. Não é precisão fiscal; precisão e recall fiscal continuam null.

## Correções e arquitetura

- `xml-guards.mjs`: caracteres XML 1.0, gramática/posição da declaração, unicidade e limites de atributos. Uma leitura lexical antecipada no início da tag impede que SAX acumule atributos sem limite antes dos eventos diferidos.
- `sax-tree.mjs`: bridge de infraestrutura com namespaces; rejeita antes de consolidar a árvore. Não remove ou substitui caracteres de entrada.
- `fast-tree.mjs`: configuração explícita de strings/ordem/entidades, validação sintática e resolução de namespaces no bridge. Não copia mapeamento fiscal; esse candidato ainda aceita entradas proibidas.
- O adaptador E1/E2 é reutilizado por mock exclusivo do Vitest. A aplicação nunca importa estes módulos.

## Incompatibilidades remanescentes

- SAX aceita `&AMP;`: `parseEntity` consulta a tabela também com nome em minúsculas. `strictEntities` restringe quais entidades existem, mas não corrige case sensitivity. Falha da biblioteca, reproduzida sem as barreiras E2.7.
- FXP + decoder aceita referências proibidas de controle/surrogate (removidas), overflow (mantida literal) e U+FFFE (decodificado). Desconhecidas/HTML/case incorreto permanecem literais sem rejeição. Com `onNCR=throw` todas as referências numéricas seriam bloqueadas, inclusive válidas; não é equivalência. Falhas da biblioteca/decoder e limitações de configuração.
- FXP aceita comentário contendo `--` interno: validator/parser ignoram o defeito. Reproduzido no núcleo, sem bridge E2.7.
- Ajustes internos de QA corrigidos antes da entrega: offset BOM do metadata FXP, hash de objetos sem dependência da ordem de propriedades, whitespace removido pelo SAX na declaração e contagem de atributos antes dos eventos diferidos. Não foram atribuídos a divergências fiscais.

## Recursos

Ensaio em processos novos e sequenciais, Node 22, GC exposto e loader TSX. Budgets locais: 15 s wall, 10 s CPU, 512 MiB RSS, 256 MiB old-space. Watchdog amostra RSS/CPU a cada 50 ms e encerra o filho quando excede orçamento. Esses números são limites de QA, não SLOs de produção.

| Engine | Carga | Mediana ms | Pico RSS MiB | Resultado |
| --- | --- | ---: | ---: | --- |
| saxes | document | 2.154 | 83.0 | PASS |
| saxes | nodes | N/A | 141.8 | QA_BUDGET_TERMINATION |
| saxes | large-text | 919.851 | 91.5 | PASS |
| saxes | depth | 1.150 | 72.9 | PASS |
| saxes | depth-over | 4.875 | 74.9 | PASS |
| saxes | nodes-over | 216.455 | 120.4 | PASS |
| saxes | attributes-over | 6.541 | 74.1 | PASS |
| saxes | bytes-over | 13.669 | 93.4 | PASS |
| saxes | attack-depth | 4.213 | 74.8 | PASS |
| saxes | attack-nodes | 211.002 | 117.3 | PASS |
| saxes | attack-attributes | 335.768 | 109.8 | PASS |
| sax | document | 1.206 | 87.2 | PASS |
| sax | nodes | 154.198 | 151.4 | PASS |
| sax | large-text | 257.288 | 94.1 | PASS |
| sax | depth | 0.600 | 74.3 | PASS |
| sax | depth-over | 3.767 | 74.2 | PASS |
| sax | nodes-over | 251.338 | 118.9 | PASS |
| sax | attributes-over | 2.787 | 73.6 | PASS |
| sax | bytes-over | 10.113 | 93.9 | PASS |
| sax | attack-depth | 15.049 | 74.9 | PASS |
| sax | attack-nodes | 253.522 | 120.9 | PASS |
| sax | attack-attributes | 10.228 | 83.6 | PASS |
| fast | document | 0.729 | 90.6 | PASS |
| fast | nodes | 216.986 | 166.9 | PASS |
| fast | large-text | N/A | 326.6 | NODE_HEAP_EXHAUSTED |
| fast | depth | 0.709 | 75.1 | PASS |
| fast | depth-over | 5.826 | 73.9 | PASS |
| fast | nodes-over | 201.453 | 135.5 | PASS |
| fast | attributes-over | 6.001 | 74.0 | PASS |
| fast | bytes-over | 8.991 | 93.0 | PASS |
| fast | attack-depth | 89.934 | 88.9 | PASS |
| fast | attack-nodes | 768.501 | 206.2 | PASS |
| fast | attack-attributes | 576.753 | 187.9 | PASS |
| fast | native-large-text | N/A | 326.4 | NODE_HEAP_EXHAUSTED |

Tempos não incluem inicialização do loader; CPU total inclui aquecimento. RSS inclui processo/loader; sampling pode perder picos entre amostras. O processo nativo FXP também é testado separadamente com 18 MiB, sem validator ou conversão de árvore, para distinguir custo nativo de erro do bridge. Falhas de memória não foram mascaradas aumentando heap.

No ensaio principal, saxes/nodes foi encerrado ao superar o orçamento CPU total de 10 s (incluindo aquecimento e repetições). Uma única reexecução focada com os mesmos budgets passou, com mediana de 66.047 ms. O resultado principal não foi substituído; ambos estão registrados em resources.json/resources-recheck.json. A variação impede concluir um SLO estável ou atribuir a causa a contenção externa sem telemetria adicional.

## XSD e pendências documentais

Schemas oficiais intactos. Nenhuma validação XSD foi rerodada ou reinterpretada nesta etapa.

| Pacote / versão | Documentos | libxml2 PASS/REJECT | System.Xml PASS/REJECT |
| --- | ---: | ---: | ---: |
| Produção 20260209 / 1.00 | 7 | 5/2 | 5/2 |
| Produção 20260209 / 1.01 | 18 | 3/15 | 15/3 |
| Homologação 20260727 / 1.01 | 18 | 15/3 | 15/3 |

Matriz histórica: [XSD_RESULTS](../nfse-e25-2026-10-09/XSD_RESULTS.md). Produção 1.01 continua divergente em TSSerieDPS. Homologação não substitui produção. Assinatura presente, validação criptográfica, emissão e situação fiscal atual continuam estados separados. Pendências semânticas E2.5 de prestador/emissão/versão DPS não foram alteradas.

## Testes e qualidade

Testes negativos têm assertions reais e exit code não zero quando o candidato aceita documento proibido. O controle com SAX E2.5 sem correções também falha, comprovando sensibilidade da suite.

- saxes: 110 passaram, 0 falharam, 0 skips.
- sax: 109 passaram, 1 falharam, 0 skips.
- fast: 102 passaram, 8 falharam, 0 skips.
- e1_e2: 73 passaram, 0 falharam, 0 skips.
- regression_lf: 3172 passaram, 0 falharam, 10 skips.
- uncorrected_control: 59 passaram, 25 falharam, 0 skips.

Typecheck estrito E2.7, typecheck raiz sem incremental, ESLint dos MJS novos, compilação Python e diff foram executados; logs/hashes em validation.json. A regressão completa foi executada no worktree LF existente do mesmo commit; não declarar aprovação da suite completa no checkout CRLF. Build Next não foi repetido: o escopo é exclusivamente QA MJS/Python e a aplicação está intacta.

## Segurança, manutenção e recomendação

Versões fixadas: saxes 6.0.0 (raiz), sax 1.6.1, fast-xml-parser 5.11.2 e @nodable/entities 3.1.0 (QA isolado). Saxes permanece arquivado; sax e FXP têm manutenção recente. Fontes e advisories consultados em maintenance.json; ausência de advisory/audit não garante rejeição segura, como os testes demonstraram.

Referências normativas: [XML 1.0](https://www.w3.org/TR/REC-xml/) e [unicidade de atributos com namespace](https://www.w3.org/TR/REC-xml-names/#uniqAttrs). Fontes dos projetos: [sax](https://github.com/isaacs/sax-js), [saxes arquivado](https://github.com/lddubeau/saxes), [release FXP 5.11.2](https://github.com/NaturalIntelligence/fast-xml-parser/releases/tag/v5.11.2) e [advisories FXP](https://github.com/NaturalIntelligence/fast-xml-parser/security/advisories).

Manter saxes como referência isolada de E1/E2 e bloquear troca. Próximas alternativas, sujeitas a nova autorização: corrigir a resolução case-sensitive de SAX (idealmente upstream), ou avaliar outro parser estrito mantido. Para FXP, uma barreira lexical completa/validator adicional e investigação de memória seriam necessárias; não presumir que ajustes de configuração resolveriam todos os defeitos.

Nenhuma integração operacional, E3, banco, persistência, migration, alteração financeira, deploy, commit ou push.

## Arquivos e evidências

Código: `scripts/qa/nfse-national/e27/`; pacote e lock isolados. Relatórios: este diretório, matriz XML, security.json, benchmark.json, fields.csv, resources.json, native-probe.json, maintenance.json, preservation.json e validation.json. Resultados completos dos documentos permanecem somente no diretório privado E2.7. Nenhum original ou dado fiscal foi enviado a serviço de extração externo.
