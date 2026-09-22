# C2 RETOMADA 02 - reconciliacao do historico de homologacao

Data de referencia: 22/09/2026

Projeto Supabase de homologacao: `fhgkmggthxikfpogrvaa`

Branch de integracao: `validation/c2-retomada-02-homolog-infra`

## Resultado

O historico remoto de migrations foi reconciliado com a cadeia canonica do Git sem executar SQL de migration e sem alterar schema ou dados operacionais. O procedimento foi ensaiado antes em um banco local isolado e depois executado em homologacao, uma versao por comando, usando somente `supabase migration repair`.

A versao remota legitima `20260827150923` foi preservada. Como seu efeito material, o helper exclusivo de homologacao `private.excluir_usuarios_homolog(uuid[])`, ja havia sido removido pela migration forward `20260922161558`, foi adicionado ao Git um anchor historico no-op. O anchor permite manter a versao imutavel no historico sem recriar o helper e sem introduzir comportamento de homologacao na cadeia destinada a producao.

O P14 foi reconciliado pela equivalencia comprovada do SQL: a versao canonica `20260922182301` ficou registrada e o alias remoto `20260922190141` foi removido somente do metadata.

## Evidencias antes e depois

| Evidencia | Antes | Depois |
|---|---:|---:|
| Migrations remotas | 206 | 210 |
| Hash do historico | `27d6bd2a09f211923941ce9b1ccdaa8d` | `0fe7ac6343d2361c9d3ed5859ef9729b` |
| Hash do schema-alvo | `40ee0e6871bd6ece3588388549e0fc82` | `40ee0e6871bd6ece3588388549e0fc82` |
| Cedentes | 118 | 118 |
| Notas fiscais | 187 | 187 |
| Operacoes | 18 | 18 |
| Usuarios Auth | 249 | 249 |

O rehearsal local terminou com 210 versoes, paridade integral e `db push --dry-run` vazio. Em homologacao, cada reparo foi seguido por consulta read-only do hash e das contagens. Todos permaneceram invariaveis.

## Certificacao final

- `supabase migration list --linked`: todas as 210 versoes possuem correspondencia local/remota;
- `supabase db push --dry-run --linked`: `Remote database is up to date`, sem migrations, seeds ou roles;
- `20260827150923`: presente em ambos os lados;
- `20260922182301`: presente em ambos os lados;
- `20260922190141`: ausente;
- deployment Vercel de homologacao: `Ready`, target `homolog`, com o alias `homolog.bw-antecipa.better-with.tech`;
- checks HTTP automatizados responderam 200 durante o reparo e depois passaram a receber `X-Vercel-Mitigated: challenge`; isso foi classificado como mitigacao anti-bot, nao indisponibilidade do deployment.

## Validacoes do pacote Git

| Gate | Resultado |
|---|---|
| Teste estatico do anchor historico | PASS - 2/2 |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS - 3 warnings preexistentes |
| `npm test` | PASS - 262 arquivos, 3 skipped; 2.219 testes, 12 skipped |
| `npm run build` | PASS |
| `npm run rehearsal:test` | BASELINE CONHECIDA - 20 PASS / 13 FAIL |

As 13 falhas de rehearsal continuam concentradas nos manifestos de producao congelados, cuja cobertura ja divergia da cadeia atual antes desta retomada. O anchor adicionou dois testes que passaram e nao introduziu uma nova classe de falha. Os manifestos de producao nao foram atualizados porque isso ampliaria o escopo e alteraria o bundle congelado.

## Limites

- nenhuma acao foi executada em producao;
- nenhuma migration SQL foi aplicada pelo reparo de historico;
- P13 e P14 nao tiveram codigo funcional alterado;
- nenhuma alteracao de layout, menu lateral ou texto de autenticacao integra este escopo;
- o smoke autenticado do C2 pertence a etapa posterior, depois da reconstrucao sobre a `main` atual.

```ini
HOMOLOG_HISTORY_REPAIR_REHEARSAL = PASS
HOMOLOG_MIGRATION_HISTORY_RECONCILED = PASS
P14_CHANGED = NO
P13_CHANGED = NO
PRODUCTION_CHANGED = NO
```
