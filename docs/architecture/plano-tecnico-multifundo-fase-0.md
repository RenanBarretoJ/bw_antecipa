# BW Antecipa — Plano técnico para fluxo operacional multifundo

**Fase:** 0 — análise e plano de implementação
**Data:** 20/07/2026
**Escopo desta fase:** leitura do código existente, definição da arquitetura-alvo, sequência de migrações, riscos, decisões pendentes e critérios de aceite.
**Fora do escopo desta fase:** alteração de código, criação/execução de migrations, alteração de templates, configuração de integrações ou deploy.

## 1. Resultado da análise

O projeto já possui o conceito de fundos, mas o vínculo operacional atual ainda é direto: `cedentes.fundo_id` aponta para `fundos`. O fundo é usado principalmente para obter o CNPJ da remessa Fromtis; a operação não registra o fundo nem a política aplicada como contexto imutável. Referências: `supabase/schema.sql`, `src/lib/actions/gestor.ts`, `src/lib/fromtis/remessa.ts`, `src/lib/actions/operacao.ts`.

O novo fluxo deve acrescentar uma camada configurável entre cedente, fundo e operação. A decisão de fluxo não deve depender do nome, CNPJ ou ID fixo de um fundo/cedente. O padrão da política deve preservar o comportamento atual quando nenhuma configuração específica estiver ativa.

Há três limitações que impedem especificar a implementação completa apenas com o repositório:

1. Não há documentação de protocolo, endpoints, payloads, autenticação ou homologação da Sinqia no projeto. A integração Sinqia fica arquiteturalmente prevista, mas a implementação concreta está bloqueada até esses artefatos serem fornecidos.
2. O repositório não contém a decisão de negócio que define qual política deve ser aplicada a cada fundo/cedente nem como os registros históricos sem snapshot devem ser reconstruídos.
3. O layout CNAB e os documentos jurídicos do novo fundo não estão parametrizados; atualmente existem constantes e templates globais.

## 2. Estado atual relevante

### 2.1 Fluxo financeiro existente

O cedente envia uma NF, o gestor a analisa e uma operação é criada a partir de NFs aprovadas. A solicitação altera as NFs para `em_antecipacao`; a aprovação da operação atualmente exige NFs `aceita`, calcula deságio/valor antecipado, gera termo, permite anexar comprovantes, desembolsa via escrow e depois liquida ou marca inadimplência. Referências: `src/lib/actions/nota-fiscal.ts`, `src/lib/actions/operacao.ts`, `src/lib/actions/liquidacao.ts`, `src/lib/actions/sacado.ts`, `src/lib/actions/escrow.ts`.

Os status financeiros atuais das NFs incluem `rascunho`, `submetida`, `em_analise`, `aprovada`, `em_antecipacao`, `aceita`, `contestada`, `liquidada`, `cancelada` e `requer_ajuste` nas versões de schema/migrations correspondentes. Os status de operação incluem `solicitada`, `em_analise`, `aprovada`, `em_andamento`, `liquidada`, `inadimplente`, `reprovada` e `cancelada`. Referências: `supabase/schema.sql`, `supabase/migrations/013_add_requer_ajuste_status.sql`, `src/lib/actions/operacao.ts`, `src/lib/actions/liquidacao.ts`.

Não deve ser criado um status logístico dentro desse conjunto financeiro. A entrega precisa ter estado próprio e ser consumida por uma máquina de regras separada. Hoje não existe `status_entrega` nas NFs.

### 2.2 Fundos e vínculo atual

- `fundos` guarda dados cadastrais, bancários e de administração/custódia: `supabase/schema.sql`.
- `cedentes.fundo_id` é a relação atual, nullable e direta: `supabase/schema.sql`.
- O gestor cria/atualiza/ativa fundos e vincula fundo ao cedente por ações administrativas: `src/lib/actions/gestor.ts`.
- A tela administrativa de fundos é `src/app/gestor/fundos/page.tsx`; o detalhe e vínculo do cedente ficam em `src/app/gestor/cedentes/[id]/page.tsx`.
- A remessa usa o relacionamento `fundos(cnpj)` para identificar o fundo, mas as credenciais e o tipo de recebível são variáveis globais: `src/lib/fromtis/remessa.ts`.

### 2.3 Documentos, PDFs e CNAB

Os documentos de NF usam o bucket `notas-fiscais`; documentos de cedente usam `documentos-cedentes`; contratos usam `contratos`: `src/lib/storage.ts`, `supabase/storage.sql`, `supabase/migrations/003_storage_buckets_env.sql`, `supabase/migrations/012_storage_policies_acesso_vinculado.sql`.

Os PDFs são compilados a partir de templates globais em `src/templates/contratos`. A seleção atual considera principalmente coobrigação e testemunhas, não o fundo nem uma política versionada: `src/lib/pdf/gerarContrato.ts`. Há conteúdo específico de fundo escrito diretamente em template, inclusive em `src/templates/contratos/contrato-cessao-sem-coobrigacao.html`.

O CNAB 444 contém constantes de originador, banco, nome do banco, espécie e diversos campos fixos em `src/lib/cnab/gerarCnab444.ts`. O mesmo arquivo contém comentários de banco que não coincidem com parte das constantes efetivamente usadas, o que precisa ser resolvido antes de parametrizar o layout.

### 2.4 Segurança e consistência existentes

O login usa Supabase Auth; a sessão é atualizada por `src/proxy.ts` e `src/lib/supabase/middleware.ts`. As ações server-side fazem verificações de usuário/role em módulos como `src/lib/actions/gestor.ts`, `src/lib/actions/operacao.ts` e `src/lib/actions/sacado.ts`. RLS e storage policies estão em `supabase/schema.sql` e `supabase/migrations`.

O novo fluxo não deve depender somente da UI ou de RLS. Cada ação sensível deve validar autenticação, role, vínculo do ator com a entidade e autorização do estado atual. Toda transição crítica deve gerar auditoria por `src/lib/actions/auditoria.ts`.

O schema consolidado e `src/types/database.ts` não estão perfeitamente sincronizados com todas as migrations. Por exemplo, a tipagem não deve ser tratada como fonte suficiente para inferir o banco; após cada mudança de schema, ela deverá ser atualizada e verificada contra as migrations efetivamente instaladas.

## 3. Arquitetura-alvo proposta

### 3.1 Princípios

1. Configuração por dados: a regra é selecionada por vínculos e política ativa, nunca por nomes/CNPJs/IDs fixos.
2. Snapshot operacional: uma operação aprovada deve conservar o fundo, a política, a versão e as regras que foram usadas, mesmo que a configuração corrente mude depois.
3. Compatibilidade: a política padrão reproduz o fluxo atual de aprovação de NF, aceite do sacado, termo, CNAB, desembolso e liquidação.
4. Separação de domínios: status financeiro, documentos, logística, templates, CNAB e integrações devem ter modelos e serviços próprios.
5. Segurança server-side: uploads, downloads, transições, remessas e alterações de configuração passam por autorização explícita.
6. Idempotência e atomicidade: transições financeiras e registros de integração devem impedir duplicidade e inconsistência parcial.

### 3.2 Novos modelos de dados

Os nomes abaixo são uma proposta de modelagem para migrations novas. Eles não devem ser implementados antes da revisão dos campos com o negócio e dos dados existentes.

#### `cedente_fundos`

Relação N:N entre cedente e fundo, substituindo gradualmente o uso operacional de `cedentes.fundo_id`.

Campos propostos:

- `id` — chave primária;
- `cedente_id` — FK para `cedentes`;
- `fundo_id` — FK para `fundos`;
- `ativo` — permite desativar o vínculo sem apagar histórico;
- `principal` — indicação do vínculo padrão, com unicidade por cedente entre vínculos ativos/principais;
- `criado_em`, `atualizado_em` — auditoria técnica;
- opcionalmente `vigente_desde` e `vigente_ate`, caso a vigência histórica seja necessária.

Restrições: unicidade de `(cedente_id, fundo_id)`, FKs indexadas e proibição de vínculo com fundo inativo na criação de nova operação. O vínculo antigo `cedentes.fundo_id` deve continuar durante a migração e ser tratado como compatibilidade, não como fonte de uma regra nova.

#### `politicas_operacionais`

Catálogo versionável de política, ligado a um fundo ou a um vínculo cedente-fundo conforme a decisão de escopo.

Campos propostos:

- `id`, `codigo`, `nome`, `descricao`;
- `fundo_id` ou `cedente_fundo_id` — a escolha deve ser única para evitar duas fontes de verdade;
- `versao` — incremento imutável por alteração relevante;
- `ativa`;
- `vigente_desde`, `vigente_ate`;
- regras explicitamente tipadas: `exige_aceite_sacado`, `exige_aprovacao_nf_gestor`, `cria_acompanhamento_entrega`;
- parâmetros de prazo: `prazo_entrega_dias`, `prazo_validacao_documentos_dias`;
- parâmetros de cálculo/documentação apenas quando houver definição de domínio;
- `criado_por`, `atualizado_por`, `criado_em`, `atualizado_em`.

Regras que possam evoluir sem alterar o schema podem usar JSONB versionado, mas os gates de segurança e transição financeira devem permanecer em colunas/serviços verificáveis.

#### `politica_requisitos_documentais`

Catálogo dos documentos exigidos por política e por fase.

Campos propostos: `id`, `politica_id`, `tipo_documento`, `fase`, `obrigatorio`, `exige_aprovacao`, `prazo_dias`, `responsavel_preferencial`, `ordem`, `ativo`, `criado_em`, `atualizado_em`.

`fase` deve distinguir pelo menos `pre_cessao` e `pos_cessao`. O tipo precisa ser enum ou catálogo controlado; não deve ser texto livre usado diretamente em decisões críticas.

#### Contexto imutável em `operacoes`

Toda operação nova deve registrar o contexto aplicado:

- `fundo_id`;
- `cedente_fundo_id`;
- `politica_operacional_id`;
- `politica_versao`;
- `politica_snapshot` JSONB com as regras e parâmetros efetivamente usados;
- timestamps dos marcos de seleção/aprovação, se não existirem no modelo atual.

O objetivo é permitir auditoria e reprocessamento histórico sem consultar a política vigente. Para operações legadas, a migration deverá definir uma estratégia explícita de backfill; não se deve inventar o fundo/política com base apenas no nome.

#### Documentos de NF e entrega

Para documentos da NF, a opção preferencial é criar uma relação própria, em vez de sobrecarregar o modelo genérico de `documentos`:

- `documentos_notas_fiscais`: `id`, `nota_fiscal_id`, `tipo_documento`, `fase`, `status`, `storage_bucket`, `storage_path`, `mime_type`, `tamanho_bytes`, `hash_sha256`, `enviado_por`, `analisado_por`, `motivo_rejeicao`, timestamps;
- `nota_fiscal_requisitos`: instância dos requisitos aplicáveis à NF, com `politica_requisito_id`, `obrigatorio`, `status`, `documento_id`, `prazo_em`, timestamps;
- `nota_fiscal_entrega`: ou colunas equivalentes em `notas_fiscais`, contendo `status_entrega`, `entregue_em`, `validado_em`, `motivo_pendencia`, `prazo_entrega_em`.

O repositório ainda não esclarece se haverá uma NF por CT-e ou uma relação N:N. Para suportar mais de uma NF por CT-e sem perda de informação, a solução deve prever `cte_nfs` com `cte_id`, `nota_fiscal_id` e metadados de validação, caso esse requisito seja confirmado.

O `status_entrega` deve ser independente dos status financeiros. A enumeração inicial proposta é `nao_aplicavel`, `em_transito`, `aguardando_validacao`, `entregue`, `entrega_com_pendencia`, `devolvida`, `cancelada`; os valores finais dependem da validação do domínio.

#### Templates, CNAB e integrações

Esses modelos são posteriores à Fase 0, mas precisam ser previstos:

- `templates_documentos`: fundo/política, tipo documental, versão, caminho, ativo, vigência e hash;
- `configuracoes_cnab`: fundo, layout/versão, campos configuráveis, credenciais referenciadas de forma segura e status de homologação;
- `integracoes`: tipo, fundo, ambiente, endpoint, configuração não secreta, referência segura a segredo, ativo e versão;
- `remessas_integracao`: operação, integração, idempotency key, status, arquivo, identificador externo, retorno bruto protegido, timestamps e tentativas.

Segredos não devem ser armazenados no browser nem em JSONB acessível ao usuário. O mecanismo concreto de armazenamento/rotação de segredos ainda não está definido no repositório.

## 4. Enums, gates e regras de transição

### 4.1 Política operacional

Uma operação só pode ser criada quando existir vínculo ativo cedente-fundo, fundo ativo, política vigente e requisitos obrigatórios de `pre_cessao` atendidos. O serviço deve resolver esses dados no servidor e gravar o snapshot na mesma transação da criação da operação.

As flags mínimas da política são:

- `exige_aprovacao_nf_gestor`: controla a aprovação operacional da NF;
- `exige_aceite_sacado`: controla se o aceite do sacado é gate antes da aprovação/desembolso;
- `cria_acompanhamento_entrega`: controla se a NF entra no fluxo de logística.

O comportamento atual deve ser representado por uma política padrão equivalente ao fluxo existente. A alteração de política não pode retroativamente mover operações já criadas.

### 4.2 Estado financeiro

Os status financeiros existentes devem ser preservados para o fluxo atual e para dados históricos. A implementação nova deve centralizar transições em serviços, em vez de espalhar comparações de strings por páginas e actions. Referências que hoje concentram regras: `src/lib/actions/nota-fiscal.ts`, `src/lib/actions/operacao.ts`, `src/lib/actions/sacado.ts`, `src/lib/actions/liquidacao.ts`.

Uma política sem aceite do sacado não deve exigir que a NF passe por `aceita`; entretanto, a compatibilidade precisa definir como o status financeiro será representado sem quebrar filtros existentes. Essa é uma decisão pendente, não uma conclusão do código atual.

### 4.3 Documentos

O ciclo sugerido é `pendente -> enviado -> em_analise -> aprovado/rejeitado`. Reenvio deve criar nova versão ou nova linha rastreável, mantendo o motivo da rejeição e o ator da decisão. O acesso deve validar proprietário, cedente vinculado, gestor autorizado ou outro papel expressamente definido.

### 4.4 Entrega

O serviço logístico deve aceitar eventos idempotentes e registrar ator/origem. A data de vencimento do prazo deve vir da política; não deve ser hardcoded. A regra de notificação precisa diferenciar aviso preventivo, vencimento e pendência pós-vencimento. Os crons existentes em `src/app/api/cron/vencimentos/route.ts` e `src/app/api/cron/documentos-vencidos/route.ts` podem servir de padrão operacional, mas não devem receber a nova lógica sem testes de duplicidade e auditoria.

## 5. Fluxo técnico proposto

### 5.1 Configuração do fundo e da política

1. O gestor cria ou seleciona um fundo em `src/app/gestor/fundos/page.tsx`, usando actions de `src/lib/actions/gestor.ts`.
2. O gestor cria/ativa uma política e seus requisitos documentais por uma nova action server-side a ser definida.
3. O gestor vincula o cedente ao fundo em `src/app/gestor/cedentes/[id]/page.tsx`; o novo vínculo passa a ser `cedente_fundos`.
4. O servidor valida que o fundo está ativo, que a policy é vigente e que o vínculo não é ambíguo.
5. Toda alteração relevante gera auditoria em `src/lib/actions/auditoria.ts`.

### 5.2 Envio e preparação da NF

1. O cedente interage com `src/app/cedente/notas-fiscais` e actions de `src/lib/actions/nota-fiscal.ts`.
2. O servidor valida usuário, cedente, tamanho, extensão, MIME e conteúdo; o caminho de storage é gerado pelo servidor.
3. O XML/PDF/imagem é processado pelos utilitários existentes em `src/lib/nfe` e `src/lib/pdf` quando aplicável.
4. A NF recebe seus requisitos `pre_cessao` conforme a política resolvida, sem expor NFs ao sacado nessa etapa.
5. A aprovação/rejeição do gestor registra decisão e auditoria.

### 5.3 Solicitação e aprovação da operação

1. `src/lib/actions/operacao.ts` recebe a solicitação do cedente.
2. O servidor carrega o vínculo cedente-fundo e a policy vigente, verifica elegibilidade das NFs e captura o snapshot.
3. A criação de `operacoes`, seus itens em `operacoes_nfs` e mudanças de estado ocorre de forma transacional, com proteção contra reenvio.
4. O gate de aceite do sacado é avaliado pelo snapshot, não pela configuração corrente.
5. O gestor aprova/reprova pela tela de operação; a autorização é revalidada no servidor.
6. O serviço financeiro calcula taxas/deságio sem misturar regras logísticas. O comportamento atual de cálculo está em `src/lib/actions/operacao.ts` e `src/lib/actions/nota-fiscal.ts`.

### 5.4 Documentos e cessão

1. O serviço de templates resolve tipo, fundo, policy e versão do template.
2. `src/lib/pdf/gerarContrato.ts` deve receber um contexto explícito, em vez de escolher conteúdo somente por coobrigação.
3. Contrato, termo e notificação são armazenados em bucket privado com path não previsível por nome.
4. Downloads passam por route server-side e URL assinada após autorização. A route existente `src/app/api/contratos/download/route.ts` deve ser revisada.
5. A operação somente avança quando os documentos obrigatórios e o comprovante exigido pelo snapshot estiverem válidos.

### 5.5 Remessa, desembolso e logística

1. O gerador CNAB usa configuração versionada do fundo e o snapshot da operação; não lê constantes específicas de um participante.
2. A remessa é persistida com chave idempotente antes da chamada externa.
3. Fromtis e Sinqia são escolhidos por configuração de integração, sem condicional por nome/CNPJ/ID.
4. O desembolso mantém as validações atuais de termo assinado e comprovante em `src/lib/actions/operacao.ts`, mas deve ser idempotente.
5. Se `cria_acompanhamento_entrega` estiver ativo, a NF entra no domínio logístico; o sacado não recebe a NF na fila de aceite apenas por ela existir.
6. Eventos de CT-e/canhoto atualizam `status_entrega`, requisitos pós-cessão e notificações sem alterar o status financeiro até que uma regra financeira explícita seja acionada.

## 6. Sequência de migrations

As migrations existentes não devem ser editadas. A numeração abaixo é uma sequência proposta; os nomes finais devem seguir o padrão já usado em `supabase/migrations`.

| Ordem | Escopo | Resultado esperado |
|---|---|---|
| 1 | Compatibilidade e auditoria | Definir origem/ator de ações automáticas e corrigir a incompatibilidade existente entre crons e `logs_auditoria.usuario_id`, sem perder histórico. |
| 2 | Vínculos multifundo | Criar `cedente_fundos`, índices, constraints, RLS e bridge de leitura com `cedentes.fundo_id`. |
| 3 | Políticas | Criar `politicas_operacionais`, versionamento, vigência, RLS e seed apenas de uma política padrão validada. |
| 4 | Requisitos | Criar `politica_requisitos_documentais` e instâncias de requisito por NF/operação. |
| 5 | Contexto da operação | Adicionar fundo, vínculo, policy, versão e snapshot em `operacoes`; definir backfill de legados antes de tornar campos obrigatórios. |
| 6 | Documentos NF | Criar documentos/requisitos de NF, índices de hash, metadados de storage e RLS. |
| 7 | Logística | Criar `status_entrega`, datas/eventos e, se confirmado, relação `cte_nfs`; manter financeiro separado. |
| 8 | Templates | Criar catálogo/versionamento de templates e referências de documento gerado. |
| 9 | CNAB | Criar configuração por fundo/layout e registro idempotente de remessa. |
| 10 | Integrações | Criar catálogo de integração e remessa, com referência segura de segredos e estado de homologação. |

Cada migration deve incluir índices, constraints, RLS e estratégia de rollback/forward-fix documentada. Depois de cada mudança, `src/types/database.ts` deve ser atualizado, mas os tipos não substituem a validação no banco.

### Estratégia de dados legados

O código não fornece dados de produção suficientes para escolher automaticamente um novo fundo ou uma policy. Antes de uma migration de backfill, devem ser obtidos:

- lista real de cedentes, fundos, vínculos e operações;
- regra para cedentes com `fundo_id` nulo;
- regra para cedentes com fundo inativo;
- policy equivalente ao fluxo atual;
- tratamento para operações históricas sem contexto.

Até essa decisão, a opção segura é tornar o contexto obrigatório para novas operações e manter legados em modo somente histórico, sem reprocessamento automático.

## 7. Matriz de arquivos afetados

| Área | Arquivos existentes | Impacto planejado |
|---|---|---|
| Schema/tipos | `supabase/schema.sql`, `supabase/migrations/*`, `src/types/database.ts` | Novas tabelas/colunas/RLS e tipagem sincronizada. Não editar migrations antigas. |
| Fundos | `src/lib/actions/gestor.ts`, `src/app/gestor/fundos/page.tsx`, `src/app/gestor/cedentes/[id]/page.tsx` | Administrar vínculo N:N e policies; preservar leitura do vínculo legado durante transição. |
| NF | `src/lib/actions/nota-fiscal.ts`, `src/app/cedente/notas-fiscais`, `src/app/gestor/notas-fiscais`, `src/app/gestor/notas-fiscais/[id]` | Requisitos por policy, uploads e aprovação sem revelar a fila ao sacado. |
| Operação | `src/lib/actions/operacao.ts`, `src/app/cedente/operacoes`, `src/app/gestor/operacoes`, `src/app/gestor/operacoes/[id]/page.tsx` | Resolver/snapshot de policy, gates configuráveis, transações e idempotência. |
| Sacado | `src/lib/actions/sacado.ts`, `src/app/sacado/aprovacao`, `src/app/sacado/dashboard`, `src/app/sacado/pagamentos` | Fila baseada em elegibilidade e policy; impedir aparecimento de NF antes da cessão/evento definido. |
| Documentos | `src/lib/storage.ts`, `src/app/api/contratos/*`, `src/lib/pdf/gerarContrato.ts`, `src/templates/contratos/*` | Resolver templates por contexto, proteger downloads e registrar versão usada. |
| CNAB | `src/lib/cnab/gerarCnab444.ts`, `src/app/api/contratos/gerar-cnab/route.ts`, `src/app/gestor/operacoes/[id]/page.tsx` | Remover configuração participante-específica do código e vincular layout ao snapshot. |
| Fromtis/Sinqia | `src/lib/fromtis/remessa.ts`, `src/app/api/contratos/enviar-remessa/route.ts`, novos `src/lib/integrations/*` | Factory por configuração, segredos server-side, idempotência e bloqueio explícito até documentação Sinqia. |
| Notificações/jobs | `src/lib/actions/notificacao.ts`, `src/app/api/cron/vencimentos/route.ts`, `src/app/api/cron/documentos-vencidos/route.ts` | Eventos de policy/logística, deduplicação e auditoria de tarefas automáticas. |
| Auditoria | `src/lib/actions/auditoria.ts`, `supabase/schema.sql` | Registrar configuração, upload, aprovação, transição, remessa, callback e erro externo. |
| Configuração | `package.json`, `.env.example`, `next.config.ts`, `vercel.json` | Variáveis por ambiente somente para infraestrutura; parâmetros por fundo/policy em banco seguro. |

Arquivos novos sugeridos, quando a implementação começar: `src/lib/operacoes/politica.ts`, `src/lib/documentos/requisitos.ts`, `src/lib/logistica/entrega.ts`, `src/lib/pdf/template-resolver.ts`, `src/lib/cnab/configuracao.ts`, `src/lib/integrations/factory.ts` e testes correspondentes. Esses caminhos são propostas, não arquivos existentes.

## 8. Riscos e pontos frágeis

1. **Vínculo legado:** remover ou ignorar `cedentes.fundo_id` sem bridge pode quebrar gestor, Fromtis e operações existentes.
2. **Ausência de snapshot:** regenerar contrato/CNAB de uma operação antiga usando policy atual pode produzir documento diferente do originalmente aprovado.
3. **Hardcodes:** `src/lib/cnab/gerarCnab444.ts` e `src/templates/contratos/*` contêm dados/configuração que precisam ser extraídos com validação de layout/jurídico.
4. **Inconsistência CNAB:** comentários e constantes de banco no gerador não são coerentes; não é seguro parametrizar sem definir a fonte correta.
5. **Aceite do sacado:** `src/lib/actions/operacao.ts` exige `aceita` na aprovação atual; alterar isso sem atualizar filas, filtros e notificações pode deixar operações presas.
6. **RLS desigual:** as migrations posteriores adicionam políticas a algumas tabelas, mas o conjunto de schema, `homolog_setup.sql` e migrations precisa ser revisado conjuntamente antes de expor novos dados.
7. **Uploads:** MIME declarado, extensão e conteúdo podem divergir; é necessário validar no servidor, limitar tamanho, usar hash e evitar paths previsíveis.
8. **Jobs/auditoria:** os crons inserem auditoria sem usuário em `src/app/api/cron/vencimentos/route.ts` e `src/app/api/cron/documentos-vencidos/route.ts`, enquanto o schema define `usuario_id` obrigatório; isso deve ser resolvido antes de ampliar jobs.
9. **Atomicidade financeira:** `src/lib/actions/liquidacao.ts` atualiza operação, NF e escrow em passos que precisam ser revisados como unidade; o código atual também merece reconciliação entre valor movimentado e valor líquido.
10. **Integração não especificada:** sem contrato Sinqia não há como confirmar autenticação, mapeamento de status, idempotência, callbacks ou tratamento de erro.
11. **Cobertura de testes:** não foram identificados testes de integração que comprovem RLS, dupla submissão, transições concorrentes, CNAB por layout ou callbacks externos.
12. **Regressão de visibilidade:** `src/app/sacado/dashboard/page.tsx` e `src/app/sacado/pagamentos/page.tsx` filtram operações/status existentes; qualquer nova política precisa ser refletida nesses filtros sem expor NFs indevidas.

## 9. Decisões pendentes

As decisões seguintes não podem ser inferidas com segurança pelo código e devem ser registradas antes da implementação correspondente:

- o escopo da policy é por fundo ou por vínculo cedente-fundo;
- quais fundos/cedentes usarão a nova política e qual é o fallback do fluxo atual;
- se “cessão efetivada” ocorre na aprovação, na assinatura ou no desembolso;
- em que evento uma NF deixa de aparecer para o sacado;
- regras jurídicas e responsáveis pela aprovação de contrato, CT-e, canhoto e demais documentos;
- nomenclatura final e máquina de estados de `status_entrega`;
- prazo de entrega, calendário aplicável e calendário de notificações;
- CT-e/NF é 1:1 ou N:N e quais dados devem ser extraídos/validados;
- layout CNAB, campos, banco, espécie, originador e ambiente de homologação do novo fundo;
- se o storage de documentos NF será bucket dedicado ou o bucket privado atual;
- mecanismo aprovado para armazenar/rotacionar credenciais de Fromtis/Sinqia;
- documentação oficial Sinqia: endpoints, autenticação, certificados, schemas, códigos de retorno, idempotência, webhooks e evidência de homologação;
- estratégia de backfill de operações legadas e possibilidade de marcar registros como “sem contexto histórico”;
- política de retenção, download e exposição de documentos a sacado/consultor.

## 10. Critérios de aceite da Fase 0

Esta fase será considerada concluída quando:

- o estado atual estiver rastreado por arquivos e não por suposições;
- a separação entre financeiro, documentos, logística, templates, CNAB e integrações estiver definida;
- o vínculo multifundo, policy versionada, requisitos, snapshot e estados logísticos tiverem uma proposta de dados;
- a sequência de migrations novas estiver registrada sem alterar migrations antigas;
- todos os pontos de código afetados estiverem listados;
- riscos de regressão e compatibilidade do fluxo atual estiverem explicitados;
- as limitações da Sinqia estiverem marcadas como bloqueio documental, sem inventar contrato de API;
- decisões de negócio e dados legados estiverem separadas das decisões técnicas;
- critérios de teste e aceite das fases futuras estiverem definidos;
- nenhuma alteração de código, schema, segredo ou ambiente tiver sido feita nesta fase.

## 11. Ordem de implementação após aprovação

1. **Fase 1 — segurança e fundação:** corrigir/definir auditoria de atores automáticos, consolidar tipos, criar helpers de autorização, transação e idempotência, e adicionar testes de regressão.
2. **Fase 2 — dados e policy:** criar vínculos N:N, policies versionadas, requisitos e snapshot de operação; executar backfill somente após decisão aprovada.
3. **Fase 3 — documentos NF:** criar requisitos/documentos, uploads privados, hash, validação e aprovação server-side.
4. **Fase 4 — operação e roteamento:** adaptar solicitação, aprovação, aceite do sacado e dashboards para a policy capturada.
5. **Fase 5 — pós-cessão/logística:** criar estados de entrega, CT-e/canhoto, prazos, notificações e jobs idempotentes.
6. **Fase 6 — PDFs/templates:** catalogar templates por fundo/policy, remover conteúdo participante-específico dos templates e registrar versão gerada.
7. **Fase 7 — CNAB:** validar layout, configurar por fundo, gerar arquivos a partir do snapshot e testar golden files/homologação.
8. **Fase 8 — integrações:** encapsular Fromtis, especificar Sinqia após documentação, proteger segredos, implementar idempotência e callbacks.
9. **Fase 9 — validação integrada:** executar testes unitários, integração, RLS, storage, concorrência, regressão do fluxo padrão e homologação por fundo.

Nenhuma fase futura deve ser iniciada com deploy de produção implícito. Cada entrega deve apresentar migrations executadas no ambiente adequado, testes, riscos residuais e evidência de que o fluxo atual continua funcionando sob a política padrão.
