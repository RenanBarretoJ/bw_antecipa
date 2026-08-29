# P3 — Release Candidate de produção

> Parecer histórico superado pelo P3.1. O resultado vigente está em `docs/homologacao/p3-1-dlz-health-release-candidate.md`.

## Parecer executivo

`P3_RELEASE_CANDIDATE_PRODUCAO = FAIL`

A cadeia técnica está fechada, reproduzível e compatível com o histórico. Entretanto, o release ainda não é promovível porque faltam decisões e configurações operacionais que não podem ser inferidas do código, do clone de produção ou da homologação.

Produção real permaneceu somente leitura e não recebeu DDL, DML, login de teste, upload, migration ou deploy.

## Cadeia certificada

```text
baseline de produção (14)
  ↓
3 bridges pré-upgrade
  ↓
175 migrations promovíveis
  ↓
3 correções P2 incluídas nas 175
  ↓
POST_UPGRADE
  ↓
hash fd73b40b2ab55cd0647a328bb6c83dea65f02e837d59c30252607ca8f68c4b9d
```

Manifesto canônico: `0197f9f8361e528b663f1bcc632bf23efc08de80557133fb8881fd3650ca1947`.

Hash do release candidate: `15a2c78a2a4edf4fc93f75d3a291dd59dffc3f8be0561668bace686531e517ff` (974 arquivos de código, migrations, scripts, manifesto, lockfile e configuração de build).

Os dois ciclos do dry-run produziram o mesmo hash, zero falha bloqueante e os mesmos dez bloqueios operacionais.

## E2E executado

- 45/45 operações históricas carregáveis e abertas;
- 903/903 NFs preservadas;
- 123 documentos e 1.635 metadados Storage preservados;
- Storage local: upload, URL assinada, download e limpeza em 3/3 buckets;
- 26 operações Fromtis históricas preservadas;
- Gestor/Super Admin, Cedente e Sacado autenticados com MFA;
- RLS de Cedente e Sacado isolada;
- 45/45 detalhes de operação no browser;
- convites scanner-safe de Gestor e Cedente aprovados;
- MFA dos convidados: 2/2;
- reconstrução final removeu todos os convidados e dados sintéticos.

O fluxo completo de nova operação com política, templates, CNAB e integração reais para ambos os fundos não foi executado, pois esses parâmetros não existem nem foram aprovados. Criá-los seria inventar regra de negócio.

## Gate de qualidade

| Validação | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm test -- --run` | PASS — 231 arquivos aprovados, 1 ignorado; 1.951 testes aprovados, 3 ignorados |
| testes direcionados do rehearsal/P3 | PASS — 11/11 |
| `npm run lint` | PASS — zero erros; cinco avisos preexistentes fora do P3 |
| `git diff --check` | PASS |
| `npx next build --webpack` | PASS |
| `npm audit --omit=dev` | PASS — zero vulnerabilidades |
| varredura de secrets | PASS — nenhum JWT ou `.env` versionável; apenas fixtures fake de chave privada nos testes Vórtx |
| dry-run completo | PASS técnico — 2/2 ciclos determinísticos; gate operacional fechado |

## Bloqueios

1. DLZ sem política, templates, CNAB e integração publicados no modelo novo;
2. IMPULSE sem política, templates, CNAB e integração publicados;
3. dois Cedentes pendentes sem evidência inequívoca de fundo;
4. secrets e configurações Auth/SMTP/Vercel ainda precisam de verificação na janela;
5. risco/financeiro precisa de decisão explícita de aplicabilidade por fundo.

## Flags finais

```text
MIGRATIONS_PRODUCAO_CANONICAS = CONFIRMADO
MIGRATIONS_HOMOLOG_BLOQUEADAS = CONFIRMADO
CORRECOES_P2_CLASSIFICADAS = CONFIRMADO
CONFIG_FUNDOS = PENDENTE
POLITICAS_PUBLICADAS_CLONE = PENDENTE
TEMPLATES_PUBLICADOS_CLONE = PENDENTE
CNAB_REMESSA_CLONE = PENDENTE
INTEGRACOES_CLONE = PENDENTE
RISCO_FINANCEIRO_CLONE = NA
CEDENTES_SEM_FUNDO = DECISAO_PENDENTE
CUTOVER_DRY_RUN = DETERMINISTICO
ROLLBACK_RUNBOOK = PRONTO
CUTOVER_PRODUCAO = NO_GO
```

## Próxima decisão

O P3 poderá mudar para `PASS` e `GO_CANDIDATE` somente após o negócio aprovar os dois vínculos e fornecer, por fundo, política, templates, CNAB/adapter, integração e parâmetros de risco. Depois disso, os dados devem ser configurados apenas no clone, o E2E completo repetido e o mesmo dry-run executado duas vezes sem bloqueios.
