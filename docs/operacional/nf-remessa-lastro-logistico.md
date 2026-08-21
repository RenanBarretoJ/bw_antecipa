# NF de Remessa como lastro logístico auxiliar

Ticket original: `P0_Claude_NF_Remessa_Lastro_Logistico`.
Ajustes finais: `P0_Claude_Ajustes_Finais_NF_Remessa` — as correções desse
segundo ticket estão integradas inline em cada seção abaixo (marcadas
"endurecido pelos ajustes finais" ou "funcional desde os ajustes finais")
em vez de uma seção separada, para manter cada tópico (modelo, matching,
canhoto etc.) com uma única fonte de verdade.

## Resultado

`P0_NF_REMESSA_LASTRO_LOGISTICO = PASS` (definitivo, após os ajustes
finais). As 3 pendências do ticket de ajustes finais foram fechadas: (1)
cadeia validada com os XMLs **reais** do ticket (não sintéticos); (2)
canhoto → remessa funcional (RPC valida e persiste o vínculo, UI permite
selecionar); (3) o fallback automático de quantidade por valor foi
**removido** — quantidade não verificável agora força `REVISAO_MANUAL`,
nunca `VALIDADA`. O matching de produtos passou a priorizar cProd → NCM →
unidade+quantidade, com a descrição normalizada apenas como último recurso
heurístico. A única parte que permanece deliberadamente fora de escopo é a
suíte de certificação browser E2E (ver "Riscos remanescentes").

## A. Modelo

Tabela dedicada `nota_fiscal_remessas` (migration
`20260821040000_p0_nf_remessa_lastro_logistico.sql`), **nunca** cadastrada em
`notas_fiscais` — é um documento auxiliar fiscal/logístico, 1 remessa : 1
venda, 1 venda : N remessas.

Campos: `id`, `nota_fiscal_venda_id`, `cedente_id`/`fundo_id`/
`cedente_fundo_id` (sempre copiados da venda, nunca do payload do cliente —
ver seção "Segurança"), `chave_acesso` (única), `numero`, `serie`,
`emitente_cnpj`/`emitente_razao_social`, `destinatario_cnpj`/
`destinatario_razao_social`, `data_emissao`, `valor_total`,
`quantidade_total`, `itens` (jsonb), `status_validacao`
(`VALIDADA|REVISAO_MANUAL|REJEITADA`), `referencia_nf_venda_confirmada`,
`motivos_validacao`, mais os metadados de armazenamento do XML (`bucket`,
`path`, `nome_original`, `mime_type`, `tamanho_bytes`, `sha256`).

RLS é **somente leitura** (policies para gestor/consultor/cedente, mesmo
padrão de `notas_fiscais`). Toda escrita passa exclusivamente pela RPC
`registrar_nota_fiscal_remessa` (`SECURITY DEFINER`) — não existe policy de
`INSERT` direto, porque `status_validacao`/`referencia_nf_venda_confirmada`
são decisões computadas no servidor a partir do matching (regra D), nunca
declaradas pelo cliente.

Nenhuma integração financeira lê `nota_fiscal_remessas`: parcelas, VP, taxa,
operação e exposição continuam lendo exclusivamente `notas_fiscais`.

### Extensão de `notas_fiscais` (decisão de escopo)

O ticket pede que o saldo entre venda e remessas seja avaliado por
"quantidade". Como `notas_fiscais` não persistia itens/quantidade
estruturados (só `descricao_itens`, uma string concatenada), a extensão de
schema foi confirmada explicitamente com o usuário (ver decisão abaixo) e
implementada: `notas_fiscais` ganhou `quantidade_total`, `unidade_quantidade`
e `itens_estruturados` (jsonb), populados a partir de `<det><prod>` no
upload por XML. NFs cadastradas antes desta migration ou por PDF/manual têm
esses campos `NULL` — o matching trata isso explicitamente (ver seção D).

## B. Parser XML

`src/lib/nf-parser.ts` (`parseNFeXML`) ganhou, de forma aditiva (sem alterar
o formato de `descricao_itens`, preservando compatibilidade):

- `itensEstruturados`: array de `{descricao, codigo, quantidade, unidade,
  valor}` de cada `<det><prod>`;
- `quantidadeTotal`: soma de `qCom` de todos os itens;
- `nfRefChaves`: chaves de `<NFref><refNFe>`, na ordem em que aparecem;
- `evidenciaComplementar`: texto de `<infAdic><infCpl>` (evidência
  complementar apenas, nunca substitui `NFref` estruturado, conforme regra
  B do ticket).

A mesma função é reutilizada para parsear a NF de remessa (é uma NF-e XML
como qualquer outra, só usada com outro propósito).

`src/lib/logistica/cte-parser.ts` (`parseCteXml`) ganhou extração do
**tomador** (regra 6): `toma_codigo`, `cnpj_tomador`, `tomador`. Resolve
`toma4` (terceiro, com CNPJ próprio) e `toma3` códigos `0`
(remetente)/`3` (destinatário) usando os blocos já extraídos; códigos `1`
(expedidor)/`2` (recebedor) **não são adivinhados** — o parser não extrai
blocos separados de expedidor/recebedor, e inventar o CNPJ a partir de
outro papel seria fail-open. Nesses casos `cnpj_tomador` fica `null`, o que
a classificação de tomador trata como fail-closed (`DENY`).

## C. UI

Card `RemessaDaNota` (`src/components/notas-fiscais/RemessaDaNota.tsx`),
seguindo exatamente o padrão de `ParcelasDaNota`/`DuplicatasDaNota`: renderiza
sempre (mesmo vazio, para quem pode enviar) ou nada (se vazio e sem
permissão de envio) — nunca aparece como pendência bloqueante, pois é
opcional. Mostra número/série/chave/emitente/destinatário/valor/status por
remessa, motivos de revisão quando houver, e um botão "Enviar NF de remessa
(XML)" para cedente (NF ainda editável) e gestor. Renderizado nas páginas de
detalhe de NF do cedente e do gestor, logo após o card de Parcelas.

## D. Matching venda ↔ remessa

`src/lib/logistica/nf-remessa-matching.ts` (`avaliarMatchingRemessaVenda`),
função pura, testada em `nf-remessa-matching.test.ts` (33 testes cobrindo os
cenários 1, 4-8, a garantia de forma do resultado, e as regras 3/4 dos
ajustes finais):

1. **Referência estruturada**: `venda.chave_acesso ∈ remessa.nf_ref_chaves`.
   Ausente ou divergente → nunca gera `VALIDADA` automaticamente (regra 9 /
   teste 5): status `REVISAO_MANUAL`.
2. **Destinatário = sacado**: divergência é bloqueio duro (`REJEITADA`),
   independente do NFref (teste 4).
3. **Produtos compatíveis** (endurecido pelos ajustes finais — item 4):
   `avaliarCompatibilidadeProdutos` prioriza evidência determinística sobre
   heurística, na ordem do ticket: `cProd` → `NCM` → `unidade`+`quantidade`
   → descrição normalizada (overlap de tokens ≥3 caracteres, apenas como
   último recurso). Resultado é um dos 4: `DETERMINISTICO` (algum critério
   estruturado bateu — não bloqueia `VALIDADA`), `HEURISTICO` (só a
   descrição bateu — **nunca** suficiente para `VALIDADA`, força
   `REVISAO_MANUAL` mesmo com NFref/destinatário/quantidade corretos),
   `INCOMPATIVEL` (o critério disponível não bateu — rebaixa para
   `REVISAO_MANUAL`, nunca `REJEITADA` sozinho) ou `NAO_VERIFICAVEL`
   (nenhum item estruturado em algum dos lados — não bloqueia). No caso
   real do ticket, `cProd=003002` é idêntico entre a venda e a remessa →
   `DETERMINISTICO` imediato, sem depender de descrição.
4. **Saldo/acumulado** (endurecido pelos ajustes finais — item 3): o saldo
   é **sempre** avaliado por quantidade estruturada, nunca por valor
   monetário. Quando `venda.quantidade_total` e `remessa.quantidade_total`
   estão disponíveis, valida normalmente (regra 3/teste 6-8: acumulado das
   remessas `VALIDADA`s + esta ≤ quantidade da venda; excedeu →
   `REJEITADA`). Quando a quantidade não é verificável em qualquer um dos
   lados (cadastro manual/PDF, ou NF anterior à migration original), o
   resultado é sempre `REVISAO_MANUAL` — **nunca** `VALIDADA` só porque o
   valor financeiro coincide (o fallback por valor do ticket original foi
   removido).

Resultado: `VALIDADA | REVISAO_MANUAL | REJEITADA` + motivos legíveis. A
ausência de remessa nunca chama esta função — ela só roda quando uma
remessa é efetivamente enviada.

## E. Matching CT-e (cadeia direta vs via remessa)

`resolverVinculoCtePorNf` decide, por NF, se o CT-e a referencia
diretamente (regra 4, fluxo atual, **inalterado**) ou via uma NF de remessa
`VALIDADA` vinculada a ela (regra 5). `DIRETO_VENDA` tem precedência sobre
`VIA_REMESSA` quando o CT-e referencia ambas as chaves.

Integração em `src/lib/actions/logistica.ts` (`enviarCte`): para cada NF, se
o vínculo resolve para `VIA_REMESSA`, a função monta a linha de comparação
usada por `validarCteContraNfes` (**não alterada**) com os dados da
**remessa** (emitente, valor, quantidade, itens) em vez dos dados da venda —
porque regra E diz que o remetente pode ser o operador logístico (não o
emitente da venda) e porque o valor/quantidade relevante para aquele
envio específico é o da remessa (fundamental para remessas parciais: comparar
contra o valor total da venda acusaria divergência indevida). O
destinatário permanece o mesmo sacado da venda nos dois casos (já garantido
pelo matching da regra D). `chave_nfe_referenciada` persistida em
`cte_notas_fiscais` continua sendo `notas_fiscais.chave_acesso` (a venda),
preservando a semântica "esta linha é sobre esta venda".

Persistência (`cte_notas_fiscais`, novas colunas): `nota_fiscal_remessa_id`
(nullable) e `tipo_vinculo` (`DIRETO_VENDA|VIA_REMESSA`, `CHECK` garantindo
que um tem remessa e o outro não). `ctes` ganhou `tomador_cnpj` e
`tomador_classificacao`.

## Regra 6 — Tomador do CT-e (somente quando via remessa)

`classificarTomadorCte`: `ALLOW` quando o tomador é o **CNPJ exato do
emitente da venda**; `REVISAO_MANUAL` quando é outro `cedente_estabelecimentos`
**aprovado e ativo do mesmo Cedente** (tabela já existente, criada em
`20260818200641_multi_cnpj_cedente_estabelecimentos.sql` — matriz/filiais);
`DENY` para terceiro estranho **ou tomador não identificável no XML**
(fail-closed — nunca `ALLOW` por omissão). A classificação roda uma vez por
CT-e (um CT-e tem um único tomador fiscal) contra todas as vendas
vinculadas via remessa no lote.

`DENY` **bloqueia o cadastro do CT-e** (`registrar_cte_documento` levanta
excecão), no mesmo padrão de bloqueio já existente para
`status_validacao='rejeitado'`.

## F. Canhoto (funcional desde os ajustes finais)

Estrutural: o gate logístico da venda **nunca dependeu** disso e continua
não dependendo — `canhotos.nota_fiscal_entrega_id` já aponta para o
acompanhamento da **venda**, com ou sem remessa; aprovar o canhoto sempre
satisfaz o gate, com ou sem vínculo de remessa. Confirmado por leitura de
código E por teste automatizado dedicado (`ajustes-finais-nf-remessa
.migration.test.ts`): nenhum ponto do gate (`evidencias-logisticas.ts`,
`elegibilidade-submissao.ts`, a migration SQL do gate unificado) referencia
`nota_fiscal_remessa_id`.

`canhotos.nota_fiscal_remessa_id` (adicionado no ticket original) agora é
**funcional** (migration `20260821050000_p0_ajustes_finais_nf_remessa.sql`):

- `registrar_canhoto_documento` ganhou `p_nota_fiscal_remessa_id uuid
  DEFAULT NULL` (assinatura estendida só com parâmetro `DEFAULT` no final —
  chamadas existentes sem remessa continuam idênticas). Quando informado,
  valida no servidor: a remessa existe; `status_validacao='VALIDADA'`;
  `nota_fiscal_remessas.nota_fiscal_venda_id` é exatamente a venda da
  entrega recebida (join via `nota_fiscal_entregas.nota_fiscal_id`) — fail
  closed nos 3 casos (remessa inexistente, não validada, ou de outra
  venda), sem exceção.
- `enviarCanhoto` (`src/lib/actions/logistica.ts`) repassa
  `notaFiscalRemessaId` do `formData` para `p_nota_fiscal_remessa_id`.
- UI nova (não existia antes): `CanhotoDaEntrega`
  (`src/components/notas-fiscais/CanhotoDaEntrega.tsx`), renderizado nas
  páginas de detalhe da NF (cedente/gestor) logo após o card de remessa. Só
  aparece quando a NF tem acompanhamento logístico ativo (`nota_fiscal_
  entregas` não `nao_aplicavel/cancelada/devolvida`). Mostra um `<select>`
  com as remessas `VALIDADA`s da venda quando houver ao menos uma (seletor
  correto com múltiplas remessas — lista todas, não só a mais recente); ao
  enviar um canhoto vinculado, exibe **"Entrega comprovada via NF de
  Remessa `<numero>`"** no próprio card, visível tanto para cedente quanto
  para gestor.
- **Nota de arquitetura descoberta durante este ajuste**: `registrar_
  canhoto_documento` não é o único caminho de criação de `canhotos` neste
  repositório — existe também um fluxo de "envio antecipado" (`registrar_
  documento_logistico_antecipado` → `private.reconciliar_evidencia_
  logistica_nf`) e um upload genérico de checklist (`registrar_documento_
  entrega_upload`, que não persiste em `canhotos` diretamente). O ticket
  de ajustes finais nomeou especificamente `registrar_canhoto_documento` —
  estendido exatamente como pedido. Estender os outros dois caminhos para
  também aceitar `nota_fiscal_remessa_id` é um escopo maior, não solicitado
  aqui, e fica registrado como pendência (ver "Riscos remanescentes").

## Limites de quantidade

Ver seção D. Resumo pós-ajustes-finais: quantidade estruturada obrigatória
nos dois lados para `VALIDADA`; sem ela, `REVISAO_MANUAL` sempre — nunca há
fallback para valor (R$). O acumulado entre remessas (`acumuladoAnterior`,
calculado em `enviarNotaFiscalRemessa`) também é somado exclusivamente por
`quantidade_total` das remessas já `VALIDADA`s — como uma remessa só se
torna `VALIDADA` quando a quantidade é verificável, todo item da soma tem
`quantidade_total` preenchido por construção.

## Segurança

- `nota_fiscal_remessas`: RLS somente-leitura; escrita apenas via RPC
  `SECURITY DEFINER`, que resolve `cedente_id`/`fundo_id`/
  `cedente_fundo_id` **a partir da venda no banco**, nunca do payload —
  um cedente não pode forjar o vínculo com outro fundo/cedente.
- `registrar_nota_fiscal_remessa`: valida `actor_role IN ('cedente',
  'gestor')`, acesso do cedente autenticado (`get_user_cedente_id()`) ou do
  gestor ao fundo (`private.usuario_tem_acesso_fundo`), unicidade de
  `chave_acesso`, formato de chave (44 dígitos) e que a remessa não reusa a
  própria chave da venda.
- `registrar_cte_documento` (nova versão): todo vínculo `VIA_REMESSA`
  informado é **revalidado no servidor** contra `nota_fiscal_remessas`
  (existe, `status_validacao='VALIDADA'`, pertence à venda informada) —
  nunca confia apenas no jsonb computado pelo chamador, mesmo que o
  cálculo de matching em si seja feito em TypeScript (defesa em
  profundidade). Tomador `DENY` bloqueia o cadastro.
- Todos os `ALTER TABLE ... ADD CONSTRAINT`, `CREATE POLICY` e
  `CREATE TRIGGER` novos são precedidos de `DROP ... IF EXISTS` —
  a migration foi **verificada idempotente em homologação** (aplicada 3x
  consecutivas sem erro), depois do incidente documentado no ticket
  anterior desta sessão (sync automático de push para `homolog` reexecuta
  migrations e reverte alterações não-idempotentes).

## Resultado dos arquivos reais do ticket

**Correção em relação à versão anterior deste documento**: os XMLs reais
estavam disponíveis localmente na máquina do usuário (fora do workspace do
repositório) e foram localizados e usados nos ajustes finais — a afirmação
anterior de que "não havia arquivo anexado" estava errada e foi corrigida
aqui. Os 3 arquivos reais (`13260707312248000307550040000055761611390985-
procNFe.xml`, `42260715644666000230550020000350061027265253-procNFe.xml`,
`42260772090442000934570010004898781010855801-cte.xml`) foram copiados
para `src/lib/logistica/__fixtures__/reais/` (gitignored — contêm CNPJ,
razão social e certificado X.509 reais de cedente/sacado/transportadora;
nunca commitados) e exercitados de ponta a ponta em
`nf-remessa-cadeia-real.test.ts` (8 testes, roda pulado se os arquivos não
estiverem presentes localmente — CI/outra máquina não quebra).

Resultado, com os arquivos **reais** (não reconstruídos):

- **Venda 5576** (`13260707312248000307550040000055761611390985-procNFe.xml`):
  `cProd=003002`, `NCM=38276100`, `uCom=KG`, `qCom=76.3000`, `vProd=3433.50`
  — exatamente os valores citados no ticket. Emitente RLX
  (`07312248000307`), destinatário MJR (`23704498000179`).
- **Remessa 35006** (`...0350061027265253-procNFe.xml`): emitente ZF LOG
  OPERACOES E LOGISTICA LTDA (`15644666000230`), mesmo destinatário MJR,
  `<NFref><refNFe>` apontando exatamente para a chave da venda, mesmo
  `cProd/NCM/uCom/qCom` da venda. `avaliarMatchingRemessaVenda` real:
  **`VALIDADA`**, `referenciaNfVendaConfirmada: true`,
  `produtosCompativeis: 'DETERMINISTICO'` (cProd casa), `motivos: []`.
- **CT-e 489878** (`...004898781010855801-cte.xml`): `rem`=ZF LOG
  (`15644666000230`), `dest`/`receb`=MJR (`23704498000179`), `toma4`
  (tomador terceiro) = RLX (`07312248000307`), `infDoc/infNFe` referencia
  a **chave da remessa** (não a da venda). `resolverVinculoCtePorNf` →
  **`VIA_REMESSA`**; `classificarTomadorCte` → **`ALLOW`** (tomador =
  emitente exato da venda); `validarCteContraNfes`, alimentada com os
  dados da remessa (regra E) → **`aprovado`**, zero bloqueios/alertas.
  Cadeia completa `NF Venda 5576 → NF Remessa 35006 → CT-e 489878`
  confirmada com os 3 arquivos reais do ticket.
- **Achado real corrigido durante este ajuste**: o CT-e real usa rótulos de
  medida `PESO REAL`/`PESO BASE DE CALCULO` (não `PESO BRUTO`, que o
  parser original reconhecia) e lista `UNIDADE` (qCarga=7) **antes** da
  medida de peso na ordem do XML — a lógica antiga pegava a primeira
  quantidade não nula (7, contagem de volumes) em vez do peso (76.3 KG),
  o que teria causado falso bloqueio `quantidade_divergente`. Corrigido em
  `cte-parser.ts`: `quantidadePrincipal` agora prefere qualquer medida cujo
  rótulo contenha "PESO" antes de cair para a primeira não nula.
- **Regressão real sem remessa**: NF 149 (arquivos reais de outra pasta de
  evidências, também com XML/CT-e genuínos) — sem `NFref`, CT-e referencia
  a própria chave da venda, tomador via `toma3` código `0` (remetente) —
  `resolverVinculoCtePorNf` → `DIRETO_VENDA`, fluxo legado confirmado
  intacto com dados reais.
- Adicionalmente, a remessa real 35006 foi registrada de ponta a ponta via
  a RPC `registrar_nota_fiscal_remessa` (sessão simulada de gestor) no
  ticket original — esse registro **permanece em homologação** como
  evidência viva (`d172b9fc-4351-467a-9f82-86ac4d0c8b42`).

## Regressões e testes automatizados

- **Testes do ticket original**: `nf-parser.test.ts` (+7), `cte-parser
  .test.ts` (+5, tomador via toma3/toma4).
- **Testes dos ajustes finais**: `nf-remessa-matching.test.ts` reescrito
  para o novo contrato (33 testes: matching com produtos deterministico/
  heuristico/incompatível/não-verificável, saldo sem fallback de valor,
  classificação de tomador, resolução de vínculo direto/via-remessa —
  cobrindo os cenários 1-11, 13 e 15 do ticket original mais as regras 3/4
  dos ajustes finais); `nf-remessa-cadeia-real.test.ts` (8 testes, cadeia
  completa com os 3 XMLs **reais** do ticket + regressão real sem
  remessa, pula graciosamente se os arquivos não estiverem presentes);
  `ajustes-finais-nf-remessa.migration.test.ts` (10 testes: contrato da
  migration do canhoto→remessa — assinatura estendida só com `DEFAULT`,
  fail-closed nos 3 casos de rejeição, persistência do vínculo,
  independência do gate logístico).
- **Cenário 14** (remessa nunca aparece como título/parcela/operação/
  CNAB/exposição): garantido por construção — nenhum módulo financeiro
  (parcelas-nf, exposicao, risco, CNAB) foi alterado ou lê
  `nota_fiscal_remessas`; confirmado por `git diff` do escopo e pelo teste
  de forma do resultado do matching.
- **Canhoto vinculado à remessa → gate da venda satisfeito**: confirmado
  por teste de contrato (independência do gate) + verificação ao vivo em
  homologação (dentro de uma transação com `ROLLBACK`, sem tocar o
  dataset golden/QA compartilhado): canhoto sem remessa funciona (fluxo
  legado); canhoto vinculado a remessa `VALIDADA` da mesma venda funciona
  e persiste `nota_fiscal_remessa_id`; canhoto vinculado a remessa
  `REVISAO_MANUAL`, a remessa de outra venda (testado com a remessa real
  35006 contra uma venda QA diferente), e a uma remessa inexistente — os
  3 corretamente rejeitados pela RPC.
- **Cenário 16** (regressão completa do fluxo sem remessa): suíte completa
  — 170 arquivos / **1364 testes**, 0 falhas (1337 após o ticket
  original, 1333 antes de qualquer ticket desta feature).
- `npx tsc --noEmit`: limpo. `npm run lint`: mesmos 6 warnings
  pré-existentes, sem novos. `git diff --check`: limpo. `npx next build
  --webpack`: sucesso, todas as rotas compiladas. `npm audit --omit=dev`:
  0 vulnerabilidades.
- Ambas as migrations (`20260821040000` e `20260821050000`) validadas com
  SQL real em homologação (`fhgkmggthxikfpogrvaa`), cada uma aplicada 3
  vezes consecutivas sem erro (idempotência confirmada).

## Riscos remanescentes / pendências

1. **Suíte E2E de navegador não executada**: os cenários do ticket foram
   cobertos por testes de unidade do domínio + a cadeia real completa
   (item 1 dos ajustes finais, com os XMLs reais) + verificação ao vivo
   via RPC em homologação — não por uma suíte de certificação browser
   dedicada (padrão já estabelecido neste repositório: não há suíte pgTAP
   nem Playwright para este fluxo). Recomendo um roteiro de certificação
   dedicado se o time quiser cobertura de navegador ponta a ponta.
2. **Outros caminhos de criação de canhoto** (`registrar_documento_
   logistico_antecipado` / `reconciliar_evidencia_logistica_nf`, e o
   upload genérico de checklist) não foram estendidos para aceitar
   `nota_fiscal_remessa_id` — só `registrar_canhoto_documento`, exatamente
   o que o ticket de ajustes finais nomeou. O gate da venda funciona
   igual nos três caminhos (independe de remessa); o rótulo "Entrega
   comprovada via NF de Remessa" só aparece quando o canhoto passa pelo
   caminho estendido.
3. **Comparação de produtos cai para heurística de descrição** quando
   nem `cProd`, nem `NCM`, nem `unidade+quantidade` estão disponíveis em
   comum — nesse caso (raro, dado que toda NF-e real tem `cProd`/`NCM`)
   nunca gera `VALIDADA` sozinha, só `REVISAO_MANUAL` ou `INCOMPATIVEL`.
4. **NFs cadastradas antes da migration original** (ou por PDF/cadastro
   manual) não têm `quantidade_total`/`itens_estruturados` — após os
   ajustes finais, isso **sempre** resulta em `REVISAO_MANUAL` (nunca
   mais em `VALIDADA` por coincidência de valor). Novo backfill em massa
   não foi feito (fora de escopo); a NF real 5576 foi backfillada
   individualmente para permitir o teste ao vivo do ticket original.
5. **Multi-NF por CT-e com emitentes diferentes via remessa**: a
   classificação de tomador roda uma vez por CT-e contra o conjunto de
   emitentes das vendas vinculadas via remessa no lote (`ALLOW` se casar
   com qualquer uma) — cenário raro (frete compartilhado entre
   estabelecimentos diferentes do mesmo Cedente), não teve teste dedicado.
6. **Fixtures reais são locais, não commitadas**: `src/lib/logistica/
   __fixtures__/reais/` e a pasta `nfs/` na raiz (com os XMLs/PDFs/boletos
   originais) estão no `.gitignore` — contêm CNPJ, razão social e
   certificado X.509 reais de cedente/sacado/transportadora. Quem rodar a
   suíte em outra máquina verá `nf-remessa-cadeia-real.test.ts` pulado
   (não falho); os resultados desses testes estão documentados aqui como
   evidência.
