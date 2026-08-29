# P4.8 — Recertificação final da baseline, rollback e SMTP Auth

Status: `CONCLUÍDO_COM_NO_GO`

Execução: 29/08/2026

Projeto Supabase de produção: `wwsndnuvnjuabpbjwlck`

Este documento registra somente evidências sanitizadas. Nenhum token, senha,
service role, connection string, endereço SMTP de usuário ou link Auth foi
persistido.

## 1. Decisão executiva

```text
P4_8_FINAL_READINESS = FAIL
CUTOVER_PRODUCAO = NO_GO
```

A nova baseline `46/910/1.644` foi comprovada como evolução operacional legítima
do DLZ/HEALTH, recertificada e reproduzida deterministicamente em dois ciclos
locais. Owner, RTO e rollback alternativo também foram fechados.

O único bloqueio técnico remanescente é o Custom SMTP do Supabase Auth. A Vercel
confirma os dois Secrets SMTP da aplicação, mas impede sua exportação e devolve
marcadores protegidos. Como o ticket proíbe inferir ou copiar credenciais de
outra origem, nenhuma configuração parcial foi enviada ao Supabase. Sem SMTP
Auth não foi permitido disparar o teste real de entrega.

Nenhuma migration, patch de Cedentes, configurador DLZ, deploy, DML operacional,
chamada Sinqia/Terra, envio CNAB, commit ou push foi executado em produção.

## 2. Flags finais

```text
DELTA_DLZ_VALIDATED = PASS
BASELINE_CANONICA = 46_910_1644_CERTIFICADA
PATCH_CEDENTES_DLZ_CURRENT_STATE = PASS
LATEST_BASELINE_REHEARSAL = DETERMINISTICO

RESTORE_OWNER = DEFINED
RTO_EVIDENCE = CONFIRMADO
DB_RECOVERY_MODE = BACKUP_RESTORE_ALTERNATIVO
PITR_READY = NAO_DISPONIVEL_BACKUP_ALTERNATIVO_APROVADO
DB_ROLLBACK_READY = PASS

SUPABASE_AUTH_SMTP_READY = PENDENTE_SECRET
AUTH_EMAIL_DELIVERY_TEST = NA
AUTH_FINAL_READY = FAIL

PRODUCTION_BASELINE = STABLE
APP_RELEASE_HASH_READY = PASS
CUTOVER_BUNDLE_HASH_READY = PASS
DLZ_CUTOVER_CONFIG_READY = PASS
RC_FREEZE_PLAN = READY
RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO
```

## 3. Validação do delta DLZ

O intervalo posterior ao snapshot anterior contém exatamente:

| Entidade | Delta | Classificação |
|---|---:|---|
| Operações | +1 | DLZ/HEALTH, status reconhecido, Cedente válido |
| Notas fiscais | +7 | DLZ/HEALTH, Cedente e CNPJ consistentes |
| Storage metadata | +9 | 7 objetos de NF e 2 contratos referenciados |

A operação nova possui uma NF vinculada. Das sete NFs novas, seis estão
canceladas e uma está em antecipação; ambos são estados válidos no domínio.
Todos os objetos de NF conferem com o caminho documental registrado, e os dois
objetos de contrato estão referenciados por Cedentes existentes.

As verificações retornaram:

- zero registro do delta no IMPULSE;
- zero órfão crítico;
- zero status desconhecido;
- zero inconsistência de fundo ou CNPJ;
- zero marcador de massa sintética, mock ou rehearsal.

As linhas e os checks sanitizados estão em
`docs/homologacao/p4-8-delta-baseline-read-only.json`.

```text
DELTA_DLZ_VALIDATED = PASS
```

## 4. Baseline canônica recertificada

Captura final read-only em `2026-08-29T12:14:48.160485Z`:

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

Oito verificações de integridade permaneceram em zero: operações/NFs sem
Cedente, documentos com Cedente órfão, duas direções de órfãos em operação × NF,
Auth sem profile, profile sem Auth e CNPJ duplicado.

Hash lógico do clone-base sanitizado:

```text
42497138be30818ffaa42950b5f640fd28906e6a0ef5305439e61ace660703ea
```

```text
BASELINE_CANONICA = 46_910_1644_CERTIFICADA
PRODUCTION_BASELINE = STABLE
```

## 5. Patch dos Cedentes

Os dois Cedentes-alvo foram revalidados contra o estado atual:

- ambos existem, estão ativos e possuem CNPJ compatível com a precondição;
- ambos já estão vinculados corretamente ao DLZ no campo legado;
- o primeiro agora possui uma operação e sete NFs;
- o segundo não possui operação ou NF;
- nenhum possui evidência operacional em outro fundo.

O patch já é adaptativo e idempotente: antes de inserir, verifica conflito com
outro fundo e a existência do vínculo DLZ ativo. No estado atual, ambos são
tratados como `already_satisfied`; não há remoção, duplicação, movimentação nem
sobrescrita de histórico. Nenhuma migration foi alterada nesta recertificação.

```text
PATCH_CEDENTES_DLZ_CURRENT_STATE = PASS
```

## 6. Rehearsal com dump fresco

O dump read-only fresco do P4.7 foi restaurado e processado em dois ciclos
limpos. Cada ciclo executou bridges, 175 migrations, patch adaptativo,
configurador DLZ, postflight e validações de runtime sem saída externa.

Resultados dos dois ciclos:

- configuração DLZ aplicada uma vez e reconhecida como equivalente na repetição;
- 46/46 detalhes de operações auditados;
- 910/910 NFs auditadas;
- 3/3 buckets esperados;
- E2E Sacado aprovado;
- golden/CNAB local aprovado;
- zero resíduo sintético;
- mesmo hash lógico pós-upgrade nos dois ciclos.

Hash pós-upgrade determinístico:

```text
baa121730a49d26ca2ba9a961bca2f9a2836c65124f317be59c182d25f0196de
```

```text
LATEST_BASELINE_REHEARSAL = DETERMINISTICO
```

## 7. Owner, RTO e rollback

O runbook agora registra formalmente:

- owner: usuário responsável pelo cutover;
- disponibilidade: toda a janela de mudança;
- autoridade: decidir e acionar o restore quando um gatilho objetivo ocorrer;
- canal: log operacional/war room da janela, com correlation ID e sem PII
  desnecessária.

O RTO máximo aceito é de 30 minutos. Ele cobre banco lógico, metadata,
validações, decisão, redeploy e smoke. Não representa restauração de binários de
Storage removidos fora do banco. A janela de fim de semana reduz impacto, mas
não altera o RTO nem relaxa gates.

Evidências técnicas mais recentes:

- restore do drill: aproximadamente 4,5 segundos;
- drill completo: aproximadamente 5,1 segundos;
- exercício amplo anterior: aproximadamente 36,9 segundos;
- hash antes e depois do restore: idêntico;
- órfãos críticos após restore: zero.

O tooling de restore foi endurecido para remover os schemas `private` e `public`
com o papel local adequado antes de restaurar Auth, evitando cascatas contra
objetos de migrations em execuções recorrentes. A guarda continua aceitando
somente o alvo local de rehearsal.

```text
RESTORE_OWNER = DEFINED
RTO_EVIDENCE = CONFIRMADO
DB_RECOVERY_MODE = BACKUP_RESTORE_ALTERNATIVO
PITR_READY = NAO_DISPONIVEL_BACKUP_ALTERNATIVO_APROVADO
DB_ROLLBACK_READY = PASS
```

## 8. Supabase Auth SMTP

Foi preparado um configurador fail-closed que:

1. obtém as variáveis Production pelo canal autenticado da Vercel;
2. mantém o arquivo exclusivamente no diretório temporário do sistema;
3. exige host IONOS, porta/TLS coerentes, conta, senha e remetente compatível;
4. só então enviaria o PATCH administrativo ao Supabase;
5. restaura o ambiente do processo e remove o arquivo temporário em `finally`;
6. retorna apenas o estado sanitizado da configuração.

A Vercel retornou os campos sensíveis como `[SENSITIVE]`, pois Secrets não são
exportáveis. A validação bloqueou a execução antes do PATCH. A inspeção posterior
do Supabase confirmou que o Custom SMTP continua ausente. Não houve configuração
parcial e não restou arquivo temporário.

Não foi usada a credencial de homologação, não foi inferida senha a partir de
logs e não houve rotação ou alteração do SMTP da aplicação.

```text
SUPABASE_AUTH_SMTP_READY = PENDENTE_SECRET
AUTH_EMAIL_DELIVERY_TEST = NA
```

Para fechar o gate, `SMTP_USER` e `SMTP_PASSWORD` da mesma conta Production devem
ser disponibilizados ao processo por um canal seguro não versionado. Depois
disso, executar o configurador e um único recovery scanner-safe para destinatário
autorizado, confirmando recebimento sem registrar o link.

## 9. Auth e MFA

A revalidação administrativa confirmou:

- Site URL canônica de produção: PASS;
- três redirects exatos: PASS;
- recovery com `token_hash` e rota intermediária: PASS;
- TOTP enrollment e verify habilitados: PASS;
- limite de dez fatores: PASS;
- rollout dos 23 usuários para setup no primeiro acesso: pronto;
- AAL2 e sessão elevada de 24 horas: preservados no runtime certificado.

Como Custom SMTP e entrega real são requisitos obrigatórios deste gate:

```text
AUTH_FINAL_READY = FAIL
```

## 10. Hashes canônicos

```text
APP_RELEASE_HASH = 60e7f5e82b7de28601839ce60325ba92365de3b515aacb269543e1fced0a4666
CUTOVER_BUNDLE_HASH_ANTERIOR = 8766ba0129c764ab1aaa8a7a88ad26f148f1fc808188e2e36fed915d20636fa0
CUTOVER_BUNDLE_HASH_ATUAL = dc7ef0d88a4dbde49107b62a30a906dcc675de6ae6ed3e9f274f6b2529289a90
MIGRATION_MANIFEST_HASH = cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318
DLZ_CONFIG_MANIFEST_HASH = 5833541e93b9f9213c21b300771f53b47de3cf06242b7afd5fb51b5c06202d6c
```

O APP_RELEASE permaneceu idêntico, com 724 arquivos canônicos. O CUTOVER_BUNDLE
foi recalculado porque runbooks, baseline esperada e manifesto DLZ mudaram de
forma deliberada; continua contendo exatamente 20 arquivos. O manifesto de
migrations permaneceu idêntico.

```text
APP_RELEASE_HASH_READY = PASS
CUTOVER_BUNDLE_HASH_READY = PASS
DLZ_CUTOVER_CONFIG_READY = PASS
```

## 11. Freeze plan e futuro commit

No estado desta execução, os arquivos alterados classificam-se em três grupos:

- 15 arquivos materiais de APP_RELEASE;
- 5 arquivos materiais de CUTOVER_BUNDLE;
- evidências e tooling de P1 a P4.8, fora dos hashes materiais.

O futuro commit imutável deve conter somente:

1. os arquivos materiais explicitamente listados em
   `rehearsal/manifests/release-scopes.json` que estão alterados;
2. o próprio manifesto de escopos e os manifestos de migrations/DLZ;
3. tooling, testes e relatórios de certificação P1–P4.8;
4. nenhuma `.env`, dump, diretório temporário, credencial, massa sintética ou
   artefato de runtime local.

```text
RC_FREEZE_PLAN = READY
RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO
```

## 12. Validações executadas

- delta read-only por operação, NF, Storage, fundo, Cedente e CNPJ;
- preflight final read-only após a tentativa de configuração SMTP;
- restore e rollback drill;
- dois ciclos completos do latest-baseline rehearsal;
- runtime 46/46 operações e 910/910 NFs;
- E2E Sacado;
- CNAB local;
- manifesto de migrations;
- manifesto e hash DLZ;
- manifesto de escopos e hashes APP/CUTOVER;
- testes de artefatos P4.8 e testes de rehearsal;
- secret scan;
- `git diff --check`.

O build não foi repetido porque o APP_RELEASE_HASH permaneceu idêntico ao release
já certificado.

## 13. Parecer final

A baseline, o patch, o rehearsal, o rollback, owner, RPO/RTO, DLZ e os hashes
estão prontos. O release ainda não pode receber `GO_CONDICIONAL_COMMIT` porque o
Custom SMTP do Auth e o teste de entrega não foram concluídos. A postura correta
é fail-closed:

```text
P4_8_FINAL_READINESS = FAIL
CUTOVER_PRODUCAO = NO_GO
```

Quando a credencial Production for fornecida ao processo por canal seguro, a
retomada é limitada a configurar/inspecionar SMTP Auth, executar um recovery
controlado, recapturar a baseline read-only, revalidar hashes e atualizar este
parecer. Nenhuma migration, patch operacional ou novo rehearsal será necessário
se esses estados permanecerem estáveis.
