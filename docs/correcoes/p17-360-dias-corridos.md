# P17 — 360 dias corridos

## Diagnostico (29/09/2026)

`ac7f1d4d`, NF 1756: nominal 122386.47, taxa mensal 3.99, data-base
2026-09-29, vencimento 2026-11-09. O enum persistido `TRINTA_360` era
exibido como dias corridos, mas `calcularValorPresenteNota` e
`private.calcular_memoria_financeira_nf` contavam 40 dias em 30/360, enquanto
a interface exibia os 41 dias civis. VP antigo 116165.72; correto 116014.32.
A taxa implicita do VP antigo com 41 dias era aproximadamente 3.890811%.

A consulta de producao confirmou duas participacoes da NF: a operacao cancelada
`9a00842d` e a atual solicitada. Nenhuma memoria em `operacao_calculo_nfs`
para essa NF nas duas operacoes; cancelada nao reserva NF pelo predicado P16.
Nao houve contaminacao de snapshot nem outra reserva ativa.

## Correcao e limites

- `src/lib/operacoes/calculo.ts`: dias civis reais / 30, taxa mensal, Decimal e
  ROUND_HALF_UP por item. Enum e label preservados; motor v2 apenas para 360.
- Consultor/Cedente em `nova-solicitacao-client.tsx`, action de criacao e Gestor
  reutilizam esse modulo. SQL cria/aprova/simula/remove NF pela funcao canonica.
- Migration `20260929141740_p17_360_dias_corridos.sql`: substitui somente motor,
  metadados de criacao/proposta/aprovacao e adiciona reparo administrativo unitario.
- `OperacaoDetalheGestorClient.tsx`: somente solicitada/em_analise sao simuladas;
  historico usa valores persistidos. Total da previa segue o painel de decisao.
- Data-base inalterada: criacao/aprovacao usam data civil do servidor em Sao Paulo;
  previa editavel usa dataBaseServidor. Reparo preserva calculo_data_base original.
- Politica e proposta original nao sao reescritas. Nova memoria identifica v2.
  Nao existe backfill ou UPDATE financeiro em massa na migration.

## Recalculo administrativo

`private.recalcular_previa_operacao_p17(uuid,timestamptz)` e SECURITY INVOKER,
sem EXECUTE para PUBLIC/anon/authenticated/service_role; nao e exposta por API.
Requer timestamp do precheck, status editavel, ausencia de aprovacao e de reserva
ativa concorrente; trava operacao/NFs/parcelas, usa o motor canonico e preserva
nominal, taxa, data-base, politica, proposta, NFs e memorias de aprovacao.
Grava antes/depois em `OPERACAO_PREVIA_RECALCULADA_P17`, com executor DB,
usuario autenticado se houver e timestamp do log. Repeticao nao duplica audit.
Nao aprova a operacao nem libera desembolso. Nao se usa UPDATE manual do VP.

## Evidencias locais

- Vitest: 2318 PASS, 12 SKIP preexistentes; 276 arquivos PASS, 3 SKIP.
- TypeScript PASS. Lint: zero erros; aviso preexistente em liquidacao.ts.
- Build webpack PASS; diff check PASS.
- Docker descartavel: `node --import tsx rehearsal/scripts/p17-rehearsal.mjs`.
  Baseline anterior C2.1 + P16, seguido das tres migrations C2.1 e somente P17.
  `P17_BASELINE_ROOT` permite indicar o worktree baseline certificado.
- 42 pgTAP C2.1 PASS; 27 comparacoes SQL/TS de datas/taxas PASS.
- Fluxos PASS: recalc auditado/idempotente, NF intacta, proposta/politica intactas,
  NF cancelada reutilizada, reserva ativa bloqueada, gestor mantem 3.99/altera 2.35,
  replay de aprovada preservado, reparo de historico recusado.
- Concorrencia real: duas conexoes, um vencedor, um conflito, uma decisao.
- Relatorio detalhado local ignorado: `rehearsal/tmp/P17_DOCKER_REHEARSAL.json`.

## Rollout

Autorizado LOCAL → HOMOLOG → PRODUCTION; Preview nao executado por desenho.
Os resultados remotos e SHAs devem ser acrescentados apenas apos verificacao.
Producao ainda nao foi alterada nesta etapa de evidencias locais.

Rollback de dados historicos e proibido. Reversao de codigo/funcoes exige
avaliar novas memorias v2; nunca reverter valores ja aprovados. Em falha de CI,
homologacao, paridade ou status do alvo, parar antes da promocao seguinte.

P17_ROOT_CAUSE = DAY_COUNT_METHOD_MISMATCH
P17_ROOT_CAUSE_IDENTIFIED = YES
P17_CANCELLED_OPERATION_CONFLICT = NO
P17_PREVIEW = NOT_EXECUTED_BY_DESIGN
P17_MIGRATION_REQUIRED = YES
P17_PRODUCTION_READY = NO
