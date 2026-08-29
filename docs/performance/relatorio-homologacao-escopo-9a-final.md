# Escopo 9A.3 — homologação operacional final e parecer de produção

**Data:** 31/07/2026

**Ambiente:** homologação

**Projeto Supabase:** `fhgkmggthxikfpogrvaa`

**Branch:** `homolog`

**Commit-base:** `db4ef876ed547de1f71346bcb2d85f2cafcc278d`
**Parecer:** **NO-GO**

## 1. Resumo executivo

O Escopo 9A.3 retomou a homologação sobre a massa PERF9A existente, sem recriar
dados, sem cleanup efetivo, sem editar migrations antigas e sem executar commit
ou push.

Os controles de isolamento permanecem aprovados: matriz RLS 50/50, Storage
19/19, smoke direcionado 9/9 e smoke completo 26/26. O build de produção e os
451 testes passaram. Nas 11 rotas medidas em build de produção local, o TTFB
mediano ficou entre 543 ms e 561 ms, abaixo das metas de 800 ms para listagens e
1 segundo para dashboards. Os nove casos offset automatizados não apresentaram
duplicidade entre páginas 1 e 2.

O parecer é NO-GO porque gates obrigatórios continuam sem aprovação:

- as ações críticas mutáveis não puderam ser executadas sem violar a exigência
  de restauração segura e preservação do histórico imutável;
- clique duplo, retry, concorrência e atomicidade operacional não foram
  demonstrados ponta a ponta;
- batch 1/10/50 NFs e ausência de N+1 não foram medidos de forma conclusiva;
- paginação por cursor não foi concluída no navegador;
- o Realtime visual com duas sessões ficou inconclusivo por timeout do protocolo
  do navegador antes da criação da fixture;
- o Profiler foi coletado, mas não cobriu troca de fundo, detalhe da NF e todos
  os cenários de interação previstos;
- LCP, ações e trocas de filtro/página não tiveram cobertura final completa;
- o golden permaneceu aprovado nos 11 indicadores anteriores, mas não foi
  ampliado para toda a matriz financeira solicitada;
- o histórico remoto contém 5 migrations, contra 73 arquivos locais, e não
  registra as versões 9B e 9C, embora seus objetos estejam materializados.

Não há fundamento para converter gates não executados em aprovação por
inferência.

## 2. Histórico 9A, 9B e 9C

- O 9A.2 identificou vazamento de Storage, falhas de cursor, erros 500 e
  inicialização incorreta do fundo ativo.
- O 9B corrigiu o isolamento multifundo e de carteira. A matriz final desta
  execução voltou a passar em 50 de 50 cenários com JWT real e AAL2.
- O 9C corrigiu a autorização de Storage, URLs assinadas, cursor e os erros 500.
  A matriz final de Storage passou em 19 de 19 cenários.
- O 9A.3 confirmou a estabilidade desses blocos e mediu produção local, mas não
  pôde aprovar os gates mutáveis e de promoção de schema.

## 3. Ambiente e pré-condições

| Item | Resultado |
|---|---|
| Ambiente | `homolog` |
| Projeto | `fhgkmggthxikfpogrvaa` |
| Branch | `homolog` |
| HEAD e merge-base de `origin/homolog` | `db4ef876...` |
| AAL2 | confirmado pelo verificador 9B |
| Backup lógico pré-teste | criado fora do repositório |
| Cleanup | somente dry-run |
| Credenciais no Git | nenhuma credencial material encontrada no escopo rastreável |
| Arquivo local do usuário | `testar_smtp_ionos.py` permaneceu intocado e não rastreado |

Snapshot lógico restrito:

`C:\Users\BrenoAlvim\AppData\Local\BWAntecipa\perf9a\backups\preload-fhgkmggthxikfpogrvaa-2026-07-31T15-14-16-774Z.json`

SHA-256: `f41911ef7606f872fcfd354b355df506c90bb3c4824faefb126710faf1f683c7`.

## 4. Volumes preservados

| Entidade | Quantidade |
|---|---:|
| Usuários Auth | 20 |
| Fundos | 2 |
| Cedentes | 180 |
| Vínculos cedente × fundo | 121 |
| Políticas | 2 |
| Operações | 250 |
| Notas fiscais | 1.000 |
| Documentos | 900 |
| Contas escrow | 80 |
| Movimentos escrow | 5.000 |
| Notificações | 4.500 |
| Auditoria | 1.000 |
| Eventos de domínio | 200 |

O status final reproduziu os mesmos volumes. Nenhum cleanup efetivo foi
executado.

## 5. RLS

Resultado: **APROVADO — 50/50**.

Foram validados gestor de fundo único, gestor multifundo, consultores por
carteira, cedentes, sacados, leituras adversárias, escritas adversárias e RPCs.
As sessões usaram JWT real e elevação TOTP para AAL2. Não houve uso de service
role para simular autorização de usuário.

Evidência final:

`C:\Users\BrenoAlvim\AppData\Local\BWAntecipa\perf9a\evidence\rls-escopo9b-fhgkmggthxikfpogrvaa-2026-07-31T15-47-14.276Z.json`

## 6. Storage

Resultado: **APROVADO — 19/19**.

Passaram os acessos positivos e negativos de gestor, gestor multifundo,
cedente, consultor e sacado, além de anonimato, path manipulado, traversal,
prefixo semelhante, objeto inexistente e expiração de URL assinada.

Evidência final:

`C:\Users\BrenoAlvim\AppData\Local\BWAntecipa\perf9a\evidence\storage-escopo9c-fhgkmggthxikfpogrvaa-2026-07-31T15-47-23.929Z.json`

## 7. Ações críticas mutáveis e restauração

Antes das ações foi construída a seguinte decisão de restauração:

| Ação | Registros afetados | Estado esperado | Restauração segura | Execução |
|---|---|---|---|---|
| Aprovar/rejeitar operação | operação, eventos, auditoria e notificações | transição de status | não há compensação oficial que preserve a trilha | não executada |
| Solicitar operação | operação, relações e snapshot | nova solicitação | exclusão direta violaria histórico | não executada |
| Desembolsar/liquidar | operação, escrow, logística e documentos | transição financeira | reversão direta é insegura | não executada |
| Aprovar/rejeitar NF ou documento | NF/documento, análise, eventos e auditoria | decisão imutável | não há ação inversa equivalente | não executada |
| Upload NF/CT-e/canhoto | Storage e várias tabelas | nova versão documental | compensação não cobre toda a trilha após análise | não executada |
| Vincular cedente/política | vínculo, política e auditoria | vínculo ativo | remoção direta não representa ação de domínio | não executada |
| Aprovar/contestar como sacado | aceite/contestação e eventos | manifestação jurídica | não reversível sem adulterar histórico | não executada |
| Marcar notificações | coluna `lida` | alteração reversível | snapshot e restauração exata possíveis | tentativa visual não alcançou a mutação |

As verificações adversárias 9B executaram somente escritas esperadas para serem
negadas e não deixaram linhas alteradas.

### Constatações estáticas de atomicidade

- solicitação, aprovação e desembolso usam RPCs atômicas em
  `src/lib/actions/operacao.ts`;
- `reprovarOperacao`, em `src/lib/actions/operacao.ts:552`, mantém fluxo
  multietapas fora de uma única RPC;
- `liquidarOperacao`, em `src/lib/actions/liquidacao.ts:14`, mantém atualizações
  e efeitos posteriores em várias etapas;
- `vincularPoliticaAoCedenteFundo`, em `src/lib/actions/politica.ts:492`, encerra
  vínculo e cria outro em etapas separadas.

Esses pontos exigem teste mutável específico antes da produção. Não foram
refatorados porque o 9A.3 não autoriza mudança de regra ou correção estrutural
sem reprodução operacional.

## 8. Clique duplo, retry e idempotência

Resultado: **NÃO APROVADO**.

Não foi possível disparar as transições críticas duas vezes e restaurá-las de
forma segura. A presença de RPCs atômicas em parte do fluxo reduz risco, mas não
substitui evidência de clique duplo, retry, timeout, duas abas e concorrência.

## 9. Batch e N+1

A massa contém os cenários necessários:

- 1 operação com 1 NF;
- 1 operação com 10 NFs;
- 1 operação com 50 NFs;
- 49 operações com 3 NFs;
- 198 operações com 4 NFs.

Os planos de banco e as páginas permaneceram funcionais, mas não houve medição
instrumentada de quantidade de queries/RPCs e efeitos de escrita nos lotes
1/10/50. Resultado: **INCONCLUSIVO**.

## 10. Paginação offset

Foram automatizadas nove listagens, com tamanhos 10, 20 e 40, páginas 1 e 2 e
página inválida:

- gestor/cedentes;
- gestor/onboarding-cedentes;
- gestor/notas-fiscais;
- gestor/documentos;
- gestor/operações;
- cedente/notas-fiscais;
- consultor/operações;
- relatórios gestor;
- relatórios consultor.

Todos os casos automatizados renderizaram sem 500 e sem interseção de IDs entre
páginas 1 e 2. A cobertura de busca, filtros, ordenação, volta do detalhe,
refresh e nova aba não foi concluída para todas as rotas. Resultado:
**APROVADO PARCIALMENTE**.

## 11. Paginação por cursor

Os testes unitários do cursor passaram e o smoke não reproduziu o erro 500 do
9A.2. Entretanto, a matriz completa no navegador — timestamp empatado,
microssegundos, cursor antigo/adulterado, inserção e remoção durante a paginação,
cliques rápidos e Realtime simultâneo — não foi executada integralmente.

Resultado: **NÃO APROVADO COMO GATE FINAL**.

## 12. Realtime visual

O teste direto de backend confirmou isolamento entre usuários. O teste visual
com duas sessões foi tentado em desenvolvimento e em build de produção, mas o
protocolo do navegador atingiu timeout durante o login, antes do INSERT da
fixture. Nenhuma notificação temporária foi criada e o bloco de restauração não
encontrou estado residual.

Resultado: **INCONCLUSIVO**. O backend aprovado não foi usado para inferir a
aprovação visual.

Evidência direta anterior:

`C:\Users\BrenoAlvim\AppData\Local\BWAntecipa\perf9a\evidence\realtime-escopo9a2-fhgkmggthxikfpogrvaa-2026-07-31T15-19-43.042Z.json`

## 13. React Profiler

O hook compatível com React DevTools coletou commits em oito rotas no servidor
de desenvolvimento:

| Rota | Commits | Duração acumulada | Maior commit |
|---|---:|---:|---:|
| cedente/operações/nova | 41 | 97,6 ms | 79,6 ms |
| gestor/onboarding | 31 | 70,8 ms | 62,5 ms |
| gestor/notas-fiscais | 28 | 64,3 ms | 52,9 ms |
| consultor/dashboard | 31 | 73,3 ms | 52,7 ms |
| gestor/escrow | 30 | 60,0 ms | 49,0 ms |
| gestor/notificações | 28 | 52,1 ms | 44,8 ms |
| gestor/relatórios | 31 | 32,1 ms | 25,1 ms |
| gestor/dashboard | 31 | 24,0 ms | 15,0 ms |

Não foram medidos detalhe da NF, troca de fundo e custo por componente abaixo da
raiz com precisão suficiente. Resultado: **COLETADO, MAS PARCIAL**.

Evidência:

`C:\Users\BrenoAlvim\AppData\Local\BWAntecipa\perf9a\evidence\react-profiler-escopo9a3-fhgkmggthxikfpogrvaa-2026-07-31T15-23-25.723Z.json`

## 14. Navegador e métricas finais

Metodologia: build Next.js de produção local, porta 3002, três repetições frias
e três aquecidas por rota, cache limpo antes da amostra fria. A instância criada
para o teste foi encerrada ao final.

| Rota — carga fria | TTFB mediano | Pior TTFB | Total mediano | Requests | Bytes medianos |
|---|---:|---:|---:|---:|---:|
| gestor/onboarding | 555 ms | 619 ms | 1.927 ms | 24 | 372.859 |
| gestor/notas-fiscais | 548 ms | 548 ms | 2.536 ms | 24 | 389.174 |
| gestor/cedentes | 551 ms | 567 ms | 1.904 ms | 25 | 385.275 |
| gestor/dashboard | 548 ms | 557 ms | 2.009 ms | 20 | 325.106 |
| gestor/relatórios | 557 ms | 558 ms | 1.911 ms | 22 | 334.519 |
| gestor/auditoria | 547 ms | 562 ms | 1.770 ms | 20 | 331.636 |
| cedente/notas-fiscais | 551 ms | 554 ms | 2.291 ms | 22 | 345.156 |
| cedente/operações/nova | 551 ms | 571 ms | 3.172 ms | 23 | 384.279 |
| consultor/dashboard | 549 ms | 609 ms | 1.754 ms | 19 | 321.735 |
| consultor/relatórios | 551 ms | 558 ms | 1.763 ms | 22 | 334.523 |
| sacado/dashboard | 543 ms | 559 ms | 2.090 ms | 19 | 321.732 |

Não houve erro de console nem request falha nas 66 amostras. O TTFB ficou
dentro da meta. O tempo total de `networkidle2` não representa LCP. LCP, ação,
troca de filtro e troca de página não tiveram cobertura final suficiente e
permanecem pendentes.

Evidência:

`C:\Users\BrenoAlvim\AppData\Local\BWAntecipa\perf9a\evidence\browser-final-escopo9a3-fhgkmggthxikfpogrvaa-2026-07-31T15-30-23.316Z.json`

## 15. Diagnóstico do TTFB

Os planos de banco ficaram abaixo de 100 ms, enquanto o TTFB de produção local
ficou próximo de 550 ms em todas as rotas. A uniformidade entre páginas e perfis
indica custo predominante no caminho comum — proxy/middleware, recuperação de
sessão, validação Auth/AAL2, perfil e rede Supabase — e não em uma query isolada.

Não foi adicionada instrumentação invasiva nem alterado middleware neste escopo.

## 16. EXPLAIN final

Foram executados 15 planos com `ANALYZE` e `BUFFERS` sobre a massa preservada.
Tempos observados:

- menor: auditoria por entidade, 0,019 ms;
- notificações por cursor: 0,542–1,014 ms;
- operações/NFs: 1,422–9,364 ms;
- auditoria geral: 19,856 ms, com `Seq Scan` e ordenação;
- onboarding RPC: 42,119 ms;
- dashboards: 17,992–97,466 ms;
- relatórios: 16,256–26,457 ms.

O plano de auditoria geral e a NF com `Seq Scan` continuam candidatos a
observação. Não houve evidência suficiente para criar ou remover índice.

Evidência:

`C:\Users\BrenoAlvim\AppData\Local\BWAntecipa\perf9a\evidence\explain-escopo9a2-fhgkmggthxikfpogrvaa-2026-07-31T15-19-35.334Z.json`

## 17. Índices do 9C

| Índice | Tamanho | Scans | Decisão |
|---|---:|---:|---|
| `idx_documento_versoes_storage_object` | 80 kB | 966 | manter |
| `idx_notas_fiscais_storage_path` | 96 kB | 2.390 | manter |
| `idx_documentos_storage_path` | 16 kB | 0 | manter em observação |
| `idx_documentos_gerados_storage_object` | 8 kB | 0 | manter em observação |
| `idx_remessas_cnab_storage_object` | 8 kB | 0 | manter em observação |
| `idx_retornos_integracao_storage_object` | 8 kB | 0 | manter em observação |

Os quatro índices sem scan são recentes e protegem caminhos de autorização com
baixa frequência na massa. Remoção imediata por `unused_index` seria prematura.
Nenhuma migration de índice foi criada.

## 18. Golden financeiro

Os 11 indicadores previamente cobertos passaram novamente em 11/11, incluindo
volume, receita, saldo escrow, NFs pendentes e entregas. O cálculo esperado foi
feito de forma independente das RPCs nesses indicadores.

Não foram adicionadas verificações suficientes para todos os dashboards,
relatórios, comissão, taxa/prazo/ticket médios, centavos, zeros, nulos e todos os
status. A inconsistência histórica entre card bruto e linha líquida do consultor
foi preservada, sem mudança de regra.

Resultado: **APROVADO NOS 11 INDICADORES; MATRIZ FINAL INCOMPLETA**.

Evidência:

`C:\Users\BrenoAlvim\AppData\Local\BWAntecipa\perf9a\evidence\golden-escopo9a2-fhgkmggthxikfpogrvaa-2026-07-31T15-19-17.351Z.json`

## 19. Histórico de migrations

O repositório contém **73** migrations locais. O histórico remoto retornado pelo
Supabase contém somente:

- `003_storage_buckets_env`;
- `004_aceite_sacado_em`;
- `005_testemunhas`;
- `006_documentos_assinados`;
- `20260730170007_performance_escopo8_hardening_grants_rls`.

| Escopo | Migration local relevante | Histórico remoto | Objetos presentes | Situação |
|---|---|---|---|---|
| 2 | `20260721123935_fase2_nucleo_multifundo_politicas_snapshot.sql` | ausente | tabelas de fundo, vínculo e políticas presentes | materializada sem histórico |
| 4 | migrations de roteamento e aceite | ausentes | colunas/RPCs usadas pelo fluxo estão presentes | materialização parcial a inventariar |
| 6 | `20260721190904_fase6_templates_juridicos_fundo.sql` | ausente | `templates_documentos`, `template_versoes` e gerados presentes | materializada sem histórico |
| 7 | `20260721194546_fase7_cnab_configuravel_rastreavel.sql` | ausente | CNAB e integrações por fundo presentes | materializada sem histórico |
| 8 | `20260730170007_performance_escopo8_hardening_grants_rls.sql` | presente | objetos presentes | consistente no recorte |
| 9B | três migrations `20260730...` | ausentes | policies/helpers passam em 50/50 | materializada sem histórico |
| 9C | `20260731140710_escopo9c_storage_autorizacao_multifundo.sql` | ausente | seis índices e helper privado presentes | materializada sem histórico |

Há ambiguidade material entre histórico e schema. Nenhum `migration repair` foi
executado.

Plano seguro para o próximo ambiente:

1. backup lógico e físico apropriado;
2. inventário completo de cada migration e checksum;
3. comparação objeto a objeto no catálogo;
4. marcar como aplicada somente a versão comprovadamente equivalente;
5. aplicar apenas migrations realmente ausentes;
6. validar constraints, triggers, grants, RLS e schema cache;
7. repetir 9B, 9C, smoke e golden.

Até essa reconciliação, promoção é bloqueada.

## 20. Logs e observabilidade

- Auth: amostra consultada com respostas `/user` 200;
- Realtime: criação/encerramento normal de slots e tenant sem usuários;
- Storage: requisições de listagem e remoção das fixtures de teste com 200;
- Postgres: checkpoints normais e um `unexpected EOF on standby connection`, sem
  associação comprovada a erro funcional;
- API/PostgREST: a consulta de logs retornou falha do provedor e ficou parcial;
- nenhum token, cookie, senha ou URL assinada completa foi incluído neste
  relatório;
- a varredura do repositório encontrou somente referências/placeholder de
  conexão em `install-reset-operacional-rpc.mjs` e no manual de reset, sem valor
  material.

Advisors no momento da execução:

- segurança: 71 achados — 69 `WARN`, 2 `INFO`;
- performance: 272 achados — 178 `WARN`, 94 `INFO`;
- principais grupos: 165 policies permissivas múltiplas, 67 FKs sem índice, 26
  índices sem uso observado e 13 `auth_rls_initplan`.

Os números exigem triagem própria; não foram corrigidos em massa no 9A.3.

## 21. Correções e arquivos desta execução

Não houve alteração de funcionalidade, domínio, banco, RLS, fórmula ou layout.
Foram adicionados apenas harnesses de evidência:

- `scripts/perf9a/browser-final-homolog.mjs`;
- `scripts/perf9a/react-profiler-final-homolog.mjs`;
- `scripts/perf9a/realtime-visual-final-homolog.mjs`;
- este relatório.

Os relatórios históricos receberam somente link para este documento. Não foi
criada migration.

## 22. Validações finais

| Validação | Resultado |
|---|---|
| `node --check scripts/perf9a/*.mjs` | passou |
| `npx tsc --noEmit` | passou |
| `npm test -- --run` | 68 arquivos, 451 testes aprovados |
| `npm run lint` | 0 erros, 6 warnings preexistentes |
| `git diff --check` | passou; apenas avisos de conversão LF/CRLF |
| `npx next build --webpack` | passou, 62 rotas; warnings Handlebars |
| `perf9a:status` | passou; volumes preservados |
| `perf9b:verify` | 50/50 |
| `perf9c:storage` | 19/19 |
| `perf9c:smoke` | 9/9 |
| smoke completo | 26/26, zero 500 |
| cleanup | dry-run, nenhuma remoção |
| secret scan | sem segredo material no escopo rastreável |

## 23. Riscos residuais

1. ações críticas e concorrência não homologadas;
2. fluxos multietapas sem evidência transacional completa;
3. cursor e Realtime visual incompletos;
4. cobertura Profiler e LCP parcial;
5. golden financeiro não ampliado para toda a matriz;
6. logs PostgREST indisponíveis na consulta final;
7. histórico remoto de migrations materialmente incompleto;
8. advisors de segurança e performance ainda sem triagem individual.

## 24. Rollback e massa

Nenhuma mudança de aplicação ou banco foi aplicada pelo 9A.3, portanto não há
rollback de produto. A instância local de produção na porta 3002 foi encerrada.
Fixtures temporárias dos testes anteriores foram removidas pelos próprios
harnesses; as tentativas visuais falharam antes do INSERT.

A massa PERF9A **deve permanecer** em homologação. Ela ainda é necessária para
os gates mutáveis, cursor, Realtime visual, batch/N+1 e golden ampliado. Quando
esses gates forem concluídos, o cleanup deve ser executado somente com a
confirmação explícita prevista no script.

## 25. Parecer final

**NO-GO para produção.**

RLS, Storage, smoke, testes, build, TTFB e os 11 indicadores financeiros
cobertos estão aprovados. Isso demonstra uma base significativamente mais
estável após 9B e 9C, mas não satisfaz o conjunto de critérios do 9A.3.

Os bloqueadores de promoção são:

- gates operacionais obrigatórios não executados;
- Realtime visual e cursor sem aprovação final;
- golden ampliado incompleto;
- histórico remoto de migrations materialmente ambíguo.

Não foi executado commit nem push.
