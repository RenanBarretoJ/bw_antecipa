# Relatório — acompanhamento logístico por NF na operação

## 1. Regra de exibição

O painel pertence exclusivamente ao detalhe da operação do gestor. Sua exibição é decidida no servidor a partir do `politica_snapshot` congelado na operação.

- Sem acompanhamento ou requisito logístico aplicável no snapshot: o componente retorna `null`, sem reservar espaço e sem apresentar “Não aplicável”.
- Com logística aplicável antes do desembolso: apresenta somente o estado compacto “Aguardando desembolso” e a quantidade de NFs alcançadas.
- Com logística aplicável depois do desembolso: apresenta resumo agregado e linhas compactas por NF.
- Quando a entrega técnica ainda não foi materializada após o desembolso: a NF permanece visível como “Acompanhamento sendo preparado”, sem ser classificada como concluída.

## 2. Política e snapshot

A fonte de aplicabilidade é `operacoes.politica_snapshot`, normalizada pelo domínio já existente em `src/lib/operacoes/politica-operacao.ts`. A implementação não consulta a versão atualmente publicada da política e, portanto, não altera retroativamente operações antigas.

Os requisitos materializados em `documento_requisito_instancias` complementam o snapshot com o estado documental de cada entrega. Depois da materialização, a aplicabilidade é recalculada por NF a partir dessas instâncias: uma categoria exigida por uma nota não transforma a mesma categoria em pendência para as demais. Registros dispensados ou cancelados não são tratados como pendência. Snapshots antigos sem campos logísticos reconhecidos não ativam o painel por inferência.

## 3. Resumo

Depois do desembolso, o painel calcula:

- total de NFs acompanhadas;
- NFs concluídas;
- NFs em análise;
- NFs pendentes;
- NFs em atenção;
- percentual de conclusão.

O progresso é calculado por `NFs concluídas / total de NFs acompanhadas`. Documento apenas enviado não conclui a NF; todo requisito obrigatório aplicável precisa estar aprovado e a entrega precisa estar concluída.

## 4. Status da operação

O status agregado não é persistido. Ele é derivado em tempo de leitura nesta prioridade:

1. `Atenção`: rejeição, prazo original vencido, nova previsão vencida, vencimento hoje ou prazo próximo.
2. `Em andamento`: existe alguma NF não concluída sem criticidade.
3. `Concluído`: todas as NFs acompanhadas estão concluídas.

## 5. Status por NF

Cada linha contém apenas NF, categorias documentais aplicáveis, situação consolidada, prazo relevante e ação “Ver NF”. Não são carregados nem repetidos cedente, CNPJ, valores, taxas ou dados financeiros.

Prioridade consolidada:

1. documento rejeitado;
2. prazo ou nova previsão vencida;
3. vence hoje;
4. prazo próximo;
5. aguardando upload;
6. em análise;
7. em andamento;
8. concluída.

Requisitos opcionais ausentes e categorias não exigidas não bloqueiam conclusão nem reduzem o progresso. Quando nenhuma NF usa uma categoria, a respectiva coluna é omitida.

## 6. Criticidade e postergação

Prazos são comparados por dia civil em UTC, evitando variação por horário. A criticidade pode ser `sem prazo`, `normal`, `próximo`, `vence hoje` ou `vencido`.

No comprovante de entrega, o prazo original e a nova previsão permanecem separados. A nova previsão passa a ser o prazo operacional exibido, mas o vencimento do prazo original continua preservado e mantém a NF em atenção enquanto o documento obrigatório não for aprovado.

## 7. Progresso, ordenação e desempate

O resumo e a ordenação são funções puras. As linhas são ordenadas por criticidade, depois por:

1. prazo logístico mais próximo;
2. vencimento financeiro da NF;
3. número da NF;
4. ID da NF como desempate determinístico final.

## 8. Paginação, filtros e navegação

- Estado inicial: no máximo 5 linhas.
- Acima de 5 NFs: ação “Ver todas”.
- Estado expandido: paginação de 10 itens, filtros e busca por número da NF.
- Filtros: todas, atenção, pendentes, em análise e concluídas.
- O navegador envia os filtros por query string; a filtragem, ordenação e recorte acontecem no servidor.
- O Client Component da tela recebe apenas a página compacta, nunca a coleção completa.
- “Ver NF” preserva a URL da operação em `returnTo`, inclusive o estado atual do painel.

## 9. Arquitetura e performance

Antes, o detalhe era integralmente Client Component e buscava `nota_fiscal_entregas` com relacionamentos profundos de canhotos, eventos e CT-es. O card logístico era estático e recebia mais dados do que precisava.

Depois:

```text
Detalhe da operação (Server Component)
  -> loader logístico autorizado
    -> operação + snapshot
    -> NFs da operação
    -> entregas em lote
    -> requisitos em lote
    -> postergações em lote
    -> status documental em lote
  -> domínio puro (status, criticidade, resumo, ordenação e paginação)
  -> contrato compacto da página solicitada
  -> painel logístico
```

Não existe consulta dentro do laço de NFs. O loader não acessa Storage, URLs assinadas, XML, PDF, hashes, versões completas, análises integrais ou histórico de eventos. A coleção compacta é consolidada no servidor para calcular os indicadores; somente o recorte de 5 ou 10 linhas é serializado para a interface.

## 10. Autorização

O loader exige usuário gestor e valida, no servidor:

- fundo ativo autorizado;
- vínculo `cedente_fundos` da operação com o fundo ativo;
- registro ativo em `usuario_fundos` para o usuário e fundo;
- operação e NFs consultadas dentro desse contexto.

O cookie de fundo ativo define contexto, mas não concede autorização. Não foi usado `service_role`, e nenhuma permissão foi criada para cedente, consultor ou usuário anônimo.

## 11. Testes

Foram adicionados testes de domínio e de arquitetura para:

- painel ausente sem logística;
- estados oculto, pré-desembolso e pronto;
- categorias aplicáveis e não exigidas;
- requisito opcional ausente;
- conclusão somente com aprovação;
- rejeição e criticidade de prazo;
- prazo original e nova previsão;
- entrega ainda sendo preparada;
- resumo com nenhuma, algumas e todas as NFs concluídas;
- prioridade e ordenação determinística;
- filtros e busca;
- limite inicial de 5 e páginas de 10;
- autorização explícita por vínculo e `usuario_fundos`;
- ausência de N+1 e de payloads documentais pesados;
- composição como Server Component.

## 12. Regressões preservadas

Não foram alteradas regras de CT-e, comprovante de entrega, postergação, upload, aprovação/rejeição, desembolso, liquidação, timeline, Storage, RLS ou documentos assinados. O card “Andamento da operação” continua recebendo o resumo compacto de entregas já utilizado pela tela.

## 13. Riscos e limitações

- O painel reconhece atualmente as categorias logísticas já suportadas pelo domínio: CT-e/DACTE e comprovante de entrega/canhoto. Uma nova categoria exige inclusão no catálogo central de códigos.
- O resumo precisa avaliar no servidor a coleção compacta da operação para calcular progresso e criticidade globais; o navegador recebe somente o recorte paginado.
- Smoke autenticado depende de massa com operações representativas e credencial de gestor no ambiente de homologação.
- Não houve alteração de schema, migration, trigger, RLS ou RPC.

## 14. Parecer

A implementação atende ao uso operacional de operações com uma ou muitas NFs sem transformar cada nota em um card completo. Aplicabilidade histórica, autorização por fundo, criticidade, conclusão e ordenação estão centralizadas e testáveis. O painel reduz o payload anterior e mantém a interface inicial limitada a cinco linhas, com expansão paginada no próprio card.
