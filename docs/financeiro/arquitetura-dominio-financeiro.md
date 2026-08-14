# Arquitetura do domínio financeiro

## Finalidade

O domínio financeiro do BW Antecipa é infraestrutura compartilhada entre fundos. Ele recebe bases financeiras externas, preserva sua linhagem, executa matching com notas fiscais, reconcilia valores, calcula posição logística e produz exposição financeira. A RLX é um consumidor e um dataset de homologação, não o namespace da plataforma.

Esta arquitetura foi consolidada pela migration `20260814220000_p2_5_1_generalizacao_dominio_financeiro.sql`, sem alteração das regras funcionais entregues em P2.2 a P2.5.

## Fluxo canônico

```text
Fundo + integração versionada
          |
          v
Importação financeira e arquivos
          |
          v
Linhas normalizadas e snapshots atuais
          |
          v
Matching título externo x nota fiscal
          |
          v
Conciliação financeira
          |
          v
Posição logística por NF/operação
          |
          v
Exposição: PL D-2 + posição + overlay intraday
```

Todas as etapas são escopadas por `fundo_id`. Identidade, versão da regra, origem, timestamps e fingerprints permanecem registradas para permitir reprocessamento e auditoria.

## Modelo estrutural

### Ingestão

- `importacoes_financeiras`: cabeçalho versionado da importação por fundo, provider, origem e data de referência.
- `importacao_arquivos`: identidade, Storage e integridade dos arquivos ingeridos.
- `importacao_linhas`: conteúdo normalizado e rastreável por linha.
- `importacao_ciclos`: coordenação e idempotência de ciclos automáticos.
- `estoque_posicoes`, `aquisicao_movimentos`, `liquidacao_movimentos`, `carteira_snapshots`: bases financeiras publicadas.
- `estoque_atual`, `aquisicoes_atuais`, `liquidacoes_atuais`, `carteira_atual`: projeções atuais com a semântica e `security_invoker` preservados.

### Matching e vínculo

- `matching_execucoes`: execução determinística de matching.
- `matching_resultados`: resultado escolhido e justificativa.
- `matching_candidatos`: candidatos avaliados sem perda de evidência.
- `titulo_nf_vinculos`: vínculo auditável entre título externo e NF.
- `titulo_nf_vinculo_chaves`: chaves usadas para busca, unicidade e reconciliação.

### Conciliação

- `conciliacao_execucoes`: execução e fingerprint da reconciliação.
- `conciliacao_resultados`: divergências e resultados financeiros por item.

### Logística

- `posicao_logistica_execucoes`: snapshot da execução logística.
- `posicao_logistica_resultados`: classificação logística por NF/título.

### Exposição

- `exposicao_execucoes`: posição consolidada, PL D-2, limite e resultado da execução.
- `exposicao_overlay_itens`: ajustes intraday rastreáveis e vinculados à execução.

## RPCs públicas

- `iniciar_ciclo_importacao_financeira`
- `validar_linhagem_integracao_financeira`
- `persistir_matching_execucao`
- `confirmar_match_manual`
- `revogar_match_manual`
- `persistir_conciliacao_execucao`
- `persistir_posicao_logistica_execucao`
- `persistir_exposicao_execucao`

As RPCs mantêm grants e o modelo de autorização anterior. Escrita direta em entidades derivadas continua bloqueada; persistência ocorre pelas rotinas server-side autorizadas.

## Helpers privados

Helpers compartilhados usam o prefixo organizacional `financeiro_` apenas em funções privadas, quando necessário para indicar o subsistema de autorização/auditoria. Helpers específicos usam o próprio conceito, como `matching_`, `titulo_nf_`, `posicao_logistica_` e `exposicao_`. As tabelas e views não recebem prefixo artificial.

## Código

```text
src/lib/financeiro/
├── ingestao/
├── matching/
├── conciliacao/
├── logistica/
└── exposicao/
```

O cron canônico é `/api/cron/financeiro`. `/api/cron/rlx-financeiro` permanece apenas como alias fino de compatibilidade, exportando o mesmo handler e sem segundo motor.

Scripts genéricos ficam em `scripts/homologacao/financeiro/`. Os diretórios `rlx-golden` e `rlx-golden-v2` continuam específicos da massa de QA.

## Segurança e isolamento

- As 19 tabelas generalizadas têm RLS habilitada.
- Existem 19 policies efetivas sobre essas tabelas.
- Foram preservadas 72 FKs no conjunto atual.
- Autorização continua escopada por fundo e considera gestor, super admin, perfis híbridos e chamadas técnicas autorizadas.
- A migration preservou OIDs, ACLs, `SECURITY DEFINER`/`SECURITY INVOKER`, `search_path`, grants, policies, triggers e constraints.

## Compatibilidade histórica

As strings `RLX_MATCH_V1`, `RLX_RECON_V1`, `RLX_LOGISTICA_V1` e `RLX_EXPOSICAO_V1` não foram renomeadas. Elas são versões históricas congeladas em snapshots. `RLX_GOLDEN_V1`, `RLX_GOLDEN_V2`, providers de QA, layouts RLX e relatórios históricos também permanecem deliberadamente específicos.

Eventos futuros e origens técnicas passaram a usar nomes genéricos. Eventos já persistidos não foram reescritos.

## Operação e verificação

Verificação read-only do estado generalizado em homologação:

```bash
npm run homolog:financeiro:generalizacao:verify -- --expected-project-ref fhgkmggthxikfpogrvaa
```

O comando valida o project ref, as 19 tabelas, ausência de objetos estruturais `rlx_*`, RLS, policies, FKs, contagens e presença de múltiplos fundos.

## Regra para evoluções

Um nome específico de fundo só pode existir quando o artefato for realmente específico daquele fundo, como layout, adapter, dataset Golden ou versão histórica de regra. Estruturas reutilizáveis, persistência, serviços de domínio e rotas compartilhadas devem permanecer genéricas e sempre escopadas por `fundo_id`.
