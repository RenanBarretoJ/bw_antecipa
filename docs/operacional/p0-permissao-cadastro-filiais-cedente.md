# P0/P1 — Permissão por Cedente para cadastrar novas Filiais

**Resultado final: `P0_PERMISSAO_CADASTRO_FILIAIS_CEDENTE = PASS`**

Ambiente: homologação Supabase `fhgkmggthxikfpogrvaa`. Produção
(`wwsndnuvnjuabpbjwlck`) não foi tocada. Nenhum commit, push, reset, clean
ou `migration repair` foi executado. Nenhuma dependência foi atualizada.

## Diagnóstico

- **Melhor local canônico do campo**: `public.cedentes`, no mesmo padrão já
  usado para `habilitar_escrow` e `coobrigacao` (booleano simples,
  alternado por RPC dedicada) — classificação `EXISTING_CONFIG_REUSABLE`.
  Não há necessidade de nova tabela nem de estender
  `cedente_estabelecimentos`.
- **Action/RPC atual de configuração do Cedente pelo Gestor**: precedente
  exato encontrado em `supabase/migrations/20260819140000_p0_mutacoes_cadastro_cedente_gestor.sql`
  — `alternar_escrow_cedente_gestor` / `alternar_coobrigacao_cedente_gestor`
  (RPC `SECURITY DEFINER`, checa `private.gestor_tem_acesso_cedente`) +
  wrappers TypeScript `toggleEscrowCedente` / `toggleCoobrigacaoCedente`
  em `src/lib/actions/gestor.ts` (busca estado anterior, chama a RPC,
  audita via `registrarLog`). Reaproveitado ponto a ponto.
- **RPC `cadastrar_filial_cedente`**: já conhecida desta sessão
  (`supabase/migrations/20260818200641...` e evoluída por
  `20260819190000_p0_validacao_raiz_cnpj_filial.sql`) — ponto canônico
  correto para o gate, conforme o próprio ticket sugere.
- **Menu/sidebar "Meus CNPJs"**: `src/components/auth/sidebar.tsx`
  (`cedenteMenuItems`, array estático) consumido por
  `src/app/cedente/layout.tsx`, que já tinha um precedente idêntico ao que
  este ticket pede: filtra "Extrato" do menu com base em
  `cedentes.habilitar_escrow`, buscado uma única vez no mount. O mesmo
  mecanismo foi estendido para "Meus CNPJs".
- **Tela Cedente de Estabelecimentos**: `src/app/cedente/estabelecimentos/`
  (Server Component + `meus-estabelecimentos-client.tsx`), já com uma
  action `obterStatusMatriz` que resolve o status da Matriz para decidir
  se o botão "Cadastrar filial" aparece — estendida para também expor a
  permissão.
- **Verificar existência de Filiais sem N+1**: consulta escopada ao
  próprio Cedente (`cedente_estabelecimentos` filtrado por `cedente_id` +
  `tipo='filial'`, `count: 'exact', head: true`) — 1 linha, sem N+1 por
  natureza (não itera sobre múltiplos Cedentes).
- **Auditoria existente**: `registrarLog` (camada TypeScript, insere via
  `service_role` em `logs_auditoria`) — mesmo padrão de
  `ESCROW_HABILITADO`/`ESCROW_DESABILITADO`/`COOBRIGACAO_ALTERADA`.

**Classificação**: `EXISTING_CONFIG_REUSABLE` (campo + RPC + wrapper +
auditoria seguem padrão já existente) + `UI_VISIBILITY_RULE` (precedente
de filtro de menu já existente, estendido) + `RPC_GATE_REQUIRED` (gate em
`cadastrar_filial_cedente`, não existia). `UNRESOLVED = 0` — implementação
iniciada.

## Campo/modelo adotado

`public.cedentes.permite_cadastro_filiais boolean NOT NULL DEFAULT false`
— todo Cedente (novo ou já existente na base) recebe `false` por padrão,
conforme especificado; a Gestora habilita explicitamente por Cedente.

## Fluxo Gestor

Na tela de detalhe do Cedente (`/gestor/cedentes/[id]`), dentro do card já
existente "Configurações de Acesso" (mesmo local de Escrow/Coobrigação),
novo controle "Cadastro de Filiais" com texto auxiliar "Permite que este
cedente cadastre novos CNPJs de filiais." e botão Habilitar/Desabilitar.

RPC `public.alternar_cadastro_filiais_cedente_gestor(p_cedente_id, p_habilitar)`
(`SECURITY DEFINER`, mesmo padrão de `alternar_coobrigacao_cedente_gestor`):
checa `private.gestor_tem_acesso_cedente(p_cedente_id)` (vínculo ativo do
Gestor com o Fundo do Cedente) — nega para Gestor de outro Fundo, Super
Admin puro (sem papel de gestor/vínculo de fundo) e para o próprio Cedente.
Wrapper `toggleCadastroFiliaisCedente` (`src/lib/actions/gestor.ts`) chama
a RPC e audita `CADASTRO_FILIAIS_HABILITADO` / `CADASTRO_FILIAIS_DESABILITADO`
via `registrarLog`, com `dados_antes`/`dados_depois`.

## Fluxo Cedente

- `permite_cadastro_filiais = false` **e** zero Filiais → item "Meus CNPJs"
  não aparece no menu lateral (`src/app/cedente/layout.tsx`).
- `permite_cadastro_filiais = true` → menu normal, botão "Cadastrar filial"
  visível (sujeito também à Matriz estar aprovada/ativa, validação já
  existente).
- `permite_cadastro_filiais = false` **e** já existem Filiais → menu
  "Meus CNPJs" permanece visível (consulta, documentos, conta, pendências
  continuam funcionando normalmente — nenhuma dessas rotas foi alterada);
  botão "Cadastrar filial" fica oculto; aviso exibido: "O cadastro de
  novas Filiais está desabilitado pela Gestora."

## Regra de visibilidade (implementação)

`src/app/cedente/layout.tsx`: no mesmo efeito que já buscava
`habilitar_escrow` para decidir sobre "Extrato", passou a também buscar
`permite_cadastro_filiais` e, quando `false`, faz uma segunda consulta
leve (`count`, `head: true`) em `cedente_estabelecimentos` filtrando
`tipo = 'filial'`; só remove "Meus CNPJs" do menu se `count === 0`.

`src/app/cedente/estabelecimentos/meus-estabelecimentos-client.tsx`:
`podeCadastrar = matrizAprovada && permiteCadastroFiliais`. O botão
"Cadastrar filial" só é renderizado quando `podeCadastrar` (oculto, não
apenas desabilitado). Dois avisos distintos e mutuamente exclusivos:
Matriz não aprovada (mensagem já existente) vs. permissão desabilitada
pela Gestora (mensagem nova) — nunca os dois ao mesmo tempo.

## Regra backend

`public.cadastrar_filial_cedente`: logo após resolver o Cedente autenticado
(`auth.uid()` → `get_user_cedente_id()`) e confirmar acesso, busca
`cedentes.permite_cadastro_filiais` e aborta **antes de qualquer outra
validação e antes do `INSERT`** se `false`:

```sql
SELECT c.permite_cadastro_filiais INTO v_permite_cadastro_filiais
FROM public.cedentes c WHERE c.id = v_cedente_id;
IF NOT coalesce(v_permite_cadastro_filiais, false) THEN
  RAISE EXCEPTION 'O cadastro de novas Filiais nao esta habilitado para este Cedente.';
END IF;
```

Independente da UI — uma chamada direta à RPC com a permissão desabilitada
é bloqueada da mesma forma. Todas as validações existentes (CNPJ válido,
Matriz aprovada, unicidade global, raiz do CNPJ) permanecem inalteradas e
continuam sendo executadas normalmente quando a permissão está habilitada.

## O que esta permissão explicitamente NÃO altera

Confirmado por leitura de código e por teste ao vivo: desabilitar a
permissão depois de já existirem Filiais aprovadas não toca `status` da
Matriz, `status`/`ativo` das Filiais existentes, `estabelecimento_pode_originar`
(depende só de `status = 'aprovado'` + `ativo`, que não mudam), documentos,
conta bancária ou histórico/auditoria já registrados.

## Migrations/RPCs

`supabase/migrations/20260819200000_p0_permissao_cadastro_filiais_cedente.sql`:
- `ALTER TABLE cedentes ADD COLUMN permite_cadastro_filiais`.
- `alternar_cadastro_filiais_cedente_gestor` (nova).
- `cadastrar_filial_cedente` (recriada com o mesmo assinatura/retorno,
  apenas com o gate adicionado antes das validações existentes).

Aplicada em homologação via
`scripts/homologacao/p0-permissao-cadastro-filiais-cedente/apply-migration.mjs`.

## Segurança

- Cedente continua só acessando os próprios Estabelecimentos (RLS
  inalterada).
- Gestor só altera a flag de Cedente vinculado a Fundo em que tem vínculo
  ativo — `private.gestor_tem_acesso_cedente`, mesmo helper multifundo já
  usado em toda a superfície de Estabelecimentos/Documentos desta sessão.
- Outro Fundo, Super Admin puro, o próprio Cedente e anon: `DENY`
  confirmados ao vivo.
- Nenhum `GRANT` de escrita direta foi reaberto em `cedentes`; a única via
  de escrita é a RPC `SECURITY DEFINER`.

## Testes obrigatórios (executados ao vivo em homologação, transação revertida)

`scripts/homologacao/p0-permissao-cadastro-filiais-cedente/e2e.mjs` — 13/13 PASS:

| Cenário | Resultado |
|---|---|
| Cedente novo → flag default `false` | confirmado |
| flag `false` + zero Filiais → RPC de nova Filial | `DENY` |
| Gestor de outro Fundo tenta habilitar | `DENY` |
| Super Admin puro tenta habilitar | `DENY` |
| Anon tenta habilitar | `DENY` |
| Cedente tenta habilitar a própria flag | `DENY` |
| Gestor autorizado habilita | `ALLOW` |
| Cedente cadastra Filial após habilitação | `ALLOW` |
| Filial é aprovada normalmente (checklist + conta, gate já existente) | `PASS` |
| Gestor desabilita depois | `ALLOW`, Filial existente permanece `aprovado`/`ativo` |
| Filial aprovada continua apta a originar após desabilitar | confirmado (`estabelecimento_pode_originar = true`) |
| Nova tentativa de cadastro após desabilitar | `DENY` novamente |

Auditoria (`CADASTRO_FILIAIS_HABILITADO`/`CADASTRO_FILIAIS_DESABILITADO`)
não é gravada dentro da RPC SQL (mesmo padrão de Escrow/Coobrigação — o
`registrarLog` roda na camada TypeScript, fora do alcance de um script SQL
puro); verificada por teste de arquitetura
(`src/lib/actions/permissao-cadastro-filiais-architecture.test.ts`), que
confirma que `toggleCadastroFiliaisCedente` chama a RPC e em seguida
`registrarLog` com os dois tipos de evento corretos.

### Regressões pré-existentes re-executadas

Como `cadastrar_filial_cedente` foi recriada, todo script de homologação
que a chama precisou passar a habilitar `permite_cadastro_filiais=true`
na fixture do Cedente de teste antes de cadastrar Filial (mudança apenas
nos scripts de teste, nenhuma mudança de comportamento do produto —
esses scripts testam outras coisas, não este gate):

- `scripts/homologacao/multi-cnpj/e2e.mjs`: 18/18 PASS.
- `scripts/homologacao/p0-checklist-documental-estabelecimentos/verify.mjs`: 13/13 PASS.
- `scripts/homologacao/p0-validacao-raiz-cnpj-filial/e2e.mjs`: 11/11 PASS.
- `scripts/homologacao/evolucao-estabelecimentos/e2e.mjs`: 23/23 PASS.
- `scripts/homologacao/evolucao-estabelecimentos/perf-50-filiais.mjs`: 10/10 PASS.

## E2E

Não executado via browser automatizado (sem harness de teste de browser no
projeto). Os 8 passos do roteiro foram cobertos pela combinação do E2E de
RPC acima (passos 2, 3, 4, 7, 8) com os testes de arquitetura que confirmam
a lógica de UI (passos 1, 5, 6): menu oculto quando aplicável, aviso claro,
botão oculto (não apenas desabilitado) quando a permissão está
desabilitada.

## Qualidade

- `npx tsc --noEmit`: sem erros.
- `npx vitest run` (`npm test -- --run`): 159 arquivos / 1130 testes
  passando, 1 skip e 3 testes skip pré-existentes. 8 testes novos
  (`permissao-cadastro-filiais-architecture.test.ts`). Nenhum teste
  removido.
- `npm run lint`: 0 erros (6 warnings pré-existentes, não relacionados).
- `git diff --check`: sem marcadores de conflito (apenas avisos benignos
  de CRLF, ambiente Windows).
- `npx next build --webpack`: build de produção concluído com sucesso.
- `npm audit --omit=dev`: 0 vulnerabilidades.
- Varredura manual de segredos nos arquivos novos/alterados: nenhum
  encontrado.

## Riscos

1. Todo Cedente pré-existente na base recebe `permite_cadastro_filiais = false`
   ao aplicar a migration, inclusive os que já têm Filiais e presumivelmente
   poderiam querer cadastrar mais. Não foi feito nenhum backfill para
   `true` — o ticket especifica apenas "todo Cedente novo começa com
   false" e pede a menor mudança possível; se a intenção for que Cedentes
   com Filiais já aprovadas mantenham a capacidade de cadastrar novas sem
   ação explícita da Gestora, isso precisa ser uma decisão de produto
   separada (backfill dirigido, não implementado aqui).
2. O aviso "O cadastro de novas Filiais está desabilitado pela Gestora."
   e o toggle no Gestor não têm um terceiro estado (ex.: "nunca habilitado"
   vs. "habilitado e depois desabilitado") — ambos os casos usam a mesma
   mensagem, como especificado.
