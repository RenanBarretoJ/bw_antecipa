# Multi-CNPJ do Cedente — modelo de dados

## Conceitos

- `cedentes`: relacionamento comercial/grupo econômico atendido pela plataforma. O campo legado `cedentes.cnpj` permanece como espelho do CNPJ da matriz.
- `cedente_estabelecimentos`: pessoa jurídica operacional identificada por CNPJ. Cada registro é `matriz` ou `filial`.
- `cedente_estabelecimento_contas_bancarias`: contas cadastradas no contexto do estabelecimento; somente uma conta principal ativa por estabelecimento. O titular real é explícito em `titular_estabelecimento_id` e deve pertencer ao mesmo Cedente, permitindo que uma Filial utilize conta própria ou a conta da Matriz sem inferência.
- `cedente_estabelecimento_requisitos`: checklist cadastral configurável por estabelecimento e baseado em `documento_tipos`.
- `notas_fiscais.estabelecimento_id`: origem jurídica da NF, derivada no servidor pelo CNPJ do emitente.
- `documento_vinculos.estabelecimento_id`: vínculo de documentos cadastrais ao estabelecimento sem criar um segundo repositório.

## Invariantes

1. O CNPJ normalizado possui 14 dígitos, DV válido e unicidade global.
2. Existe no máximo uma matriz por Cedente; o backfill e o trigger de criação garantem sua existência no fluxo normal.
3. Toda filial referencia a matriz do mesmo Cedente.
4. Uma NF nova só é aceita quando estabelecimento, matriz, Cedente, vínculo `cedente_fundos` e Fundo estão ativos e vigentes.
5. O estabelecimento da NF não é confiado ao frontend: o trigger o deriva de `cnpj_emitente`.
6. Suspender a matriz interrompe novas originações de todas as filiais, sem apagar histórico.
7. A filial herda os vínculos com fundos do Cedente; não existe vínculo filial-fundo paralelo.

## Compatibilidade

O backfill cria a matriz a partir de cada Cedente válido, replica a conta bancária legada como principal e associa NFs históricas cujo emitente coincide. Os campos legados continuam disponíveis; novos fluxos usam a tabela canônica de estabelecimentos.

## Decisão adiada

`FUTURE_DECISION_RULE_1` é o ponto único para decidir futuramente se uma operação pode conter NFs de estabelecimentos diferentes do mesmo Cedente. Nesta entrega a composição é identificada, mas não é permitida nem proibida por uma regra nova.
