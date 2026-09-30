# GUIBOR A6 R2 sem dependencia de C5

## Estado

Correcao na branch `hotfix/guibor-a6-decouple-c5`, baseada em homolog
`9c7ede982504e453b35966e014cf5140fe43002d`. Producao permanece somente leitura.
Ensaio sem C5, Preview, CI e smoke autenticado homolog concluidos com cleanup.
`GUIBOR_A6_R2_HOMOLOG_READY = YES`. PR #76 integrado somente em homolog,
merge `32c44993e20e0df19f8b31d0fb203b839c0944dc`.

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
Vitest final no CI: 2504 PASS, 12 skipped; 291 arquivos PASS, 3 skipped.
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

## Certificacao remota concluida

Preview: smoke real `2778738e`, quatro sessoes Auth/TOTP AAL2, sucesso e cleanup.
Foi usado o deploy imutavel `bw-antecipa-lhfnbzmkg-renanbarretoj.vercel.app`:
`src`, configuracao Next e lockfile identicos aos da base homolog desta branch.
R2 altera SQL e testes, nao o codigo visual da aplicacao. SQL remoto: A5 36,
A6 17, novo escopo 49 e C1.1 8 PASS, com rollback. Consulta independente
posterior confirmou zero usuarios, operacoes, notas, cedentes e Storage no Preview.
O check de criacao automatica de branch Supabase foi skipped no HEAD final;
nao foi usado como prova nem confundido com o CI da aplicacao.

Homolog: somente R2 aplicada, mesmo SHA256 do Preview. Fingerprints integrais
de NFs, operacoes, vinculos, flags, historico anterior, RLS e helpers C5 identicos
antes/depois. Smoke C5 original com IDs/CNPJs sinteticos aleatorios e rollback:
`C5_R2_RLS_SMOKE_OK`, incluindo os quatro papeis, timeline, fundos, dashboard,
relatorio, negativa de escrita LEITOR, organizacao inativa e fundo revogado.

CI do [PR #76](https://github.com/RenanBarretoJ/bw_antecipa/pull/76)
PASS ([run 36638803825](https://github.com/RenanBarretoJ/bw_antecipa/actions/runs/36638803825)).
CI do merge homolog PASS
([run 36639200352](https://github.com/RenanBarretoJ/bw_antecipa/actions/runs/36639200352)).
Deploy homolog certificado:
https://bw-antecipa-6ukx2fxnx-renanbarretoj.vercel.app,
`dpl_6Hc7GbzKAVrXWQ8Y4H1ibFWjMicW`. Target homolog e CSP do Supabase
`fhgkmggthxikfpogrvaa` conferidos antes do smoke.

Smoke Auth homolog `33df37a4`: PASS.

- Quatro contas QA novas com Auth/MFA reais: Gestor, Cedente, OPERADOR e LEITOR.
  OWNER/ADMIN tambem cobertos pelos testes SQL de C1.1/escopo, sem C5, e C5.
- Gestor gravou/releu BRUTO/LIQUIDO e ON/OFF pela UI; negativas de governanca
  e de outro fundo verificadas por RPC autenticada.
- PDF B original importado: bruto 112710.81, liquido 105779.10,
  DOCUMENTO_EXPLICITO, danfse_v2_visual, vencimento manual 2026-11-13.
  Elegibilidade/aprovacao da NF foi fixture SQL QA, nao aprovacao autenticada.
  PDF A nao foi reextraido: seus valores previamente certificados foram fixture.
- Base BRUTO 100000; LIQUIDO multi-NF 143008.80; taxa livre 2.4%; Cedente
  direto recalculado no servidor; snapshot anterior permaneceu imutavel.
- Dashboard/relatorios OFF/ON/OFF, fundo ON com comissao 900 e fundo OFF
  excluido; LEITOR preservado. Larguras 390/430/820/1440/1920 light/dark sem
  overflow global. Inspecao visual mobile OFF dark e operacao Gestor confirmou
  layout; snapshot lido nos tres portais.
- Cleanup: sessoes revogadas; removidos somente 4 usuarios, 2 cedentes,
  2 fundos, 5 operacoes, 5 notas e 1 objeto Storage QA. Fixtures recriaveis;
  PDF original local preservado. MEDVALE manteve todos os hashes anteriores.
- Consulta independente final: zero entidades/residuos do manifesto QA;
  MEDVALE real presente; hash da migration R2 exato. Homolog nao esta vazio.

Advisors mantem avisos preexistentes: 17 RLS sem policy, 5 search_path,
166 RPCs publicas DEFINER executaveis e protecao de senhas vazadas desativada
em homolog. Nao se declara linter zerado nem se ampliou o escopo para trata-los.
Referencias: [RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
[search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable),
[RPC privilegiada](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[protecao de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Evidencias locais ignoradas pelo Git em `rehearsal/reports/`:
`GUIBOR_A6_R2_PRODUCTION_LIKE.json`, `GUIBOR_A6_R2_PREVIEW_SQL.json`,
`GUIBOR_A6_R2_PREVIEW_CERTIFICATION.json`, `GUIBOR_A6_R2_HOMOLOG_MIGRATION.json`,
`GUIBOR_A6_R2_HOMOLOG_C5.json`, `GUIBOR_A6_R2_HOMOLOG_CERTIFICATION.json` e
`GUIBOR_A6_R2_INDEPENDENT_CLEANUP.json`.

## Status obrigatorio e hold point

```text
GUIBOR_A6_C5_DEPENDENCY_DIAGNOSIS = COMPLETE
GUIBOR_A6_C5_FUNCTION = private.consultor_usuario_pode_visualizar_cedente(uuid,uuid)
GUIBOR_A6_C5_DEPENDENCY_TYPE = GENERIC
GUIBOR_A6_NO_C5_DEPENDENCY = PASS
GUIBOR_A6_PRODUCTION_LIKE = PASS
GUIBOR_A6_CORRECTIVE_MIGRATION = PASS
GUIBOR_A6_DEFAULT_OFF = PASS
GUIBOR_A6_GOVERNANCE = PASS
GUIBOR_A6_AUDIT = PASS
GUIBOR_A6_OFF_ZERO_REFERENCES = PASS
GUIBOR_A6_OFF_LAYOUT_REFLOW = PASS
GUIBOR_A6_ON_REGRESSION = PASS
GUIBOR_A6_MULTIFUNDO = PASS
GUIBOR_A6_BACKEND_PROJECTION = PASS
GUIBOR_A5_REGRESSION = PASS
GUIBOR_C1_1_REGRESSION = PASS
GUIBOR_A6_R2_CI = PASS
GUIBOR_A6_R2_HOMOLOG = PASS
GUIBOR_A6_R2_HOMOLOG_CLEANUP = PASS
GUIBOR_A6_R2_HOMOLOG_READY = YES
C5_R2_PRODUCTION_CHANGED = NO
GUIBOR_PRODUCTION_CHANGED = NO
RLX_EMAIL_CHANGED = NO
RLX_VORTX_CHANGED = NO
CERC_CHANGED = NO
```

Parada no hold point homolog. Consulta final somente leitura em producao:
nenhuma das cinco versoes GUIBOR registrada, historico C5 zero, helper C5 ausente.
Retomar GUIBOR-PROD-01 exige a cadeia equivalente explicitada acima; C5 continua
excluido. Nenhum rollout de producao foi executado nesta etapa.
