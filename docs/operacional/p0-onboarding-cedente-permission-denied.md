# P0 — Correção do onboarding do cedente (`permission denied`)

## Resultado

**P0_ONBOARDING_CEDENTE = PASS**

Correção aplicada e certificada exclusivamente em homologação, projeto Supabase `fhgkmggthxikfpogrvaa`. Produção não foi acessada.

## Sintoma e fluxo afetado

Na rota `/cedente/cadastro`, o botão **Finalizar Cadastro** chama `cadastrarCedente()` em `src/lib/actions/cedente.ts`. A action usava o cliente SSR associado à sessão do usuário e executava `INSERT` diretamente em `public.cedentes`, seguido de `INSERT` em `public.representantes`.

O papel PostgreSQL efetivo da chamada pela Data API era `authenticated`. Depois da canonicalização de ACL da P2.6.4, esse papel não possuía mais `INSERT` nessas tabelas, gerando:

```text
permission denied for table cedentes
```

## Causa raiz

Classificação:

- `ACL_MISSING`: `20260817150507_p2_6_4_canonicalizar_acl_rls.sql` revogou `INSERT` de `authenticated` em `cedentes` e `representantes`;
- `ONBOARDING_ARCHITECTURE_BUG`: o onboarding ainda dependia de escrita direta pela Data API;
- não era falha da policy de RLS: a policy `cedentes_own_insert` existia, mas o PostgreSQL recusava a operação no ACL antes de avaliá-la;
- `20260817154500_p2_6_4_restaurar_leitura_carteira_consultor.sql` restaurou apenas `SELECT` em `cedentes`, corretamente sem restaurar escrita ampla.

ACL e RLS são camadas complementares. Uma policy permissiva não concede o privilégio de tabela que foi revogado.

## Correção implementada

A action passou a chamar somente:

```sql
public.concluir_onboarding_cedente(p_cadastro jsonb)
```

A função:

- é `SECURITY DEFINER` porque precisa gravar sem devolver `INSERT` direto ao papel `authenticated`;
- usa `SET search_path = ''` e referências de schema explícitas;
- resolve a identidade exclusivamente por `auth.uid()`;
- exige perfil ativo com papel primário `cedente`;
- rejeita qualquer campo fora da allowlist, incluindo `user_id`, `fundo_id` e `status`;
- cria o cedente sempre como `pendente` e sem fundo definido;
- valida CNPJ e os representantes no banco;
- cria cedente e representantes na mesma transação PostgreSQL;
- serializa chamadas concorrentes do mesmo usuário com advisory lock transacional;
- é idempotente para o mesmo usuário e CNPJ;
- rejeita CNPJ já associado a outro usuário;
- permite `EXECUTE` apenas a `authenticated`;
- mantém `INSERT`, `UPDATE` e `DELETE` diretos revogados para `authenticated`;
- mantém a função inacessível a `anon` e `PUBLIC`.

A abordagem segue as recomendações atuais do Supabase para funções `SECURITY DEFINER`: `search_path` vazio, objetos qualificados e concessão explícita de `EXECUTE` apenas ao papel necessário.

## Arquivos

- `supabase/migrations/20260818191418_p0_onboarding_cedente_rpc_segura.sql`
- `src/lib/actions/cedente.ts`
- `src/types/database.ts`
- `src/lib/cedentes/onboarding-cadastro.test.ts`
- `scripts/homologacao/p0-onboarding/validate-migration.mjs`
- `scripts/homologacao/p0-onboarding/apply-migration.mjs`
- `scripts/homologacao/p0-onboarding/verify.mjs`
- `package.json`

## Aplicação em homologação

Comandos reproduzíveis:

```bash
npm run homolog:p0:onboarding:validate-migration
npm run homolog:p0:onboarding:apply-migration
npm run homolog:p0:onboarding:verify
```

O instalador:

- valida que API e PostgreSQL apontam para `fhgkmggthxikfpogrvaa`;
- bloqueia coincidência com o project ref de produção;
- recusa a execução se houver outra migration local pendente;
- aplica pelo histórico normal do Supabase.

## Matriz de autorização certificada

| Cenário | Resultado |
|---|---|
| Cedente autenticado conclui o próprio cadastro | Permitido |
| Repetição do mesmo cadastro | Mesmo ID, sem duplicidade |
| Cedente tenta enviar `user_id` de terceiro | Negado (`22023`) |
| Cedente tenta escolher `fundo_id` | Negado (`22023`) |
| Usuário anônimo | Negado |
| Gestor tenta concluir cadastro de cedente | Negado (`42501`) |
| Consultor tenta concluir cadastro de cedente | Negado (`42501`) |
| Cedente tenta `INSERT` direto em `cedentes` | Negado |
| Falha de autorização | Sem dados parciais |
| Login de cedente, gestor e consultor | Preservado |

O teste autenticado criou atores efêmeros, executou 14 verificações contra homologação e removeu os usuários e dados de QA ao final.

## Estado confirmado no banco

- `concluir_onboarding_cedente(jsonb)` está com `prosecdef = true`;
- `search_path` da função está vazio;
- `authenticated` possui `EXECUTE` na RPC;
- `anon` não possui `EXECUTE`;
- `authenticated` não possui `INSERT`, `UPDATE` ou `DELETE` em `cedentes` e `representantes`;
- as policies RLS existentes foram preservadas, sem alteração ampla.

## Segurança operacional

O fluxo não aceita identidade, fundo ou status vindos do frontend. Não utiliza `service_role` na aplicação e não reabre escrita genérica nas tabelas. A atomicidade dos registros cadastrais é garantida pela transação da função; falha em qualquer representante desfaz também o cedente.

> Nota operacional: durante a primeira tentativa de execução do instalador no Windows, o runtime serializou a URL de conexão em uma mensagem local de erro. A senha PostgreSQL de homologação deve ser rotacionada após a certificação. Nenhuma credencial foi registrada neste documento.

## Validações finais

| Validação | Resultado |
|---|---|
| Migration executada dentro de transação e revertida para validação | PASS |
| Migration aplicada no histórico remoto de homologação | PASS |
| Certificação autenticada da RPC | PASS — 14 verificações |
| Teste de arquitetura do onboarding | PASS — 6 testes |
| `npx tsc --noEmit` | PASS |
| `npm test -- --run` | PASS — 1.047 testes, 3 ignorados |
| `npm run lint` | PASS — 0 erros; 6 avisos preexistentes fora do escopo |
| `git diff --check` | PASS |
| `npx next build --webpack` | PASS |
| `npm audit --omit=dev` | PASS — 0 vulnerabilidades |
| Secret scan | PASS — 1.123 arquivos, 0 achados |
