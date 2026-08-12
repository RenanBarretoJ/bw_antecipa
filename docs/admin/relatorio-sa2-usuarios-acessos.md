# SA2 — Administracao de usuarios, Gestores e acessos por fundo

## 1. Objetivo

O SA2 cria a administracao estrutural de usuarios da plataforma sem transformar o
Super Admin em operador global. O modulo permite convidar Gestores e Super Admins,
controlar o ciclo de vida da conta, administrar capacidades complementares e
manter vinculos explicitos entre Gestores e fundos.

## 2. Diagnostico

Antes do SA2, o projeto ja possuia o papel complementar `super_admin`, a area
`/admin`, o cadastro estrutural de fundos e a tabela canonica `usuario_fundos`.
Faltavam catalogo administrativo de usuarios, convite centralizado, detalhe de
seguranca, gestao de vinculos nos dois sentidos e protecao transacional do ultimo
Super Admin. Policies antigas ainda permitiam que Gestores alterassem vinculos.

## 3. Modelo multi-role

`profiles.role` continua sendo o papel primario usado pelo dominio operacional.
`usuario_papeis` armazena capacidades complementares. Assim, um Gestor hibrido
mantem `profiles.role = gestor` e recebe `usuario_papeis.super_admin`; isso nao
amplia seu acesso operacional. Um Super Admin puro possui papel primario
`super_admin`, capacidade correspondente e nenhum `usuario_fundos` automatico.

## 4. Catalogo de usuarios

`profiles` e a fonte do catalogo administrativo. A RPC `admin_listar_usuarios`
faz busca por nome/e-mail, filtros por papel, status e capacidade Super Admin,
agrega fundos operacionalmente validos e pagina em 20, 50 ou 100 registros. A
listagem nao consulta a Auth Admin API por linha.

## 5. Convite

`/admin/usuarios/novo` permite somente `gestor` e `super_admin`. Gestor pode ser
convidado sem fundo ou com fundos iniciais, inclusive fundos inativos. Super Admin
puro nao pode receber fundo. O e-mail e normalizado e a operacao exige TOTP fresco.
Nenhuma senha e solicitada, gerada ou armazenada pela aplicacao.

## 6. Auth

O convite usa `inviteUserByEmail` no adaptador server-only
`src/lib/admin/auth-admin.server.ts`. O perfil inicial e criado pelo trigger
canonico com papel Gestor; a RPC transacional finaliza o papel e os vinculos. Se
essa finalizacao falhar, o usuario Auth recem-convidado e removido como compensacao,
evitando um convite parcialmente provisionado. O template e as URLs de convite do
Supabase continuam sendo configuracao externa do projeto Auth.

## 7. Gestores

Gestor existente nao e duplicado. O fluxo apenas cria ou reativa os vinculos
solicitados. E-mails pertencentes a Cedente, Consultor ou Sacado nao sao convertidos.
Um Gestor pode receber a capacidade Super Admin sem perder o papel primario.

## 8. Vinculos

`usuario_fundos` permanece a unica fonte canonica. A constraint existente
`UNIQUE(usuario_id, fundo_id)` impede duplicidade. Vincular, revogar e reativar
ocorrem por RPCs especificas; nao existe DELETE. O par usuario/fundo recebe lock
transacional para tornar requisicoes concorrentes deterministicas e idempotentes.

## 9. Fundo inativo

Um vinculo pode ser preparado para fundo inativo e permanece visivel na area
administrativa. Ele nao concede contexto operacional enquanto `fundos.ativo` for
falso. A UI sinaliza explicitamente essa condicao e a resolucao de acesso consulta
usuario ativo, vinculo ativo e fundo ativo.

## 10. Desativacao

Desativar altera apenas `profiles.status` para `inativo`, preservando papeis,
vinculos e historico. A fonte de verdade para negar a proxima request e o perfil
da aplicacao. Como segunda camada, o adaptador Auth aplica bloqueio administrativo.
Autodesativacao foi bloqueada neste SA2.

## 11. Reativacao

A reativacao remove o bloqueio Auth e restaura `profiles.status = ativo`. Os
vinculos e papeis preservados voltam a produzir acesso somente quando tambem
estiverem ativos e o fundo estiver ativo. A operacao e idempotente.

## 12. Super Admin

Conceder Super Admin a um Gestor cria ou reativa a capacidade em
`usuario_papeis`; nao altera o papel primario e nao cria fundos. Super Admin puro
e criado explicitamente pelo convite administrativo e nao recebe permissao
operacional implicita.

## 13. Ultimo Super Admin

Revogacao de capacidade e desativacao chamam
`private.proteger_ultimo_super_admin`. A funcao usa advisory lock transacional,
conta somente perfis ativos com capacidade ativa e garante que pelo menos um
Super Admin permaneça. Autorrevogacao e autodesativacao estao bloqueadas.

## 14. MFA reset

O reset administrativo existente passou a exigir `requireSuperAdmin()` e reutiliza
o adaptador compartilhado que lista e remove fatores Auth. Tanto a acao direta do
detalhe administrativo quanto o fluxo legado de dupla aprovacao concluem a limpeza
pela mesma RPC `admin_concluir_reset_mfa`; nao existe um segundo nucleo de reset.
O fluxo invalida recovery codes, remove sessoes elevadas, limpa o marco MFA do
perfil e registra `MFA_RESETADO_ADMIN`. Self-reset administrativo e bloqueado; o
administrador usa o fluxo normal de Minha Seguranca para a propria conta.

## 15. Sessoes

Desativacao grava `sessoes_revogadas_em` e tenta bloquear o usuario no Auth. Reset
MFA remove sessoes elevadas e exige novo enrolamento. Revogar um fundo nao encerra
toda a sessao: a proxima resolucao server-side deixa de aceitar o vinculo e o
cookie de fundo nao concede autorizacao isoladamente.

## 16. RLS

Nenhuma policy operacional de operacoes, NFs, documentos, CT-es, cedentes ou
sacados recebeu bypass de Super Admin. As policies de mutacao direta de
`usuario_fundos` destinadas a Gestores foram removidas e os grants de
INSERT/UPDATE/DELETE para `authenticated` foram revogados. As operacoes SA2 usam
RPCs fechadas que revalidam Super Admin ativo no banco.

## 17. RPCs

Leitura: `admin_resumo_usuarios`, `admin_listar_usuarios`,
`admin_obter_usuario`, `admin_obter_usuario_por_email`,
`admin_listar_fundos_usuario`, `admin_listar_gestores_fundo` e
`admin_listar_auditoria_usuario`.

Mutacao: `admin_vincular_gestor_fundo`, `admin_vincular_gestor_fundos`,
`admin_revogar_gestor_fundo`, `admin_reativar_gestor_fundo`,
`admin_desativar_usuario`, `admin_reativar_usuario`,
`admin_conceder_super_admin`, `admin_revogar_super_admin`,
`admin_concluir_reset_mfa` e `admin_finalizar_convite_usuario`.

Todas sao `SECURITY DEFINER`, usam `search_path` fechado, parametros explicitos,
checagem de Super Admin e auditoria transacional quando alteram o banco.

## 18. Service role

Service role fica isolada em `auth-admin.server.ts` e e usada somente para convite,
bloqueio/desbloqueio Auth, compensacao de convite incompleto e remocao de fatores
MFA. Leituras administrativas, papeis e vinculos nao usam service role. O modulo
possui `server-only` e nao e importado por Client Components.

## 19. Auditoria

A tabela existente `plataforma_auditoria` registra ator, usuario alvo, fundo quando
aplicavel, origem `admin_usuarios`, antes/depois, timestamp e `correlation_id`.
As Server Actions geram um UUID por operacao e o propagam ate a RPC e a auditoria;
o banco gera um valor apenas como salvaguarda. Eventos cobertos: convite de Gestor, desativacao/reativacao,
vinculo/revogacao/reativacao, concessao/revogacao de Super Admin e reset MFA.
Senha, TOTP, token, fator e service role nao entram no payload.

## 20. Concorrencia

O ultimo Super Admin e protegido por lock global da regra administrativa. Vinculos
usam lock derivado do par usuario/fundo antes da leitura, alem da constraint UNIQUE.
Alteracoes de usuario e capacidade bloqueiam a linha de `profiles` com
`FOR UPDATE`. Lotes de fundos de um Gestor sao processados por uma unica RPC e
transacao.

## 21. Idempotencia

Vincular vinculo ja ativo, revogar vinculo ja revogado, conceder capacidade ja
ativa e reativar usuario ja ativo retornam o estado atual sem criar linha duplicada
ou evento repetido. Convite para e-mail ja catalogado segue regras explicitas por
papel, sem criar outro usuario.

## 22. UI

O menu administrativo contem Visao geral, Fundos e Usuarios & Acessos. Foram
criadas as rotas `/admin/usuarios`, `/admin/usuarios/novo` e
`/admin/usuarios/[id]`, com abas Geral, Fundos, Seguranca e Auditoria. O detalhe do
fundo ganhou a aba Gestores. Confirmacoes destrutivas e sensiveis solicitam TOTP,
nao exibem IDs como informacao principal e usam feedback global por toast.

## 23. Testes

Foram adicionados testes do dominio de convite/filtros, invariantes arquiteturais
da migration, isolamento de service role, multi-role, ultimo Super Admin,
idempotencia, eventos, ausencia de bypass operacional e resolucao de fundo ativo.
A suite SA1 foi atualizada para validar a extensao SA2 sem perder suas garantias.
Na validacao local, `npx tsc --noEmit` passou; a suite completa passou com 109
arquivos e 802 testes; o lint passou sem erros e com seis avisos preexistentes fora
do SA2; `git diff --check` passou; e `npx next build --webpack` concluiu com sucesso,
mantendo apenas os avisos preexistentes do Handlebars no webpack.
Os testes SQL transacionais e o smoke Auth dependem da aplicacao da migration em
homologacao.

## 24. Regressoes

SA0 permanece como fonte do papel complementar e do bootstrap. SA1 permanece como
administracao estrutural de fundos. O portal Gestor continua exigindo vinculo
explicito; Gestor sem fundo segue para `/gestor/sem-fundo`. Cedente, Consultor e
Sacado permanecem em seus onboardings. MFA/AAL2 e autorizacoes sensiveis existentes
foram reutilizados.

## 25. Riscos

Auth e Postgres nao compartilham uma transacao distribuida. O convite possui
compensacao, mas falha da propria compensacao exige reconciliacao administrativa.
Na desativacao, falha no bloqueio Auth gera aviso; o perfil inativo ainda nega a
proxima request server-side. Reset MFA atravessa Auth e banco e deve ser validado
em smoke real. As configuracoes externas de URL/template de convite tambem precisam
ser homologadas.

## 26. Limitacoes

O SA2 nao converte Cedente, Consultor ou Sacado em Gestor. Super Admin puro nao pode
ter sua capacidade removida isoladamente; deve ser desativado ou passar por um
procedimento explicito futuro. Self-demotion, self-deactivation e self-reset MFA
administrativo estao bloqueados. A tela nao inventa status de convite quando essa
informacao nao pode ser obtida do catalogo sem consulta Auth cara.

## 27. Proximos passos

Aplicar a migration em homologacao, atualizar o schema cache do PostgREST e executar
o smoke A-H: Gestor sem fundo, vinculo ativo, revogacao, reativacao, fundo inativo,
hibrido, ultimo Super Admin e reset MFA. Validar tambem template/redirect de convite,
logout/reentrada, sessoes abertas e concorrencia real. Itens posteriores de Super
Admin devem permanecer fora do SA2 ate nova autorizacao.

## 28. Parecer

A arquitetura separa corretamente administracao de plataforma e operacao por
fundo. Multi-role, vinculo canonico, fundo inativo, usuario inativo e ultimo Super
Admin sao tratados no servidor e no banco, sem conceder acesso operacional global.
O codigo fica pronto para homologacao depois da aplicacao da migration; producao
ainda depende dos testes SQL/Auth e smoke multifundo no ambiente remoto.

## Arquivos do escopo

- migration: `supabase/migrations/20260812170000_sa2_admin_usuarios_acessos.sql`;
- dominio/loaders/adaptador: `src/lib/admin/usuarios.ts`,
  `src/lib/admin/usuarios.server.ts`, `src/lib/admin/auth-admin.server.ts`;
- actions: `src/app/admin/usuarios/actions.ts` e restricao do reset em
  `src/app/actions/mfa.ts`;
- UI: rotas `src/app/admin/usuarios/**`, componentes `src/components/admin/**`,
  overview, menu e detalhe do fundo;
- autorizacao/tipos: `src/lib/auth/mfa.ts`, `src/lib/auth/platform-access.ts` e
  `src/types/database.ts`;
- testes: `src/lib/admin/usuarios.test.ts`,
  `src/lib/admin/sa2-architecture.test.ts`, regressao SA1 e platform access.

## Estado da migration

A migration foi criada, mas nao foi aplicada a banco remoto por este trabalho. O
MCP Supabase nao estava conectado nesta sessao. O comando solicitado
`npx supabase migration new sa2_admin_usuarios_acessos` falhou localmente porque a
CLI tentou recriar o diretorio de migrations ja existente; o arquivo incremental
foi criado com patch controlado, sem editar migrations aplicadas.
