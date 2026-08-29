# P3.1 — DLZ/HEALTH Release Candidate

## Parecer executivo

`P3_1_DLZ_HEALTH_RELEASE_CANDIDATE = PASS`

O clone certificado de produção foi reconstruído duas vezes a partir do dump original. Em ambos os ciclos, as três bridges e as 175 migrations promovíveis produziram o hash pós-upgrade `fd73b40b2ab55cd0647a328bb6c83dea65f02e837d59c30252607ca8f68c4b9d`, o patch dos dois Cedentes foi aplicado e o resultado operacional DLZ foi semanticamente idêntico.

Produção real permaneceu estritamente read-only. Não houve deploy, aplicação de migration, alteração de secret ou chamada externa.

## Escopo confirmado

- DLZ/HEALTH é o único fundo operacional do primeiro cutover.
- Os 12 Cedentes resolvem para o DLZ; os dois vínculos pendentes são tratados por patch idempotente com precondições de ID/CNPJ.
- As 45 operações, 903 NFs, 123 documentos, 1.635 metadados de Storage, 23 usuários/profiles e 26 remessas históricas permanecem intactos.
- IMPULSE permanece cadastrado como `NOT_CONFIGURED`, sem operação ou configuração inferida, e não bloqueia o cutover DLZ.

## Configuração DLZ no clone

| Domínio | Resultado | Decisão |
|---|---|---|
| Política | PASS | aceite do sacado obrigatório; cessão no desembolso; sem requisitos novos |
| Risco/financeiro | N/A | gate de risco, PL e exposição desabilitados |
| Templates | COMPAT_LEGADO | templates locais e fallback atual preservados; histórico não convertido |
| CNAB | PASS | CNAB444 H/D/T, originador textual preservado e golden local válido |
| Integração | PASS | somente `CESSAO_ENVIO`; envio continua por `FROMTIS_*` |
| Credenciais | PASS arquitetural | nenhuma credencial copiada ao banco; valores não foram lidos nem registrados |

O objeto versionado de integração é apenas o read-model mínimo exigido pelo runtime atual. A configuração `runtime_mode=legacy_env_sinqia_terra` autoriza a compatibilidade somente para o adapter `sinqia_portal_fidc` e capability `CESSAO_ENVIO`. Outras capabilities continuam fail-closed sem credencial versionada.

## E2E controlado

O teste executou no clone, com claims autenticados contra as RPCs canônicas:

```text
Cedente DLZ
  → NF sintética aprovada
  → solicitação com snapshot imutável
  → aceite_sacado_status = pendente
  → Sacado aceita
  → aceite_sacado_status = aceito
  → Gestor aprova
  → operação = aprovada
```

Também foi validada a contestação: a operação permaneceu solicitada e recebeu `aceite_sacado_status=contestado`. Nenhum registro sintético persistiu; o cenário inteiro foi encerrado com `ROLLBACK`. O teste parou antes de qualquer envio externo.

O smoke browser autenticado passou em 3/3 contextos (Gestor/Super Admin, Cedente e Sacado) e abriu 45/45 detalhes das operações históricas sem erro de runtime.

## CNAB

O golden local comprovou três registros de 444 posições, código originador `00000000000000500497` preservado como texto na posição 27–46, código bancário `001` na posição 77–79, zeros à esquerda preservados e arquivo aprovado pelo validador posicional. Nenhum arquivo foi enviado à Sinqia/Terra.

## Checklist de secrets, sem valores

Confirmar antes do deploy:

- `FROMTIS_URL`, `FROMTIS_USERNAME`, `FROMTIS_PASSWORD` e, se sobrescrito, `FROMTIS_TIPO_RECEBIVEL`;
- `APP_BASE_URL`, URLs e keys Supabase de produção;
- host, porta, usuário, senha e remetente SMTP;
- keyrings de criptografia;
- secrets de cron e webhooks efetivamente habilitados;
- Redirect URLs e templates do Supabase Auth;
- backup/PITR e commit anterior para rollback.

Não copiar valores para SQL, documentação ou logs. `FROMTIS_URL` deve ser HTTPS. IMPULSE não recebe secrets neste cutover.

## Runbook do cutover DLZ

### Antes da janela

1. congelar commit e validar o manifesto canônico;
2. confirmar backup/PITR e rollback de aplicação;
3. confirmar DLZ como único fundo operacional e 12 Cedentes;
4. validar presença dos secrets existentes sem revelar valores;
5. congelar novas operações.

### Na janela

1. capturar baseline read-only;
2. aplicar as três bridges e 175 migrations uma a uma com `ON_ERROR_STOP`;
3. executar o pós-check e confirmar o hash certificado;
4. conferir IDs/CNPJs e aplicar `20260827213304_p3_1_vincular_cedentes_dlz.sql`;
5. publicar política DLZ com aceite obrigatório e risco desligado;
6. validar templates em compatibilidade legada e CNAB/golden;
7. validar resolução Sinqia/Terra por env sem chamada externa;
8. realizar deploy somente após os gates de banco;
9. executar smoke histórico e nova operação até antes do envio externo;
10. liberar e monitorar.

IMPULSE não recebe configuração nem ação na janela.

## Evidências reproduzíveis

```bash
npm run rehearsal:release:manifest:validate
npm run rehearsal:p3.1:configure-dlz
npm run rehearsal:p3.1:readiness
npm run rehearsal:p3.1:e2e-sacado
npm run rehearsal:p3.1:dry-run
```

Relatórios locais em `rehearsal/reports/`: `P3_1_DLZ_CONFIGURATION.json`, `P3_1_DLZ_READINESS.json`, `P3_1_DLZ_SACADO_E2E.json` e `P3_1_DLZ_CUTOVER_DRY_RUN.json`.

## Resultado

```text
P3_1_DLZ_HEALTH_RELEASE_CANDIDATE = PASS
DLZ_UNICO_FUNDO_OPERACIONAL = CONFIRMADO
CEDENTES_DLZ = 12/12
IMPULSE_BLOQUEIA_CUTOVER = NAO
POLITICA_DLZ_PUBLICADA_CLONE = PASS
GATE_SACADO_DLZ = PASS
RISCO_FINANCEIRO_DLZ = NAO_APLICAVEL
INTEGRACAO_DLZ = LEGACY_ENV_SINQIA_TERRA
CNAB_DLZ = PASS
TEMPLATES_DLZ = COMPAT_LEGADO
HISTORICO_45_OPERACOES = PASS
HISTORICO_903_NFS = PASS
CUTOVER_DLZ_DRY_RUN = DETERMINISTICO
CUTOVER_PRODUCAO = GO_CANDIDATE
```

`GO_CANDIDATE` significa tecnicamente apto para uma janela controlada. Não significa que produção foi alterada ou que o deploy está autorizado sem aprovações humanas e os controles do runbook.
