# P0 — Mutações do cadastro do Cedente pelo Gestor

## Resultado

`P0_MUTACOES_CADASTRO_CEDENTE_GESTOR = PASS`

- Ambiente validado: homologação.
- Projeto Supabase: `fhgkmggthxikfpogrvaa`.
- Produção: não acessada nem alterada.
- Branch: `homolog`.

## Causa raiz

`aprovarCedente`, `reprovarCedente`, `toggleCoobrigacaoCedente`, `toggleEscrowCedente` e `aprovarAlteracaoCedente` (em `src/lib/actions/gestor.ts`) faziam `UPDATE`/`INSERT`/`DELETE` diretos em `public.cedentes`, `public.representantes` e `public.contas_escrow` com a sessão `authenticated` do gestor. O hardening de ACL já aplicado em P2.6.4 e no P0 de onboarding do cedente (`20260818191418_p0_onboarding_cedente_rpc_segura.sql`) havia revogado `INSERT/UPDATE/DELETE` de `authenticated` nessas três tabelas — as Server Actions do Gestor nunca foram migradas para RPC, daí o `permission denied for table cedentes`.

O inventário completo (pedido explicitamente pelo escopo, para evitar correção em cascata) encontrou **dois problemas adicionais não citados no relatório original**:

1. `aprovarCedente` também falhava ao criar a conta escrow (`INSERT` em `public.contas_escrow`, também revogado desde `20260817185117_hotfix_dashboard_gestor_acl.sql`) — um segundo `permission denied` dentro da mesma ação, mascarado pelo primeiro.
2. `solicitacoes_alteracao_cedente` tinha uma policy RLS legada (`sac_gestor_all`, "Gestor acessa tudo") sem checagem de fundo — qualquer gestor autenticado podia aprovar/reprovar alteração cadastral de **qualquer** cedente, de qualquer fundo. Isso não gerava `permission denied` (a tabela ainda concedia `UPDATE` a `authenticated`), mas era um `RLS_GAP` real de cross-fund leak.
3. Durante o próprio E2E automatizado deste P0, encontrei um **terceiro problema**: a policy `cedentes_gestor_all` (`FOR ALL USING (get_user_role() = 'gestor')`) nunca foi migrada para o padrão multifundo já aplicado em `documentos` — qualquer gestor conseguia **ler** (`SELECT`) cedentes de fundos aos quais não tem vínculo algum. Corrigido em uma segunda migration, já que a primeira já havia sido aplicada em homologação.

Classificação:

| Código | Resultado | Evidência |
| --- | --- | --- |
| `DIRECT_WRITE_AFTER_ACL_HARDENING` | Confirmado | `cedentes`, `representantes` e `contas_escrow` sem `INSERT/UPDATE/DELETE` para `authenticated` desde P2.6.4/hotfixes; 5 Server Actions ainda escreviam direto. |
| `RLS_GAP` | Confirmado (dois casos) | `sac_gestor_all` sem checagem de fundo; `cedentes_gestor_all` sem checagem de fundo (achado no próprio E2E). |
| `SERVER_ACTION_BUG` | Não confirmado isoladamente | O contexto de autenticação (`requireGestor`, MFA/AAL2) já estava correto; o problema era exclusivamente a camada de escrita/leitura. |
| `EXISTING_RPC_REUSABLE` | Confirmado para duas ações | "Salvar Taxas" (`taxas_cedente`, protegida por RLS multifundo já correta) e "Salvar Fundo Vinculado" (`cedente_fundos`, protegida pela função `requirePermissao('cedentes.vincular_fundo', {fundoId})` já correta) não precisaram de mudança. |
| `UNRESOLVED` | Zero | Diagnóstico fechado antes da implementação; o achado extra de leitura foi resolvido dentro do próprio escopo, sem deixar pendência. |

## Inventário das mutações da tela `/gestor/cedentes/[id]`

| Ação | Tabela(s) | Estado antes | Correção |
| --- | --- | --- | --- |
| Aprovar Cadastro | `cedentes`, `contas_escrow` | `permission denied` (2 pontos) | RPC `aprovar_cadastro_cedente_gestor` |
| Reprovar Cadastro | `cedentes` | `permission denied` | RPC `reprovar_cadastro_cedente_gestor` |
| Habilitar/Desabilitar Escrow | `cedentes` | `permission denied` | RPC `alternar_escrow_cedente_gestor` |
| Habilitar/Desabilitar Coobrigação | `cedentes` | `permission denied` | RPC `alternar_coobrigacao_cedente_gestor` |
| Aprovar alteração cadastral | `cedentes`, `representantes`, `solicitacoes_alteracao_cedente` | `permission denied` + `RLS_GAP` | RPC `aprovar_alteracao_cadastral_cedente_gestor` |
| Reprovar alteração cadastral | `solicitacoes_alteracao_cedente` | `RLS_GAP` (sem `permission denied`) | RPC `reprovar_alteracao_cadastral_cedente_gestor` |
| Salvar Taxas Pré-configuradas | `taxas_cedente` | Já protegida (RLS multifundo `taxas_cedente_gestor_all`) | Nenhuma — verificada, não alterada |
| Salvar Fundo Vinculado | `cedente_fundos` | Já protegida (`requirePermissao('cedentes.vincular_fundo', {fundoId})` na camada de aplicação) | Nenhuma — verificada, não alterada |
| Leitura do cedente (achado extra) | `cedentes` (SELECT) | `RLS_GAP` (`cedentes_gestor_all` sem fundo) | Policy `cedentes_gestor_multifundo_select` |

## Fluxo antes e depois

Antes:

```text
Gestor autenticado (Aprovar/Reprovar/Escrow/Coobrigacao/Alteracao)
  -> Server Action com sessao authenticated
  -> UPDATE/INSERT/DELETE direto em cedentes/representantes/contas_escrow
     -> permission denied for table cedentes (ou contas_escrow)
```

Depois:

```text
Gestor autenticado
  -> Server Action (inalterada na autorizacao de entrada: requireGestor + MFA/AAL2)
  -> SELECT do cedente/solicitacao (permitido, usado para notificacao/auditoria)
  -> RPC SECURITY DEFINER estreita
       -> deriva auth.uid() no banco
       -> valida vinculo ativo do gestor com QUALQUER fundo do cedente
          (private.gestor_tem_acesso_cedente, mesma regra multifundo
          ja usada para documentos, sem depender de "fundo ativo" em cookie)
       -> valida transicao permitida e campos aceitos
       -> aplica a mutacao (atomicamente, quando ha mais de uma tabela)
  -> auditoria (registrarLog) e notificacao ao cedente preservadas, inalteradas
```

## Segurança e autorização

- `authenticated` continua sem `INSERT/UPDATE/DELETE` direto em `cedentes`, `representantes` e `contas_escrow`; confirmado ao vivo (`UPDATE` direto retorna `permission denied`).
- Nova função privada `private.gestor_tem_acesso_cedente(cedente_id)`: `EXISTS (cedente_fundos ativo AND private.usuario_tem_acesso_fundo(fundo_id))` — reaproveita exatamente a mesma regra multifundo já usada pela policy de leitura de `documentos`, sem depender do "fundo ativo" selecionado na sessão.
- As seis RPCs são `SECURITY DEFINER`, `SET search_path = ''`, e recusam campos de autoridade vindos do cliente (`status`, `analisado_por`, `cedente_id` de terceiro nunca são aceitos como parâmetro — a RPC só recebe o `id` da entidade e deriva o resto no banco).
- `aprovar_alteracao_cadastral_cedente_gestor` aplica somente os campos da mesma lista já usada em `concluir_onboarding_cedente` (cnpj, razão social, endereço, contato, dados bancários) — chaves fora dessa lista são rejeitadas explicitamente.
- Transições inválidas são recusadas: reaprovar cedente já ativo, reprovar cedente já ativo, reanalisar solicitação já decidida.
- Reprovação de alteração cadastral exige motivo não vazio (validado na RPC).
- A geração do identificador da conta escrow passou a usar `pg_advisory_xact_lock`, prevenindo duplicidade sob concorrência (a versão anterior tinha uma janela de corrida entre contar e inserir).
- `PUBLIC` e `anon` não executam nenhuma das seis funções; apenas `authenticated` recebe `EXECUTE`.

## Grants e RLS

Antes (sem alteração feita agora, apenas confirmado por leitura de migrations):

- `cedentes`, `representantes`, `contas_escrow`: `authenticated` com `SELECT` apenas; DML revogado.
- `taxas_cedente`: `authenticated` com `SELECT/INSERT/UPDATE/DELETE`, protegida por RLS multifundo correta (`taxas_cedente_gestor_all`).
- `cedente_fundos`: grants padrão (não revogados), protegida na camada de aplicação por `requirePermissao`.
- `solicitacoes_alteracao_cedente`: `authenticated` com `SELECT/INSERT/UPDATE`; policy `sac_gestor_all` sem checagem de fundo (RLS_GAP).
- `cedentes` (leitura): policy `cedentes_gestor_all` (`FOR ALL`) sem checagem de fundo (RLS_GAP, achado no E2E).

Depois:

- Nenhum grant de escrita direta foi reaberto em `cedentes`, `representantes` ou `contas_escrow`.
- `authenticated` recebe apenas `EXECUTE` nas seis RPCs novas.
- `solicitacoes_alteracao_cedente`: `UPDATE` revogado de `authenticated` (a leitura do cedente/gestor continua liberada); policy `sac_gestor_all` substituída por `sac_gestor_select` (`FOR SELECT`, exige `private.gestor_tem_acesso_cedente`).
- `cedentes`: policy `cedentes_gestor_all` substituída por `cedentes_gestor_multifundo_select` (`FOR SELECT`, exige `private.gestor_tem_acesso_cedente`). As policies de cedente próprio e consultor não foram tocadas.
- `taxas_cedente` e `cedente_fundos`: nenhuma alteração — já corretas.

## Migrations aplicadas em homologação

1. `20260819140000_p0_mutacoes_cadastro_cedente_gestor.sql`
   - cria `private.gestor_tem_acesso_cedente` e as seis RPCs de mutação;
   - revoga `UPDATE` de `authenticated` em `solicitacoes_alteracao_cedente`;
   - substitui `sac_gestor_all` por `sac_gestor_select` (multifundo).
2. `20260819141000_p0_cedentes_leitura_multifundo_gestor.sql`
   - corretiva, criada após o achado do próprio E2E;
   - substitui `cedentes_gestor_all` por `cedentes_gestor_multifundo_select`.

Nenhuma migration histórica foi editada; não houve `migration repair`.

## E2E autenticado em homologação

O verificador `scripts/homologacao/p0-mutacoes-cadastro-cedente-gestor/verify.mjs` criou fundos, cedentes, gestores e demais papéis sintéticos com sessões reais do Supabase Auth, executou a matriz completa (30 verificações) e removeu toda a massa ao final.

Resultados:

- Aprovar Cadastro: gestor do fundo correto = `ALLOW` (status ativo + conta escrow criada exatamente uma vez); gestor de outro fundo, vínculo revogado, Super Admin puro, Cedente, Consultor, anônimo = `DENY`; reaprovar cedente já ativo = `DENY`; `UPDATE` direto em `cedentes` = `DENY` (`permission denied`).
- Reprovar Cadastro: gestor do fundo correto = `ALLOW`; gestor de outro fundo e anônimo = `DENY`.
- Escrow: gestor do fundo correto = `ALLOW`; gestor de outro fundo e anônimo = `DENY`.
- Coobrigação: gestor do fundo correto = `ALLOW`; gestor de outro fundo = `DENY`.
- Aprovar alteração cadastral: gestor do fundo correto = `ALLOW` (campo proposto aplicado ao cedente); gestor de outro fundo e Super Admin puro = `DENY`; reaprovar solicitação já decidida = `DENY`.
- Reprovar alteração cadastral: sem motivo = `DENY` (validação); gestor de outro fundo = `DENY`; gestor do fundo correto com motivo = `ALLOW` (campos propostos não aplicados).
- Taxas: gestor do fundo correto grava = `ALLOW` (RLS); gestor de outro fundo = `DENY` (RLS).
- Zero cross-fund leak: gestor de outro fundo não lê os cedentes do fundo correto (confirmado só após a segunda migration).

Comandos:

```bash
npm run homolog:p0:mutacoes-cedente-gestor:apply-migration
npm run homolog:p0:mutacoes-cedente-gestor:verify
```

Os scripts possuem trava explícita para o project ref de homologação e bloqueiam o project ref configurado como produção.

### Pendente de validação manual

O percurso visual completo no navegador (Aprovar Cadastro → Reprovar outro cadastro com motivo → Habilitar/Desabilitar Escrow → Habilitar/Desabilitar Coobrigação → Salvar Taxas → Salvar Fundo Vinculado) não foi executado por este agente — requer interação de navegador. O E2E acima cobre banco, RPCs, grants e autorização com sessões reais para as seis ações, incluindo "Salvar Taxas" e "Salvar Fundo Vinculado" (verificadas como já seguras, sem alteração de código). Como não houve commit/push (por restrição deste escopo), o percurso manual pode ser reproduzido com `npm run dev:homolog` a partir deste mesmo diretório de trabalho — as alterações já estão no working tree.

## Riscos residuais

- "Salvar Fundo Vinculado" (`vincularCedenteFundo`/`suspenderCedenteFundo`) depende da checagem em `requirePermissao` na camada de aplicação; a policy RLS de `cedente_fundos` (`cedente_fundos_gestor_all`) em si ainda não é multifundo (permite qualquer gestor via `USING`, sem `WITH CHECK` de fundo). Não é explorável pelos caminhos de código atuais, mas é uma dívida de segurança em camadas que vale endurecer em um próximo escopo, seguindo o mesmo padrão já aplicado aqui.
- O percurso visual completo no navegador não foi executado por este agente (ver seção acima).

## Gates de qualidade executados

- `npx tsc --noEmit`: `PASS`.
- `npm test -- --run`: `PASS` — 154 arquivos e 1.076 testes aprovados; 1 arquivo e 3 testes ignorados pela suíte (pré-existentes).
- `npm run lint`: `PASS` sem erros; seis warnings preexistentes fora deste escopo.
- `git diff --check`: `PASS`.
- `npx next build --webpack`: `PASS`.
- `npm audit --omit=dev`: `PASS` — zero vulnerabilidades.
- secret scan: `PASS` — 1.158 arquivos textuais examinados, zero achados.
