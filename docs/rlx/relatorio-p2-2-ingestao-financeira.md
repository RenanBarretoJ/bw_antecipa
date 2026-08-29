# P2.2 — Camada de ingestão financeira versionada e auditável da RLX

## 1. Resumo executivo

O P2.2 cria a infraestrutura canônica para receber, preservar, validar, versionar e publicar quatro famílias de dados financeiros por fundo: `CARTEIRA`, `ESTOQUE`, `AQUISICOES` e `LIQUIDACOES`.

O desenho impede publicação parcial e preserva a linhagem entre arquivo bruto, execução de importação, staging, validação e base canônica. A troca da versão vigente ocorre em transação PostgreSQL, com lock por fundo, família e data de referência.

O escopo foi aplicado e homologado exclusivamente no projeto Supabase de homologação `fhgkmggthxikfpogrvaa`. Nenhuma migration foi aplicada ao projeto de produção.

## 2. Objetivo e fronteira de domínio

O P2.2 responde:

> Quais dados financeiros oficiais foram recebidos, para qual fundo e data, de qual arquivo, por qual layout e com qual qualidade?

O fluxo implementado é:

```text
Arquivo externo
  ↓
Importação identificada por fundo, família, data e hash
  ↓
Arquivo bruto privado e imutável
  ↓
Parser versionado
  ↓
Staging linha a linha
  ↓
Validação integral
  ↓
Publicação atômica
  ↓
Base canônica versionada e visão vigente
```

Não fazem parte do P2.2: matching com NF, conciliação, classificação financeira × logística, overlay intraday, cálculo do limite de 40%, resolução de PL D-2, catálogo definitivo de movimentos e semântica de encerramento de exposição. Esses temas permanecem reservados aos próximos blocos da RLX.

## 3. Decisões arquiteturais

- Toda entidade financeira possui `fundo_id`; tenancy não é derivada de nome, CNPJ do frontend ou variável global.
- `provedor` é um namespace explícito. O runtime não assume Sinqia ou outro fornecedor como verdade universal.
- Arquivo bruto, staging e linhas canônicas são separados para permitir reprocessamento, inspeção e auditoria.
- A base canônica é append-only por importação. Uma retificação cria nova importação e preserva a anterior.
- Lifecycle (`status`) e qualidade do conjunto (`completude`) são dimensões distintas.
- Uma linha inválida torna a importação incompleta; nenhuma família publica subconjuntos silenciosamente.
- Publicação é feita por RPC transacional, e não por sequência de updates no frontend.
- Dados técnicos de importação ficam restritos ao Super Admin. Gestores recebem somente a visão canônica publicada dos fundos autorizados.
- Usuário híbrido Super Admin/Gestor não recebe acesso operacional implícito a todos os fundos.

## 4. Modelo de execução da importação

### `rlx_importacoes_financeiras`

Registro principal da execução. Armazena fundo, família, provedor, data de referência, layout, versão, lifecycle, completude, origem, SHA-256, identificação do arquivo, encoding, contagens, valor total, erros sanitizados, correlação, timestamps, ator, relação de retificação e declaração de ausência de movimento.

Regras relevantes:

- famílias permitidas: `CARTEIRA`, `ESTOQUE`, `AQUISICOES`, `LIQUIDACOES`;
- lifecycle: `RECEBIDA`, `VALIDANDO`, `VALIDA`, `PUBLICADA`, `FALHA`, `RETIFICADA`, `CANCELADA`;
- completude: `COMPLETO_COM_DADOS`, `COMPLETO_VAZIO`, `INCOMPLETO`;
- unicidade do conteúdo por fundo + família + data + hash;
- uma única publicação vigente por fundo + família + data;
- contagens e declaração vazia protegidas por constraints.

### `rlx_importacao_arquivos`

Metadados do artefato bruto: importação, fundo, ordem, nome original, MIME, tamanho, hash, bucket e path. O path é único e o arquivo não é sobrescrito.

### `rlx_importacao_linhas`

Staging genérico com número da linha, status (`VALIDA`, `INVALIDA`, `WARNING`), payload bruto, payload normalizado, erros e avisos. A combinação importação + número da linha é única.

### `rlx_importacao_ciclos`

Controla execução automática por fundo e data operacional: origem, status, tentativas, quantidades, detalhes, correlação e timestamps. A chave fundo + data operacional + origem funciona como lock lógico de ciclo.

## 5. Modelos canônicos

### `rlx_estoque_posicoes`

Snapshot completo da posição do fundo. Preserva identificadores externos textuais, documentos e nomes snapshot das partes, valores em `numeric`, taxas, datas, situação de origem, coobrigação, lote/operação externos, payload original e `external_title_key` determinística.

A versão vigente é a importação publicada do conjunto, nunca a maior data de criação de linhas isoladas.

### `rlx_aquisicao_movimentos`

Movimentos de entrada com identidade externa textual, documentos das partes, datas, valores, quantidade, coobrigação, referências externas, payload original e fingerprint técnica versionada.

### `rlx_liquidacao_movimentos`

Movimentos de saída com identificador externo opcional, fingerprint técnica, tipo/situação de origem, documentos das partes, datas, valores de aquisição, pagamento, nominal, presente, vencimento, ajuste e juros. A estrutura permite múltiplos movimentos para o mesmo título.

O P2.2 não interpreta um código de movimento como liquidação integral nem cria `encerra_exposicao`.

### `rlx_carteira_snapshots`

Snapshot de carteira com fundo, importação, provedor, data de referência, versão de origem, patrimônio líquido oficial, publicação na origem, payload original e linhagem. O sistema não calcula PL e não aplica fallback.

## 6. Status, completude e ausência de movimento

`PUBLICADA + COMPLETO_VAZIO` representa declaração explícita de ausência de movimentos. A declaração é permitida somente para `AQUISICOES` e `LIQUIDACOES`.

Ausência de arquivo não significa ausência de movimento. `ESTOQUE` e `CARTEIRA` não aceitam `COMPLETO_VAZIO`: precisam de snapshot explícito, inclusive em uma carteira economicamente zerada.

## 7. Arquivo bruto, Storage e hash

Foi criado o bucket privado `financeiro-importacoes`. O path é definido no servidor:

```text
{fundo_id}/{tipo}/{data_referencia}/{importacao_id}/{nome_sanitizado}
```

O SHA-256 é calculado sobre os bytes originais antes do upload. O mesmo conteúdo, fundo, família e data reutiliza a importação existente e não duplica Storage, staging ou base canônica.

Se o registro SQL inicial falhar após o upload, o fluxo executa compensação removendo o arquivo e os registros parciais criados. Nenhum segredo de integração é armazenado no payload bruto ou no staging.

## 8. Retificação e histórico

Um hash diferente para o mesmo fundo, família e data cria nova importação. Após validação integral e publicação:

```text
V1 PUBLICADA
  ↓ nova publicação atômica
V1 RETIFICADA + V2 PUBLICADA
```

V1 e suas linhas permanecem consultáveis para auditoria. Não há upsert destrutivo sobre a versão histórica.

## 9. Parser versionado

O parser usa `csv-parse`, com delimitador `;`, suporte a campos cotados, `;` dentro de campo, BOM, CRLF/LF, linhas vazias e validação estrita de aspas e quantidade de colunas.

O contrato é resolvido por família e versão de layout. Nesta etapa os contratos são `*_GOLDEN_V1`, versão `RLX_V1`. Layouts reais poderão ser adicionados sem reinterpretar importações históricas.

Headers são normalizados por trim, remoção de BOM/acento, uppercase e equivalência controlada de espaço/underscore. Somente aliases declarados são aceitos; não há matching fuzzy.

## 10. Encoding

O decoder tenta UTF-8 estrito e, em caso de falha, usa Windows-1252. UTF-8 BOM é removido de forma controlada. O encoding detectado é persistido na importação.

## 11. Valores monetários e identificadores externos

Valores financeiros são normalizados com `Decimal.js` e persistidos em `numeric`, nunca em `double precision`.

O parser aceita padrões determinísticos brasileiro e internacional, como `1.000,00` e `1,000.00`, e rejeita formatos ambíguos. O valor textual original continua disponível no payload bruto.

Identificadores externos potencialmente maiores que o limite seguro do JavaScript, inclusive o fixture `900719925474099312345`, são mantidos como texto.

## 12. Datas e documentos

Datas civis são validadas pela data reconstruída; valores impossíveis, como `31/02/2026`, tornam a linha inválida. Datas financeiras permanecem `date`; timestamps são usados somente onde existe hora.

CPF/CNPJ são normalizados para dígitos. Comprimento atípico ou checksum inválido geram warning nos layouts atuais, preservando o valor bruto para revisão. Divergência de `fundo_id` ou data de referência é erro bloqueante.

## 13. Identidades técnicas

`external_title_key` do Estoque é SHA-256 de campos normalizados, fundo, namespace do provedor e versão `RLX_TITLE_V1`. Ela serve à estabilidade técnica de ingestão, não ao matching com NF.

Aquisições e Liquidações recebem fingerprint `RLX_FP_V1`. A linha e identificadores originais são preservados, permitindo futura revisão do algoritmo sem apagar a versão histórica.

## 14. Publicação atômica

A RPC `publicar_importacao_financeira`:

1. obtém advisory lock transacional por fundo + família + data;
2. bloqueia a importação alvo;
3. valida lifecycle, completude, staging e ausência de erros bloqueantes;
4. materializa todas as linhas na tabela canônica correspondente;
5. marca a publicação anterior como `RETIFICADA`;
6. marca a nova importação como `PUBLICADA`;
7. registra auditoria e conclui a transação.

Publicar novamente a mesma importação é idempotente e não duplica linhas ou auditoria inútil.

## 15. Views vigentes

As views canônicas são:

- `rlx_estoque_atual`;
- `rlx_aquisicoes_atuais`;
- `rlx_liquidacoes_atuais`;
- `rlx_carteira_atual`.

Todas usam `security_invoker = true`; portanto, a leitura respeita as policies das tabelas-base. Consumidores futuros não precisam reinventar a resolução da publicação vigente.

## 16. RLS e isolamento multifundo

Importações, arquivos, staging e ciclos são dados técnicos visíveis apenas ao Super Admin. Escritas do pipeline usam contexto server-side e RPCs controladas.

As tabelas canônicas publicadas podem ser lidas pelo gestor somente quando há usuário ativo, vínculo ativo em `usuario_fundos`, perfil de gestor e fundo ativo. Cedente, consultor, sacado e anônimo não recebem acesso financeiro global.

O helper `private.rlx_usuario_e_super_admin()` é `SECURITY DEFINER`, tem `search_path` controlado e serve somente à avaliação das policies técnicas. Ações diretas de `INSERT`, `UPDATE` e `DELETE` por usuários autenticados permanecem proibidas.

Usuários híbridos mantêm dois contextos distintos:

- no contexto administrativo, podem inspecionar/importar/publicar dados técnicos;
- no contexto operacional, só leem dados canônicos dos fundos aos quais possuem vínculo gestor ativo.

## 17. Fundo inativo

O pipeline técnico aceita importação e preservação para fundo existente mesmo inativo, permitindo preparação, auditoria e saneamento administrativo. A leitura operacional por gestor continua condicionada a fundo ativo. Essa diferença é intencional e está isolada no domínio.

## 18. Interface administrativa

A aba `Dados financeiros` foi adicionada ao detalhe administrativo do fundo. Ela apresenta:

- resumo das quatro bases vigentes;
- upload manual de CSV por família, data e provedor;
- declaração explícita de ausência de movimento para Aquisições/Liquidações;
- histórico de até 100 importações;
- lifecycle, completude, layout, encoding, contagens, total e SHA-256;
- até cinco amostras de linhas inválidas/warnings por importação;
- indicação de que uma publicação válida retificará a vigente;
- publicação manual com confirmação MFA.

O empty state oficial informa que Carteira, Estoque, Aquisições e Liquidações ainda não possuem posição publicada para o fundo.

## 19. Upload e publicação manual

O upload manual autentica Super Admin, valida schema, UUID, família, data, provedor, extensão, MIME e limite de 20 MB. Ele apenas recebe, preserva, faz staging e valida; não publica automaticamente.

A publicação é ação sensível `publicar_base_financeira`, exige TOTP de seis dígitos e consumo da autorização MFA. Mensagens ao usuário são sanitizadas e recebem `correlation_id`; detalhes técnicos são registrados no servidor.

## 20. Cron e ciclo operacional

A rota `/api/cron/rlx-financeiro` exige `CRON_SECRET`, usa runtime Node e possui duração máxima de 300 segundos. O agendamento Vercel é `30 12 * * 1-5`, correspondente a 09:30 em `America/Sao_Paulo` fora de mudanças extraordinárias de fuso.

A própria rota valida dia útil ANBIMA. Para cada data operacional, o contrato espera as referências previstas por família e rejeita arquivos com data divergente.

O lock de ciclo evita processamento concorrente do mesmo fundo/data/origem. Ciclos antigos podem ser retomados pelo mecanismo de stale lock e as importações permanecem idempotentes por hash.

## 21. Provedores e timeout

Existe uma interface de provider, mas o registry de runtime está vazio. Não foi criado provider falso nem integração real sem credenciais/layout oficial.

Cada provider possui timeout configurável por `RLX_PROVIDER_TIMEOUT_MS`, padrão de 20 segundos e máximo de 120 segundos. Falhas retornadas pelo cron são reduzidas aos códigos sanitizados `TIMEOUT` ou `FALHA`.

O provider golden existe somente nos scripts de homologação.

## 22. Limites defensivos e performance

- arquivo: máximo 20 MB;
- linhas: padrão 100.000, configurável por `RLX_MAX_IMPORT_ROWS`;
- parser: deadline cooperativa padrão de 20 segundos, máximo de 120 segundos;
- staging: inserts em lotes de 500 linhas;
- checagem de deadline a cada 1.000 linhas;
- histórico administrativo: máximo 100 importações;
- preview: no máximo cinco inconsistências por importação;
- índices para fundo/família/data/status e futuras buscas por título, chave, partes e vencimento.

Limitação conhecida: `csv-parse/sync` é síncrono; o deadline é verificado após a leitura CSV e durante a normalização, não interrompe a biblioteca no meio de uma chamada síncrona. Os limites de bytes e linhas reduzem o pior caso. Isolamento em worker é evolução possível caso arquivos reais exijam proteção mais rígida.

## 23. ZIP e segurança de conteúdo

O P2.2 aceita somente CSV. ZIP não foi implementado; portanto, controles de zip bomb e path traversal em arquivo compactado não se aplicam nesta versão. Nome do cliente nunca é usado diretamente como path, e o bucket permanece privado.

## 24. Auditoria e observabilidade

Eventos de recebimento, validação, falha e publicação são vinculados a importação, fundo, ator e `correlation_id`. O cron também registra correlação no ciclo.

Logs e respostas não incluem credenciais, conteúdo bruto completo, token, hash de autenticação ou stacktrace para o usuário. Erros de UI retornam uma referência de correlação.

## 25. Migrations incrementais

Foram criadas e aplicadas em homologação, nesta ordem:

1. `20260813191143_p2_2_ingestao_financeira_versionada_rlx.sql` — modelo, bucket, RPC de publicação, views, RLS e ação sensível;
2. `20260813193629_p2_2_complemento_linhagem_sem_movimento_rlx.sql` — linhagem adicional, versão vigente única, fingerprints e declaração sem movimento;
3. `20260813194809_p2_2_lock_ciclo_financeiro_rlx.sql` — claim transacional do ciclo;
4. `20260813195427_p2_2_refresh_views_linhagem_rlx.sql` — atualização das views com colunas de linhagem;
5. `20260813201000_p2_2_hardening_rls_indices_rlx.sql` — `security_invoker` e índices de acesso futuro;
6. `20260813202000_p2_2_escopo_hibrido_rlx.sql` — separação entre privilégio técnico de Super Admin e acesso operacional por fundo;
7. `20260813203000_p2_2_helper_rls_super_admin_rlx.sql` — helper RLS dedicado e policies técnicas finais.

As duas últimas migrations são correções incrementais deliberadas do hardening RLS. Nenhuma migration já aplicada foi reescrita.

## 26. Golden dataset homologado

O dataset temporal D-4 a D-1 foi ingerido no fundo principal de QA:

| Dia | Carteira | Estoque | Aquisições | Liquidações |
|---|---:|---:|---:|---:|
| D-4 | 1 | 82 | completo vazio | completo vazio |
| D-3 | 1 | 84 | 15 | 12 |
| D-2 | 1 | 86 | 15 (V1) → 15 (V2) | completo vazio |
| D-1 | 1 | 90 (V1) → 89 (V2) | completo vazio | 12 |

Também foram validados:

- retificação com preservação da versão anterior;
- `COMPLETO_VAZIO` explícito;
- snapshot incompleto bloqueado;
- arquivo duplicado reutilizado;
- CSV com delimitador dentro de campo cotado;
- UTF-8, BOM e Windows-1252;
- datas impossíveis;
- valores monetários BR e US;
- bigint externo preservado como texto;
- arquivo adversarial de outro fundo com 12 linhas, sem vazamento cross-fund.

Uma segunda execução completa reutilizou todas as importações por hash, sem criar novas versões ou linhas. A idempotência foi comprovada no banco de homologação.

## 27. Verificações de banco

O verificador read-only aprovou 44 verificações de schema, contagens, lifecycle, completude, publicação vigente, retificação, hash, bigint, encoding, cross-fund e idempotência.

O verificador transacional de segurança aprovou 29 verificações. Ele cobre:

- Super Admin em dados técnicos;
- gestor no canônico do fundo autorizado e bloqueio no outro fundo;
- usuário híbrido nos contextos administrativo e operacional;
- cedente e sacado sem acesso;
- consultor por identidade substituta quando não há perfil real na massa;
- anônimo sem acesso;
- escrita direta bloqueada;
- publicação RPC permitida somente ao contexto autorizado;
- concorrência do lock do cron.

Todas as mutações do verificador de segurança são executadas em uma única transação e revertidas ao final.

## 28. Testes automatizados

Os testes focados cobrem parser, formatos monetários, datas, encoding, delimitadores cotados, completude, fundo divergente, provider timeout, contexto de fundo, contrato do cron e estrutura das migrations.

Comandos de aceitação:

```text
npx tsc --noEmit
npm test -- --run
npm run lint
git diff --check
npx next build --webpack
npm run homolog:rlx:financeiro:verify -- --expected-project-ref fhgkmggthxikfpogrvaa
npm run homolog:rlx:financeiro:verify-security -- --expected-project-ref fhgkmggthxikfpogrvaa
```

Resultado final desta entrega:

- `npx tsc --noEmit`: aprovado;
- `npm test -- --run`: 120 arquivos e 878 testes aprovados;
- `npm run lint`: aprovado sem erros; permanecem seis warnings preexistentes fora do P2.2;
- `git diff --check`: aprovado;
- `npx next build --webpack`: aprovado para 76 páginas; permanecem warnings preexistentes do Handlebars sobre `require.extensions`;
- verificador golden read-only: 44 verificações aprovadas;
- verificador transacional RLS/concorrência: 29 verificações aprovadas, com rollback integral;
- varredura dos arquivos alterados: nenhum segredo ou arquivo `.env` incluído.

## 29. Arquivos principais

- `src/lib/rlx/ingestao/parser.ts` — parsing e normalização versionados;
- `src/lib/rlx/ingestao/layouts.ts` — contratos por família;
- `src/lib/rlx/ingestao/ingestao.server.ts` — upload privado, idempotência, staging e compensação;
- `src/lib/rlx/ingestao/provider.ts` — interface e timeout de providers;
- `src/lib/rlx/ingestao/cron.server.ts` — orquestração diária;
- `src/app/api/cron/rlx-financeiro/route.ts` — autenticação e calendário do cron;
- `src/lib/admin/dados-financeiros.server.ts` — loader técnico do Super Admin;
- `src/components/admin/fundo-dados-financeiros.tsx` — interface administrativa;
- `src/app/admin/fundos/dados-financeiros-actions.ts` — upload, ausência de movimento e publicação MFA;
- `scripts/homologacao/rlx-financeiro/` — aplicação segura, golden e verificadores;
- `supabase/migrations/20260813*_p2_2_*.sql` — schema e hardening incremental.

## 30. Limitações e riscos residuais

- Não existe provider real configurado; o cron retorna ciclo vazio até que uma integração oficial seja implementada.
- Layouts são golden/QA, não contratos oficiais de Sinqia ou administradora.
- Não foi implementado parser ZIP.
- Timeout do parser é cooperativo, não preemptivo.
- O catálogo definitivo de movimentos e a regra de liquidação parcial permanecem em aberto.
- CPF/CNPJ inválido é warning nos layouts atuais; a criticidade deverá ser confirmada por família no layout oficial.
- Smoke manual completo em browser e teste com arquivo real do provedor dependem de credenciais/layout externo.
- O agendamento Vercel precisa ser confirmado no ambiente de deploy após merge e publicação.
- O schema local gerado foi atualizado no código, mas a fonte de verdade executada nesta etapa foi o banco remoto de homologação.

## 31. Próximas fases

- P2.3: matching técnico entre títulos financeiros e entidades operacionais, além da conciliação definida pelo domínio.
- Etapa posterior de integração: provider real, credenciais seguras, contrato de layout oficial, retry operacional e observabilidade externa.
- P2.5: resolução do PL D-2, fallback aprovado e cálculo/controle do limite de 40%.

Nenhuma dessas regras deve ser implementada dentro do pipeline P2.2.

## 32. Checklist antes de produção

- [ ] Revisar migrations em ambiente limpo e registrar checksums.
- [ ] Aplicar migrations por pipeline controlado, nunca pelo frontend.
- [ ] Confirmar bucket privado e policies no projeto de produção.
- [ ] Configurar provider e credenciais oficiais em cofre seguro.
- [ ] Validar layouts com arquivos reais e responsável da administradora.
- [ ] Executar golden e matriz RLS no ambiente pré-produção.
- [ ] Executar smoke de upload, preview, publicação MFA e retificação.
- [ ] Confirmar cron, timezone, calendário ANBIMA, timeout e alertas.
- [ ] Validar volume real próximo a 20 MB/100 mil linhas.
- [ ] Confirmar plano de rollback e retenção dos arquivos brutos.
- [ ] Validar que produção não contém massa golden.

## 33. Parecer técnico

A fundação P2.2 está preparada para múltiplos fundos, múltiplos provedores e novos layouts versionados. A publicação atômica, a preservação do bruto, o staging integral, a linhagem e o isolamento RLS fornecem uma base segura para as próximas fases.

O que ainda impede considerar o fluxo financeiro pronto para produção não é a estrutura canônica, mas a ausência de provider/layout oficial, a homologação com arquivos reais, a validação operacional do cron e as regras de negócio que pertencem explicitamente ao P2.3 e ao P2.5.
