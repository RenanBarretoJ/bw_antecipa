# P4.3/P4.4 — checklist de infraestrutura de produção

Última atualização automatizada: 28/08/2026 01:48 BRT

Projeto Supabase: `bw-antecipa` (`wwsndnuvnjuabpbjwlck`)

Projeto Vercel: `bw-antecipa` (`prj_nKt7FiU3FWHrmRyf0mbDudM0AVIF`), team `renanbarretoj`

Domínio esperado: `https://bw-antecipa.better-with.tech`

Produção permaneceu integralmente `READ-ONLY`. Não registrar senhas, tokens, chaves, valores de secrets ou capturas que revelem credenciais. As linhas manuais somente podem ser aprovadas com revisão por duas pessoas.

| Item | Evidência sanitizada | Estado | Revisor 1 | Revisor 2 | Timestamp |
|---|---|---|---|---|---|
| Projeto Vercel | Projeto e team identificados pela CLI autenticada | PASS | Automação P4.4 |  | 28/08/2026 |
| Deployment Production | `dpl_udB8Ser8sQE7JUiA3KjXbQR782WT`, READY, branch `main`, SHA `7a3087870cc8a80ab020676f1db33600804e5825` | PASS | Automação P4.4 |  | 24/08/2026 14:37 BRT |
| Env Supabase | Os três nomes obrigatórios existem no target Production; valores não foram lidos | PASS | Automação P4.4 |  | 28/08/2026 |
| URL e ambiente da aplicação | `APP_BASE_URL` existe, mas seu valor não foi conferido; `NEXT_PUBLIC_APP_ENV` está ausente | FAIL | Automação P4.4 |  | 28/08/2026 |
| Runtime Sinqia/Terra | `FROMTIS_URL`, usuário, senha e tipo existem; `INTEGRATION_RUNTIME_ENV` está ausente e valores não sensíveis não foram conferidos | FAIL | Automação P4.4 |  | 28/08/2026 |
| SMTP da aplicação | Host, porta, TLS, usuário, senha e remetente existem; coerência dos valores não sensíveis requer revisão manual | FAIL | Automação P4.4 |  | 28/08/2026 |
| Demais secrets obrigatórios | Cron e integrações possuem nomes configurados; `AUTH_FLOW_COOKIE_SECRET` não está presente e o runtime usa fallback; revisar rotas habilitadas | FAIL | Automação P4.4 |  | 28/08/2026 |
| Site URL Auth | Confirmar `https://bw-antecipa.better-with.tech` no Dashboard | FAIL — PENDENTE MANUAL |  |  |  |
| Redirect URLs Auth | Confirmar somente URLs oficiais de produção, sem localhost/homolog | FAIL — PENDENTE MANUAL |  |  |  |
| MFA/TOTP do projeto | Runtime exige AAL2; produção tem 23 usuários e zero fatores. Confirmar TOTP habilitado, rollout e recuperação | FAIL — PENDENTE MANUAL |  |  |  |
| SMTP do Auth | Confirmar custom SMTP, host não local, porta/TLS, remetente e usuário | FAIL — PENDENTE MANUAL |  |  |  |
| Templates do Auth | Revisar convite, recovery, confirmação e alteração de e-mail, incluindo links scanner-safe | FAIL — PENDENTE MANUAL |  |  |  |
| Backup mais recente | CLI retornou 7 backups físicos diários concluídos; último em `2026-08-27T05:04:46.167Z` | PASS | Automação P4.4 |  | 28/08/2026 |
| PITR/recovery window | CLI retornou `pitr_enabled=false` | FAIL | Automação P4.4 |  | 28/08/2026 |
| Restore/RTO | Não há restore isolado documentado com owner, duração, RPO e RTO aceitos | FAIL | Automação P4.4 |  | 28/08/2026 |
| Rollback Vercel | Deployment anterior READY `dpl_HrE6BU7smnf95tCpwgFqrGmYDLjW`; usuário autenticado é owner do team | PASS | Automação P4.4 |  | 28/08/2026 |
| Rollback de banco | PITR desativado e alternativa baseada em backup ainda não possui restore/RTO comprovados | FAIL | Automação P4.4 |  | 28/08/2026 |

## Procedimento de rollback da aplicação

Na janela, após aprovação dos responsáveis, o owner pode apontar o projeto ao deployment anterior com:

```powershell
vercel rollback bw-antecipa-kcsx6v0u0-renanbarretoj.vercel.app --scope renanbarretoj
```

O comando acima é somente documentação. Ele não foi executado no P4.4.

## Fechamento manual

Cada linha manual deve registrar somente o estado observado, dois revisores e timestamp. Enquanto Site URL, redirects, MFA, SMTP/Auth, valores não sensíveis de ambiente e restore/RTO não estiverem comprovados, os respectivos gates permanecem `FAIL` e o cutover continua `NO_GO`.
