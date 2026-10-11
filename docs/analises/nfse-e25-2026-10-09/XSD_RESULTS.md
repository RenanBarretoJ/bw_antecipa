# Validacao XSD individual E2.5

P = pacote oficial de producao 20260209; H = pacote oficial de homologacao 20260727. N/A = perfil nao aplicado ou versao ausente. Os schemas nao foram alterados.

| Documento | Versao | libxml P | libxml H | System.Xml P | System.Xml H | Causas registradas no libxml2 |
| --- | --- | --- | --- | --- | --- | --- |
| nfse-1-00 | 1.00 | PASS | N/A | PASS | N/A | Sem rejeicao registrada |
| nfse-1-01 | 1.01 | REJECT | PASS | PASS | PASS | serie: PRODUCTION_SERIES_PATTERN |
| cpf-liquido-zero | 1.01 | REJECT | PASS | PASS | PASS | serie: PRODUCTION_SERIES_PATTERN |
| tomador-ausente | 1.01 | REJECT | PASS | PASS | PASS | serie: PRODUCTION_SERIES_PATTERN |
| opcionais-ausentes | 1.01 | REJECT | PASS | PASS | PASS | serie: PRODUCTION_SERIES_PATTERN |
| descontos-retencoes | 1.01 | REJECT | PASS | PASS | PASS | serie: PRODUCTION_SERIES_PATTERN |
| divergencia-liquido | 1.01 | REJECT | PASS | PASS | PASS | serie: PRODUCTION_SERIES_PATTERN |
| tomador-exterior | 1.01 | REJECT | PASS | PASS | PASS | serie: PRODUCTION_SERIES_PATTERN |
| nfse-substituinte | 1.00 | PASS | N/A | PASS | N/A | Sem rejeicao registrada |
| ibscbs-sem-projecao-financeira | 1.01 | REJECT | PASS | PASS | PASS | serie: PRODUCTION_SERIES_PATTERN |
| campo-invalido | 1.01 | REJECT | REJECT | REJECT | REJECT | serie: PRODUCTION_SERIES_PATTERN; vLiq: LEXICAL_PATTERN_MISMATCH |
| dps-nao-emitida | 1.01 | REJECT | PASS | PASS | PASS | serie: PRODUCTION_SERIES_PATTERN |
| evento-cancelamento | 1.01 | PASS | PASS | PASS | PASS | Sem rejeicao registrada |
| evento-substituicao | 1.01 | PASS | PASS | PASS | PASS | Sem rejeicao registrada |
| pedido-cancelamento | 1.01 | PASS | PASS | PASS | PASS | Sem rejeicao registrada |
| nfe-poc-nfse-nacional-dps-teste.xml | 1.00 | PASS | N/A | PASS | N/A | Sem rejeicao registrada |
| andrejfg-gerador-nfse-nacional-bun-nfse-exemplo.xml | 1.00 | REJECT | N/A | REJECT | N/A | NFSe: MISSING_REQUIRED_CHILD; cStat: ORDER_OR_UNEXPECTED_ELEMENT; infNFSe: LEXICAL_PATTERN_MISMATCH |
| andrejfg-gerador-nfse-nacional-bun-nfse-fixture.xml | 1.00 | REJECT | N/A | REJECT | N/A | NFSe: MISSING_REQUIRED_CHILD; cStat: ORDER_OR_UNEXPECTED_ELEMENT; infNFSe: LEXICAL_PATTERN_MISMATCH |
| vagkaefer-nfse-nacional-dps-esperada.xml | 1.00 | PASS | N/A | PASS | N/A | Sem rejeicao registrada |
| vagkaefer-nfse-nacional-nfse-exemplo-ibscbs.xml | 1.01 | REJECT | REJECT | REJECT | REJECT | NFSe: MISSING_REQUIRED_CHILD; serie: PRODUCTION_SERIES_PATTERN |
| vagkaefer-nfse-nacional-nfse-exemplo.xml | 1.01 | REJECT | REJECT | REJECT | REJECT | NFSe: MISSING_REQUIRED_CHILD; serie: PRODUCTION_SERIES_PATTERN |
| roberto-mello-pynfse-nacional-ibscbs_minimal.xml | 1.01 | REJECT | PASS | PASS | PASS | serie: PRODUCTION_SERIES_PATTERN |
| roberto-mello-pynfse-nacional-ibscbs_with_retention.xml | 1.01 | REJECT | PASS | PASS | PASS | serie: PRODUCTION_SERIES_PATTERN |
| Engenere-BrazilFiscalReport-nfse_rtc_valid.xml | 1.01 | REJECT | PASS | PASS | PASS | serie: PRODUCTION_SERIES_PATTERN |
| Engenere-BrazilFiscalReport-nfse_test_prod.xml | ausente | N/A | N/A | N/A | N/A | XSD nao executado: versao ausente; nao foi inferida |
| joaovmgs-danfse-brasil-xml.xml | 1.00 | PASS | N/A | PASS | N/A | Sem rejeicao registrada |

As linhas e os campos por motor estao nos [resultados libxml2](xsd-libxml2.json) e [resultados System.Xml](xsd-dotnet.json). Campo e causa descrevem validacao estrutural; PASS nao comprova assinatura, emissao, atividade ou elegibilidade.
