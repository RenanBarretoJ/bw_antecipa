# Inventario de impacto — Multi-CNPJ do Cedente

Data do diagnostico: 2026-08-18  
Ambiente consultado: homologacao (`fhgkmggthxikfpogrvaa`)  
Branch: `homolog`

## Resultado do gate

`UNRESOLVED = 0`

O diagnostico foi concluido antes da mutacao do schema. A regra sobre misturar estabelecimentos na mesma operacao permanece deliberadamente aberta e foi isolada como `FUTURE_DECISION_RULE_1`; ela nao e uma pendencia tecnica deste rollout.

## Schema e dados atuais

| Superficie | Estado anterior | Classificacao | Tratamento |
|---|---|---|---|
| `cedentes.cnpj` | Um CNPJ principal por Cedente | `COMPATIBILITY_KEEP` | Mantido como CNPJ da Matriz durante a transicao, sincronizado com o estabelecimento Matriz. |
| `cedentes` — banco/agencia/conta/tipo | Conta bancaria embutida no Cedente | `MUST_MIGRATE_NOW` | Backfill para conta principal da Matriz; colunas legadas permanecem compativeis. |
| `notas_fiscais.cnpj_emitente` | CNPJ textual, sem FK para estabelecimento | `MUST_MIGRATE_NOW` | Adicionar `estabelecimento_id`, derivado e validado no servidor/banco. |
| `operacoes` | Vinculada ao Cedente e `cedente_fundo` | `COMPATIBILITY_KEEP` | Nao adicionar estabelecimento na operacao. |
| `operacoes_nfs` | Compoe operacao com NFs | `FUTURE_DECISION_RULE_1` | Manter composicao atual e criar gate de dominio neutro, sem permitir nem proibir mistura explicitamente. |
| `documentos` cadastrais legados | Checklist do Cedente/representantes | `COMPATIBILITY_KEEP` | Mantido para onboarding da Matriz. |
| Repositorio v2 (`documentos_repositorio`, versoes e vinculos) | Repositorio canonico de arquivos | `MUST_MIGRATE_NOW` | Reutilizar; vinculos passam a aceitar contexto de estabelecimento. |
| `documento_tipos` | Catalogo controlado | `COMPATIBILITY_KEEP` | Reutilizado pelos requisitos configuraveis de estabelecimento. |
| RLS multifundo | Acesso operacional por `usuario_fundos`/`cedente_fundos` | `MUST_MIGRATE_NOW` | Novos objetos recebem RLS por dono Cedente e fundo autorizado. |
| Historico de NFs/operacoes | Registros imutaveis existentes | `HISTORICAL_ONLY` | Backfill quando houver correspondencia; suspensao nao altera historico. |

## Codigo e fluxos

| Ocorrencia | Arquivos representativos | Classificacao | Decisao |
|---|---|---|---|
| Validacao exata emitente = `cedentes.cnpj` | `src/lib/notas-fiscais/emitente-autorizado.ts`, `src/lib/actions/nota-fiscal.ts` | `MUST_MIGRATE_NOW` | Resolver estabelecimento pelo CNPJ oficial e aplicar elegibilidade efetiva. |
| Upload XML antes de Storage/INSERT | `src/lib/actions/nota-fiscal.ts` | `MUST_MIGRATE_NOW` | Preservar ordem e compensacao; incluir estabelecimento no contexto e INSERT. |
| PDF/manual preenche emitente com CNPJ principal | `src/lib/actions/nota-fiscal.ts`, `src/lib/pdf-nf-parser.ts` | `MUST_MIGRATE_NOW` | Exigir/validar estabelecimento autorizado quando o emitente for informado; fallback Matriz somente onde o fluxo legado nao possui emissor oficial. |
| Onboarding cria somente `cedentes` | `src/lib/actions/cedente.ts`, RPC `concluir_onboarding_cedente` | `MUST_MIGRATE_NOW` | Criar Matriz e conta principal atomicamente/idempotentemente. |
| Aprovacao do Cedente | `src/lib/actions/gestor.ts` | `MUST_MIGRATE_NOW` | Sincronizar aprovacao da Matriz com o onboarding inicial. |
| Cadastro e documentos atuais | `src/app/cedente/cadastro/page.tsx`, `src/lib/documentos-cadastrais/*` | `COMPATIBILITY_KEEP` | Continuam representando a Matriz; filiais usam tela e requisitos especificos. |
| Listagens usam `cedentes.cnpj` para contraparte | componentes de Cedentes, Documentos, Escrow, Consultor e relatorios | `COMPATIBILITY_KEEP` | Continuar exibindo o CNPJ principal do relacionamento; telas de NF usam emitente da NF. |
| Telas de detalhe de NF | `src/app/{cedente,gestor}/notas-fiscais/[id]` | `COMPATIBILITY_KEEP` | Ja exibem `cnpj_emitente`; adicionar referencia ao estabelecimento sem mudar a leitura historica. |
| CT-e x NF | `src/lib/logistica/validacao-cte-nfe.ts` | `COMPATIBILITY_KEEP` | Continua validando contra `notas_fiscais.cnpj_emitente`, agora pertencente ao estabelecimento. |
| Logistica central | `src/lib/logistica/central/*` | `COMPATIBILITY_KEEP` | Usa dados imutaveis da NF; nenhuma regra nova por estabelecimento. |
| Duplicatas | `src/lib/duplicatas/*` | `COMPATIBILITY_KEEP` | Documento do cedente continua vindo da NF (`cnpj_emitente`). |
| Conciliacao financeira | `src/lib/financeiro/conciliacao/*` | `COMPATIBILITY_KEEP` | Matching por CNPJ emitente continua correto e passa a distinguir filiais. |
| Risco/exposicao | `src/lib/financeiro/risco/*`, `src/lib/financeiro/exposicao/*` | `COMPATIBILITY_KEEP` | Permanecem agregados por fundo/Cedente; NF retém granularidade de estabelecimento. |
| Contratos | `src/lib/pdf/gerarContrato.ts`, templates juridicos | `FUTURE_DECISION_RULE_1` | Contraparte continua sendo o Cedente/Matriz; os CNPJs das NFs seguem disponiveis. Nao alterar clausulas sem decisao juridica. |
| CNAB 444 | `src/lib/cnab/gerarCnab444.ts`, `layouts/cnab444.ts` | `FUTURE_DECISION_RULE_1` | Layout atual serializa `cedente.cnpj`. Nao trocar por CNPJ de filial nem impor uma remessa por estabelecimento sem confirmacao do layout. |
| Portal FIDC/Sinqia | `src/lib/portal-fidc/integracao.ts`, `src/lib/financeiro/ingestao/*` | `FUTURE_DECISION_RULE_1` | Integracao usa CNPJ do fundo/configuracao. Caso provedor exija um originador por CNPJ, a decisao sera implementada no gate futuro. |
| Portal do Sacado | `src/lib/sacado/*` | `COMPATIBILITY_KEEP` | Exibe emitente por NF e nao depende de `cedentes.cnpj` para a identidade fiscal do titulo. |

## Novas superficies obrigatorias

- `cedente_estabelecimentos`: fonte canonica de Matriz/Filiais.
- `cedente_estabelecimento_contas_bancarias`: contas por estabelecimento.
- `cedente_estabelecimento_requisitos`: configuracao de checklist por estabelecimento usando `documento_tipos`.
- `documento_vinculos.estabelecimento_id`: arquivo especifico do CNPJ sem repositorio paralelo.
- `notas_fiscais.estabelecimento_id`: vinculo fiscal canonico.
- RPCs controladas para submissao/decisao/conta/requisito, sem UPDATE direto de status.
- `private.estabelecimento_pode_originar(...)`: gate canonico de origem.
- `validarComposicaoEstabelecimentosOperacao(...)`: ponto neutro para a futura Regra 1.

## Compatibilidade e fonte de verdade

1. `cedente_estabelecimentos` e a fonte de verdade dos CNPJs autorizados.
2. `cedentes.cnpj` permanece como espelho de compatibilidade da Matriz.
3. O backfill cria exatamente uma Matriz por Cedente valido e migra a conta embutida.
4. NFs existentes sao vinculadas quando o CNPJ emitente corresponde a um estabelecimento do mesmo Cedente; divergencias historicas permanecem legiveis e nao sao reescritas.
5. Filiais herdam fundos por `cedente_fundos`; nao existe `cedente_estabelecimento_fundos` nesta fase.
6. Suspender a Matriz bloqueia somente novas origens e preserva todo o historico.

## Itens deliberadamente nao implementados

- Decidir se uma operacao aceita um ou varios estabelecimentos (`FUTURE_DECISION_RULE_1`).
- Granularidade de fundo por estabelecimento.
- Mudanca juridica de contraparte em contratos.
- Mudanca posicional do CNPJ no CNAB sem confirmacao de layout.
- Override operacional para estabelecimento nao aprovado.

