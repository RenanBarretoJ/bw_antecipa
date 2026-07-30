# Relatório final da rota de performance

Data da homologação: 30/07/2026

Branch avaliada: `homolog`

Base inicial: `6f7d3b1`

Ambiente de banco: homologação

## 1. Resumo executivo

Os Escopos 0 a 7 estão presentes no código e os objetos de banco esperados dos
Escopos 2, 4, 6 e 7 já estavam materialmente instalados em homologação. O
histórico remoto de migrations estava incompleto, portanto a decisão de não
reaplicar esses quatro arquivos foi baseada na comparação das funções,
assinaturas, retornos, atributos de segurança, policies e grants reais.

A revisão encontrou uma exposição crítica não relacionada às fórmulas de
performance: `public.taxas_cedente` estava com RLS desabilitada e acessível por
`anon`, e as dez RPCs criadas na rota de performance ainda herdavam permissão de
execução anônima. Foi criada e aplicada uma migration incremental para:

- habilitar RLS em `taxas_cedente`;
- limitar as taxas ao próprio cedente ou aos fundos autorizados do gestor;
- remover acesso da role `anon`;
- remover execução `PUBLIC` e `anon` das RPCs de performance;
- manter execução para `authenticated`;
- recarregar o schema cache do PostgREST.

Também foi removido um N+1 residual no envio de notificações do cedente. A
persistência agora ocorre em lote, preservando deduplicação.

Os planos de execução medidos são satisfatórios para o pequeno volume atual de
homologação. Nenhum índice novo foi criado porque não houve benefício mensurável
que justificasse o custo de escrita e manutenção.

### Parecer

**NO-GO para produção neste fechamento.**

O código, a migration incremental e as consultas medidas não apresentam falha
crítica conhecida após o hardening. Porém, não há evidência suficiente para um
GO de produção porque:

1. não existem usuários/dados de homologação para completar os cenários de
   consultor, gestor sem acesso ao fundo e cedente com múltiplos vínculos;
2. o volume das tabelas é muito inferior aos cenários de mais de 40 registros
   pedidos para aferição representativa;
3. Realtime não foi exercitado com duas sessões de navegador;
4. TTFB, payload transferido, quantidade real de requests e React Profiler não
   foram medidos em navegador;
5. os advisors ainda apontam funções `SECURITY DEFINER` executáveis por
   `anon/authenticated`, além de outros débitos de RLS e performance fora do
   recorte desta correção;
6. falta executar a matriz funcional manual completa depois do deploy da
   aplicação que contém este fechamento.

O NO-GO deve ser reavaliado após o checklist da seção 18.

## 2. Inventário dos Escopos 0 a 7

| Escopo | Commit | Entregas principais | Banco | Evidência/testes |
|---|---|---|---|---|
| 0 | `237c9f2` | Tipos, helpers, cursores, offset e componentes compartilhados de paginação | Sem migration própria | `src/lib/pagination/pagination.test.ts` e documentação de paginação |
| 1 | `4e48799` | Operações, elegibilidade em lote, listagens, nova solicitação e aprovação | Sem migration própria | Testes de operações/elegibilidade e contratos de paginação |
| 2 | `b06f299` | Onboarding paginado e contexto carregado sob demanda | `20260729185443_performance_escopo2_onboarding_paginado.sql` | Testes da listagem de onboarding |
| 3 | `5bba6c8` | NFs e documentos do gestor, projeções compactas e aprovação em lote | Sem migration própria | Testes de listagem de NFs e documentos |
| 4 | `a84c294` | Portal do sacado: dashboard, NFs, aprovação e pagamentos | `20260729203749_performance_portal_sacado_dashboard.sql` | Testes de domínio, loaders e listagens do sacado |
| 5 | `bb9f8b1` | Auditoria, histórico, notificações incrementais, Realtime e sino | Sem migration própria | `src/lib/performance/escopo5.test.ts` e testes de cursores |
| 6 | `b5e6199` | Cedentes, escrow, movimentos e seletores | `20260730143000_performance_escopo6_escrow_rls.sql` | Testes e relatório do Escopo 6 |
| 7 | `5cdb867` | Dashboards, relatórios e agregações no PostgreSQL | `20260730152328_performance_escopo7_dashboards_relatorios.sql` | `src/lib/performance/escopo7.test.ts` |

Documentação preexistente:

- `docs/development/paginacao-e-cursores.md`;
- `docs/performance-escopo-1-operacoes-elegibilidade.md`;
- `docs/performance-escopo-2-onboarding-cedentes.md`;
- `docs/performance-escopo-3-notas-documentos-gestor.md`;
- `docs/performance-escopo-4-portal-sacado.md`;
- `docs/performance-escopo-5-auditoria-historicos-notificacoes.md`;
- `docs/performance-escopo-6-cedentes-escrow-seletores.md`;
- `docs/development/performance-escopo-7-dashboards-relatorios.md`.

## 3. Migrations

### Comparação local × remoto

| Migration | Resultado da comparação | Ação |
|---|---|---|
| `20260729185443_performance_escopo2_onboarding_paginado.sql` | RPC, assinatura e contrato encontrados | Não reaplicada |
| `20260729203749_performance_portal_sacado_dashboard.sql` | RPCs e contratos encontrados | Não reaplicada |
| `20260730143000_performance_escopo6_escrow_rls.sql` | RPC e policies esperadas encontradas | Não reaplicada |
| `20260730152328_performance_escopo7_dashboards_relatorios.sql` | Cinco RPCs, retornos e grants encontrados | Não reaplicada |
| `20260730170007_performance_escopo8_hardening_grants_rls.sql` | Nova correção incremental | Aplicada com sucesso |

O histórico remoto não era suficiente para concluir apenas pelo nome das
migrations. A validação foi material: `pg_proc`, `pg_policies`, atributos
`prosecdef`, `proconfig`, assinaturas, tipo de retorno e privilégios.

Após a aplicação do Escopo 8:

- a versão `20260730170007` foi registrada no histórico;
- o schema cache foi notificado;
- `anon` recebe `42501` ao consultar `taxas_cedente`;
- `authenticated` mantém o contrato necessário;
- as dez RPCs deixaram de ser executáveis por `anon`.

Não houve migration bloqueada.

## 4. RPCs validadas

Todas as funções abaixo existem, usam `SECURITY INVOKER`, possuem
`SET search_path = ''`, aceitam chamadas de `authenticated` e não aceitam
`PUBLIC/anon` após o hardening:

| Área | RPC | Retorno |
|---|---|---|
| Onboarding | `listar_onboarding_cedentes_paginado(uuid, integer, integer, text, text, text, uuid, text, text)` | `jsonb` |
| Sacado | `carregar_dashboard_sacado()` | `jsonb` |
| Sacado | `carregar_indicadores_nfs_sacado()` | `jsonb` |
| Sacado | `listar_cedentes_aprovacao_sacado()` | `table` |
| Documentos | `listar_documentos_atuais_cedente(uuid)` | `table` |
| Dashboard gestor | `dashboard_gestor_resumo(uuid)` | `jsonb` |
| Dashboard cedente | `dashboard_cedente_resumo(uuid)` | `jsonb` |
| Dashboard consultor | `dashboard_consultor_resumo()` | `jsonb` |
| Relatório gestor | `relatorio_gestor_analitico(uuid,text,text,text,uuid,date,date,integer,integer,text,text)` | `jsonb` |
| Relatório consultor | `relatorio_consultor_analitico(text,text,text,uuid,date,date,integer,integer,text,text)` | `jsonb` |

Os loaders TypeScript usam os mesmos nomes e parâmetros. O teste do Escopo 8
impede regressão dos grants.

## 5. RLS e isolamento

### Cenários executados com role `authenticated`

| Perfil | Cenário | Esperado | Resultado |
|---|---|---|---|
| Cedente A | Ler próprio cedente, vínculo, NFs, operações e escrow | Apenas dados próprios | Aprovado |
| Cedente A | Ler NFs do cedente B | Zero linhas | Aprovado |
| Cedente B | Ler taxas próprias | Apenas taxas do próprio vínculo | Aprovado: 2 próprias, 0 de outro cedente |
| Gestor | Ler taxas dos fundos autorizados | Apenas escopo autorizado | Aprovado: 3 taxas autorizadas |
| Sacado | Ler NFs pelo CNPJ autenticado | Contagem igual ao escopo do CNPJ | Aprovado: 22 de 22 |
| Anônimo | Ler `taxas_cedente` | Negado | Aprovado: `42501` |
| Anônimo | Executar RPCs de performance | Negado | Aprovado |

### Cenários bloqueados por falta de massa de homologação

- gestor sem acesso ao fundo: o único gestor disponível possui os dois fundos;
- consultores A/B com carteiras distintas: não existem perfis de consultor;
- cedente com múltiplos vínculos: não existe caso disponível;
- sacado inativo: não existe usuário representativo;
- volumes superiores a 40 registros nas tabelas críticas.

Esses bloqueios impedem declarar a matriz de RLS integralmente homologada.

### Advisors

O erro crítico de RLS desabilitada em `taxas_cedente` foi eliminado. Permanecem
alertas fora do escopo pequeno autorizado:

- funções `SECURITY DEFINER` executáveis por roles de aplicação;
- tabelas com RLS sem policy (`credenciais_integracao` e
  `seguranca_rate_limits`);
- proteção contra senhas vazadas ainda não habilitada no Auth;
- policies permissivas sobrepostas e chamadas de autenticação não encapsuladas
  em algumas policies;
- chaves estrangeiras sem índice e índices não utilizados a serem avaliados com
  volume de produção.

Esses alertas devem ser tratados em um escopo de hardening próprio, com testes
de autorização.

## 6. Rotas e homologação funcional

As 26 rotas solicitadas existem. Seus contratos, loaders e testes dos Escopos
0–7 foram revisados. Não foi executada navegação manual autenticada de toda a
matriz nesta sessão.

| Perfil | Rotas existentes e revisadas | Nível de evidência |
|---|---|---|
| Gestor | dashboard, operações, onboarding, NFs, documentos, cedentes, escrow, auditoria, notificações e relatórios | Estática, testes e RPCs; smoke manual pendente |
| Cedente | dashboard, NFs, operações, nova operação, extrato e notificações | Estática, testes e RPCs; smoke manual pendente |
| Consultor | dashboard, operações, escrow, notificações e relatórios | Estática; sem usuário para integração |
| Sacado | dashboard, NFs, aprovação, pagamentos e notificações | Estática, testes e RPCs; smoke manual pendente |

Autenticação, role, fundo ativo e vínculo continuam validados no servidor pelos
loaders/actions. Nenhuma regra de domínio foi alterada neste fechamento.

## 7. Paginação

### Offset

Os helpers centralizam:

- limites de 10, 20 e 40;
- normalização da página;
- `range` depois dos filtros;
- `count` exato;
- correção de página inexistente;
- ordenação determinística com `id`;
- preservação de filtros na URL;
- retorno à página 1 ao alterar filtro ou ordenação.

As listagens migradas não carregam a coleção inteira para paginar no cliente.
Os cenários estão cobertos em `src/lib/pagination/pagination.test.ts` e nos
testes dos loaders específicos.

### Cursor

Auditoria, histórico, notificações e movimentos usam cursor composto por
`createdAt + id`. Os testes cobrem timestamps iguais, páginas consecutivas,
ausência de duplicidade/omissão e cursor inválido. O contrato preserva o valor
textual do timestamp, inclusive microssegundos fornecidos pelo banco.

Concorrência real com inserção/remoção entre requests foi validada pelo domínio
e pelos testes, mas não por duas sessões simultâneas nesta homologação.

## 8. N+1, requests e renderização

### Correção realizada

`notificarCedente` fazia um `INSERT` por usuário com
`Promise.allSettled(userIds.map(async ...))`. Agora:

- monta um lote;
- usa um único `insert`;
- usa `upsert ... ignoreDuplicates` quando há chave de deduplicação;
- registra erro uma vez com a quantidade de destinatários.

O teste `src/lib/performance/escopo8.test.ts` impede o retorno do padrão N+1.

### Resultado da revisão

Não foram encontrados N+1 de listagem nas superfícies migradas de
elegibilidade, onboarding, NFs, documentos, sacado, auditoria, notificações,
escrow, dashboards e relatórios. Os `Promise.all` remanescentes combinam
consultas independentes e os loops de upload/mutação representam efeitos
individuais, não paginação de leitura.

Não há evidência de requests duplicados causada pelos loaders migrados. Os
`router.refresh()` encontrados ocorrem após mutações. O Strict Mode não foi
desabilitado.

Não há `prefetch={false}` pontual porque não foi obtida evidência de prefetch
caro no Network. Não foi feita alteração especulativa.

React Profiler não foi executado. Portanto, renders, tempo de interação e
recalculo de gráficos permanecem como homologação manual pendente.

## 9. `select("*")` residual

As listagens críticas migradas de onboarding, NFs, documentos, auditoria,
notificações, dashboards e relatórios usam projeções explícitas ou RPCs
compactas. Os próprios testes dos Escopos 2, 3, 5 e 7 verificam essa restrição.

Ocorrências remanescentes foram classificadas como:

- detalhes sob demanda de NF/operação/fundo;
- resolução integral de política, template ou CNAB;
- geração de PDF/CNAB;
- entidade pequena de perfil/autorização;
- módulos fora das superfícies migradas.

Não foi removida nenhuma ocorrência sem comprovar que o contrato integral era
desnecessário. Como dívida futura, a listagem geral de fundos e o shell de
perfil podem receber projeções explícitas em escopo próprio.

## 10. Payloads e URLs assinadas

As listagens migradas não retornam XML, DANFE, snapshots completos, histórico
completo, eventos completos, credenciais nem conteúdo de arquivo. Relações
aninhadas foram reduzidas aos campos exibidos.

URLs assinadas não são geradas em lote. As ações de visualização usam:

- 10 minutos para documentos do gestor;
- 10 minutos para NF do sacado;
- 1 hora no repositório documental v2.

As páginas de detalhe de NF ainda antecipam a assinatura do arquivo original ao
abrir o detalhe. Isso não afeta listagens, mas pode ser otimizado futuramente
para gerar a URL apenas ao clicar em visualizar.

Bytes HTTP reais não foram medidos sem uma sessão de navegador instrumentada.
Logo, a avaliação de payload é estrutural, não uma medição de rede.

## 11. Realtime

O código da página de notificações e do sino:

- filtra pelo usuário;
- possui cleanup da subscription;
- aplica atualização local;
- não executa reload integral;
- usa deduplicação por identificador/chave.

Não foi possível validar INSERT, UPDATE, DELETE, latência e isolamento com duas
sessões simultâneas. Este item permanece obrigatório antes do GO.

## 12. EXPLAIN (ANALYZE, BUFFERS)

Base medida:

- 2 cedentes;
- 2 operações;
- 4 vínculos operação × NF;
- 23 NFs;
- 22 documentos;
- 2 movimentos de escrow;
- 249 notificações;
- 124 logs de auditoria.

Todos os planos abaixo foram executados no banco de homologação. Não houve
leitura de disco, escrita, arquivo temporário ou spill.

| Consulta | Execução | Buffers hit | Linhas | Plano/observação |
|---|---:|---:|---:|---|
| Movimentos por conta e cursor | 0,171 ms | 7 | 1 | Seq scan aceitável com 2 linhas |
| Operações por vínculo | 0,174 ms | 8 | 1 | Seq scan aceitável com 2 linhas |
| Operação × NFs do fundo | 0,324 ms | 18 | 1 | PK/index scans e sort em memória |
| NFs por fundo/vínculo/status | 0,173 ms | 11 | 6 | Seq scan aceitável com 23 linhas |
| Documentos por fundo | 0,549 ms | 41 | 9 | `idx_documentos_cedente_id`; planning 0,891 ms |
| Notificações por usuário | 0,254 ms | 15 | 21 | `idx_notificacoes_usuario_id`; planning 0,824 ms |
| Auditoria por cursor | 0,245 ms | 15 | 21 | Seq scan de 124 linhas; planning 0,633 ms |
| Onboarding RPC, execução aquecida | 33,775 ms | 35 | Resultado paginado | Sem temp files |
| Dashboard gestor, aquecido | 9,933 ms | 98 | JSON compacto | Agregação no banco |
| Relatório gestor | 5,102 ms | 32 | JSON paginado | Agregação no banco |
| Dashboard sacado | 9,284 ms | 741 | JSON compacto | RLS autenticada |
| Indicadores sacado | 4,717 ms | 306 | JSON compacto | RLS autenticada |
| Dashboard cedente | 13,285 ms | 448 | JSON compacto | RLS autenticada |
| Documentos atuais do cedente | 1,023 ms | 77 | 7 | RPC autenticada |

As estimativas não indicaram desvio relevante no volume atual. O custo aparente
das policies representa parcela importante dos buffers nas RPCs autenticadas,
mas ainda dentro das metas.

## 13. Índices

### Criados

Nenhum.

### Candidatos rejeitados por falta de evidência

- `movimentos_escrow(conta_escrow_id, created_at DESC, id DESC)`;
- `operacoes_nfs(nota_fiscal_id, operacao_id)`;
- `notificacoes(usuario_id, created_at DESC, id DESC)`;
- `notificacoes(usuario_id, lida, created_at DESC, id DESC)`;
- `logs_auditoria(created_at DESC, id DESC)`;
- `logs_auditoria(entidade_tipo, entidade_id, created_at DESC, id DESC)`;
- `operacoes(cedente_fundo_id, created_at DESC, id DESC)`;
- `notas_fiscais(cedente_fundo_id, created_at DESC, id DESC)`.

Os planos atuais são submilissegundo nas tabelas pequenas. Criar índices agora
aumentaria custo de escrita sem ganho demonstrado. Reexecutar os EXPLAINs com
volume semelhante ao de produção antes de decidir.

## 14. Precisão financeira

O JSON de `dashboard_gestor_resumo` foi comparado, na mesma sessão autenticada,
com agregações SQL diretas para:

- total de cedentes;
- operações ativas;
- volume ativo;
- NFs pendentes.

Resultado: **paridade exata**, incluindo o zero numérico.

As fórmulas de bruto, líquido, receita e janelas UTC permanecem cobertas pelo
teste do Escopo 7 e não foram alteradas. A massa utilizada não contém operações
ativas no fundo medido (`volumeAtivo = 0`), portanto centavos, comissão, taxa
média, prazo médio e ticket médio ainda precisam de um golden dataset
financeiro representativo.

## 15. Matriz antes × depois

| Área | Antes | Depois | Medição | Status | Risco residual |
|---|---|---|---|---|---|
| Operações | Leituras e elegibilidade dispersas | Lote, paginação e contratos compactos | Consulta por vínculo 0,174 ms | Aprovado tecnicamente | Massa pequena |
| Onboarding | Contexto amplo | RPC paginada e contexto sob demanda | 33,775 ms | Aprovado tecnicamente | Sem mais de 40 linhas |
| NFs | Payload/listagem mais ampla | Projeções e resumo em lote | 0,173 ms | Aprovado tecnicamente | TTFB não medido |
| Documentos | Resumo e URLs acoplados | Projeção compacta, URL sob demanda | 0,549 ms | Aprovado tecnicamente | Detalhe ainda assina arquivo ao abrir |
| Sacado | Consultas fragmentadas | RPCs e loaders compactos | 4,717–9,284 ms | Aprovado tecnicamente | Usuário inativo não testado |
| Auditoria | Feed integral | Cursor composto | 0,245 ms | Aprovado tecnicamente | Índice só com volume maior |
| Notificações | Feed/reload e fanout individual | Cursor/Realtime e fanout em lote | 0,254 ms | Corrigido | Realtime em duas sessões pendente |
| Cedentes | Listas amplas | Paginação e seletores remotos | Testes estáticos | Aprovado tecnicamente | Smoke manual pendente |
| Escrow | Movimentos amplos | Cursor e RLS | 0,171 ms | Aprovado tecnicamente | Só 2 movimentos |
| Dashboards | Agregação na aplicação | Agregação no PostgreSQL | 9,933–13,285 ms | Aprovado tecnicamente | Perfil consultor ausente |
| Relatórios | Coleções amplas | Agregação e paginação no banco | 5,102 ms | Aprovado tecnicamente | Golden financeiro incompleto |
| Segurança das taxas | RLS desligada e acesso anônimo | RLS por vínculo/fundo | Negação `42501` | Corrigido | Policies permissivas globais a revisar |
| Grants das RPCs | Execução anônima herdada | Somente `authenticated` | 10/10 validadas | Corrigido | Advisors gerais pendentes |

## 16. Correções e arquivos do Escopo 8

- `supabase/migrations/20260730170007_performance_escopo8_hardening_grants_rls.sql`
  - RLS e policies de `taxas_cedente`;
  - grants das dez RPCs;
  - reload do schema cache.
- `src/lib/actions/notificacao.ts`
  - fanout de notificações em lote;
  - deduplicação por `upsert`.
- `src/lib/performance/escopo8.test.ts`
  - contrato de grants/RLS;
  - proteção contra retorno do N+1.
- `docs/performance/relatorio-final-rota-performance.md`
  - inventário, evidências, riscos e parecer.

Nenhuma funcionalidade, fórmula financeira, regra documental, policy
operacional, snapshot, CNAB, integração ou layout foi alterado.

### Validações técnicas finais

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | Aprovado |
| `npm test -- --run` | Aprovado: 63 arquivos e 433 testes |
| `npm run lint` | Aprovado sem erros; 6 warnings preexistentes de imports não utilizados |
| `git diff --check` | Aprovado; somente aviso de normalização LF/CRLF do Git no Windows |
| `npx next build --webpack` | Aprovado; 62 páginas estáticas/dinâmicas processadas |

O build mantém warnings preexistentes do `handlebars` sobre
`require.extensions` no webpack, com origem nos fluxos de templates e geração
de contratos. Não houve erro de compilação, TypeScript ou geração de páginas.

## 17. Rollback

### Deploy da aplicação

Reverter o commit do Escopo 8 restaura apenas o fanout individual de
notificações. A migration de segurança deve permanecer aplicada, pois a versão
anterior expõe taxas e RPCs a `anon`.

### Migration do Escopo 8

Rollback técnico, **não recomendado**:

1. remover as policies `taxas_cedente_cedente_select` e
   `taxas_cedente_gestor_all`;
2. restaurar os grants anteriores necessários à versão antiga;
3. somente desabilitar RLS se houver decisão formal de aceitar a exposição;
4. notificar o schema cache.

O rollback parcial dos grants pode tornar versões antigas do app incompatíveis
se elas chamarem RPCs sem sessão autenticada. Não restaurar acesso `anon` sem
incidente comprovado e aprovação de segurança.

### Migrations dos Escopos 2, 4, 6 e 7

Não executar `DROP FUNCTION` isolado enquanto os loaders atuais dependerem das
RPCs. O rollback deve ser feito em ordem inversa ao deploy da aplicação:

1. restaurar versão anterior compatível do app;
2. confirmar que ela não chama a RPC;
3. remover função/policy por migration incremental;
4. recarregar schema cache;
5. executar smoke test autenticado.

Nunca editar ou apagar as migrations já aplicadas.

## 18. Checklist de produção

### Banco e segurança

- [x] Comparar objetos locais e remotos.
- [x] Confirmar as RPCs dos Escopos 2, 4, 6 e 7.
- [x] Aplicar a migration incremental do Escopo 8.
- [x] Recarregar schema cache.
- [x] Validar grants das dez RPCs.
- [x] Bloquear acesso anônimo a `taxas_cedente`.
- [ ] Criar usuário gestor sem acesso ao fundo e executar teste negativo.
- [ ] Criar dois consultores com carteiras distintas e executar teste cruzado.
- [ ] Criar cedente com múltiplos vínculos.
- [ ] Validar sacado inativo.
- [ ] Revisar todas as funções `SECURITY DEFINER` apontadas pelos advisors.
- [ ] Definir policies para tabelas com RLS sem policy.
- [ ] Habilitar proteção de senha vazada no Supabase Auth.

### Dados e performance

- [ ] Preparar massa com mais de 40 registros por listagem crítica.
- [ ] Preparar golden dataset com centavos, nulos, zeros e todos os status.
- [ ] Reexecutar todos os EXPLAINs com volume representativo.
- [ ] Medir TTFB, requests e bytes no navegador.
- [ ] Executar React Profiler nas superfícies prioritárias.
- [ ] Reavaliar índices apenas com os novos planos.

### Aplicação

- [ ] Executar smoke test autenticado das 26 rotas.
- [ ] Validar offset 10/20/40 no navegador.
- [ ] Validar cursor com inserção e remoção concorrente.
- [ ] Testar ações simples e compostas contra as metas.
- [ ] Testar Realtime com duas sessões e dois usuários.
- [ ] Confirmar URLs assinadas, expiração e isolamento.
- [ ] Monitorar logs sem stacktrace ou dados sensíveis.

### Deploy e operação

- [ ] Backup do banco antes da janela.
- [ ] Confirmar variáveis do ambiente de produção.
- [ ] Aplicar migrations incrementais antes do deploy dependente.
- [ ] Confirmar PostgREST e Realtime após o deploy.
- [ ] Executar smoke tests imediatamente após a publicação.
- [ ] Monitorar latência, erros, conexões, bloat e cache hit.
- [ ] Configurar alertas para falhas de RPC, autorização e tempo de resposta.
- [ ] Manter plano de rollback da aplicação e migrations.

### Gate para reclassificação

O parecer pode mudar de **NO-GO** para **GO COM RESSALVAS** ou **GO** somente
quando a matriz autenticada, as rotas críticas, o Realtime e as medições em
volume representativo tiverem evidência registrada e não houver falha de
isolamento, build, precisão ou regressão funcional.
