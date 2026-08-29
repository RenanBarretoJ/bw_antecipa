# Correção do gate documental com zero requisitos pré-cessão

## 1. Causa-raiz

O gate de aprovação consultava somente `documento_requisito_instancias`. Quando
essa consulta retornava vazia, o domínio não sabia se a política realmente não
possuía requisitos ou se os requisitos esperados não haviam sido materializados.
O caso vazio era então convertido na pendência sintética `Checklist documental`,
que não correspondia a nenhum registro de política, requisito ou documento.

## 2. Regra anterior

```text
instâncias vazias
  -> pendência sintética
  -> aprovação bloqueada
```

A origem da política, os requisitos esperados e o arquivo original da NF não
participavam integralmente dessa decisão.

## 3. Regra nova

```text
contexto autorizado da NF
  -> política e versão aplicáveis
  -> requisitos pré-cessão esperados
  -> instâncias da mesma versão
  -> situação dos obrigatórios/bloqueantes
  -> arquivo original PDF ou XML
  -> decisão canônica
```

A função pura `avaliarElegibilidadeDocumentalDaNota` retorna um dos estados:
`nao_aplicavel`, `completo`, `pendente`, `nao_instanciado`,
`configuracao_invalida` ou `arquivo_original_ausente`.

## 4. Fonte da política

Antes de uma operação, a fonte é a atribuição ativa do vínculo
`cedente_fundo`, validada contra o fundo da NF, seguida da versão publicada e
vigente da política. Não existe fallback global.

Quando a NF já está vinculada a uma operação, a fonte passa a ser a versão
congelada nessa operação. O loader valida a coerência entre NF, vínculo, fundo,
política, versão, snapshot e hash. Uma operação não visível ou um snapshot
inconsistente falha fechado; a política publicada atual não substitui o contexto
histórico.

Todas as consultas usam o cliente autenticado recebido pela action e, portanto,
continuam submetidas à RLS. Não foi introduzido `service_role` nesse gate.

## 5. Política com zero requisitos

Uma coleção esperada vazia só é considerada legítima depois que a política e sua
versão foram resolvidas. Com arquivo original válido, o estado é
`nao_aplicavel`, o gate é satisfeito e nenhuma pendência documental é criada.

Esse comportamento é orientado exclusivamente pelos dados da política e funciona
para qualquer fundo ou cedente.

## 6. Materialização

Para cada requisito pré-cessão obrigatório ou bloqueante, o domínio procura uma
instância da mesma NF e da mesma versão de política. Requisito esperado sem
instância produz `nao_instanciado`, bloqueia a aprovação e apresenta o nome real
do requisito. A aprovação não tenta criar instâncias nem esconder falhas de
preparação.

Requisitos opcionais não bloqueantes, pós-cessão, de outra versão ou externos ao
snapshot aplicável não bloqueiam a NF.

## 7. Arquivo original PDF/XML

O campo `notas_fiscais.arquivo_url` é carregado junto com a NF. A extensão é
validada como PDF ou XML, de forma alternativa: qualquer um dos formatos
satisfaz o gate. A ausência ou formato diferente gera
`arquivo_original_ausente`.

Não há download do objeto, geração de URL assinada ou consulta ao Storage por NF.
O vínculo com a NF é preservado porque o caminho é lido diretamente do registro
autorizado da própria nota.

## 8. Aprovação individual

`aprovarNF()` mantém autenticação, MFA, validação do fundo ativo, autorização,
status, update, auditoria e notificação existentes. Antes do update, a action
carrega o resumo documental e aplica o gate canônico. Política resolvida com zero
requisitos e PDF/XML válido prossegue sem mensagem documental.

## 9. Aprovação em lote

`aprovarNFsLote()` utiliza o mesmo loader e a mesma função de elegibilidade da
aprovação individual. Cada NF recebe seu resultado e código de bloqueio. A
atomicidade existente do lote foi preservada: nenhuma NF é atualizada quando
qualquer item do lote falha.

## 10. Aprovação da operação

O gate da operação não foi refatorado. Sua regra já considerava uma coleção
congelada vazia como elegível. Foi adicionada regressão explícita para operação
com snapshot sem requisitos, preservando os testes existentes de snapshot e
política.

## 11. Aceite do sacado

O aceite não foi incorporado ao gate pré-operacional da NF. Ele continua sendo
avaliado separadamente na operação, segundo o snapshot aplicável. Assim, uma NF
pode ser aprovada documentalmente sem antecipar a decisão de aceite.

## 12. Isolamento multifundo

O loader cruza `fundo_id`, `cedente_fundo_id`, atribuição, política e versão.
Instâncias só participam quando pertencem à NF e à versão resolvida. O contexto
de operação também precisa coincidir com o fundo e vínculo da NF. IDs adulterados
continuam sendo rejeitados pela autorização anterior ao gate e pela RLS.

## 13. Performance

O carregamento permanece agregado. As consultas trabalham com conjuntos de IDs
e os resultados são indexados em mapas por vínculo, política, versão, NF,
documento e requisito. Não existe `SELECT`, acesso ao Storage ou download dentro
do laço de NFs. A quantidade de consultas é constante em relação ao tamanho do
lote, variando apenas conforme existam conjuntos a hidratar.

O payload limita-se a contexto, requisitos, instâncias, versão documental atual
e última análise necessária ao gate; conteúdo e histórico documental completo
não são carregados.

## 14. Testes

Foram cobertos:

- política resolvida sem requisitos;
- política não resolvida;
- requisito obrigatório não materializado;
- pendente, rejeitado e aprovado;
- opcional não bloqueante;
- requisito pós-cessão;
- PDF, XML, arquivo ausente e formato inválido;
- isolamento por versão;
- ausência da string sintética no resultado;
- equivalência entre aprovação individual e lote;
- operação com zero requisitos congelados.

Validações executadas:

- testes focados: 47 testes em 6 arquivos, todos aprovados;
- suíte completa: 566 testes em 78 arquivos, todos aprovados;
- `npx tsc --noEmit`: aprovado;
- `npm run lint`: aprovado sem erros, com 6 avisos preexistentes fora do escopo;
- `git diff --check`: aprovado;
- `npx next build --webpack`: aprovado, mantendo os avisos preexistentes do
  Handlebars sobre `require.extensions`;
- varredura de segredos nos arquivos alterados e novos: nenhum padrão sensível
  encontrado.

O smoke autenticado em homologação não foi executado nesta entrega porque não
havia sessão MFA de navegador nem uma NF de teste explicitamente autorizada para
mutação. A suíte automatizada e o build não substituem esse passo operacional.

## 15. Matriz de regressão

| Contexto orientado pela política | Resultado |
| --- | --- |
| Zero requisitos + PDF | aprova documentalmente |
| Zero requisitos + XML | aprova documentalmente |
| Zero requisitos + nenhum arquivo | bloqueia pelo arquivo original |
| Política não resolvida | bloqueia por configuração |
| Obrigatório sem instância | bloqueia por materialização |
| Obrigatório pendente ou rejeitado | bloqueia pelo requisito real |
| Todos os bloqueantes aprovados | completa o gate |
| Opcional não bloqueante ausente | não bloqueia |
| Apenas requisitos pós-cessão | não aplicável ao gate pré-cessão |
| NF vinculada a operação | usa versão/snapshot histórico |

Os nomes de fundos usados em homologação não aparecem na implementação.

## 16. Arquivos alterados

- `src/lib/notas-fiscais/avaliacao-checklist-aprovacao.ts`: contrato e decisão
  canônica.
- `src/lib/notas-fiscais/resumo-documental-gestor.server.ts`: resolução e
  hidratação agregada da política, requisitos, instâncias e arquivo.
- `src/lib/notas-fiscais/elegibilidade-aprovacao.ts`: mensagens e códigos de
  bloqueio por estado real.
- `src/lib/actions/nota-fiscal.ts`: aplicação uniforme na aprovação individual e
  em lote.
- testes unitários e de regressão dos módulos acima e da operação.

## 17. Banco de dados

Nenhuma migration, tabela, função, trigger, policy, grant, RPC ou configuração de
Storage foi alterada. A correção usa os dados e controles existentes.

## 18. Riscos residuais

- registros históricos cujo snapshot esteja ausente ou inconsistente serão
  bloqueados como erro de configuração, de forma intencional;
- `arquivo_url` comprova a associação persistida e o formato do arquivo, mas o
  gate não consulta a existência física do objeto para evitar N+1 no Storage;
- a validação ponta a ponta em homologação depende de sessão MFA válida e massa
  representativa para cada cenário.

## 19. Rollback

O rollback é exclusivamente de código: restaurar o loader, o avaliador e as
actions alteradas. Não existe rollback de banco. Retornar ao comportamento
anterior reintroduziria o bloqueio incorreto para políticas sem requisitos.

## 20. Parecer

A correção separa ausência legítima de requisitos, falha de materialização,
configuração inválida e arquivo original ausente. O gate fica determinístico,
multifundo, histórico e reutilizado pelos fluxos individual e em lote, sem
exceções por fundo e sem alterar regras de operação ou aceite.
