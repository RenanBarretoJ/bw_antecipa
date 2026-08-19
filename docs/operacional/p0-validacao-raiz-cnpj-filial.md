# P0 — Validar raiz do CNPJ antes de cadastrar nova Filial

**Resultado final: `P0_VALIDACAO_RAIZ_CNPJ_FILIAL = PASS`**

Ambiente: homologação Supabase `fhgkmggthxikfpogrvaa`. Produção
(`wwsndnuvnjuabpbjwlck`) não foi tocada. Nenhum commit, push, reset, clean
ou `migration repair` foi executado. Nenhuma dependência foi atualizada.

## Diagnóstico

- **Action/RPC do botão "Cadastrar filial"**: `cadastrarFilial` (`src/lib/actions/estabelecimento.ts`) → RPC `public.cadastrar_filial_cedente(p_cnpj, p_razao_social, p_nome_fantasia)`.
- **Helper de normalização de CNPJ existente**: `private.cnpj_valido` (`supabase/migrations/20260812143000_sa1_admin_fundos.sql`) — normaliza via `regexp_replace(..., '[^0-9]', '', 'g')` (remove **tudo** que não é dígito, inclusive letras) e exige exatamente 14 dígitos numéricos com checksum. Não existe hoje suporte a CNPJ alfanumérico em nenhuma camada (nem `cnpj_valido`, nem a `CHECK` estrutural da tabela).
- **Trigger/constraint em `cedente_estabelecimentos`**: `cedente_estabelecimentos_cnpj_formato_check CHECK (cnpj ~ '^[0-9]{14}$')` + trigger `BEFORE INSERT OR UPDATE OF cedente_id, cnpj, tipo, matriz_estabelecimento_id` executando `private.validar_cedente_estabelecimento()`, que já resolve e valida a Matriz do mesmo Cedente para `tipo = 'filial'` — mas **não** comparava a raiz do CNPJ.
- **Como a Matriz do Cedente é resolvida server-side**: em `cadastrar_filial_cedente`, via `SELECT ... FROM cedente_estabelecimentos e JOIN cedentes c ... WHERE e.cedente_id = v_cedente_id AND e.tipo = 'matriz' AND e.status = 'aprovado' AND e.ativo`; no trigger, via `SELECT * FROM cedente_estabelecimentos WHERE id = NEW.matriz_estabelecimento_id`.
- **Helper de raiz de CNPJ reutilizável**: não existia (`grep` em todas as migrations e em `src/` não encontrou nenhuma menção a "raiz").

**Classificação**: `MISSING_BRANCH_ROOT_VALIDATION` (RPC e trigger não validavam raiz) + `DB_GUARD_MISSING` (nenhuma proteção estrutural existia). `UNRESOLVED = 0` — implementação iniciada.

## Regra aplicada

`raiz_cnpj(filial) == raiz_cnpj(matriz)`, com `raiz_cnpj` = 8 primeiras
posições do CNPJ normalizado. Uma Filial cujo CNPJ tenha raiz diferente da
Matriz do mesmo Cedente é bloqueada **antes** de qualquer `INSERT`.

## Normalização

Novo helper `private.raiz_cnpj(p_cnpj text) RETURNS text`:

```sql
SELECT substring(upper(regexp_replace(coalesce(p_cnpj, ''), '[^0-9A-Za-z]', '', 'g')) FROM 1 FOR 8);
```

- Remove apenas pontuação/formatação (`.`, `/`, `-`, espaços) — **preserva
  letras**, ao contrário do `regexp_replace(..., '\D', ...)` já usado em
  `cadastrar_filial_cedente`/no trigger para o CNPJ completo.
- Converte para maiúsculas antes de comparar (case-insensitive quando
  houver letras).
- Não assume que as 8 primeiras posições são dígitos — funciona
  corretamente com qualquer combinação alfanumérica.

**Nota importante**: `private.cnpj_valido` e a `CHECK` estrutural da tabela
(`^[0-9]{14}$`) continuam exigindo 14 dígitos numéricos — nenhuma delas foi
alterada, por ser uma mudança de escopo muito maior (afeta Matriz, Cedente,
Representante, e o algoritmo de checksum) e não solicitada por este
ticket ("faça a menor correção possível"). Isso significa que, **hoje**, um
CNPJ alfanumérico nunca chega a ser normalizado por `private.raiz_cnpj`
dentro de `cadastrar_filial_cedente`/do trigger, porque é rejeitado antes
por `cnpj_valido`. O helper de raiz foi construído para já estar correto e
pronto (normalização format-agnostic, comparação case-insensitive) para o
dia em que o suporte a CNPJ alfanumérico for adicionado nas camadas de
validação de CNPJ — mas esse suporte em si **não faz parte desta entrega**.
Os testes que envolvem CNPJ alfanumérico neste ticket validam a lógica do
helper isoladamente (unitário), não o fluxo ponta-a-ponta de cadastro.

## Camada RPC (A)

`public.cadastrar_filial_cedente` — nova checagem inserida **depois** da
verificação de unicidade global e **antes** do `INSERT`:

```sql
IF private.raiz_cnpj(v_cnpj) <> private.raiz_cnpj(v_matriz.cnpj) THEN
  RAISE EXCEPTION 'O CNPJ informado nao pertence a mesma raiz da Matriz deste Cedente.';
END IF;
```

A checagem de raiz foi posicionada **depois** da checagem de unicidade
global (não antes) para preservar a mensagem de erro já estabelecida e
testada ("CNPJ já cadastrado para outro Cedente") quando o CNPJ já existe
em qualquer registro — a raiz só é avaliada para CNPJs genuinamente novos.
Essa decisão foi validada empiricamente: a ordem inversa quebrava um
cenário já coberto pela regressão `multi-cnpj/e2e.mjs` (CNPJ de uma Filial
de outro Cedente, com raiz diferente da Matriz do Cedente que tenta usá-lo
— o teste espera a mensagem de conflito de unicidade, não a de raiz).

## Camada de banco (B)

`private.validar_cedente_estabelecimento()` (trigger `BEFORE INSERT OR
UPDATE OF cedente_id, cnpj, tipo, matriz_estabelecimento_id ON
cedente_estabelecimentos`, já existente) — mesma checagem adicionada logo
após resolver e validar a Matriz para `tipo = 'filial'`:

```sql
IF private.raiz_cnpj(NEW.cnpj) <> private.raiz_cnpj(v_matriz.cnpj) THEN
  RAISE EXCEPTION 'O CNPJ informado nao pertence a mesma raiz da Matriz deste Cedente.';
END IF;
```

Reaproveita o trigger e o helper existentes — nenhuma nova constraint ou
trigger foi criada, nenhum `CASCADE` foi usado. Protege qualquer caminho de
escrita futuro (inclusive um `INSERT` direto por `service_role`, fora da
RPC), validado ao vivo (ver E2E).

## Migration

`supabase/migrations/20260819190000_p0_validacao_raiz_cnpj_filial.sql`:
cria `private.raiz_cnpj` (revogado de `PUBLIC` — uso interno via
RPC/trigger `SECURITY DEFINER` apenas), recria
`private.validar_cedente_estabelecimento` e `public.cadastrar_filial_cedente`
(mesma assinatura/retorno, sem `DROP FUNCTION`). Aplicada em homologação
via `scripts/homologacao/p0-validacao-raiz-cnpj-filial/apply-migration.mjs`.

## Segurança

- Nenhuma mudança nas checagens de acesso existentes:
  `private.usuario_tem_acesso_cedente(v_cedente_id)` continua sendo a
  única forma de um Cedente cadastrar Filial (própria).
- `cedente_id`, `matriz_estabelecimento_id` e `status` continuam
  resolvidos e validados inteiramente server-side — o CNPJ é o único
  argumento controlado pelo cliente, e agora passa por uma checagem
  adicional antes de persistir.
- Unicidade global de CNPJ preservada e testada.
- DML direto continua revogado de `authenticated` (inalterado por este
  ticket); a proteção de raiz no trigger cobre inclusive escritas por
  `service_role`/superusuário, validado ao vivo.
- Zero cross-user/cross-fund: nenhuma superfície nova foi exposta.
- Super Admin puro: sem qualquer operação implícita nova.

## Testes obrigatórios (executados ao vivo em homologação, transação revertida)

`scripts/homologacao/p0-validacao-raiz-cnpj-filial/e2e.mjs` — 11/11 PASS:

| Cenário | Resultado |
|---|---|
| Mesma raiz + CNPJ válido | ALLOW |
| Raiz diferente | DENY (`... nao pertence a mesma raiz da Matriz ...`) |
| Mesmo CNPJ da Matriz | DENY (`CNPJ ja cadastrado para outro Cedente`) |
| CNPJ já existente (mesma Filial) | idempotente — retorna o registro existente, não duplica |
| CNPJ inválido | DENY (`CNPJ da filial e invalido`) |
| `raiz_cnpj` remove pontuação, mantém 8 posições | confirmado (`07.312.248/0001-37` → `07312248`) |
| CNPJ alfanumérico, mesma raiz (unitário no helper) | raízes comparam iguais, case-insensitive |
| CNPJ alfanumérico, raiz diferente (unitário no helper) | raízes comparam diferentes |
| Tentativa via `INSERT` direto (bypass da RPC) | protegida pelo trigger |
| Nenhum registro parcial criado em falha | confirmado (contagem de Filiais = 1, só a válida) |

Regressões pré-existentes re-executadas após a mudança (reordenação
resultante do achado da seção anterior):
- `scripts/homologacao/multi-cnpj/e2e.mjs`: 18/18 PASS.
- `scripts/homologacao/p0-checklist-documental-estabelecimentos/verify.mjs`: 13/13 PASS.
- `scripts/homologacao/evolucao-estabelecimentos/e2e.mjs`: 23/23 PASS.
- `scripts/homologacao/evolucao-estabelecimentos/perf-50-filiais.mjs`: corrigido (as 55 Filiais sintéticas usavam uma raiz diferente da Matriz de teste — bug pré-existente do script, inofensivo até esta validação existir; ajustado para usar a mesma raiz) — 10/10 PASS.

## E2E (browser)

Não executado via browser automatizado neste ticket (sem harness de teste
de browser no projeto). O comportamento foi validado ao nível de RPC/banco
com o mesmo código que a action `cadastrarFilial` chama
(`cadastrar_filial_cedente`), cobrindo exatamente os passos do roteiro:
CNPJ com raiz diferente → bloqueado com mensagem clara → nenhuma Filial
criada; CNPJ válido com mesma raiz → Filial criada com status `pendente` →
fluxo normal segue (idêntico ao comportamento pré-existente, apenas com o
novo bloqueio adicionado antes).

## Qualidade

- `npx tsc --noEmit`: sem erros (nenhum arquivo TypeScript alterado neste ticket).
- `npx vitest run` (`npm test -- --run`): 158 arquivos / 1122 testes passando, 1 skip e 3 testes skip pré-existentes. 6 testes novos (`validacao-raiz-cnpj-filial-architecture.test.ts`). Nenhum teste removido.
- `npm run lint`: 0 erros (6 warnings pré-existentes, não relacionados).
- `git diff --check`: sem marcadores de conflito (apenas avisos benignos de CRLF, ambiente Windows).
- `npx next build --webpack`: build de produção concluído com sucesso.
- `npm audit --omit=dev`: 0 vulnerabilidades.
- Varredura manual de segredos nos arquivos novos: nenhum encontrado.

## Riscos

1. CNPJ alfanumérico não é aceito ponta-a-ponta hoje (bloqueado por
   `cnpj_valido`/`CHECK` antes de chegar à validação de raiz) — ver nota na
   seção de normalização. Se a Receita Federal já estiver emitindo CNPJs
   alfanuméricos e isso precisar ser aceito pelo sistema, é um ticket
   separado (maior escopo, mais superfícies afetadas).
2. A ordem escolhida (unicidade antes de raiz) prioriza preservar a
   mensagem de erro já estabelecida para conflitos de CNPJ; a mensagem de
   "raiz diferente" só aparece quando o CNPJ é genuinamente novo. Isso é
   intencional e coberto por teste, mas vale registrar para quem for ler o
   código depois.
