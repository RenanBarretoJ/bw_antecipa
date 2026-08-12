# SA0 — Fundação do Super Admin e bootstrap administrativo

## 1. Objetivo

O SA0 cria a fundação administrativa da plataforma BW Antecipa sem transformar
o Super Admin em gestor global. O resultado separa a administração da plataforma
do contexto operacional por fundo, permite iniciar homologação com zero fundos e
elimina o erro de runtime do gestor ainda não vinculado a um fundo.

Este escopo não cria fundos, usuários pela interface, vínculos, integrações,
políticas, templates, CNAB, operações, impersonação ou leitura consolidada.

## 2. Diagnóstico anterior

O modelo anterior possuía um único papel em `profiles.role`. O roteamento de um
gestor sempre terminava em `/gestor/dashboard`, cujo carregamento pressupunha um
registro ativo em `usuario_fundos`. Depois de um reset total, o primeiro gestor
era encaminhado para um loader que exigia fundo e a página terminava em erro.

Fluxo anterior:

```text
Auth user
  → profiles.role = gestor
  → /gestor/dashboard
  → resolver contexto de fundo
  → nenhum usuario_fundos ativo
  → Runtime Error
```

Também não havia papel de plataforma nem área administrativa independente.

## 3. Modelo de papel escolhido

A solução preserva `profiles.role` como papel primário e fonte das policies
operacionais existentes. O enum `user_role` recebe `super_admin`, e a tabela
complementar `usuario_papeis` registra capacidades acumuláveis.

```text
profiles.role
  → identidade operacional primária
  → continua alimentando get_user_role() e as RLS existentes

usuario_papeis
  → capacidades complementares
  → contém super_admin
  → não concede acesso operacional por fundo
```

Essa opção evita um booleano de bypass e evita reescrever as policies
operacionais. `public.get_user_role()` não foi alterada.

## 4. Multi-role

Os cenários suportados são:

| Cenário | Papel primário | Papéis ativos | Acesso |
|---|---|---|---|
| Super Admin puro | `super_admin` | `super_admin` | `/admin` |
| Gestor | `gestor` | `gestor` | `/gestor`, mediante fundo ativo |
| Híbrido | `gestor` | `gestor`, `super_admin` | `/admin` e `/gestor`, mediante fundo ativo |

Para um usuário híbrido, o papel primário permanece `gestor`. Assim, toda
operação continua passando pelas policies de gestor e por `usuario_fundos`. O
papel complementar `super_admin` não torna o usuário gestor do Fundo B quando ele
possui vínculo apenas com o Fundo A.

## 5. Autorização canônica

`requireSuperAdmin()` é o guard server-side da área administrativa. Ele:

1. exige usuário autenticado e perfil ativo;
2. preserva o gate MFA/AAL2 de 24 horas de `requireAuthenticated()`;
3. consulta `usuario_papeis` no banco;
4. exige o papel ativo `super_admin`;
5. não lê cookie de fundo e não chama resolvedor operacional.

A decisão de destino pós-autenticação e a autorização por área ficam
centralizadas em `platform-access.ts`. Metadata do Auth, query string,
localStorage e payload do navegador não são fontes de autorização.

## 6. Área `/admin`

Foi criada uma árvore própria:

```text
/admin
  → layout server-side protegido
  → shell administrativo próprio
  → visão geral do SA0
```

O layout não monta `FundoAtivoProvider`, não usa `usuario_fundos` como requisito
e não resolve fundo. A página raiz mostra a fundação ativa, MFA obrigatório e a
independência do contexto de fundo. Não existem ações antecipadas de SA1–SA3.

## 7. Layout e sidebar

`AdminShell` reutiliza apenas os componentes visuais neutros do portal: header,
sidebar, tema, notificações e sessão MFA. A sidebar administrativa exibe somente
`Visão geral`; a rota compartilhada de segurança continua disponível sem ser
apresentada como funcionalidade administrativa do SA0. A navegação é separada da
navegação do gestor. O único controle entre áreas é um link explícito:

- no gestor híbrido: `Administração`;
- no admin híbrido: `Gestão do fundo`; se não houver vínculo ativo, a rota do
  gestor apresenta o empty-state seguro.

Nenhum item administrativo foi inserido no menu operacional do gestor.

## 8. Roteamento

O destino depois de senha e TOTP é resolvido pela coleção canônica de papéis:

```text
Super Admin, puro ou híbrido → /admin
Gestor com fundo ativo       → /gestor/dashboard
Gestor sem fundo             → /gestor/sem-fundo
Cedente não aprovado         → /cedente/cadastro
Demais perfis                → dashboard já existente
```

Login, conclusão do MFA e proxy usam o mesmo resolvedor. O proxy faz uma
verificação antecipada; o layout `/admin` repete a autorização no servidor e é
a barreira final.

## 9. Gestor sem fundo

`/gestor/sem-fundo` exige somente o papel gestor. A página não chama
`resolverContextoFundoGestor()` nem analytics. O proxy redireciona gestores sem
vínculo ativo para esse estado e devolve ao dashboard quando um vínculo ativo
passa a existir, sem loop.

O empty-state informa que o usuário deve solicitar uma autorização de fundo.

## 10. Bootstrap

O comando adicionado é:

```powershell
npm run bootstrap:super-admin:homolog -- --email admin@empresa.com --expected-project-ref REF_HOMOLOG
```

O preview é o padrão. A execução exige simultaneamente:

```powershell
--execute
--expected-project-ref REF_HOMOLOG
--confirm PROVISIONAR_SUPER_ADMIN_HOMOLOG_REF_HOMOLOG
```

O script cobre três casos:

- usuário inexistente: envia convite pelo Supabase Auth e garante o profile;
- usuário gestor existente: preserva o papel primário e adiciona a capacidade;
- Super Admin existente: o upsert é idempotente e não duplica papel.

Papel e auditoria são concluídos pela mesma RPC transacional.

## 11. Segurança do bootstrap

O script:

- lê exclusivamente `.env.homolog`;
- exige `NEXT_PUBLIC_APP_ENV=homolog|homologacao`;
- rejeita `NODE_ENV=production`;
- compara o project ref da URL com o argumento explícito;
- exige e bloqueia o project ref de produção declarado;
- não possui `--force-production` nem bypass genérico;
- não recebe ou imprime senha;
- usa a service role apenas no processo Node administrativo;
- mascara o e-mail nos logs;
- nunca envia a service role ao navegador.

O convite do Supabase Auth é a estratégia de definição inicial de acesso. O
convite envia somente o nome do usuário. A migration endurece o trigger legado
de criação de profile para que `super_admin` recebido por metadata resulte em
um cedente comum, e o papel administrativo somente seja materializado pela RPC
restrita à service role.

## 12. MFA

`super_admin` foi incluído no catálogo de perfis com MFA obrigatório, no guard
de actions e no proxy. O fluxo permanece:

```text
senha → TOTP → AAL2 real → sessão operacional de 24 horas
```

Não existe exceção administrativa. Refresh não altera a duração e logout mantém
a revogação da sessão MFA atual. Ações sensíveis futuras devem reutilizar
`exigirSessaoOperacionalAal2()` e o mecanismo de TOTP fresco já existente.

## 13. RLS

`usuario_papeis` possui RLS e permite ao usuário autenticado apenas selecionar
os próprios papéis. `anon` e `authenticated` não recebem INSERT, UPDATE ou
DELETE. A RPC de bootstrap aceita somente JWT `service_role`.

`plataforma_auditoria` não possui policy para usuários autenticados e fica
restrita à service role neste SA0.

Nenhuma policy de `fundos`, `operacoes`, `notas_fiscais`, `documentos`, CT-e,
cedentes, sacados, contratos ou integrações foi ampliada para Super Admin.

## 14. Proteção contra escalada de privilégio

Um trigger `BEFORE UPDATE OF role` em `profiles` recusa mudança do papel
primário por sessão autenticada comum. A tabela complementar não concede
permissões de escrita a usuários autenticados. Portanto, os seguintes vetores
não promovem um usuário:

- formulário ou chamada direta do frontend;
- UPDATE direto de `profiles.role`;
- INSERT/UPDATE/DELETE direto em `usuario_papeis`;
- chamada da RPC com JWT autenticado comum;
- spoof de `user_metadata`.

Os grants cadastrais existentes de `profiles` foram preservados; a proteção é
feita pelo trigger para não quebrar atualizações legítimas de perfil.

## 15. Auditoria

O bootstrap registra `SUPER_ADMIN_BOOTSTRAP_PROVISIONADO` ou
`SUPER_ADMIN_BOOTSTRAP_REVALIDADO` com:

- usuário alvo;
- ator técnico `bootstrap_service_role`;
- ambiente `homologacao`;
- origem `bootstrap`;
- timestamp e correlation id;
- project ref sanitizado;
- papel primário preservado e indicador de idempotência.

Senha, token, service role key e secrets não entram na trilha. Page views de
`/admin` não são auditadas para evitar ruído.

## 16. Reset e procedimento pós-reset

O reset geral continua responsável apenas por limpar dados, Auth e Storage. O
schema e as migrations permanecem; logo, `usuario_papeis`, a RPC e os guards
continuam disponíveis vazios depois do reset.

Procedimento:

1. executar o reset geral de homologação pelo procedimento existente;
2. confirmar zero usuários e zero fundos;
3. executar o preview do bootstrap;
4. executar o bootstrap com ref e confirmação exatas;
5. concluir convite e MFA/TOTP;
6. fazer login;
7. confirmar `/admin` com zero fundos.

O reset não foi executado durante o SA0.

## 17. Migration

Migrations incrementais criadas, nesta ordem:

`supabase/migrations/20260812115900_sa0_super_admin_enum.sql`

`supabase/migrations/20260812120000_sa0_super_admin_roles.sql`

O enum foi isolado na primeira migration para que o novo valor seja confirmado
antes de ser usado em casts, tabelas e funções. A segunda contém tabelas,
índices, RLS, grants, triggers, backfill dos papéis primários e RPC transacional.
Nenhuma migration aplicada foi editada. As migrations não foram aplicadas
remotamente nesta entrega: a conexão MCP Supabase não estava
autenticada, e o escopo não autorizava aplicação direta em ambiente remoto.

## 18. Testes automatizados

Foram adicionados testes para:

- destino do Super Admin puro com zero fundos;
- destino do híbrido;
- gestor sem fundo;
- cedente em onboarding;
- bloqueio de `/admin` aos quatro papéis operacionais;
- ausência de acesso gestor automático ao Super Admin;
- guard server-side positivo e negativo;
- migration, RLS, grants e ausência de bypass operacional;
- proteção de papel primário;
- bootstrap dry-run, confirmação, ambiente, convite e ausência de senha;
- MFA obrigatório para `super_admin`;
- rota e empty-state sem loop.

Os testes existentes de autorização, MFA, logout e isolamento PERF9B permanecem
como regressão. Os resultados dos gates executados constam na seção 19.

## 19. Gates e regressões

Resultado local da implementação:

| Gate | Resultado |
|---|---|
| Testes focados SA0 | aprovado — 9 arquivos, 47 testes |
| TypeScript | aprovado — `npx tsc --noEmit` |
| Suite completa | aprovado — 105 arquivos, 773 testes |
| Lint | aprovado sem erros; 6 warnings preexistentes fora do SA0 |
| `git diff --check` | aprovado |
| Build webpack | aprovado — Next.js 16.2.6, 70 páginas; warnings preexistentes do Handlebars |
| Varredura de segredos | aprovado — 34 arquivos alterados/novos, nenhum padrão reconhecido |
| PERF9B/AAL2 | aprovado — regressão direcionada com 5 arquivos e 34 testes |

Nenhum reset, migration remota, commit ou push foi executado.

## 20. Smoke em homologação

O smoke remoto não foi executado porque a migration não foi aplicada e o MCP
Supabase não estava autenticado. Permanecem obrigatórios após aplicação:

1. Super Admin puro, zero fundos e zero `usuario_fundos`;
2. gestor sem fundo no empty-state;
3. gestor normal com fundo;
4. híbrido em `/admin` e Fundo A, sem acesso ao Fundo B;
5. login, MFA, logout e novo login pós-reset.

## 21. Riscos, limitações e próximos passos

- A migration precisa ser revisada/aplicada pelo processo controlado de homologação.
- O convite depende das configurações de URL e e-mail do Supabase Auth.
- O smoke real com AAL2 e RLS precisa ocorrer depois da migration.
- A remoção de admins não possui UI neste SA0; SA2 deverá impedir a remoção do
  último Super Admin ativo.
- Não há criação de fundo em `/admin`; isso pertence ao SA1.
- Não há administração de usuários, integrações ou visão operacional global.

## 22. Parecer

A arquitetura separa corretamente capacidade administrativa e papel operacional.
O Super Admin existe sem fundo, `/admin` não depende de contexto operacional e
o gestor sem fundo possui saída segura. O isolamento multifundo é preservado
porque o papel administrativo não foi introduzido em nenhuma RLS operacional.

O código fica apto à homologação após os gates locais e a aplicação controlada
da migration. A liberação produtiva não faz parte deste SA0 e depende dos smokes
reais, da validação do convite/MFA e dos próximos escopos administrativos.
