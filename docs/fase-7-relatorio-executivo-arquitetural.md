# Fase 7 — Relatório executivo e arquitetural

Este documento consolida a documentação oficial da Fase 7 do BW Antecipa: CNAB configurável, versionado e rastreável por fundo, com integração Fromtis modelada por fundo e centralização das configurações no cadastro do fundo.

Fontes de código usadas nesta documentação:

- Migration: `supabase/migrations/20260721194546_fase7_cnab_configuravel_rastreavel.sql`
- Cadastro do fundo: `src/app/gestor/fundos/[id]/page.tsx`
- Lista de fundos: `src/app/gestor/fundos/page.tsx`
- Actions CNAB/integrações: `src/lib/actions/configuracoes-cnab.ts`
- Resolvedor CNAB: `src/lib/cnab/resolver-configuracao.ts`
- Domínio CNAB: `src/lib/cnab/domain.ts`
- Gerador CNAB444: `src/lib/cnab/gerarCnab444.ts`
- Layout CNAB444: `src/lib/cnab/layouts/cnab444.ts`
- API de geração: `src/app/api/contratos/gerar-cnab/route.ts`
- Integração Fromtis: `src/lib/fromtis/remessa.ts`
- Templates por fundo: `src/components/templates/TemplatesDoFundo.tsx`
- Políticas por fundo: `src/components/politicas/PoliticasDoFundo.tsx`
- Mapeamento posicional: `docs/cnab-field-mapping.md`

## 1. Objetivo da fase

Antes da Fase 7, a geração CNAB dependia de valores operacionais fixos no código e não havia uma entidade versionada capaz de preservar historicamente quais parâmetros foram usados em cada remessa. Isso impedia operar corretamente múltiplos fundos com códigos, bancos, contas, convênios e integrações diferentes.

A Fase 7 resolve esse problema criando uma arquitetura em que o fundo é a raiz das configurações operacionais. CNAB, integração Fromtis, políticas e templates passam a ser administrados a partir do cadastro/detalhe do fundo. A remessa passa a registrar a versão CNAB usada, o hash dessa configuração, o sequencial reservado e, quando enviada, a versão da integração utilizada.

## 2. Arquitetura antes x depois

### Antes

```text
Operação
 ↓
Gerador CNAB
 ↓
Valores fixos no código
 ↓
Arquivo gerado
 ↓
Campo legado na operação / envio Fromtis legado
```

Características observadas antes da Fase 7:

- parâmetros como banco, carteira, espécie, convênio e código originador não eram resolvidos por uma configuração versionada de fundo;
- a remessa não preservava a versão de configuração usada;
- a integração Fromtis era tratada no fluxo legado de envio, sem versão de integração por fundo;
- não havia bucket dedicado e rastreio normalizado para remessas CNAB;
- a interface de configuração CNAB, quando criada inicialmente, precisava ser trazida para dentro do cadastro do fundo para evitar um módulo administrativo isolado.

### Depois

```text
Gestor
 ↓
Fundo
 ↓
Configuração CNAB versionada
 ↓
Versão publicada
 ↓
Resolvedor CNAB
 ↓
Modelo intermediário
 ↓
Serializador CNAB444
 ↓
Storage remessas-cnab
 ↓
remessas_cnab + remessas_cnab_operacoes
 ↓
Integração Fromtis versionada por fundo
```

No estado atual:

- o detalhe do fundo (`/gestor/fundos/[id]`) concentra as abas Dados gerais, Política operacional, Templates jurídicos, CNAB e Integrações;
- a aba CNAB cria/importa configurações, cria versões, publica versões e gera arquivo de teste;
- a aba Integrações cria versões da integração Fromtis por fundo, com ambiente, endpoint e referência de credencial;
- a rota `/gestor/configuracoes-cnab` redireciona para `/gestor/fundos`, evitando duas telas independentes de edição;
- as rotas `/gestor/politicas` e `/gestor/templates` permanecem como páginas consolidadas, mas não aparecem no menu lateral e reutilizam os componentes do fundo.

## 3. Decisões arquiteturais

### A configuração CNAB pertence ao fundo

Cada fundo pode ter banco, agência, conta, carteira, convênio, espécie, código originador e parâmetros de layout próprios. Por isso, `configuracoes_cnab.fundo_id` é obrigatório e todas as actions recebem `fundoId`. A interface principal fica no detalhe do fundo (`src/app/gestor/fundos/[id]/page.tsx`).

### A configuração CNAB é versionada

Alterar parâmetros CNAB muda o arquivo posicional gerado. Para evitar perda de rastreabilidade, os parâmetros ficam em `configuracao_cnab_versoes`. Uma nova alteração operacional deve gerar nova versão, não sobrescrever a versão publicada.

### A remessa guarda a versão utilizada

`remessas_cnab.configuracao_cnab_versao_id`, `configuracao_versao` e `configuracao_hash` preservam qual configuração produziu o arquivo. Isso permite auditar remessas antigas mesmo após a publicação de uma versão nova.

### O código originador não fica hardcoded

O código originador varia por fundo e é campo obrigatório em `configuracao_cnab_versoes.codigo_originador`. O serializador (`src/lib/cnab/layouts/cnab444.ts`) usa `cfg.codigoOriginador`, preservando zeros à esquerda e rejeitando valores ausentes, longos ou com caracteres inválidos.

### O código originador é string

O código originador pode conter zeros à esquerda. Por isso, o domínio (`src/lib/cnab/domain.ts`) trata `codigoOriginador` como `string`, a validação exige texto numérico e o layout usa padding textual, sem conversão para número.

### CNAB e Fromtis são conceitos separados

CNAB define formato de arquivo, posições, conta, banco e serialização. Fromtis define destino de envio, ambiente, cliente, endpoint e referência de credencial. Por isso existem `configuracoes_cnab`/`configuracao_cnab_versoes` e `integracoes_fundo`/`integracao_fundo_versoes` separadas.

### A integração Fromtis pertence ao fundo

Como cada fundo pode usar identificador, ambiente, endpoint e credencial diferentes, a integração é vinculada a `fundo_id`. O fluxo de envio (`src/lib/fromtis/remessa.ts`) resolve a integração Fromtis vigente pelo fundo da remessa/operação.

### Segredos não são gravados nas tabelas comuns

A modelagem armazena apenas `credential_ref`, `secret_name` e `vault_key`. O segredo real continua fora da tabela, resolvido por variável de ambiente no fluxo atual. A gestão criptografada de segredos foi explicitamente deixada para fase futura.

### Existe importação da configuração legado

`importarConfiguracaoCnabLegado` cria uma configuração inicial com os valores legados definidos em `CONFIGURACAO_CNAB_LEGADO_PADRAO`. Isso permite migração gradual e comparação via golden file sem mudar o arquivo legado esperado.

### Existe importação operacional do padrão legado

O resolvedor CNAB (`resolverConfiguracaoCnab`) deve operar com uma configuração publicada no fundo. A compatibilidade com o legado ocorre pela importação do padrão legado para uma versão inicial publicada, e não por uso silencioso de valores fixos durante a geração de uma nova remessa.

### Nota de estabilização técnica

Após a estabilização técnica, a decisão operacional documentada passa a ser: novas remessas devem exigir configuração CNAB publicada no contexto do fundo. A importação legado continua existindo como mecanismo de migração inicial do fundo, mas não deve ser tratada como fallback silencioso para geração operacional nova. Operações históricas permanecem preservadas pelos registros e arquivos já gravados; reprocessamento/geração nova exige contexto configurado e publicado.

### A rota antiga de CNAB não edita configuração

`/gestor/configuracoes-cnab` redireciona para `/gestor/fundos`. A decisão evita duas interfaces independentes alterando a mesma entidade operacional.

### Políticas e templates ficam dentro do fundo

Políticas continuam tecnicamente ligadas ao vínculo `cedente_fundos`, mas a gestão foi centralizada no contexto do fundo via `PoliticasDoFundo`. Templates jurídicos são ligados diretamente ao fundo e renderizados por `TemplatesDoFundo`.

## 4. Modelo de dados

A migration da Fase 7 cria sete tabelas, um bucket de storage, funções, triggers, índices e policies RLS.

### `configuracoes_cnab`

Finalidade: entidade raiz da configuração CNAB de um fundo.

Principais campos:

- `id`: identificador da configuração;
- `fundo_id`: fundo dono da configuração;
- `codigo`: código técnico único dentro do fundo;
- `nome` e `descricao`: identificação operacional;
- `finalidade`: atualmente restrita a `remessa`;
- `status`: `rascunho`, `ativa` ou `desativada`;
- `created_by`, `created_at`, `updated_at`: autoria e auditoria.

Relacionamentos:

- `fundo_id` referencia `fundos(id)`;
- `created_by` referencia `profiles(id)`;
- é referenciada por `configuracao_cnab_versoes`, `sequencias_remessa` e `remessas_cnab`.

Constraints e índices:

- `UNIQUE (fundo_id, codigo)`;
- check de código técnico com regex `^[a-z0-9_\-]+$`;
- check de finalidade em `('remessa')`;
- check de status;
- índice único parcial `uq_configuracoes_cnab_ativa_fundo_finalidade`, garantindo uma configuração ativa por fundo/finalidade;
- índice `idx_configuracoes_cnab_fundo_status`.

Regras de negócio:

- configuração usada por remessa não pode ser excluída;
- configuração com versão publicada não pode ser excluída, deve ser desativada;
- ações de criação/alteração validam perfil gestor e existência do fundo.

### `configuracao_cnab_versoes`

Finalidade: preservar versões imutáveis dos parâmetros CNAB usados na geração.

Principais campos:

- `configuracao_cnab_id`: configuração raiz;
- `versao`: número sequencial da versão;
- `layout`: atualmente `cnab444`;
- `versao_layout`;
- dados bancários e operacionais: `codigo_banco`, `banco`, `agencia`, `conta`, `digito_conta`, `carteira`, `convenio`;
- identificadores: `codigo_originador`, `codigo_empresa`, `tipo_inscricao`, `numero_inscricao`;
- parâmetros de título: `especie_titulo`, `tipo_recebivel`;
- `configuracao`: JSONB de opções específicas do layout;
- `conteudo_hash`: hash canônico da configuração normalizada;
- status e publicação: `status`, `publicada_por`, `publicada_em`, `vigente_desde`, `vigente_ate`.

Relacionamentos:

- referencia `configuracoes_cnab(id)`;
- `publicada_por` referencia `profiles(id)`;
- é referenciada por `remessas_cnab.configuracao_cnab_versao_id`.

Constraints e índices:

- `UNIQUE (configuracao_cnab_id, versao)`;
- `versao > 0`;
- `layout IN ('cnab444')`;
- vigência válida (`vigente_ate IS NULL OR vigente_ate > vigente_desde`);
- `codigo_originador ~ '^[0-9]{1,20}$'`;
- `conteudo_hash` com 64 caracteres hexadecimais;
- status em `rascunho`, `publicada`, `substituida`, `cancelada`;
- versão publicada exige `publicada_por` e `publicada_em`;
- índice único parcial `uq_configuracao_cnab_versoes_vigente_aberta`, garantindo uma versão publicada aberta por configuração;
- índice `idx_configuracao_cnab_versoes_config_status`.

Regras de negócio:

- versão publicada não pode ter campos operacionais alterados;
- versão publicada usada por remessa não pode ser excluída;
- versões publicadas da mesma configuração não podem ter vigência sobreposta;
- código originador é obrigatório, textual, numérico e com máximo de 20 caracteres no CNAB444.

### `sequencias_remessa`

Finalidade: reservar sequenciais de arquivo por configuração CNAB e data de referência.

Principais campos:

- `configuracao_cnab_id`;
- `data_referencia`;
- `proximo_sequencial`;
- `updated_at`.

Relacionamentos:

- referencia `configuracoes_cnab(id)`.

Constraints e índices:

- chave primária composta `(configuracao_cnab_id, data_referencia)`;
- `proximo_sequencial > 0`.

Regras de negócio:

- a função `reservar_sequencial_remessa(uuid, date)` faz `INSERT ... ON CONFLICT DO UPDATE`, incrementando o sequencial de forma transacional;
- a aplicação usa essa função antes de serializar a remessa final.

### `remessas_cnab`

Finalidade: trilha principal da remessa gerada.

Principais campos:

- `fundo_id`;
- `configuracao_cnab_id`;
- `configuracao_cnab_versao_id`;
- `integracao_fundo_versao_id`;
- `configuracao_versao`;
- `configuracao_hash`;
- `status`;
- `bucket`, `storage_path`, `nome_arquivo`;
- `sha256`;
- `quantidade_registros`, `quantidade_titulos`, `valor_total`;
- `sequencial`;
- `idempotency_key`, `payload_hash`;
- `gerado_por`, `gerado_em`, `enviado_em`, `retorno_resumido`.

Relacionamentos:

- referencia `fundos`, `configuracoes_cnab`, `configuracao_cnab_versoes`;
- opcionalmente referencia `integracao_fundo_versoes` quando enviada;
- é relacionada às operações por `remessas_cnab_operacoes`.

Constraints e índices:

- status em `gerada`, `validada`, `enviada`, `aceita`, `rejeitada`, `cancelada`, `erro`;
- hashes `sha256`, `configuracao_hash` e `payload_hash` devem ser hexadecimais de 64 caracteres;
- `quantidade_registros >= 3` e `quantidade_titulos >= 1`;
- `sequencial > 0`;
- unicidade de `(bucket, storage_path)`;
- unicidade de `idempotency_key`;
- índices `idx_remessas_cnab_fundo_status` e `idx_remessas_cnab_config_versao`.

Regras de negócio:

- remessa não pode ser excluída, pois compõe trilha operacional;
- idempotência evita gerar arquivo divergente para o mesmo conjunto fundo/configuração/operações;
- remessa preserva a configuração usada por versão e hash.

### `remessas_cnab_operacoes`

Finalidade: associar remessas às operações que originaram seus títulos.

Principais campos:

- `remessa_cnab_id`;
- `operacao_id`;
- `created_at`.

Relacionamentos:

- referencia `remessas_cnab(id)`;
- referencia `operacoes(id)`.

Constraints e índices:

- chave primária composta `(remessa_cnab_id, operacao_id)`;
- índice `idx_remessas_cnab_operacoes_operacao`.

Regras de negócio:

- permite consulta de quais operações foram incluídas em determinada remessa;
- participa das policies de leitura contextual para cedente e consultor.

### `integracoes_fundo`

Finalidade: entidade raiz da integração externa de um fundo.

Principais campos:

- `fundo_id`;
- `provedor`: `fromtis` ou `sinqia`;
- `nome`;
- `status`;
- `created_by`, `created_at`, `updated_at`.

Relacionamentos:

- referencia `fundos(id)`;
- possui versões em `integracao_fundo_versoes`.

Constraints e índices:

- `provedor IN ('fromtis', 'sinqia')`;
- status em `rascunho`, `ativa`, `desativada`;
- `UNIQUE (fundo_id, provedor)`;
- índice único parcial `uq_integracoes_fundo_ativa_provedor`;
- índice `idx_integracoes_fundo_fundo`.

Regras de negócio:

- cada fundo pode ter uma configuração por provedor;
- a implementação atual usa Fromtis;
- Sinqia aparece no domínio como provedor permitido, mas não está implementada operacionalmente.

### `integracao_fundo_versoes`

Finalidade: versionar parâmetros não sensíveis de integração por fundo/provedor.

Principais campos:

- `integracao_fundo_id`;
- `versao`;
- `ambiente`: `homologacao` ou `producao`;
- `status`;
- `identificador_cliente`;
- `codigo_originador`;
- `endpoint_base`;
- `configuracao_nao_sensivel`;
- `credential_ref`, `secret_name`, `vault_key`;
- vigência e publicação: `vigente_desde`, `vigente_ate`, `publicada_por`, `publicada_em`.

Relacionamentos:

- referencia `integracoes_fundo(id)`;
- `publicada_por` referencia `profiles(id)`;
- é referenciada por `remessas_cnab.integracao_fundo_versao_id`.

Constraints e índices:

- `UNIQUE (integracao_fundo_id, versao)`;
- `versao > 0`;
- ambiente restrito a homologação/produção;
- status em `rascunho`, `publicada`, `substituida`, `cancelada`;
- vigência válida;
- versão publicada exige `publicada_por` e `publicada_em`;
- `credential_ref <> ''`;
- índice único parcial `uq_integracao_fundo_versoes_vigente_aberta`;
- índice `idx_integracao_fundo_versoes_status`.

Regras de negócio:

- versão publicada de integração é imutável;
- versões publicadas da mesma integração não podem ter vigência sobreposta;
- versão usada por remessa não pode ser excluída;
- segredos reais não devem ser armazenados nessa tabela.

### Bucket `remessas-cnab`

Finalidade: armazenar arquivos CNAB gerados.

Configuração:

- bucket privado;
- limite de arquivo: 10 MB;
- constante exposta em `src/lib/storage.ts` como `buckets.remessasCnab`.

Regras de negócio:

- a API salva o arquivo no bucket e registra o caminho em `remessas_cnab.storage_path`;
- o download usa o storage path registrado.

## 5. Fluxo completo

```text
Gestor
 ↓
/gestor/fundos
 ↓
/gestor/fundos/[id]
 ↓
Aba CNAB
 ↓
Criar configuração ou importar legado
 ↓
Criar versão
 ↓
Publicar versão
 ↓
Operação aprovada
 ↓
POST /api/contratos/gerar-cnab
 ↓
carregarContextoCnab444
 ↓
resolverConfiguracaoCnab
 ↓
reservar_sequencial_remessa
 ↓
gerarRemessaCnab444ComSequencial
 ↓
validarCnab444Conteudo
 ↓
storage remessas-cnab
 ↓
remessas_cnab
 ↓
remessas_cnab_operacoes
 ↓
enviarRemessaFromtis
 ↓
resolver integração Fromtis vigente do fundo
 ↓
enviar SOAP
 ↓
atualizar remessa/operação com retorno
```

Detalhamento por etapa:

1. O gestor acessa `/gestor/fundos` e entra no detalhe do fundo.
2. Na aba CNAB, o gestor cria uma configuração ou importa a configuração legado.
3. A versão CNAB é criada como rascunho em `configuracao_cnab_versoes`.
4. Ao publicar, a versão anterior aberta é marcada como `substituida`, a nova versão vira `publicada`, e a configuração raiz fica `ativa`.
5. Quando uma operação gera CNAB, a API `src/app/api/contratos/gerar-cnab/route.ts` carrega contexto e resolve a versão CNAB vigente.
6. O sequencial é reservado no banco pela função `reservar_sequencial_remessa`.
7. O gerador monta o modelo intermediário e chama o serializador CNAB444.
8. O conteúdo é validado, salvo no bucket `remessas-cnab` e registrado em `remessas_cnab`.
9. A associação entre remessa e operação é gravada em `remessas_cnab_operacoes`.
10. No envio Fromtis, o sistema resolve a integração vigente do fundo e registra `integracao_fundo_versao_id` na remessa enviada.

## 6. Compatibilidade

A compatibilidade com o comportamento legado foi preservada por quatro mecanismos.

### Padrão legado importável

`CONFIGURACAO_CNAB_LEGADO_PADRAO` mantém os valores já usados pelo sistema, incluindo:

- banco `611`;
- nome banco `BBBBBBBBBBBBBBB`;
- código originador `00000000000000500497`;
- código empresa `00000000000000500497`;
- espécie `61`;
- tipo de recebível `01`;
- serviço `COBRANCA`;
- identificação de sistema `MX`.

Esse padrão é usado para importar a configuração inicial do fundo piloto/migrado. Ele não deve substituir a exigência de uma versão publicada para novas gerações CNAB.

### Importação gradual

`importarConfiguracaoCnabLegado` cria configuração e versão inicial no fundo com base no padrão legado. Isso permite migrar fundo a fundo, sem exigir troca global.

### Preservação histórica

Remessas registram `configuracao_cnab_versao_id` e `configuracao_hash`. Mesmo que uma nova versão seja publicada, remessas antigas continuam apontando para a versão anterior.

### Impacto zero nas operações antigas

A migration mantém campos legados em `operacoes` durante a transição. Além disso, a geração usa idempotência e path de storage próprio, sem apagar arquivos ou registros anteriores.

## 7. Segurança

### Validações server-side

As actions em `src/lib/actions/configuracoes-cnab.ts` chamam `requireGestor` e validam o fundo antes de criar/alterar configuração. Publicação de versão CNAB e integração valida que a versão pertence ao fundo recebido.

As correções arquiteturais também adicionaram validação contextual em:

- `criarPoliticaOperacionalNoFundo`;
- `criarVersaoPoliticaNoFundo`;
- `publicarVersaoPoliticaNoFundo`;
- `desativarPoliticaNoFundo`;
- `criarVersaoTemplateNoFundo`;
- `publicarVersaoTemplateNoFundo`;
- `desativarTemplateDocumentoNoFundo`.

### RLS

A migration habilita RLS em:

- `configuracoes_cnab`;
- `configuracao_cnab_versoes`;
- `integracoes_fundo`;
- `integracao_fundo_versoes`;
- `sequencias_remessa`;
- `remessas_cnab`;
- `remessas_cnab_operacoes`.

Gestores têm policies de administração. Cedentes e consultores têm leitura contextual de remessas por meio de `usuario_pode_ler_remessa_cnab`.

### Proteção contra acesso cruzado

Actions exigem `fundoId` e validam relacionamento entre versão/configuração e fundo. No banco, as foreign keys preservam consistência entre remessas, configuração, fundo e integração.

### Versionamento imutável

Triggers impedem alterar campos operacionais de versões publicadas de CNAB e integração. Também impedem exclusão de versões publicadas usadas por remessas.

### Credenciais

As tabelas de integração armazenam apenas referência de credencial. O segredo real não é persistido em JSON nem em tabela comum.

## 8. Escalabilidade

### Novos fundos

Cada fundo possui suas próprias configurações CNAB, versões e integrações. A criação de um novo fundo não exige alterar o gerador, desde que a configuração seja cadastrada/publicada.

### Novos layouts CNAB

O domínio já possui abstrações `CnabLayout`, `GeradorCnab`, `RemessaOperacao` e `ConfiguracaoCnabResolvida`. Hoje o check constraint aceita apenas `cnab444`; para um novo layout será necessário ampliar o domínio, constraint e registrar um novo serializador.

### Novos provedores

`integracoes_fundo.provedor` já aceita `fromtis` e `sinqia`. A modelagem suporta múltiplos provedores por fundo. A implementação operacional de envio existe para Fromtis; Sinqia ainda depende de fase própria.

### Novos templates

Templates jurídicos permanecem versionados por fundo e a UI `TemplatesDoFundo` funciona dentro do detalhe do fundo. Novos tipos podem ser adicionados respeitando a modelagem já criada na Fase 6.

### Novos bancos

Banco, agência, conta, carteira, convênio, espécie e identificadores saíram do gerador hardcoded e passaram a ser parâmetros da versão CNAB. Isso permite cadastrar bancos diferentes sem alterar o serializador, desde que o layout posicional continue compatível.

## 9. Dívidas técnicas

Itens não implementados nesta fase:

- integração Sinqia operacional;
- gestão criptografada de segredos;
- teste real de conexão Fromtis pela interface;
- editor visual avançado de layouts;
- múltiplos layouts CNAB além de `cnab444`;
- homologação externa com administrador/custodiante;
- validação automatizada contra arquivo de retorno CNAB;
- tela dedicada de auditoria consolidada de remessas CNAB;
- aplicação das migrations em todos os ambientes não foi executada pelo código, pois o repositório não usa Supabase local.

Limitações conhecidas:

- a UI de CNAB no detalhe do fundo usa campos de formulário diretos para CNAB444, não um editor genérico de posições;
- o padrão legado importável é útil para transição, mas a operação alvo deve ser configuração publicada por fundo;
- a Fromtis ainda resolve credenciais por referência/ambiente, não por vault gerenciado pela aplicação;
- o check constraint de layout restringe o banco a `cnab444` até a próxima evolução de layouts.

## 10. Próxima fase

A próxima fase recomendada deve transformar a arquitetura versionada em operação integrada e homologável ponta a ponta.

Escopo sugerido:

1. Aplicar e validar a migration em homolog.
2. Popular configuração CNAB inicial dos fundos reais.
3. Publicar versões CNAB por fundo.
4. Configurar integração Fromtis por fundo em ambiente de homologação.
5. Implementar teste de conexão Fromtis a partir da aba Integrações.
6. Implementar leitura e registro estruturado de retornos Fromtis/CNAB.
7. Criar visão de auditoria de remessas por fundo, configuração e status.
8. Validar arquivos com administrador/custodiante.
9. Planejar fase de segurança para credenciais criptografadas/vault.

## 11. Riscos residuais

- Migration pode ainda não estar aplicada em todos os ambientes.
- O comportamento real depende de homologação externa com administrador/custodiante.
- Fromtis precisa ser validada com endpoint, credenciais e payload reais por fundo.
- Importação incompleta do padrão legado pode atrasar a publicação da configuração CNAB exigida para novas remessas.
- Testes integrados com Supabase remoto não foram executados localmente.
- Testes de concorrência do sequencial dependem de execução em banco real.
- RLS precisa ser validada no ambiente aplicado com usuários reais de cada perfil.
- A configuração padrão legado precisa ser conferida contra o layout oficial do administrador antes de produção.

## 12. Checklist de homologação

☐ Migration `20260721194546_fase7_cnab_configuravel_rastreavel.sql` aplicada em homolog

☐ Bucket privado `remessas-cnab` criado/validado

☐ RLS validada para gestor

☐ RLS validada para cedente

☐ RLS validada para consultor

☐ Configuração CNAB legado importada para o fundo piloto

☐ Versão CNAB publicada para o fundo piloto

☐ Código originador validado com zeros à esquerda

☐ Geração de arquivo de teste validada

☐ Golden file comparado com arquivo legado esperado

☐ Geração real de CNAB por operação validada

☐ Registro em `remessas_cnab` validado

☐ Registro em `remessas_cnab_operacoes` validado

☐ Upload no storage validado

☐ Download da remessa validado

☐ Integração Fromtis cadastrada por fundo

☐ Homologação Fromtis executada

☐ Retorno Fromtis validado

☐ Teste de idempotência executado

☐ Teste de concorrência de sequencial executado

☐ Teste de rollback operacional definido

☐ Testes de autorização cruzada executados

☐ Build executado

☐ Testes automatizados executados

## 13. Métricas da implementação

- Tabelas criadas: 7
  - `configuracoes_cnab`
  - `configuracao_cnab_versoes`
  - `sequencias_remessa`
  - `remessas_cnab`
  - `remessas_cnab_operacoes`
  - `integracoes_fundo`
  - `integracao_fundo_versoes`
- Bucket criado/configurado: 1 (`remessas-cnab`)
- Migration adicionada: 1
- Componentes criados: 2
  - `PoliticasDoFundo`
  - `TemplatesDoFundo`
- Página nova principal: 1
  - `/gestor/fundos/[id]`
- Página de redirecionamento criada: 1
  - `/gestor/configuracoes-cnab`
- Páginas reaproveitadas/alteradas: 4
  - `/gestor/fundos`
  - `/gestor/politicas`
  - `/gestor/templates`
  - sidebar do gestor
- Actions criadas/alteradas: 3 arquivos principais
  - `configuracoes-cnab.ts`
  - `politica.ts`
  - `templates.ts`
- Módulos CNAB criados/alterados: 5
  - `domain.ts`
  - `resolver-configuracao.ts`
  - `gerarCnab444.ts`
  - `layouts/cnab444.ts`
  - `validar-remessa.ts`
- Testes adicionados: 1 arquivo de teste CNAB444 com 8 cenários.
- Fixture adicionada: 1 golden file.
- Cobertura aproximada da Fase 7: cobre validação unitária do serializador CNAB444, código originador, golden file, zeros à esquerda, ausência de constante residual e preservação histórica simulada. Não cobre integração real com Supabase remoto nem envio externo Fromtis.

Validações executadas após a implementação:

- `npx tsc --noEmit`
- `npm test`
- `npm run build` com `NODE_OPTIONS=--max-old-space-size=8192`
- lint focado nos arquivos alterados

Observação: o lint global ainda possui débitos antigos fora do escopo da Fase 7.

## 14. Conclusão executiva

A arquitetura está preparada para múltiplos fundos. A configuração CNAB e a integração Fromtis passam a ser resolvidas por `fundo_id`, com versões, vigência, status e rastreabilidade por remessa.

A arquitetura está parcialmente preparada para novos layouts. O domínio e a separação entre resolvedor, modelo intermediário e serializador facilitam adicionar layouts; porém o banco ainda restringe `layout` a `cnab444`, então novos layouts exigirão migration e novo serializador.

A arquitetura está preparada em modelagem para novos provedores. `integracoes_fundo` já aceita `fromtis` e `sinqia`, mas apenas Fromtis possui fluxo operacional implementado.

Próximos grandes blocos do roadmap:

1. homologação real da Fase 7 em banco remoto;
2. integração externa ponta a ponta por fundo;
3. retorno/baixa/status estruturado das remessas;
4. gestão segura de credenciais;
5. novos layouts/provedores conforme demanda operacional;
6. auditoria consolidada de remessas e configurações.

O que ainda impede produção:

- migration precisa estar aplicada e validada no ambiente alvo;
- RLS precisa ser testada com usuários reais;
- arquivos precisam ser homologados com administrador/custodiante;
- Fromtis precisa ser validada por fundo com credenciais reais;
- concorrência de sequencial e idempotência precisam ser exercitadas em banco real;
- padrão legado importável deve ser tratado como mecanismo de transição, não como configuração operacional definitiva.

Parecer técnico: a Fase 7 muda o sistema de uma geração CNAB acoplada a valores fixos para uma arquitetura multifundo, versionada, auditável e extensível. O desenho atual é adequado para evolução controlada, desde que a homologação externa e a gestão segura de credenciais sejam concluídas antes de produção.
