# P4.5 — remediação controlada da infraestrutura de produção

Status: `CONCLUÍDO_COM_NO_GO`

Correlation ID: `3ef29e25-c7c7-42bc-aef9-a2fd691fa458`

Execução: 28/08/2026

Projeto Supabase de produção: `wwsndnuvnjuabpbjwlck`

Este relatório registra somente estados sanitizados. Nenhum token, senha, service role, credencial SMTP, credencial Fromtis ou connection string foi persistido.

## 1. Resultado executivo

```text
P4_5_INFRA_PRODUCAO = FAIL
CUTOVER_PRODUCAO = NO_GO
```

A remediação eliminou os bloqueios de configuração não sensível da Vercel e ajustou Site URL, redirect allowlist e recovery scanner-safe no Supabase Auth. TOTP já estava habilitado e foi preservado. A aplicação atual permaneceu disponível, o deployment não mudou, a baseline de produção ficou estável e os hashes do RC permaneceram canônicos.

O cutover continua bloqueado por dois itens fail-closed:

1. o Supabase Auth não possui Custom SMTP e nenhuma credencial segura foi fornecida para configurá-lo;
2. o rollback do banco não está formalmente aprovado: PITR exige aprovação comercial e, embora o restore lógico isolado tenha sido comprovado, ainda não há owner nem aceite formal do RTO.

Nenhuma migration, dado operacional, configurador DLZ, deploy, chamada Sinqia/Terra, envio CNAB, commit ou push foi executado.

## 2. Flags finais

```text
NEXT_PUBLIC_APP_ENV_READY = PASS
INTEGRATION_RUNTIME_ENV_READY = PASS
APP_BASE_URL_READY = PASS
VERCEL_PROD_ENV_READY = PASS

SINQIA_TERRA_ENV_READY = PASS
APP_SMTP_READY = PASS

AUTH_SITE_URL_READY = PASS
AUTH_REDIRECTS_READY = PASS
AUTH_MFA_READY = PASS_WITH_ROLLOUT
MFA_ROLLOUT_PLAN = READY
SUPABASE_AUTH_SMTP_READY = PENDENTE_SECRET
AUTH_TEMPLATES_READY = PASS

BACKUP_READY = PASS
PITR_READY = PENDENTE_APROVACAO_COMERCIAL
RESTORE_CAPABILITY_READY = PASS
RTO_EVIDENCE = NAO_COMPROVADO

APP_ROLLBACK_READY = PASS
DB_ROLLBACK_READY = FAIL

PRODUCTION_BASELINE = STABLE
APP_RELEASE_HASH = PASS
CUTOVER_BUNDLE_HASH = PASS
DLZ_CUTOVER_CONFIG_READY = PASS
RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO
```

`RESTORE_CAPABILITY_READY = PASS` certifica a capacidade técnica do restore lógico isolado. `RTO_EVIDENCE = NAO_COMPROVADO` permanece porque a duração medida ainda não foi formalmente aceita e nenhum owner de restore foi designado. Por isso, a alternativa B de rollback do banco não está completa.

## 3. Change plan e alterações executadas

| Item | Antes | Depois | Verificação imediata | Rollback documentado |
|---|---|---|---|---|
| `NEXT_PUBLIC_APP_ENV` | Ausente em Production | `production`, somente Production | Presença e igualdade exata validadas | Remover a variável de Production |
| `INTEGRATION_RUNTIME_ENV` | Ausente em Production | `production`, somente Production | Presença e igualdade exata validadas | Remover a variável de Production |
| `APP_BASE_URL` | Presente como Secret, sem leitura segura do valor | URL canônica como Config, somente Production | HTTPS, igualdade exata e ausência de referência não produtiva | Remover a Config e restaurar o valor anterior por fonte segura |
| Auth redirect allowlist | Wildcard do domínio de produção | Três URLs exatas derivadas do runtime | Lista exata reconsultada via Management API | Restaurar a allowlist anterior registrada em memória durante a execução |
| Template de recovery | Link hospedado por `ConfirmationURL` | Link scanner-safe por `token_hash` para `/auth/confirm` | TokenHash presente e ConfirmationURL ausente | Restaurar o template anterior capturado em memória |

As mudanças foram realizadas uma a uma. Cada PATCH foi seguido por nova leitura sanitizada. O script de Auth possui rollback automático quando a pós-condição da alteração não é atendida.

## 4. Vercel Production Environment

Escopo auditado: projeto `bw-antecipa`, target exclusivo `production`.

### 4.1 Ambiente e URL pública

- `NEXT_PUBLIC_APP_ENV`: presente e igual a `production`;
- `INTEGRATION_RUNTIME_ENV`: presente e igual a `production`;
- `APP_BASE_URL`: `https://bw-antecipa.better-with.tech`;
- nenhuma dessas variáveis foi adicionada a Preview ou Development neste ticket.

### 4.2 Sinqia/Terra

- `FROMTIS_URL`: presente, HTTPS e sem referência a localhost/homolog;
- `FROMTIS_USERNAME`: presente e não vazio;
- `FROMTIS_PASSWORD`: presente e não vazio;
- `FROMTIS_TIPO_RECEBIVEL`: presente e compatível com dois dígitos.

As credenciais não foram exibidas, rotacionadas ou modificadas. Nenhuma chamada ao provedor foi realizada.

### 4.3 SMTP da aplicação

- host IONOS não local;
- porta `465` com configuração TLS implícita coerente;
- usuário e senha presentes como variáveis sensíveis de Production;
- `EMAIL_FROM` presente e com domínio;
- guard de SMTP local inseguro ausente.

Os valores secretos não são exportáveis pela inspeção segura da Vercel. A presença foi confirmada por metadata; nenhum segredo foi alterado.

## 5. Supabase Auth

### 5.1 Site URL e redirects

Site URL confirmada:

```text
https://bw-antecipa.better-with.tech
```

Allowlist final, derivada das chamadas `redirectTo` existentes no runtime:

```text
https://bw-antecipa.better-with.tech/auth/confirm
https://bw-antecipa.better-with.tech/convite/gestor
https://bw-antecipa.better-with.tech/redefinir-senha
```

O wildcard anterior foi removido. Não existem entradas de localhost ou homolog na allowlist final.

### 5.2 MFA/TOTP

TOTP já estava habilitado e foi preservado:

- enrollment: habilitado;
- verificação: habilitada;
- máximo hospedado: 10 fatores;
- nenhum fator foi criado, removido ou alterado para os 23 usuários.

O runtime certificado continua responsável por exigir AAL2 e manter a sessão operacional elevada por 24 horas.

### 5.3 Plano de rollout MFA para 23 usuários

Checklist operacional pronto, sem envio de comunicação neste ticket:

- [ ] nomear responsável pelo rollout e canal de suporte;
- [ ] comunicar data, impacto e janela de ativação aos perfis Gestor, Cedente, Sacado e Super Admin;
- [ ] enviar instruções para instalação de autenticador TOTP compatível;
- [ ] orientar primeiro login, leitura do QR code e confirmação do desafio;
- [ ] validar que o acesso operacional só é liberado após AAL2;
- [ ] informar a validade de 24 horas da sessão operacional elevada;
- [ ] documentar recuperação por código e guarda segura desses códigos;
- [ ] definir procedimento de perda/troca de dispositivo sem bypass de AAL2;
- [ ] preparar roteiro de suporte específico por perfil;
- [ ] acompanhar ativações e falhas sem registrar seeds, códigos ou segredos;
- [ ] executar piloto controlado antes do rollout dos 23 usuários;
- [ ] registrar conclusão e exceções na trilha operacional.

### 5.4 SMTP hospedado e templates

O Supabase Auth não possui Custom SMTP configurado. Host, usuário, senha, remetente e sender name estão ausentes. As credenciais SMTP da aplicação na Vercel são Secrets e não foram reutilizadas porque não há fonte segura que permita obtê-las neste ticket.

Resultado obrigatório:

```text
SUPABASE_AUTH_SMTP_READY = PENDENTE_SECRET
```

Compatibilidade dos templates ativos:

- recovery hospedado: alterado para fluxo scanner-safe por `token_hash` e `/auth/confirm`;
- convite Gestor: gerado pela aplicação com link scanner-safe, não pelo template hospedado de convite;
- convite Cedente: gerado pela aplicação com link scanner-safe, não pelo template hospedado de convite;
- confirmação hospedada: ainda usa `ConfirmationURL`, mas não há fluxo atual de `signUp` que a consuma;
- alteração de e-mail: template presente, sem mudança neste ticket.

Assim, os fluxos atualmente exercidos pelo runtime estão compatíveis. A ativação futura de confirmação hospedada deverá ser precedida por rota scanner-safe compatível e nova certificação.

## 6. Backup, PITR e restore isolado

### 6.1 Backup

Leitura revalidada no projeto de produção:

- região: `us-east-1`;
- WAL-G: habilitado;
- sete backups físicos diários listados;
- todos com status `COMPLETED`;
- backup mais recente observado: `2026-08-27T05:04:46.167Z`.

### 6.2 PITR

PITR permanece desabilitado. Como a ativação pode implicar add-on/cobrança e não houve aprovação comercial explícita, nenhuma alteração foi executada.

```text
PITR_READY = PENDENTE_APROVACAO_COMERCIAL
```

### 6.3 Restore lógico isolado

O exercício utilizou somente export read-only de produção e Docker local isolado:

1. export fresco e sanitizado: `32,828 s`;
2. primeira tentativa em stack local antiga: abortada por incompatibilidade de permissão, sem efeito em produção;
3. stack local antiga descartada e ambiente local recriado do zero;
4. restore no ambiente limpo: `4,058 s`;
5. baseline local validada sem divergências.

Tempo técnico observado de export + restore bem-sucedido: aproximadamente `36,886 s`, sem incluir provisionamento manual, download de objetos binários ou tomada de decisão operacional.

Baseline restaurada:

| Métrica | Quantidade |
|---|---:|
| Cedentes | 12 |
| Operações | 45 |
| Notas fiscais | 903 |
| Documentos metadata | 123 |
| Storage metadata | 1.635 |
| Auth users | 23 |
| Profiles | 23 |
| Histórico Fromtis | 26 |

Hash determinístico do baseline isolado:

```text
7678a7c1a5d9de92bc3d6752eb66ef5191212ae445509692241868d4782d55d6
```

Limitações: o exercício comprova restore lógico/local e metadata de Storage, não PITR hospedado nem restauração integral dos binários do Storage. O RPO corresponde ao instante do export fresco. O RTO operacional não está formalmente aceito e o owner ainda não foi definido.

## 7. Rollback

### 7.1 Aplicação

O usuário autenticado possui acesso ao projeto Vercel. O deployment atual permaneceu `READY` e o deployment anterior também está disponível para rollback.

Procedimento aprovado para a janela, mas não executado neste ticket:

1. confirmar incidente e correlation ID;
2. inspecionar o deployment anterior conhecido como `READY`;
3. executar rollback/promote pelo painel ou CLI da Vercel;
4. validar domínio, HTTP 200 e rotas críticas;
5. registrar deployment de origem/destino e horários.

### 7.2 Banco

O banco ainda não possui uma opção formalmente aceita:

- alternativa A: PITR não está habilitado;
- alternativa B: backup e restore isolado passaram, mas faltam owner e aceite formal do RTO.

```text
DB_ROLLBACK_READY = FAIL
```

## 8. Revalidação da produção

Preflight executado em transação explicitamente read-only em `2026-08-28T02:38:24Z`:

| Métrica | Esperado | Atual | Resultado |
|---|---:|---:|---|
| Fundos | 2 | 2 | PASS |
| Cedentes | 12 | 12 | PASS |
| Operações | 45 | 45 | PASS |
| Notas fiscais | 903 | 903 | PASS |
| Documentos | 123 | 123 | PASS |
| Storage metadata | 1.635 | 1.635 | PASS |
| Auth users | 23 | 23 | PASS |
| Profiles | 23 | 23 | PASS |
| Histórico Fromtis | 26 | 26 | PASS |

Os dois Cedentes do patch P3.1 continuam presentes, com CNPJ e estado esperados, sem operação ou NF. As oito verificações de integridade retornaram zero falhas, incluindo relações órfãs e pares Auth/Profile.

```text
PRODUCTION_BASELINE = STABLE
```

## 9. Freeze, hashes e disponibilidade

Hashes revalidados:

```text
APP_RELEASE_HASH = 60e7f5e82b7de28601839ce60325ba92365de3b515aacb269543e1fced0a4666
CUTOVER_BUNDLE_HASH = 52e9b35f126ba3ad7c34609fb45d9173400c2656828a67558eba6821bbb5bb50
DLZ_CUTOVER_CONFIG_HASH = 886a8346426ecda2f473dc2d768aacd6d62b1cca47663eac3fff1aa38e51e749
MIGRATIONS_PRODUCAO_CANONICAS_HASH = cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318
```

O deployment atual permaneceu `READY`, sem novo deploy. O domínio canônico respondeu HTTP `200` após as mudanças de configuração.

Os arquivos materiais do release continuam os definidos em `rehearsal/manifests/release-scopes.json`. Os artefatos P4.5 são documentação e automação de verificação fora dos hashes canônicos. O commit imutável permanece pendente porque este ticket proíbe commit/push.

## 10. Pendências para reavaliação de GO

1. fornecer a credencial de SMTP corporativo de produção por canal seguro e configurar Custom SMTP do Supabase Auth;
2. validar remetente, TLS e envio real de convite/recovery sem expor credenciais;
3. obter aprovação comercial para PITR, ou formalizar a alternativa de restore;
4. se a alternativa de restore for escolhida, nomear owner, aceitar RPO/RTO e incluir restauração dos binários de Storage no runbook;
5. autorizar e criar o commit imutável do RC somente após os gates externos passarem;
6. repetir o preflight read-only e o teste HTTP imediatamente antes do cutover.

Até que os itens 1 e 3/4 sejam concluídos, a decisão permanece:

```text
P4_5_INFRA_PRODUCAO = FAIL
CUTOVER_PRODUCAO = NO_GO
```

