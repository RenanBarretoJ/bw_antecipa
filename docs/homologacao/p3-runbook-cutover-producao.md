# P3 — Runbook de cutover para produção

> Para o cutover fechado do fundo DLZ/HEALTH, usar o runbook atualizado em `docs/homologacao/p3-1-dlz-health-release-candidate.md`. IMPULSE não bloqueia o primeiro rollout.

Este runbook não autoriza execução enquanto `CUTOVER_PRODUCAO` estiver `NO_GO`.

## Papéis mínimos

- executor de banco;
- revisor independente;
- responsável de aplicação/Vercel;
- responsável de negócio por fundos e Cedentes;
- suporte/Auth;
- responsável de rollback.

## Pré-janela

1. congelar o commit do release candidate e registrar seu hash;
2. validar `rehearsal/manifests/production-migrations.json` e seu SHA-256;
3. obter aprovação dos vínculos, políticas, templates, CNAB, integrações e risco;
4. preparar data patches idempotentes e revisados, se aprovados;
5. provisionar secrets no cofre/ambiente, nunca em SQL comum;
6. confirmar a opção B de rollback, o owner da restauração e o RPO/RTO formalmente aceitos;
7. agendar congelamento de novas operações e comunicação aos usuários;
8. confirmar commit anterior disponível para redeploy.

## Sequência da janela

1. ativar modo de manutenção ou congelar novas operações;
2. registrar timestamp e correlation ID da janela;
3. bloquear e comprovar ausência de DML operacional;
4. capturar baseline somente leitura: 12 Cedentes, 46 operações, 910 NFs, 123 documentos, 1.644 metadados Storage, 23 usuários/profiles e 26 operações Fromtis;
5. gerar dump lógico fresco, sanitizado e read-only antes de qualquer migration;
6. registrar início/fim, timestamp da origem e hash SHA-256 de cada artefato;
7. armazenar os artefatos fora do Git e validar seus checksums;
8. validar novamente o manifesto e as cinco exclusões;
9. somente depois de o backup ser aprovado, aplicar as três bridges na ordem canônica;
10. aplicar as 175 migrations promovíveis, uma a uma, com `ON_ERROR_STOP` e registro de cada versão;
11. executar pós-check de schema, grants, RLS, triggers, contagens e integridade;
12. aplicar somente data patches previamente aprovados e idempotentes;
13. criar/publicar as configurações aprovadas de cada fundo;
14. validar política, templates, CNAB/golden file, integração e risco sem envio externo;
15. somente após banco aprovado, realizar deploy da aplicação;
16. executar smoke autenticado de Super Admin, Gestor, Cedente e Sacado;
17. executar nova operação controlada até o ponto anterior à saída externa;
18. liberar novas operações e manter monitoramento reforçado.

## Comandos de rehearsal

```bash
npm run rehearsal:release:manifest:validate
npm run rehearsal:release:dry-run
npm run rehearsal:runtime:prepare
npm run rehearsal:runtime:start
npm run rehearsal:runtime:audit
npm run rehearsal:runtime:browser
npm run rehearsal:runtime:invites
```

Os scripts de rehearsal rejeitam destino remoto. Eles não são um mecanismo para aplicar produção.

## P4.7 — checkpoint obrigatório da opção B

O modo de recuperação aprovado para esta janela é `BACKUP_RESTORE_ALTERNATIVO`; PITR não será habilitado. O RPO é o estado capturado no dump lógico final imediatamente anterior ao cutover.

Antes de autorizar a primeira migration, o executor e o revisor devem registrar no log da janela:

- correlation ID;
- confirmação do freeze de DML;
- timestamp inicial e final do backup;
- hash SHA-256 de cada artefato;
- local externo ao Git onde os artefatos foram armazenados;
- resultado da validação de checksums;
- owner do restore presente e disponível: o usuário responsável pelo cutover durante toda a janela;
- canal de acionamento registrado no log operacional/war room da janela, associado ao correlation ID e sem PII desnecessária;
- RTO máximo de 30 minutos aceito pelo responsável de negócio e pelo responsável técnico.

Se ocorrer qualquer DML entre o freeze e o término do backup, o checkpoint é inválido. Deve-se manter o freeze, descartar o artefato anterior e gerar novo dump completo. Nenhuma migration pode começar com backup ausente, incompleto ou sem checksum válido.

## Gates de liberação

- manifesto e hashes conferidos;
- baseline histórico sem divergência;
- zero migration bloqueada;
- dois Cedentes sem fundo decididos;
- configurações dos dois fundos publicadas;
- secrets provisionados e testados;
- RLS multifundo aprovado;
- Storage histórico acessível;
- login/MFA/convites aprovados;
- operação controlada aprovada sem efeito externo;
- rollback disponível.

## P4.2 — configuração operacional DLZ/HEALTH

Esta etapa é futura e somente pode ocorrer depois das migrations promovíveis, do patch P3.1 dos Cedentes e de um preflight aprovado por dois revisores. O executor não aplica migrations, não altera ambiente, não grava secrets e não chama a Sinqia/Terra.

Pré-condições adicionais:

1. `P4_1_INFRA_PRODUCAO = PASS`, incluindo backup/PITR, restore/RTO e rollback;
2. manifesto de migrations `cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318` validado;
3. manifesto DLZ `5833541e93b9f9213c21b300771f53b47de3cf06242b7afd5fb51b5c06202d6c` revisado;
4. preflight SQL executado sem divergência e seu hash registrado na janela;
5. 12 Cedentes ativos resolvendo para o DLZ;
6. cinco migrations exclusivas de homologação ausentes;
7. dois revisores presentes e correlation ID registrado.

Executar primeiro em modo somente leitura:

```powershell
node rehearsal/scripts/configure-dlz-production.mjs --plan --target=production --fundo-id=7a114257-7816-468e-adf4-d796b93364df --project-ref=wwsndnuvnjuabpbjwlck
```

Somente durante a janela formal, com as variáveis server-side temporárias `NEXT_PUBLIC_APP_ENV=production`, `DLZ_PRODUCTION_DB_URL`, `DLZ_PRODUCTION_PREFLIGHT_APPROVED=true`, `DLZ_PRODUCTION_PREFLIGHT_HASH=<HASH_DA_EVIDENCIA_APROVADA>` e `ALLOW_DLZ_PRODUCTION_CONFIG=true`, o comando futuro é:

```powershell
node rehearsal/scripts/configure-dlz-production.mjs --apply --target=production --fundo-id=7a114257-7816-468e-adf4-d796b93364df --project-ref=wwsndnuvnjuabpbjwlck --manifest-hash=5833541e93b9f9213c21b300771f53b47de3cf06242b7afd5fb51b5c06202d6c --release-manifest-hash=cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318 --preflight-hash=<HASH_DA_EVIDENCIA_APROVADA> --correlation-id=<UUID_DA_JANELA> --confirm=DLZ_HEALTH_PRODUCTION_CUTOVER
```

Em seguida, remover a flag temporária de janela e executar `--verify` em modo somente leitura. Qualquer conflito aborta integralmente; não corrigir estado divergente por overwrite durante a janela.
