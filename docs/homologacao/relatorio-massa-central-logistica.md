# Relatório da massa de homologação — Central Logística

## Objetivo

Este documento registra a massa sintética criada em homologação para exercitar a Central de Acompanhamento Logístico do gestor. A carga cobre paginação, filtros, indicadores financeiros, status físico, cumprimento documental, memórias históricas, CT-e N:N, postergações, reconciliação e exportação CSV.

A massa não usa dados, documentos, credenciais ou objetos de Storage reais. Nenhuma migration ou regra de runtime foi alterada.

## Segurança e isolamento

- Ambiente aceito: somente `NEXT_PUBLIC_APP_ENV=homolog` ou `homologacao`.
- Ambiente recusado: `NODE_ENV=production`.
- Configuração carregada exclusivamente de `.env.homolog`.
- A referência esperada do projeto deve ser informada por `LOGISTICA_HOMOLOG_PROJECT_REF` ou `--expected-project-ref`.
- A referência da API, a referência da conexão PostgreSQL e a referência esperada precisam coincidir.
- Referências encontradas em `.env.producao` são bloqueadas.
- Não existe opção de bypass para produção.
- O modo padrão de seed e cleanup é dry-run.
- Mutações exigem frases de confirmação fechadas.
- UUIDs, chaves fiscais e entidades são determinísticos e pertencem ao namespace `CENTRAL_LOGISTICA_QA_V1`.
- O cleanup valida o ID, o nome e o CNPJ do fundo dedicado antes de remover registros pelo fundo; resíduos indiretos são removidos somente por IDs determinísticos exatos.

## Comandos

Defina `LOGISTICA_HOMOLOG_PROJECT_REF` no ambiente ou acrescente `--expected-project-ref <REF_HOMOLOG>` aos comandos.

```bash
npm run homolog:logistica:seed

npm run homolog:logistica:seed -- \
  --apply \
  --confirm SEED_CENTRAL_LOGISTICA_HOMOLOG

npm run homolog:logistica:verify

npm run homolog:logistica:cleanup

npm run homolog:logistica:cleanup -- \
  --apply \
  --confirm CLEANUP_CENTRAL_LOGISTICA_HOMOLOG
```

O cleanup com `--apply` não foi executado após a carga final. A massa permanece em homologação.

## Namespace e entidades

Fundo dedicado:

- `QA CENTRAL LOGISTICA FIDC`

Entidades principais:

| Entidade | Quantidade final |
|---|---:|
| Fundo | 1 |
| Cedentes | 3 |
| Sacados | 6 |
| Políticas | 2 |
| Versões publicadas | 2 |
| Requisitos pós-cessão | 4 |
| Notas fiscais | 60 |
| Operações | 18 |
| CT-es lógicos | 33 |
| CT-es compartilhados | 4 |
| Documentos lógicos | 78 |
| Versões documentais | 95 |
| Comprovantes/canhotos materializados | 26 |
| Postergações | 7 |
| Memórias logísticas | 96 |
| Objetos de Storage | 0 |

Os nomes seguem os prefixos `QA LOGISTICA CEDENTE` e `QA LOGISTICA SACADO`. Os e-mails Auth sintéticos usam domínio reservado `.invalid`.

## Acesso do gestor

Nenhum gestor foi vinculado automaticamente, pois `LOGISTICA_SEED_GESTOR_EMAIL` não estava definido. O script não escolhe usuário arbitrariamente.

Para disponibilizar o fundo a um gestor ativo de homologação, defina o e-mail e reaplique o seed. A reaplicação é idempotente e cria somente o vínculo ausente em `usuario_fundos`; MFA, senha, sessão e outros vínculos não são modificados.

## Políticas

Foram publicadas duas políticas no fundo sintético:

| Política | Gate pré-cessão | CT-e | Comprovante de entrega |
|---|---|---|---|
| QA Logística sem gate | Não exigido | Pós-cessão, obrigatório, D+10 | Pós-cessão, obrigatório, D+20 |
| QA Logística com gate | Exigido | Pós-cessão, obrigatório, D+10 | Pós-cessão, obrigatório, D+20 |

Dois cedentes usam a política sem gate e um usa a política com gate. Operações da política com gate somente avançaram quando possuíam evidência logística aprovada, através dos triggers reais.

## Distribuição logística e financeira

O status não foi gravado artificialmente para a Central. Ele foi calculado das evidências reais do domínio:

| Status atual | NFs | Valor bruto |
|---|---:|---:|
| Entregue | 20 | R$ 1.753.255,04 |
| Em trânsito | 20 | R$ 2.838.255,04 |
| Indeterminada | 20 | R$ 2.412.257,56 |
| **Total** | **60** | **R$ 7.003.767,64** |

Os valores unitários variam entre faixas como R$ 8.500, R$ 17.250, R$ 32.000, R$ 48.750, R$ 75.000, R$ 94.752,52, R$ 125.000, R$ 240.000 e R$ 480.000.

## Matriz de cenários

| Cenário | Cobertura |
|---|---|
| CT-e aprovado antes da cessão | Presente |
| Comprovante aprovado antes da cessão | Presente |
| CT-e e comprovante aprovados antecipadamente | Presente |
| CT-e aguardando análise | Presente |
| Comprovante aguardando análise | Presente |
| CT-e rejeitado | Presente |
| Comprovante rejeitado | Presente |
| CT-e somente pós-cessão | Presente |
| Comprovante somente pós-cessão | Presente |
| Evidência ausente | Presente |
| Versão aprovada antiga e substituição pendente | Presente |
| Primeira versão rejeitada e segunda aprovada | Presente |
| Primeira versão rejeitada e segunda pendente | Presente |
| NF sem operação | Presente |
| Gate habilitado sem aprovação incompatível | Validado |

Foram apurados 29 envios antecipados entre as 60 NFs, equivalentes a 48,3% da carteira sintética.

## Operações e memórias

As 18 operações estão distribuídas entre solicitada, aprovada, em andamento e liquidada. Há também duas NFs por cedente, seis no total, fora de operação para exercitar o estágio pré-cessão.

As memórias de criação e aprovação são geradas pelos triggers canônicos. A carga contém memórias de criação `ENTREGUE`, `EM_TRANSITO` e `INDETERMINADA`, além de evoluções posteriores do status físico. O verify rejeita:

- memória fora do fundo ou cedente da operação;
- versão de política diferente da congelada na operação;
- duplicidade por operação, NF e etapa;
- aprovação incompatível com gate habilitado.

## Evidências, análises e cumprimento documental

Foram criados documentos em análise, aprovados e rejeitados, inclusive com múltiplas versões. A versão atual pode aguardar análise enquanto uma versão antiga aprovada preserva o estado físico.

Resultados finais relevantes:

- aguardando análise: 35 evidências atuais;
- rejeitados: 15 evidências atuais;
- pendências obrigatórias vencidas: 11;
- comprovantes/canhotos materializados: 26.

Isso permite separar status físico de cumprimento documental: uma NF pode continuar entregue ou em trânsito e, simultaneamente, possuir substituição pendente ou requisito documental incompleto.

## CT-e compartilhado

Há quatro CT-es N:N:

- CT-e compartilhado com três NFs;
- CT-e compartilhado com cinco NFs;
- CT-e compartilhado pendente com quatro NFs;
- CT-e com versão rejeitada seguida de versão aprovada, vinculado a quatro NFs.

Cada compartilhamento permanece no mesmo fundo, cedente e vínculo. O verify encontrou zero relações cruzadas e o contrato estático do exportador confirma que ele reutiliza o loader sem paginação e não declara UUIDs internos no cabeçalho.

## Prazos e postergações

As datas são relativas à execução em `America/Sao_Paulo`, com cessões históricas e atuais, uploads antes, no mesmo dia e depois da cessão. Há prazos vencidos e futuros, documentos ausentes, aguardando análise e rejeitados.

Foram criadas sete postergações somente para NFs sem primeiro upload do comprovante. O hash da política usado pela postergação é o mesmo snapshot congelado na operação. O bloqueio contra postergação após evidência não foi contornado.

## Reconciliação

As evidências antecipadas foram reconciliadas com as instâncias oficiais pós-cessão pela função canônica. Uma amostra foi reconciliada novamente para validar repetição segura.

O verify confirmou:

- zero evidências duplicadas por NF, política e família;
- zero requisitos oficiais duplicados;
- zero cópias divergentes entre evidência e requisito;
- zero memórias duplicadas.

## Storage e manifest

A Central necessita dos metadados documentais, mas não de preview ou download para estes testes. Por isso, nenhum placeholder foi enviado ao Storage. Os paths documentais são sintéticos e não apontam para arquivos reais.

O manifest local fica fora do repositório, na área de dados locais do usuário, com permissões restritas quando suportadas pelo sistema operacional. Ele contém versão, projeto, IDs determinísticos e contagens, sem tokens ou credenciais. O cleanup não depende do manifest para reconstruir os IDs.

## Idempotência e verify

Sequência executada:

1. dry-run do seed: aprovado;
2. seed real: aprovado;
3. verify: aprovado;
4. segunda execução do seed: aprovada;
5. segundo verify: aprovado, com as mesmas contagens e valores;
6. cleanup em dry-run: aprovado;
7. cleanup final não executado.

O segundo seed consulta previamente registros protegidos por triggers de imutabilidade e insere apenas os itens ausentes. Isso evita depender de `ON CONFLICT` em tabelas cujos triggers rodam antes da resolução do conflito.

O cleanup em dry-run encontrou 348 registros com `fundo_id` no escopo sintético e, por IDs determinísticos exatos, 78 documentos, 95 versões documentais, 54 vínculos operação × NF e 67 análises. Nenhum objeto de Storage foi encontrado ou removido.

## Resultado esperado na Central

Cards e views rápidas devem refletir:

- 60 NFs acompanhadas;
- 20 entregues;
- 20 em trânsito;
- 20 indeterminadas;
- 11 pendências vencidas;
- 35 evidências aguardando análise;
- 15 evidências rejeitadas;
- 29 NFs com envio antecipado;
- quatro CT-es compartilhados;
- resultados não vazios em Atenção imediata, Aguardando gestor, Envio antecipado, Entregues na criação, Em trânsito na criação e Indeterminadas.

## Roteiro de smoke visual

1. Vincular um gestor com `LOGISTICA_SEED_GESTOR_EMAIL`, se necessário, reaplicando o seed.
2. Selecionar `QA CENTRAL LOGISTICA FIDC` em Fundo ativo.
3. Abrir a Central Logística e validar Visão Geral, NFs, Pendências e CT-es.
4. Testar páginas 1 e 2 e tamanhos de 20, 50 e 100 itens.
5. Filtrar pelos três cedentes, seis sacados, operação, status físico, status documental e momento pré/pós-cessão.
6. Abrir as NFs `QA000001` (entregue), `QA000006` (em trânsito) e `QA000012` (indeterminada).
7. Conferir os CT-es compartilhados nas NFs 6–8, 25–29, 12–15 e 21–24.
8. Validar memórias de criação e aprovação, substituições documentais e postergações.
9. Exportar CSV com e sem filtros e conferir ausência de UUIDs e duplicação por CT-e N:N.

## Riscos e observações

- Homologação possui uma inconsistência anterior a esta massa: `public.avaliar_conclusao_entrega()` pode registrar o evento `entrega_em_validacao`, mas o CHECK atual de `eventos_entrega.tipo_evento` não inclui esse valor. A massa foi adaptada para iniciar entregas com evidência aprovada em `aguardando_validacao`, sem alterar migration, função ou domínio. Recomenda-se tratar a incompatibilidade em escopo próprio.
- Nenhum gestor foi vinculado porque não foi fornecido e-mail. A massa existe, mas o smoke visual exige o vínculo explícito.
- Não existem arquivos físicos para testar preview/download; esse comportamento está fora do objetivo da Central e evitou Storage desnecessário.
- O cleanup usa `session_replication_role=replica` apenas na sua transação e somente após validar o fundo dedicado, para remover trilhas append-only sintéticas por IDs exatos. Não deve ser reutilizado para dados reais.

## Parecer

A massa atende aos critérios de volume, diversidade, isolamento, status derivado, CT-e N:N, histórico, postergação, reconciliação, idempotência e remoção controlada. O banco de homologação permanece populado para smoke manual. O único risco funcional identificado é a incompatibilidade preexistente do tipo `entrega_em_validacao`, que não foi alterada por respeitar o escopo.
