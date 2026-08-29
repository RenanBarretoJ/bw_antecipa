# Métodos de cálculo financeiro por política operacional

## 1. Objetivo e parecer executivo

Esta implementação permite selecionar, em cada nova versão da política operacional do fundo, o método financeiro aplicado às novas operações: dias úteis/252, 30/360 ou dias corridos/365. A taxa permanece mensal e única por operação, enquanto prazo, fator, valor presente e desconto são calculados individualmente por nota fiscal.

O método passa a integrar o snapshot imutável da operação. Na aprovação, o banco recalcula e persiste atomicamente o resultado usando a data civil do servidor em `America/Sao_Paulo`; o navegador não envia nem decide o valor líquido. Operações antigas não são recalculadas e, quando não possuem método explícito, são interpretadas pelo método legado.

Parecer: a arquitetura de código está preparada para os três novos métodos e para compatibilidade histórica. As migrations base e de correção da ambiguidade foram aplicadas em homologação pelo responsável do ambiente e a aprovação foi confirmada funcional. A auditoria final acrescentou uma migration incremental de endurecimento, ainda não aplicada, para recusar segunda aprovação, bloquear aprovação direta da tabela e remover um índice redundante.

## 2. Diagnóstico do fluxo anterior

Antes desta mudança, o cálculo estava concentrado parcialmente em `src/lib/operacoes/calculo.ts`, porém dependia de `agoraMs` fornecido pelo chamador e utilizava `Date` local. Para cada NF:

```text
dias = max(1, ceil((vencimento - agora) / 1 dia))
taxa = primeira faixa que cobre os dias, ou 0%
fator = (1 + taxa_mensal) ^ (dias / 30)
valor líquido = arredondar(valor bruto / fator, 2)
```

As principais fragilidades eram:

- ausência de método financeiro versionado na política;
- taxa `0%` assumida silenciosamente quando não havia faixa;
- `max(1, dias)` mascarando NF vencida ou prazo zero;
- data-base influenciada pelo navegador;
- duplicação de cálculo entre simulação e aprovação;
- aprovação recebendo valor líquido do cliente;
- ausência de memória individual e imutável por NF.

A taxa já era configurada no fluxo canônico `taxas_cedente`, por faixas `prazo_min`, `prazo_max` e `taxa_percentual`. Esse catálogo foi preservado. Liquidação, relatórios e documentos históricos continuam consumindo os valores persistidos, sem recálculo retroativo.

## 3. Arquitetura antes e depois

Antes:

```text
NFs selecionadas
  ↓
Data/hora fornecida pelo chamador
  ↓
Faixa por NF ou fallback 0%
  ↓
Fórmula dias reais / 30
  ↓
Cliente envia taxa e valor líquido à aprovação
```

Depois:

```text
Fundo
  ↓
Versão publicada da política + método financeiro
  ↓
Snapshot da operação
  ↓
Solicitação: simulação no domínio compartilhado com data do servidor
  ↓
Aprovação: RPC bloqueia operação/NFs e resolve a taxa canônica
  ↓
Recalcula cada NF com data da aprovação
  ↓
Persiste operação + memória por NF + auditoria atomicamente
```

## 4. Métodos canônicos

| Código | Exibição | Unidade do prazo | Fórmula do expoente |
|---|---|---|---|
| `LEGADO_MENSAL_DIAS_REAIS_30` | Legado — dias reais / 30 | dias civis reais | `dias / 30` |
| `DIAS_UTEIS_252` | 252 — Dias úteis | dias úteis ANBIMA | `dias_uteis / 21` |
| `TRINTA_360` | 360 — 30/360, mês financeiro | dias financeiros | `dias_30_360 / 30` |
| `DIAS_CORRIDOS_365` | 365 — Dias corridos | dias civis reais | `12 × dias / 365` |

Em todos os métodos:

```text
fator = (1 + taxa_mensal_decimal) ^ expoente
valor_presente = valor_nominal / fator
desconto = valor_nominal - valor_presente
```

A data-base é excluída e a data final é incluída. NF cujo vencimento contratual seja anterior à data-base é inelegível. Vencimento no próprio dia produz prazo financeiro zero; não é convertido artificialmente em um dia.

### 4.1 Método legado

O legado preserva a fórmula anterior de dias civis reais divididos por 30. Ele não aparece como opção de novas políticas. Campo ausente ou `null` em política/snapshot/operação histórica resolve explicitamente para `LEGADO_MENSAL_DIAS_REAIS_30`; código desconhecido gera erro e não cai silenciosamente no legado.

### 4.2 Dias úteis/252 e calendário ANBIMA

O método conta dias úteis no intervalo `(data-base, vencimento ajustado]`, com 21 dias úteis por mês. Sábados, domingos e feriados do calendário nacional ANBIMA não contam. Se o vencimento contratual não for útil, apenas o vencimento usado no cálculo avança até o próximo dia útil; a NF mantém a data contratual original.

O calendário é materializado por ano e mantido em cache. Inclui feriados fixos e móveis calculados a partir da Páscoa. A relação nacional inclui 20 de novembro a partir de 2024, conforme atualização informada pela ANBIMA. Fontes de conferência:

- [Calendário de feriados ANBIMA 2026](https://www.anbima.com.br/feriados/fer_nacionais/2026.asp)
- [Consulta de feriados ANBIMA](https://www.anbima.com.br/feriados/feriados.asp)
- [Inclusão do Dia da Consciência Negra no calendário nacional](https://www.anbima.com.br/pt_br/noticias/novo-feriado-nacional-sancao-do-dia-da-consciencia-negra-impactara-precificacao-do-mercado.htm)

### 4.3 Convenção 30/360

A convenção determinística adotada é `DIA_MIN_30`:

```text
dia_inicial = min(dia inicial, 30)
dia_final = min(dia final, 30)
dias = 360 × Δano + 30 × Δmês + (dia_final - dia_inicial)
```

Ela é aplicada igualmente em fevereiro, ano bissexto, dias 30/31 e viradas de mês/ano.

### 4.4 Dias corridos/365

Conta dias civis reais em `(data-base, vencimento]`. Finais de semana e feriados contam. A base é sempre 365, inclusive quando o intervalo atravessa 29 de fevereiro; não é ACT/ACT e não há ajuste de vencimento.

## 5. Referência estudada no SC1 Order Processing

Foram analisados, somente em leitura:

- `src/lib/holidays/anbima.ts` — calendário, cálculo de feriados móveis, cache e contagem excluindo início/incluindo fim;
- `src/modules/acordo/present-value-allocation.ts` — alocação de valor presente e arredondamento por item;
- `src/modules/acordo/implicit-rate.solver.ts` — cálculo/solução de taxa;
- testes de taxa implícita e calendário em `src/modules/acordo/__tests__`.

Foi portada a regra funcional de datas civis em UTC, cache por ano, exclusão da data-base, inclusão do vencimento e ajuste ao próximo dia útil. O BW Antecipa permanece autocontido e não possui dependência de runtime com o SC1. A adaptação relevante foi incluir 20/11 no calendário nacional a partir de 2024, ausente na lista simplificada estudada no SC1.

## 6. Data-base e fuso

`src/lib/operacoes/data-operacional.server.ts` é o helper canônico. Ele gera `YYYY-MM-DD` no servidor usando `America/Sao_Paulo`.

- solicitação/simulação: data civil no instante da solicitação;
- aprovação: nova data civil obtida no instante da aprovação;
- a data não é aceita livremente do navegador;
- a aprovação persiste `calculo_data_base`.

Datas financeiras são interpretadas como datas civis com `Date.UTC`, evitando deslocamento por fuso ou horário de verão no cálculo de intervalos.

## 7. Taxa mensal única

A fonte canônica continua sendo `taxas_cedente`. O prazo de referência é o maior prazo individual, na unidade do método. A primeira faixa ordenada por `prazo_min` e `prazo_max` que cobre esse prazo fornece uma única `taxa_percentual` para todas as NFs.

Taxa zero é válida somente quando existe explicitamente no catálogo. Sem faixa:

- o cedente pode criar a solicitação;
- taxa e valor líquido permanecem `null` e são apresentados como pendentes;
- a operação não recebe líquido igual ao bruto;
- o gestor não consegue aprovar;
- após configurar a faixa canônica, deve recarregar a operação e selecionar a taxa disponível.

## 8. Precisão, arredondamento e totais

O domínio TypeScript usa `decimal.js`. A regra é `ROUND_HALF_UP`:

1. calcular fator e valor presente de cada NF;
2. arredondar o valor presente individual para duas casas;
3. calcular o desconto individual sobre esse valor arredondado;
4. somar os valores individuais arredondados com `Decimal`;
5. calcular prazo médio ponderado pelo valor nominal e arredondar para inteiro com `ROUND_HALF_UP`.

A RPC reproduz a mesma regra com `numeric` e `round(..., 2)`. A taxa média aprovada é a própria taxa única da operação. O vencimento máximo continua sendo a maior data contratual.

## 9. Política e snapshot

`politica_operacional_versoes.metodo_calculo_financeiro` recebe um dos três novos métodos. Rascunhos podem permanecer incompletos, mas a publicação de uma nova versão exige método. Versões antigas publicadas com `null` continuam válidas pelo fallback legado e não sofrem backfill.

Criação, duplicação, revisão, detalhes e histórico transportam/exibem o método. O snapshot da operação registra em `calculo_financeiro`:

- código e descrição do método;
- base e unidade de contagem;
- periodicidade mensal;
- divisor mensal, quando aplicável;
- calendário ANBIMA para 252;
- convenção `DIA_MIN_30` para 360;
- versão do motor;
- regra de arredondamento.

O método congelado da operação não pode ser alterado depois da criação.

## 10. Aprovação e proteção contra adulteração

A interface do gestor envia somente `operacaoId` e a taxa selecionada no catálogo. Não existe campo editável de valor líquido. A RPC `aprovar_operacao_atomica(uuid, numeric)`:

1. autentica e valida papel gestor;
2. valida acesso ao fundo da operação;
3. bloqueia a operação e NFs (`FOR UPDATE`);
4. exige estado aprovável e contexto financeiro congelado;
5. revalida NF, vínculo, vencimento e taxa configurada aplicável;
6. calcula cada NF no banco com a data da aprovação;
7. persiste valores por NF, totais, memória e status;
8. registra auditoria na mesma transação.

A assinatura antiga que recebia valor líquido é revogada. Trigger de proteção impede alteração direta do método/data e dos resultados aprovados fora do contexto interno da RPC. Aprovação concorrente é serializada pelo bloqueio da linha e pela validação de status.

## 11. Memória de cálculo

A tabela `operacao_calculo_nfs` registra uma linha por operação/NF:

- IDs da operação, NF, fundo e cedente;
- método, taxa mensal e data-base;
- vencimento contratual e vencimento usado no cálculo;
- dias reais, úteis e 30/360, conforme aplicável;
- prazo aplicado, expoente e fator;
- valor nominal, valor presente e desconto;
- arredondamento e versão do motor;
- data de criação.

`UNIQUE (operacao_id, nota_fiscal_id)` impede duplicidade. FKs preservam o histórico financeiro e RLS permite leitura ao gestor autorizado no fundo e ao cedente proprietário. Escrita não é concedida aos clientes autenticados; ocorre dentro da RPC.

A operação também preserva `metodo_calculo_financeiro`, `calculo_data_base`, `calculo_versao_motor` e `calculo_memoria`, com totais e comparação entre prévia e aprovação.

## 12. Migrations

Arquivos:

- `supabase/migrations/20260805160000_metodos_calculo_financeiro_operacao.sql`;
- `supabase/migrations/20260805170000_corrigir_ambiguidade_valor_bruto_aprovacao.sql`;
- `supabase/migrations/20260805180000_endurecer_aprovacao_financeira.sql`.

Ela:

- adiciona método à versão da política;
- adiciona contexto e memória à operação;
- torna taxa e líquido da operação anuláveis para solicitações sem taxa;
- cria `operacao_calculo_nfs`, índices e RLS;
- cria helpers privados de calendário e cálculo;
- congela o contexto de novas operações por trigger;
- protege resultados financeiros aprovados;
- atualiza a validação de publicação da política;
- substitui a RPC de aprovação por uma versão server-side e atômica;
- revoga a assinatura anterior que aceitava líquido;
- não executa `UPDATE` financeiro em massa e não recalcula histórico.

Estado do banco nesta auditoria: o responsável do ambiente confirmou a aplicação das migrations `1600` e `1700` em homologação e o fluxo de aprovação passou após a correção da variável ambígua. A migration `1800`, criada na auditoria, não foi aplicada remotamente. O conector Supabase respondeu como não conectado e o projeto não mantém Supabase local; por isso o schema remoto não foi modificado nem inspecionado por DDL nesta etapa. A validação integrada não destrutiva foi feita pelas suítes PERF9B/AAL2 usando as credenciais sintéticas já configuradas para homologação.

## 13. Compatibilidade histórica

- nenhuma operação ou NF existente é atualizada pela migration;
- valores persistidos continuam sendo a fonte de relatórios, liquidação e documentos históricos;
- método ausente é interpretado como legado somente quando necessário;
- políticas antigas publicadas sem método continuam válidas;
- o método legado não pode ser selecionado em novas versões;
- não houve alteração automática de textos jurídicos, pois não foi identificado campo confirmado para o método nos templates atuais.

## 14. Segurança multifundo

A resolução parte das NFs e do vínculo `cedente_fundo` congelado. A política deve pertencer ao mesmo fundo e vínculo. A aprovação valida o fundo autorizado do gestor, taxa do cedente, método do snapshot e contexto das NFs no servidor. RLS protege a memória individual. Cliente não consegue substituir método, data-base, prazo, calendário, fator ou líquido.

## 15. Testes e homologação

Testes unitários cobrem:

- legado em intervalos civis e fallback explícito;
- 252 em dias úteis, fins de semana, feriados, próximo dia útil e virada de ano;
- 30/360 em fevereiro, 29/02, dias 30/31 e viradas;
- 365 com um dia, 365 dias, 29/02, sábado e feriado;
- NF vencida, taxa ausente, taxa zero explícita e método inválido;
- múltiplas NFs, taxa única, prazo ponderado e soma após arredondamento individual;
- snapshot da política;
- contrato estático da migration, RLS, RPC e ausência de atualização financeira em massa.

Checklist de homologação antes de produção:

- [ ] aplicar a migration primeiro em homologação;
- [ ] validar policies e grants com usuários gestor e cedente de fundos distintos;
- [ ] criar/publicar uma política de cada método;
- [ ] confirmar bloqueio de publicação sem método;
- [ ] solicitar com e sem faixa de taxa;
- [ ] confirmar taxa zero apenas quando cadastrada explicitamente;
- [ ] comparar manualmente uma NF e uma operação com várias NFs por método;
- [ ] validar sábado, domingo, feriado ANBIMA e virada do dia em São Paulo;
- [ ] testar aprovação concorrente e repetida;
- [ ] confirmar que payload adulterado não define o líquido;
- [ ] validar memória por NF e RLS cruzada;
- [ ] comparar operação histórica antes/depois da migration;
- [ ] executar regressão de documentos, relatórios, liquidação e exportações;
- [ ] validar rollback de aplicação sem remover colunas/memórias.

## 16. Riscos residuais

- A migration incremental `20260805180000_endurecer_aprovacao_financeira.sql` ainda precisa ser aplicada e validada em homologação antes de disponibilizar esta revisão da aplicação.
- O calendário é algorítmico e deve ser conferido anualmente contra a publicação oficial da ANBIMA, especialmente em caso de feriado extraordinário.
- TypeScript e PostgreSQL usam motores matemáticos diferentes; os golden cases de homologação devem confirmar equivalência centavo a centavo.
- Testes integrados reais de RLS, concorrência, MFA e múltiplos fundos dependem do banco remoto configurado.
- Documentos jurídicos não exibem o método até existir campo/requisito formal nos templates.

## 17. Rollback seguro

Se for necessário reverter a aplicação:

1. interromper a publicação de novas políticas com os métodos novos;
2. reverter a interface e o domínio por versão de aplicação compatível;
3. preservar colunas e linhas de memória já gravadas;
4. não recalcular nem apagar operações aprovadas;
5. manter leitura histórica pelos valores persistidos;
6. corrigir banco apenas por migration incremental, nunca editando a migration aplicada;
7. não remover a proteção da RPC enquanto existirem operações criadas com os novos métodos.

Esse rollback é de aplicação e criação de novos dados; não é seguro apagar memória financeira já usada em aprovação.

## 18. Auditoria final de escopo e regressão — 05/08/2026

### 18.1 Estado inicial e referência Git

- branch auditada: `homolog`;
- HEAD inicial: `ab2a73f`;
- referência: `origin/homolog`;
- divergência inicial após `git fetch origin`: `0` commits locais e `0` remotos;
- alterações de permissão ou renomeações: nenhuma;
- arquivos removidos: nenhum;
- migrations remotas aplicadas pela auditoria: nenhuma;
- `migration repair`, merge, tag, release ou ação em `main`: não executados.

### 18.2 Classificação integral dos arquivos

As categorias seguem o roteiro da auditoria. Não foram encontradas mudanças das categorias D ou E.

| Arquivo | Tipo | Categoria | Justificativa | Commit |
|---|---|---:|---|---:|
| `package.json` | Dependência | A | Adiciona `decimal.js` para cálculo decimal determinístico. | Sim |
| `package-lock.json` | Lockfile | A | Congela a dependência financeira adicionada. | Sim |
| `src/lib/operacoes/calculo.ts` | Domínio | A | Implementa legado, 252, 30/360, 365, arredondamento e agregação por NF. | Sim |
| `src/lib/operacoes/data-operacional.server.ts` | Domínio server-side | A | Resolve a data civil operacional em São Paulo no servidor. | Sim |
| `src/lib/operacoes/politica.ts` | Domínio | A | Normaliza e expõe o método versionado da política. | Sim |
| `src/lib/operacoes/elegibilidade.ts` | Contrato | A | Preserva nulabilidade financeira antes da aprovação. | Sim |
| `src/lib/operacoes/nova-solicitacao.server.ts` | Aplicação | A | Simula a solicitação com política e data-base do servidor. | Sim |
| `src/lib/actions/operacao.ts` | Aplicação | A | Solicitação sem taxa, aprovação autoritativa e taxa canônica. | Sim |
| `src/lib/actions/politica.ts` | Aplicação | A | Persiste o método em rascunhos e publicações. | Sim |
| `src/lib/operacoes/cedente-detalhe.ts` | Loader | A | Trata campos financeiros históricos anuláveis. | Sim |
| `src/lib/operacoes/listagem.server.ts` | Loader | A | Propaga nulabilidade na listagem sem coerção para zero. | Sim |
| `src/lib/operacoes/listagem.ts` | Contrato | A | Tipos de listagem compatíveis com taxa/líquido pendentes. | Sim |
| `src/types/database.ts` | Tipos | A | Atualiza schema tipado da política, operação e memória por NF. | Sim |
| `src/app/cedente/operacoes/nova/nova-solicitacao-client.tsx` | UI | A | Exibe estimativa ou estado pendente, sem fórmula cliente. | Sim |
| `src/app/cedente/operacoes/[id]/page.tsx` | UI | A | Exibe campos anuláveis e método congelado com segurança. | Sim |
| `src/app/gestor/operacoes/[id]/page.tsx` | UI server-side | A | Fornece data-base calculada pelo servidor. | Sim |
| `src/app/gestor/operacoes/[id]/OperacaoDetalheGestorClient.tsx` | UI | A | Simulação, seleção de taxa canônica e resultado somente leitura. | Sim |
| `src/components/operacoes/OperacoesPaginadas.tsx` | UI | A | Evita apresentar `NULL` como cálculo financeiro válido. | Sim |
| `src/components/politicas/PoliticasDoFundo.tsx` | UI | A | Seleção e consulta do método por versão da política. | Sim |
| `supabase/migrations/20260805160000_metodos_calculo_financeiro_operacao.sql` | Persistência | A | Schema, snapshot, memória, RLS, helpers, triggers e RPC atômica. | Sim |
| `supabase/migrations/20260805170000_corrigir_ambiguidade_valor_bruto_aprovacao.sql` | Persistência | B | Corrige colisão PL/pgSQL sem mudar a regra financeira. | Sim |
| `supabase/migrations/20260805180000_endurecer_aprovacao_financeira.sql` | Persistência | B | Fecha bypass de aprovação direta/repetida e remove índice redundante. | Sim |
| `src/lib/operacoes/calculo.test.ts` | Testes | B | Golden cases e regressões dos quatro métodos. | Sim |
| `src/lib/operacoes/politica.test.ts` | Testes | B | Regressão do snapshot e fallback legado. | Sim |
| `src/lib/operacoes/calculo-financeiro.migration.test.ts` | Testes | B | Contrato estático de migration, RLS, atomicidade e hardening. | Sim |
| `docs/financeiro/relatorio-metodos-calculo-operacao.md` | Documentação | C | Documento técnico e evidências desta auditoria. | Sim |

Arquivos excluídos do commit por pertencerem a outro escopo: nenhum. Nenhuma alteração desconhecida foi descartada.

### 18.3 Chamadores e contratos revisados

| Chamador | Fluxo | Impacto esperado | Impacto observado | Regressão |
|---|---|---|---|---:|
| Nova solicitação do cedente | Simulação e criação | Método da política; taxa opcional; data do servidor | Sem taxa mantém taxa e líquido `NULL`; payload não escolhe método | Não |
| Detalhe da operação do cedente | Consulta histórica | Exibir cálculo congelado ou pendente | `NULL` não vira `0%` nem `R$ 0,00` | Não |
| Detalhe da operação do gestor | Simulação e aprovação | Taxa canônica; líquido somente leitura | Cliente envia apenas operação e taxa; banco recalcula | Não |
| Listagens de operações | Consulta | Compatibilidade com campos anuláveis | Formatação preserva estado pendente e histórico | Não |
| Editor/publicação de política | Configuração | Exigir método apenas em novas publicações | Publicadas antigas permanecem legadas; método inválido falha | Não |
| RPC de aprovação | Persistência | Lock, recálculo, memória e auditoria atômicos | Segunda aprovação e aprovação direta passam a ser recusadas | Não |
| Liquidação, relatórios e documentos | Pós-aprovação/histórico | Consumir valores persistidos | Nenhuma fórmula ou chamada desses fluxos foi modificada | Não |

### 18.4 Fluxos externos preservados

O diff integral não altera arquivos de login, MFA/TOTP, sessão de 24 horas, recuperação de senha, fundo ativo, onboarding, upload/análise documental, Storage, CT-e, entrega, postergação, sacado, consultor, CNAB, Portal FIDC, desembolso, liquidação, inadimplência, notificações, auditoria geral ou relatórios. As únicas telas alteradas são política e operação, estritamente nos campos e estados financeiros. A suíte geral exerce esses módulos e permaneceu verde.

### 18.5 Problemas encontrados e corrigidos na auditoria

1. A RPC tratava uma segunda aprovação como repetição idempotente bem-sucedida. A action e a migration de endurecimento agora recusam explicitamente a repetição depois de bloquear a linha.
2. Existia índice simples em `operacao_id` redundante com o prefixo da constraint única `(operacao_id, nota_fiscal_id)`. A migration incremental o remove.
3. Um contrato TypeScript ainda declarava `valor_liquido_desembolso` como sempre preenchido. O tipo passou a aceitar `NULL` antes da aprovação.
4. Uma atualização direta poderia mudar apenas o status para `aprovada`, contornando a memória financeira. Um trigger novo exige o contexto interno da RPC atômica para essa transição.
5. Foi adicionada prova explícita de que a solicitação sem taxa persiste líquido `NULL`, apesar da compatibilidade da RPC legada.

Todas as correções são locais ao cálculo/aprovação financeira e possuem teste de regressão.

### 18.6 Migration, RLS e segurança

- migrations incrementais e transacionais, sem editar arquivos já aplicados;
- nenhuma atualização financeira em massa, backfill ou recálculo histórico;
- helpers e RPCs `SECURITY DEFINER` usam `search_path` controlado;
- nenhuma ocorrência de SQL dinâmico ou UUID de fundo fixo;
- assinatura antiga que aceitava líquido revogada;
- RPC pública recebe somente operação e taxa, revalida papel e acesso ao fundo;
- operação e NFs são bloqueadas com `FOR UPDATE`;
- memória possui `UNIQUE (operacao_id, nota_fiscal_id)`, FKs e RLS;
- `authenticated` recebe somente `SELECT` na memória; não há policy de escrita;
- gestor lê por autorização no fundo e cedente apenas por propriedade;
- consultor, sacado e `anon` não recebem permissão nova;
- `service_role` aparece somente no DDL de backend, nunca no navegador ou action;
- PERF9B/AAL2 executou 50 cenários negativos/positivos de isolamento em homologação sem mutação destrutiva;
- o conector MCP não estava conectado; nenhuma migration foi aplicada nesta auditoria.

### 18.7 Regressões e validações executadas

| Validação | Resultado |
|---|---|
| Suíte financeira direcionada | 39/39 testes aprovados |
| `npx tsc --noEmit` | Aprovado |
| `npm test -- --run` | 80 arquivos e 602 testes aprovados |
| `npm run lint` | Aprovado, sem erros; 6 avisos preexistentes fora do escopo |
| `npx next build --webpack` | Aprovado; 63 rotas; avisos preexistentes do Handlebars |
| `npm run perf9b:verify -- --env-file .env.homolog` | Aprovado, 50/50 |
| `npm run perf9b:explain -- --env-file .env.homolog` | Aprovado |
| `git diff --check` | Aprovado |
| Varredura de segredos nos 26 arquivos | 0 nomes suspeitos e 0 padrões encontrados |

Casos financeiros cobertos: fallback legado estrito, método inválido, 252 com fins de semana/feriados/virada de ano, 30/360 com fevereiro/bissexto/dias 30 e 31, 365 fixo inclusive em ano bissexto, mesmo dia, vencida, taxa ausente, zero explícito, múltiplas NFs, maior exposição, arredondamento individual e soma posterior. A suíte de migration cobre ausência de backfill, `NULL` sem taxa, grants/RLS, assinatura da RPC, locks, imutabilidade e bloqueio de aprovação direta/repetida.

### 18.8 Resultado dos gates

| Gate | Resultado |
|---|---|
| Escopo financeiro | Aprovado |
| Regressão fora do escopo | Aprovada |
| Migration | Aprovada por revisão e testes estáticos; `1800` pendente de aplicação em homologação |
| Segurança multifundo | Aprovada por revisão e PERF9B/AAL2 |
| Histórico | Preservado, sem backfill ou recálculo |
| Testes e build | Aprovados |
| Worktree para commit | Somente arquivos classificados A, B e C |

Commit planejado: `feat: adiciona métodos de cálculo financeiro por política`, exclusivamente na branch `homolog`. O hash e o resultado do push são informados na entrega Git, pois um commit não pode conter o próprio hash sem alterá-lo.
