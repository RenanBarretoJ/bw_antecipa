# Fase 8 — Integração Portal FIDC por fundo

Este documento registra a implementação da Fase 8 do BW Antecipa: integração configurável por fundo com o Portal FIDC — Sinqia.

## 1. Diagnóstico do legado

Antes desta fase, o fluxo técnico de envio ficava em `src/lib/fromtis/remessa.ts` e era acionado por `src/app/api/contratos/enviar-remessa/route.ts`.

Fluxo existente:

```text
Operação
 ↓
remessa_url / remessas_cnab_operacoes
 ↓
arquivo CNAB no storage
 ↓
resolver integração por fundo
 ↓
enviar SOAP
 ↓
atualizar operacoes.remessa_fromtis_*
 ↓
atualizar remessas_cnab quando existente
```

O protocolo existente é SOAP/XML, com envelope `importarArquivoRemessa`, headers `username` e `password`, arquivo CNAB compactado em ZIP e codificado em base64. O namespace técnico ainda contém `portal.fidc.fromtis.com.br`, por isso a pasta `src/lib/fromtis` foi mantida como adaptador legado.

Riscos identificados no legado:

- ausência de tabela estruturada de execuções;
- ausência de teste de conexão por fundo;
- idempotência externa insuficiente;
- mensagens e UI ainda citavam Fromtis;
- divergência de código originador CNAB x integração não era bloqueada;
- credenciais podiam tender a fallback global.

## 2. Nomenclatura

A nomenclatura visual e documental nova é:

- Portal FIDC;
- Portal FIDC — Sinqia quando o fornecedor precisa aparecer.

Mantido por compatibilidade técnica:

- pasta `src/lib/fromtis`;
- campos legados `operacoes.remessa_fromtis_id` e `operacoes.remessa_fromtis_retorno`;
- valor técnico `integracoes_fundo.provedor = 'fromtis'`;
- namespace SOAP existente.

Não foi feita renomeação cega em massa.

## 3. Arquitetura implementada

```text
Fundo
 ↓
Aba Integrações
 ↓
Portal FIDC — Sinqia
 ↓
integracoes_fundo
 ↓
integracao_fundo_versoes publicada e vigente
 ↓
remessas_cnab
 ↓
validação de código originador
 ↓
resolver credencial por credential_ref
 ↓
integracao_execucoes
 ↓
envio SOAP
 ↓
protocolo externo
 ↓
status/retorno registrado
```

Arquivos principais:

- `src/lib/portal-fidc/integracao.ts`: camada server-side do Portal FIDC;
- `src/lib/fromtis/remessa.ts`: adaptador legado que reexporta a nova camada;
- `src/app/gestor/fundos/[id]/page.tsx`: aba Integrações;
- `src/app/api/contratos/enviar-remessa/route.ts`: envio;
- `src/app/api/contratos/consultar-status-remessa/route.ts`: consulta de status;
- `supabase/migrations/20260722090000_fase8_portal_fidc_fundo.sql`: tabelas, RLS e policies.

## 4. Modelo de dados

### `integracao_execucoes`

Finalidade: registrar cada execução técnica da integração.

Campos principais:

- `fundo_id`;
- `integracao_fundo_versao_id`;
- `remessa_cnab_id`;
- `operacao_id`;
- `tipo_execucao`: `teste_conexao`, `envio_remessa`, `consulta_status`, `download_retorno`;
- `ambiente`: `homologacao` ou `producao`;
- `status`: `iniciada`, `sucesso`, `erro`, `timeout`, `cancelada`;
- `tentativa`;
- `idempotency_key`;
- `request_hash`;
- `protocolo_externo`;
- `codigo_resposta`;
- `mensagem_resumida`;
- `erro_categoria`;
- `duracao_ms`;
- timestamps de início/fim.

Regras:

- não armazena request/response completos;
- registra hash, código, protocolo e mensagem sanitizada;
- suporta múltiplas tentativas auditáveis;
- possui índices por fundo, remessa, operação e idempotência.

### `retornos_integracao`

Finalidade: preservar retornos externos quando houver arquivo ou payload disponível.

Campos principais:

- `fundo_id`;
- `integracao_execucao_id`;
- `remessa_cnab_id`;
- `tipo_retorno`;
- `bucket`;
- `storage_path`;
- `mime_type`;
- `tamanho_bytes`;
- `sha256`;
- `resumo_estruturado`.

Regras:

- arquivo/payload deve ficar em bucket privado;
- o banco guarda metadados, hash e resumo;
- não deve substituir storage por campo textual longo.

## 5. Credenciais

A configuração continua guardando apenas:

- `credential_ref`;
- `secret_name`;
- `vault_key`.

Nesta fase, o resolvedor usa variáveis de ambiente derivadas da referência:

```text
PORTAL_FIDC_CREDENTIAL_[REFERENCIA]_USERNAME
PORTAL_FIDC_CREDENTIAL_[REFERENCIA]_PASSWORD
```

Exemplo:

```text
credential_ref = portal_fidc_fundo_abc_homologacao

PORTAL_FIDC_CREDENTIAL_PORTAL_FIDC_FUNDO_ABC_HOMOLOGACAO_USERNAME
PORTAL_FIDC_CREDENTIAL_PORTAL_FIDC_FUNDO_ABC_HOMOLOGACAO_PASSWORD
```

Não há fallback global implícito para todos os fundos.

## 6. Teste de conexão

A aba Integrações possui ação `Testar conexão`.

O teste:

- exige gestor;
- valida fundo;
- valida versão de integração;
- resolve credencial;
- faz chamada HTTP segura e não financeira;
- registra execução em `integracao_execucoes`;
- retorna mensagem sanitizada.

O teste não:

- gera remessa;
- envia operação;
- altera status financeiro;
- grava segredo.

## 7. Envio de remessa

O envio usa `enviarRemessaPortalFidc`.

Etapas:

1. carregar remessa pela operação;
2. validar status permitido: `gerada`, `validada` ou `erro`;
3. resolver versão Portal FIDC publicada e vigente pelo fundo da remessa;
4. validar código originador CNAB x Portal FIDC;
5. resolver credencial por `credential_ref`;
6. baixar arquivo CNAB no storage;
7. recalcular SHA-256 e comparar com `remessas_cnab.sha256`;
8. criar execução;
9. enviar SOAP;
10. registrar protocolo;
11. atualizar execução;
12. atualizar `remessas_cnab`;
13. atualizar campos legados em `operacoes`.

Estados bloqueados:

- `cancelada`;
- `aceita`;
- `rejeitada`;
- qualquer status fora de `gerada`, `validada`, `erro`.

## 8. Código originador

Antes do envio, o sistema compara:

```text
remessas_cnab
 ↓
configuracao_cnab_versoes.codigo_originador

com

integracao_fundo_versoes.codigo_originador
```

Se houver divergência, o envio é bloqueado com erro claro e sem expor segredo.

## 9. Idempotência e retry

A chave idempotente é derivada de:

```text
remessa_cnab_id
integracao_fundo_versao_id
tipo_execucao
```

Se já houver execução `sucesso` com protocolo externo, o sistema retorna o protocolo anterior e não reenvia.

Retry automático:

- até 3 tentativas;
- apenas para `timeout`, HTTP 429, HTTP 5xx ou indisponibilidade;
- cada tentativa é registrada.

Não há retry automático para:

- autenticação inválida;
- código originador divergente;
- remessa em estado inválido;
- layout inválido;
- erro funcional definitivo.

## 10. Consulta de status

Foi criada função central:

```ts
mapearStatusPortalFidc(...)
```

Ela mapeia respostas conhecidas para:

- `aceita`;
- `rejeitada`;
- `enviada` pendente.

Status desconhecido é preservado como dado externo e tratado como pendente, não convertido silenciosamente em sucesso ou rejeição.

## 11. Interface

No cadastro do fundo, aba Integrações:

- mostra Portal FIDC — Sinqia;
- mostra versões, ambiente, vigência, publicação e credencial de referência;
- permite criar versão;
- permite editar rascunho;
- permite publicar;
- permite desativar;
- permite testar conexão;
- mostra execuções recentes.

Na operação:

- botão usa “Enviar CNAB para Portal FIDC”;
- protocolo é exibido como “Protocolo Portal FIDC”;
- existe ação para consultar status.

## 12. Segurança e RLS

Migration habilita RLS em:

- `integracao_execucoes`;
- `retornos_integracao`.

Policies:

- gestor administra;
- consultor lê execuções por operação permitida;
- cedente lê execuções por operação própria;
- sacado não possui policy de acesso;
- service role recebe grants técnicos.

Função SECURITY DEFINER:

- `usuario_pode_ler_integracao_execucao(uuid)`;
- usa `search_path = public`;
- não usa SQL dinâmico;
- resolve acesso por operação/cedente/consultor.

## 13. Compatibilidade

Preservado temporariamente:

- `src/lib/fromtis/remessa.ts`;
- `operacoes.remessa_fromtis_id`;
- `operacoes.remessa_fromtis_retorno`;
- protocolo SOAP técnico já existente.

Não foram mantidas duas implementações concorrentes de envio: o wrapper legado aponta para a nova camada Portal FIDC.

## 14. Limitações e riscos residuais

- O endpoint real do Portal FIDC precisa ser homologado.
- A consulta de status usa o protocolo registrado e mapeamento central, mas depende de documentação/contrato oficial para ampliar chamada externa específica.
- Retornos externos em arquivo estão modelados, mas o download efetivo depende do protocolo disponibilizado.
- Supabase CLI não está instalado no ambiente local; migration foi criada manualmente seguindo o padrão do projeto.
- Não foi executada migration local, pois este repositório não possui Supabase local.
- Vault/MFA não foram implementados por escopo.

## 15. Validação técnica esperada

Executar localmente:

```bash
npx tsc --noEmit
npm test
npm run build
git diff --check
```

Quando houver banco disponível:

```bash
supabase migration up
supabase db lint --fail-on error
```

## 16. Checklist de homologação

☐ Migration aplicada em homolog

☐ Bucket `retornos-integracao` validado

☐ RLS validada com gestor

☐ RLS validada com consultor

☐ RLS validada com cedente

☐ Versão Portal FIDC publicada por fundo

☐ Variáveis de credencial por `credential_ref` criadas

☐ Teste de conexão executado

☐ Envio de remessa executado

☐ Código originador divergente bloqueado

☐ Idempotência validada

☐ Retry transitório validado

☐ Consulta de status validada

☐ Retorno externo validado quando disponível

☐ Segredos ausentes em logs/respostas

☐ Homologação Portal FIDC — Sinqia concluída
