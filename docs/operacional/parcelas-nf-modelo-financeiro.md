# Modelo financeiro de Parcelas de NF (Fase 1 + modelo de seleção da Fase 2)

## Diagnóstico

- **Parser XML** (`src/lib/nf-parser.ts:106-112`, antes desta entrega): já extraía blocos `<dup>`, mas só aproveitava `dVenc` da **última** duplicata como `data_vencimento` agregado da NF — `nDup` e `vDup` de todas as parcelas eram descartados. Não havia array de parcelas em `NfParsedData`.
- **`notas_fiscais`**: um único `valor_bruto`/`data_vencimento` por linha, nunca alterado para múltiplos vencimentos em nenhuma migration.
- **Achado importante — módulo `duplicatas` (P2.0)** (`supabase/migrations/20260811120000_p2_0_duplicata_ativo_financeiro.sql`): já existe uma tabela com forma parecida (`parcela`, `data_vencimento`, `valor_nominal` por linha). **Não é reaproveitável para este ticket**: é alimentada por upload manual de PDF + OCR de uma "Duplicata Mercantil", só ativa quando a política usa `tipo_ativo_financeiro='DUPLICATA_MERCANTIL'` (modo alternativo — o padrão é `'NOTA_FISCAL'`), e **sem nenhum vínculo** com `documento_vinculos`, precificação, CNAB, liquidação, conciliação ou exposição (o próprio relatório do P2.0 diz isso explicitamente, seção "Preparação para estoque futuro"). Conflar os dois conceitos misturaria "parcela extraída automaticamente do XML" com "duplicata mercantil validada manualmente por OCR" — são coisas diferentes. Por isso foi criada a entidade canônica nova pedida no ticket, sem tocar em `duplicatas`.
- **Catálogo de boleto**: `'boleto'` já era aceito na `CHECK` de `politica_requisitos_documentais.tipo_documento_codigo` desde `20260722183107`, mas **nunca existiu linha em `documento_tipos`** — causa raiz confirmada de "Tipo ainda não catalogado para upload nesta fase" (`ChecklistCedente.tsx:323`).
- **`documento_requisito_instancias`**: `UNIQUE (politica_requisito_id, nota_fiscal_id)` — estritamente 1 requisito por NF, sem nenhuma dimensão de parcela em toda a cadeia (`documento_vinculos` também não tem).
- **Achado crítico durante a implementação**: a versão de `instanciar_requisitos_nota` mais recente antes desta entrega (`20260727212953_corrigir_documento_tipo_requisitos_nf.sql`) é **muito mais evoluída** do que a versão original de `20260721132903` — usa `cedente_fundo_politicas` (atribuição ativa de política por cedente-fundo), exige `politica_operacional_versoes.publicada_em IS NOT NULL`, já resolve `documento_tipo_id` por código (`dt.codigo = r.tipo_documento_codigo`), e chama `reconciliar_documentos_base_nf`. A primeira versão desta migration foi escrita por engano sobre a versão **antiga** (de `20260721132903`), o que quebrou a função em produção-homolog ao ser aplicada (confirmado ao vivo: `column po.cedente_fundo_id does not exist` e `politicas_operacionais` já desacoplada de `cedente_fundo_id` desde `20260727202747`). Corrigido reaplicando o fan-out por parcela **sobre a versão atual real**, preservando 100% da lógica existente.

## Entidade canônica: `nota_fiscal_parcelas`

```sql
CREATE TABLE public.nota_fiscal_parcelas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  numero_parcela integer NOT NULL,
  valor_nominal numeric(15,2) NOT NULL,
  data_vencimento date NOT NULL,
  origem text NOT NULL DEFAULT 'xml_nfe',       -- 'xml_nfe' | 'manual'
  status text NOT NULL DEFAULT 'disponivel',    -- 'disponivel' | 'em_operacao' | 'liquidada' | 'cancelada'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nota_fiscal_parcelas_unique UNIQUE (nota_fiscal_id, numero_parcela),
  CONSTRAINT nota_fiscal_parcelas_valor_check CHECK (valor_nominal > 0)
);
```

`status` já inclui os valores que a Fase 2 (seleção/operação) vai precisar (`em_operacao`, `liquidada`), mas nesta fase nenhuma transição além de `disponivel` é acionada — a coluna existe para não exigir uma migration estrutural nova na Fase 2.

## RPC `registrar_parcelas_nota_fiscal`

Insere todas as parcelas em lote e valida a soma contra `notas_fiscais.valor_bruto` com **tolerância monetária segura**: `greatest(quantidade_de_parcelas * 0,01; 0,01)` — absorve arredondamento de centavos por parcela sem aceitar divergências reais. Idempotente por NF: uma segunda chamada é rejeitada (`Nota fiscal ja possui parcelas registradas`) em vez de duplicar ou sobrescrever.

Checagem de acesso: Cedente só na própria NF; Gestor só com vínculo ativo ao fundo da NF (`private.gestor_tem_acesso_cedente`) — mesmo padrão multifundo já usado em toda a superfície de Documentos/Estabelecimentos desta sessão.

## Parser XML (`src/lib/nf-parser.ts`)

`parseNFeXML` agora retorna `parcelas: NfParsedParcela[]`, uma entrada por `<dup>` encontrada, com `numero_parcela` (de `nDup`, ou a posição sequencial se `nDup` não for numérico), `data_vencimento` (`dVenc`) e `valor_nominal` (`vDup`). O campo agregado `data_vencimento` da NF **continua** vindo da última `<dup>` — comportamento legado preservado byte a byte, conforme exigido.

**NF sem `<dup>`**: `parcelas` fica vazio; nenhuma linha é criada em `nota_fiscal_parcelas`; a NF segue o fluxo de vencimento único de sempre. Nenhuma regra nova foi inventada para esse caso.

Wiring em `src/lib/actions/nota-fiscal.ts` (upload de XML): após inserir a NF, se `parsed.parcelas.length > 0`, chama a RPC. **Se a validação de tolerância falhar** (XML com duplicatas inconsistentes com o total), a NF inteira é revertida (mesmo helper `removerNotaFiscalParcial` já usado para falha de registro documental) — decisão deliberada: aceitar uma NF com parcelas inconsistentes corromperia silenciosamente a precificação da Fase 2, então o upload é rejeitado com mensagem clara em vez de degradar para o modo legado silenciosamente.

## Boleto por parcela

Ver detalhamento completo em [`estabelecimentos-workflow-documental.json`](estabelecimentos-workflow-documental.json)-*style* — desta vez em [`parcelas-nf-e2e.json`](parcelas-nf-e2e.json). Resumo:

- `documento_tipos` ganha uma coluna genérica `cardinalidade` (`'por_nf'` default | `'por_parcela'`) — não hardcoded para "boleto", reutilizável para qualquer tipo futuro.
- Linha real `codigo='boleto'`, `dominio='nf'`, `cardinalidade='por_parcela'` — fecha o bug relatado.
- `instanciar_requisitos_nota`: quando o tipo resolvido é `por_parcela`, instancia **1 requisito por parcela existente da NF** (não 1 único para a NF inteira). NF sem parcelas não recebe requisito por-parcela (nada para ancorar).
- `documento_requisito_instancias` ganha `parcela_id` (nullable, `NULL` para requisitos por-NF) e a chave única passa a ser `(politica_requisito_id, nota_fiscal_id, parcela_id)` com `NULLS NOT DISTINCT` — preserva a garantia "1 requisito por NF" para tipos por-NF, e permite N requisitos distintos (um por parcela) para tipos por-parcela.
- Upload (`registrar_documento_boleto_parcela`) e análise (`analisar_documento_boleto_gestor`) são **wrappers finos** sobre `registrar_documento_upload` e `analisar_documento_versao` respectivamente — reaproveitam 100% do motor de versionamento/auditoria existente, sem duplicar lógica. A análise usa um wrapper (não a RPC genérica direto) porque `analisar_documento_versao` só checa `role='gestor'` sem escopo de fundo — o gap que o próprio ticket pede para revisar.
- Beneficiário do boleto (`documento_versoes.beneficiario_estabelecimento_id`) é validado contra `cedente_estabelecimentos` (Matriz ou Filial aprovada do mesmo Cedente da NF) — sem re-digitação de valor/vencimento/pagador: eles vêm por construção da própria parcela e do `cnpj_destinatario` da NF, então não podem ficar divergentes (não há OCR de boleto neste sistema; essa é a garantia estrutural adotada em vez de confronto textual).

## Fase 2: seleção de parcelas na operação (implementada)

`status` (previsto desde a Fase 1 exatamente para isso) agora transiciona
`disponivel → em_operacao` quando uma parcela é cedida, e volta para
`disponivel` se a operação é reprovada/cancelada. Uma nova tabela aditiva,
`operacoes_nf_parcelas` (`UNIQUE(parcela_id)`), guarda qual parcela foi
cedida em qual operação, sem alterar o schema de `operacoes_nfs` (que tem
uma FK composta real vinda de `nota_fiscal_entregas`). Detalhamento
completo (migrations, RPCs, elegibilidade por parcela, precificação, bug
corrigido, E2E) em
[`relatorio-parcelas-boleto-precificacao.md`](relatorio-parcelas-boleto-precificacao.md).

## Não implementado ainda (fora de escopo do checkpoint atual)

- Fase 3 (CNAB, liquidação, conciliação, exposição, estoque por parcela).

Ver [`relatorio-parcelas-boleto-precificacao.md`](relatorio-parcelas-boleto-precificacao.md) para status final e riscos.
