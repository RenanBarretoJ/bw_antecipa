# P15.1 — instrumentação do pipeline documental

Data: 28/09/2026. Escopo: observabilidade e mensagem HTTP sanitizada. **Não é a correção do ETXTBSY.**

## Base e alteração

Base de produção e `origin/main` revalidados em `09313aadc6a9c20b6b124e7836baab8ec5f15019`, deployment `dpl_88YygW595cxZNQE3rvdobyJJduur`, Node 24.x informado pela configuração Vercel. A telemetria posterior revelou Node real v22.23.2 (detalhes abaixo). Branch isolada: `hotfix/p15-1-document-generation-instrumentation`. O checkout original e as frentes C2.1-R2, C5-R2, CERC, RLX Email e C1.1 foram preservados.

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

Pré-checagem somente leitura inicial: operação `510582d8` aprovada, sem termo/url/data, zero registros em `documentos_gerados` e zero objetos nos caminhos conhecidos do bucket de contratos. A consulta foi repetida após deploy e antes de liberar a única tentativa.

O usuário confirmou que realizaria exatamente uma tentativa em sua própria sessão Gestor, após aviso. Nenhuma credencial, cookie, token ou MFA foi coletado. A abertura de um browser interativo com depuração remota foi rejeitada pela revisão automática (`blocked by policy`); a tentativa foi humana, e a coleta de logs ocorreu via Vercel CLI. O agente não chamou endpoints de geração em produção.

[PR #64](https://github.com/RenanBarretoJ/bw_antecipa/pull/64) integrado no merge `83ece9c676a4f39ff130a8885847735c8b1da17d`. [CI do PR](https://github.com/RenanBarretoJ/bw_antecipa/actions/runs/36461990117) e [CI de main](https://github.com/RenanBarretoJ/bw_antecipa/actions/runs/36462533644) aprovados. Preview `dpl_5244TbNNyfpZk7QtJ4ybrzrkbYMa` READY/HTTP 200, sem branch Supabase próprio. Produção `dpl_C4Jb3Q2GVxekaJDZAWaSZieg5jUD` READY no SHA esperado; login HTTP 200 e zero 5xx na consulta anterior à tentativa. A árvore do merge é idêntica à do commit aprovado `2ea9cf2ce23f1dec2bee15bc12fb68caf2860740`.

Pré-checagem repetida às 18:07:27Z: sem termo/data, zero documentos, termos ativos e objetos nos paths conhecidos. Às 15h07 de São Paulo, o operador foi avisado para realizar exatamente uma tentativa. O usuário relatou uma tentativa com sucesso e confirmou posteriormente que o PDF abriu e estava legível. A integridade visual foi confirmada pelo operador; nenhum PDF produtivo foi baixado ou versionado pelo agente.

## Evidência capturada e parada

Os [logs sanitizados](p15-1-production-log-sanitized.json) contêm **42 eventos em três requisições distintas**, todas HTTP 200:

| Início UTC | Tipo | Request ID | Correlation ID | Resolução / launch |
| --- | --- | --- | --- | --- |
| 18:07:54.238Z | Termo | `2tdj4-1790618873118-e80d2e04337e` | `11bf4996-7d2f-45e3-bf77-d9798f016a83` | 3258,60 ms / 100,16 ms |
| 18:08:06.417Z | Notificação | `2klvc-1790618885973-cf8b9b946e3c` | `d6c3ea7c-3bc9-46e8-8672-4ee4d08675af` | 0,57 ms / 66,63 ms |
| 18:08:13.916Z | Termo | `bclzz-1790618892223-ad17a310d77b` | `ec485555-1183-4ce4-b1df-3521f1c476ed` | 4,17 ms / 116,98 ms |

Todas compartilham runtime instance ID `3a2986f3-ef42-421b-8422-539cadc2ea15`, PID 4, Linux x64, região iad1, **Node real v22.23.2** e SHA do hotfix. A configuração do painel não deve ser usada como prova da versão real do processo. O `engines.node` preservado em package.json é 22.x; nenhuma versão foi alterada pelo P15.1.

Executável resolvido real: **`/tmp/chromium`**. `stat`: exists=true, isFile=true, size=190909560, mode=33216 (tipo arquivo regular com permissões 0700), mtimeMs=1790618877495.6086. Esses valores ficaram iguais nas três chamadas. `chromiumBinaryUrlConfigured=true`; URL e conteúdo do pack não foram coletados. O binário do ensaio local tinha outro tamanho (199908472); portanto, esse ensaio não comprova equivalência do pack produtivo.

Máximo observado de `resolutionConcurrency=1` e `launchConcurrency=1`. Cada launch iniciou com `resolutionConcurrency=0`. Não houve overlap observado nem evento de erro nessas três requisições. Consequentemente, **não existe Error ETXTBSY novo para extrair code/errno/syscall/path/stack**. O caminho resolvido está comprovado; o `error.path` do incidente anterior permanece desconhecido.

**Regra de parada acionada:** foram observadas duas gerações do Termo, apesar do relato de um único clique. Não se atribui a origem das chamadas adicionais ao usuário, frontend ou retry sem evidência. A inspeção de `BotaoDownloadContrato.tsx` mostra um endpoint por chamada de `handleGerar`; a tela da operação também tem geração de Termo automática após aprovação, mas isso não prova que tal fluxo causou estas requisições. Nenhuma mudança de UI foi feita. Nenhuma nova tentativa ou reprodução concorrente foi executada após detectar a segunda geração.

Pós-checagem somente leitura:

- Termo registrado na operação, `termo_gerado_em=18:08:15.067Z`, correspondente à segunda chamada.
- Objeto de Termo criado às 18:07:58.616271Z e **atualizado às 18:08:14.961374Z**; tamanho final 189985 bytes, MIME application/pdf, apontado pela operação. É regravação do mesmo caminho legado, não dois objetos distintos.
- Notificação registrada às 18:08:07.429Z; objeto de 36811 bytes, MIME application/pdf, apontado pela operação.
- Total de objetos nos caminhos conhecidos: 2 (um Termo e uma Notificação).
- `documentos_gerados` da operação: 0. O código usa esse registro somente quando resolve template versionado; a execução observada utilizou o caminho legado, sem certificação de versionamento documental.
- `logs_auditoria` para a entidade operação desde 18:07Z: 0; `eventos_dominio` para a operação na mesma janela: 0. Nenhum registro ausente foi inventado ou inserido. A consulta não cobre eventuais registros associados a outras entidades.
- Nenhum documento foi removido, nenhum dado foi reparado e nenhum rollback foi executado.

## Bloqueios remanescentes para P15.2/P15.3

O risco de duplicação concorrente de `registrarDocumentoGerado`, a falta de compensação após falha de registro e a validação explícita do output permanecem abertos. A regravação observada no fluxo legado acrescenta evidência para o hardening. Não foram corrigidos em P15.1. O agente não disparou concorrência, retry ou segunda tentativa produtiva.

Um path observado isoladamente não prova a causa. A correção definitiva continua dependendo de reprodução causal e hardening de integridade. Os ensaios posteriores de 1/2/5/10 solicitações não foram executados: a parada por geração adicional prevaleceu. P15.2 deve primeiro esclarecer a origem das chamadas adicionais e preparar um cenário isolado com Node real e materialização equivalentes. A instrumentação permanece implantada, mas ETXTBSY não está declarado corrigido.

## Status nesta revisão

`NOT_EXECUTED`/`UNKNOWN` representam etapas pendentes; não são PASS nem falha de teste.

```text
P15_1_DELTA_ISOLATED = YES
P15_1_NO_BUSINESS_LOGIC_CHANGE = YES
P15_1_STRUCTURED_ERROR_CAPTURE = PASS
P15_1_RESOLVED_EXECUTABLE_PATH_CAPTURED = YES
P15_1_EXECUTABLE_STAT_CAPTURED = YES
P15_1_RUNTIME_INSTANCE_CORRELATION = PASS
P15_1_CONCURRENCY_TELEMETRY = PASS (teste deterministico, sem concorrencia produtiva)
P15_1_UI_ERROR_SANITIZED = PASS
P15_1_INSTRUMENTATION_VERIFIED = PASS
P15_1_APP_TESTS = PASS
P15_1_CI = PASS
P15_1_HOMOLOG = NOT_REPRESENTATIVE (ensaio Linux isolado realizado; fluxo autenticado cloud nao executado)
P15_1_PRODUCTION_DEPLOY = PASS
P15_1_CONTROLLED_ATTEMPT_EXECUTED = YES
P15_1_CONTROLLED_ATTEMPT_RESULT = PASS
P15_1_SINGLE_ATTEMPT_COMPLIANCE = NOT_CONFIRMED (duas requisicoes de Termo observadas)
P15_1_STOP_TRIGGERED = YES
P15_1_ERROR_PATH = UNKNOWN
P15_1_RESOLVED_EXECUTABLE_PATH = /tmp/chromium
P15_1_ERROR_CODE = UNKNOWN
P15_1_ERROR_ERRNO = UNKNOWN
P15_1_ERROR_SYSCALL = UNKNOWN
P15_1_RESOLUTION_CONCURRENCY = 1
P15_ROOT_CAUSE_IDENTIFIED = NO
P15_1_ROOT_CAUSE_EVIDENCE_READY = NO
P15_PRODUCTION_FIXED = NO
P15_PRODUCTION_READY = NO
C2_1_R2_CHANGED = NO
C5_R2_CHANGED = NO
CERC_CHANGED = NO
RLX_EMAIL_CHANGED = NO
```
