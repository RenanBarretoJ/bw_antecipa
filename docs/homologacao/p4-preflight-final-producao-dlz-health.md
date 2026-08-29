# P4 — Preflight final de produção — DLZ/HEALTH

Data da execução: 27/08/2026  
Escopo: preflight final antes da janela real  
Produção: estritamente `READ-ONLY`  
Fundo operacional: DLZ/HEALTH  

## 1. Parecer executivo

```text
P4_PREFLIGHT_PRODUCAO = FAIL
AMBIENTE_PRODUCAO_IDENTIFICADO = RISCO
RELEASE_CANDIDATE_FROZEN = PASS
MIGRATION_MANIFEST = PASS
BASELINE_PRODUCAO_ATUAL = ESTAVEL
FINAL_REHEARSAL_LATEST_DUMP = NOT_REQUIRED
PATCH_CEDENTES_DLZ_PREFLIGHT = PASS
DLZ_CUTOVER_CONFIG_READY = FAIL
SINQIA_TERRA_ENV_READY = FAIL
CNAB_DLZ_PROD_PREFLIGHT = PASS
AUTH_PROD_READY = FAIL
SMTP_PROD_READY = FAIL
VERCEL_PROD_ENV_READY = NAO_VERIFICAVEL
KEYRING_PROD_READY = NA
BACKUP_PITR_READY = FAIL
ROLLBACK_READY = FAIL
PREFLIGHT_SQL = PASS
POSTFLIGHT_SQL = PRONTO
CUTOVER_PRODUCAO = NO_GO
```

O release candidate, o manifesto, a cadeia de migrations, o patch dos dois Cedentes e o CNAB DLZ foram certificados. A produção permaneceu íntegra e sem delta operacional material desde o snapshot usado no rehearsal.

O cutover não deve começar enquanto não houver evidência independente e registrável de: projeto/commit efetivamente publicado na Vercel, variáveis de produção, configuração Auth, SMTP, backup/PITR e capacidade de rollback. Também falta um artefato de execução em produção, revisado e seguro, para configurar o DLZ após a migração. Esses itens são gates críticos e não podem ser presumidos a partir do código local.

Nenhuma migration, configuração, secret, dado, objeto Storage, integração externa, deploy, commit ou push foi executado em produção neste P4.

## 2. Ambientes

### Supabase de produção

- Project ref: `wwsndnuvnjuabpbjwlck`.
- Região: `us-east-1`.
- Estado observado: `ACTIVE_HEALTHY`.
- PostgreSQL: major 17, versão observada 17.6.1.
- Host sanitizado: `db.wwsndnuvnjuabpbjwlck.supabase.co`.
- Histórico de migrations: somente as 14 migrations de baseline, de `003` a `016`.
- Método de inspeção: consultas `SELECT` em transação `READ ONLY` e APIs administrativas somente leitura.

### Aplicação/Vercel

- Domínio público `https://bw-antecipa.better-with.tech` respondeu HTTP 200 e apresentou HSTS.
- Não existe vínculo local `.vercel/project.json`, Vercel CLI autenticada ou token autorizado para inspeção.
- Não foi possível confirmar o projeto Vercel, Production Environment, branch ou commit atualmente implantado.
- O commit remoto conhecido da branch `main` é `7a3087870cc8a80ab020676f1db33600804e5825`, mas não há evidência de que seja o commit implantado.

Conclusão: o Supabase de produção foi identificado de forma inequívoca; o ambiente de aplicação não. Por isso, `AMBIENTE_PRODUCAO_IDENTIFICADO = RISCO`.

## 3. Release candidate congelado

- Branch local: `homolog`.
- HEAD e `origin/homolog`: `a5d52505d58d0582fcdbfd2d311be40649ce40c5`.
- O candidato inclui alterações ainda não commitadas; a identidade do conteúdo é controlada pelo hash do RC, não apenas pelo commit.
- Hash certificado anterior: `9e1e371851d42a63221917d7a7a3dfca71c55fcc8451bb6b6cf839b17c5a2487`.
- Hash atual recertificado: `766037c8a390572cc73e5b3678ce456db670531ac8b6bb0f20024bb369239f79`.
- Arquivos cobertos: 982.

O hash mudou após o P3.1 porque cinco arquivos materiais do caminho legado Sinqia/Terra foram alterados:

- `src/lib/integracoes/legacy-env.ts`;
- `src/lib/integracoes/resolver.server.ts`;
- `src/lib/portal-fidc/integracao.ts`;
- `src/lib/integracoes/legacy-env.test.ts`;
- `src/lib/integracoes/resolver.server.test.ts`.

Por serem alterações de runtime no caminho de integração DLZ, o rehearsal P3.1 foi repetido duas vezes. Os dois ciclos produziram:

- 175 migrations aplicadas;
- zero falhas bloqueantes;
- hash pós-upgrade `fd73b40b2ab55cd0647a328bb6c83dea65f02e837d59c30252607ca8f68c4b9d`;
- hash semântico final `85c4e8b7aac535b285ae9c4f0d2b0f75786539c1d164925d1d6a510415f4d876`;
- readiness DLZ `PASS`;
- E2E Sacado `PASS`;
- cleanup sintético por `ROLLBACK`;
- resultado `CUTOVER_DLZ_DRY_RUN = DETERMINISTICO`.

O conteúdo está congelado pelo hash atual. Qualquer alteração posterior exige novo hash e classificação de impacto; mudança em runtime, migration, manifesto ou scripts de cutover exige nova recertificação. Antes do deploy real, o conteúdo congelado deverá ser associado a um commit imutável e revisado.

## 4. Manifesto canônico

- Hash: `cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318`.
- Baseline já presente: 14 migrations (`003`–`016`).
- Bridges pré-upgrade: 3.
- Migrations promovíveis: 175.
- Patch pós-upgrade: 1, para os dois Cedentes DLZ.
- Migrations de homologação bloqueadas: 5.

Bridges:

1. `20260827183411_bridge_consultor_cedentes_para_consultor_cedente.sql`;
2. `20260827184403_bridge_documentos_representante_legado.sql`;
3. `20260827185557_bridge_remover_policies_legadas_gestor_global.sql`.

Patch:

- `20260827213304_p3_1_vincular_cedentes_dlz.sql`.

Exclusões obrigatórias:

1. `20260723182639_reset_operacional_fundo_homolog_rpc.sql`;
2. `20260728153646_reset_operacional_eventos_dominio.sql`;
3. `20260804103235_corrigir_reset_postergacoes_canhoto.sql`;
4. `20260811153000_corrigir_reset_dependencias_logisticas_duplicatas.sql`;
5. `20260823125731_corrigir_reset_dependencias_risco.sql`.

A ordem e os hashes foram validados pelo script do manifesto. O diretório de migrations não deve ser aplicado implicitamente; a única fonte de ordem permitida é `rehearsal/manifests/production-migrations.json`.

## 5. Baseline atual de produção

Captura: `2026-08-27T23:31:23.692126Z`.

| Entidade | Contagem |
|---|---:|
| Fundos | 2 |
| Cedentes | 12 |
| Operações | 45 |
| Notas fiscais | 903 |
| Documentos | 123 |
| Storage metadata | 1.635 |
| Auth users | 23 |
| Profiles | 23 |
| Histórico Fromtis/Sinqia | 26 |
| Remessas geradas | 33 |
| Remessas enviadas | 26 |

Operações por status:

| Status | Total |
|---|---:|
| cancelada | 2 |
| liquidada | 20 |
| solicitada | 1 |
| em_andamento | 16 |
| inadimplente | 6 |

Notas fiscais por status:

| Status | Total |
|---|---:|
| aceita | 254 |
| aprovada | 100 |
| rascunho | 4 |
| cancelada | 105 |
| liquidada | 438 |
| em_antecipacao | 2 |

Documentos por status: 16 enviados, 106 aprovados e 1 reprovado. Profiles: 4 gestores, 3 sacados e 16 cedentes.

Não foram encontrados órfãos entre operações, NFs, documentos, vínculos operação × NF, Auth e profiles. Também não foram encontrados CNPJs de Cedente duplicados.

## 6. Delta desde o dump certificado

Snapshot de referência: `2026-08-27T18:25:50.037Z`.

- Novos Cedentes: 0.
- Novas operações: 0.
- Novas NFs: 0.
- Novos documentos: 0.
- Novos objetos Storage: 0.
- Novos Auth users: 0.
- Novos profiles: 0.
- Novas remessas: 0.
- Auth users atualizados: 3, compatível com login/renovação de sessão, sem alteração no domínio operacional.

Como não houve delta material, um novo dump não foi necessário. Ainda assim, o release candidate alterado foi recertificado em dois ciclos determinísticos contra o clone atual.

## 7. Patch dos dois Cedentes para DLZ

Estado observado em produção:

| Cedente | CNPJ | Status | Fundo atual | Operações | NFs |
|---|---|---|---|---:|---:|
| `382fab89-936b-4ff9-b4fe-edbfab0fa7f4` | `20817796000187` | pendente | nenhum | 0 | 0 |
| `c3df4597-25a8-4b50-ae83-fadada7170e4` | `31775519000175` | pendente | nenhum | 0 | 0 |

Não existe vínculo com IMPULSE nem conflito operacional. O patch do manifesto valida o estado esperado, é idempotente e deve abortar em caso de divergência. Após sua execução, os 12 Cedentes deverão resolver operacionalmente para DLZ.

## 8. Configuração operacional DLZ

O rehearsal certificou a configuração pretendida:

- política DLZ publicada;
- aprovação do Sacado obrigatória;
- risco e financeiro marcados como não aplicáveis ao DLZ;
- templates compatíveis com o legado;
- CNAB configurado;
- integração Sinqia/Terra resolvida pelo caminho legado `FROMTIS_*`, sem migração automática ao modelo versionado.

Entretanto, o configurador existente é explicitamente local (`configure-dlz-release-candidate-local.mjs`). Não existe artefato separado, revisado e protegido para executar a configuração na produção durante a janela, com precondições, idempotência, auditoria e confirmação de ambiente. Por isso, `DLZ_CUTOVER_CONFIG_READY = FAIL`.

## 9. Sinqia/Terra e variáveis de ambiente

O runtime candidato consome:

- `FROMTIS_URL` — endpoint/base URL;
- `FROMTIS_USERNAME` — autenticação;
- `FROMTIS_PASSWORD` — autenticação;
- `FROMTIS_TIPO_RECEBIVEL` — opcional, quando exigido pelo contrato do endpoint.

O resolvedor preserva o caminho legado e não exige uma versão em `integracoes_fundo` para DLZ. Os testes de contrato e fallback passaram. Contudo, não foi possível verificar a presença e o formato dessas variáveis no Vercel Production Environment. O código originador e os parâmetros CNAB pertencem à configuração CNAB e não devem ser inferidos das credenciais Sinqia/Terra.

## 10. CNAB DLZ

O preflight local confirmou:

- layout certificado;
- código originador tratado como texto;
- preservação de zeros à esquerda;
- banco, agência, conta, carteira e espécie presentes na configuração certificada;
- equivalência com o golden file;
- ausência de envio externo durante o teste.

Resultado: `CNAB_DLZ_PROD_PREFLIGHT = PASS`.

## 11. Auth, domínio e redirects

O código candidato usa o domínio oficial e possui rotas para recovery, convites, MFA/TOTP e sessão de segurança de 24 horas. Não foi possível, porém, inspecionar no projeto Supabase de produção:

- Site URL;
- allowlist de Redirect URLs;
- templates de recovery e convite;
- exigência/configuração de MFA;
- correspondência com `APP_BASE_URL` da Vercel.

Um domínio público funcional não comprova esses parâmetros. Resultado: `AUTH_PROD_READY = FAIL`.

## 12. SMTP

O contrato do código exige `SMTP_USER` e `SMTP_PASSWORD`; usa por padrão `smtp.ionos.com`, porta 465 e TLS implícito. Porta 587 exige STARTTLS. `EMAIL_FROM` deve ser compatível com o domínio da conta SMTP. Mailpit é limitado a `local`/`rehearsal`, loopback e opt-in explícito.

Não foi possível verificar no Supabase Auth nem na Vercel a presença/configuração real de host, porta, TLS, usuário, remetente e templates. Nenhum e-mail real foi enviado. Resultado: `SMTP_PROD_READY = FAIL`.

## 13. Vercel Production Environment

| Grupo | Estado |
|---|---|
| Supabase URL / anon / service role | NÃO VERIFICÁVEL |
| `APP_BASE_URL` | NÃO VERIFICÁVEL |
| `NEXT_PUBLIC_APP_ENV=production` | NÃO VERIFICÁVEL |
| `FROMTIS_*` | NÃO VERIFICÁVEL |
| SMTP | NÃO VERIFICÁVEL |
| Keyring geral | NÃO VERIFICÁVEL |
| Cron/webhook secrets | NÃO VERIFICÁVEL |

Nenhum valor foi lido ou registrado. `VERCEL_PROD_ENV_READY = NAO_VERIFICAVEL`.

## 14. Keyring e criptografia

Para o cutover inicial do DLZ, a integração permanece no caminho legado por variáveis `FROMTIS_*`; não utiliza credencial criptografada no banco nem exige keyring para resolver Sinqia/Terra. Portanto, `KEYRING_PROD_READY = NA` especificamente para este gate. Isso não certifica outras integrações do produto que usem keyring.

## 15. Backup, PITR e rollback

Não houve acesso autorizado a evidência de:

- backup mais recente;
- PITR ativo e retenção;
- restore point imediatamente anterior à janela;
- responsável pelo restore;
- RTO conhecido e testado.

Os runbooks de cutover e rollback existem, e o commit anterior da branch principal é identificável. Ainda assim, não foi possível comprovar capacidade de redeploy na Vercel nem rollback do banco por PITR/snapshot. Down migration improvisada não é estratégia aceita.

Resultados: `BACKUP_PITR_READY = FAIL` e `ROLLBACK_READY = FAIL`.

## 16. Tempo e janela recomendada

No rehearsal local, bridges + 175 migrations consumiram aproximadamente 48 segundos. Produção deve considerar lock, latência, volume, validações, coordenação e rollback; portanto, não se deve usar o tempo local como duração da janela.

| Etapa | Reserva |
|---|---:|
| Congelamento e baseline final | 5 min |
| Bridges + 175 migrations | 15 min |
| Patch dos Cedentes | 2 min |
| Configuração DLZ | 10 min |
| Postflight SQL | 10 min |
| Deploy | 10 min |
| Smoke funcional controlado | 20 min |
| Buffer operacional | 18 min |
| **Janela recomendada** | **90 min** |

Ponto de abort: se migrations, patch, configuração DLZ e postflight não estiverem integralmente verdes até o minuto 45, não executar deploy. Após o deploy, qualquer falha em login, autorização multifundo, leitura histórica, criação controlada ou aprovação exige interromper o smoke e acionar o rollback. Não enviar arquivos ou mensagens a integrações externas sem autorização separada.

## 17. Preflight e postflight SQL

### Preflight

O script `docs/homologacao/sql/p4-preflight-producao-read-only.sql`:

- abre transação `READ ONLY`;
- valida contagens, statuses e delta;
- verifica órfãos e duplicidades;
- confirma DLZ, IMPULSE e os dois Cedentes do patch;
- inspeciona migration history, policies críticas, Storage e consistência Auth/profile;
- termina com `ROLLBACK`.

O script foi executado com sucesso na produção e não realizou mutações. `PREFLIGHT_SQL = PASS`.

### Postflight

O script `docs/homologacao/sql/p4-postflight-producao-read-only.sql` valida:

- 192 migrations de schema esperadas, em ordem canônica;
- ausência das 5 migrations bloqueadas;
- bridges e correções de runtime presentes;
- 12 Cedentes vinculados a DLZ e nenhum vínculo operacional com IMPULSE;
- política, CNAB e integração legacy do DLZ;
- preservação das contagens históricas;
- RLS, trigger Auth, grants e policies;
- ausência de órfãos;
- Storage metadata preservado.

O script foi validado integralmente contra o clone local migrado e terminou com `ROLLBACK`. `POSTFLIGHT_SQL = PRONTO`.

## 18. Smoke plan da janela

| Ordem | Verificação | Gate de rollback |
|---:|---|---|
| 1 | Login Super Admin | Falha de Auth, MFA ou autorização |
| 2 | Login Gestor | Falha de Auth, fundo ativo ou RLS |
| 3 | Login Cedente | Falha de Auth, organização ou vínculo DLZ |
| 4 | Login Sacado | Falha de Auth ou contexto Sacado |
| 5 | MFA/TOTP e sessão 24h | AAL incorreto ou bypass |
| 6 | Dashboards | Erro 5xx, permissão negada ou vazamento multifundo |
| 7 | Operação histórica | Divergência de status/snapshot |
| 8 | NF histórica | Divergência documental/logística |
| 9 | Documento histórico | Falha de metadata, versão ou autorização |
| 10 | Storage | Falha de leitura autorizada ou acesso cruzado |
| 11 | Nova NF controlada | Falha de validação, atomicidade ou checklist |
| 12 | Nova operação DLZ controlada | Fundo/política/configuração incorretos |
| 13 | Aprovação do Sacado | Aceite não obrigatório ou histórico ausente |
| 14 | Aprovação do Gestor | Gate documental ou financeiro indevido |
| 15 | Geração documental | Template, auditoria ou Storage inválidos |
| 16 | Geração de CNAB/remessa | Arquivo diferente do golden ou config incorreta |
| 17 | Parar antes de envio externo | Envio externo sem autorização explícita |

Os registros sintéticos criados no smoke devem ser previamente identificados, limitados ao fundo DLZ e possuir plano de reversão aprovado. O smoke não autoriza envio externo.

## 19. Checklist de minuto zero

- [ ] Novas operações congeladas.
- [ ] Usuários e operação comunicados.
- [ ] Projeto Vercel, branch e commit implantável confirmados por dois revisores.
- [ ] Backup/PITR, retenção, restore point, responsável e RTO confirmados.
- [ ] Baseline final capturado com o preflight SQL.
- [ ] Hash do manifesto confirmado: `cc708283...a318`.
- [ ] Hash do RC confirmado: `766037c8...f79`.
- [ ] Candidato associado a commit imutável e revisado.
- [ ] Vercel Production Environment integralmente READY.
- [ ] `FROMTIS_*` presentes e validadas sem revelar valores.
- [ ] Configurador de produção DLZ revisado, idempotente e auditável.
- [ ] Auth/Site URL/redirects/MFA READY.
- [ ] SMTP/Auth Mailer READY.
- [ ] CNAB/golden file READY.
- [ ] Runbook e capacidade de rollback READY.
- [ ] Executor, revisor técnico e responsável de negócio presentes.
- [ ] Ponto de abort e canal de incidente confirmados.

Enquanto qualquer item crítico permanecer aberto, a janela não deve iniciar.

## 20. Qualidade executada

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS |
| Testes P4 | 4/4 PASS |
| Suíte completa | 1.956 PASS, 3 skipped |
| `npm run lint` | PASS com 5 warnings e 0 errors |
| `git diff --check` | PASS; apenas avisos de normalização LF/CRLF |
| `npx next build --webpack` | PASS, Next.js 16.3.1, 85 páginas |
| `npm audit --omit=dev` | PASS, 0 vulnerabilidades |
| Validação do manifesto | PASS |
| Secret scan | PASS, 1.493 arquivos, 0 achados |
| Rehearsal P3.1 repetido 2x | DETERMINÍSTICO |

Os cinco warnings de lint são imports não utilizados preexistentes e não bloqueiam o build. Nenhum secret foi incluído nos artefatos do P4.

## 21. Riscos residuais e ações para converter em GO

1. Confirmar projeto Vercel, Production Environment, branch e commit a implantar.
2. Associar o conteúdo congelado a um commit imutável, sem alterar o hash do RC.
3. Inspecionar e validar, por presença/formato, todas as variáveis de produção.
4. Confirmar Site URL, redirects, templates e MFA no Supabase Auth.
5. Confirmar SMTP do Supabase Auth e SMTP da aplicação, sem envio neste gate.
6. Produzir e revisar um configurador de produção DLZ idempotente, auditável e com confirmação forte de ambiente.
7. Confirmar backup/PITR, restore point, responsável e RTO.
8. Executar ou evidenciar um teste de restauração compatível com o RTO.
9. Confirmar capacidade de redeploy do commit anterior.
10. Reexecutar o preflight SQL imediatamente antes da janela e comparar com este baseline.

Quando os itens acima estiverem comprovados, o P4 deve ser reavaliado. Não é suficiente declarar que as configurações existem; a evidência deve ser verificável e anexada ao registro da janela.

## 22. Artefatos

- Baseline sanitizado: `docs/homologacao/p4-baseline-producao-read-only.json`.
- Preflight SQL: `docs/homologacao/sql/p4-preflight-producao-read-only.sql`.
- Postflight SQL: `docs/homologacao/sql/p4-postflight-producao-read-only.sql`.
- Testes dos artefatos: `rehearsal/p4/p4-artifacts.test.mjs`.
- Manifesto: `rehearsal/manifests/production-migrations.json`.
- Evidência do rehearsal: `rehearsal/reports/P3_1_DLZ_CUTOVER_DRY_RUN.json`.

## 23. Conclusão

A camada técnica interna está em condição forte: produção está estável, o manifesto é determinístico, o patch DLZ é aplicável, o CNAB está certificado, a suíte e o build passaram e o rehearsal foi repetido após a mudança do RC.

O sistema ainda não está autorizado para cutover porque os controles externos mais importantes não foram comprovados: Vercel Production Environment, Auth, SMTP, backup/PITR, rollback e configuração executável do DLZ em produção. A decisão correta e conservadora é:

```text
P4_PREFLIGHT_PRODUCAO = FAIL
CUTOVER_PRODUCAO = NO_GO
```

