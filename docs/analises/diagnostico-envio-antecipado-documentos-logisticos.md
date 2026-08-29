# Diagnóstico — envio antecipado de documentos logísticos

Data da análise: 06/08/2026

Escopo: somente leitura

Ambiente consultado: código da branch `homolog` e banco de homologação configurado em `.env.homolog`, sempre em transação `READ ONLY`.

## 1. Resumo executivo

O BW Antecipa **não possui hoje suporte funcional completo** para exibir, enviar, analisar e reaproveitar antes da cessão um requisito definido exclusivamente como pós-cessão.

O suporte atual é **parcial**:

- o repositório documental já separa documento, versão, análise e vínculo;
- a análise pertence à versão, não à instância do requisito;
- um documento pode ter mais de um vínculo e a mesma versão aprovada pode, tecnicamente, ser apontada por mais de uma instância;
- CT-e possui relação N:N com NFs e uma RPC capaz de registrar um único objeto para várias NFs;
- a operação preserva a política e os requisitos em snapshot imutável;
- os requisitos pós-cessão são materializados no desembolso a partir desse snapshot.

Entretanto:

- antes do desembolso, o checklist carrega e instancia apenas `nf_pre_cessao`;
- o upload exige uma `documento_requisito_instancia` existente;
- a instância pós-cessão só nasce quando existe `nota_fiscal_entrega`;
- não há reconciliação genérica de evidência antecipada com a instância pós-cessão;
- não existe status logístico pré-cessão `Indeterminada | Em trânsito | Entregue` derivado das evidências aprovadas;
- não existe o gate de política `exigir_status_logistico_pre_cessao` ou equivalente;
- a validação de duplicidade é por código exato, e não por família documental;
- o fluxo compartilhado de CT-e não está fechado ponta a ponta na UI e na análise genérica.

Parecer: a arquitetura atual oferece uma boa base, mas **é necessária implementação de domínio, aplicação, UI, RPCs e migrations incrementais**. Não é seguro resolver apenas na apresentação.

## 2. Regra funcional confirmada

A regra de referência para uma evolução futura é:

```text
Requisito oficial definido uma única vez como pós-cessão
                    ↓
Antes da cessão, aparece como envio antecipado opcional
                    ↓
Documento e versão são persistidos e podem ser analisados
                    ↓
Somente versão aprovada produz evidência logística
                    ↓
Desembolso materializa o requisito oficial pós-cessão
                    ↓
Mesma evidência é vinculada à instância, sem copiar arquivo ou análise
```

Classificação logística:

1. comprovante de entrega aprovado: `Entregue`;
2. na ausência de comprovante aprovado, CT-e aprovado: `Em trânsito`;
3. sem evidência aprovada: `Indeterminada`.

`Entregue` deve prevalecer sobre `Em trânsito`. Upload aguardando análise ou rejeitado não produz classificação logística.

Essa classificação deve permanecer independente de `cumprimento_documental_pos_cessao`: uma NF pode estar `Entregue` e ainda ter outra pendência documental pós-cessão.

## 3. Arquitetura atual

### 3.1 Fluxo pré-cessão

```text
Política publicada
  ↓ somente requisitos escopo = nf_pre_cessao
instanciar_requisitos_nota
  ↓
documento_requisito_instancias vinculada à NF
  ↓
uploadDocumentoDaNota
  ↓
documento + versão + vínculo com NF
  ↓
analisar_documento_versao
  ↓
instância satisfeita ou pendente
```

Evidências:

- [requisitos.ts](../../src/lib/documentos-v2/requisitos.ts) resolve a política vigente da NF e chama a instanciação pré-cessão;
- [documento-v2.ts](../../src/lib/actions/documento-v2.ts) consulta apenas `nf_pre_cessao` enquanto não existe entrega;
- [upload.ts](../../src/lib/documentos-v2/upload.ts) exige `requisitoId` e valida que a instância pertence à NF;
- [elegibilidade-documental.server.ts](../../src/lib/operacoes/elegibilidade-documental.server.ts) consulta exclusivamente requisitos e instâncias `nf_pre_cessao`.

### 3.2 Fluxo pós-cessão

```text
Operação criada
  ↓
snapshot imutável da política
  ↓
desembolso
  ↓
nota_fiscal_entregas
  ↓
instâncias pos_cessao/entrega criadas do snapshot
  ↓
uploadDocumentoDaEntrega
  ↓
análise documental
  ↓
avaliar_conclusao_entrega
```

A materialização ocorre no desembolso, não na criação nem na aprovação da operação. A função `desembolsar_operacao_com_logistica` lê `operacoes.politica_snapshot`, cria a entrega e cria as instâncias pós-cessão. Evidência: [20260723165651_corrigir_requisitos_pos_cessao_snapshot.sql](../../supabase/migrations/20260723165651_corrigir_requisitos_pos_cessao_snapshot.sql).

### 3.3 Lacuna entre os fluxos

Não existe uma etapa equivalente a:

```text
documento antecipado vinculado à NF
  ↓
resolver família documental
  ↓
materializar requisito pós
  ↓
reaproveitar documento, versão e análise
```

O reconciliador existente trata somente documentos-base `nf_xml` e `nf_danfe_pdf` no escopo pré-cessão. Ele não é um reconciliador genérico por família e ciclo de vida. Evidências: [reconciliacao.ts](../../src/lib/documentos-v2/reconciliacao.ts) e [20260728220000_reconciliar_documentos_base_nf_checklist_v2.sql](../../supabase/migrations/20260728220000_reconciliar_documentos_base_nf_checklist_v2.sql).

## 4. Política operacional

### 4.1 Representação atual

Cada requisito possui, entre outros:

- `codigo`;
- `tipo_documento_codigo`;
- `momento_obrigatorio`;
- `escopo`, derivado do momento;
- `obrigatorio`;
- `bloqueia_fluxo`, derivado de `obrigatorio`;
- prazo, responsáveis, formatos e nível de validação.

Os escopos válidos são `nf_pre_cessao`, `operacao`, `pos_cessao` e `entrega`. A normalização está centralizada em [requisitos-documentais.ts](../../src/lib/politicas/requisitos-documentais.ts).

Não há propriedade equivalente a:

- disponível para envio antecipado;
- exigir status logístico conhecido antes da cessão;
- família documental normalizada.

Como a regra funcional diz que todo requisito logístico pós-cessão deve aparecer antecipadamente, não é necessário um flag por requisito para visibilidade. É necessário, porém, o flag versionado da política para o gate de elegibilidade.

### 4.2 Duplicidade

A action de criação de versão usa `Set` sobre `requirement.codigo`. A UI normalmente iguala `codigo` ao `tipo_documento_codigo`. O banco possui `UNIQUE (politica_operacional_versao_id, codigo)`.

Consequências:

- mesmo código exato na mesma versão: bloqueado;
- mesmo tipo exato em dois escopos, usando a UI atual: bloqueado pelo código repetido;
- `canhoto` e `comprovante_entrega`: podem coexistir, apesar de representarem a mesma família funcional;
- CT-e e DACTE: não possuem uma regra explícita dizendo se são evidências complementares ou alternativas;
- duplicidade semântica por família: não é bloqueada.

Evidências: [politica.ts](../../src/lib/actions/politica.ts), [PoliticasDoFundo.tsx](../../src/components/politicas/PoliticasDoFundo.tsx) e [ui.ts](../../src/lib/politicas/ui.ts).

### 4.3 Publicação e snapshot

Versões publicadas e requisitos publicados são imutáveis. A operação copia para o snapshot todos os requisitos, prazos, obrigatoriedade, escopos, responsáveis e configurações existentes. Evidência: [politica.ts](../../src/lib/operacoes/politica.ts).

O snapshot atual **não preserva**:

- gate logístico pré-cessão;
- classificação logística da NF na solicitação;
- evidência documental usada na classificação;
- versão documental e data da análise usadas no gate.

Portanto, ele é suficiente para materializar os requisitos pós atuais, mas insuficiente para auditar um futuro gate logístico pré-cessão.

## 5. Exibição e upload antecipado

### 5.1 Resultado atual

| Capacidade | Estado atual |
|---|---|
| Mostrar requisito pós antes da entrega | Não suportado |
| Mostrar item virtual sem instância | Não suportado |
| Upload pós antes do desembolso | Não suportado |
| Upload sem `requisitoId` | Não suportado |
| Diferenciar “opcional agora, obrigatório depois” | Não suportado |
| Usar o mesmo componente para cedente e gestor | Suportado |

O loader compartilhado está em [documento-v2.ts](../../src/lib/actions/documento-v2.ts). Sem entrega, ele restringe a política a `['nf_pre_cessao']`; com entrega, inclui `pos_cessao` e `entrega`. O componente de gestor reutiliza o checklist do cedente por parametrização em [ChecklistGestor.tsx](../../src/components/documentos-v2/ChecklistGestor.tsx) e [ChecklistCedente.tsx](../../src/components/documentos-v2/ChecklistCedente.tsx).

Essa reutilização de componente é positiva, mas não resolve a ausência de dados e comandos no domínio.

## 6. Persistência documental

### 6.1 Estrutura existente

O repositório usa:

- `documentos_repositorio`: identidade e tipo do documento;
- `documento_versoes`: objeto de Storage, hash, remetente e histórico de versões;
- `documento_analises`: análise append-only por versão;
- `documento_vinculos`: contexto do documento;
- `documento_requisito_instancias`: requisito materializado e versão aprovada.

Definição original: [20260721132903_fase3_repositorio_documental_nf.sql](../../supabase/migrations/20260721132903_fase3_repositorio_documental_nf.sql).

### 6.2 Respostas objetivas

- **O documento pode existir sem instância?** O schema permite, mas os fluxos normais de upload do checklist exigem instância. A RPC de CT-e também cria estrutura própria.
- **Pode ser vinculado diretamente à NF?** Sim, por `documento_vinculos.nota_fiscal_id`.
- **A versão pode ser analisada sem instância?** O banco permite, pois a análise referencia a versão. A UI atual não oferece um fluxo antecipado para criar e encontrar essa versão sem requisito.
- **A análise pertence à versão ou à instância?** À versão.
- **A aprovação pode ser reutilizada por outra instância?** O modelo permite a mesma versão em mais de uma instância. Não há reconciliador genérico que faça isso no desembolso.
- **Há risco de duplicar arquivo?** Sim, se a evolução criar um segundo upload pós em vez de reaproveitar documento/versão.
- **Há risco de órfão?** Sim, se um novo fluxo criar documento/versão sem vínculo ou falhar antes de registrar a associação. A solução deve ser transacional no SQL e compensatória no Storage.

A constraint de contexto da instância exige exatamente um entre NF, operação e entrega. Assim, a mesma instância não representa simultaneamente o estado antecipado e o estado pós-cessão.

## 7. Análise pelo gestor

O método genérico `analisarVersaoDocumento` chama `analisar_documento_versao`. A função:

- grava análise append-only;
- atualiza a versão e o documento;
- atualiza todas as instâncias que apontam para aquele documento;
- reavalia uma entrega encontrada no vínculo.

Evidências: [documento-v2.ts](../../src/lib/actions/documento-v2.ts) e [20260723143749_evoluir_documentos_pos_cessao_nf_cedente.sql](../../supabase/migrations/20260723143749_evoluir_documentos_pos_cessao_nf_cedente.sql).

Não há uma fila ou seção de análise para evidência logística antecipada sem instância. Logo, a capacidade de análise antecipada existe apenas no nível estrutural do repositório, não no produto.

Ponto de atenção: a action exige apenas papel `gestor`; ela não valida explicitamente o fundo ativo da versão. Esse risco é ampliado pelas policies amplas por papel descritas na seção de segurança.

## 8. Status logístico atual

### 8.1 Persistência e derivação

O status físico é persistido em `nota_fiscal_entregas.status_entrega`, com valores como:

- `nao_aplicavel`;
- `em_transito`;
- `aguardando_validacao`;
- `entregue`;
- `entrega_com_pendencia`;
- `devolvida`;
- `cancelada`.

Esse registro só existe depois do desembolso. Não há `Indeterminada` persistida nem derivada antes da operação.

A apresentação também deriva estados como `aguardando_comprovante`, `em_analise` e `em_atraso` combinando status da entrega e documentos. Evidência: [resumo-operacional.ts](../../src/lib/documentos-v2/resumo-operacional.ts).

### 8.2 Divergências em relação à regra futura

- o desembolso cria `em_transito` quando o acompanhamento está habilitado, mesmo sem CT-e aprovado;
- upload de documento pode mover a entrega para `aguardando_validacao` antes da aprovação;
- a conclusão atual considera o conjunto de requisitos obrigatórios, não somente a precedência “comprovante aprovado vence CT-e”;
- `Indeterminada` não existe;
- status físico e situação documental são combinados em alguns resumos.

Evidências: [20260723125851_corrigir_fluxo_status_entrega_pos_cessao.sql](../../supabase/migrations/20260723125851_corrigir_fluxo_status_entrega_pos_cessao.sql) e [acompanhamento-operacao.ts](../../src/lib/logistica/acompanhamento-operacao.ts).

Conclusão: o status atual pós-desembolso não pode ser reutilizado diretamente como classificação logística pré-cessão.

## 9. Evidências, prioridade e histórico

O repositório preserva versões e análises; versões aprovadas são imutáveis e análises são append-only. Isso oferece base para auditoria.

Lacunas:

- não existe resolvedor único da evidência logística vigente;
- não existe regra central de precedência `Entregue > Em trânsito > Indeterminada`;
- substituição ou rejeição posterior não dispara uma reclassificação pré-cessão, pois essa classificação não existe;
- não há memória do resultado usado na solicitação/aprovação da operação;
- a função genérica de análise reavalia somente uma entrega encontrada com `LIMIT 1`, insuficiente para uma evidência compartilhada entre várias NFs.

## 10. CT-e compartilhado

### 10.1 O que existe

O modelo possui:

```text
ctes
  ↓ 1:N
cte_notas_fiscais
  ↑ N:1
notas_fiscais
```

A PK `(cte_id, nota_fiscal_id)` evita vínculo repetido. `registrar_cte_documento` aceita uma lista de NFs, cria um único documento/versão/CT-e e vincula o CT-e às NFs. Evidências: [20260721183540_fase5_logistica_pos_cessao.sql](../../supabase/migrations/20260721183540_fase5_logistica_pos_cessao.sql), [20260727142150_validacao_cte_nfe.sql](../../supabase/migrations/20260727142150_validacao_cte_nfe.sql) e [logistica.ts](../../src/lib/actions/logistica.ts).

### 10.2 Limitações

- a RPC exige que todas as NFs já tenham entrega logística ativa;
- o upload pelo checklist de uma NF envia apenas aquela NF à RPC;
- a action especializada de análise de CT-e existe, mas não é consumida pela UI atual do checklist;
- a análise genérica reavalia apenas uma entrega;
- não há suporte antecipado, pois ainda não existe entrega;
- a massa de homologação consultada não contém CT-e compartilhado para teste funcional.

Conclusão: **a estrutura N:N e o registro compartilhado existem, mas o caso de uso não está completo ponta a ponta**.

## 11. Comprovante de entrega e postergação

O comprovante/canhoto atual:

- pertence a uma entrega logística;
- exige instância pós-cessão e entrega aberta para upload;
- não pode ser criado antes do desembolso pelo fluxo atual;
- ao ser analisado, pode contribuir para `entregue` por `avaliar_conclusao_entrega`;
- é individual por NF/entrega.

A postergação é bloqueada quando existe `primeiroUploadEm`, inclusive se o documento foi rejeitado. Há validação equivalente no domínio e no banco. Evidências: [postergacao-canhoto.ts](../../src/lib/logistica/postergacao-canhoto.ts) e [20260731171219_postergacao_upload_canhoto.sql](../../supabase/migrations/20260731171219_postergacao_upload_canhoto.sql).

Como o upload antecipado não existe, a trava não é acionada antecipadamente. Uma evolução deverá consultar o primeiro upload tanto na evidência vinculada diretamente à NF quanto na instância pós materializada. Caso contrário, seria possível postergar depois de já ter enviado o comprovante antes da cessão.

## 12. Materialização e reconciliação

### 12.1 Comportamento atual

No desembolso:

1. a operação é bloqueada e validada;
2. o snapshot é lido;
3. a entrega é criada;
4. prazos são calculados a partir do desembolso;
5. requisitos `pos_cessao` e `entrega` são criados;
6. instâncias nascem pendentes;
7. nenhum documento antecipado é pesquisado.

### 12.2 Semântica ausente

| Evidência anterior | Estado desejado da instância pós | Atual |
|---|---|---|
| Aprovada | mesma versão, satisfeita | não reconciliado |
| Aguardando análise | mesma versão, em análise | não reconciliado |
| Rejeitada | histórico preservado, pendente | não reconciliado |
| Ausente | aguardando envio e prazo iniciado | suportado |

A função administrativa de reparo também recria instâncias com base no snapshot, sem reconciliar evidências por família.

## 13. Elegibilidade pré-cessão e futuro limite de 40%

O motor atual de elegibilidade ignora requisitos pós-cessão de forma explícita. Isso está coberto por testes e é correto para a regra vigente. Não existe gate logístico.

Proposta conceitual futura:

```text
politica.exigir_status_logistico_pre_cessao = false
  → Indeterminada não bloqueia

politica.exigir_status_logistico_pre_cessao = true
  → Em trânsito ou Entregue: elegível
  → Indeterminada: inelegível
```

O gate deve ser avaliado, no mínimo, na submissão da NF e novamente na criação/aprovação da operação, sempre pelo snapshot aplicável. A classificação e a evidência usadas precisam ser memorizadas junto ao resultado do gate.

Para um futuro limite de 40%, o modelo já fornece o valor da NF e evidências documentais atuais, mas **não fornece todos os dados históricos necessários**:

- não há classificação pré-cessão;
- não há memória da classificação na solicitação;
- não há memória da classificação recalculada na aprovação;
- não há versão documental/evidência associada ao resultado;
- o status atual só existe depois do desembolso.

Logo, não é possível implementar um limite auditável apenas com leituras do modelo atual.

## 14. Segurança, RLS, Storage e multifundo

### 14.1 Pontos positivos

- o bucket `documentos-v2` é privado;
- a autorização de leitura do Storage resolve o objeto por vínculo e, para gestor, verifica acesso ao fundo;
- o upload valida acesso à NF no servidor;
- o fluxo especializado de CT-e valida que as NFs pertencem ao mesmo cedente, fundo e vínculo;
- não há necessidade de `service_role` no navegador.

Evidência: [20260731140710_escopo9c_storage_autorizacao_multifundo.sql](../../supabase/migrations/20260731140710_escopo9c_storage_autorizacao_multifundo.sql).

### 14.2 Riscos encontrados

No schema de homologação consultado:

- policies de gestor para documentos, versões, vínculos, instâncias, análises, entregas, CT-es e canhotos concedem acesso por papel, sem filtro de fundo;
- `logistica_usuario_pode_ler_entrega` retorna `true` para qualquer gestor;
- `requireCedenteAccess` retorna acesso para qualquer gestor;
- `analisarVersaoDocumento` exige gestor, mas não fundo ativo;
- `ctes.chave_cte` é única globalmente e os campos `fundo_id`/`cedente_fundo_id` ainda são anuláveis no schema de homologação.

O Storage está mais restritivo que algumas tabelas públicas. Isso não impede a leitura direta de metadados nem uma chamada direta de análise caso um ID seja conhecido.

Risco multifundo para a futura funcionalidade: **alto enquanto a autorização por fundo não for aplicada nas actions/RPCs e policies envolvidas**. O desenho futuro deve validar `fundo_id`, `cedente_fundo_id` e acesso do ator em todas as camadas, inclusive para cada NF de um CT-e compartilhado.

## 15. Performance

O checklist atual faz consultas agregadas por uma NF e evita uma consulta por item. Para uma tela de detalhe isso é aceitável.

Uma evolução deve evitar:

- buscar a política e documentos futuros individualmente para cada requisito;
- derivar o status de cada NF com novas consultas unitárias em listas/operações;
- consultar cada vínculo de um CT-e compartilhado separadamente;
- reavaliar cada NF fora da transação de materialização.

Proposta:

- loader único por lista de `nota_fiscal_id`;
- requisitos futuros indexados em mapa por família;
- versões/análises atuais carregadas em lote;
- resolvedor puro compartilhado para classificação;
- RPC transacional para reconciliar todas as NFs do desembolso;
- índices em `documento_vinculos(nota_fiscal_entrega_id)` e `documento_vinculos(cte_id)`, ausentes na homologação consultada;
- índice composto para localizar evidência por NF e tipo/família, conforme o desenho final.

## 16. Evidência do banco de homologação

As consultas foram executadas com `BEGIN TRANSACTION READ ONLY`, sem expor IDs, nomes, CNPJs, paths ou conteúdo documental.

Resumo sanitizado:

- versões publicadas possuem requisitos pré de XML/DANFE/pedido e um caso de CT-e pré;
- versões publicadas possuem três requisitos pós de comprovante de entrega;
- não foi encontrada duplicidade semântica ativa entre escopos na massa atual;
- foram encontradas 1.004 instâncias pré-cessão vinculadas à NF;
- foram encontradas **zero** instâncias `pos_cessao/entrega` vinculadas antecipadamente à NF;
- foram encontradas 252 operações, todas com snapshot;
- existe uma evidência CT-e vinculada diretamente a NF no escopo pré;
- não existem registros de `ctes`, `cte_notas_fiscais`, `canhotos` ou postergações na massa consultada;
- a massa contém entregas com diversos status, mas sem evidências logísticas reais correspondentes.

Conclusão sobre a massa: ela confirma o modelo e a ausência de instâncias antecipadas, mas **não permite homologar funcionalmente** CT-e compartilhado, canhoto, postergação e reconciliação pós-cessão.

## 17. Testes existentes

Foram executados 11 arquivos relacionados, com **105 testes aprovados**:

- política e normalização de requisitos;
- separação pré/pós;
- reconciliação de XML/DANFE;
- satisfação documental;
- resumo operacional;
- validação CT-e × NF-e;
- postergação;
- acompanhamento logístico;
- elegibilidade documental;
- timeline por política;
- checklist compartilhado.

Também foi executado `npx tsc --noEmit`, sem erros.

Testes que explicitam o comportamento atual:

- [requisitos-pos-cessao.test.ts](../../src/lib/documentos-v2/requisitos-pos-cessao.test.ts): CT-e pré não é pós e CT-e pós só é pós quando explicitamente configurado;
- [elegibilidade-documental.test.ts](../../src/lib/operacoes/elegibilidade-documental.test.ts): requisito pós não bloqueia solicitação;
- [politica-operacao.test.ts](../../src/lib/operacoes/politica-operacao.test.ts): CT-e pré e pós são tratados como etapas distintas;
- [reconciliacao.test.ts](../../src/lib/documentos-v2/reconciliacao.test.ts): reconciliação limitada a documentos-base da NF;
- [postergacao-canhoto.test.ts](../../src/lib/logistica/postergacao-canhoto.test.ts): qualquer primeiro upload bloqueia postergação.

Lacunas de teste:

- item virtual pós exibido antes da cessão;
- upload antecipado sem instância pós;
- análise antecipada por fundo autorizado;
- reconciliação aprovada/em análise/rejeitada/ausente;
- nenhuma duplicação de objeto, documento, versão ou análise;
- CT-e compartilhado por várias NFs no fluxo real da UI;
- reavaliação de todas as entregas após análise compartilhada;
- precedência `Entregue > Em trânsito > Indeterminada`;
- regressão após substituição/rejeição/cancelamento;
- gate true/false e snapshot;
- bloqueio de postergação por upload antecipado;
- isolamento multifundo em actions, RPCs, RLS e Storage;
- carga em lote e ausência de N+1.

## 18. Matriz de cenários futura

| Cenário | Resultado esperado | Suporte atual |
|---|---|---|
| CT-e aprovado antes da cessão | Em trânsito | Não |
| Comprovante aprovado antes da cessão | Entregue | Não |
| Ambos aprovados | Entregue | Não |
| CT-e aguardando análise | Indeterminada | Não |
| Comprovante aguardando análise | Indeterminada | Não |
| Documento rejeitado | Indeterminada | Não |
| Nenhum documento | Indeterminada | Não há classificação pré |
| Política não exige status pré | Indeterminada não bloqueia | Parcial: pós já não bloqueia, sem classificação/configuração |
| Política exige status pré | Indeterminada bloqueia | Não |
| CT-e aprovado compartilhado por três NFs | três NFs Em trânsito | Parcial: N:N existe, classificação não |
| Uma das NFs possui comprovante | somente ela Entregue | Não |
| Documento aprovado antecipadamente | requisito pós nasce satisfeito | Não |
| Documento aguardando análise | requisito pós nasce em análise | Não |
| Documento rejeitado | requisito pós nasce pendente | Não |
| Documento ausente | requisito pós nasce aguardando envio | Sim, após desembolso |
| Requisito antecipadamente satisfeito | prazo registrado, sem cobrança | Não |
| Upload antecipado de comprovante | postergação bloqueada | Não |
| Duplicidade pré/pós | publicação bloqueada | Parcial: código exato sim; família não |
| Gestor de outro fundo | acesso negado | Não garantido em todas as camadas |
| Cedente de outro fundo | upload negado | Parcial: ownership por cedente; fundo precisa endurecimento |
| Política alterada depois | operação mantém snapshot | Sim |
| Documento substituído | histórico e classificação coerentes | Histórico sim; classificação pré não |

## 19. Hipóteses avaliadas

| Hipótese | Resultado | Evidência |
|---|---|---|
| Requisitos pós só aparecem depois do desembolso | Confirmada | loader inclui pós somente quando existe entrega |
| Upload exige instância existente | Confirmada | `uploadDocumentoDaNota/Entrega` exige `requisitoId` contextual |
| Documento não pode ser analisado sem instância | Parcialmente confirmada | banco analisa versão; produto não cria/exibe a evidência antecipada |
| Reconciliador atual só funciona dentro do mesmo escopo | Parcialmente confirmada | ele é ainda mais restrito: pré e somente XML/DANFE |
| CT-e já possui relação N:N com NFs | Confirmada | PK `(cte_id, nota_fiscal_id)` |
| Canhoto só pode existir após entrega materializada | Confirmada | upload e tabela exigem entrega |
| Status logístico atual só existe pós-desembolso | Confirmada | depende de `nota_fiscal_entregas` |
| Painel confunde entrega com conclusão documental | Parcialmente confirmada | há separação detalhada, mas resumos combinam os conceitos |
| Snapshot já contém dados suficientes | Parcialmente confirmada | contém requisitos; não contém gate/classificação/evidência |
| Duplicidade entre escopos é permitida | Parcialmente confirmada | código exato bloqueado; sinônimos/famílias permitidos |
| Política já possui campo equivalente ao gate | Descartada | nenhum campo equivalente no código/schema de homologação |
| RLS impede reaproveitamento legítimo | Descartada como causa principal | o bloqueio é o fluxo/instância; RLS de gestor é, na verdade, ampla |
| Aprovação antecipada poderia ser reutilizada sem migration | Parcialmente confirmada | tabelas permitem reuso, mas faltam gate, unicidade semântica e RPC segura |
| Migration é necessária para status pré ou vínculos | Parcialmente confirmada | status pode ser derivado e vínculo NF já existe; gate/constraints/RPC exigem migration |
| O modelo atual permite derivar tudo apenas em leitura | Descartada | falta evidência antecipada oficial e memória histórica do gate |

## 20. Proposta de arquitetura futura

### 20.1 Princípios

1. manter um único requisito oficial pós-cessão;
2. apresentar antes da cessão um item virtual derivado da política, sem criar requisito pré duplicado;
3. persistir a evidência no repositório e vinculá-la diretamente à NF;
4. analisar a versão antes da entrega usando o mesmo histórico;
5. derivar status logístico somente de versões aprovadas;
6. materializar sempre a instância pós no desembolso;
7. reconciliar a instância com a evidência existente por família normalizada;
8. criar vínculo adicional com a entrega, sem copiar objeto/versão/análise;
9. preservar no snapshot o gate e, no evento de elegibilidade, a classificação/evidência usada;
10. validar fundo e vínculo em action, RPC e RLS.

### 20.2 Persistência recomendada

O modelo atual pode ser aproveitado sem criar uma segunda tabela de documentos:

```text
Antes da cessão
documentos_repositorio
  └─ documento_versoes
      └─ documento_analises
documento_vinculos → nota_fiscal_id

Depois do desembolso
documento_requisito_instancias → nota_fiscal_entrega_id
documento_vinculos adicional → nota_fiscal_entrega_id
instância.documento_id / versao_aprovada_id → evidência existente
```

Para isso ser determinístico, a publicação deve garantir uma única exigência por família documental na versão. O vínculo por NF e o tipo normalizado passam a ser a chave de reconciliação.

### 20.3 CT-e compartilhado

- permitir registrar CT-e antes da entrega, mantendo `ctes` + `cte_notas_fiscais`;
- validar todas as NFs como mesmo cedente/fundo/vínculo;
- usar um único documento/versão/análise;
- após o desembolso de cada NF, ligar a mesma evidência à sua entrega/instância;
- na análise ou substituição, reclassificar todas as NFs vinculadas, em lote;
- não usar a action genérica que reavalia apenas uma entrega.

### 20.4 Classificação

Criar um resolvedor puro e central:

```text
resolverStatusLogisticoPreCessao(evidenciasAprovadas)
```

Ele deve retornar status, evidência vencedora, versão, data da análise e motivo. O status pode ser derivado; não é necessário duplicá-lo na NF. Para auditoria da decisão, o resultado usado em cada gate deve ser persistido no snapshot/evento da operação.

### 20.5 Migrations necessárias

Migrations incrementais são necessárias para:

1. adicionar `exigir_status_logistico_pre_cessao` à versão da política, com default compatível `false`;
2. transportar o campo para o snapshot e validar publicação;
3. criar unicidade por família normalizada na versão da política, após auditoria de conflitos;
4. adaptar/criar RPC transacional de upload antecipado vinculado à NF;
5. adaptar a RPC de CT-e para permitir vínculo pré-entrega com autorização multifundo;
6. criar RPC de reconciliação idempotente no desembolso/reparo;
7. registrar memória do gate e evidência utilizada, preferencialmente em evento/snapshot operacional imutável;
8. endurecer RLS/actions/RPCs por fundo e vínculo;
9. adicionar índices de vínculo por entrega/CT-e e de busca da evidência por NF/família.

Não é necessário persistir um status logístico pré redundante se ele puder ser derivado de forma barata e determinística. Também não é necessário copiar arquivo, hash, versão ou análise.

### 20.6 Validação de publicação

A validação deve existir em mais de uma camada:

- domínio: normalização de família e erro canônico;
- UI: feedback imediato;
- action/RPC de publicação: autoridade final;
- índice/constraint: proteção concorrente quando tecnicamente viável.

Mensagem sugerida:

> O documento já está configurado como requisito pós-cessão e será disponibilizado automaticamente para envio antecipado. Não o cadastre novamente na etapa pré-cessão.

CT-e XML e DACTE devem ser definidos explicitamente como alternativos ou complementares antes de incluí-los na mesma família de unicidade.

## 21. Ordem de implementação proposta

1. definir famílias e a regra CT-e XML × DACTE;
2. criar testes de domínio para classificação e duplicidade;
3. migration do gate, constraints, índices e autorização;
4. resolvedor e loader agregado de itens virtuais;
5. upload antecipado de comprovante individual;
6. análise antecipada com validação de fundo;
7. CT-e antecipado compartilhado N:N;
8. reconciliação idempotente no desembolso e reparo;
9. gate de elegibilidade e memória no snapshot/evento;
10. postergação considerando upload antecipado;
11. testes de integração/RLS/Storage/concorrência;
12. homologação com massa real sanitizada.

## 22. Arquivos provavelmente envolvidos na implementação futura

Domínio e política:

- `src/lib/politicas/requisitos-documentais.ts`;
- `src/lib/politicas/ui.ts`;
- `src/lib/actions/politica.ts`;
- `src/components/politicas/PoliticasDoFundo.tsx`;
- `src/lib/operacoes/politica.ts`;
- `src/lib/operacoes/elegibilidade-documental.ts`;
- `src/lib/operacoes/elegibilidade-documental.server.ts`.

Documentos e logística:

- `src/lib/actions/documento-v2.ts`;
- `src/lib/documentos-v2/upload.ts`;
- `src/lib/documentos-v2/requisitos.ts`;
- `src/lib/documentos-v2/requisitos-pos-cessao.ts`;
- `src/lib/documentos-v2/reconciliacao.ts`;
- `src/lib/documentos-v2/satisfacao-requisito.ts`;
- `src/lib/documentos-v2/resumo-operacional.ts`;
- `src/lib/logistica/acompanhamento-operacao.ts`;
- `src/lib/logistica/postergacao-canhoto.ts`;
- `src/lib/actions/logistica.ts`;
- `src/components/documentos-v2/ChecklistCedente.tsx`;
- `src/components/documentos-v2/ChecklistGestor.tsx`.

Banco:

- nova migration incremental; não editar migrations aplicadas;
- RPCs de desembolso/materialização/reparo;
- RPCs de upload/análise/CT-e;
- policies de repositório, logística e Storage.

## 23. Riscos e rollback

Riscos principais:

- duplicar evidência por família;
- alterar a política entre upload e criação da operação;
- reaproveitar documento de outro fundo/cedente;
- reclassificar apenas uma NF de CT-e compartilhado;
- permitir postergação depois de upload antecipado;
- misturar status físico e cumprimento documental;
- criar N+1 nas listas;
- perder a evidência histórica usada no gate;
- quebrar snapshots e operações legadas.

Estratégia de rollback:

- mudanças aditivas e defaults compatíveis;
- gate novo com default `false`;
- operações antigas continuam usando snapshots antigos;
- reconciliador idempotente e versionado;
- desligar a exibição/gate sem apagar documentos já enviados;
- não remover vínculos, versões ou análises durante rollback;
- manter caminho pós-cessão atual como fallback até homologação completa;
- migration de constraint somente após relatório de conflitos e saneamento controlado.

## 24. Parecer final

| Pergunta | Resposta |
|---|---|
| O que já funciona? | Repositório versionado, análise por versão, snapshot, materialização pós no desembolso, upload/análise pós, Storage privado e relação CT-e/NF N:N |
| O que não funciona? | Exibição, upload, análise, classificação e gate logístico antes da cessão; reconciliação antecipado → pós |
| O que é parcial? | Reuso estrutural da evidência, CT-e compartilhado e separação entre status físico/documental |
| Há upload antecipado oficial? | Não |
| Há análise antecipada oficial? | Não |
| Há status logístico pré-cessão? | Não |
| Há reconciliação? | Apenas XML/DANFE pré; não para logística antecipada |
| CT-e compartilhado funciona? | Estrutura e RPC parcial; não ponta a ponta |
| Duplicidade é bloqueada? | Código exato sim; família/sinônimos não |
| É necessária migration? | Sim |
| Risco multifundo | Alto nas actions/policies relacionadas até validação por fundo ser endurecida |
| Recomendação | Implementação aditiva, orientada por política, com evidência única por NF/família e reconciliação idempotente |

Nenhum código, migration, policy, dado, objeto de Storage, commit ou push foi alterado durante este diagnóstico.
