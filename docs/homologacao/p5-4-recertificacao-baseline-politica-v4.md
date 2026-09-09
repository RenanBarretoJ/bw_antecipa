# P5.4 — Recertificação da baseline, política DLZ v4 e retomada do smoke

Data da execução: 8 de setembro de 2026

Ambiente consultado: produção

Modo de acesso ao banco: somente leitura

Freeze operacional: mantido ativo

## Parecer executivo

A recertificação foi interrompida de forma fail-closed. O delta operacional contém uma operação e seis notas fiscais coerentes com atividade real do DLZ, mas dois dos oito novos objetos do bucket de notas fiscais não possuem referência persistida nas entidades e tabelas documentais auditadas. Além disso, a política operacional publicada v4 alterou o método de cálculo financeiro de `DIAS_CORRIDOS_365` para `TRINTA_360` em relação à configuração certificada.

Como ambos os pontos são materiais para o gate, a baseline 47/916/1.663 não foi certificada, o smoke autenticado não foi iniciado e o freeze não foi liberado. Nenhum registro, objeto de Storage, política ou configuração de produção foi alterado.

## 1. Validação do delta de produção

Baseline anterior: 46 operações, 910 notas fiscais, 123 documentos e 1.644 objetos de Storage.

Estado observado: 47 operações, 916 notas fiscais, 123 documentos e 1.663 objetos de Storage.

### Operação adicional

- pertence ao fundo DLZ/HEALTH;
- possui Cedente e vínculo ativo coerentes;
- possui status reconhecido;
- possui seis notas fiscais vinculadas;
- não pertence ao IMPULSE;
- não possui marcador sintético, mock ou rehearsal;
- ator, evento de domínio e timestamps são compatíveis com atividade operacional.

Classificação: legítima.

### Seis notas fiscais adicionais

- pertencem ao DLZ/HEALTH;
- possuem Cedente e vínculo com o fundo coerentes;
- possuem chaves com estrutura esperada e emitentes autorizados;
- estão vinculadas à nova operação;
- não possuem marcador sintético;
- não possuem checklist documental instanciado porque a política v4 publicada não contém requisitos.

Classificação: legítimas no contexto da política vigente.

### Dezenove objetos adicionais no Storage

| Grupo | Quantidade | Resultado |
|---|---:|---|
| Contratos | 9 | Referenciados por campos documentais das operações |
| Remessas CNAB | 2 | Referenciados pela remessa, inclusive o arquivo de conferência |
| Notas fiscais | 8 | 6 referenciados e 2 sem referência persistida |

Os dois objetos sem referência são imagens com conteúdo repetido, owner compatível com um Cedente válido e sem vínculo encontrado em notas fiscais, versões documentais, documentos gerados, remessas, operações ou auditoria. Eles foram apenas classificados; não foram excluídos.

Resultado: `DELTA_ATUAL_DLZ = FAIL`.

## 2. Baseline

A baseline atual não foi congelada nem recebeu novo hash lógico, porque o requisito de inexistência de objetos órfãos não foi atendido.

Resultado: `BASELINE_P5_4 = FAIL`.

## 3. Auditoria semântica da política DLZ v4

A identidade da política permanece estável e seus vínculos ativos continuam associados aos Cedentes do DLZ. Existe exatamente uma versão publicada: v4. As versões anteriores estão substituídas.

| Campo ou regra | Configuração certificada | V4 publicada | Equivalente? |
|---|---|---|---|
| Fundo | DLZ/HEALTH | DLZ/HEALTH | Sim |
| Aceite do Sacado | Obrigatório | Obrigatório | Sim |
| Cessão no desembolso | Ativa | Ativa | Sim |
| Acompanhamento de entrega | Desativado | Desativado | Sim |
| Postergação | Desativada | Desativada | Sim |
| Método de cálculo financeiro | `DIAS_CORRIDOS_365` | `TRINTA_360` | **Não** |
| Logística pré-cessão | Desativada | Desativada | Sim |
| Tipo de ativo | `NOTA_FISCAL` | `NOTA_FISCAL` | Sim |
| Controle de exposição logística | Desativado | Desativado | Sim |
| Gate de risco | Desativado | Desativado | Sim |
| Requisitos documentais | Nenhum | Nenhum | Sim |

Não foi identificada alteração retroativa das operações anteriores à publicação da v4. Há uma operação posterior vinculada à v4.

Resultado: `DLZ_POLICY_V4 = MATERIAL_CHANGE`.

## 4. Correção do readiness verifier

O verificador anterior não avaliava toda a semântica certificada. O SQL de postflight ainda dependia explicitamente do UUID da versão v1 substituída e o verificador em JavaScript verificava apenas parte dos controles.

A correção:

- resolve a versão atualmente publicada da política do fundo;
- exige exatamente uma versão publicada;
- valida o fundo da versão;
- compara todos os controles certificados e os requisitos documentais;
- não depende do UUID da v1 nem hardcodeia o UUID da v4;
- falha fechado para ausência, multiplicidade, fundo divergente ou diferença semântica.

Foram adicionados testes para versão equivalente, versão divergente, ausência de publicada, múltiplas publicadas e fundo incorreto.

Resultado: `DLZ_READINESS_VERIFIER = FIXED`.

## 5. Classificação da mudança

A alteração está restrita a scripts, testes, manifestos e SQL read-only de readiness. Nenhum arquivo do runtime da aplicação e nenhuma migration foram alterados.

- runtime material: não;
- classe: `CUTOVER_ONLY`;
- `APP_RELEASE_HASH`: `26f6508f0608c6a3012b14162f55e47a6287a2bdcf80432f39a1e689c4d15d04` — inalterado;
- `CUTOVER_BUNDLE_HASH`: `82e27eb6f180431b35e66a0d0ef27537dab63e9411e86669f14ff25f57c397a4`;
- novo deploy: não necessário.

Resultado: `VERIFIER_CHANGE_CLASS = CUTOVER_ONLY`.

## 6. Fixtures logísticas reais

As fixtures ignoradas pelo Git foram disponibilizadas aos testes por referência local temporária, sem cópia, movimentação ou versionamento.

- `FIXTURES_DISPONIVEIS = true`;
- testes executados: 8;
- testes aprovados: 8;
- arquivos reais rastreados pelo Git: 0;
- inclusão no hash da aplicação: não.

Resultado: `REAL_LOGISTICS_FIXTURE_TESTS = PASS_8_OF_8`.

## 7. Qualidade

Validações executadas:

- testes direcionados do verificador e artefatos P4: 9/9;
- suíte de rehearsal: 36/36;
- testes logísticos com fixtures reais: 8/8;
- secret scan: `PASS`, zero achados em 1.536 arquivos de texto;
- `git diff --check`: `PASS`;
- validação dos hashes de release: `PASS`.

A suíte integral de 1.959 testes e o build não foram repetidos porque a mudança foi classificada como `CUTOVER_ONLY`, conforme o gate definido para esta fase. Os três testes condicionais de Chromium não foram usados para substituir qualquer gate obrigatório.

Resultado: `P5_4_QUALITY = PASS`.

## 8. Precheck, credenciais e smoke

O precheck falha corretamente porque:

1. existem dois objetos órfãos no delta de Storage;
2. a política publicada diverge no método financeiro do baseline certificado.

As credenciais dos quatro perfis não foram procuradas nem solicitadas, pois um precheck verde é condição anterior ao smoke. Nenhuma sessão artificial, usuário, reset de senha ou fator MFA foi criado.

Resultados:

- `P5_4_PRECHECK = FAIL`;
- `P5_4_CREDENTIALS = PENDENTE`;
- todos os smokes autenticados: `NA`;
- postflight final: `NA`.

## 9. Decisões necessárias

Antes de uma nova tentativa de cutover, são necessárias decisões humanas explícitas para:

1. confirmar se os dois objetos sem referência podem ser removidos ou se existe vínculo não modelado que deve ser preservado;
2. confirmar se `TRINTA_360` é a nova regra financeira desejada para o DLZ;
3. se a mudança for intencional, estabelecer e certificar uma nova baseline semântica, com validação financeira correspondente;
4. se não for intencional, corrigir a política por uma nova versão publicada pelo fluxo normal, sem reativar ou editar versões históricas.

## 10. Flags finais

```text
DELTA_ATUAL_DLZ = FAIL
BASELINE_P5_4 = FAIL
DLZ_POLICY_V4 = MATERIAL_CHANGE
DLZ_READINESS_VERIFIER = FIXED
VERIFIER_CHANGE_CLASS = CUTOVER_ONLY
REAL_LOGISTICS_FIXTURE_TESTS = PASS_8_OF_8
P5_4_QUALITY = PASS
P5_4_PRECHECK = FAIL
P5_4_CREDENTIALS = PENDENTE
SMOKE_SUPER_ADMIN = NA
SMOKE_GESTOR = NA
SMOKE_CEDENTE = NA
SMOKE_SACADO = NA
SMOKE_MFA = NA
SMOKE_RLS_HISTORICO = NA
SMOKE_STORAGE = NA
SMOKE_SINQIA_READINESS = NA
P5_4_POSTFLIGHT = NA
OPERATION_FREEZE_RELEASED = NAO
P5_4_RECERTIFICACAO_E_SMOKE = FAIL
CUTOVER_PRODUCAO = INTERROMPIDO_COM_FREEZE_ATIVO
```
