# P0 — Filiais + requisitos + consistência documental Cedente/Gestor

## Resultado

`P0_FILIAIS_E_CONSISTENCIA_DOCUMENTAL = PASS`

- Ambiente validado: homologação.
- Projeto Supabase: `fhgkmggthxikfpogrvaa`.
- Produção: não acessada nem alterada.
- Branch: `homolog`.

## Causa raiz de cada problema

### A) "Enviar para análise" da Filial não faz nada

Classificação: `BUTTON_NOT_WIRED`.

O componente `<Button>` deste design system (`@base-ui/react/button`) define, no seu hook interno `useButton`, `type: isNativeButton ? 'button' : undefined` como valor **default** sempre que `nativeButton` é `true` (o padrão). Ou seja: todo `<Button>` sem `type="submit"` explícito renderiza `<button type="button">`, que **nunca dispara o evento `submit` do formulário**. O formulário de cadastro de Filial (`meus-estabelecimentos-client.tsx`) tinha `onSubmit={(event) => {...}}` corretamente implementado, mas o botão "Enviar para analise" não tinha `type="submit"` — clicar nele literalmente não fazia nada, sem erro nenhum, porque o evento de submit nunca era disparado. Confirmado lendo o código-fonte do pacote (`node_modules/@base-ui/react/use-button/useButton.js:82` e `merge-props/mergeProps.js`, que confirma que um `type` explícito do chamador sobrescreve o default).

O mesmo formulário tinha o botão "Cancelar" com `type="button"` explícito (correto, não deveria submeter) — evidência de que o problema é puramente a ausência do `type="submit"` no botão que deveria submeter, não um problema conceitual do fluxo.

### B) "Configurar requisito" não persiste visualmente

Classificação: `BUTTON_NOT_WIRED` (mesma causa raiz de A) + já havia uma causa adicional de backend, corrigida no P0 anterior desta sessão.

Mesma causa exata do item A: o botão "Configurar requisito" em `EstabelecimentosGestor.tsx` também não tinha `type="submit"`. Além disso, a RPC `configurar_requisito_estabelecimento_gestor` — que já existe desde a migration do Multi-CNPJ — chama `private.gestor_tem_acesso_cedente(cedente_id)`, uma função que só passou a existir no P0 anterior desta sessão (correção de mutações do cadastro do Cedente). Ou seja, **mesmo com o botão corrigido, a RPC estava genuinamente quebrada até essa correção anterior**; confirmamos ao vivo, neste escopo, que ela já funciona corretamente agora.

Os botões "Rejeitar" e "Suspender" no mesmo componente tinham o mesmo problema e foram corrigidos junto, por serem a mesma causa raiz no mesmo arquivo.

### C) Checklist documental Cedente x Gestor inconsistente

Esta parte tinha **três causas distintas**, nenhuma delas sendo "empresa satisfaz representante por comparação de string" (todo filtro em memória já usa `representante_id` corretamente em `aprovarCedente`, na tela do Cedente e na tela de detalhe do Gestor):

1. **`WRONG_DOCUMENT_CATALOG_SCOPE` (confirmado):** o enum `documento_tipo` usava o mesmo código `comprovante_endereco` para o comprovante de endereço da Empresa e o comprovante de residência do Representante Legal, diferenciados apenas por `representante_id`. Isso não causava colisão de dados hoje (todo código já filtra por `representante_id`), mas violava a exigência do ticket de identidade canônica própria por escopo e era uma fragilidade real: bastava um novo trecho de código comparar só por `tipo` para reabrir a colisão (encontramos exatamente esse padrão, inofensivo hoje, em `getLatestLegado` na tela do Gestor).
2. **Rótulos incorretos/faltantes na fila global do Gestor (`/gestor/documentos`):** `gestor-listagem.server.ts` rotulava `extrato_bancario` como "Comprovante de Renda" (deveria ser "Comprovante de Faturamento", como em todo o resto do sistema) e **não tinha rótulo algum para `comprovante_de_renda`** (aparecia com o código bruto). Isso explica diretamente "Cedente possui Comprovante de Renda, mas ele não aparece para o Gestor" — o Gestor buscando "renda" nessa tela encontrava `extrato_bancario` (rótulo errado), não o documento real.
3. **`RLS_GAP`/`REQUIREMENT_WRITE_AFTER_ACL_HARDENING` (achado adicional, mais grave, durante a verificação ao vivo):** o hardening de ACL (P2.6.4) revogou `SELECT` de `authenticated` em `public.representantes` e **nunca foi restaurado** — ao contrário de `cedentes`/`documentos`/`contas_escrow`, que já tinham sido corrigidos em P0s anteriores. Isso bloqueava a leitura de representantes para **qualquer papel autenticado**, incluindo o próprio Cedente. Como a tela do Cedente e a tela de detalhe do Gestor fazem `supabase.from('representantes').select(...)` sem checar o erro, o resultado era silenciosamente tratado como lista vazia (`representantes.length === 0`), levando ambas as telas ao fallback legado. Na tela do Gestor esse fallback só considera `rg_cpf`/`procuracao` — nunca `comprovante_de_renda` nem o comprovante de residência —, e no cálculo de progresso do Cedente fazia o denominador cair para exatamente os 6 documentos da Empresa (explicando o "6 de 6" citado no ticket, que não é um valor hardcoded: é a consequência aritmética de `representantes.length` estar incorretamente zerado).

Classificação final:

| Código | Resultado |
| --- | --- |
| `BUTTON_NOT_WIRED` | Confirmado (A e B) |
| `WRONG_DOCUMENT_CATALOG_SCOPE` | Confirmado (comprovante_endereco compartilhado entre Empresa e Representante) |
| `RLS_GAP` | Confirmado (SELECT de `representantes` nunca restaurado após P2.6.4; policy `representantes_gestor_all` também nunca migrada para multifundo) |
| `MISSING_DOCUMENT_PURPOSE_CLASSIFICATION` | Não aplicável — o problema não era falta de classificação, e sim rótulo incorreto/faltante pontual |
| `RPC_ERROR_SWALLOWED` / `ACTION_NOT_CALLED` / `VALIDATION_SILENT` | Não confirmados como causa própria — eram consequência de `BUTTON_NOT_WIRED` |
| `UNRESOLVED` | Zero — os dois achados adicionais (RPC do P0 anterior e SELECT de representantes) foram investigados e confirmados/corrigidos dentro deste próprio escopo |

## Catálogo antes/depois

| Código | Antes | Depois |
| --- | --- | --- |
| `comprovante_endereco` | Empresa **e** Representante (por `representante_id`) | Somente Empresa (`representante_id IS NULL`, agora exigido por CHECK constraint) |
| `representante_comprovante_residencia` | Não existia | Novo valor do enum `documento_tipo`, exclusivo do Representante (`representante_id IS NOT NULL`, exigido por CHECK constraint) |
| `extrato_bancario` (fila global do Gestor) | Rotulado "Comprovante de Renda" (errado) | Rotulado "Comprovante de Faturamento" |
| `comprovante_de_renda` (fila global do Gestor) | Sem rótulo (aparecia o código bruto) | Rotulado "Comprovante de Renda" |

Backfill: documentos existentes com `tipo = 'comprovante_endereco' AND representante_id IS NOT NULL` foram migrados para `representante_comprovante_residencia` (0 linhas afetadas em homologação — não havia dados de teste anteriores nessa condição, confirmado por contagem).

## Classificação documental adotada

Reaproveitado o enum `documento_tipo` já existente, adicionando **um único** valor novo (`representante_comprovante_residencia`), em vez de renomear ambos os lados ou criar uma tabela de categorias paralela. `comprovante_endereco` manteve seu significado atual (Empresa), já correto em toda a base de código exceto na fila global do Gestor (rótulo). Uma `CHECK` constraint (`documentos_escopo_endereco_residencia_check`) garante estruturalmente, no banco, que:
- `comprovante_endereco` nunca pode ter `representante_id` preenchido;
- `representante_comprovante_residencia` nunca pode ter `representante_id` nulo.

Isso torna a distinção de escopo uma garantia do schema, não uma convenção que cada trecho de código precisa lembrar de respeitar.

## Fluxo antes/depois

**Filial (A):**
```
Antes: Cedente preenche formulario -> clica "Enviar para analise" -> nada acontece (type="button" implicito)
Depois: Cedente preenche formulario -> clica "Enviar para analise" (type="submit")
  -> onSubmit dispara -> cadastrarFilial() -> RPC cadastrar_filial_cedente()
  -> Filial criada com status 'pendente' -> lista recarrega
```

**Requisito (B):**
```
Antes: Gestor seleciona tipo -> clica "Configurar requisito" -> nada acontece (type="button" implicito
       + ainda que disparasse, a RPC falhava com function private.gestor_tem_acesso_cedente does not exist)
Depois: Gestor seleciona tipo -> clica "Configurar requisito" (type="submit")
  -> onSubmit dispara -> configurarRequisitoEstabelecimento() -> RPC configurar_requisito_estabelecimento_gestor()
     (dependencia private.gestor_tem_acesso_cedente ja existe, corrigida no P0 anterior)
  -> requisito persiste -> load() recarrega -> lista de requisitos configurados exibe
     tipo, Obrigatorio/Opcional, Ativo/Inativo e acao Desativar/Reativar
```

**Documentos (C):**
```
Antes: Cedente e Gestor tentam listar representantes -> permission denied (engolido) ->
       representantes.length === 0 -> ambas as telas caem no fallback legado
       (so rg_cpf/procuracao) -> Comprovante de Renda e Residencia do Representante
       ficam invisiveis/incorretos nas duas pontas; fila global do Gestor rotula
       tipos errado/faltante.
Depois: GRANT SELECT restaurado + policy multifundo -> Cedente e Gestor listam
        representantes normalmente -> telas renderizam os 4 tipos do Representante
        corretamente rotulados -> fila global do Gestor mostra rotulo certo e
        coluna de Escopo (Empresa ou nome do Representante).
```

## Arquivos alterados

- `src/app/cedente/estabelecimentos/meus-estabelecimentos-client.tsx` — `type="submit"` em 3 botões.
- `src/components/cedentes/EstabelecimentosGestor.tsx` — `type="submit"` em 3 botões.
- `src/lib/types/domain.ts` — novo valor `representante_comprovante_residencia` em `DOCUMENT_TYPES`.
- `src/app/cedente/documentos/page.tsx` — usa o novo código para o comprovante de residência do representante.
- `src/lib/actions/gestor.ts` — `docsRepObrig` e rótulo atualizados.
- `src/app/gestor/cedentes/[id]/page.tsx` — `docsRepObrig`, `tipoLabelsRep` e array de renderização atualizados.
- `src/lib/documentos/gestor-listagem.ts` — novo campo `escopo` no contrato `DocumentoGestorListagemItem`.
- `src/lib/documentos/gestor-listagem.server.ts` — rótulos corrigidos, query seleciona `representante_id`/`representantes(nome)`, item retornado expõe `escopo`.
- `src/lib/documentos/gestor-listagem.test.ts` — fixture e contrato de chaves atualizados com `escopo`.
- `src/components/documentos/DocumentosGestorListagem.tsx` — nova coluna "Escopo".
- `src/lib/documentos/filiais-consistencia-documental-architecture.test.ts` (novo).
- `scripts/homologacao/p0-filiais-consistencia-documental/apply-migration.mjs` e `verify.mjs` (novos).

## Migrations aplicadas em homologação

1. `20260819160000_p0_novo_tipo_comprovante_residencia_representante.sql` — `ALTER TYPE documento_tipo ADD VALUE`, isolado em sua própria transação (obrigatório: o Postgres não permite usar o valor novo na mesma transação em que foi adicionado).
2. `20260819160500_p0_backfill_comprovante_residencia_representante.sql` — backfill + `CHECK` constraint estrutural.
3. `20260819161000_p0_representantes_leitura_multifundo_gestor.sql` — achado adicional: `GRANT SELECT` em `representantes` para `authenticated` (nunca restaurado após P2.6.4) e substituição da policy legada `representantes_gestor_all` (sem checagem de fundo) por `representantes_gestor_multifundo_select`.

Nenhuma migration histórica foi editada; não houve `migration repair`.

## Segurança

- `authenticated` continua sem `INSERT/UPDATE/DELETE` direto em `representantes`/`cedentes`/`documentos`/`cedente_estabelecimentos` (inalterado; apenas o `SELECT` de `representantes` foi restaurado).
- A nova policy de leitura de `representantes` exige `private.gestor_tem_acesso_cedente(cedente_id)` — mesma regra multifundo já usada em `cedentes`/`documentos`, sem depender do "fundo ativo" em cookie.
- A `CHECK` constraint de escopo documental é uma garantia de banco, não contornável por nenhuma camada de aplicação.
- Nenhum campo de autoridade (`cedente_id`, `fundo_id`, `estabelecimento_id` de terceiro, status de aprovação) é aceito do cliente em nenhuma das RPCs envolvidas (inalterado).

## Testes e E2E

Arquitetura (`npm test`): 13 testes novos cobrindo `type="submit"` nos botões corrigidos, a migration do novo tipo/backfill/constraint, os mapeamentos de código/rótulo corrigidos em 4 arquivos, e a nova coluna de escopo na fila do Gestor.

E2E ao vivo em homologação (`scripts/homologacao/p0-filiais-consistencia-documental/verify.mjs`, 11 verificações, sessões reais do Supabase Auth):

- zero documento remanescente com `comprovante_endereco` + `representante_id` preenchido (backfill completo);
- **o próprio Cedente volta a conseguir listar seus representantes** (causa raiz confirmada do "6 de 6" incorreto);
- constraint bloqueia `comprovante_endereco` com representante e `representante_comprovante_residencia` sem representante;
- RPC de upload aceita corretamente os dois tipos em seus escopos próprios;
- documento da empresa e do representante persistem com o `representante_id` correto e tipos distintos;
- gestor de outro fundo não lê os representantes deste cedente (zero leak);
- gestor lê o documento da empresa com escopo "empresa" e o documento do representante com o nome do representante disponível.

```bash
npm run homolog:p0:filiais-consistencia:apply-migration
npm run homolog:p0:filiais-consistencia:verify
```

### Pendente de validação manual

Os botões `type="submit"` corrigidos (itens A e B) são uma correção de DOM/React que só pode ser verificada de fato clicando no navegador — não há como simular clique real de usuário nem verificar o disparo do evento `submit` a partir de um script Node/SQL. O E2E ao vivo cobriu o backend/RPC/RLS por completo; o percurso visual completo pedido no ticket (cadastrar Filial pelo Cedente, configurar requisito pelo Gestor, enviar os três documentos e aprovar/reprovar individualmente, tudo com reload) não foi executado por este agente. Recomendo fortemente esse teste manual antes de considerar o ticket definitivamente encerrado, dado que a causa raiz de A e B era especificamente sobre o comportamento do clique no navegador.

## Riscos residuais

- `getLatestLegado` (tela de detalhe do Cedente no Gestor) continua sem filtrar por `representante_id` — hoje inofensivo porque só é chamada para `rg_cpf`/`procuracao` no fallback sem representantes cadastrados, mas é o mesmo padrão de código que causou a fragilidade original. Não foi alterado por estar fora do escopo relatado (nenhum bug ativo hoje).
- O fallback "sem representantes" (tanto na tela do Cedente quanto do Gestor) continua considerando apenas `rg_cpf` como obrigatório quando não há linhas na tabela `representantes` — comportamento pré-existente, não alterado (ticket pede não inventar regra de negócio).
- A restauração do `SELECT` de `representantes` também beneficia o Consultor (policy `representantes_consultor_select`, já existente e correta) e o próprio Cedente — efeito colateral positivo, não uma ampliação de escopo indevida.

## Gates de qualidade executados

- `npx tsc --noEmit`: `PASS`.
- `npm test -- --run`: `PASS` — 156 arquivos e 1.094 testes aprovados; 1 arquivo e 3 testes ignorados pela suíte (pré-existentes).
- `npm run lint`: `PASS` sem erros; seis warnings preexistentes fora deste escopo.
- `git diff --check`: `PASS`.
- `npx next build --webpack`: `PASS`.
- `npm audit --omit=dev`: `PASS` — zero vulnerabilidades.
- secret scan: `PASS` — 1.171 arquivos textuais examinados, zero achados.
