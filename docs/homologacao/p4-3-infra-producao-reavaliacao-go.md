# P4.3 — infraestrutura real de produção e reavaliação do GO

Data da inspeção: 27/08/2026

Produção: integralmente `READ-ONLY`

Projeto Supabase: `bw-antecipa` (`wwsndnuvnjuabpbjwlck`)

## Resultado executivo

```text
P4_3_INFRA_FINAL = FAIL

VERCEL_PROJECT_IDENTIFIED = FAIL
VERCEL_PROD_ENV_READY = FAIL
APP_URL_PROD_READY = FAIL
SINQIA_TERRA_ENV_READY = FAIL
AUTH_SITE_URL_READY = FAIL
AUTH_REDIRECTS_READY = FAIL
AUTH_MFA_READY = FAIL
SUPABASE_AUTH_SMTP_READY = FAIL
APP_SMTP_READY = FAIL
BACKUP_READY = FAIL
PITR_READY = FAIL
RESTORE_CAPABILITY_READY = FAIL
RTO_EVIDENCE = NAO_COMPROVADO
APP_ROLLBACK_READY = FAIL
DB_ROLLBACK_READY = FAIL
DLZ_CUTOVER_CONFIG_READY = PASS
RC_CONTENT_UNCHANGED = FAIL
RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO

CUTOVER_PRODUCAO = NO_GO
```

O P4.3 confirmou que o projeto Supabase de produção está saudável, o domínio oficial responde pelo Vercel e o deployment conhecido continua associado ao commit anteriormente certificado. Isso não fecha os gates de infraestrutura: a estação não possui Vercel CLI instalada/vinculada nem Supabase CLI autenticada, e o MCP disponível não expõe configurações hospedadas de Auth, env vars, backups ou PITR.

O resultado permanece fail-closed. Nenhum estado ausente de evidência foi presumido como pronto.

## 1. Escopo e fontes

Foram usados exclusivamente:

- relatórios certificados [P4.1](./p4-1-production-infrastructure-readiness.md) e [P4.2](./p4-2-configurador-seguro-producao-dlz-health.md);
- GitHub Deployments em modo read-only;
- respostas HTTP `HEAD` ao domínio oficial e ao deployment conhecido;
- Supabase MCP em operações de listagem, leitura de projeto/organização e `SELECT` agregado no schema Auth;
- código e testes locais do release candidate;
- documentação e changelog oficiais do Supabase consultados em 27/08/2026.

Referências oficiais: [Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod), [Database Backups](https://supabase.com/docs/guides/platform/backups), [MFA](https://supabase.com/docs/guides/auth/auth-mfa), [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) e [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## 2. Autenticação e tooling local

| Ferramenta | Estado | Consequência |
|---|---|---|
| Vercel CLI | Ausente; não há `.vercel/project.json` | Project ID, team, env metadata e permissão de rollback não verificáveis |
| Supabase CLI local | Versão `2.111.0`, sem sessão/token | `backups list` e metadata de recovery não verificáveis pela CLI |
| Supabase MCP | Autenticado e read-only neste ticket | Projeto, organização e contagens agregadas do Auth verificadas |
| GitHub CLI | Autenticado | Deployment, SHA, status e URL conhecidos reconfirmados |

Para fechar os gates sem salvar tokens no repositório:

```powershell
vercel login
vercel whoami

node_modules\.bin\supabase.cmd login
node_modules\.bin\supabase.cmd projects list --output json
node_modules\.bin\supabase.cmd backups list --project-ref wwsndnuvnjuabpbjwlck --output json
```

Após a autenticação, executar somente comandos de inspeção. Não usar `vercel env pull`, deploy, promote, restore ou comandos de alteração.

## 3. Vercel e domínio

Evidência reconfirmada:

| Item | Resultado |
|---|---|
| GitHub deployment ID | `5440379384` |
| Status | `success` |
| Commit servido | `7a3087870cc8a80ab020676f1db33600804e5825` |
| Timestamp do status | `2026-08-24T17:37:58Z` |
| Deployment URL | `https://bw-antecipa-5b6ohwpvj-renanbarretoj.vercel.app` |
| Domínio oficial | `https://bw-antecipa.better-with.tech` |
| HTTP do domínio/deployment | `200`, servidor Vercel |

O GitHub Deployment não informa Project ID, team, env vars nem permissão de rollback. Consequentemente:

```text
VERCEL_PROJECT_IDENTIFIED = FAIL
VERCEL_PROD_ENV_READY = FAIL
APP_URL_PROD_READY = FAIL
SINQIA_TERRA_ENV_READY = FAIL
APP_SMTP_READY = FAIL
APP_ROLLBACK_READY = FAIL
```

O domínio responder `200` comprova disponibilidade pública, mas não comprova que `APP_BASE_URL`, `NEXT_PUBLIC_APP_ENV`, `FROMTIS_*` ou SMTP estejam corretos no target Production.

## 4. Supabase, Auth e MFA

O MCP retornou:

| Item | Evidência |
|---|---|
| Projeto | `bw-antecipa` |
| Project ref | `wwsndnuvnjuabpbjwlck` |
| Região | `us-east-1` |
| Estado | `ACTIVE_HEALTHY` |
| PostgreSQL | 17 |
| Plano da organização | Pro |
| Usuários Auth | 23 |
| Fatores MFA/TOTP/verificados | 0 / 0 / 0 |

O runtime implementa o comportamento esperado:

```text
usuário sem fator verificado
  → /mfa/setup
  → enroll + verify TOTP
  → AAL2 real do Supabase
  → sessão operacional elevada por 24 horas
```

As evidências estão em `src/lib/supabase/middleware.ts`, `src/lib/auth/mfa.ts`, `src/lib/auth/mfa-session.ts` e `src/app/actions/mfa.ts`. O reset administrativo exige fluxo auditado com segundo Super Admin, e a auto-desativação permanece bloqueada.

Entretanto, o tooling disponível não expõe se TOTP está habilitado no projeto de produção, nem Site URL, redirects, SMTP e templates hospedados. Zero fatores existentes pode ser compatível com rollout no primeiro acesso, mas `PASS_WITH_ROLLOUT` exige comprovar a configuração do projeto e aprovar o plano operacional. Portanto:

```text
AUTH_SITE_URL_READY = FAIL
AUTH_REDIRECTS_READY = FAIL
AUTH_MFA_READY = FAIL
SUPABASE_AUTH_SMTP_READY = FAIL
```

## 5. SMTP da aplicação

O contrato local foi reconfirmado em `src/lib/email.ts` e `src/lib/email-smtp.test.ts`:

- IONOS por padrão (`smtp.ionos.com`, porta 465);
- TLS mínimo 1.2;
- porta, `SMTP_SECURE`, usuário e remetente validados;
- `EMAIL_FROM` deve usar o domínio da conta SMTP;
- exceção sem TLS é limitada a sink loopback no ambiente explícito `rehearsal/local`.

Como a presença e coerência das env vars Production não foram observadas, `APP_SMTP_READY = FAIL`. Nenhum e-mail foi enviado.

## 6. Backup, PITR, restore e rollback de banco

O plano Pro é evidência de elegibilidade, não de execução bem-sucedida. Não foi possível observar último backup, status, retenção, PITR ou janela de recovery. Também não existe evidência aprovada de restore anterior/isolado com duração medida e RTO formal.

```text
BACKUP_READY = FAIL
PITR_READY = FAIL
RESTORE_CAPABILITY_READY = FAIL
RTO_EVIDENCE = NAO_COMPROVADO
DB_ROLLBACK_READY = FAIL
```

O rollback de banco só pode receber `PASS` após backup/PITR e capacidade real de restore estarem comprovados. Down migrations improvisadas não são alternativa aceita.

## 7. Release candidate

O hash foi recalculado sem gravar o relatório canônico:

| Item | P4/P4.1 | P4.3 observado |
|---|---:|---:|
| Hash RC | `766037c8a390572cc73e5b3678ce456db670531ac8b6bb0f20024bb369239f79` | `e30c04e68c91a58663ebde360a280629042ad4e7c7aeb3c2254c95f1dea48696` |
| Arquivos cobertos | 982 | 988 |
| Manifesto migrations | `cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318` | idêntico |

O delta decorre do working tree que contém o RC e artefatos posteriores ainda não commitados, inclusive o configurador P4.2 dentro do escopo do hash. Como não existe hash RC posterior formalmente certificado e este ticket proíbe commit/push:

```text
RC_CONTENT_UNCHANGED = FAIL
RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO
```

Isso não invalida `P4_2_CONFIGURADOR_DLZ = PASS`; exige recertificar o hash do conjunto final antes da janela.

## 8. Matriz de reavaliação

| Gate | P4.1 | P4.3 | Evidência necessária para fechar |
|---|---|---|---|
| Projeto Vercel | FAIL | FAIL | Project ID/team e deployment obtidos pela Vercel |
| Production env | Não verificável | FAIL | Lista sanitizada de nomes/scopes/presença |
| App URL/env | FAIL | FAIL | Valores não sensíveis conferidos no target Production |
| Sinqia/Terra env | Não verificável | FAIL | Presença e formato seguro dos `FROMTIS_*` |
| Auth URL/redirects | Não verificável | FAIL | Dashboard/API administrativa read-only |
| MFA | FAIL | FAIL | TOTP habilitado + rollout first-login + recuperação aprovados |
| SMTP Auth | Não verificável | FAIL | Custom SMTP e templates conferidos |
| SMTP aplicação | Não verificável | FAIL | Metadata Vercel Production conferida |
| Backup/PITR | Não verificável | FAIL | Último backup e recovery window observados |
| Restore/RTO | FAIL | FAIL | Exercício/evidência formal com duração |
| Rollback aplicação | Não verificável | FAIL | Owner/permissão e deployment anterior aprovados |
| Rollback banco | FAIL | FAIL | Backup/PITR + restore/RTO aprovados |
| Configurador DLZ | PASS | PASS | Sem alteração |
| RC | Conteúdo PASS, commit pendente | Conteúdo FAIL, commit pendente | Recertificar hash e associar a commit imutável |

O checklist de quatro olhos está em [p4-3-checklist-manual-infra-producao.md](./p4-3-checklist-manual-infra-producao.md). Cada gate pode ser reexecutado isoladamente após o preenchimento da sua evidência.

## 9. Ações proibidas e preservação

Durante o P4.3 não foram executados:

- migration, SQL mutável ou configurador DLZ;
- alteração de dados, Auth, SMTP, env vars ou secrets;
- deploy, rollback, restore ou criação de backup;
- envio de e-mail ou chamada à Sinqia/Terra;
- commit ou push.

## 10. Parecer final

`DLZ_CUTOVER_CONFIG_READY = PASS` permanece válido, mas infraestrutura e rollback ainda não estão comprovados e o hash final do RC mudou sem recertificação. Assim:

```text
P4_3_INFRA_FINAL = FAIL
CUTOVER_PRODUCAO = NO_GO
```

O GO só poderá ser reavaliado depois de preencher o checklist manual, comprovar restore/RTO e rollback, recertificar o hash final e associá-lo a um commit imutável autorizado.
