# Rota de performance — Escopo 2: onboarding de cedentes

## Objetivo e limite

Este escopo migra exclusivamente `/gestor/onboarding-cedentes` para leitura paginada no servidor. Foram preservadas as regras de vínculo, política, versão publicada, auditoria e autorização multifundo. Nenhuma tela de cedentes, operação, nota fiscal, documento, dashboard ou relatório foi migrada.

## Diagnóstico inicial

A causa do excesso de carregamento estava em `OnboardingCedentesPage`: ao montar a página, o navegador executava sete consultas sem paginação e trazia coleções completas de:

1. `cedentes`;
2. `cedente_fundos`;
3. `cedente_fundo_politicas`;
4. `politica_operacional_versoes`;
5. `usuario_fundos`;
6. `politicas_operacionais`;
7. `politica_requisitos_documentais`.

Depois disso, o browser relacionava as coleções, calculava o status do onboarding, os seis cards, a busca, os filtros, a ordenação e, por último, aplicava `slice` para simular paginação. O custo de rede e memória crescia com toda a base, mesmo quando a tela mostrava apenas dez cedentes.

## Arquitetura antes e depois

Antes:

```text
Client Component
  -> 7 leituras completas
  -> joins em memória
  -> cards em memória
  -> filtros e ordenação no browser
  -> slice da página
  -> catálogos completos mantidos para modal e drawer
```

Depois:

```text
Server Component
  -> autenticação do gestor
  -> resolução do fundo ativo autorizado
  -> RPC SECURITY INVOKER
      -> escopo cedente_fundos
      -> filtros
      -> count
      -> ordenação estável
      -> OFFSET/LIMIT
      -> cards agregados
  -> contrato compacto da página
  -> Client Component somente para URL e interação

Modal/drawer aberto
  -> action autenticada
  -> contexto de um cedente
  -> políticas e versões publicadas do fundo ativo
  -> contagem mínima de requisitos
```

## Rota, loader e contrato

- A rota `src/app/gestor/onboarding-cedentes/page.tsx` é um Server Component.
- `src/lib/onboarding-cedentes/listagem.ts` centraliza allowlists, normalização, paginação e o contrato compacto.
- `src/lib/onboarding-cedentes/listagem.server.ts` autentica uma vez, resolve o fundo ativo e executa a leitura.
- `src/lib/onboarding-cedentes/contexto.server.ts` resolve o fundo pelo cookie `bw_fundo_ativo_id` e por `usuario_fundos`, com fallback apenas para o fundo principal/autorizado do gestor.
- A migration `20260729185443_performance_escopo2_onboarding_paginado.sql` cria `listar_onboarding_cedentes_paginado`.

Cada item da página contém somente:

- identificação, razão social, nome fantasia e CNPJ do cedente;
- status cadastral e status derivado do onboarding;
- vínculo atual no fundo ativo;
- fundo ativo;
- política atribuída e sua versão publicada vigente;
- quantidade agregada de requisitos da versão.

Não são enviados documentos, conteúdo de requisitos, histórico, snapshots ou coleções completas.

## Filtros, ordenação e paginação

Parâmetros:

- `page`: padrão 1;
- `pageSize`: 10, 20 ou 40;
- `q`: razão social, nome fantasia ou CNPJ;
- `etapa`: pendências, sem fundo, sem política, aptos, suspensos ou todos;
- `status`: status cadastral válido;
- `politica`: UUID de política;
- `sort`: `created_at`, `updated_at` ou `razao_social`;
- `direction`: `asc` ou `desc`.

Todos são normalizados por allowlist. A ordenação sempre inclui `id` como desempate. Filtros são aplicados antes de `OFFSET/LIMIT`. Página fora do intervalo é redirecionada para a última página válida sem perder os filtros.

## Semântica multifundo

A fonte de verdade continua sendo `cedente_fundos`.

- Cedentes vinculados ao fundo ativo aparecem no contexto desse fundo.
- Cedentes sem qualquer vínculo ativo ou suspenso formam a fila global de “sem fundo”.
- Cedentes vinculados somente a outro fundo não aparecem.
- Não existe fallback por `cedentes.fundo_id`.
- Política válida exige atribuição ativa em `cedente_fundo_politicas`, política ativa do mesmo fundo e versão publicada vigente.

## Cards e contadores

Os cards representam o universo permitido do fundo ativo mais a fila global sem fundo. As contagens são agregadas no PostgreSQL e não dependem das linhas carregadas na página. Busca, status cadastral e política afetam a lista e seu total filtrado; os cards permanecem como visão operacional do contexto, preservando a semântica anterior.

O onboarding atual não exibe progresso documental nem responsável operacional. Esses dados não foram adicionados, pois isso criaria funcionalidade nova e ampliaria o contrato. A quantidade de requisitos exibida no detalhe é apenas uma agregação da versão publicada vigente.

## Dados sob demanda

`DefinirPoliticaDialog` e `CedenteOnboardingDrawer` chamam `carregarContextoOnboardingCedente` somente quando abertos. A action consulta:

- o cedente selecionado;
- seu vínculo no fundo ativo;
- políticas ativas do fundo;
- versões publicadas vigentes;
- contagem dos requisitos dessas versões;
- atribuição atual do vínculo.

O modal de vínculo usa diretamente o fundo ativo autorizado, sem carregar catálogo completo de fundos.

## Autorização, RLS e segurança

- O loader usa o client da sessão e continua sujeito à RLS.
- A RPC é `SECURITY INVOKER`.
- A RPC exige `auth.uid()`, papel `gestor` e associação ativa em `usuario_fundos`.
- A action sob demanda repete a validação de fundo e bloqueia cedente fora do contexto.
- A vinculação aceita apenas o fundo ativo autorizado.
- Não foi adicionado `service_role` ao fluxo de leitura.
- A implementação não consulta `cedentes.fundo_id`.

O uso administrativo já existente na action de vínculo foi preservado apenas para garantir auditoria obrigatória e compensação da mutação; ele não participa da listagem ou da hidratação.

## Métricas estruturais

| Aspecto | Antes | Depois |
|---|---:|---:|
| Cargas principais no browser | 7 coleções completas | 0 |
| Leitura principal | 7 consultas sem limite | 1 RPC paginada |
| Linhas de cedente transferidas | toda a coleção | no máximo 10/20/40 |
| Paginação | `slice` no client | count + offset/limit no banco |
| Filtros e ordenação | client-side | banco, antes do range |
| Dados de modal/drawer | pré-carregados | sob demanda |
| Queries por linha | joins em memória sobre coleções completas | nenhuma |

Não foi afirmado ganho temporal ou de bytes sem medição autenticada em homologação.

## Índices

Não foi criado índice porque não houve `EXPLAIN (ANALYZE, BUFFERS)` conectado ao banco de homologação. Os índices existentes para fundo/status, vínculo/política e versões foram reutilizados. Candidatos só devem ser avaliados após medição real da RPC com volume representativo.

## Testes

Foram adicionados testes para:

- defaults e allowlist de page size;
- busca normalizada;
- status e ordenação válidos/inválidos;
- range inclusivo;
- página fora do intervalo e total zero;
- preservação de filtros na URL;
- contrato compacto da RPC;
- ausência das sete cargas no Client Component;
- página principal como Server Component;
- ausência de `select("*")`, `service_role` e fallback legado;
- autorização por `usuario_fundos`;
- vínculo, política atribuída e versão publicada;
- filtros antes do range e desempate por ID;
- carregamento de modal/drawer sob demanda;
- revalidação da rota após mutação.

## Riscos e validação pendente

- A migration precisa ser aplicada em homologação antes da página funcionar.
- O schema cache do PostgREST pode precisar de alguns segundos para reconhecer a RPC.
- Métricas reais de tempo, payload e plano de execução dependem de homologação autenticada.
- O carregamento sob demanda possui mais de uma consulta compacta, mas somente para um cedente e sem padrão N+1.
- Responsável e progresso documental não existiam na listagem e permanecem fora deste escopo.

## Validações técnicas executadas

- `npx tsc --noEmit`: aprovado.
- `npm test -- --run`: 49 arquivos e 341 testes aprovados.
- `npm run lint`: código novo sem erros; o comando global permanece com 19 avisos preexistentes fora do Escopo 2.
- `git diff --check`: aprovado; apenas avisos de conversão LF/CRLF do Git no Windows.
- `npx next build --webpack`: aprovado; permaneceram apenas os avisos preexistentes do Handlebars sobre `require.extensions`.

Não foi executado teste manual autenticado nem `EXPLAIN (ANALYZE, BUFFERS)` contra homologação nesta entrega.

## Arquivos principais

- `src/app/gestor/onboarding-cedentes/page.tsx`
- `src/lib/onboarding-cedentes/listagem.ts`
- `src/lib/onboarding-cedentes/listagem.server.ts`
- `src/lib/onboarding-cedentes/contexto.server.ts`
- `src/components/onboarding-cedentes/OnboardingCedentesPage.tsx`
- `src/components/onboarding-cedentes/OnboardingCedentesTable.tsx`
- `src/components/onboarding-cedentes/OnboardingToolbar.tsx`
- `src/components/onboarding-cedentes/DefinirPoliticaDialog.tsx`
- `src/components/onboarding-cedentes/CedenteOnboardingDrawer.tsx`
- `src/components/onboarding-cedentes/VincularFundoDialog.tsx`
- `src/lib/actions/onboarding-cedentes.ts`
- `supabase/migrations/20260729185443_performance_escopo2_onboarding_paginado.sql`

O Escopo 3 não foi iniciado.
