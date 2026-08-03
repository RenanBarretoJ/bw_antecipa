# Postergação única da previsão de upload do canhoto

## 1. Regra funcional

O cedente pode comunicar uma única nova previsão para o upload do canhoto/comprovante de entrega de uma NF já cedida. A comunicação é informativa, exige data e motivo, não depende de aprovação do gestor e não altera o prazo original, a cessão, o snapshot, o SLA jurídico ou o estado financeiro da operação.

A ação só existe quando o snapshot da operação exige canhoto obrigatório no pós-cessão, permite postergação, ainda possui uma janela válida, não tem postergação anterior e não existe qualquer upload histórico do canhoto. Uma versão rejeitada continua contando como primeiro upload e mantém o bloqueio definitivo.

## 2. Configuração da política

A versão da política recebeu:

- `permite_postergacao_upload_canhoto boolean NOT NULL DEFAULT false`;
- `limite_postergacao_upload_canhoto_dias integer NULL`, com constraint para aceitar apenas inteiro positivo quando preenchido.

Quando a permissão está ativa e o limite está nulo, o domínio e a RPC aplicam cinco dias corridos. A action de política rejeita a ativação quando não existe requisito obrigatório de `canhoto` ou `comprovante_entrega` no pós-cessão. A interface mantém os conceitos de prazo original e limite de postergação separados.

## 3. Cálculo das datas

O prazo original continua sendo `nota_fiscal_entregas.data_limite_canhoto`, criado pelo fluxo de desembolso a partir da cessão e do prazo congelado no snapshot. Este escopo não recalcula nem atualiza esse campo.

Para comunicar a nova previsão:

```text
limite aplicado = limite do snapshot, ou 5 quando nulo
data máxima = prazo original + limite aplicado
data mínima = maior entre CURRENT_DATE e prazo original + 1 dia
data mínima <= nova previsão <= data máxima
```

A data canônica da validação final é `CURRENT_DATE` no PostgreSQL. O frontend usa a data de referência gerada no servidor apenas para feedback antecipado; a RPC sempre repete todas as validações.

## 4. Modelagem

A tabela `nota_fiscal_entrega_postergacoes_canhoto` preserva:

- entrega, NF, operação, fundo, cedente e vínculo cedente-fundo;
- versão e hash do snapshot da política;
- prazo original e nova previsão em colunas distintas;
- motivo, limite aplicado, ator e momento da comunicação;
- indicador imutável de utilização.

Há constraints únicas por `nota_fiscal_id` e `nota_fiscal_entrega_id`, checks de data, motivo, limite e utilização, além de índices para consultas futuras por fundo/cedente e data da comunicação. Um trigger bloqueia `UPDATE` e `DELETE`.

## 5. Snapshot

`PoliticaSnapshot` passou a transportar permissão e limite. O hash da operação inclui os dois campos. A RPC lê exclusivamente `operacoes.politica_snapshot`; não consulta a política vigente para decidir uma operação antiga.

Snapshots históricos sem os novos campos continuam com o comportamento anterior: a permissão é considerada desabilitada. Não há backfill nem inferência retroativa.

## 6. Autorização

A Server Action valida o acesso à NF e restringe a ação ao perfil `cedente`. A RPC `SECURITY DEFINER`, com `search_path` vazio, repete autenticação, perfil, cedente da sessão, contexto da NF, vínculo ativo, fundo, entrega e operação.

A tabela concede somente `SELECT` ao papel `authenticated`:

- cedente: apenas registros do próprio cedente;
- gestor: apenas fundos autorizados por `private.usuario_tem_acesso_fundo`;
- consultor: apenas carteira autorizada por `private.consultor_tem_acesso_cedente`;
- sacado e anon: nenhum acesso novo.

A escrita ocorre exclusivamente pela RPC. `service_role` não é exposta ao cliente.

## 7. Fluxo do cedente

```text
Detalhe da NF pós-cessão
  → checklist compartilhado carrega entrega, snapshot e upload histórico
  → domínio calcula disponibilidade e intervalo
  → cedente informa data e motivo
  → tela apresenta revisão irreversível
  → Server Action valida sessão e chama a RPC
  → RPC grava postergação, eventos, auditoria e notificações
  → checklist é recarregado
```

A tela mostra prazo original, situação original, nova previsão, situação da nova previsão, motivo, comunicação e primeiro upload. O botão é ocultado quando a ação não é permitida.

## 8. Visualização do gestor

O mesmo componente do checklist é usado no modo gestor. Ele exibe os dois prazos em paralelo, o motivo, cedente comunicante, data/hora, limite congelado e primeiro upload. Não existe ação de aprovação ou rejeição da postergação. O evento também fica disponível na timeline operacional já alimentada por `eventos_dominio`.

## 9. Eventos

A RPC registra, na mesma transação:

- `eventos_entrega`: `canhoto_postergacao_comunicada`, sem mudar o status logístico;
- `eventos_dominio`: evento logístico visível a gestor e cedente;
- `logs_auditoria`: antes/depois estruturado, com contexto, ator, versão e hash do snapshot.

Os eventos preservam prazo original, nova previsão, motivo, limite, NF, entrega, operação, fundo, cedente, vínculo e a indicação de que não há aprovação do gestor. Os mecanismos append-only existentes permanecem ativos.

## 10. Notificações

Os gestores ativos são resolvidos por `usuario_fundos` no mesmo fundo da NF. A inserção é um único `INSERT ... SELECT`, sem N+1, com deduplicação por usuário e NF.

A mensagem contém cedente, NF, prazo original, nova previsão, motivo e momento da comunicação. `entidade_tipo`, `entidade_id` e `href` vinculam a notificação ao detalhe `/gestor/notas-fiscais/[id]`. O contrato de listagem aceita apenas rota relativa interna.

Nenhum e-mail foi implementado.

## 11. Compatibilidade

- O fluxo pré-cessão não foi alterado.
- O cálculo e o armazenamento do prazo original permanecem no fluxo logístico existente.
- O upload, reenvio, análise e rejeição do canhoto continuam usando o repositório documental atual.
- A rejeição não reabre a postergação porque a checagem usa existência histórica de `documento_versoes` e, por compatibilidade, também `canhotos`.
- Operações antigas não recebem a permissão por inferência.
- A inclusão de metadados de destino em `notificacoes` é opcional para notificações antigas.

## 12. Testes

Foram adicionados testes puros para exigência de canhoto, configuração desabilitada, limite explícito, padrão de cinco dias, limite inválido, dias corridos, comunicação antes/no/depois do prazo, datas mínima/máxima, janela expirada, segunda tentativa, primeiro upload, upload rejeitado e estados derivados dos dois prazos.

O teste de snapshot comprova que os campos integram o hash. O teste de contrato da migration cobre transação, prazo original imutável, unicidade, lock concorrente, snapshot, upload histórico, RLS, grants, evento, auditoria e notificação por fundo.

O clean-room de banco aplicou o bootstrap e as 74 migrations ativas em dois PostgreSQL locais descartáveis. Os dois ciclos concluíram 75/75 etapas, incluindo o bootstrap, e produziram dump e catálogo finais reproduzíveis. Nenhuma conexão remota foi utilizada.

Testes integrados com JWT real dependem da aplicação da migration em homologação e não foram executados contra o banco remoto nesta implementação.

## 13. Riscos

- A migration ainda precisa de revisão e aplicação controlada em homologação.
- RLS com dois fundos/dois cedentes e concorrência real precisam ser comprovados após a aplicação.
- Datas usam dias corridos e `CURRENT_DATE`; a timezone da sessão PostgreSQL deve permanecer coerente com a configuração operacional do ambiente.
- Registros append-only passam a referenciar a NF/entrega com `ON DELETE RESTRICT`; rotinas administrativas de reset que removam operações precisam considerar explicitamente a nova tabela.
- A listagem logística consolidada não recebeu um novo filtro específico neste recorte; os dados estão indexados e visíveis nos detalhes.

## 14. Preparação para e-mails

Sem criar cron ou tabela de lembretes, os índices por fundo/cedente e `postergacao_comunicada_em`, o prazo original da entrega, a nova previsão, os uploads históricos e as notificações estruturadas permitem consultar futuramente:

- prazo original próximo ou vencido;
- nova previsão próxima ou vencida;
- NF ainda sem canhoto;
- canhoto enviado, aprovado ou rejeitado;
- notificações/eventos já emitidos, para deduplicar lembretes.

Um futuro serviço de e-mail deverá usar esses dados como entrada e manter idempotência própria; não deve reescrever esta comunicação.

## 15. Migration

Arquivo: `supabase/migrations/20260731171219_postergacao_upload_canhoto.sql`.

A migration é incremental, transacional e contém pré-condições, colunas da política, proteção de versão publicada, tabela/constraints/índices, trigger append-only, RLS, grants, metadados opcionais de notificação, novo tipo de evento, RPC canônica e reload do schema cache.

Ela não foi aplicada automaticamente e não houve `migration repair` nem alteração do histórico remoto. O inventário local registra esta migration como `local_pending_review`.

## 16. Rollback

Antes de haver comunicações em produção, um rollback técnico exigiria remover a RPC, políticas, trigger, índices, tabela e colunas opcionais, além de restaurar a constraint de eventos e a função de proteção da versão anterior. Depois de existirem comunicações, apagar a tabela ou os eventos violaria a trilha auditável e não é um rollback aceitável.

Em produção, o rollback funcional recomendado é publicar nova versão de política com a permissão desabilitada. Uma eventual correção estrutural deve ser feita por nova migration incremental, preservando registros já comunicados.

## 17. Parecer

A arquitetura mantém uma única fonte de verdade para o prazo original, congela a regra por snapshot, garante uma comunicação por NF no banco, bloqueia concorrência e upload histórico, separa prazo original da nova previsão e notifica somente gestores autorizados ao fundo.

O código está preparado para homologação após validações locais completas. A aprovação para produção depende da aplicação controlada da migration e dos testes reais de RLS, concorrência e telas em homologação.
