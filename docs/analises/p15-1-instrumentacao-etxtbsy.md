# P15.1 — instrumentação do pipeline documental

Data: 28/09/2026. Escopo: observabilidade e mensagem HTTP sanitizada. **Não é a correção do ETXTBSY.**

## Base e alteração

Base de produção e `origin/main` revalidados em `09313aadc6a9c20b6b124e7836baab8ec5f15019`, deployment `dpl_88YygW595cxZNQE3rvdobyJJduur`, Node 24.x. Branch isolada: `hotfix/p15-1-document-generation-instrumentation`. O checkout original e as frentes C2.1-R2, C5-R2, CERC, RLX Email e C1.1 foram preservados.

- [pdf-telemetry.ts](../../src/lib/pdf/pdf-telemetry.ts): eventos JSON, correlation ID por geração, runtime instance ID module-level, PID, ambiente, resolução/launch em andamento, duração, path resolvido e `stat` somente leitura.
- [gerarContrato.ts](../../src/lib/pdf/gerarContrato.ts): instrumentação do helper compartilhado pelos quatro geradores, incluindo upload e registro. As chamadas de persistência permanecem iguais, envolvidas apenas por medição/logging.
- Quatro rotas `src/app/api/contratos/gerar-{contrato,termo,notificacao,quitacao}/route.ts`: preservam autenticação, autorização, validação e resposta de sucesso; falha inesperada retorna HTTP 500 com mensagem genérica. A telemetria é compartilhada entre rota e gerador.
- Três arquivos de testes em `src/lib/pdf`: logger, renderer e rotas.

Não houve alteração de flags, opções de PDF, timeouts, executável, paths temporários, pacotes, lockfile, templates, migrations, banco, políticas de Storage ou regras de negócio. Não foram adicionados retry, sleep ou mutex.

## Eventos e proteção dos logs

Eventos START/SUCCESS/ERROR para RESOLVE_CHROMIUM, LAUNCH, UPLOAD, REGISTER e BROWSER_CLOSE; PAGE_CREATED, CONTENT_SET, RENDER_SUCCESS/ERROR, EXECUTABLE_STAT e REQUEST_ERROR completam o rastreamento.

O Error original é relançado. Os logs preservam campos técnicos permitidos (`code`, `errno`, `syscall`, `path`, stack com localizações), mas mensagens livres são redigidas. `spawn ETXTBSY` é preservado. `spawnargs` preserva nomes de flags; valores e argumentos posicionais são redigidos. HTML, PDF, dados cadastrais, URLs assinadas, objetos Supabase e retorno dos geradores nunca são serializados. `CHROMIUM_BINARY_URL` aparece somente como booleano.

O caminho resolvido e o `stat` ficam associados aos eventos seguintes, inclusive se `error.path` não existir. `exists=null` significa falha de stat diferente de ENOENT; não é evidência de arquivo inexistente. Contadores são incrementados antes da chamada e decrementados em `finally`; não coordenam nem serializam trabalho. Falhas do sink não mudam o resultado da geração.

`PDF_REGISTER_SUCCESS` indica que o bloco original terminou sem lançar exceção. Não certifica atomicidade nem muda o tratamento legado de erros retornados pelo banco. A instrumentação também pode alterar timing; uma geração bem-sucedida após deploy não comprova correção.

## Validação antes do rollout

| Verificação | Resultado |
| --- | --- |
| TypeScript `npx tsc --noEmit` | PASS |
| Suíte completa `npm test -- --run` | PASS: 2.284 testes; 12 skipped; 272 arquivos aprovados |
| Testes focados + Chromium real no Windows | PASS: 27 testes, incluindo três PDFs sintéticos |
| Lint `npm run lint` | PASS: zero erros; um warning preexistente em `src/lib/actions/liquidacao.ts` |
| Build `npx next build --webpack` | PASS, com variáveis placeholder sem acesso ao banco |
| `git diff --check` | PASS |
| Helper real em Linux AL2023, Node v24.21.0, Chromium do pacote 149.0.0 | PASS: contrato e termo sintéticos, resolução, stat, launch, render e fechamento |
| Integridade dos dois PDFs Linux | PASS: pypdf em modo strict, uma página e texto esperado em cada arquivo |

O ensaio Linux utilizou `public.ecr.aws/lambda/nodejs:24`, digest `sha256:0600aa6182550144dd794ee259e8f80a05039de1c2427c8edef7375e948bbf27`, sem rede e com o código montado somente leitura. Apenas PDFs sintéticos foram escritos no diretório de saída do ensaio. O primeiro leitor de validação (`pdf-parse` legado) retornou `bad XRef entry`; um leitor independente confirmou estrutura e conteúdo. Isso não exigiu mudança na aplicação ou em suas dependências.

Artefatos de ensaio, não versionados: `rehearsal/tmp/p15-1-checks/`. O helper foi empacotado temporariamente para execução; o build de produção permanece o build normal do Next.js. Esse ensaio não equivale a uma sessão Gestor na Vercel nem valida o pack remoto configurado em produção. A imagem não recebeu secrets ou dados produtivos.

## Produção e tentativa única

Pré-checagem somente leitura inicial: operação `510582d8` aprovada, sem termo/url/data, zero registros em `documentos_gerados` e zero objetos nos caminhos conhecidos do bucket de contratos. A consulta será repetida após deploy e antes de liberar a única tentativa.

O usuário confirmou que realizará exatamente uma tentativa em sua própria sessão Gestor, após aviso. Nenhuma credencial, cookie, token ou MFA será coletado. A abertura de um browser interativo com depuração remota foi rejeitada pela revisão automática (`blocked by policy`); a tentativa será humana, e a coleta de logs permanecerá via Vercel CLI.

CI, Preview/deploy, pré-checagem final, única tentativa e coleta de logs ainda pendentes nesta revisão anterior ao rollout. Os logs da tentativa serão registrados em [p15-1-production-log-sanitized.json](p15-1-production-log-sanitized.json).

## Bloqueios remanescentes para P15.2/P15.3

O risco de duplicação concorrente de `registrarDocumentoGerado`, a falta de compensação após falha de registro e a validação explícita do output permanecem abertos. Não foram corrigidos em P15.1. Não haverá concorrência, retry ou segunda tentativa produtiva neste runbook.

Um path observado isoladamente não prova a causa. Se a tentativa falhar, coletar a evidência e parar; se funcionar, validar arquivo/metadata/Storage/auditoria e não repetir. A correção definitiva continua dependendo de reprodução causal e hardening de integridade.

## Status nesta revisão

`NOT_EXECUTED`/`UNKNOWN` representam etapas pendentes; não são PASS nem falha de teste.

```text
P15_1_DELTA_ISOLATED = YES
P15_1_NO_BUSINESS_LOGIC_CHANGE = YES
P15_1_STRUCTURED_ERROR_CAPTURE = PASS
P15_1_RESOLVED_EXECUTABLE_PATH_CAPTURED = YES (ensaio isolado)
P15_1_EXECUTABLE_STAT_CAPTURED = YES (ensaio isolado)
P15_1_RUNTIME_INSTANCE_CORRELATION = PASS
P15_1_CONCURRENCY_TELEMETRY = PASS (teste deterministico, sem concorrencia produtiva)
P15_1_UI_ERROR_SANITIZED = PASS
P15_1_INSTRUMENTATION_VERIFIED = PASS
P15_1_APP_TESTS = PASS
P15_1_CI = NOT_EXECUTED
P15_1_HOMOLOG = NOT_REPRESENTATIVE (ensaio Linux isolado realizado; fluxo autenticado cloud nao executado)
P15_1_PRODUCTION_DEPLOY = NOT_EXECUTED
P15_1_CONTROLLED_ATTEMPT_EXECUTED = NO
P15_1_CONTROLLED_ATTEMPT_RESULT = NOT_EXECUTED
P15_1_ERROR_PATH = UNKNOWN
P15_1_RESOLVED_EXECUTABLE_PATH = UNKNOWN (producao)
P15_1_ERROR_CODE = UNKNOWN
P15_1_ERROR_ERRNO = UNKNOWN
P15_1_ERROR_SYSCALL = UNKNOWN
P15_1_RESOLUTION_CONCURRENCY = UNKNOWN (producao)
P15_ROOT_CAUSE_IDENTIFIED = NO
P15_1_ROOT_CAUSE_EVIDENCE_READY = NO
P15_PRODUCTION_FIXED = NO
P15_PRODUCTION_READY = NO
C2_1_R2_CHANGED = NO
C5_R2_CHANGED = NO
CERC_CHANGED = NO
RLX_EMAIL_CHANGED = NO
```
