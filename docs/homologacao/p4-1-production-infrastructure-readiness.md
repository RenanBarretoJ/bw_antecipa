# P4.1 — Production Infrastructure Readiness

Data da inspeção: 27/08/2026  
Escopo: Vercel, Auth, SMTP, backup/PITR e rollback  
Produção: integralmente `READ-ONLY`  
Baseline: P4 — DLZ/HEALTH  

## 1. Resultado executivo

```text
P4_1_INFRA_PRODUCAO = FAIL

VERCEL_PROJECT_IDENTIFIED = FAIL
VERCEL_DEPLOYED_COMMIT_IDENTIFIED = PASS
VERCEL_PROD_ENV_READY = NAO_VERIFICAVEL
APP_URL_PROD_READY = FAIL
SINQIA_TERRA_ENV_READY = NAO_VERIFICAVEL
AUTH_SITE_URL_READY = NAO_VERIFICAVEL
AUTH_REDIRECTS_READY = NAO_VERIFICAVEL
AUTH_MFA_READY = FAIL
SUPABASE_AUTH_SMTP_READY = NAO_VERIFICAVEL
APP_SMTP_READY = NAO_VERIFICAVEL
BACKUP_READY = NAO_VERIFICAVEL
PITR_READY = NAO_VERIFICAVEL
RESTORE_CAPABILITY_READY = FAIL
RTO_EVIDENCE = NAO_COMPROVADO
APP_ROLLBACK_READY = NAO_VERIFICAVEL
DB_ROLLBACK_READY = FAIL
RC_CONTENT_UNCHANGED = PASS
RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO
```

O P4.1 aumentou a evidência disponível: identificou o deployment e o commit atualmente servidos, reconfirmou o projeto Supabase e o plano Pro e provou que o conteúdo do release candidate não mudou. Ainda não há acesso read-only suficiente para comprovar o projeto Vercel interno, as env vars de produção, Auth, SMTP, último backup, PITR, restore ou permissões de rollback. Além disso, a produção possui zero fatores TOTP cadastrados para 23 usuários.

Esses itens são gates críticos. A infraestrutura não está certificada para a janela real.

Nenhum dado, migration, configuração, secret, deployment, e-mail, backup, restore ou integração externa foi alterado ou executado.

## 2. Baseline preservado

O P4 permanece como baseline:

- Supabase `wwsndnuvnjuabpbjwlck`, `ACTIVE_HEALTHY`, PostgreSQL 17;
- 12 Cedentes;
- 45 operações;
- 903 NFs;
- 123 documentos;
- 1.635 objetos no metadata do Storage;
- 23 Auth users e 23 profiles;
- 26 operações históricas Fromtis/Sinqia;
- baseline classificado como estável;
- manifesto e CNAB DLZ certificados.

Não foi repetida a auditoria profunda de schema porque o P4.1 não detectou evidência de delta operacional nem alterou produção.

## 3. Vercel Production

### Evidência disponível

| Item | Evidência |
|---|---|
| Repositório | `RenanBarretoJ/bw_antecipa` |
| Ambiente GitHub Deployment | `Production` |
| GitHub deployment ID | `5440379384` |
| Provedor | `vercel[bot]` |
| Status mais recente | `success` |
| Timestamp | `2026-08-24T17:37:58Z` |
| Deployment URL | `https://bw-antecipa-5b6ohwpvj-renanbarretoj.vercel.app` |
| Commit implantado | `7a3087870cc8a80ab020676f1db33600804e5825` |
| Commit atual de `origin/main` | `7a3087870cc8a80ab020676f1db33600804e5825` |
| Domínio oficial | `https://bw-antecipa.better-with.tech` |

O domínio oficial e a URL do deployment responderam HTTP 200, via Vercel, com HSTS. O conteúdo HTML de ambos apresentou o mesmo SHA-256 sanitizado:

```text
470ae9818fd03356821c1c1aec6786b74754b748d86407ddbce7f057c3e88f3e
```

Isso comprova que o domínio oficial está servindo o conteúdo do deployment identificado e que o commit desse deployment é o `main` atual.

### Limitação

- Vercel CLI não está instalada globalmente nem autenticada.
- Não existe `.vercel/project.json`.
- Não existe `VERCEL_TOKEN` no processo.
- A API pública do deployment respondeu HTTP 403 sem autenticação.
- O nome `bw-antecipa` é observável na URL, mas o ID interno do projeto não foi obtido.
- Branch de origem não aparece nos metadados do deployment; o SHA coincide com `origin/main`.

Por exigir nome e ID do projeto, `VERCEL_PROJECT_IDENTIFIED = FAIL`. O deployment e o commit foram comprovados, portanto `VERCEL_DEPLOYED_COMMIT_IDENTIFIED = PASS`.

## 4. Vercel Production Environment

Sem autenticação Vercel, nenhum nome de variável ou scope pôde ser listado diretamente no ambiente Production. A tabela registra o contrato do RC, não valores:

| Variável | Obrigatoriedade no RC | Estado Production |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | obrigatória | NÃO VERIFICÁVEL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | obrigatória | NÃO VERIFICÁVEL |
| `SUPABASE_SERVICE_ROLE_KEY` | obrigatória no backend administrativo | NÃO VERIFICÁVEL |
| `SUPABASE_DB_URL` | não consumida pelo runtime Next.js identificado | NÃO APLICÁVEL ao runtime |
| `APP_BASE_URL` | obrigatória em produção | NÃO VERIFICÁVEL |
| `NEXT_PUBLIC_APP_ENV` | obrigatória, esperado `production` | NÃO VERIFICÁVEL |
| `INTEGRATION_RUNTIME_ENV` | recomendada; fallback seguro exige ambiente explícito | NÃO VERIFICÁVEL |
| `FROMTIS_URL` | obrigatória para DLZ legacy env | NÃO VERIFICÁVEL |
| `FROMTIS_USERNAME` | obrigatória para DLZ legacy env | NÃO VERIFICÁVEL |
| `FROMTIS_PASSWORD` | obrigatória para DLZ legacy env | NÃO VERIFICÁVEL |
| `FROMTIS_TIPO_RECEBIVEL` | opcional, default `01` | NÃO VERIFICÁVEL |
| `SMTP_HOST` | opcional, default IONOS | NÃO VERIFICÁVEL |
| `SMTP_PORT` | opcional, default 465 | NÃO VERIFICÁVEL |
| `SMTP_SECURE` | opcional, derivada da porta | NÃO VERIFICÁVEL |
| `SMTP_USER` | obrigatória para e-mail da aplicação | NÃO VERIFICÁVEL |
| `SMTP_PASSWORD` | obrigatória para e-mail da aplicação | NÃO VERIFICÁVEL |
| `EMAIL_FROM` | recomendada; fallback usa `SMTP_USER` | NÃO VERIFICÁVEL |
| `SMTP_ALLOW_INSECURE_LOCAL` | deve estar ausente/desativada | NÃO VERIFICÁVEL |
| `AUTH_FLOW_COOKIE_SECRET` | obrigatória; há fallback para service role | NÃO VERIFICÁVEL |
| `CRON_SECRET` | obrigatória para crons publicados | NÃO VERIFICÁVEL |
| `ESCROW_API_KEY` | obrigatória se `/api/escrow/sync` estiver ativo | NÃO VERIFICÁVEL |
| `PORTAL_FIDC_CREDENTIAL_KEYS_JSON` | necessária para credenciais criptografadas versionadas | NÃO VERIFICÁVEL |
| `PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION` | necessária com keyring versionado | NÃO VERIFICÁVEL |
| `PORTAL_FIDC_CREDENTIAL_MASTER_KEY_B64` | fallback legado de keyring | NÃO VERIFICÁVEL |
| `PORTAL_FIDC_CREDENTIAL_MASTER_KEY` | fallback legado de keyring | NÃO VERIFICÁVEL |
| `PORTAL_FIDC_ENDPOINT_ALLOWLIST` | necessária conforme integração versionada | NÃO VERIFICÁVEL |

As variáveis de timeout e limite financeiro são opcionais e possuem defaults; elas devem ser revisadas na inspeção Vercel, mas não são gate DLZ inicial.

Resultado: `VERCEL_PROD_ENV_READY = NAO_VERIFICAVEL`.

## 5. APP_BASE_URL e domínio

O domínio oficial está ativo e associado ao conteúdo do deployment de produção. O código usa `APP_BASE_URL`, com fallback para `NEXT_PUBLIC_APP_URL` ou `NEXT_PUBLIC_SITE_URL`, para recovery, convites e comunicações.

Não foi possível provar:

- `APP_BASE_URL=https://bw-antecipa.better-with.tech` no scope Production;
- `NEXT_PUBLIC_APP_ENV=production`;
- ausência de localhost ou homologação nas variáveis do scope Production.

O domínio funcional não comprova as env vars. Resultado: `APP_URL_PROD_READY = FAIL`.

## 6. Sinqia/Terra legacy env

Fluxo certificado no RC:

```text
DLZ/HEALTH
  → capability CESSAO_ENVIO
  → adapter sinqia_portal_fidc
  → runtime_mode legacy_env_sinqia_terra
  → FROMTIS_URL / FROMTIS_USERNAME / FROMTIS_PASSWORD
```

Contrato:

- `FROMTIS_URL`: obrigatória e HTTPS;
- `FROMTIS_USERNAME`: obrigatória e não vazia;
- `FROMTIS_PASSWORD`: obrigatória e não vazia;
- `FROMTIS_TIPO_RECEBIVEL`: opcional, default `01`, exatamente dois dígitos quando informada;
- `INTEGRATION_RUNTIME_ENV` ou `NEXT_PUBLIC_APP_ENV`: deve resolver `producao` no runtime produtivo.

O resolver dispensa credencial versionada apenas para DLZ + `CESSAO_ENVIO` + adapter Sinqia + modo legado certificado. Não houve chamada ao endpoint externo.

Como a metadata das env vars Vercel não pôde ser lida, `SINQIA_TERRA_ENV_READY = NAO_VERIFICAVEL`.

## 7. Supabase Auth

### Site URL e redirects

O tooling Supabase autenticado disponível identifica projeto, banco, organização e migrations, mas não expõe as configurações hospedadas de Auth, URL Configuration ou templates. Não foi possível comprovar:

- Site URL;
- Redirect URLs;
- recovery redirect;
- invite redirect;
- confirmação de e-mail;
- expiração de OTP;
- URLs ausentes de localhost/homologação.

Resultados:

```text
AUTH_SITE_URL_READY = NAO_VERIFICAVEL
AUTH_REDIRECTS_READY = NAO_VERIFICAVEL
```

### MFA/TOTP

Uma consulta somente leitura no schema `auth` encontrou:

| Métrica | Total |
|---|---:|
| Auth users | 23 |
| Fatores MFA | 0 |
| Fatores TOTP | 0 |
| Fatores verificados | 0 |

O RC possui setup, desafio, AAL2 e sessão forte de 24 horas. Contudo, nenhum usuário de produção possui fator TOTP cadastrado antes do cutover. Isso exige rollout operacional e teste por perfil; não é um estado pronto para janela sem plano de ativação e suporte.

Resultado: `AUTH_MFA_READY = FAIL`.

## 8. SMTP do Supabase Auth

Não foi possível comprovar custom SMTP, host, porta, TLS, remetente, usuário ou templates do Supabase Auth. A ausência desses dados na API/MCP disponível não autoriza presumir os defaults hospedados como adequados para produção.

Checklist manual no Dashboard:

1. abrir `Authentication → SMTP Settings`;
2. confirmar custom SMTP ativo;
3. confirmar host não local, porta e modo TLS coerentes;
4. confirmar usuário e remetente, sem copiar senha;
5. confirmar que não há Mailpit, `local_smtp` ou localhost;
6. revisar templates de confirmação, convite, recovery e alteração de e-mail;
7. registrar evidência visual sanitizada e revisão de quatro olhos.

Resultado: `SUPABASE_AUTH_SMTP_READY = NAO_VERIFICAVEL`.

## 9. SMTP da aplicação

O contrato do RC foi validado em código:

- provider: IONOS SMTP;
- defaults: `smtp.ionos.com`, porta 465, `secure=true`;
- porta 587 exige `secure=false` e STARTTLS;
- TLS mínimo 1.2;
- `SMTP_USER` e `SMTP_PASSWORD` são obrigatórias;
- `EMAIL_FROM` deve usar o mesmo domínio de `SMTP_USER`;
- exceção sem TLS somente funciona com `NEXT_PUBLIC_APP_ENV=rehearsal/local`, host loopback e opt-in explícito.

Sem a listagem de envs Production, presença e coerência não foram comprovadas. Nenhum e-mail foi enviado.

Resultado: `APP_SMTP_READY = NAO_VERIFICAVEL`.

## 10. Backup e PITR

O projeto pertence a uma organização Supabase no plano Pro. Segundo a documentação atual do Supabase, projetos Pro recebem backups diários automáticos com retenção de sete dias; PITR é um add-on separado. Essa regra de plano não comprova o estado operacional do projeto.

Não foi possível observar:

- último backup e seu status;
- timestamp do backup;
- PITR habilitado ou não;
- janela de retenção real;
- earliest/latest recovery point;
- restore point imediatamente anterior à janela.

A CLI local possui o comando read-only `supabase backups list`, mas não está autenticada e não existe `SUPABASE_ACCESS_TOKEN` no processo. O MCP autenticado não expõe backups/PITR.

Resultados:

```text
BACKUP_READY = NAO_VERIFICAVEL
PITR_READY = NAO_VERIFICAVEL
```

Referências operacionais: [Database Backups](https://supabase.com/docs/guides/platform/backups) e [Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod).

## 11. Restore e RTO

Não existe no repositório evidência de teste real de restauração, duração medida, owner nomeado ou RTO aprovado. O rehearsal local valida migrations e runtime, mas não mede restore do Supabase hospedado.

Passos oficiais para uma futura prova controlada, fora deste ticket:

1. identificar backup/PITR e recovery point no Dashboard;
2. definir owner autorizado e janela própria;
3. restaurar em ambiente isolado ou executar exercício aprovado;
4. medir indisponibilidade e tempo total;
5. validar banco, Auth, RLS e metadata de Storage;
6. lembrar que backup de banco não restaura bytes removidos do Storage;
7. registrar RTO e RPO reais.

Resultados:

```text
RESTORE_CAPABILITY_READY = FAIL
RTO_EVIDENCE = NAO_COMPROVADO
```

## 12. Rollback da aplicação

Evidência disponível:

- deployment atual: commit `7a3087870cc8a80ab020676f1db33600804e5825`, sucesso;
- deployment distinto anterior: commit `b3ec79e3fe57b481a722a83b1f3bc99542012dc4`, sucesso em 07/07/2026;
- URL anterior sanitizada: `https://bw-antecipa-kcsx6v0u0-renanbarretoj.vercel.app`;
- runbook de rollback existe em `docs/homologacao/p3-runbook-rollback-producao.md`.

Não foi comprovado que o executor atual possui permissão Vercel para promover/redeployar o deployment anterior. A sessão GitHub autenticada possui acesso ao repositório, mas isso não equivale a permissão de rollback no projeto Vercel.

Instrução para a janela, sem execução neste ticket:

1. manter novas operações congeladas;
2. localizar no Vercel o deployment aprovado imediatamente anterior;
3. confirmar SHA e evidência de sucesso;
4. executar rollback/promote pela pessoa autorizada;
5. validar domínio oficial, login e leitura histórica;
6. não reabrir operações antes do postflight.

Resultado: `APP_ROLLBACK_READY = NAO_VERIFICAVEL`.

## 13. Rollback do banco

Estratégia aceita:

- migration que falha antes do commit: interromper a cadeia e confirmar rollback transacional;
- alteração material já commitada: restaurar por PITR/snapshot/backup aprovado;
- não criar down migrations improvisadas durante incidente;
- preservar o freeze operacional até o postflight completo.

Como backup, PITR, restore capability, owner e RTO não foram comprovados, a estratégia existe, mas não está operacionalmente pronta.

Resultado: `DB_ROLLBACK_READY = FAIL`.

## 14. Release candidate

| Item | Estado |
|---|---|
| Branch local | `homolog` |
| HEAD | `a5d52505d58d0582fcdbfd2d311be40649ce40c5` |
| `origin/homolog` | `a5d52505d58d0582fcdbfd2d311be40649ce40c5` |
| Hash P4 | `766037c8a390572cc73e5b3678ce456db670531ac8b6bb0f20024bb369239f79` |
| Hash P4.1 | `766037c8a390572cc73e5b3678ce456db670531ac8b6bb0f20024bb369239f79` |
| Arquivos cobertos | 982 |
| Manifesto | `cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318` |

Não houve mudança material desde o hash P4. O working tree continua contendo o RC e os artefatos P1–P4 não commitados. Este ticket não possui autorização para commit/push.

Resultados:

```text
RC_CONTENT_UNCHANGED = PASS
RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO
```

Antes da janela, todo conteúdo coberto pelo hash deve ser associado a um único commit revisado e o hash deve ser recalculado após o commit para confirmar identidade.

## 15. Como obter as evidências pendentes

### Vercel — autenticação local segura

Não salvar token em arquivo versionado. Em uma estação autorizada:

```powershell
vercel login
vercel whoami
vercel project ls
vercel inspect https://bw-antecipa-5b6ohwpvj-renanbarretoj.vercel.app
vercel env ls production
```

Os comandos de inspeção devem registrar apenas nomes, scopes e estados. Não usar `vercel env pull`, `env add`, `env rm`, deploy ou promote neste gate.

### Supabase — backups

Autenticar a CLI fora do repositório e executar somente leitura:

```powershell
supabase login
supabase backups list --project-ref wwsndnuvnjuabpbjwlck --output json
```

O resultado deve ser sanitizado para timestamps, status e tipo de backup. Não registrar access token. PITR e recovery window devem ser confirmados em `Database → Backups → Point in Time`.

### Supabase Auth

Revisão manual, com quatro olhos:

- `Authentication → URL Configuration`;
- `Authentication → Providers → Email`;
- `Authentication → SMTP Settings`;
- `Authentication → MFA`;
- templates de confirmação, convite e recovery.

Registrar apenas estados e URLs não sensíveis.

## 16. Gates para converter o P4.1 em PASS

- [ ] ID e nome do projeto Vercel comprovados.
- [ ] Branch de origem do deployment comprovada.
- [ ] Todas as env vars obrigatórias presentes no scope Production.
- [ ] `APP_BASE_URL` e `NEXT_PUBLIC_APP_ENV` comprovadas.
- [ ] `FROMTIS_*` comprovadas por metadata segura.
- [ ] Site URL e redirects Auth revisados.
- [ ] Custom SMTP do Auth revisado.
- [ ] SMTP da aplicação revisado.
- [ ] Estratégia e rollout MFA aprovados para os 23 usuários.
- [ ] Último backup e retenção confirmados.
- [ ] PITR/recovery window confirmado ou alternativa formal aprovada.
- [ ] Restore capability testada e RTO medido.
- [ ] Permissão e owner do rollback Vercel confirmados.
- [ ] Rollback de banco operacionalmente viável.
- [ ] RC associado a commit imutável e recertificado.

## 17. Conclusão

O deployment atual e seu commit foram identificados, o domínio oficial está operacional e o RC permanece idêntico ao P4. A inspeção também confirmou o projeto Supabase e o plano Pro.

Os demais gates críticos continuam sem evidência objetiva, e o MFA possui um bloqueio concreto: nenhum dos 23 usuários tem fator TOTP cadastrado. Portanto:

```text
P4_1_INFRA_PRODUCAO = FAIL
```

Produção permaneceu integralmente `READ-ONLY`.

