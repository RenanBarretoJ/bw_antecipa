# P4.9 — Final Gate de SMTP Auth e produção

Status: `PASS`

Execução: 29/08/2026

Projeto Supabase de produção: `wwsndnuvnjuabpbjwlck`

Este relatório contém apenas evidências sanitizadas. Nenhuma senha, chave,
token, link Auth completo ou credencial SMTP foi persistido.

## 1. Decisão executiva

```text
SUPABASE_AUTH_SMTP_READY = PASS
AUTH_EMAIL_DELIVERY_TEST = PASS
AUTH_FINAL_READY = PASS

P4_9_FINAL_GATE = PASS
CUTOVER_PRODUCAO = GO_CONDICIONAL_COMMIT
```

O Custom SMTP do Supabase Auth foi configurado com a mesma conta corporativa
IONOS indicada pelo responsável pelo cutover. O recovery scanner-safe foi aceito
pelo Auth e o recebimento, remetente e domínio do link foram confirmados pelo
destinatário autorizado.

O GO continua condicionado exclusivamente à autorização e criação do commit
imutável. Nenhuma migration, patch de Cedentes, configurador DLZ, deploy, DML
operacional, chamada Sinqia/Terra, envio CNAB, commit ou push foi executado.

## 2. Canal seguro e ciclo da credencial

A credencial foi recebida por prompt protegido e armazenada temporariamente no
Windows Credential Manager com persistência restrita à sessão de logon.

O processo de configuração:

1. obteve da Vercel somente host, porta, TLS e remetente não secretos;
2. leu usuário e senha do Credential Manager diretamente em memória;
3. validou provedor IONOS, porta/TLS e compatibilidade do remetente;
4. enviou o PATCH administrativo ao Supabase;
5. inspecionou o estado hospedado de forma sanitizada;
6. removeu a credencial do Credential Manager;
7. removeu o arquivo temporário da Vercel em `finally`.

Após a conclusão:

- credencial temporária disponível: não;
- arquivos temporários restantes: zero;
- segredo versionado: não;
- segredo exibido em log ou relatório: não.

## 3. Configuração Custom SMTP

A inspeção administrativa após o PATCH confirmou:

| Campo | Resultado |
|---|---|
| Host não local | PASS |
| Provedor IONOS | PASS |
| Porta 465 | PASS |
| TLS implícito coerente | PASS |
| Usuário presente | PASS |
| Senha presente | PASS |
| Remetente administrativo presente | PASS |
| Sender name presente | PASS |

O remetente confirmado no recebimento foi `no-reply@better-with.tech`.

```text
SUPABASE_AUTH_SMTP_READY = PASS
```

## 4. Recovery controlado scanner-safe

Foi executada uma única solicitação de recovery para um usuário existente,
ativo, confirmado e autorizado. Nenhum usuário sintético foi criado.

Evidência Auth sanitizada:

- ação: `user_recovery_requested`;
- endpoint: `/recover`;
- status: `200`;
- horário do aceite: `2026-08-29T13:08:02Z`;
- redirect: rota de redefinição no domínio canônico de produção;
- template: `token_hash`, sem `ConfirmationURL` direta;
- segunda solicitação: não executada.

Confirmação humana do destinatário:

- recebimento normal: confirmado;
- remetente corporativo esperado: confirmado;
- domínio do link `bw-antecipa.better-with.tech`: confirmado;
- token/link completo registrado: não.

```text
AUTH_EMAIL_DELIVERY_TEST = PASS
```

## 5. Auth e MFA final

| Gate | Resultado |
|---|---|
| Site URL canônica de produção | PASS |
| Redirect allowlist exata | PASS |
| Recovery scanner-safe por `token_hash` | PASS |
| Custom SMTP IONOS | PASS |
| Entrega real de recovery | PASS |
| TOTP enrollment habilitado | PASS |
| TOTP verify habilitado | PASS |
| Máximo de fatores configurado | PASS |
| AAL2 e sessão elevada de 24 horas no runtime certificado | PASS |
| Rollout dos usuários no primeiro acesso | READY |

```text
AUTH_FINAL_READY = PASS
```

## 6. Preflight read-only final

Captura em `2026-08-29T13:08:54.710105Z`:

| Métrica | Atual | Esperado | Resultado |
|---|---:|---:|---|
| Fundos | 2 | 2 | PASS |
| Cedentes | 12 | 12 | PASS |
| Operações | 46 | 46 | PASS |
| Notas fiscais | 910 | 910 | PASS |
| Documentos | 123 | 123 | PASS |
| Storage metadata | 1.644 | 1.644 | PASS |
| Auth users | 23 | 23 | PASS |
| Profiles | 23 | 23 | PASS |
| Fromtis histórico | 26 | 26 | PASS |

As oito verificações críticas de órfãos e duplicidade permaneceram em zero. A
configuração SMTP alterou somente o Auth hospedado e não afetou dados
operacionais.

```text
PRODUCTION_BASELINE = STABLE
```

## 7. Hashes e freeze

```text
APP_RELEASE_HASH = 60e7f5e82b7de28601839ce60325ba92365de3b515aacb269543e1fced0a4666
CUTOVER_BUNDLE_HASH = dc7ef0d88a4dbde49107b62a30a906dcc675de6ae6ed3e9f274f6b2529289a90
MIGRATION_MANIFEST_HASH = cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318
DLZ_CONFIG_MANIFEST_HASH = 5833541e93b9f9213c21b300771f53b47de3cf06242b7afd5fb51b5c06202d6c
```

- APP_RELEASE: 724 arquivos canônicos, hash preservado;
- CUTOVER_BUNDLE: 20 arquivos canônicos, hash preservado;
- manifesto de migrations: 14 baseline, 3 bridges e 175 upgrades;
- nenhum relatório ou tooling P4.9 contaminou o APP_RELEASE;
- nenhuma `.env`, massa sintética, dump ou credencial integra o freeze.

```text
APP_RELEASE_HASH_READY = PASS
CUTOVER_BUNDLE_HASH_READY = PASS
DLZ_CUTOVER_CONFIG_READY = PASS
RC_FREEZE_PLAN = READY
RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO
```

## 8. Rollback preservado

Os gates certificados no P4.8 permanecem válidos:

```text
RESTORE_OWNER = DEFINED
RTO_EVIDENCE = CONFIRMADO
DB_RECOVERY_MODE = BACKUP_RESTORE_ALTERNATIVO
PITR_READY = NAO_DISPONIVEL_BACKUP_ALTERNATIVO_APROVADO
DB_ROLLBACK_READY = PASS
```

## 9. Resultado final

Todos os gates técnicos exigidos para o estado condicional passaram. O próximo
passo permitido é somente a autorização explícita do commit imutável; o cutover
em si continua dependendo da janela e do runbook aprovados.

```text
P4_9_FINAL_GATE = PASS
CUTOVER_PRODUCAO = GO_CONDICIONAL_COMMIT
```
