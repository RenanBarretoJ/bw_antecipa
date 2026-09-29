# GUIBOR-01 — entrega local A1/A2 (parcial)

Data: 2026-09-29. Branch: `feature/guibor-nfse-base-valor-comissao`.
Base verificada por fetch: `origin/main` em `8a47602965f02c8d155b14fe0b67b178e962966f`.
P17 presente nessa base. Worktree: `bw_antecipa_guibor`.

**GUIBOR-01 ainda não está pronto para homologação nem para operação.**
Esta entrega cobre baseline, inventário de dependências e estratégia textual
isolada com testes. A nova estratégia ainda não é chamada pelo upload.
Nenhum banco, migration aplicada, ambiente remoto, política ou operação foi alterado.
Não houve push, PR, Preview ou promoção para homolog.

## Baseline anterior a qualquer alteração de parser

Arquivos localizados em `Downloads/NFSe Guibor`, com nomes sem o sufixo `(1)`.
Hashes e resultados fiscais completos estão nos artefatos locais ignorados:

- `rehearsal/reports/GUIBOR_BASELINE.json` (baseline original preservado);
- `rehearsal/reports/GUIBOR_PARSER_COMPARISON.json` (comparação reproduzível);
- `rehearsal/reports/GUIBOR_TEXT_A.json` (resultado textual da nova estratégia).

Não foram versionados PDFs, imagens, textos reais, chaves fiscais, CNPJs ou nomes
das partes das amostras. Os arquivos originais permaneceram inalterados.

| Evidência | A (CONSISA) | B (HOSPITAL VIDA) |
| --- | --- | --- |
| Caracteres retornados pelo extrator nativo | 3.580 | 2 (só whitespace) |
| Layout anterior | generic_danfe | generic_danfe |
| Número/chave/emissor/emissão anteriores | Não extraídos | Não extraídos |
| Destinatário anterior | CNPJ/nome capturados pelo fluxo genérico, sem certificação NFS-e | Não extraído |
| Competência/vencimento anteriores | Não extraídos | Não extraídos |
| Bruto/líquido anteriores | Ambos 37.376,52, incorretos para os conceitos solicitados | Ausentes |
| Confiança anterior do valor | 0,76 | Ausente |
| Gate anterior | FAIL: número, emissor, emissão e bruto | FAIL: campos críticos ausentes |
| Baseline visual remoto | Não executado | Não executado |

O pipeline anterior é executado com fallback remoto explicitamente desabilitado
na ferramenta de diagnóstico: **não** se apresenta falta de credencial local como
falha medida do serviço remoto. Por inspeção de código, o fallback atual aceita
apenas `nfe_danfe` e exige chave NF-e de 44 dígitos
(`src/lib/danfe/openai-pdf-fallback.server.ts`).

O PDF B foi renderizado localmente no Chrome com o PDF.js já instalado, e a página
foi inspecionada: NF 232, bruto 112.710,81, líquido 105.779,10, emissão/competência
15/09/2026, sem vencimento financeiro explícito. **Inspeção visual humana não é
PASS do pipeline OCR.** O golden B é texto sintético; não comprova leitura da imagem.

## Implementação entregue

- `src/lib/nfse/contracts.ts`: fatos fiscais, candidatos, confiança e provenance;
- `src/lib/nfse/danfse-v2.ts`: fingerprint estrutural e rótulos completos por seção;
- `src/lib/nfse/fixtures/danfse-v2.ts`: dois goldens sintéticos/sanitizados;
- `src/lib/nfse/danfse-v2.test.ts`: 23 casos, incluindo falhas fechadas;
- `scripts/qa/guibor/parser-baseline.ts`: execução local reproduzível sem rede.

Reutiliza `parseDanfeMoney` e `validarCNPJ`. Não modifica o parser NF-e/XML,
o fallback de visão, o upload, a engine financeira nem consumidores em produção.

O arquivo A real passa no novo gate de extração:

- NF 49, emissão 2026-09-14, competência 2026-09-09;
- bruto 39.521,98, líquido fiscal explícito 37.229,70;
- líquido com IBS/CBS 37.376,52, separado, nunca promovido a líquido canônico;
- retenções 2.292,28 e desconto incondicionado 395,22 separados;
- prestador/tomador e endereço do tomador capturados com provenance;
- vencimento ausente (`MISSING`), sem inferência;
- confiança por campo 0,96, estratégia `danfse_v2_labels`.

Valores contraditórios, formatos ambíguos, CNPJ inválido, datas inválidas, mais de
um documento/bloco ou divergência aritmética bloqueiam a revisão automática.
O líquido impresso nunca é substituído por subtração. Líquido ausente permanece
ausente; o gate de extração bruta não equivale ao futuro gate de elegibilidade LIQUIDO.

Rótulos exatos impedem a captura do campo acrescido de IBS/CBS. A leitura de um
campo não atravessa outro rótulo para buscar um valor arbitrário. A chave NFS-e é
preservada e validada quanto ao formato, **não** quanto à autenticidade fiscal nem
a um DV presumido da NF-e. Não se reutilizam offsets da chave NF-e.

Referência de formato: [NT 008 — especificação oficial do DANFSe, seção 2.1.1](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nt-008-se-cgnfse-danfse-20260505.pdf/@@download/file),
que define chave com 50 dígitos. Nenhuma regra depende de empresa, CNPJ ou fundo.

## Diagnóstico de integração — não implementar sem preservar estes contratos

### Persistência e vencimento

`supabase/migrations/002_schema_base.sql` já define `notas_fiscais.valor_liquido`
nullable e `chave_acesso` como text/unique. `data_vencimento` é NOT NULL nesse
schema-base. Isso foi diagnosticado no checkout, não consultado no banco remoto.

Hoje `src/lib/actions/nota-fiscal.ts`:

- deriva emissor de qualquer chave usando lógica NF-e no ramo PDF;
- grava `data_vencimento` ausente como a data atual;
- grava `valor_liquido` como cópia do bruto, inclusive ao revisar a NF;
- exige vencimento no cadastro/revisão (`src/lib/validations/nf.ts`).

`src/lib/nf-parser.ts` também usa líquido igual ao bruto como semântica legada.
Não se pode reinterpretar o histórico como líquido fiscal explícito, nem substituir
esse comportamento sem compatibilidade. A próxima etapa precisa discriminar
tipo/provenance fiscal, ajustar rascunhos sem vencimento e proteger todas as
mutações/revisões da NF. A fonte recomendada para estes PDFs é vencimento MANUAL
obrigatório antes da submissão/elegibilidade, auditado; hoje continua MISSING.

O dispatcher NFS-e só pode ser ligado após essa integração. Caso contrário, mesmo
uma extração correta poderia criar rascunho com valor/data errados.

### Política e snapshot

Relação canônica: `cedente_fundos`
(`20260721123935_fase2_nucleo_multifundo_politicas_snapshot.sql`).
Não há `base_valor_antecipacao` no checkout. A próxima migration deverá adicionar
BRUTO como default, controlar alteração pelo gestor autorizado e auditar.
LIQUIDO exige valor explícito positivo/provenance, sem fallback para bruto.
Congelar política e valores por NF/operação antes de usar a engine P17 existente;
não reprecificar histórico pela configuração viva.

### Comissão

Relação canônica existente: `consultor_fundos`, com `consultor_id` organizacional
(`20260925144545_c1_1_organizacao_consultora_schema.sql`).
Não há `comissao_habilitada` no checkout. Percentual legado reside em
`consultor_cedentes`, não deverá ser movido nem recalculado nesta entrega.

Inventário inicial:

- `src/app/consultor/dashboard/page.tsx`: card estimado e badge percentual na carteira;
- `src/app/consultor/relatorios/page.tsx`: título, card, seção, colunas de percentual/valor,
  totalizador e nota final;
- `src/lib/analytics/contracts.ts`: contratos com valores de comissão;
- `src/lib/analytics/loaders.server.ts`: RPCs `dashboard_consultor_resumo` e
  `relatorio_consultor_analitico` precisam respeitar o contexto organizacional/fundo.

Próxima etapa: flag default OFF por organização/fundo, governança/auditoria no servidor,
projeção segura dos dados, UI condicional sem lacunas e testes ON/OFF/roles/multifundo.
Não basta esconder o card nem testar apenas um fundo; há carteiras agregadas.

## Validação desta entrega

- Testes focados de NFS-e + PDF atual + fallback atual + XML: 53 PASS.
- Suite completa: 280 arquivos PASS, 3 SKIP; 2.382 testes PASS, 12 SKIP.
- `npx tsc --noEmit`: PASS.
- `npx next build --webpack`: PASS, 92 páginas geradas.
- `npm run lint`: PASS, zero erros e um warning legado em `liquidacao.ts` não alterado.
- `git diff --check`: PASS.
- Node local 24.19.0; projeto requer 22.x. CI/Node 22 ainda não executado nesta branch.
- Regressões MK/BahiaMed/generic/XML e batch/duplicidade/compensação: suite existente PASS;
  não equivalem a smoke autenticado remoto nem nova importação real de NFS-e.
- Nenhuma migration/RPC nova nesta etapa; RLS/roles, UI responsiva e smoke remoto não executados.

Para reproduzir, com caminhos locais fornecidos pelo operador:

```powershell
npx tsx scripts/qa/guibor/parser-baseline.ts '<PDF A>' '<PDF B>'
npx vitest run src/lib/nfse/danfse-v2.test.ts src/lib/pdf-nf-parser.test.ts src/lib/pdf-nf-parser.ai-fallback.test.ts src/lib/nf-parser.test.ts
npm test -- --run
npx tsc --noEmit
npm run lint
npx next build --webpack
git diff --check
```

## Gates GUIBOR-01

**FAIL abaixo significa requisito global ainda não satisfeito**, incluindo etapas
não implementadas/não executadas; não significa que a suite regrediu.
Localização das políticas indica o destino canônico diagnosticado, não coluna já instalada.
PASS do parser textual não equivale a upload, banco ou operação liberados.

```text
GUIBOR_SCOPE_ISOLATED = YES
GUIBOR_NFSE_BASELINE_FILE_A = FAIL
GUIBOR_NFSE_BASELINE_FILE_B = FAIL
GUIBOR_NFSE_STRATEGY = PASS
GUIBOR_NFSE_TEXT_PDF = PASS
GUIBOR_NFSE_IMAGE_PDF = FAIL
GUIBOR_NFSE_NO_CNPJ_HARDCODE = PASS
GUIBOR_VALUE_GROSS_EXTRACT = PASS
GUIBOR_VALUE_NET_EXTRACT = PASS
GUIBOR_VALUE_NET_CANONICAL_LABEL = PASS
GUIBOR_NFSE_DUE_DATE_SOURCE = MISSING
GUIBOR_BASE_POLICY_LOCATION = CEDENTE_FUNDO
GUIBOR_BASE_POLICY_DEFAULT_GROSS = FAIL
GUIBOR_BASE_POLICY_GROSS = FAIL
GUIBOR_BASE_POLICY_NET = FAIL
GUIBOR_BASE_POLICY_NET_MISSING_FAIL_CLOSED = FAIL
GUIBOR_BASE_POLICY_SNAPSHOT = FAIL
GUIBOR_COMMISSION_FLAG_LOCATION = ORG_FUNDO
GUIBOR_COMMISSION_DEFAULT_OFF = FAIL
GUIBOR_COMMISSION_OFF_ZERO_UI_REFERENCES = FAIL
GUIBOR_COMMISSION_OFF_LAYOUT_REFLOW = FAIL
GUIBOR_COMMISSION_ON_REGRESSION = FAIL
GUIBOR_COMMISSION_SECURITY = FAIL
GUIBOR_PARSER_REGRESSION_MK = PASS
GUIBOR_PARSER_REGRESSION_BAHIAMED = PASS
GUIBOR_PARSER_REGRESSION_GENERIC = PASS
GUIBOR_PARSER_REGRESSION_XML = PASS
GUIBOR_PHASE_A_READY = NO
GUIBOR_P17_BASELINE_DETECTED = YES
GUIBOR_PRICING_INTEGRATION = FAIL
GUIBOR_FEATURE_TESTS = FAIL
GUIBOR_CI = FAIL
GUIBOR_PREVIEW = NOT_EXECUTED
GUIBOR_HOMOLOG = NOT_EXECUTED
GUIBOR_HOMOLOG_CLEANUP = NOT_EXECUTED
GUIBOR_HOMOLOG_READY = NO
GUIBOR_OPERATION_READY = NO
GUIBOR_PRODUCTION_CHANGED = NO
P17_CHANGED = NO
RLX_VORTX_CHANGED = NO
CERC_CHANGED = NO
RLX_EMAIL_CHANGED = NO
```

## Próximas entregas controladas

1. Fallback visual específico/identificado para NFS-e, com teste real B e fail-closed.
2. Persistência fiscal e revisão de vencimento obrigatório; só então ligar o dispatcher.
3. Política por cedente/fundo e snapshot, integrando a mesma engine P17.
4. Comissão por organização/fundo, autorização, projeções e UI ON/OFF responsiva.
5. Rehearsal SQL/RLS, quality gates, commit/push/PR/Preview e promoção controlada
   somente GUIBOR para homolog, seguida de smoke autenticado e cleanup.

Produção segue proibida. O checkpoint A1/A2 segue a entrega por escopo pequeno de
`AGENTS.md` e `docs/development/engineering-standards.md`; não representa conclusão
da Fase A nem autorização automática para promoção de escopo incompleto.
