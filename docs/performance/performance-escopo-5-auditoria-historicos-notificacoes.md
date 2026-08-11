# Performance — Escopo 5: auditoria, históricos e notificações

## Objetivo e limites

Este escopo substitui cargas antecipadas ou integrais por feeds incrementais em:

- `/gestor/auditoria`;
- histórico operacional compartilhado de notas fiscais e operações;
- notificações de gestor, cedente, consultor e sacado;
- sino global de notificações.

Não foram alteradas regras de auditoria, eventos de domínio, destinatários,
semântica das notificações ou áreas funcionais fora desse conjunto. Históricos
de versões de fundo foram somente auditados e permaneceram fora da mudança
porque sua migração exigiria refatorar telas principais extensas.

## Diagnóstico inicial

### Auditoria

`/gestor/auditoria` era integralmente um Client Component. Na montagem, um
`useEffect` consultava os 200 registros mais recentes, incluindo
`dados_antes` e `dados_depois`, e só então aplicava busca, tipo e período no
navegador.

O limite incorreto não era apenas o número 200. A causa exata era a combinação:

```text
ORDER BY created_at DESC
LIMIT 200
  ↓
transferência de detalhes completos
  ↓
filtros no navegador
```

Assim, um filtro podia informar zero resultados mesmo havendo registros
compatíveis fora dos 200 mais recentes. A tela também transferia snapshots JSON
para linhas nunca expandidas.

Não existia exportação nessa rota. A leitura era protegida pela política RLS
vigente de gestor; a tabela não oferece `fundo_id` ou `tenant_id` direto para
criar um filtro adicional confiável sem mudar a modelagem.

### Histórico operacional

O histórico já ordenava por `created_at DESC`, `id DESC`, mas o cursor continha
somente a data e a página seguinte usava apenas:

```text
created_at < cursor.createdAt
```

Esse era o risco exato de omissão: quando a página terminava no meio de um grupo
com o mesmo `created_at`, todos os registros restantes daquele timestamp eram
descartados.

O componente ainda iniciava duas consultas de resumo na montagem — count e
último evento — mesmo recolhido. Ao expandir, fazia uma terceira consulta para
os eventos.

### Notificações

As quatro páginas repetiam implementações Client Component. Cada uma carregava
a coleção do usuário sem paginação e aplicava os filtros de lida/não lida no
navegador. Havia quatro coleções diretamente sem limite, uma por perfil.

O sino tinha limite visual adequado de dez itens, mas usava `select("*")`,
calculava não lidas somente sobre esses dez registros e fazia polling completo a
cada 30 segundos. O realtime tratava apenas INSERT. As páginas e o sino não
compartilhavam contrato, contador nem actions.

### Históricos de versões auditados

Foram identificadas quatro cargas antecipadas relevantes:

- versões de CNAB no detalhe do fundo;
- versões de integração no detalhe do fundo;
- versões de templates jurídicos;
- versões de política operacional.

Essas coleções são hidratadas por componentes pais grandes e não possuem uma
fronteira pequena de expansão que permita aplicar o novo cursor isoladamente.
Migrá-las exigiria modificar as telas principais de fundos, políticas,
templates, CNAB e integrações, áreas expressamente fora deste escopo. Foram
registradas como pendência, sem mudança parcial.

## Arquitetura implementada

```text
Server Component
  ↓
autenticação e autorização existentes
  ↓
normalização de filtros e cursor
  ↓
query no banco
  ↓
ORDER BY created_at DESC, id DESC
  ↓
limit + 1
  ↓
contrato compacto
  ↓
Client Component somente para interação incremental
```

O cursor canônico do Escopo 0 é reutilizado:

```ts
{
  createdAt: string
  id: string
}
```

A condição da página seguinte é construída centralmente por
`buildDescendingCreatedAtCursorFilter()`:

```text
created_at < cursor.createdAt
OR
(created_at = cursor.createdAt AND id < cursor.id)
```

O valor é decodificado e validado antes de compor o filtro PostgREST. Não há
offset profundo nem segundo formato de cursor.

## Auditoria

### Listagem

A rota passou a ser Server Component e carrega 20 registros, consultando 21
para determinar `hasMore`. Busca, tipo, entidade, ator e período são persistidos
na URL e aplicados no banco antes do cursor e do limite.

O contrato inicial contém somente:

- identificação e data do evento;
- tipo/ação;
- entidade;
- ator resumido;
- origem;
- IP mascarado;
- texto de resumo.

Não são enviados na listagem snapshots, headers, tokens, corpo de request ou
metadata técnica integral.

### Detalhe sob demanda

`carregarDetalheAuditoria(eventoId)`:

1. exige gestor novamente;
2. valida o UUID;
3. consulta somente o evento solicitado usando o cliente autenticado;
4. limita profundidade, quantidade e tamanho do conteúdo;
5. remove recursivamente chaves associadas a senha, token, cookie, segredo,
   credencial, OTP, nonce, autorização, service role e chave privada.

O IP da listagem é mascarado. Os detalhes só são transferidos quando o usuário
expande uma linha.

### Escopo de acesso

Foi preservado o universo definido pela autorização de gestor e pela RLS atual.
Não foi usado `service_role`. Como `logs_auditoria` não possui um vínculo direto
e uniforme com fundo/tenant, não foi inventado um filtro em memória ou uma
inferência incompleta.

## Histórico operacional compartilhado

O card permanece compartilhado entre nota fiscal e operação e conserva textos,
ícones, categorias, ator, data e visibilidade.

Alterações:

- zero consulta enquanto o card está recolhido;
- primeira expansão consulta 21 e retorna 20;
- a contagem exata da primeira expansão vem na mesma consulta;
- páginas seguintes usam o cursor composto;
- eventos adicionados são deduplicados por ID;
- metadata continua passando pelo resumo visual existente, sem expor o objeto
  persistido integral.

A autorização explícita já existente foi mantida:

- `requireNotaFiscalAccess()` para nota fiscal;
- `requireOperationAccess()` para operação;
- fundo ativo autorizado para gestor quando aplicável;
- RLS pelo cliente autenticado.

## Notificações

### Infraestrutura comum

As quatro rotas agora são Server Components finos sobre
`NotificacoesPageServer`. A consulta:

- deriva usuário e perfil da sessão;
- filtra `usuario_id` no servidor;
- seleciona campos explícitos;
- usa ordem estável e cursor composto;
- retorna 20 de até 21 registros;
- aplica lida/não lida no banco;
- executa counts `head` separados para total e não lidas.

O usuário não é recebido do frontend como fonte de autorização. As actions de
marcar uma ou todas adicionam novamente `usuario_id = auth.uid()` à atualização.

### Realtime

Cada página e cada sino assinam somente:

```text
public.notificacoes
usuario_id = usuário autenticado
```

Comportamento:

- INSERT válido é colocado no topo e deduplicado por ID;
- UPDATE altera apenas um item já presente;
- DELETE remove apenas o item correspondente;
- páginas carregadas anteriormente são preservadas;
- nenhuma atualização chama `router.refresh()` ou busca a coleção completa;
- a inscrição é removida no unmount;
- payloads malformados são ignorados;
- contadores são atualizados incrementalmente e reconciliados por count após
  mutations quando necessário.

Marcar uma notificação é otimista. Marcar todas executa uma única atualização
por usuário, sem action por linha.

### Sino global

O sino continua limitado a dez itens. O loader consulta onze para manter o
contrato incremental, mas entrega no máximo dez. O contador de não lidas não é
mais derivado desses dez itens: usa count exato separado.

Foram removidos:

- `select("*")`;
- polling da lista a cada 30 segundos;
- cálculo incorreto do total de não lidas sobre a amostra;
- atualização direta no banco a partir do componente.

## Métricas estruturais antes e depois

As métricas abaixo descrevem quantidade de registros e requests. Não representam
ganho temporal medido em ambiente de homologação.

| Fluxo | Antes | Depois |
|---|---|---|
| Auditoria inicial | 1 query, 200 linhas e snapshots completos | 1 query, até 21 linhas compactas |
| Detalhe de auditoria | já estava em todas as linhas | 1 query somente ao expandir |
| Filtro de auditoria | aplicado sobre 200 itens no browser | aplicado no banco antes do limite |
| Histórico recolhido | 2 queries de resumo na montagem | 0 query |
| Primeira expansão | mais 1 query de eventos | 1 query com até 21 eventos e count |
| Notificações por rota | 1 coleção sem limite | até 21 linhas + 2 counts `head`, em paralelo |
| Carregar mais | inexistente/coleção já integral | 1 query com até 21 linhas |
| Sino | 10 linhas completas + polling a cada 30 s | até 11 linhas compactas + 2 counts, sem polling |
| Realtime | INSERT parcial e implementações duplicadas | INSERT/UPDATE/DELETE local e deduplicado |

Dados carregados e descartados antes:

- auditoria: snapshots completos de até 200 eventos recolhidos;
- notificações: toda a coleção para exibir apenas o filtro atual;
- sino: campos não usados de dez notificações a cada polling;
- histórico: resumo consultado em toda renderização, mesmo sem expansão.

## Índices e migrations

Foram avaliados os predicados finais:

```text
logs_auditoria
ORDER BY created_at DESC, id DESC

notificacoes
WHERE usuario_id = ?
[AND lida = ?]
ORDER BY created_at DESC, id DESC
```

O schema possui índices parciais ou simples relacionados, mas não foi possível
executar `EXPLAIN (ANALYZE, BUFFERS)` no banco de homologação conectado nesta
execução. Por isso, nenhum índice e nenhuma migration foram criados. Criar os
candidatos compostos sem plano real violaria a regra de evidência e aumentaria
o custo de escrita de feeds intensivos.

Próxima verificação recomendada em homologação:

1. medir os planos com volumes representativos;
2. comparar índices existentes;
3. criar migration incremental apenas se houver scan/custo comprovadamente
   inadequado;
4. repetir o plano após a criação.

## Testes

Foram adicionados testes para:

- filtro composto correto;
- timestamp com microssegundos;
- cursor e UUID inválidos;
- A/B na primeira página e C/D na segunda com timestamp igual;
- remoção do item-cursor entre páginas;
- inserção de novo item acima do cursor;
- contrato compacto e validação de payload realtime;
- deduplicação de notificações;
- filtros de leitura;
- redação recursiva de segredos;
- mascaramento de IPv4 e IPv6;
- auditoria sem `limit(200)`, `select("*")` ou Client Component principal;
- quatro rotas de notificação com a base Server compartilhada;
- autorização por usuário e campos explícitos;
- realtime sem recarga integral e com cleanup;
- histórico lazy com count na primeira consulta.

## Arquivos principais

- `src/lib/pagination/keyset.ts`: predicado composto compartilhado.
- `src/lib/auditoria/listagem.server.ts`: filtros, paginação e detalhe de
  auditoria.
- `src/lib/auditoria/privacy.ts`: mascaramento e redação.
- `src/components/auditoria/auditoria-list-client.tsx`: expansão e carregar
  mais.
- `src/lib/actions/historico.ts`: histórico autorizado e paginado.
- `src/components/historico/HistoricoTimelineCard.tsx`: expansão lazy.
- `src/lib/notificacoes/listagem.server.ts`: loader e counts compartilhados.
- `src/lib/actions/notificacoes-listagem.ts`: leitura e paginação autenticadas.
- `src/components/notificacoes/notificacoes-page-server.tsx`: entrada comum das
  quatro rotas.
- `src/components/notificacoes/notificacoes-page-client.tsx`: interação,
  realtime e paginação.
- `src/components/ui/notification-bell.tsx`: sino compacto.

## Riscos e pendências

- Planos reais e tempos server-side não foram medidos sem conexão ao banco de
  homologação; não é feita afirmação de ganho temporal.
- Históricos de versões de CNAB, integração, templates e política continuam
  antecipados e precisam de subescopo próprio.
- A segregação de auditoria continua dependendo da RLS/modelagem vigente porque
  a tabela não possui contexto de fundo uniforme.
- A validação manual multiusuário de eventos realtime exige duas sessões e
  Supabase Realtime habilitado no ambiente.

O Escopo 5 termina aqui. Nenhuma área funcional fora do escopo foi migrada e o
Escopo 6 não foi iniciado.
