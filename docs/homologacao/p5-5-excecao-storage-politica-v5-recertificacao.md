# P5.5 — exceção conhecida de Storage, política DLZ v5 e recertificação

Data da execução: 8 de setembro de 2026 (publicação registrada em UTC em 9 de setembro).

Ambiente: produção, projeto Supabase certificado pelo `project_ref` esperado.

## Resultado executivo

Os dois objetos de Storage sem referência persistida foram preservados e
registrados como exceções conhecidas. O bucket permanece privado e a auditoria
não encontrou exposição cruzada, URL pública permanente ou referência canônica
conhecida.

A política operacional DLZ v5 foi publicada em uma transação controlada. Ela é
semanticamente idêntica à v4, com uma única alteração material:

```text
TRINTA_360 -> DIAS_CORRIDOS_365
```

A v4 foi encerrada pelo lifecycle normal e permanece preservada como
`substituida`. A v5 é a única versão publicada e vigente. Os 12 vínculos ativos
continuam apontando para a mesma política; operações anteriores não foram
reprocessadas e conservaram seus snapshots e hashes.

O cutover não foi liberado. As credenciais autorizadas dos quatro perfis não
estão disponíveis no canal seguro local; portanto, o smoke manual autenticado
não foi executado e o freeze operacional permanece ativo.

## Auditoria dos objetos de Storage

Resultado consolidado:

- objetos avaliados: 2;
- classificação: `KNOWN_UNREFERENCED_STORAGE`;
- contexto: `DLZ_HEALTH`;
- decisão: `PRESERVAR`;
- bucket privado: confirmado para ambos;
- MIME: `image/jpeg` para ambos;
- metadata e existência: confirmadas;
- proprietário com perfil Cedente ativo: confirmado;
- vínculo ativo exclusivo com DLZ: confirmado;
- vínculo ativo com outro fundo: zero;
- referências persistidas conhecidas: zero;
- exposição pública ou cruzada: não identificada;
- registros de auditoria criados: 2;
- revisão futura: obrigatória.

O manifesto usa IDs e fingerprints exatos. Não há wildcard, aceitação automática
de novos órfãos ou alteração dos objetos. Um terceiro objeto desconhecido faz o
gate falhar fechado.

## Política operacional v5

Pré-condições verificadas antes da escrita:

- v4 era a única versão publicada;
- método da v4: `TRINTA_360`;
- aceite do Sacado obrigatório;
- cessão no desembolso preservada;
- acompanhamento, postergação e logística pré-cessão preservados;
- tipo de ativo: `NOTA_FISCAL`;
- exposição logística e gate de risco desativados;
- requisitos da v4: zero;
- vínculos ativos DLZ: 12.

Publicação:

- v5 publicada em `2026-09-09 01:24:47.273757+00`;
- método: `DIAS_CORRIDOS_365`;
- hash canônico: `00d6ed07b545cd3193f92e56b81f7a2e68faa37505c9717d99caa7d0e05429c5`;
- diferenças adicionais entre v4 e v5: zero;
- requisitos v5: zero, equivalentes à v4;
- versão publicada vigente: exatamente uma;
- registros de auditoria de criação/publicação: 2.

O hash do histórico de contexto de política das 47 operações permaneceu
`ef5a7d14210014a6dc183e226d0256dde007801979918ee81991f42b3f48523f`
antes e depois da publicação.

## Rehearsal local

Foi criado um novo snapshot read-only de produção e restaurado no Supabase
local. O restore foi corrigido para transportar o schema `private` sem dados,
pois triggers e policies de `public` dependem dessas funções. A tabela local de
histórico de migrations também foi alinhada às seis colunas existentes em
produção.

No clone:

- baseline restaurada: 2 fundos, 12 Cedentes, 47 operações, 916 NFs, 123
  documentos, 1.663 objetos e 23 usuários/perfis;
- migrations: 199;
- publicação v5: PASS;
- readiness dinâmico, sem UUID de versão hardcoded: PASS;
- aceite do Sacado obrigatório: PASS;
- aprovação controlada: PASS;
- snapshot da nova operação: v5 + `DIAS_CORRIDOS_365`;
- risco financeiro: `NAO_APLICAVEL` conforme a política;
- saída externa: não executada;
- dados sintéticos: revertidos por `ROLLBACK`.

## Baseline pós-publicação

| Verificação | Resultado |
|---|---:|
| Fundos | 2 |
| Cedentes | 12 |
| Operações | 47 |
| Notas fiscais | 916 |
| Documentos | 123 |
| Storage metadata | 1.663 |
| Auth users / profiles | 23 / 23 |
| Migrations | 199 |
| Histórico Fromtis | 26 |
| Exceções conhecidas de Storage | 2 |
| FKs inválidas | 0 |
| Órfãos críticos verificados | 0 |
| Funções destrutivas de homologação | 0 |
| Grants destrutivos | 0 |

Hash lógico sanitizado da baseline P5.5:
`3fddbc32613d33da42da07f2200094f88baafd59e1e004f909cda81034167772`.

## Qualidade e infraestrutura

- testes do bundle/rehearsal: 50/50 PASS;
- fixtures logísticas reais: 8/8 PASS;
- suíte logística direcionada: 41/41 PASS;
- secret/privacy scan: PASS, zero achados em 1.546 arquivos textuais;
- `git diff --check`: PASS;
- APP release hash:
  `26f6508f0608c6a3012b14162f55e47a6287a2bdcf80432f39a1e689c4d15d04`;
- CUTOVER bundle hash:
  `8a7d3dad269b6cebb429ab136bc5db979ef49f11a4afc7cb744043eb2f15522e`;
- runtime alterado: não;
- novo deploy necessário: não;
- Vercel: `Ready`;
- domínio oficial: HTTP 200 com HSTS;
- auto-migration Supabase: permanece desabilitada conforme evidência manual do
  gate anterior.

## Credenciais, smoke e freeze

Não foram encontradas credenciais autorizadas dos quatro perfis no canal seguro
local. Nenhuma senha, token, TOTP ou sessão foi criada, alterada ou solicitada.

Consequências:

- smoke Super Admin: não executado;
- smoke Gestor: não executado;
- smoke Cedente: não executado;
- smoke Sacado: não executado;
- MFA/RLS/Storage/Sinqia do smoke autenticado: não executados;
- chamada Sinqia/Terra: não realizada;
- CNAB/remessa externa: não enviada;
- freeze operacional: mantido.

## Flags finais

```text
P5_5_FINAL_RECERTIFICATION = PENDENTE_CREDENCIAL
STORAGE_KNOWN_EXCEPTION_VALIDATED = PASS
STORAGE_EXCEPTION_REGISTERED = PASS
STORAGE_EXCEPTION_GATE = PASS
DLZ_POLICY_V5_DIFF = EXACTLY_ONE_CHANGE
DLZ_POLICY_V5_PUBLISHED = PASS
DLZ_POLICY_V5_READINESS = PASS
DLZ_POLICY_V5_REHEARSAL = PASS
BASELINE_P5_5 = CERTIFICADA_47_916_1663_WITH_2_KNOWN_STORAGE_EXCEPTIONS
REAL_LOGISTICS_FIXTURE_TESTS = PASS_8_OF_8
P5_5_QUALITY = PASS
P5_5_PRECHECK = PASS
P5_5_CREDENTIALS = PENDENTE
SMOKE_SUPER_ADMIN = NA
SMOKE_GESTOR = NA
SMOKE_CEDENTE = NA
SMOKE_SACADO = NA
SMOKE_MFA = NA
SMOKE_RLS_HISTORICO = NA
SMOKE_STORAGE = NA
SMOKE_SINQIA_READINESS = NA
P5_5_POSTFLIGHT = PASS
OPERATION_FREEZE_RELEASED = NAO
CUTOVER_PRODUCAO = INTERROMPIDO_COM_FREEZE_ATIVO
```

## Próxima ação

Disponibilizar, por canal seguro local, as credenciais autorizadas de Super
Admin, Gestor, Cedente e Sacado. Em seguida, executar o smoke manual autenticado
sem criar operações reais, reexecutar o postflight read-only e liberar o freeze
somente se todos os gates permanecerem verdes.
