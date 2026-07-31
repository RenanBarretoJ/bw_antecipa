# Relatório de homologação — Escopo 9A

Data da execução: 30/07/2026

Parecer: **NO-GO**

## 1. Resumo executivo

O ambiente de homologação recebeu uma massa sintética rastreável com dois
fundos, vinte usuários autenticáveis com MFA TOTP, 180 cedentes, 250 operações,
1.000 notas fiscais, 900 documentos, 1.000 instâncias documentais, 5.000
movimentos de escrow, 4.500 notificações e 1.000 eventos de auditoria.

O primeiro gate de segurança foi executado com sessões Supabase reais elevadas
de AAL1 para AAL2. Ele confirmou cinco acessos cruzados:

- Gestor A leu o Fundo B;
- Gestor A leu uma operação do Fundo B por ID;
- Gestor A leu uma NF do Fundo B por ID;
- Gestor B leu o Fundo A;
- Consultor A leu uma NF exclusiva da carteira/fundo B.

Cedente A não leu a NF de outro cedente e Sacado A não leu uma NF destinada a
outro CNPJ nos casos testados.

O Escopo 9A determina interrupção imediata diante de acesso cruzado entre
fundos ou consultores. Por isso, Realtime, smoke das 26 rotas, medições de
navegador, React Profiler, ações críticas, golden financeiro, URLs assinadas e
novos EXPLAINs não foram executados após a confirmação. Nenhuma policy foi
corrigida silenciosamente nesta entrega.

## 2. Ambiente e pré-condições

| Item | Evidência | Resultado |
|---|---|---|
| Ambiente | `NEXT_PUBLIC_APP_ENV=homolog` | Aprovado |
| Projeto Supabase | ref `fhgkmggthxikfpogrvaa` | Aprovado |
| Branch | `homolog` | Aprovado |
| Commit-base | `57939e5` | Registrado |
| Migration do Escopo 8 | `20260730170007_performance_escopo8_hardening_grants_rls` no histórico remoto | Aprovado |
| Schema cache | RPCs do Escopo 8 consultáveis; PostgREST respondeu à carga e aos testes | Aprovado |
| Identificador da massa | prefixo exclusivo `PERF9A_` e versão determinística `9A.1` | Aprovado |
| Autorização | solicitação explícita de implementação do Escopo 9A | Aprovado |
| Ambiente produtivo | variáveis e projeto identificados como homologação | Aprovado |
| Dados preexistentes | preservados; a base já continha dados de homologação não prefixados | Aprovado com observação |

O histórico remoto de migrations continua contendo apenas parte dos nomes
locais antigos. A materialização do Escopo 8 foi confirmada pelo histórico e
pelos objetos utilizados. Nenhuma migration foi criada ou alterada pelo Escopo
9A.

## 3. Snapshot anterior à carga

O dump nativo do Supabase CLI não pôde ser executado porque o host não possuía
Docker. Foi criado um snapshot lógico administrativo antes da primeira
mutação, sem senhas, tokens ou conteúdo de segredo.

- arquivo local restrito:
  `C:\Users\BrenoAlvim\AppData\Local\BWAntecipa\perf9a\backups\preload-fhgkmggthxikfpogrvaa-2026-07-30T18-06-30-586Z.json`;
- SHA-256:
  `7f7d5731f0350c3c71ebd726066d51c6581ebfc2e707fb832d48c40e20174611`;
- armazenamento: fora do repositório;
- conteúdo Auth: somente metadados necessários, sem credenciais;
- conteúdo Storage: inventário de objetos, sem URLs assinadas.

Contagens preexistentes registradas: 5 perfis, 2 fundos, 2 cedentes, 2
operações, 23 NFs, 22 documentos, 249 notificações e 124 logs de auditoria.

## 4. Usuários criados

Foram criados vinte usuários sintéticos no Supabase Auth. Todos receberam fator
TOTP real e confirmado. As credenciais ficam somente em arquivo local
restrito, fora do repositório e deste relatório.

| Grupo | Cenários |
|---|---|
| Gestor | A, B e multi |
| Cedente | A, B, multi, sem escrow, com escrow, carga A e carga B |
| Consultor | A e B com carteiras distintas |
| Sacado | A, B e inativo |
| Negativos | sem perfil, perfil inativo, sem fundo e role incompatível |
| Onboarding | usuário administrativo para massa sem vínculo |

No teste RLS, `getAuthenticatorAssuranceLevel()` retornou AAL1 após senha e AAL2
após confirmação TOTP para todos os cinco atores exercitados.

## 5. Massa criada

| Entidade/cenário | Volume |
|---|---:|
| Usuários Auth | 20 |
| Fundos | 2 |
| Cedentes sintéticos | 180 |
| Cedentes vinculados por fundo | 60 no Fundo A e 60 no Fundo B |
| Cedente com múltiplos vínculos | 1 |
| Vínculo suspenso | 1 |
| Cedentes sem fundo para onboarding | 60 |
| Vínculos `cedente_fundos` | 121 |
| Políticas publicadas | 2 |
| Taxas | 3 por vínculo ativo |
| Operações | 250 |
| Notas fiscais | 1.000 |
| Vínculos operação × NF | 1.000 |
| Operação com 1 NF | 1 |
| Operação com 10 NFs | 1 |
| Operação com 50 NFs | 1 |
| Entregas/logística | 200 |
| Documentos/versões/vínculos | 900 |
| Instâncias documentais | 1.000 |
| Contas escrow | 80 |
| Movimentos escrow | 5.000 |
| Notificações | 4.500, sendo 500 para cada usuário principal |
| Logs de auditoria | 1.000 |
| Eventos de domínio | 200 |

Os registros têm distribuição entre os enums reais de status. Foram
intencionalmente criados timestamps iguais em notificações, auditoria,
movimentos e eventos para exercitar cursores. `cedentes.fundo_id` permaneceu
nulo em toda a massa; os vínculos usam exclusivamente `cedente_fundos`.

## 6. Processo de carga

Arquitetura:

```text
Validação de homologação e confirmação explícita
  ↓
Criação de usuários Auth
  ↓
Inscrição e confirmação TOTP
  ↓
Transação SQL única com FKs, constraints e triggers ativos
  ↓
Asserções de volumes e ausência de fallback legado
  ↓
Persistência local restrita das credenciais
```

A carga SQL não desabilita RLS, constraints ou triggers. Para os triggers
documentais que reutilizam a autorização de domínio, a transação fornece
`request.jwt.claims` de um gestor sintético com autorização nos dois fundos.
Falhas SQL revertem a transação e acionam compensação dos usuários Auth.

Durante o desenvolvimento, tentativas que falharam foram integralmente
revertidas e reconciliadas com `perf9a:status` antes de nova execução.

## 7. Matriz RLS com JWT real

| Ator | Cenário | Esperado | Obtido | Resultado | Bloqueador |
|---|---|---|---|---|---|
| Gestor A | Fundo A autorizado | visível | visível | Aprovado | Não |
| Gestor A | Fundo B não autorizado | oculto | visível | **Falhou** | **Sim** |
| Gestor A | Operação do Fundo B por ID | oculto | visível | **Falhou** | **Sim** |
| Gestor A | NF do Fundo B por ID | oculto | visível | **Falhou** | **Sim** |
| Gestor B | Fundo A não autorizado | oculto | visível | **Falhou** | **Sim** |
| Consultor A | Cedente exclusivo da carteira B | oculto | oculto | Aprovado | Não |
| Consultor A | NF exclusiva da carteira/fundo B | oculto | visível | **Falhou** | **Sim** |
| Cedente A | NF de outro cedente | oculto | oculto | Aprovado | Não |
| Sacado A | NF de outro CNPJ | oculto | oculto | Aprovado | Não |

As consultas usaram o ID exato da entidade adversária e clientes Supabase com
JWT real, não `service_role`. Tempos observados ficaram entre 138,18 ms e
215,20 ms.

A evidência estruturada, sem tokens ou senhas, está fora do repositório:

`C:\Users\BrenoAlvim\AppData\Local\BWAntecipa\perf9a\evidence\rls-fhgkmggthxikfpogrvaa-2026-07-30T18-34-46.638Z.json`

## 8. Causa técnica do bloqueador

As seguintes policies autorizam apenas pela role global e não cruzam o usuário
com o fundo ou a carteira:

- `fundos_gestor_all`;
- `fundos_gestor_select`;
- `operacoes_gestor_all`;
- `notas_fiscais_gestor_all`;
- `notas_fiscais_consultor_select`.

O problema não está no seletor visual de fundo. Alterar cookie ou esconder uma
linha na UI não resolve, pois a leitura direta por ID já foi aprovada pelo
PostgREST.

Antes de retomar o 9A, um escopo de correção de segurança deve:

1. vincular leitura e mutação de gestor a `usuario_fundos` ativo;
2. restringir operações pelo `cedente_fundo_id` autorizado;
3. restringir NFs de gestor por `nota_fiscal.fundo_id`/vínculo autorizado;
4. restringir NFs de consultor pela existência de `consultor_cedente`;
5. revisar policies permissivas sobrepostas que possam reabrir o acesso;
6. repetir toda a matriz positiva e negativa com JWT/AAL2;
7. testar RPCs e Server Actions, não apenas `SELECT`;
8. aplicar a correção por migration incremental, sem editar migrations antigas.

## 9. Advisors e logs

Os advisors do Supabase foram consultados depois da carga. Permanecem os riscos
já conhecidos no Escopo 8:

- RLS habilitada sem policy em `credenciais_integracao` e
  `seguranca_rate_limits`;
- funções `SECURITY DEFINER` executáveis por `anon`;
- alertas de performance sobre policies e índices a serem avaliados em escopo
  próprio.

Referências de remediação:

- [RLS habilitada sem policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy);
- [função SECURITY DEFINER executável por anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

Os logs Auth confirmaram criação de fator, desafio, verificação TOTP, login e
logout dos usuários sintéticos. Os logs Realtime consultados responderam sem
erro operacional, mas isso não substitui o teste obrigatório de isolamento com
duas sessões, que foi interrompido pelo gate RLS.

## 10. Testes interrompidos pelo gate

| Área | Estado | Motivo |
|---|---|---|
| Matriz RLS completa | Parcial e reprovada | cinco falhas críticas confirmadas |
| 26 rotas | Não executado | interrupção obrigatória |
| Paginação no navegador | Não executado | interrupção obrigatória |
| Cursor concorrente | Não executado | interrupção obrigatória |
| Realtime em duas sessões | Não executado | interrupção obrigatória |
| Ações críticas | Não executado | interrupção obrigatória |
| Métricas de navegador | Não executado | interrupção obrigatória |
| React Profiler | Não executado | interrupção obrigatória |
| EXPLAIN pós-carga | Não executado | interrupção obrigatória |
| Decisão de índices | Adiada | depende dos novos EXPLAINs |
| Golden financeiro | Não executado | interrupção obrigatória |
| URLs assinadas | Não executado | interrupção obrigatória |

Não há base técnica para transformar itens não executados em aprovação por
inferência.

## 11. Cleanup

Comandos disponíveis:

```bash
npm run perf9a:status
npm run perf9a:cleanup -- --confirm PERF9A_fhgkmggthxikfpogrvaa
npm run perf9a:cleanup -- --execute --confirm PERF9A_fhgkmggthxikfpogrvaa
```

O cleanup:

- é dry-run por padrão;
- exige `--execute` e confirmação específica do projeto para mutar;
- conta os registros antes da ação;
- usa o reset homologado por fundo e limpeza estrutural prefixada;
- remove apenas objetos de Storage sob `perf9a/`;
- remove somente usuários do domínio sintético;
- reconcilia contagens após execução;
- não foi executado destrutivamente ao final.

O dry-run encontrou exatamente os volumes da seção 5 e não removeu registros.
A massa permanece disponível em homologação.

## 12. Arquivos entregues

- `scripts/perf9a/common.mjs`: guardas de ambiente, confirmação, SQL
  transacional e armazenamento local restrito;
- `scripts/perf9a/dataset.mjs`: usuários sintéticos, CNPJ válido, senhas
  aleatórias e TOTP;
- `scripts/perf9a/backup-homolog.mjs`: snapshot lógico sem credenciais;
- `scripts/perf9a/status-homolog.mjs`: reconciliação de volumes;
- `scripts/perf9a/seed-homolog.mjs`: usuários, MFA e massa transacional;
- `scripts/perf9a/cleanup-homolog.mjs`: dry-run e limpeza explicitamente
  confirmada;
- `scripts/perf9a/verify-homolog.mjs`: autenticação AAL2 e matriz negativa de
  isolamento;
- `src/lib/performance/escopo9a.test.ts`: contratos dos geradores, TOTP,
  ausência de credenciais e segurança do cleanup/verificador;
- `package.json` e `package-lock.json`: comandos administrativos e driver
  PostgreSQL;
- este relatório.

## 13. Validações automatizadas

| Comando | Resultado |
|---|---|
| `node --check scripts/perf9a/*.mjs` | Aprovado |
| `npx tsc --noEmit` | Aprovado |
| `npm test -- --run` | Aprovado: 64 arquivos e 437 testes |
| `npm run lint` | Aprovado sem erros; 6 warnings preexistentes |
| `git diff --check` | Aprovado |
| `npx next build --webpack` | Aprovado; 62 páginas processadas |
| `npm run perf9a:cleanup -- --confirm PERF9A_fhgkmggthxikfpogrvaa` | Dry-run aprovado; nenhum registro removido |

O build preserva os warnings preexistentes do Handlebars sobre
`require.extensions`. O ambiente local usa Node 24, enquanto `package.json`
declara Node 22.x; essa divergência foi registrada e não alterou o resultado
dos testes. A auditoria do npm informou vulnerabilidades em dependências, mas
não foi executado `npm audit fix`, pois isso excederia o escopo e poderia
alterar versões de forma ampla.

## 14. Matriz de evidências

| Área | Cenário | Evidência | Resultado | Bloqueador | Observação |
|---|---|---|---|---|---|
| Ambiente | homolog/projeto/branch | variáveis, ref e Git | Aprovado | Não | projeto confirmado |
| Backup | snapshot pré-carga | arquivo e SHA-256 | Aprovado | Não | fora do repo |
| Auth | vinte usuários com TOTP | Auth + status | Aprovado | Não | credenciais não versionadas |
| Massa | volumes mínimos | `perf9a:status` | Aprovado | Não | prefixo `PERF9A_` |
| Gestor | acesso cruzado A → B | JWT AAL2 | **Reprovado** | **Sim** | fundo, operação e NF visíveis |
| Gestor | acesso cruzado B → A | JWT AAL2 | **Reprovado** | **Sim** | Fundo A visível |
| Consultor | carteira A → NF B | JWT AAL2 | **Reprovado** | **Sim** | NF visível |
| Cedente | NF de outro cedente | JWT AAL2 | Aprovado | Não | zero linhas |
| Sacado | NF de outro CNPJ | JWT AAL2 | Aprovado | Não | zero linhas |
| Operações | distribuição e lote | seed/status | Preparado | Não | execução funcional interrompida |
| Onboarding | 60 sem fundo | seed/status | Preparado | Não | smoke interrompido |
| NFs | 1.000 registros | seed/status | Preparado | Não | smoke interrompido |
| Documentos | 900/1.000 | seed/status | Preparado | Não | análise interrompida |
| Auditoria | 1.000 logs | seed/status | Preparado | Não | cursor interrompido |
| Notificações | 4.500 registros | seed/status | Preparado | Não | Realtime interrompido |
| Escrow | 80/5.000 | seed/status | Preparado | Não | planos interrompidos |
| Dashboards | massa representativa | seed/status | Preparado | Não | medição interrompida |
| Relatórios | massa representativa | seed/status | Preparado | Não | golden interrompido |

## 15. Checklist de retomada

- [x] Confirmar homologação, projeto e branch.
- [x] Confirmar Escopo 8 e schema cache.
- [x] Criar backup lógico.
- [x] Criar massa prefixada.
- [x] Criar usuários representativos com MFA.
- [x] Executar primeiro gate RLS com JWT real e AAL2.
- [ ] Criar migration incremental para isolamento por fundo/carteira.
- [ ] Repetir a matriz RLS completa.
- [ ] Testar RPCs e ações com IDs adversários.
- [ ] Executar smoke das 26 rotas.
- [ ] Executar Realtime em duas sessões.
- [ ] Medir navegador e React Profiler.
- [ ] Reexecutar EXPLAIN e decidir índices.
- [ ] Validar golden financeiro.
- [ ] Validar URLs assinadas.
- [ ] Executar validações finais e reclassificar o parecer.

## Atualização posterior — Escopo 9B

O Escopo 9B corrigiu as policies de isolamento em migration incremental e a
matriz autenticada foi repetida com sessões AAL2 reais. O resultado da matriz
9B está documentado em
`docs/performance/relatorio-escopo-9b-isolamento-rls.md`.

Esta atualização não altera o parecer histórico do Escopo 9A: o gate completo
de homologação ainda precisa ser retomado e executado integralmente.

## 16. Parecer

**NO-GO para produção.**

A massa e a infraestrutura de homologação do Escopo 9A estão disponíveis e
repetíveis. Entretanto, o isolamento multifundo e de carteira falhou com
sessões reais AAL2. O problema permite leitura direta por ID e não pode ser
mitigado apenas pela interface.

O 9A deve permanecer interrompido até uma correção explícita das policies,
seguida da repetição integral dos gates. Como Realtime, 26 rotas, navegador,
Profiler, EXPLAIN pós-volume, golden financeiro e URLs assinadas não foram
executados depois do bloqueador, nenhum parecer menos restritivo é defensável.

## 17. Referência ao Escopo 9B

O bloqueador de isolamento registrado neste relatório foi tratado
exclusivamente no Escopo 9B, com policies RLS incrementais, helpers privados e
matriz autenticada AAL2. O 9A continua sem parecer de produção; a evidência
posterior e as limitações remanescentes estão em
[`relatorio-escopo-9b-isolamento-rls.md`](./relatorio-escopo-9b-isolamento-rls.md).

A retomada posterior dos gates, sem substituir este parecer histórico, está
documentada em
[`relatorio-homologacao-escopo-9a-retomada.md`](./relatorio-homologacao-escopo-9a-retomada.md).
