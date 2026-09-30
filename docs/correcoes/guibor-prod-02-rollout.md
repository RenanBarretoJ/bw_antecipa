# GUIBOR rollout produtivo A3 a A6 R2

## Escopo e decisao

Retomada autorizada em 30/09/2026, exclusivamente para GUIBOR. O usuario
confirmou a correcao do roteiro: **A3/A4 → A5 → A6 R2 diretamente**.
A A6 original exige C5 e nao sera executada nem registrada artificialmente.
Seu arquivo permanece imutavel, para rastreabilidade e testes de integridade.
Nao usar `supabase db push` nesta release.

O usuario reconfirmou que o deploy automatico de producao da integracao
GitHub/Supabase esta desligado e assumiu o smoke autenticado somente leitura
como Gestor, Cedente e Consultor. Nao serao criadas contas, NFs ou operacoes QA
em producao, nem alteradas senhas ou configuracoes de clientes para teste.

## Baseline e isolamento

Main de partida e rollback: `8a47602965f02c8d155b14fe0b67b178e962966f`.
CI dessa baseline: `36584623719`, success. Deploy ativo conferido:
`dpl_28tvdz3KVQMTUN1aTfar1bn6cUr3`, target production, mesmo SHA/main,
`https://bw-antecipa.better-with.tech`.
Supabase confirmado: `wwsndnuvnjuabpbjwlck`, ACTIVE_HEALTHY.
Historico: 228 entradas; P14/P16/P17, C1.1, C2.1, C2/C3/C4 presentes;
GUIBOR e C5 ausentes no preflight.

A branch `release/guibor-prod-02` parte de main. Cherry-picks controlados dos
PRs #72 a #77 e do registro de certificacao A3/A4 `af96ff4`; nenhum merge de
homolog inteiro. O conflito em teste Storage foi resolvido mantendo
`requireNotaFiscalAccess`, sem copiar o helper de leitura da C5.
Os hotfixes de PDF/P15 e os demais arquivos de producao foram preservados.
Nenhum arquivo funcional de C5, RLX Email, Vortx ou CERC foi alterado.

Grafo de PRs, SHAs, arquivos de origem e classificacao do delta:
[`guibor-prod-02-manifest.json`](guibor-prod-02-manifest.json).

## Migrations exatas

| Etapa | Arquivo | SHA256 LF |
| --- | --- | --- |
| A3/A4 | 20260929154656_guibor_nfse_fiscal_provenance.sql | 6764965cb3be144ff3604f7aa294aafc62e90270a72d2a4d7104689571e31d76 |
| A3/A4 R3 | 20260929174520_guibor_nfse_review_intents.sql | 740cc2ac6f70cb2341f06853496c0394229fa0f0849518f9357204e286ba4f39 |
| A5 | 20260929191004_guibor_a5_base_antecipacao.sql | b0ee16a0179012da540956d9df4fb6f456dbf81c85015ea681ff52959148f940 |
| A6 R2 | 20260929215557_guibor_a6_decouple_c5.sql | 8c05f9c58df7bff55959c972c64268191ea010cad15a9df2bafbf18d12191d85 |

Hashes comparados com o historico real de homolog. A6 original
`20260929193129` nao integra o manifesto de execucao. A6 R2 cria a configuracao
OFF e os agregados completos com primitives C1.1; nenhum stub ou policy C5.

## Rehearsal e gates

Banco Docker isolado `guibor_prod02_certified_20260930`, somente schema.
A baseline foi reconstruida a partir do schema local e reconciliada com
3.693 objetos do catalogo atual de producao. As tres entradas antigas C2.1
nao armazenam SQL no historico: seus efeitos sao verificados pelo catalogo,
nao por um hash de conteudo inexistente. P16 e P17 tambem tiveram os hashes
comparados. Duas constraints apresentam somente agrupamento de AND diferente
no deparser do dump; sao as mesmas excecoes documentadas na certificacao R2.

Owners locais foram alinhados a producao, incluindo schema_migrations.
As falhas iniciais de preparacao/coleta local nao sao consideradas PASS.
O ensaio final usa um banco novo e a mesma transacao de aplicacao produtiva,
primeiro com ROLLBACK e depois COMMIT. Fixtures de testes usam ROLLBACK.

| Teste | Resultado local |
| --- | --- |
| TypeScript | PASS |
| Suite completa | 2505 PASS, 12 skipped |
| Build webpack | PASS |
| Lint | Sem erros; warning preexistente em liquidacao.ts |
| Envelope de historico (Vitest) | 4 PASS |
| A5 BRUTO/LIQUIDO/snapshot/P17/P14/P16 | 36 PASS |
| A6 governanca/OFF/ON/multifundo | 17 PASS |
| A6 R2 papeis e isolamento | 49 PASS |
| C1.1 sem adaptacao C5 | 8 PASS |
| C2.1 taxa e decisao do gestor | 28 PASS |
| NFS-e fatos, vencimento, auditoria e RLS | 16 PASS |
| Review receipts/CAS/duplicidade | PASS |

Parser textual/visual, reextracao e compensacao Storage sao cobertos pela
suite de aplicacao e pela certificacao remota de homolog anterior. O ensaio
atual nao simula um novo login remoto nem uma chamada real ao provedor visual.
Essas evidencias nao substituem o smoke autenticado produtivo pendente.

## Aplicacao e preservacao

`prod-02-apply.mjs` exige worktree limpa, SHA exato, CI GitHub success,
main inalterada, ensaio recente, hashes e target explicitamente conferidos.
Aplica as quatro migrations e o historico em uma unica transacao REPEATABLE
READ, com lock_timeout 5s e statement_timeout 60s. Falha em qualquer etapa
desfaz toda a cadeia. Os arquivos originais nao sao editados.

Fingerprints comparados dentro da mesma transacao incluem NFs, operacoes,
vinculos, parcelas, memorias de calculo, eventos, auditoria, politicas,
estabelecimentos, taxas, documentos, Storage e historico anterior. Somente
as colunas aditivas conhecidas sao excluidas da comparacao; seus defaults
sao verificados separadamente: fatos/snapshots NULL, BRUTO e comissao OFF.
Nao ha backfill nem reprice. RLS preexistente deve permanecer identica.

Os artefatos operacionais ficam em `rehearsal/reports/GUIBOR_PROD_02_*`,
ignorados pelo Git. Relatorios publicados nao contem PII nem credenciais.

## Rollback e observabilidade

Em incidente critico de NFS-e, desligar `NFSE_UPLOAD_ENABLED` em production
e redeploy; reverter o app ao SHA de rollback se necessario. Sem DOWN
automatico, sem apagar dados legitimos nem migrations aplicadas. Objetos
aditivos permanecem compativeis com o app anterior.

A flag sera habilitada somente apos schema e primeiro deploy compativeis,
seguida de redeploy. Janela inicial prevista: pelo menos 5 minutos apos o
deploy final, com verificacao de HTTP/CSP/rotas protegidas, Vercel e Supabase.
Ausencia de trafego nao prova execucao de parser/provedor; registrar esse limite.

## Estado antes do rollout

Preflight, grafo e delta isolado confirmados. CI da promocao, aplicacao,
deploy, flag, postflight e monitoramento ainda pendentes nesta revisao.
`GUIBOR_PRODUCTION_READY = NO` ate concluir todos os gates e o smoke autenticado.
`GUIBOR_PROD_WRITE_SMOKE = NOT_EXECUTED_SAFETY`.
