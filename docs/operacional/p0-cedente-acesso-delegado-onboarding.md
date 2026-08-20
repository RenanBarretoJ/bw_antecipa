# P0 — Usuário com acesso delegado (cedente_acessos) travado fora do cedente ativo

## Resultado

`P0_CEDENTE_ACESSO_DELEGADO_ONBOARDING = PASS` (3 sintomas originais +
varredura completa do portal do Cedente, ambas confirmadas ao vivo)
`P0_CARREGANDO_PORTAL_INFINITO = MITIGADO, causa exata não confirmada`

- Ambiente validado: homologação.
- Projeto Supabase: `fhgkmggthxikfpogrvaa`.
- Produção: não acessada nem alterada.
- Branch: `homolog`.
- Nenhum commit ou push foi executado — aguardando validação do usuário.

## Origem

Incidente reportado ao vivo pelo usuário (sem ticket prévio, com prints):
1. Um cadastro vinculado a um cedente ativo não via todas as abas ao acessar
   o cedente, como se não estivesse com cadastro ativo.
2. O mesmo cedente foi adicionado/convidado mais de uma vez, e o usuário
   suspeitou que isso teria desvinculado o cedente do fundo.
3. O portal (cedente e gestor) ficou preso em "Carregando portal..." para
   sempre, mesmo para uma conta híbrida gestor+super admin que conseguia
   acessar `/admin` normalmente.

## Diagnóstico (ao vivo, antes de qualquer alteração)

Consulta direta (somente leitura) aos dados reais em homologação (cedente
RLX FLUOROCHEMICAL, CNPJ `07.312.248/0001-37`) mostrou:

- `cedente_fundos` **está ativo** — o vínculo com o fundo nunca foi
  removido. A percepção de "desvinculado" era um efeito colateral dos bugs
  abaixo, não uma perda real de dado.
- A conta "Breno RX" que via a aba reduzida **não é a dona** do cadastro
  (`cedentes.user_id`) — é um acesso delegado via `cedente_acessos`
  (`perfil = 'administrador'`, `ativo = true`, convidado pelo gestor). Havia
  **3 convites ativos** para esse mesmo cedente, todos com `perfil =
  'administrador'` — evidência direta de que o gestor tentou convidar/
  conceder acesso repetidamente, quase certamente porque a tela "Acessos
  Vinculados" mostrava "Nenhum usuário adicional vinculado" mesmo depois de
  cada convite ter sido criado com sucesso.

### Causa raiz #1 — `cedentes.user_id` como único caminho de resolução

`middleware.ts` (redirecionamento de onboarding) e `src/app/cedente/
layout.tsx` (menu lateral) resolviam "o cedente do usuário atual" com
```
.from('cedentes').select(...).eq('user_id', user.id)
```
Essa query só encontra o **dono**. Um usuário com acesso delegado
(`cedente_acessos`) nunca aparece aí, mesmo com o cedente `ativo` — então:
- o middleware redirecionava **toda navegação** (exceto os 4 caminhos
  liberados durante onboarding) para `/cedente/cadastro`, prendendo o
  usuário lá para sempre;
- o menu lateral nunca saía do conjunto restrito de onboarding.

Confirmado ao vivo com um usuário convidado real (`get_user_cedente_id()`
executado como esse usuário resolve corretamente o cedente via
`cedente_acessos`; a query por `user_id` não encontra nada) e depois
reproduzido de ponta a ponta num browser real: antes da correção, navegar
para `/cedente/dashboard` terminava em `/cedente/cadastro`.

**Correção**: `middleware.ts` e `CedenteLayout` passam a resolver o cedente
via `get_user_cedente_id()` (RPC `SECURITY DEFINER` já existente, que já
resolve dono OU acesso delegado ativo) antes de consultar `cedentes` por
`id`, em vez de filtrar só por `user_id`.

### Causa raiz #2 — `cedente_acessos` sem `GRANT` para `authenticated`

A canonicalização de ACL/RLS (`20260817150507_p2_6_4_canonicalizar_acl_rls.sql`)
revogou deliberadamente `SELECT/INSERT/UPDATE/DELETE` de `authenticated` em
~50 tabelas sensíveis, incluindo `cedente_acessos` — a intenção é que só
`service_role`/RPC leiam essa tabela. Isso é o **mesmo padrão** já
documentado no P0 "Mutações do cadastro do Cedente pelo Gestor"
(`DIRECT_WRITE_AFTER_ACL_HARDENING`), mas em 4 pontos de chamada que nunca
foram migrados para esse padrão e continuaram lendo a tabela direto pelo
client autenticado — a leitura falha com `permission denied`, descartado
em silêncio (nenhum desses pontos checava `{ error }`):

| Ponto de chamada | Efeito do bug |
| --- | --- |
| `requireCedenteAccess` (`src/lib/auth/authorization.ts`) | Todo usuário com acesso delegado era tratado como **sem acesso** em qualquer Server Action que dependa dessa checagem. |
| `ehAdministrador` (`src/lib/actions/cedente.ts`) | Usuário convidado como `administrador` nunca conseguia editar/enviar documentos cadastrais como administrador. |
| `usuarioEhAdministradorCedente` (`src/lib/auth/mfa.ts`) | MFA obrigatório para administrador delegado nunca era exigido. |
| Tela "Acessos Vinculados" do Gestor (`src/app/gestor/cedentes/[id]/page.tsx`, via `listarPerfisAcessosCedente`) | Sempre mostrava "Nenhum usuário adicional vinculado", mesmo com convites ativos — explica o gestor ter convidado a mesma pessoa múltiplas vezes. |

**Correção**: nova RPC `SECURITY DEFINER` `get_user_cedente_acesso_perfil()`
(mesmo padrão de `get_user_cedente_id()` já existente), usada por
`requireCedenteAccess` (via `get_user_cedente_id()`, reaproveitada),
`ehAdministrador` e `usuarioEhAdministradorCedente`. A tela do gestor passa
a chamar uma nova `listarAcessosVinculadosCedente` (`src/lib/actions/
gestor.ts`), que lê `cedente_acessos` via `service_role` (mesmo padrão já
usado pelas funções vizinhas de convite/revogação no mesmo arquivo).

### `P0_CARREGANDO_PORTAL_INFINITO` — mitigado, causa exata não confirmada

`PortalShell` (`src/components/layout/portal-shell.tsx`, usado por todos os
portais) lia `profiles` com `.single()` sem checar erro; se a linha não
existir (ex.: corrida entre o signup e o trigger que cria `profiles`) ou o
papel não corresponder, o código só fazia `router.push(...)` **sem** chamar
`setLoading(false)`. Se o destino calculado for a **mesma** rota em que o
usuário já está, `router.push` é um no-op — a tela fica presa no spinner
"Carregando portal..." para sempre, sem nenhum erro visível.

Esse é um bug real e genérico (não depende de `cedente_acessos`), mas eu
**não consegui confirmar** que foi exatamente essa a causa do
`/gestor/dashboard` travado relatado pelo usuário — os dados da conta
gestora (`profiles`, `usuario_papeis`, MFA) estavam íntegros em
homologação, sem nenhuma linha corrompida ou trava de banco. Não tenho as
credenciais reais para reproduzir a sessão exata do navegador do usuário, e
por instrução do processo não corrijo por hipótese sem confirmação — por
isso este item fica classificado como **mitigado** (o código agora nunca
trava nesse branch, com até 3 tentativas de releitura do perfil antes de
desistir) em vez de **causa raiz confirmada**. Se o problema se repetir,
peça para abrir o DevTools (Network/Console) no momento do travamento —
isso confirmaria se é este branch ou outra causa.

## Correções aplicadas

- `supabase/migrations/20260820150000_get_user_cedente_acesso_perfil.sql`
  — nova RPC `SECURITY DEFINER`.
- `src/lib/supabase/middleware.ts` — redirecionamento de onboarding via
  `get_user_cedente_id()`.
- `src/app/cedente/layout.tsx` — menu lateral via `get_user_cedente_id()`.
- `src/lib/auth/authorization.ts` — `requireCedenteAccess` via
  `get_user_cedente_id()` (RPC já existente, reaproveitada).
- `src/lib/actions/cedente.ts` — `ehAdministrador` via
  `get_user_cedente_acesso_perfil()`.
- `src/lib/auth/mfa.ts` — `usuarioEhAdministradorCedente` via
  `get_user_cedente_acesso_perfil()`.
- `src/lib/actions/gestor.ts` — nova `listarAcessosVinculadosCedente`
  (substitui `listarPerfisAcessosCedente`), lendo via `service_role`.
- `src/app/gestor/cedentes/[id]/page.tsx` — usa a nova função; removida a
  leitura direta e quebrada de `cedente_acessos`.
- `src/components/layout/portal-shell.tsx` — retry de leitura do perfil +
  `setLoading(false)` garantido antes de qualquer redirect (mitigação do
  spinner infinito).
- `src/types/database.ts` — tipo da nova RPC.

**Varredura completa (segunda rodada, achada pelo usuário ao vivo)**:
- `supabase/migrations/20260820160000_dashboard_cedente_resumo_acesso_delegado.sql`
  — RPC SQL `dashboard_cedente_resumo` corrigida (mesmo padrão, dentro do banco).
- `src/lib/analytics/loaders.server.ts` (Dashboard), `src/lib/auth/
  platform-access.ts` (área/pós-login), `src/lib/notas-fiscais/
  listagem.server.ts` (Minhas NFs), `src/lib/operacoes/listagem.server.ts`
  (Minhas Operações), `src/lib/cedentes/estabelecimentos-listagem.server.ts`
  (Meus CNPJs), `src/lib/actions/estabelecimento.ts`, `src/lib/actions/
  operacao.ts`, `src/lib/operacoes/nova-solicitacao.server.ts` (Nova
  Solicitação), `src/lib/actions/cedente-fundo-ativo.ts`, `src/lib/actions/
  selectors.ts`, `src/lib/escrow/movimentos.server.ts`, `src/app/cedente/
  extrato/page.tsx`, `src/components/fundos/cedente-fundo-ativo-selector.tsx`
  — todos resolvem o cedente via `get_user_cedente_id()`.
- `src/app/gestor/cedentes/[id]/page.tsx` — dropdown "Fundo Vinculado"
  resolve o label do fundo explicitamente (não mais UUID cru).

## Testes

- **Live E2E (SQL)**, ao vivo em homologação contra a conta real afetada
  (Breno RX): `get_user_cedente_id()` resolve o cedente correto via
  `cedente_acessos`; `get_user_cedente_acesso_perfil()` retorna
  `administrador`; `SELECT` em `cedentes` por `id` funciona via RLS; leitura
  direta de `cedente_acessos` como `authenticated` **ainda falha**
  (confirma que o grant continua intencionalmente restrito a
  `service_role` — a correção é na camada de chamada, não reabrindo o
  grant).
- **Live E2E (browser)** — `scripts/homologacao/p0-cedente-acesso-
  delegado/browser-e2e.mjs`, **12/12 PASS** com Chrome real contra `npm
  run dev:homolog`: cria um cedente dono + um usuário convidado
  (`administrador`, via `cedente_acessos`, mesmo caminho que
  `convidarUsuarioCedente` usa) + um gestor; confirma que o convidado
  navega até `/cedente/dashboard` sem ser preso em `/cedente/cadastro`, vê
  o menu completo, carrega `/cedente/estabelecimentos`, `/cedente/notas-
  fiscais` e `/cedente/operacoes` sem "This page couldn't load", e que o
  gestor vê o convite em "Acessos Vinculados" e o dropdown "Fundo
  Vinculado" com o nome do fundo (não o UUID).
- 25 testes de arquitetura em `src/lib/auth/cedente-acesso-delegado-
  architecture.test.ts`: os 6 pontos de chamada da primeira correção + os
  11 pontos da varredura completa (incluindo a RPC SQL
  `dashboard_cedente_resumo`) usam a RPC certa e não leem `cedente_acessos`
  direto; a RPC nova é `SECURITY DEFINER` e `GRANT`ed para `authenticated`;
  `PortalShell` sempre chama `setLoading(false)` antes do redirect por
  perfil ausente/divergente; o dropdown "Fundo Vinculado" resolve o label
  explicitamente.
- Suíte completa (`npx vitest run`): **163 arquivos / 1257 testes, 0
  falhas** (25 testes novos).
- `npx tsc --noEmit`: limpo. `npx eslint .`: mesmos 6 warnings
  pré-existentes e não relacionados. `npx next build --webpack`: sucesso.
  `npm audit --omit=dev`: 0 vulnerabilidades. `git diff --check`: limpo.

## Atualização — varredura completa concluída (achado pelo usuário ao vivo)

Após a primeira correção, o usuário testou com a conta convidada real e
confirmou ao vivo exatamente o que este relatório havia previsto na seção
"Achado maior" (versão anterior deste documento): o menu lateral abria
completo, mas "Dashboard" redirecionava de volta para `/cedente/cadastro`,
e "Meus CNPJs"/"Minhas NFs"/"Minhas Operações" quebravam com "This page
couldn't load". Isso confirmou a suspeita e motivou completar a varredura
que antes havia sido deliberadamente adiada.

**Todos os pontos de chamada identificados foram corrigidos** (mesmo
padrão: resolver o cedente via `get_user_cedente_id()` em vez de
`.eq('user_id', auth.uid())`):

- `src/lib/analytics/loaders.server.ts` (`carregarDashboardCedente` —
  Dashboard).
- `src/lib/auth/platform-access.ts` (`carregarAcessoPlataforma`, usado
  pelo middleware e pelo redirecionamento pós-login — achado adicional,
  fora da lista original de 15, no mesmo fluxo de resolução de área).
- `src/lib/notas-fiscais/listagem.server.ts` (Minhas NFs).
- `src/lib/operacoes/listagem.server.ts` (Minhas Operações).
- `src/lib/cedentes/estabelecimentos-listagem.server.ts` (Meus CNPJs).
- `src/lib/actions/estabelecimento.ts`, `src/lib/actions/operacao.ts`
  (`solicitarAntecipacao`), `src/lib/operacoes/nova-solicitacao.server.ts`
  (Nova Solicitação), `src/lib/actions/cedente-fundo-ativo.ts`,
  `src/lib/actions/selectors.ts`, `src/lib/escrow/movimentos.server.ts`,
  `src/app/cedente/extrato/page.tsx`,
  `src/components/fundos/cedente-fundo-ativo-selector.tsx`.

**Achado adicional durante a varredura, também corrigido**: a própria RPC
SQL `dashboard_cedente_resumo` (chamada por `carregarDashboardCedente`)
tinha a checagem de autorização escrita como `c.user_id = auth.uid()` —
mesmo bug, dentro do banco em vez do TypeScript. Corrigida em
`supabase/migrations/20260820160000_dashboard_cedente_resumo_acesso_delegado.sql`
para `c.id = public.get_user_cedente_id()`, reproduzindo o corpo integral
da função vigente antes de editar (mesma disciplina já seguida nas
correções anteriores desta sessão).

**Achado adicional, não corrigido (fora do escopo, baixo risco)**: o
mesmo padrão `c.user_id = auth.uid()` também aparece em pelo menos 3
outras RPCs SQL bem mais específicas — geração de documento (`fase6_
templates_juridicos_fundo.sql`), remessa CNAB (`fase7_cnab_configuravel_
rastreavel.sql`) e execução de integração de fundo (`fase8_portal_fidc_
fundo.sql`). Diferente do dashboard (que todo cedente acessa ao logar),
essas são ações administrativas pontuais que um usuário `administrador`
delegado eventualmente precisaria, mas não foram confirmadas como
efetivamente exercitadas neste incidente. Recomendo tratar como um
follow-up dedicado, não corrigido às pressas aqui.

## UI: dropdown "Fundo Vinculado" mostrava o UUID em vez do nome do fundo

Achado adicional pelo usuário (print). `Select.Value` (Base UI) só resolve
o texto exibido a partir dos `SelectItem` já **registrados** no popup —
confirmado inspecionando o DOM ao vivo: no primeiro carregamento da
página, antes de qualquer interação, o `span` do valor mostrava o UUID
cru, não o nome. Corrigido resolvendo o label explicitamente no próprio
componente (`fundos.find((f) => f.id === fundoSelecionado)?.nome`), via
`children` de `SelectValue`, em vez de depender da resolução automática da
biblioteca — confirmado ao vivo no browser antes e depois do fix.

## Pendências

- 3 RPCs SQL mais específicas (documento gerado, remessa CNAB, execução de
  integração de fundo) com o mesmo padrão `c.user_id = auth.uid()` — não
  corrigidas aqui, ver seção "Atualização" acima.
- Causa exata do `/gestor/dashboard` "Carregando portal..." infinito não
  confirmada (mitigada, não corrigida por hipótese) — ver seção
  correspondente.
