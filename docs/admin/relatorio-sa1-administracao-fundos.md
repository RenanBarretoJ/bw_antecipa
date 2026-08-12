# SA1 — Administração estrutural de fundos

## 1. Objetivo

O SA1 introduz a administração estrutural de fundos no domínio de plataforma do
BW Antecipa. Antes desta entrega, a criação e a alteração do cadastro-base do
fundo estavam expostas no contexto operacional do gestor. Isso misturava duas
responsabilidades distintas:

- administração da plataforma: identidade, participantes e ciclo de vida do
  fundo;
- operação do fundo: políticas, templates, CNAB, integrações e vínculos.

A nova arquitetura reserva o primeiro grupo ao `super_admin` e mantém o segundo
grupo no portal do gestor, sempre no contexto de um fundo ao qual o gestor está
autorizado.

## 2. Arquitetura antes e depois

### Antes

```text
Gestor
  ↓
/gestor/fundos
  ↓
INSERT/UPDATE em fundos
  ↓
Cadastro estrutural e configuração operacional no mesmo contexto
```

### Depois

```text
Super Admin
  ↓
/admin/fundos
  ↓
Server Action + MFA fresco
  ↓
RPC administrativa fechada
  ↓
Validação de super_admin no banco
  ↓
fundos + plataforma_auditoria (mesma transação)
```

```text
Gestor autorizado
  ↓
/gestor/fundos/[id]
  ↓
Políticas, templates, CNAB e integrações

Sem criação, edição estrutural ou alteração do ciclo de vida do fundo
```

## 3. Fronteira de responsabilidades

| Responsabilidade | Super Admin | Gestor |
| --- | --- | --- |
| Criar fundo | Sim | Não |
| Editar identidade estrutural | Sim | Não |
| Ativar, desativar ou reativar | Sim | Não |
| Excluir fundo | Não | Não |
| Vincular usuários e cedentes | Fora do SA1 | Mantido nos fluxos autorizados |
| Configurar política operacional | Não nesta área | Sim |
| Configurar templates jurídicos | Não nesta área | Sim |
| Configurar CNAB | Não nesta área | Sim |
| Configurar integração | Não nesta área | Sim |

Os campos estruturais autorizados são nome, CNPJ, administradora, gestora,
custodiante, endereço e ato declaratório da administradora e contato. Banco,
agência, conta, código originador, políticas, templates e integrações não fazem
parte do payload administrativo estrutural.

## 4. Navegação e interface

O menu administrativo contém somente:

- Visão geral: `/admin`;
- Fundos: `/admin/fundos`.

As rotas do SA1 são:

- `/admin/fundos`: busca server-side por nome ou CNPJ, filtro por status e
  paginação de 20, 50 ou 100 registros;
- `/admin/fundos/novo`: criação estrutural;
- `/admin/fundos/[id]`: detalhe com as abas `Geral` e `Auditoria`.

O detalhe permite edição estrutural e alteração do ciclo de vida. Não exibe
editores operacionais, IDs internos como informação principal nem ação de
exclusão.

O cadastro sempre nasce inativo. A ativação é uma decisão explícita posterior e
é permitida mesmo quando ainda não existem política, template, CNAB ou
integração. A ausência dessas configurações deve ser tratada pelos respectivos
gates operacionais, não pelo cadastro estrutural.

## 5. Modelo de dados

### `fundos`

A tabela existente permanece como fonte de verdade do cadastro estrutural. O
SA1 acrescenta:

- `created_by`: usuário que criou o fundo, com `ON DELETE SET NULL`;
- `updated_at`: versão temporal usada para concorrência otimista;
- trigger `fundos_updated_at`: atualiza `updated_at` em alterações efetivas.

Também foram removidos defaults legados de gestora e custodiante. Um fundo novo
não pode herdar silenciosamente empresas específicas de um cadastro histórico.
O custodiante passou a ser opcional.

Índices:

- `fundos_cnpj_normalizado_unique`: impede CNPJ duplicado independentemente de
  máscara;
- `fundos_ativo_nome_idx`: apoia listagem e filtro administrativo por status e
  nome.

### `plataforma_auditoria`

A tabela criada no SA0 continua sendo a trilha administrativa. Cada mutação do
SA1 registra:

- tipo do evento;
- usuário autor;
- origem `admin_fundos`;
- `correlation_id` gerado no banco;
- `fundo_id`;
- estado anterior;
- estado posterior;
- data e hora.

O registro do fundo e a auditoria são executados na mesma transação da RPC. Se a
auditoria falhar, a mutação também é revertida.

### `autorizacoes_acoes_sensiveis`

O enum fechado de ações sensíveis foi ampliado com:

- `criar_fundo`;
- `atualizar_fundo_estrutural`;
- `ativar_fundo`;
- `desativar_fundo`.

Essas autorizações são temporárias, associadas à sessão MFA válida e consumidas
uma única vez pelo fluxo existente de ações sensíveis.

## 6. RPCs administrativas

As leituras e mutações administrativas são realizadas pelas seguintes funções:

| RPC | Responsabilidade |
| --- | --- |
| `admin_resumo_fundos` | Contadores globais de fundos ativos e inativos |
| `admin_listar_fundos` | Busca, filtro e paginação server-side |
| `admin_obter_fundo` | Detalhe estrutural de um fundo |
| `admin_listar_auditoria_fundo` | Eventos administrativos do fundo |
| `admin_criar_fundo` | Criação sempre inativa |
| `admin_atualizar_fundo` | Atualização da whitelist estrutural |
| `admin_ativar_fundo` | Ativação ou reativação idempotente |
| `admin_desativar_fundo` | Desativação idempotente |

Todas são `SECURITY DEFINER`, usam `search_path` fechado e validam no banco se
`auth.uid()` corresponde a perfil ativo com papel complementar `super_admin`
ativo. A interface usa o cliente autenticado do usuário; não usa `service_role`.

As RPCs não aceitam payload genérico JSON. Cada campo estrutural possui parâmetro
explícito, evitando alteração acidental de colunas operacionais.

## 7. Concorrência, idempotência e ciclo de vida

Edição e ciclo de vida recebem `updated_at` visto pela interface. A RPC bloqueia
a linha e compara o valor recebido com o atual. Em divergência, retorna conflito
de concorrência e exige recarregamento.

Ativar um fundo já ativo e desativar um fundo já inativo são operações
idempotentes: retornam o estado atual sem gerar evento duplicado. Quando um fundo
que já possui evento de desativação volta ao estado ativo, a auditoria registra
`FUNDO_REATIVADO`; na primeira ativação registra `FUNDO_ATIVADO`.

Eventos gerados:

- `FUNDO_CRIADO`;
- `FUNDO_ATUALIZADO`;
- `FUNDO_ATIVADO`;
- `FUNDO_DESATIVADO`;
- `FUNDO_REATIVADO`.

Não existe exclusão de fundo no SA1.

## 8. Segurança e autorização

A proteção é aplicada em camadas:

1. o layout `/admin` exige contexto de Super Admin;
2. loaders e Server Actions executam `requireSuperAdmin()`;
3. mutações exigem confirmação TOTP fresca pelo mecanismo
   `autorizarEConsumirAcaoSensivel()`;
4. a RPC repete a validação do papel real no banco;
5. `authenticated` não possui `INSERT`, `UPDATE` ou `DELETE` direto em `fundos`;
6. não existe bypass global de RLS ou cliente `service_role` na interface;
7. a whitelist de parâmetros impede escalada para configuração operacional;
8. auditoria é obrigatória e transacional.

As RPCs administrativas são executáveis somente por `authenticated`, mas a
permissão de execução não basta: a checagem interna de `super_admin` é
obrigatória. `anon` e `service_role` não recebem execução dessas rotinas.

## 9. Compatibilidade operacional

O detalhe operacional `/gestor/fundos/[id]` foi preservado. O gestor continua
configurando política, templates, CNAB e integrações para fundos autorizados.
Somente as mutações do cadastro-base foram removidas da área do gestor.

Não são criados automaticamente:

- `usuario_fundos`;
- `cedente_fundos`;
- políticas;
- templates;
- configurações CNAB;
- integrações.

Um fundo inativo continua visível para auditoria administrativa, mas não deve
ser resolvido como fundo operacional ativo. O resolvedor existente já exclui
fundos com `ativo = false`, e o motor P1 de comunicações passou a consultar
explicitamente somente fundos ativos.

## 10. Arquivos principais

- `supabase/migrations/20260812143000_sa1_admin_fundos.sql`: modelo incremental,
  RPCs, grants, validações e auditoria;
- `src/lib/admin/fundos.ts`: validação e tipos do domínio estrutural;
- `src/lib/admin/fundos.server.ts`: loaders administrativos;
- `src/app/admin/fundos/actions.ts`: casos de uso de mutação;
- `src/components/admin/fundo-structural-form.tsx`: formulário de criação e
  edição;
- `src/components/admin/fundo-lifecycle-action.tsx`: confirmação de ciclo de
  vida;
- `src/app/admin/fundos/page.tsx`: listagem administrativa;
- `src/app/admin/fundos/novo/page.tsx`: criação;
- `src/app/admin/fundos/[id]/page.tsx`: detalhe e auditoria;
- `src/app/gestor/fundos/page.tsx`: listagem operacional somente leitura;
- `src/lib/comunicacoes/motor.server.ts`: exclusão explícita de fundos inativos
  dos jobs de comunicação;
- `src/lib/admin/*.test.ts`: testes de domínio e arquitetura.

## 11. Validação e homologação

Antes da homologação funcional:

- [ ] aplicar a migration incremental no projeto correto;
- [ ] confirmar o reload do schema do PostgREST;
- [ ] criar um fundo e verificar que nasce inativo;
- [ ] confirmar que nenhum `usuario_fundos` ou configuração foi criado;
- [ ] validar CNPJ inválido e CNPJ duplicado;
- [ ] validar bloqueio para gestor e usuário comum;
- [ ] validar TOTP ausente, inválido, expirado e reutilizado;
- [ ] ativar, desativar e reativar;
- [ ] repetir ativação/desativação e confirmar idempotência;
- [ ] provocar edição concorrente em duas abas;
- [ ] conferir os cinco tipos de evento na aba Auditoria;
- [ ] confirmar que fundo inativo não aparece como contexto operacional;
- [ ] confirmar que jobs de comunicação ignoram fundo inativo;
- [ ] conferir que o detalhe operacional do gestor permanece funcional.

## 12. Limitações e próximos blocos

O SA1 não administra usuários, papéis, convites ou vínculos de gestores. Também
não implementa configuração operacional, exclusão, restauração de dados ou
prontidão produtiva do fundo. Esses itens pertencem aos próximos escopos
administrativos e aos módulos operacionais existentes.

A migration não deve ser considerada homologada apenas por compilar a aplicação.
Ela precisa ser aplicada em banco de homologação e validada com usuários reais,
RLS, MFA e concorrência. Nesta entrega local, nenhum segredo ou credencial foi
adicionado à documentação.

## 13. Parecer técnico

O SA1 estabelece uma fronteira coerente entre plataforma e operação. O cadastro
estrutural deixa de depender de fundo ativo e fica restrito ao Super Admin, com
MFA fresco, autorização redundante no banco, concorrência otimista e auditoria
transacional. O gestor conserva os fluxos operacionais já existentes, sem ganhar
acesso global e sem perder o detalhe contextual do fundo.

O bloqueio para produção é operacional: aplicar e homologar a migration no banco
alvo, executar os testes reais de RLS/MFA e validar os impactos de desativação em
jobs e sessões concorrentes.
