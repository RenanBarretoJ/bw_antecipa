# GUIBOR A6 R2 sem dependencia de C5

## Estado

Correcao na branch `hotfix/guibor-a6-decouple-c5`, baseada em homolog
`9c7ede982504e453b35966e014cf5140fe43002d`. Producao permanece somente leitura.
O ensaio sem C5 passou. Certificacao autenticada de Preview, CI e homolog ainda
em andamento; `GUIBOR_A6_R2_HOMOLOG_READY = NO`.

## Diagnostico e solucao

A migration original A6 exige e chama
`private.consultor_usuario_pode_visualizar_cedente(uuid,uuid)`, de C5.
Os agregados INVOKER tambem dependiam das policies C5 para leitura pelo LEITOR.
Retirar apenas o guard nao corrigiria a dependencia indireta de RLS.

A nova migration `20260929215557_guibor_a6_decouple_c5.sql` usa as primitives
C1.1 `consultor_organizacao_ativa_do_usuario` e `consultor_usuario_tem_papel`.
O escopo analitico interno valida carteira, cedente, vinculo Cedente/Fundo,
autorizacao Consultoria/Fundo e fundo ativos. Cada operacao deve corresponder
ao vinculo exato autorizado, inclusive quando o mesmo cedente possui outro fundo.

As APIs publicas continuam INVOKER. Duas funcoes privadas DEFINER oferecem
somente as projecoes agregadas existentes, com identidade obrigatoria,
search_path vazio, isolamento explicito e execucao anon/service_role revogada.
O helper de escopo nao pode ser executado por authenticated.
Nao ha novos endpoints C5, policies de tabelas nem ampliacao de escrita do LEITOR.
A formula de comissao e os campos de resposta existentes foram preservados.

A migration e autocontida para A6, mas exige C1.1 e A5. Em homolog substitui as
projecoes antigas, preservando flags e auditoria; sem A6 anterior, cria a flag
default OFF e os RPCs de configuracao. Os arquivos originais A3/A4/A5/A6 nao mudam.

## Cadeia futura sem C5

Cadeia equivalente ensaiada: producao atual + A3/A4 + A5 + A6 R2.
Nao executar o A6 original nessa cadeia: seu guard C5 e imutavel e falharia.
Nao marcar artificialmente essa versao antiga como aplicada. A futura promocao
precisa selecionar explicitamente os quatro arquivos, sem push global nem merge
indiscriminado de homolog. Esta etapa nao autoriza escrita em producao.

## Ensaio Docker

Banco isolado `guibor_a6_r2_prodlike_20260929`, container local
`supabase_db_bw-antecipa-prod-rehearsal`. Somente schema, sem dados de clientes.
A baseline local C1.1 recebeu as cinco migrations C2.1/P16/P17 ja existentes
em producao. Catalogo atual de producao consultado somente leitura:
2068 colunas, 1070 constraints, 326 funcoes public/private e 229 policies
public/private/storage.

A copia antiga nao tinha oito policies Storage. Elas e a definicao de
`corrigir_duplicata` foram reconciliadas apenas no banco Docker a partir do
catalogo atual. Owners public/private foram alinhados a postgres, como na origem.
Duas constraints apresentam apenas agrupamento adicional de AND no deparser
apos dump/restore; as definicoes de producao foram relidas e reaplicadas.
O restante das diferencas finais corresponde as funcoes alteradas por A5/A6.
C5 nao existe por funcao nem por historico; nenhum stub foi criado.

Runner: `scripts/qa/guibor/a6-r2-production-like.mjs`.
Evidencia ignorada pelo Git: `rehearsal/reports/GUIBOR_A6_R2_PRODUCTION_LIKE.json`.

| Suite SQL sem C5 | Resultado |
| --- | --- |
| A5 BRUTO/LIQUIDO, snapshots, P17, P14/P16, Cedente direto | 36 PASS |
| A6 OFF/ON/OFF, governanca, auditoria, multifundo | 17 PASS |
| A6 R2 quatro papeis, revogacao, cross-org, mesmo cedente/outro fundo | 49 PASS |
| C1.1 original, sem adaptacao | 8 PASS |
| C2.1 taxa livre e validacao do gestor | 28 PASS |
| Reaplicacao R2 com flag ON e demais campos preservados | PASS |

Fixtures usam rollback. Banco isolado sem usuarios e operacoes ao final.
Vitest: 2499 PASS, 12 skipped; 290 arquivos PASS, 3 skipped.
TypeScript PASS. ESLint sem erros; um warning preexistente em liquidacao.ts.

## Preview e preservacao

Migration corretiva aplicada exclusivamente ao Preview `prnudoydwiramsxjnxzn`.
SHA256 LF: `8c05f9c58df7bff55959c972c64268191ea010cad15a9df2bafbf18d12191d85`.
Fingerprint antes/depois identico para NFs, operacoes, vinculos e flags,
historico anterior, policies e helpers C5. Nenhum estado financeiro mudou.

O teste C1.1 original passou no ambiente sem C5. No Preview, C5 ja exige
operacao_id nos eventos visiveis; a fixture original nao possuia esse vinculo.
O runner remoto acrescenta apenas uma operacao sintetica e associa os eventos.
Nao altera a policy nem os resultados esperados de autorizacao. Tentativas
intermediarias com fixture incompatível nao contam como certificacao PASS.

## Pendencias de fechamento

- Smoke Auth Preview e cleanup.
- CI/PR dedicado e promocao somente em homolog.
- Corretiva homolog com fingerprints preservados.
- Smoke Auth homolog, cinco larguras light/dark, A5 e cleanup QA/MEDVALE.
- Status obrigatorio final e hold point, sem producao.

