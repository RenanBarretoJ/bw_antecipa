# P4.7 — Final Readiness por backup + restore alternativo

Status: `CONCLUÍDO_COM_NO_GO`

Correlation ID: `492afa55-b0f9-4606-82c4-8ff38b8ca59d`

Execução: 29/08/2026

Projeto Supabase de produção: `wwsndnuvnjuabpbjwlck`

Este relatório contém somente evidências sanitizadas. Nenhum token, senha, service role, connection string ou credencial SMTP/Fromtis foi registrado.

## 1. Decisão executiva

```text
P4_7_FINAL_READINESS = FAIL
CUTOVER_PRODUCAO = NO_GO
```

A opção B foi formalmente adotada pelo solicitante e o mecanismo técnico de restore foi comprovado por drill local. Entretanto, permanecem pendentes o owner, o aceite do RTO e o Custom SMTP do Supabase Auth. Além disso, a baseline de produção mudou materialmente desde o P4.6, criando um bloqueio adicional que impede o estado condicional.

Nenhuma migration, configuração DLZ, alteração operacional, deploy, chamada Sinqia/Terra, envio CNAB, commit ou push foi executado.

## 2. Flags finais

```text
DB_RECOVERY_MODE = BACKUP_RESTORE_ALTERNATIVO
PITR_READY = NAO_DISPONIVEL_BACKUP_ALTERNATIVO_APROVADO
PRE_CUTOVER_BACKUP_PLAN = PASS
RPO_EVIDENCE = CONFIRMADO
RESTORE_CAPABILITY_READY = PASS
RESTORE_OWNER = MISSING
RTO_EVIDENCE = PENDENTE_ACEITE
RESTORE_RUNBOOK = READY
ROLLBACK_DRILL = PASS
DB_ROLLBACK_READY = FAIL

SUPABASE_AUTH_SMTP_READY = PENDENTE_SECRET
AUTH_EMAIL_DELIVERY_TEST = NA
AUTH_MFA_READY = PASS_WITH_ROLLOUT

PRODUCTION_BASELINE = RISK
APP_RELEASE_HASH_READY = PASS
CUTOVER_BUNDLE_HASH_READY = PASS
DLZ_CUTOVER_CONFIG_READY = PASS
RC_FREEZE_PLAN = READY
RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO
```

## 3. Decisão de recuperação

O solicitante confirmou que PITR não será requisito para este cutover. A estratégia aceita é:

```text
freeze de DML
→ preflight read-only
→ dump lógico final
→ checksums e armazenamento externo ao Git
→ migrations somente após aprovação do backup
→ restore pelo owner se um gatilho objetivo ocorrer
```

PITR permaneceu desabilitado e nenhuma contratação foi solicitada.

## 4. Plano de backup pré-cutover

O runbook de cutover foi atualizado com um checkpoint impeditivo anterior à primeira migration:

1. ativar modo de manutenção ou congelar novas operações;
2. registrar correlation ID e comprovar ausência de DML;
3. executar o preflight read-only;
4. gerar dump lógico fresco de produção;
5. registrar início, fim e timestamp da origem;
6. calcular SHA-256 de cada artefato;
7. armazenar os artefatos fora do Git;
8. validar todos os checksums;
9. exigir owner presente e RTO aceito;
10. liberar migrations somente depois da aprovação do checkpoint.

Se houver DML entre o freeze e o término validado do backup, o artefato deve ser descartado e recriado com o freeze mantido.

```text
PRE_CUTOVER_BACKUP_PLAN = PASS
```

O backup executado neste P4.7 foi evidência de rehearsal, não substitui o backup final da janela.

## 5. RPO e RTO

### 5.1 RPO

Definição formal aprovada no escopo:

```text
RPO = estado capturado no backup final imediatamente anterior ao cutover
```

O runbook bloqueia DML entre o início do freeze e a validação do backup. Isso torna o ponto capturado determinístico e auditável.

```text
RPO_EVIDENCE = CONFIRMADO
```

### 5.2 RTO

Medições técnicas disponíveis:

- export + restore do P4.5: aproximadamente `36,886 s`;
- drill P4.7 completo: `5,251 s`;
- restore dentro do drill P4.7: `4,594 s`.

Proposta conservadora:

```text
RTO_RECOMENDADO = 30 minutos para banco lógico + metadata
```

A proposta reserva tempo para decisão, execução, validações, redeploy anterior e smoke. Ela não cobre recuperação integral dos objetos binários do Storage. O número é uma recomendação operacional, não uma evidência de produção e ainda depende de aceite explícito do responsável.

```text
RTO_EVIDENCE = PENDENTE_ACEITE
```

## 6. Owner do restore

Não foi informado responsável com:

- nome ou função;
- canal de acionamento;
- disponibilidade durante a janela;
- autoridade para decidir o restore.

O agente não pode inventar ou assumir essa responsabilidade.

```text
RESTORE_OWNER = MISSING
```

## 7. Runbook e gatilhos

O runbook agora exige restore quando houver, entre outros:

- falha de migration depois do início da cadeia material;
- divergência no postflight;
- regressão de RLS que afete histórico;
- divergência de contagens;
- falha crítica de Auth;
- indisponibilidade de Storage histórico;
- falha da configuração DLZ;
- rollback da aplicação insuficiente porque o banco já mudou.

Sequência de resposta:

```text
manter freeze
→ interromper aplicação nova
→ registrar falha
→ validar backup final
→ owner decide restore
→ restaurar
→ validar invariantes
→ redeploy anterior
→ smoke histórico e multifundo
→ reabrir somente após aprovação
```

Down-migrations improvisadas permanecem proibidas.

```text
RESTORE_RUNBOOK = READY
```

## 8. Rollback drill local

### 8.1 Execução aprovada

Alvo fixo e protegido:

```text
local-only — 127.0.0.1:55322
```

Sequência executada:

1. checksums do clone-base validados;
2. baseline original capturada;
3. tabela marcadora e alteração sintética criadas no clone;
4. divergência do hash comprovada;
5. snapshot restaurado;
6. tabela marcadora removida pelo restore;
7. registro alterado retornou ao conteúdo original;
8. hash original e invariantes revalidados.

Evidência do drill:

| Item | Resultado |
|---|---|
| Início | `2026-08-29T11:26:09.484Z` |
| Fim | `2026-08-29T11:26:14.736Z` |
| Duração total | `5,251 s` |
| Restore | `4,594 s` |
| Hash antes | `319d6d21d7b5f8f0948488e679400d97a3809c99735a2384bcfbf8067989b09c` |
| Hash mutado | `f34acd0e8f60861e8883cf25aca9163fec621585840acb64540be752cd79fb46` |
| Hash restaurado | `319d6d21d7b5f8f0948488e679400d97a3809c99735a2384bcfbf8067989b09c` |
| Órfãos críticos após restore | 0 |

O drill também revelou e corrigiu uma falha de recorrência do tooling local: depois do primeiro restore, o schema `public` pertence a `supabase_admin`; restores seguintes agora removem o schema com esse mesmo papel local. A guarda continua bloqueando qualquer destino diferente do rehearsal local.

```text
ROLLBACK_DRILL = PASS
RESTORE_CAPABILITY_READY = PASS
```

## 9. Dump fresco e rehearsal mínimo

O preflight final encontrou uma baseline diferente da certificada. Conforme o gate, foi executado novo export read-only de produção e restore no ambiente local.

Snapshot fresco:

- gerado em `2026-08-29T11:28:39.367Z`;
- quatro artefatos com checksum;
- manifesto SHA-256 `e842445009830ab46b7ff1d625aa791805bce025ac0d3ed9c105c7308184cf2a`;
- 23 usuários Auth sanitizados;
- armazenado em diretório ignorado pelo Git.

O restore fresco concluiu, mas o comparador identificou três divergências em relação à baseline canônica:

| Métrica | Canônica | Atual | Delta |
|---|---:|---:|---:|
| Operações | 45 | 46 | +1 |
| Notas fiscais | 903 | 910 | +7 |
| Storage metadata | 1.635 | 1.644 | +9 |

Permaneceram iguais:

- 12 Cedentes;
- 123 documentos;
- 23 Auth users/profiles;
- 26 operações históricas Fromtis;
- oito verificações de órfãos com zero falhas.

Um Cedente do patch P3.1 agora possui vínculo, operação e NF; o segundo continua sem operação/NF. Isso pode refletir evolução operacional legítima, mas não pode ser presumido nem incorporado à baseline sem revisão.

Hash da nova baseline local:

```text
40396ea43cb2b6624294d1aa673c050b4c27049b309b127cbbd89717be951358
```

```text
PRODUCTION_BASELINE = RISK
```

É necessária classificação humana das mudanças e recertificação mínima da baseline antes do GO.

## 10. Supabase Auth e MFA

O Custom SMTP hospedado continua ausente. Nenhuma credencial segura explicitamente destinada ao Supabase Auth foi fornecida, e os Secrets SMTP da aplicação não foram inferidos nem copiados.

```text
SUPABASE_AUTH_SMTP_READY = PENDENTE_SECRET
AUTH_EMAIL_DELIVERY_TEST = NA
```

O teste de e-mail Auth não foi executado porque depende de SMTP aprovado.

Revalidação MFA/Auth:

- Site URL canônica: PASS;
- três redirects exatos: PASS;
- recovery scanner-safe: PASS;
- TOTP enrollment/verify: habilitados;
- 23 usuários preservados para setup no primeiro acesso;
- AAL2 e sessão elevada de 24 horas permanecem responsabilidades do runtime certificado;
- plano de rollout: pronto.

```text
AUTH_MFA_READY = PASS_WITH_ROLLOUT
```

## 11. Infraestrutura revalidada

- Vercel Production Env: PASS;
- `APP_BASE_URL`: PASS;
- `NEXT_PUBLIC_APP_ENV`: PASS;
- `INTEGRATION_RUNTIME_ENV`: PASS;
- Sinqia/Terra env: PASS, sem chamada externa;
- SMTP da aplicação: PASS;
- backup físico mais recente: `2026-08-29T05:08:55.284Z`, status `COMPLETED`;
- deployment atual: `READY`;
- domínio canônico: HTTP `200`;
- rollback da aplicação: PASS.

## 12. Hashes e freeze plan

O runbook faz parte do CUTOVER_BUNDLE. Por isso, a atualização operacional alterou deliberadamente apenas esse hash:

```text
APP_RELEASE_HASH = 60e7f5e82b7de28601839ce60325ba92365de3b515aacb269543e1fced0a4666
CUTOVER_BUNDLE_HASH_ANTERIOR = 52e9b35f126ba3ad7c34609fb45d9173400c2656828a67558eba6821bbb5bb50
CUTOVER_BUNDLE_HASH_ATUAL = 8766ba0129c764ab1aaa8a7a88ad26f148f1fc808188e2e36fed915d20636fa0
MIGRATION_MANIFEST_HASH = cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318
DLZ_CONFIG_MANIFEST_HASH = 886a8346426ecda2f473dc2d768aacd6d62b1cca47663eac3fff1aa38e51e749
```

O APP_RELEASE permaneceu idêntico. O bundle continua com 20 arquivos canônicos e o manifesto registra SHA-256 individual de cada um.

O freeze futuro deve incluir apenas os arquivos materiais previstos pelo manifesto. Scripts/testes P4.7 e relatórios são evidências separadas e não integram o APP_RELEASE.

```text
APP_RELEASE_HASH_READY = PASS
CUTOVER_BUNDLE_HASH_READY = PASS
DLZ_CUTOVER_CONFIG_READY = PASS
RC_FREEZE_PLAN = READY
RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO
```

## 13. Por que DB_ROLLBACK ainda falha

Apesar de plano, RPO, runbook, restore e drill aprovados, a regra exige todos os gates:

- backup plan: PASS;
- RPO: CONFIRMADO;
- restore: PASS;
- owner: MISSING;
- RTO: PENDENTE_ACEITE;
- runbook: READY;
- drill: PASS.

```text
DB_ROLLBACK_READY = FAIL
```

## 14. Próximas decisões obrigatórias

1. classificar e aprovar, ou rejeitar, os deltas `+1/+7/+9` da baseline;
2. se legítimos, atualizar a baseline canônica e repetir o drill contra o novo clone;
3. definir owner com função, canal, disponibilidade e autoridade;
4. aceitar ou ajustar o RTO recomendado;
5. fornecer Custom SMTP Auth por canal seguro e executar um teste controlado;
6. repetir preflight e hashes após as decisões;
7. somente então solicitar autorização para o commit imutável.

Até que isso ocorra:

```text
P4_7_FINAL_READINESS = FAIL
CUTOVER_PRODUCAO = NO_GO
```

