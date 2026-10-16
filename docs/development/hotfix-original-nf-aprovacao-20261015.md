# Aprovação de NF com original canônico

Base: `efdcad8806f4998669d2c5cf28303b1c9f2774ce`.
Branch: `hotfix/nf-original-approval-card-20261015`.

## Causa e correção

O resumo documental usado na aprovação individual e em lote validava somente
`notas_fiscais.arquivo_url`. O intake fiscal pode armazenar o original em
`documentos-v2`, com esse campo legado vazio. O visualizador já resolvia o
original pelo journal fiscal; por isso abrir o PDF funcionava e aprovar falhava.

O resumo agora consulta os originais das NFs com reserva em uma chamada ao banco,
somente depois de carregar as notas pelo cliente autenticado e pela RLS.
A função nova `fiscal_intake_get_originals(uuid[])` reutiliza
`fiscal_intake_get_original(uuid)` e exige a existência do objeto em Storage.
Não escolhe versão posterior ou DANFE complementar. É `SECURITY INVOKER`,
`STABLE`, com `search_path` vazio e execução restrita a `service_role`.
Não gera URLs assinadas e não é acessível aos papéis `anon`/`authenticated`.

O helper server-only valida IDs retornados, buckets permitidos e extensão
PDF/XML. Reserva sem original válido continua bloqueada, mesmo havendo caminho
legado. Falha de infraestrutura interrompe a avaliação com mensagem genérica.
Notas sem reserva preservam a validação legada existente. Políticas, requisitos,
snapshots, autorização, MFA, logística e elegibilidade financeira não mudam.

O componente compartilhado de arquivos usa a largura disponível para distribuir
os cards. Uma lateral estreita mantém uma coluna; áreas largas podem exibir o
par XML/DANFE lado a lado. Os botões podem quebrar linha sem ultrapassar o card.

## Regressão reproduzível

Em PostgreSQL local descartável com schema vigente e fixture sintética
`supabase/tests/fixtures/guibor_a5_a6.sql` (ou equivalente nativo):

```text
NF_ORIGINAL_LOCAL_QA=true LOCAL_QA_PG_PASSWORD=<segredo local> node scripts/qa/notas-fiscais/original-approval-local.mjs
node node_modules/vitest/vitest.mjs run src/lib/notas-fiscais/originais-canonicos.server.test.ts src/lib/notas-fiscais/resumo-documental-gestor.server.test.ts
```

O runner aceita somente loopback/porta 57862 e executa rollback inclusive da
migration quando ainda não aplicada. Nunca usar banco compartilhado. As fixtures
de Storage são metadados sintéticos, sem arquivos fiscais reais. Esse ensaio
testa a resolução e os grants; não equivale a login/MFA nem aprovação produtiva.

Casos: PDF/XML, legado, campo legado vazio, ausência de objeto, reserva liberada,
geração antiga, intenção não retida, referência inválida, infraestrutura
indisponível, lote, IDs invisíveis pela RLS e equivalência com o visualizador.

Resultados locais (15/10/2026): 3.158 testes, sendo 3.146 aprovados, zero falhas e
12 ignorados; os ignorados não constituem aprovação. SQL nativo e grants
aprovados; TypeScript e build completo `next build --webpack` com Node.js 22
aprovados. Lint sem erros, com dois avisos preexistentes de variáveis não usadas.
O componente real com CSS compilado e metadados sintéticos passou em 12 casos
visuais, nos viewports 375/1024/1280 px e containers estreitos/largos, sem overflow.
Não houve aprovação autenticada de NF em Produção, push ou deploy nesta entrega.

## Publicação posterior à validação

1. Reconfirmar SHA produtivo, ausência de drift, backup e privilégios do executor.
2. Aplicar exclusivamente `20261015232041_fiscal_originals_approval_batch.sql`, em
   transação e com timeout de locks, registrando o ledger. Não reaplicar migrations.
3. Conferir grants e resultado da consulta para uma NF autorizada. A função nova
   não modifica registros, documentos, snapshots ou arquivos.
4. Publicar o código revisado, preservando configurações e automações existentes.
5. Conferir lista, original e aprovação pela sessão normal do Gestor com MFA.
   Aprovar somente quando houver decisão de negócio legítima; não aprovar NF
   produtiva apenas para testar.

Aplicar a migration antes do código: a versão nova depende da consulta em lote.
Interromper por drift, erro SQL, erro de build, ausência do original esperado ou
divergência de autorização. O código anterior ignora a função nova, permitindo
rollback da aplicação sem excluir arquivos nem alterar o estado das notas.
Esta entrega local não executa a publicação nem aprova notas em Produção.
