# P0 — Aprovação/Reprovação de documentos pelo Gestor

## Resultado

`P0_ANALISE_DOCUMENTOS_GESTOR = PASS`

- Ambiente validado: homologação.
- Projeto Supabase: `fhgkmggthxikfpogrvaa`.
- Produção: não acessada nem alterada.
- Branch: `homolog`.
- Sem commit e sem push, conforme instrução do escopo.

## Causa raiz e classificação

`analisarDocumento()` (Aprovar/Reprovar) e `solicitarAtualizacaoDocumento()` em
`src/lib/actions/gestor.ts` faziam `UPDATE` direto em `public.documentos` com a
sessão `authenticated` do gestor. O hardening de ACL (P2.6.4 e o hotfix
`20260817185117_hotfix_dashboard_gestor_acl.sql`) já havia revogado
`INSERT/UPDATE/DELETE` de `authenticated` nessa tabela, preservando apenas
`SELECT` via a policy multifundo `documentos_gestor_multifundo_select`. As duas
actions nunca foram migradas para uma RPC, resultando em
`permission denied for table documentos` ao clicar em Aprovar/Reprovar.

Além disso, `solicitarAtualizacaoDocumento()` não validava vínculo
gestor↔fundo↔cedente algum — qualquer gestor autenticado podia solicitar
atualização em documento de qualquer cedente, de qualquer fundo. Esse gap não
gerava o erro relatado (a escrita ainda falhava por ACL), mas era uma lacuna de
autorização real, coberta pela mesma correção.

Classificação:

| Código | Resultado | Evidência |
| --- | --- | --- |
| `ACL_MISSING` | Confirmado como causa imediata | `authenticated` sem `INSERT/UPDATE/DELETE` em `public.documentos` desde o P2.6.4/hotfix; `SELECT` preservado. |
| `RLS_POLICY_MISSING` | Não confirmado | A policy de leitura multifundo já existia e está correta; o problema era o ACL de escrita, anterior à RLS. |
| `DOCUMENT_REVIEW_ARCHITECTURE_BUG` | Confirmado | As três actions dependiam de escrita direta incompatível com o hardening; `solicitarAtualizacaoDocumento` não validava fundo. |
| `SERVER_ACTION_CONTEXT_BUG` | Não confirmado | O contexto do gestor (`requireGestor`, MFA/AAL2) já estava correto; o problema era exclusivamente a camada de escrita. |
| `UNRESOLVED` | Zero | Diagnóstico fechado antes da implementação (grants, policies, RPC canônica de referência e schema confirmados por leitura de código e migrations). |

## Fluxo antes e depois

Antes:

```text
Gestor autenticado (Aprovar/Reprovar/Solicitar Atualização)
  -> Server Action com sessao authenticated
  -> UPDATE direto em public.documentos
     -> permission denied for table documentos
     -> nenhuma auditoria, nenhuma notificacao
```

Depois:

```text
Gestor autenticado
  -> Server Action (inalterada na autorizacao de entrada: requireGestor + MFA/AAL2)
  -> SELECT do documento (permitido, ja usado para notificacao/auditoria)
  -> RPC estreita analisar_documento_gestor() ou solicitar_atualizacao_documento_gestor()
       -> deriva auth.uid() no banco
       -> valida vinculo ativo do gestor com QUALQUER fundo do cedente
          (mesma regra multifundo da policy de leitura, sem depender de
          "fundo ativo" em cookie)
       -> valida transicao permitida (enviado/em_analise -> aprovado/reprovado)
       -> valida motivo obrigatorio na reprovacao
       -> aplica a mutacao, registra ator/data
  -> auditoria (registrarLog) e notificacao ao cedente preservadas, inalteradas
  -> revalidatePath preservado
```

## Segurança e autorização

- `authenticated` continua sem `INSERT/UPDATE/DELETE` direto em `public.documentos`; confirmado ao vivo (`UPDATE` direto retorna `permission denied`).
- As duas RPCs são `SECURITY DEFINER`, com `SET search_path = ''` e nomes totalmente qualificados.
- `PUBLIC` e `anon` não executam as funções; apenas `authenticated` recebe `EXECUTE`.
- A autorização usa `private.usuario_tem_acesso_fundo(fundo_id)` — a mesma função já usada pela policy `documentos_gestor_multifundo_select` — aplicada a **qualquer** fundo vinculado ativo ao cedente do documento, não apenas ao "fundo ativo" da sessão. Isso alinha escrita e leitura: um gestor multifundo que já consegue *ler* um documento (RLS) agora também consegue agir sobre ele, sem abrir para fundos sem vínculo algum.
- Nenhum campo de autoridade (`status`, `analisado_por`, `cedente_id`, `fundo_id`) é aceito do cliente; a RPC deriva tudo a partir de `auth.uid()` e do próprio documento.
- Reprovação exige motivo não vazio (validado na RPC, além do já existente na Server Action).
- Transições inválidas (documento fora de `enviado`/`em_analise`) são recusadas — cobre reanálise de documento já decidido.
- Multi-CNPJ: `public.documentos` não tem `estabelecimento_id` (cadastral por `cedente_id`, com `representante_id` opcional); Matriz e Filiais do mesmo grupo compartilham o mesmo `cedente_id`, então a autorização por `cedente_fundos`/fundo já cobre ambos os casos uniformemente. Não há hoje análise documental cadastral por estabelecimento individual nesta tabela — não há ampliação de autorização por status de estabelecimento a corrigir aqui.

## Grants e policies

Antes (sem alteração feita agora, apenas confirmado):

- `authenticated`: `SELECT` em `public.documentos`; `INSERT/UPDATE/DELETE` revogados desde P2.6.4/hotfix.
- Policy de leitura `documentos_gestor_multifundo_select`: presente e correta.

Depois:

- Nenhum grant de tabela foi reaberto. `authenticated` continua apenas com `SELECT`.
- `authenticated` recebe `EXECUTE` em `public.analisar_documento_gestor(uuid, text, text)` e `public.solicitar_atualizacao_documento_gestor(uuid)`.
- `PUBLIC` e `anon` sem `EXECUTE` nas duas funções.

## Migration aplicada em homologação

`supabase/migrations/20260819120000_p0_analise_documentos_gestor_permission_denied.sql`

- cria `analisar_documento_gestor(p_documento_id, p_decisao, p_motivo)`;
- cria `solicitar_atualizacao_documento_gestor(p_documento_id)`;
- não altera nenhuma migration histórica; não houve `migration repair`.

## E2E autenticado em homologação

O verificador `scripts/homologacao/p0-analise-documentos-gestor/verify.mjs`
criou fundos, cedente, gestores e demais papéis sintéticos com sessões reais
do Supabase Auth, executou a matriz completa e removeu toda a massa ao final.

Resultados (18/18):

- gestor do fundo correto aprova: `ALLOW`;
- gestor do fundo correto reprova com motivo: `ALLOW`;
- gestor do fundo correto solicita atualização (inclusive em doc já decidido): `ALLOW`;
- reprovação sem motivo: `DENY` (validação);
- reanálise de documento já decidido: `DENY` (transição inválida);
- gestor de outro fundo (sem vínculo): `DENY`, para as três ações;
- gestor com vínculo revogado ao fundo: `DENY`;
- Super Admin puro: `DENY` operacional, para as três ações;
- Cedente: `DENY` na análise;
- Consultor: `DENY`;
- anônimo: `DENY`, para as três ações;
- `UPDATE` direto em `documentos` pelo gestor autorizado: `DENY` (`permission denied`, confirma que o ACL de escrita direta continua revogado);
- motivo de reprovação persistido corretamente; `analisado_por` registra o ator correto;
- zero cross-fund leak: gestor de outro fundo não lê os documentos deste cedente.

Comandos:

```bash
npm run homolog:p0:documentos-gestor:apply-migration
npm run homolog:p0:documentos-gestor:verify
```

Os scripts possuem trava explícita para o project ref de homologação e
bloqueiam o project ref configurado como produção.

### Pendente de validação manual

O E2E acima cobre banco, RPC, grants e autorização com sessões reais. O
percurso visual no navegador (Gestor → Cedentes → abrir Cedente → abrir
documento → Aprovar/Reprovar/Solicitar Atualização) descrito no escopo não foi
executado por este agente, pois exige interação de navegador. Como não houve
commit/push (por restrição deste escopo), a forma de reproduzir localmente é
rodar `npm run dev:homolog` a partir deste mesmo diretório de trabalho — as
alterações já estão no working tree — e repetir o fluxo manualmente com um
gestor real.

## Arquivos alterados

- `src/lib/actions/gestor.ts`
- `src/types/database.ts`
- `src/lib/actions/documentos-gestor-architecture.test.ts` (novo)
- `scripts/homologacao/p0-analise-documentos-gestor/apply-migration.mjs` (novo)
- `scripts/homologacao/p0-analise-documentos-gestor/verify.mjs` (novo)
- `supabase/migrations/20260819120000_p0_analise_documentos_gestor_permission_denied.sql` (novo)
- `package.json` (dois scripts novos de homologação)

## Riscos residuais

- A autorização de escrita passou a valer para qualquer fundo vinculado ativo
  do gestor (igual à leitura), e não mais apenas o "fundo ativo" da sessão.
  Isso é mais permissivo que o comportamento anterior (que já estava
  inconsistente com a leitura) para o caso específico de gestor multifundo;
  foi uma decisão consciente, confirmada com o solicitante antes da
  implementação, para alinhar leitura e escrita.
- `gerarUrlDocumentoGestor` (abrir/visualizar o arquivo) continua restrito ao
  "fundo ativo" da sessão — não foi alterado, pois está fora do escopo deste
  P0 (não participa do erro relatado) e alterá-lo seria ampliar o diff além do
  necessário.
- O percurso visual completo no navegador não foi executado por este agente
  (ver seção acima).

## Gates de qualidade executados

- `npx tsc --noEmit`: `PASS`.
- `npm test -- --run`: `PASS` — 153 arquivos e 1.068 testes aprovados; 1 arquivo e 3 testes ignorados pela suíte (pré-existentes).
- `npm run lint`: `PASS` sem erros; seis warnings preexistentes fora deste escopo.
- `git diff --check`: `PASS`.
- `npx next build --webpack`: `PASS`.
- `npm audit --omit=dev`: `PASS` — zero vulnerabilidades.
- secret scan (`scripts/homologacao/financeiro/readiness/secret-scan.mjs`): `PASS` — 1.150 arquivos textuais examinados, zero achados.
