# Envio antecipado de documentos logísticos

## 1. Parecer executivo

O BW Antecipa passa a permitir que documentos que continuam sendo requisitos
oficiais pós-cessão sejam enviados e analisados antes da cessão. A solução não
duplica requisitos na política, não cria uma instância pré-cessão artificial e
reaproveita o mesmo documento, versão e análise quando o fluxo pós-cessão é
materializado.

A classificação física da NF foi separada do cumprimento documental:

- comprovante de entrega aprovado classifica a NF como `ENTREGUE`;
- na ausência de comprovante aprovado, CT-e/DACTE aprovado classifica como
  `EM_TRANSITO`;
- sem evidência aprovada, a classificação é `INDETERMINADA`;
- requisitos obrigatórios pós-cessão continuam sendo avaliados
  independentemente da classificação física.

O limite futuro de 40% de exposição em trânsito não foi implementado. A
migration foi criada localmente, mas não foi aplicada em nenhum banco.

## 2. Regra funcional

Cada obrigação documental logística é cadastrada uma única vez na versão da
política operacional, com escopo oficial `pos_cessao` ou `entrega`. Antes da
materialização da entrega, o portal deriva dessa configuração um item virtual de
envio antecipado. Esse item é opcional naquele momento, embora o requisito
continue obrigatório no marco definido pela política.

```text
Política publicada / snapshot da operação
                  |
                  v
       Requisito oficial pós-cessão
                  |
        +---------+----------+
        |                    |
        v                    v
Envio antecipado       Materialização pós-cessão
        |                    |
        +------ mesma -------+
          evidência/versão
```

Não é criada uma segunda linha em `politica_requisitos_documentais` nem uma
`documento_requisito_instancia` pré-cessão.

## 3. Famílias documentais

O catálogo canônico está centralizado em
`src/lib/logistica/evidencias-logisticas.ts`.

| Família | Códigos reconhecidos | Efeito após aprovação |
|---|---|---|
| `cte` | `cte`, `cte_xml`, `cte_pdf_dacte`, `cte_dacte_pdf`, `dacte` | `EM_TRANSITO` |
| `comprovante_entrega` | `canhoto`, `comprovante_entrega`, `comprovante_de_entrega` | `ENTREGUE` |

A versão da política não pode possuir duas obrigações ativas da mesma família.
Essa regra é validada no domínio/action e por índice parcial no banco. A
migration contém uma auditoria preventiva e falha de forma explícita caso
encontre conflitos, sem alterar políticas publicadas.

## 4. Política versionada e gate

Foi adicionado à versão da política o campo:

```text
exigir_status_logistico_pre_cessao boolean NOT NULL DEFAULT false
```

Comportamento:

| Flag | Classificação | Resultado |
|---|---|---|
| `false` | qualquer | não bloqueia por este gate |
| `true` | `ENTREGUE` | elegível |
| `true` | `EM_TRANSITO` | elegível |
| `true` | `INDETERMINADA` | bloqueada |

O valor participa do hash e da cópia de versões, é exibido no editor/revisão e
integra o snapshot de novas operações. A publicação continua imutável: uma
alteração exige nova versão. O default `false` mantém a compatibilidade das
políticas existentes.

O gate é reavaliado no servidor na submissão/aprovação da NF, criação da
operação e aprovação da operação. A migration mantém a defesa no banco por
triggers; a action antecipa a mensagem amigável para a interface.

## 5. Fonte da política e item antecipado

Para NF sem operação, a fonte é o vínculo ativo `cedente_fundos`, sua política
ativa e a versão publicada aplicável. Para NF já associada a uma operação, a
fonte é a versão/snapshot congelado da operação. Uma publicação posterior não
altera a experiência histórica daquela operação.

O loader compartilhado do checklist resolve em lote:

- a versão aplicável;
- os requisitos oficiais logísticos;
- evidências e histórico;
- NFs candidatas do mesmo vínculo para CT-e compartilhado;
- classificação e fundamento do status atual;
- situação do gate.

Antes da entrega, o item aparece na seção de evidências antecipadas e não entra
na contagem de pendências pré-cessão. Depois da materialização, deixa de ser
virtual e passa a aparecer exclusivamente no checklist oficial pós-cessão.

## 6. Upload antecipado

O fluxo está implementado em
`src/lib/logistica/upload-antecipado.server.ts` e na RPC
`registrar_documento_logistico_antecipado`.

```text
Cedente autenticado
  -> autorização de todas as NFs
  -> resolução do requisito/família no servidor
  -> validação do catálogo, formato e tamanho
  -> validação CT-e x NFs, quando XML
  -> upload no bucket privado
  -> RPC transacional
  -> documento + versão + vínculos + evidência + evento
  -> confirmação
```

O cliente não escolhe livremente fundo, cedente, vínculo, política, família,
análise ou entrega. Esses dados são derivados de entidades autorizadas. As NFs
de um upload compartilhado precisam pertencer ao mesmo fundo, cedente e vínculo
ativo.

O path é gerado no servidor. Se a RPC falhar, o objeto recém-enviado é removido.
Em replay idempotente, a RPC reutiliza a evidência existente e o upload
redundante é compensado. Nenhuma URL assinada é persistida.

## 7. Análise e classificação

O checklist compartilhado continua usando a análise documental existente. Uma
proteção adicional no banco exige gestor ativo e autorização no fundo da
evidência antes de inserir análise.

Somente uma versão aprovada e ainda válida produz efeito logístico. Upload
pendente, rejeitado, cancelado ou sem análise aprovada não classifica a NF. Uma
substituição aguardando análise não apaga silenciosamente a última evidência
aprovada; a nova versão passa a vencer quando for aprovada.

Prioridade da função pura e da função SQL:

```text
Comprovante de entrega aprovado -> ENTREGUE
senão CT-e/DACTE aprovado       -> EM_TRANSITO
senão                           -> INDETERMINADA
```

O resultado guarda família vencedora, documento, versão, análise, data, ator,
fundamento e versão do resolvedor. A aprovação de uma evidência compartilhada
reavalia o conjunto de NFs ligadas ao mesmo documento.

## 8. Status físico versus cumprimento documental

Os dois conceitos permanecem independentes. Uma NF pode estar `ENTREGUE` por
possuir comprovante aprovado e ainda ter CT-e obrigatório pendente. Nesse caso:

```text
Status logístico: ENTREGUE
Cumprimento pós-cessão: pendente
Pendência: CT-e/DACTE
```

O painel e o checklist não convertem a classificação física em aprovação
automática dos demais requisitos.

## 9. CT-e compartilhado N:N

Um CT-e pode ser associado a múltiplas NFs autorizadas no mesmo contexto. O
fluxo grava:

```text
1 documento
  -> 1 versão
  -> 1 análise
  -> 1 registro lógico de CT-e
  -> N cte_notas_fiscais
  -> N evidências/classificações
```

A RPC usa lock transacional por conjunto lógico para serializar uploads
concorrentes e evita cópia do objeto por NF. A UI permite selecionar apenas NFs
candidatas carregadas do mesmo `cedente_fundo`. Ao substituir um CT-e já
compartilhado, o servidor expande o conjunto para todas as NFs ligadas à
evidência e revalida a autorização do conjunto. A validação estrutural do CT-e
contra todas as NFs é reaproveitada do domínio já existente.

## 10. Comprovante de entrega e postergação

O comprovante antecipado pertence a uma única NF. A partir do primeiro upload,
inclusive de versão posteriormente rejeitada ou substituída, a postergação fica
permanentemente indisponível. A trava consulta o histórico append-only da
evidência e não apenas a versão vigente.

Quando aprovado, o comprovante classifica a NF como `ENTREGUE`; isso não elimina
a materialização dos requisitos oficiais restantes.

## 11. Snapshot e memória do gate

Novas operações congelam a flag da política e os requisitos no snapshot
existente. A tabela `operacao_nf_logistica_memorias` registra de forma imutável,
por NF e momento de avaliação:

- classificação logística;
- família vencedora;
- documento e versão;
- data e responsável pela análise;
- versão da política;
- resultado do gate;
- momento `criacao` ou `aprovacao`;
- versão do resolvedor.

O arquivo não é copiado para o snapshot. Operações legadas sem versão de
política permanecem compatíveis e não recebem backfill.

## 12. Materialização e reconciliação

No marco pós-cessão, o fluxo existente continua criando a entrega e todas as
instâncias oficiais, inclusive as que já possuem evidência antecipada. Triggers
chamam um reconciliador genérico por NF, família, versão de política e requisito.

O reconciliador:

- aponta a instância para o mesmo documento e versão;
- adiciona o vínculo com a entrega sem copiar o objeto;
- preserva a análise existente;
- materializa os registros operacionais de CT-e/canhoto;
- reavalia a conclusão da entrega;
- registra evento de reconciliação;
- pode ser executado novamente sem duplicar instância, vínculo, versão ou
  análise.

Estados esperados:

| Evidência antecipada | Instância oficial |
|---|---|
| aprovada | nasce satisfeita |
| aguardando análise | nasce aguardando análise |
| rejeitada | nasce pendente, preservando histórico |
| ausente | nasce aguardando envio |

## 13. Modelo de dados da migration

### `politica_operacional_versoes`

Recebe a flag versionada do gate. O trigger de imutabilidade foi recomposto para
abranger o novo campo e os campos já existentes da versão.

### `politica_requisitos_documentais.familia_documental`

Coluna gerada a partir dos aliases canônicos. Um índice parcial garante uma
família ativa única por versão de política.

### `evidencias_logisticas_antecipadas`

Ponte vigente entre NF, requisito oficial, família e versão documental atual.
Possui unicidade por NF, versão de política e família, além de índices para
documento, fundo/NF e requisito.

### `evidencia_logistica_versoes`

Histórico append-only de cada versão associada à evidência. É a fonte para
idempotência, auditoria de substituições e trava definitiva da postergação.

### `operacao_nf_logistica_memorias`

Memória imutável da classificação e decisão do gate na criação e aprovação da
operação.

## 14. Autorização, RLS e Storage

As novas tabelas possuem RLS habilitada. O acesso de leitura cruza a entidade
com `cedente_fundos` e os helpers de autorização existentes. Escritas diretas de
`anon` e `authenticated` foram revogadas; mutações ocorrem pelas RPCs
controladas. `service_role` permanece restrito ao servidor.

As funções `SECURITY DEFINER` usam `search_path` fixo e derivam o ator com
`auth.uid()`. Nenhum `user_id` fornecido pelo cliente é aceito. O gestor precisa
estar ativo e vinculado ao fundo; o cedente precisa ser o titular canônico da NF
e possuir vínculo ativo.

O bucket documental continua privado. O fluxo não cria URL pública nem persiste
URL assinada. Download e análise continuam passando pelos controles já
existentes de documento/NF/fundo.

## 15. Performance

- checklist, evidências, requisitos e versões são carregados em lote;
- o gate de múltiplas NFs usa uma única RPC;
- CT-e compartilhado é processado como conjunto;
- mapas em memória evitam buscas repetidas por família;
- os novos índices cobrem lookup por NF/fundo, requisito e versão documental;
- não foi introduzida consulta por NF dentro do fluxo de aprovação em lote.

`EXPLAIN` remoto não foi executado porque a migration ainda não foi aplicada e o
escopo proíbe alteração remota.

## 16. Eventos e auditoria

A migration registra eventos de envio, análise, vínculo compartilhado,
reconciliação, recálculo e bloqueio do gate no mecanismo de domínio existente.
O log de aplicação adiciona contexto funcional, sem conteúdo do arquivo, token,
URL assinada ou credencial.

## 17. Compatibilidade histórica

- o novo gate tem default `false`;
- nenhuma política publicada antiga é atualizada;
- nenhuma NF, entrega ou operação histórica é reclassificada por backfill;
- operações com snapshot continuam usando a versão congelada;
- o fluxo pós-cessão atual permanece como fallback;
- documentos antigos não são copiados ou removidos;
- postergações antigas não são recalculadas;
- o limite de exposição de 40% não existe nesta implementação.

## 18. Testes e validações

Testes novos:

- `src/lib/logistica/evidencias-logisticas.test.ts`: aliases, unicidade,
  prioridade, estados sem efeito e gate;
- `src/lib/logistica/evidencias-logisticas.migration.test.ts`: contrato da
  migration, transação, default compatível, ausência de backfill, N:N, locks,
  memória, reconciliação, RLS, compensação de Storage e ausência da regra de
  40%;
- `src/lib/operacoes/politica.test.ts`: snapshot e hash da nova flag.

Validações executadas durante a implementação:

- TypeScript sem emissão: aprovado;
- suíte completa Vitest: 82 arquivos e 627 testes aprovados;
- lint: aprovado, mantendo seis warnings preexistentes fora do escopo;
- testes direcionados finais do domínio/política/migration: 31 aprovados;
- auditoria somente leitura em homolog: nenhuma duplicidade de família entre os
  requisitos logísticos existentes;
- migration remota: não executada;
- PERF9B/AAL2 e Storage 9C remotos: não executados, pois dependem do schema
  remoto e podem criar massa/objetos;
- homologação funcional com massa sintética: pendente da aplicação autorizada
  da migration.

Os resultados definitivos de `git diff --check` e build constam no relatório de
entrega da execução.

## 19. Homologação recomendada

Após aplicar a migration em ambiente autorizado, validar com massa sintética:

1. publicar política sem gate e outra com gate;
2. confirmar que CT-e e comprovante aparecem antecipadamente sem duplicar
   requisito;
3. enviar CT-e XML para três NFs do mesmo vínculo;
4. aprovar uma única versão e confirmar as três NFs como `EM_TRANSITO`;
5. enviar/aprovar comprovante em uma NF e confirmar prioridade `ENTREGUE`;
6. confirmar que pendentes e rejeitados não classificam;
7. testar submissão, criação e aprovação de operação com gate ligado/desligado;
8. desembolsar e verificar instâncias, prazos e reconciliação sem cópia;
9. repetir o reconciliador e confirmar idempotência;
10. tentar postergação após upload antecipado e confirmar bloqueio;
11. testar concorrência de upload;
12. executar PERF9B/AAL2, Storage 9C e acessos cruzados com JWT real.

## 20. Riscos residuais

- a migration extensa precisa ser validada em transação no schema real antes de
  produção;
- RLS, grants, triggers e enumerações dependem do estado efetivo de homologação;
- concorrência e locks foram cobertos pelo contrato SQL, mas exigem teste
  integrado em PostgreSQL;
- o comportamento visual e a análise antecipada precisam de homologação manual
  nos dois temas e nos perfis cedente/gestor;
- scripts PERF9B/AAL2 e Storage 9C só produzem evidência válida após a migration;
- não existe feature flag independente para ocultar a seção; o rollback visual
  exigirá alteração aditiva de aplicação.

## 21. Rollback

O rollback deve ser aditivo:

1. ocultar/desabilitar o envio antecipado por correção de aplicação;
2. manter documentos, versões, análises, vínculos e memórias já gravados;
3. manter o fluxo pós-cessão existente;
4. manter o gate com default `false` ou publicar nova versão sem exigência;
5. nunca apagar evidências nem reclassificar operações aprovadas;
6. corrigir banco somente com nova migration, sem editar a migration aplicada.

## 22. Arquivos da implementação

- `supabase/migrations/20260806170000_envio_antecipado_documentos_logisticos.sql`;
- `src/lib/logistica/evidencias-logisticas.ts`;
- `src/lib/logistica/upload-antecipado.server.ts`;
- `src/lib/actions/documento-v2.ts`;
- `src/lib/actions/nota-fiscal.ts`;
- `src/lib/actions/politica.ts`;
- `src/lib/operacoes/politica.ts`;
- `src/lib/documentos-v2/storage.ts`;
- `src/components/documentos-v2/ChecklistCedente.tsx`;
- `src/components/politicas/PoliticasDoFundo.tsx`;
- `src/types/database.ts`;
- testes correspondentes do domínio, migration e snapshot.

## 23. Conclusão

A arquitetura preserva um requisito oficial único, permite antecipação sem
duplicação, separa classificação física de cumprimento documental e mantém a
memória necessária para decisões futuras. Ela está preparada para o gate
versionado e para CT-e compartilhado N:N. A prontidão para produção depende da
aplicação controlada da migration e da homologação integrada, especialmente de
RLS, concorrência, Storage e reconciliação.
