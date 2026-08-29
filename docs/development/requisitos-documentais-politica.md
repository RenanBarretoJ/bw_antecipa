# Requisitos documentais da política

## Fonte de verdade

Novas versões de política usam dois campos canônicos:

- `momento_obrigatorio`: define o momento operacional do requisito;
- `obrigatorio`: define se o requisito bloqueia o avanço do fluxo.

Os campos persistidos `escopo`, `categoria` e `bloqueia_fluxo` continuam
existindo para manter leitores, versões e snapshots compatíveis. Eles não fazem
parte do contrato público de criação e são derivados no servidor:

```text
momento_obrigatorio -> escopo
momento_obrigatorio -> categoria
obrigatorio         -> bloqueia_fluxo
```

Momentos aceitos:

```text
nf_pre_cessao
operacao
pos_cessao
entrega
```

A regra fica centralizada em
`src/lib/politicas/requisitos-documentais.ts`. Componentes e Server Actions não
devem recriar esse mapeamento.

## Compatibilidade

Versões publicadas, requisitos históricos e snapshots não são atualizados. Ao
copiar uma versão antiga, a leitura prioriza `momento_obrigatorio`, usa
`escopo`/`categoria` apenas como compatibilidade e cria o novo rascunho com a
combinação canônica derivada.

Payloads novos que tentem enviar `escopo`, `categoria`, `bloqueia_fluxo` ou
`bloqueiaFluxo` são rejeitados no servidor. Isso evita que uma chamada direta à
Server Action contorne a simplificação da interface.

## Diagnóstico antes da migration

Execute a consulta abaixo no ambiente de destino antes de aplicar
`20260729180000_simplificar_requisitos_documentais_politica.sql`:

```sql
SELECT
  count(*) AS total_requisitos,
  count(*) FILTER (
    WHERE momento_obrigatorio IS NULL
  ) AS momento_nulo,
  count(*) FILTER (
    WHERE momento_obrigatorio IS NOT NULL
      AND momento_obrigatorio NOT IN (
        'nf_pre_cessao',
        'operacao',
        'pos_cessao',
        'entrega'
      )
  ) AS momento_desconhecido,
  count(*) FILTER (
    WHERE escopo IS DISTINCT FROM momento_obrigatorio
  ) AS escopo_divergente,
  count(*) FILTER (
    WHERE categoria IS DISTINCT FROM momento_obrigatorio
  ) AS categoria_divergente,
  count(*) FILTER (
    WHERE bloqueia_fluxo IS DISTINCT FROM obrigatorio
  ) AS bloqueio_divergente
FROM public.politica_requisitos_documentais;
```

Resultado observado em homologação em 29/07/2026:

```text
total_requisitos: 5
momento_nulo: 0
momento_desconhecido: 0
escopo_divergente: 0
categoria_divergente: 0
bloqueio_divergente: 0
```

A migration não faz backfill. Se encontrar divergência, ela interrompe a
aplicação antes das constraints. O registro legado deve ser analisado sem
alterar versão publicada ou snapshot retroativamente.

O `supabase db push --dry-run` de 29/07/2026 indicou que o histórico remoto de
migrations não reflete os arquivos já aplicados manualmente em homologação.
Portanto, não use um `db push` amplo neste ambiente: aplique somente a migration
nova pelo processo controlado do projeto e registre a reconciliação do histórico
se o time decidir adotar o CLI como fonte de aplicação.

## Remoção futura dos campos legados

`escopo`, `categoria` e `bloqueia_fluxo` só poderão ser removidos depois que:

1. todos os leitores usarem `momento_obrigatorio` e `obrigatorio`;
2. snapshots antigos continuarem legíveis sem depender dessas colunas;
3. RPCs, relatórios e integrações forem inventariados;
4. todos os ambientes estiverem sem divergências;
5. uma migration específica de remoção for homologada.
