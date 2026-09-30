# RLX-EMAIL-02 — transporte e pendências de integração

> Registro da etapa 02. A continuação 03 integrou o baseline Guibor A3/A4;
> consultar [RLX_EMAIL_03_STATUS.md](RLX_EMAIL_03_STATUS.md) para o estado atual.

Status em 29/09/2026: **implementação parcial, desativada, somente local**.
`RLX_EMAIL_HOMOLOG_READY = NO`. A conexão de leitura à mailbox foi testada
localmente; não houve migration remota, subscription, envio de e-mail ou
alteração em produção.

Branch: `feature/rlx-email-intake-graph`, em worktree próprio, baseada em
`origin/main` (`8a476029`). Os módulos novos ainda não estão ligados a rotas,
cron, UI nem ao upload fiscal. Esta entrega não importa notas automaticamente.

## Diagnóstico do pipeline oficial

- `src/lib/actions/nota-fiscal.ts`: `uploadNFs` resolve sessão/contexto e chama
  `processarArquivo`, que concentra parser, Storage, NF, parcelas e documentos.
- `src/lib/documentos-v2/upload.ts`: `uploadDocumentoDaNota` exige
  `requireNotaFiscalAccess`; a RPC `registrar_documento_upload` valida ator
  autenticado. Passar um cliente administrativo não cria um contexto técnico
  autorizado para o pipeline.
- `src/lib/eventos-dominio/registrar.ts`: eventos atuais também exigem sessão.
- A recuperação de XML incompleto em `recuperarDuplicidadeIncompleta` remove a
  NF parcial anterior. Essa decisão precisa ser protegida por posse/fencing
  compartilhado entre upload manual e job antes de processamento concorrente.
- O parser e a revisão de NFS-e estão em
  `origin/feature/guibor-nfse-base-valor-comissao`, fora da base desta branch.
  Não foram copiados, modificados nem substituídos por outro parser/review.

## Implementado neste escopo

`src/lib/email-intake/` separa contrato do provider, adapter Outlook, transporte
HTTP, descoberta, regras de roteamento e validação de notificações/anexos.

- OAuth client credentials com cache em memória por instância, sem token no DB;
  IDs imutáveis e leitura mínima de metadados, sem corpo/assunto da mensagem.
- Delta e reconciliação com cursores separados, validação de origem/path e
  proibição de redirects para impedir vazamento de bearer tokens.
- Listagem paginada de anexos e download limitado a 20 MiB, inclusive quando
  o servidor não informa `Content-Length`; MIME, extensão e bytes verificados.
- Erros fechados e sanitizados; `Retry-After` preservado para a fila durável.
- Criação/renovação de subscription e handler de challenge, clientState,
  tenant, resource e lifecycle. O handler recebe um repositório por contrato;
  ainda não existe endpoint público nem repositório operacional de notificações.
- Segredos e cursores usam o keyring AES-GCM versionado já existente na
  plataforma, com vínculo criptografado a fundo, integração e finalidade.
- Roteamento puro por CNPJ fiscal e elegibilidade oficial fornecida pelo
  chamador; allowlist, desconhecido e ambiguidade tratados sem criar Cedente.
- Descoberta aguarda todas as listagens da página antes do commit durável.

A migration nova `20260929204430_email_intake_durable_transport.sql` define
integrações por fundo, allowlist, checkpoints separados, mensagens, anexos e
wake-ups no schema `private`. Nenhuma tabela privada é concedida a anon,
authenticated ou service_role. As três RPCs de claim/commit têm execução
restrita a service_role e `search_path` vazio. RLS fica habilitada em todas as
seis tabelas; ainda não há leitura/configuração concedida aos portais.

O commit da página verifica token/revisão/validade do lease antes de upsert e
avanço do cursor na mesma transação. Claims usam `FOR UPDATE SKIP LOCKED` e
leases de cinco minutos. Integrações nascem desativadas e habilitação exige
registro da evidência de restrição da mailbox. Esse registro não substitui
verificação administrativa real no Exchange.

## Configuração segura para os próximos testes

O usuário indicou `apifidc@rlxrefrigerantes.com.br` ao ser perguntado sobre a
mailbox de QA. Essa escolha posterior orienta os testes, preservando mensagens
reais. O usuário confirmou que a restrição no Exchange foi aplicada. Essa
declaração permite o teste de conexão, mas não equivale a uma verificação
independente do bloqueio de outras mailboxes. Definir `start_at` explicitamente
antes do discovery; o teste executado não importou histórico.

Para env server-side, o resolvedor aceita uma referência como
`EMAIL_INTAKE_QA_RLX` e lê somente:

- `EMAIL_INTAKE_QA_RLX_TENANT_ID`
- `EMAIL_INTAKE_QA_RLX_CLIENT_ID`
- `EMAIL_INTAKE_QA_RLX_CLIENT_SECRET`

Não usar `NEXT_PUBLIC_*`, não registrar valores em logs, não colar segredos em
chat e não versionar `.env`. O usuário preencheu `.env.email-intake.local` no
worktree. A verificação local confirmou os três campos presentes, IDs com
formato válido, Git ignore ativo e ACL restrita (herança desabilitada).
O cadastro pela plataforma ainda deve implementar a mutação
autorizada por fundo/MFA, criptografia, auditoria, rotação e resposta sem segredo.

O acesso app-only deve ser restrito às mailboxes autorizadas. Em Exchange RBAC
for Applications, permissões Entra irrestritas são aditivas; conceder uma role
restrita sem remover o acesso amplo não comprova isolamento. Uma chamada Graph
com sucesso também não comprova isolamento da aplicação.

Referências oficiais consultadas:

- [Exchange RBAC for Applications](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)
- [Outlook immutable IDs](https://learn.microsoft.com/en-us/graph/outlook-immutable-id)
- [Message delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)
- [Webhook delivery](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks)
- [Graph throttling](https://learn.microsoft.com/en-us/graph/throttling)

## Validações e limites

- Smoke real em 29/09/2026, 21:22:42 UTC: OAuth HTTP 200, leitura mínima de
  metadados Inbox HTTP 200, 414 ms no ensaio registrado. Esse tempo é de uma
  única conexão; não é p95, capacidade medida nem certificação de performance.
  Zero downloads de anexo, subscriptions ou escritas no banco.
  Evidência sanitizada: `docs/homologacao/rlx-email-connection.json`.
- `scripts/email-intake/outlook.smoke.ts` usa o adapter oficial com configuração
  Vitest própria e opt-in. Não integra a suite padrão e exige mailbox explícita
  e confirmação de escopo. O resultado omite IDs, tokens e conteúdos do e-mail.
  A leitura mínima de metadados não comprova, sozinha, permissão para anexos.
- Node 22.23.2: TypeScript passou.
- 41 testes novos de transporte, roteamento, segredo, descoberta e webhook passaram.
- Suite completa: 284 arquivos passaram, 3 ignorados; 2400 testes passaram,
  12 ignorados. Não substitui smoke operacional.
- `node scripts/email-intake/verify-transport-db.mjs`: passou em PostgreSQL real,
  banco sintético isolado criado e removido pelo próprio teste. Cobre rollback
  integral, revisão do cursor, replay, concorrência, expiração e esgotamento de
  tentativas, RLS e grants. Os pais de domínio são stubs mínimos; não é o
  clean-room integral de todas as migrations da aplicação.
- Migration também executada sobre o schema local existente em transação com
  ROLLBACK. Nenhuma alteração de schema foi mantida nesse banco.
- Lint: zero erros; um aviso preexistente de import não utilizado em
  `src/lib/actions/liquidacao.ts` (fora do escopo).
- `next build --webpack`: passou, incluindo TypeScript e geração de páginas.
- `git diff --check`: passou. Somente arquivos novos do Email Intake no diff.
- Commit/push/PR: não executados. O gate local completo do plano ainda inclui
  Storage, processamento fiscal e performance não implementados/certificados.

## Pendências para completar o plano autorizado

1. Serviço fiscal compartilhado com identidade técnica autorizada, isolamento
   por fundo/estabelecimento, dedupe antes de Storage, fencing entre canais e
   compensação durável; preservar upload manual e NFS-e/review oficial.
2. Repositórios operacionais, finalização de claims, auditoria/sync runs,
   workers de texto/visual/review, recuperação e cleanup de Storage.
3. Endpoint público com limites/rate limiting, coalescência durável, watchdog,
   reconciliação agendada, renovação/lifecycle e health monitor.
4. UI Gestor/Super Admin e RPCs com fundo, MFA, RLS e testes de autorização;
   cadastro seguro de credenciais e inbox paginada.
5. Registrar evidência administrativa verificável de escopo Exchange (usuário
   confirmou aplicação; bloqueio independente não testado) e disponibilizar a
   base compartilhada de NFS-e sem misturar a branch paralela. Credenciais locais
   e conexão mínima já verificadas.
6. Clean-room completo, smokes reais, L1/L2/L3/burst, SLOs, integridade de Storage,
   regressão fiscal e benchmarks em Preview/Homolog, com cleanup QA.

Capacidade e SLOs **não medidos**. Não há certificação de performance, CI remoto,
Preview ou homologação. Produção, GUIBOR, P17, Vórtx, CERC e cancelamento de
operações permaneceram intocados.

## Gates do plano

`FAIL` abaixo inclui pendência/não execução e não significa que houve um teste
real com resultado negativo. PASS local parcial não equivale a homologação.

```text
RLX_EMAIL_ARCH_FUNDSCOPE = FAIL
RLX_EMAIL_MULTI_INTEGRATION = FAIL
RLX_EMAIL_MULTI_PROVIDER_CONTRACT = PASS
RLX_EMAIL_PROVIDER_OUTLOOK = FAIL
RLX_EMAIL_ROUTING_ALL = FAIL
RLX_EMAIL_ROUTING_ALLOWLIST = FAIL
RLX_EMAIL_SENDER_NOT_IDENTITY = PASS
RLX_EMAIL_MULTI_CEDENTE_MESSAGE = FAIL
RLX_EMAIL_GRAPH_CLIENT_CREDENTIALS = PASS
RLX_EMAIL_GRAPH_MAIL_READ = FAIL
RLX_EMAIL_OUTLOOK_MAILBOX_SCOPE = FAIL
RLX_EMAIL_IMMUTABLE_ID = PASS
RLX_EMAIL_WEBHOOK = FAIL
RLX_EMAIL_DELTA = FAIL
RLX_EMAIL_DELTA_WATCHDOG = FAIL
RLX_EMAIL_RECONCILIATION = FAIL
RLX_EMAIL_SUBSCRIPTION_RENEWAL = FAIL
RLX_EMAIL_DISCOVERY_PROCESSING_SEPARATION = PASS
RLX_EMAIL_CURSOR_AFTER_DURABLE_DISCOVERY = PASS
RLX_EMAIL_CRASH_RECOVERY = FAIL
RLX_EMAIL_LOCKING = PASS
RLX_EMAIL_LEASE_RECOVERY = PASS
RLX_EMAIL_MESSAGE_IDEMPOTENCY = PASS
RLX_EMAIL_ATTACHMENT_IDEMPOTENCY = PASS
RLX_EMAIL_FISCAL_IDEMPOTENCY = FAIL
RLX_EMAIL_CROSS_CHANNEL_DUPLICATION = FAIL
RLX_EMAIL_SHARED_IMPORT_PIPELINE = FAIL
RLX_EMAIL_NO_PARALLEL_PARSER = PASS
RLX_EMAIL_PER_FILE = FAIL
RLX_EMAIL_REVIEW_SHARED = FAIL
RLX_EMAIL_UNKNOWN_CEDENTE = FAIL
RLX_EMAIL_STORAGE_INTEGRITY = FAIL
RLX_EMAIL_RLS = FAIL
RLX_EMAIL_REDACTION = FAIL
RLX_EMAIL_AUDIT = FAIL
RLX_EMAIL_UI_INTEGRATIONS = FAIL
RLX_EMAIL_UI_INBOX = FAIL
RLX_EMAIL_HEALTH_MONITOR = FAIL
RLX_EMAIL_WEBHOOK_SLO = FAIL
RLX_EMAIL_DISCOVERY_SLO = FAIL
RLX_EMAIL_PROCESSING_TEXT_SLO = FAIL
RLX_EMAIL_PROCESSING_VISUAL_SLO = FAIL
RLX_EMAIL_PERFORMANCE_CERTIFICATION = FAIL
RLX_EMAIL_MEASURED_CAPACITY = NOT_MEASURED
RLX_EMAIL_MANUAL_UPLOAD_REGRESSION = FAIL
RLX_EMAIL_FEATURE_TESTS = FAIL
RLX_EMAIL_CI = FAIL
RLX_EMAIL_PREVIEW = FAIL
RLX_EMAIL_HOMOLOG_OUTLOOK_REAL = FAIL
RLX_EMAIL_HOMOLOG_MULTI_CEDENTE = FAIL
RLX_EMAIL_HOMOLOG_ALLOWLIST = FAIL
RLX_EMAIL_HOMOLOG_REVIEW = FAIL
RLX_EMAIL_HOMOLOG_UNKNOWN = FAIL
RLX_EMAIL_HOMOLOG_DELTA_RECOVERY = FAIL
RLX_EMAIL_HOMOLOG_RECONCILIATION = FAIL
RLX_EMAIL_HOMOLOG_PERFORMANCE = FAIL
RLX_EMAIL_HOMOLOG_CLEANUP = FAIL
RLX_EMAIL_HOMOLOG_READY = NO
RLX_EMAIL_CANCELLATION_AUTOMATION = NOT_IMPLEMENTED
RLX_EMAIL_PRODUCTION_CHANGED = NO
GUIBOR_CHANGED = NO
P17_CHANGED = NO
RLX_VORTX_CHANGED = NO
CERC_CHANGED = NO
```
