# RLX-EMAIL-04 — automação operacional

## Estado da execução

Implementação em validação, ainda sem certificação. `RLX_EMAIL_04_HOMOLOG_READY = NO`.
`RLX_EMAIL_PRODUCTION_CHANGED = NO`.

Base: homolog `8b5fe310529e63b6199aa3639721852303c0a8bf`.
Branch local: `feature/rlx-email04-automation`.
Nenhuma migration, variável, assinatura Graph ou tarefa agendada deste escopo foi aplicada em ambiente remoto.

Em 30/09/2026 os processos locais de TypeScript, Vitest, Git, Docker e WSL não
concluíram em tempo útil. Isso não constitui aprovação nem falha funcional comprovada.
O fallback por GitHub Actions também ficou indisponível: o conector retornou
`USER_NOT_LOGGED_IN`.

Verificação local concluída depois desse bloqueio: `git diff --check` retornou
0, apenas com avisos LF/CRLF. `git status` confirmou somente o escopo 04 neste
worktree. TypeScript e Vitest continuaram sem resultado; a autenticação pela
CLI do GitHub também não concluiu. Não houve commit/push em 30/09.

Em 01/10/2026, a CLI do GitHub voltou a autenticar e confirmou leitura/push no
repositório. TypeScript passou após ajustes de tipagem. A suíte completa passou
com 2.618 testes e 12 ignorados; os 97 testes de email-intake passaram. Lint sem
erros, com um aviso preexistente em `src/lib/actions/liquidacao.ts`. A coluna
de auditoria do SQL novo foi corrigida para `tipo_evento`; o clean-room passou
a incluir Gestor com MFA, auditoria/cooldown manual, bloqueio entre fundos,
MFA revogado e Super Admin. Docker local está desligado; a certificação de
banco/Storage será executada na branch de validação Linux, sem deploy Vercel.

Falta ainda o Object ID da mailbox de QA no Entra. A leitura de Inbox foi
autorizada pelo Graph, mas a consulta ao cadastro do usuário retornou 403.
Obter o identificador com o administrador, sem ampliar permissões da aplicação.

## Limites

Somente Local, Preview e homolog. Produção é proibida. O pipeline fiscal do 03,
suas migrations aplicadas, o ator técnico e a semântica de Storage/revisão não
são alterados. O novo transporte chama os serviços existentes.

## Fluxo proposto

1. `POST /api/email-intake/graph` responde ao desafio de validação sem banco.
   Notificações passam por limite de tamanho, mídia, clientState, tenant,
   assinatura e recurso. Somente um sinal durável é persistido; não há parser.
2. DELTA, reconciliação e assinatura compartilham uma lease por integração.
   Cada chamada de descoberta confirma uma página e seu cursor na mesma
   transação antes de liberar a lease. Replays coalescem.
3. O watchdog busca delta a cada cinco minutos, ou antes por sinal, respeitando
   Retry-After. Reconciliação diária percorre uma janela configurável de sete
   dias. Cursor de paginação é persistido entre chamadas.
4. A assinatura é renovada um dia antes de expirar. clientState fica cifrado.
   Uma assinatura remota só pode ser adotada quando recurso, callbacks e
   clientState correspondem à integração esperada.
5. Os workers de anexos TEXT e VISUAL continuam usando o pipeline certificado
   do 03. Não existe regra fiscal no webhook nem no scheduler.
6. Saúde e alertas são consultados por fundo. Sincronização manual exige papel
   Gestor/Super Admin, vínculo válido e sessão MFA/TOTP vigente no servidor e
   na RPC. A ação apenas sinaliza trabalho.

## Saúde e alertas

Estados: HEALTHY, DEGRADED, ERROR e DISABLED. Limiares iniciais: sincronização
ou pendência acima de quinze minutos, assinatura ausente/crítica, autenticação,
throttling recorrente, leases presas, falhas repetidas e divergência recuperada
na reconciliação. Alertas persistidos têm chave integração + classe e cooldown
de uma hora, com resolução registrada. A interface exibe os alertas; esta etapa
não envia mensagens externas de alerta.

## Configuração e scheduler

O código só é habilitado explicitamente em ambiente autorizado, com o projeto
Supabase esperado. Cron exige um segredo técnico dedicado. Não reutilizar o
segredo de outros jobs. Não colocar credenciais no frontend, no repositório ou
em relatórios. Credenciais Graph continuam no mecanismo protegido do 03.

`scripts/email-intake/automation-scheduler.mjs` recebe um arquivo protegido via
`--env-file=CAMINHO`. Sem `--apply`, executa apenas preflight. Antes de aplicar,
conferir todas as validações e o projeto alvo. O script verifica a aplicação,
o handshake e o vínculo ao Supabase; guarda o segredo no Vault e cria somente
os seis jobs deste escopo, usando pg_cron + pg_net.

Jobs de descoberta e anexos rodam a cada minuto; os horários duráveis no banco
limitam DELTA a cinco minutos e reconciliação a um dia, preservando continuação
de páginas. Assinatura e saúde são verificadas a cada cinco minutos.

`--remove` remove somente os jobs e os segredos Vault nomeados por este escopo
e projeto. Desabilitar também a integração antes de desmontar um smoke; os
workers do 03 respeitam a habilitação da integração. Excluir assinaturas QA
remotas por seus IDs conferidos, antes da limpeza das respectivas fixtures.

## Validações obrigatórias pendentes

1. Revisar diff completo e conferir integridade das migrations do 03.
2. TypeScript, suíte completa, lint e build com Node 22.
3. Clean-room com `node scripts/email-intake/clean-room.mjs --storage-api --automation`.
   Verificar migrations, leases concorrentes, backoff, cursores, reconciliação,
   grants/RLS, MFA e isolamento entre fundos, incluindo os novos cenários de
   Gestor/Super Admin e de acesso negado entre fundos.
4. CI Linux: `.github/workflows/email04-certification.yml`. A branch
   `validation/rlx-email04-linux` tem deploy Vercel desabilitado em `vercel.json`.
   Publicar primeiro um commit que já contenha essa configuração.
5. Preview real: assinatura, e-mail QA, notificação e timestamps; medir p95 <3s.
   Testar watchdog com notificação perdida, renovação, lifecycle, gap controlado
   de reconciliação, replay, estados de saúde e cooldown/resolução de alertas.
6. Somente após Preview PASS, promover o escopo isolado para homolog e repetir
   o smoke real Graph, recuperação delta, reconciliação, saúde e limpeza QA.
7. Registrar cada flag PASS/FAIL exigida no plano com sua evidência. Nenhum PASS
   pode ser derivado apenas desta implementação ou de build.

Parar diante de falha nos gates definidos pelo plano. Não promover produção.
