# GUIBOR A3/A4 R3 — certificação de persistência

Escopo autorizado em 29/09/2026: Local, Preview `prnudoydwiramsxjnxzn` e homolog após todos os gates. Produção proibida. PR #71 continua draft.

## Correções anteriores à certificação remota

- Recibo server-only de revisão: ator, cedente/vínculo/fundo, hash do PDF e fingerprint dos fatos fiscais. O cliente recebe apenas o identificador opaco junto ao resumo de revisão.
- Nova extração é comparada à primeira; divergência material bloqueia sem Storage. A primeira chamada não aceita vencimento manual para pular revisão.
- Autorização e sessão/MFA são verificadas novamente após o parser. Nenhuma escrita de NF troca o cliente autenticado por service role.
- Reserva CAS e índice único de identidade fiscal precedem Storage. `PROCESSING` e `CLEANUP_PENDING` conservam o caminho/ID reservado para reconciliação; não expiram silenciosamente.
- NF e auditoria manual continuam na mesma transação de insert/trigger A4. Provenance aponta para o recibo. Exclusão legítima de um rascunho libera a identidade, preservando o recibo.
- Quando a política exige PDF no repositório documental, somente sua cópia canônica permanece; a cópia inicial é compensada. Consulta de original resolve o hash documental pelo contexto autorizado, sem caminho fornecido pelo cliente.
- Migração nova `20260929174520`; a anterior `20260929154656` não foi editada nem reaplicada remotamente.

## Evidência local

- Node 22.23.3; 106 testes focados PASS.
- Suíte final com dois workers: 2477 PASS, 12 skipped (286 arquivos PASS, 3 skipped). Inclui 8 testes adicionais da action real para recheck, dados fiscais do cliente ignorados e compensação/cleanup pendente. TypeScript e lint PASS.
- Primeira execução paralela: asserção estática de SELECT desatualizada (corrigida mantendo autorização antes de Storage), e timeout de 5s no teste de boleto inválido; segunda suíte completa com concorrência limitada passou sem alterar o parser de boleto.
- SQL em Docker: grants/RLS, CAS, identidade entre dois recibos, bloqueio de cleanup pendente e check de conclusão PASS. Fixtures em transação com rollback.
- As duas migrações aditivas foram instaladas no banco Docker local; não houve alteração de dados operacionais. O `COMMIT` interno da migração A4 encerrou o envelope inicialmente aberto, portanto a instalação local não foi revertida. A transação de fixtures foi revertida normalmente.

## Preview remoto certificado

Código `206a4e1b4cab3fafa99c7d49be0a76b0dbb24095`; deployment imutável `https://bw-antecipa-j9xrzy8wg-renanbarretoj.vercel.app` (`dpl_4tvg8xf4aBvK4FYwHqFM9B7REx7h`). [CI/build PASS](https://github.com/RenanBarretoJ/bw_antecipa/actions/runs/36609109759).

| Caso | Revisão | Após persistir | Após reenvio |
|---|---|---|---|
| PDF A real, textual | 0 NF / 0 objeto | 1 NF / 1 objeto / 1 audit MANUAL | contagens inalteradas |
| PDF B real, visual | 0 NF / 0 objeto | 1 NF / 1 objeto / 1 audit MANUAL | contagens inalteradas |

A: número 49, bruto 39.521,98, líquido 37.229,70. B: número 232, bruto 112.710,81, líquido 105.779,10. Ambos: vencimento QA 13/11/2026, `MANUAL`, origem do líquido `DOCUMENTO_EXPLICITO`, provenance correspondente à estratégia e recibo final `COMPLETED`. O vencimento foi informado após revisão e o segundo processamento server-side confirmou o mesmo arquivo/fatos.

RLS com sessões Auth/MFA reais: cedente próprio read/write PASS e outro cedente DENIED; OWNER/ADMIN/OPERADOR próprios read/write PASS e cross-org DENIED; LEITOR write DENIED; gestor lê somente seu fundo; revogação do fundo da consultoria bloqueia escrita. Recibos inacessíveis por REST para todos esses usuários. Os papéis/vínculos QA alterados pelo teste foram restaurados antes do cleanup.

Compensação remota: documento **C sintético**, não um terceiro PDF real. Um trigger temporário limitado ao cedente/nota QA provocou erro no insert depois do upload. Resultado: 0 NF, 0 objetos, recibo `FAILED`, 0 cleanup pendente. Trigger e função temporários removidos no `finally`. A falha da própria compensação foi coberta por teste da action: mantém `CLEANUP_PENDING`, nunca declara limpeza bem-sucedida.

UI: campo vazio/obrigatório, loading, sucesso e mensagem de erro controlada. Capturas iniciais A/B pegaram a transição de 200ms da sidebar; a inspeção visual não as tomou como prova final mobile. Caso C repetiu a mesma UI em 390/430/820/1440 aguardando a sidebar estabilizar, sem repetir o parser visual. Capturas 390 e 1440 inspecionadas visualmente, sem sobreposição.

Ocorrências do harness preservadas: primeira tentativa A chegou ao review, mas a asserção tinha acentuação corrompida; 0 NF/Storage, cleanup completo antes da execução A válida. Inicialização da matriz RLS tentou inscrever outro fator a partir de AAL1; nenhum teste de permissão tinha começado. O harness passou a renovar **somente fatores das identidades QA verificadas**, e então executou a matriz com Auth/AAL2 reais. Nenhum retry do parser visual foi usado para buscar uma resposta favorável.

Migração R3 aplicada somente no Preview, uma vez, hash canônico `740cc2ac6f70cb2341f06853496c0394229fa0f0849518f9357204e286ba4f39`. Hashes de NFs/operações anteriores preservados. Advisor informa RLS sem policies na tabela de recibos: deliberado, pois `PUBLIC/anon/authenticated` não possuem grants e apenas o servidor acessa esse controle; grants e RLS conferidos remotamente.

Evidências locais (ignoradas pelo Git): `rehearsal/reports/GUIBOR_R3_{A,B,C,RLS,CLEANUP}.json` e capturas `GUIBOR_R3_C_REVIEW_*.png`. Cleanup final: 12 Auth users, 3 cedentes, 3 fundos, 2 NFs, 2 objetos Storage, memberships, recibos, profiles, MFA/sessões e audit estritamente QA removidos; verificações de resíduos = zero. Antes disso, a tentativa técnica A teve seu cleanup separado de 4 usuários/1 cedente/1 fundo, sem NF/Storage. Documentos reais de origem e evidências foram preservados.

## Homolog certificado — hold final

Pré-check somente leitura de homolog confirmou a migração A4 uma vez, hash canônico `6764965cb3be144ff3604f7aa294aafc62e90270a72d2a4d7104689571e31d76`, constraints equivalentes (`c62c506267327e76b806bf6bf3137538`) e P17 presente uma vez. Não houve reaplicação de DDL nem alteração de history em homolog nesta etapa.

O CNPJ do PDF A **já existe** em homolog: MEDVALE SERVICOS EM SAUDE LTDA, cadastro ativo vinculado ao fundo GUIBOR (e outro vínculo suspenso), sem usuário primário e sem NFs. Não é fixture criada pelo harness R3. O usuário autorizou explicitamente o acesso QA temporário. A exceção é limitada a esse ID/CNPJ em homolog: um novo usuário OPERACIONAL via `cedente_acessos`, sem alteração de `cedentes.user_id`. O runner compara hashes de cadastro, fundos, vínculos, políticas/versões, escrow, estabelecimentos, taxas e acessos originais. Cleanup específico remove apenas acesso/usuário e artefatos QA; o cleanup de fixtures descartáveis exclui expressamente esse cadastro. B continua em contexto inteiramente QA, inclusive os perfis da matriz RLS.

Promoção isolada no [PR #72](https://github.com/RenanBarretoJ/bw_antecipa/pull/72), exclusivamente para `homolog`, merge `c3523585372023f8d9836bf20251ea6166aeb546`. A base `189aa0f` (P17/Vórtx) foi preservada. Único conflito: teste estático de Storage; mantidas as autorizações de leitura/LEITOR já existentes em homolog, acrescentando as verificações NFS-e. Nenhuma alteração em preço, comissão, CERC, RLX Email ou integrações.

Deployment certificado: `https://bw-antecipa-peuh1gjwh-renanbarretoj.vercel.app`, `dpl_CDmP9p2y99APfAojXvB3HHBfc2YL`, target Vercel `homolog`; CSP confirmou somente Supabase `fhgkmggthxikfpogrvaa`. `NFSE_UPLOAD_ENABLED=true` adicionado apenas ao ambiente customizado homolog; produção continua sem essa variável. A credencial visual existente foi preservada, sem exportação ou reconfiguração.

[CI do PR PASS](https://github.com/RenanBarretoJ/bw_antecipa/actions/runs/36612951677) e [CI após merge PASS](https://github.com/RenanBarretoJ/bw_antecipa/actions/runs/36613420216): TypeScript, testes, lint e build. A integração Supabase Preview do PR foi **cancelada por limite de branches concorrentes**, não por falha de código/migração; nenhum slot foi removido, nenhuma configuração de produção alterada e nenhum novo banco foi usado. O homolog existente foi o alvo explicitamente validado.

Na base integrada: Node 22.23.3, TypeScript PASS, lint sem erros (um warning preexistente em `liquidacao.ts`), suíte completa **2476 PASS / 12 skipped, 287 arquivos PASS / 3 skipped**. A primeira invocação local da suíte usou uma opção de CLI não suportada (`--minWorkers`) e não chegou a iniciar testes; a execução corrigida (`--maxWorkers=2`) passou. Reexecução focada NFSE/DANFE/XML/batch/Storage: **200 PASS / 1 skipped**. MK, BahiaMed, generic, XML, PER_FILE e fail-closed cobertos pela suíte automatizada da base integrada; não são apresentados como novos uploads NF-e autenticados remotos.

Migração nova R3 aplicada uma vez em homolog, hash `740cc2ac6f70cb2341f06853496c0394229fa0f0849518f9357204e286ba4f39`. Hash A4 antigo preservado; NFs/operações existentes inalteradas pelo DDL. Sem `db push`, sem reaplicação A4, P17 preservado. Tabela de recibos com RLS ativa e SELECT/INSERT negados a anon/authenticated; buckets de NFs e documentos privados.

| Smoke homolog | Antes/review | Persistência | Duplicate | Cleanup |
|---|---|---|---|---|
| A real / MEDVALE, textual | 0 NF / 0 objeto | 1 NF / 1 objeto / 1 audit MANUAL | mesmas contagens | 0 NF / 0 objeto QA |
| B real, visual | 0 NF / 0 objeto | 1 NF / 1 objeto / 1 audit MANUAL | mesmas contagens | 0 NF / 0 objeto QA |

A: número 49, bruto **39.521,98**, líquido **37.229,70**. B: número 232, bruto **112.710,81**, líquido **105.779,10**. Ambos com vencimento QA **13/11/2026**, origem MANUAL, líquido DOCUMENTO_EXPLICITO e reextração do original antes da persistência. Um ciclo controlado de upload/review/persistência/reenvio por documento; sem retries para obter resposta visual favorável. Campo vazio/obrigatório, validação sem data, loading e telas 390/430/820/1440 conferidos.

RLS homolog: **32 verificações PASS**, com Auth/AAL2 reais. Cedente, OWNER, ADMIN e OPERADOR leem/escrevem somente seu contexto; LEITOR sem escrita; gestor só lê seu fundo; revogação do fundo bloqueia escrita; recibos não expostos. Downloads autenticados dos arquivos privados: próprio contexto permitido e outros cedentes/organizações/fundos negados. Papéis QA restaurados antes da limpeza.

Cleanup homolog PASS: removidos **5 Auth users**, profiles, memberships, MFA/sessões, **2 NFs**, **2 objetos Storage**, recibos e audit estritamente QA, **1 cedente e 1 fundo inteiramente QA** (caso B). O caso A teve cleanup separado: somente novo acesso OPERACIONAL/usuário e artefatos QA. Comparação de hashes comprovou MEDVALE, fundos, vínculos ativo/suspenso, políticas/versões, escrow, estabelecimentos, taxas e acessos originais preservados. Storage global retornou de 963 para 961 objetos. Originais dos PDFs, histórico de migrações e evidências preservados.

Evidências locais ignoradas pelo Git, no worktree de release: `rehearsal/reports/GUIBOR_R3_HOMOLOG_{A,B,RLS,MIGRATION,MEDVALE_CLEANUP,CLEANUP}.json` (migração: `GUIBOR_R3_HOMOLOG_MIGRATION.json`) e capturas por largura. Scripts de certificação/cleanup versionados, sem credenciais. PR #71 permanece draft; nenhum merge em `main`.

```text
GUIBOR_REVIEW_SERVER_REEXTRACTION=PASS
GUIBOR_REVIEW_CLIENT_FISCAL_DATA_IGNORED=PASS
GUIBOR_REVIEW_MANUAL_DUE_DATE=PASS
GUIBOR_REVIEW_IDEMPOTENCY=PASS
GUIBOR_NFSE_FILE_A_PERSIST=PASS
GUIBOR_NFSE_FILE_B_PERSIST=PASS
GUIBOR_A4_NET_VALUE_EXPLICIT=PASS
GUIBOR_A4_NET_VALUE_PROVENANCE=PASS
GUIBOR_A4_DUE_DATE_PROVENANCE=PASS
GUIBOR_A4_AUDIT=PASS
GUIBOR_A4_DUPLICATION=PASS
GUIBOR_A4_CROSS_STRATEGY_DUPLICATION=PASS
GUIBOR_A4_STORAGE_INTEGRITY=PASS
GUIBOR_A4_STORAGE_COMPENSATION=PASS
GUIBOR_A4_RLS_REMOTE=PASS
GUIBOR_A4_AUTH_RECHECK=PASS
GUIBOR_A4_REVIEW_UI=PASS
GUIBOR_A4_REVIEW_RESPONSIVE=PASS
GUIBOR_PARSER_REGRESSION_MK=PASS
GUIBOR_PARSER_REGRESSION_BAHIAMED=PASS
GUIBOR_PARSER_REGRESSION_GENERIC=PASS
GUIBOR_PARSER_REGRESSION_XML=PASS
GUIBOR_HISTORY_FINAL_HASH_MATCH=PASS
GUIBOR_A3_A4_CI=PASS
GUIBOR_A3_A4_PREVIEW=PASS
GUIBOR_A3_A4_HOMOLOG=PASS
GUIBOR_A3_A4_HOMOLOG_RLS=PASS
GUIBOR_A3_A4_HOMOLOG_CLEANUP=PASS
GUIBOR_A3_A4_HOMOLOG_READY=YES
GUIBOR_PRODUCTION_CHANGED=NO
P17_CHANGED=NO
RLX_VORTX_CHANGED=NO
CERC_CHANGED=NO
RLX_EMAIL_CHANGED=NO
```

Delimitação: cross-strategy/idempotência concorrente e falha da própria compensação têm prova automatizada unitária/SQL; não são apresentados como dois uploads visuais paralelos remotos. Regressões NF-e/XML são da suíte automatizada. A matriz remota e os ciclos reais acima são evidências separadas.

GUIBOR_A3_A4_HOMOLOG_READY=YES

GUIBOR_PRODUCTION_CHANGED=NO; P17_CHANGED=NO; RLX_VORTX_CHANGED=NO; CERC_CHANGED=NO; RLX_EMAIL_CHANGED=NO.
