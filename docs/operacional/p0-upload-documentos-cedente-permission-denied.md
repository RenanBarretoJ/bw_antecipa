# P0 — Upload de documentos cadastrais do cedente

## Resultado

`P0_UPLOAD_DOCUMENTOS_CEDENTE = PASS`

- Ambiente validado: homologação.
- Projeto Supabase: `fhgkmggthxikfpogrvaa`.
- Produção: não acessada nem alterada.
- Branch: `homolog`.

## Causa raiz e classificação

O botão **Enviar** chama `uploadDocumento()` em `src/lib/actions/cedente.ts`. O fluxo anterior enviava o arquivo ao bucket privado `documentos-cedentes` e, em seguida, tentava executar `INSERT` direto em `public.documentos` com a sessão `authenticated` do cedente.

O hardening canônico havia removido corretamente `INSERT`, `UPDATE` e `DELETE` diretos de `authenticated` nessa tabela. As policies RLS cadastrais ainda existiam, mas não eram alcançadas porque o PostgreSQL recusava a operação primeiro no ACL. Conceder DML amplo novamente contrariaria o desenho de segurança atual.

Classificação:

| Código | Resultado | Evidência |
| --- | --- | --- |
| `ACL_MISSING` | Confirmado como causa imediata | `authenticated` não possuía `INSERT` em `public.documentos`. |
| `RLS_POLICY_MISSING` | Não confirmado | Policies cadastrais de cedente já existiam. |
| `DOCUMENT_UPLOAD_ARCHITECTURE_BUG` | Confirmado | A action dependia de escrita direta incompatível com o hardening de ACL. |
| `STORAGE_COMPENSATION_BUG` | Confirmado | O upload ocorria antes do banco e não havia remoção em caso de falha SQL. |
| `UNRESOLVED` | Zero | Diagnóstico fechado antes da implementação. |

O diagnóstico encontrou dois objetos antigos sem linha correspondente em `public.documentos`. Eles não foram apagados automaticamente, pois antecedem a correção e podem exigir análise operacional antes de qualquer exclusão.

## Fluxo antes e depois

Antes:

```text
Frontend
  -> Server Action autentica e resolve o cedente
  -> upload direto no Storage
  -> INSERT direto em public.documentos como authenticated
     -> permission denied
     -> arquivo permanece órfão
```

Depois:

```text
Frontend (envia somente arquivo, tipo e representante opcional)
  -> Server Action autentica e resolve o cedente
  -> valida arquivo e gera caminho no servidor
  -> upload no bucket privado
  -> RPC estreita registrar_documento_cadastral_cedente()
       -> deriva auth.uid() e cedente no banco
       -> valida papel, vínculo, representante, caminho, owner, MIME e tamanho
       -> define status e versão no backend
       -> registra de forma idempotente
  -> se a RPC falhar, remove o objeto recém-enviado
  -> auditoria, notificação e refresh existentes são preservados
```

## Segurança e autorização

- `authenticated` continua sem `INSERT`, `UPDATE` ou `DELETE` direto em `public.documentos`.
- A RPC é `SECURITY DEFINER`, possui `search_path` vazio e usa nomes qualificados.
- `PUBLIC` e `anon` não executam a função; apenas `authenticated` recebeu `EXECUTE`.
- A função aceita somente tipo, caminho, nome e representante opcional. Não aceita `cedente_id`, `fundo_id` ou `status` fornecidos pelo cliente.
- O cedente é derivado por `auth.uid()` e pelo vínculo canônico existente.
- Somente o titular ou acesso ativo com perfil administrador do mesmo cedente pode registrar.
- Representantes são validados contra o mesmo cedente.
- O caminho deve começar com o CNPJ canônico do cedente e seguir a pasta esperada.
- O objeto precisa existir no bucket privado e ter `owner_id` igual ao usuário autenticado.
- MIME e tamanho são revalidados a partir do metadata do Storage.
- O status inicial é sempre `enviado` e a versão é calculada sob lock transacional.
- Índices únicos protegem caminho de Storage e versão por contexto documental.
- A compensação só consegue selecionar e apagar objeto do próprio usuário, no próprio CNPJ e ainda sem vínculo em `public.documentos`.

## Grants e policies

Antes:

- `authenticated`: `SELECT` em `public.documentos`; DML revogado.
- Policies RLS de cedente: presentes.
- Storage: `INSERT` próprio permitido; não havia caminho funcional e restrito para excluir um upload órfão.

Depois:

- DML direto permanece revogado.
- `authenticated` recebe somente `EXECUTE` da RPC específica.
- Policies novas de Storage:
  - `storage_docs_cedente_delete_orphan`;
  - `storage_docs_cedente_select_orphan_own`, necessária para a API do Storage localizar o objeto durante a remoção.
- Ambas são limitadas ao objeto próprio, ao bucket `documentos-cedentes`, ao CNPJ canônico e à ausência de documento persistido.

## Migrations aplicadas em homologação

1. `20260818194455_p0_upload_documentos_cedente_permission_denied.sql`
   - cria a RPC estreita;
   - preserva o ACL restritivo;
   - adiciona índices de idempotência/concorrência;
   - cria a policy de exclusão compensatória.
2. `20260818195119_p0_compensacao_storage_documentos_cedente.sql`
   - adiciona a leitura mínima do objeto próprio ainda órfão, requisito da remoção pela API do Storage.

As duas versões constam no histórico de migrations de homologação. Não houve `migration repair` nem alteração de migration histórica.

## E2E autenticado em homologação

O verificador `scripts/homologacao/p0-documentos-cedente/verify.mjs` criou atores temporários, executou os cenários com sessões reais do Supabase Auth e removeu a massa ao final.

Resultados:

- dois tipos documentais registrados como versão inicial: `PASS`;
- status inicial `enviado` definido pelo backend: `PASS`;
- arquivo persistido no Storage: `PASS`;
- retry da mesma requisição retorna o mesmo documento: `PASS`;
- nenhuma duplicidade por caminho: `PASS`;
- leitura do próprio cedente: `PASS`;
- leitura por outro cedente: `DENY`;
- gravação usando contexto de outro cedente: `DENY`;
- gestor, consultor e sacado na RPC cadastral: `DENY`;
- anônimo: `DENY`;
- falha SQL depois do upload: objeto removido e zero novo órfão;
- caminho de Storage de outro cedente: `DENY` e zero registro SQL.

O teste E2E automatizado cobre Auth, Storage, RPC, banco, retry, isolamento e compensação. A inspeção visual de contador/progresso da página continua sendo um smoke test manual de interface; a action preservou os mesmos retornos, auditoria e notificações, e a tela continua recarregando sua coleção com `loadDocs()` após o sucesso.

Comandos:

```bash
npm run homolog:p0:documentos:apply-migrations
node --env-file=.env.homolog scripts/homologacao/p0-documentos-cedente/verify.mjs
```

Os scripts possuem trava explícita para o project ref de homologação e bloqueiam o project ref configurado como produção.

## Arquivos alterados

- `src/lib/actions/cedente.ts`
- `src/lib/documentos-cadastrais/upload.ts`
- `src/lib/documentos-cadastrais/upload.test.ts`
- `src/types/database.ts`
- `scripts/homologacao/p0-documentos-cedente/apply-migrations.mjs`
- `scripts/homologacao/p0-documentos-cedente/verify.mjs`
- `supabase/migrations/20260818194455_p0_upload_documentos_cedente_permission_denied.sql`
- `supabase/migrations/20260818195119_p0_compensacao_storage_documentos_cedente.sql`
- `package.json`

## Riscos residuais

- Os dois órfãos preexistentes permanecem no bucket até revisão e exclusão operacional autorizada.
- Storage e PostgreSQL não compartilham uma transação ACID. A implementação usa compensação imediata e registra eventual falha dessa compensação para suporte.
- O smoke test visual da tela deve ser repetido por um operador autenticado após o deploy da aplicação, embora o fluxo autenticado de backend tenha sido certificado em homologação.

## Gates de qualidade executados

- `npx tsc --noEmit`: `PASS`.
- `npm test -- --run`: `PASS` — 150 arquivos e 1.055 testes aprovados; 1 arquivo e 3 testes ignorados pela suíte.
- `npm run lint`: `PASS` sem erros; seis warnings preexistentes fora deste escopo.
- `git diff --check`: `PASS`.
- `npx next build --webpack`: `PASS` — 78 páginas geradas.
- `npm audit --omit=dev`: `PASS` — zero vulnerabilidades.
- secret scan: `PASS` — 1.130 arquivos textuais examinados e zero achados.
