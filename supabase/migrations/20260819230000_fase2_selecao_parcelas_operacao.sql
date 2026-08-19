-- Fase 2 (Parcelas de NF): relacao operacao <-> parcela.
--
-- Decisao de modelo (confirmada com o usuario antes de implementar): a
-- cardinalidade NF<->operacao passa a ser por parcela -- parcelas nao
-- selecionadas de uma NF continuam disponiveis para uma operacao FUTURA e
-- DIFERENTE. Isso NAO pode ser feito alterando a chave de
-- public.operacoes_nfs (operacao_id, nota_fiscal_id): existe uma FK
-- composta real de public.nota_fiscal_entregas para exatamente essas duas
-- colunas (rastreamento logistico por NF dentro de uma operacao -- uma
-- entrega corresponde a mercadoria da NF inteira, nao a parcelas
-- financeiras). Quebrar essa chave para introduzir parcela_id ali
-- exigiria migrar nota_fiscal_entregas tambem, fora do escopo pedido.
--
-- Em vez disso: operacoes_nfs continua funcionando exatamente como hoje
-- (1 linha por NF tocada por uma operacao -- para NF sem parcelas, isso ja
-- significa "a NF inteira"; para NF com parcelas, passa a significar
-- apenas "esta operacao toca alguma parcela desta NF", nao mais "a NF
-- inteira"). Uma NOVA tabela aditiva, operacoes_nf_parcelas, guarda quais
-- parcelas especificas foram cedidas em qual operacao, com
-- UNIQUE(parcela_id) -- uma parcela so pode estar numa operacao por vez,
-- exatamente como o modelo legado ja garante por NF inteira via o
-- already_linked_count dentro da RPC.

BEGIN;

CREATE TABLE public.operacoes_nf_parcelas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacao_id uuid NOT NULL REFERENCES public.operacoes(id) ON DELETE CASCADE,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE CASCADE,
  parcela_id uuid NOT NULL REFERENCES public.nota_fiscal_parcelas(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operacoes_nf_parcelas_parcela_unique UNIQUE (parcela_id)
);

CREATE INDEX idx_operacoes_nf_parcelas_operacao ON public.operacoes_nf_parcelas(operacao_id);
CREATE INDEX idx_operacoes_nf_parcelas_nf ON public.operacoes_nf_parcelas(nota_fiscal_id);

ALTER TABLE public.operacoes_nf_parcelas ENABLE ROW LEVEL SECURITY;

CREATE POLICY operacoes_nf_parcelas_cedente_select ON public.operacoes_nf_parcelas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.notas_fiscais nf
      WHERE nf.id = operacoes_nf_parcelas.nota_fiscal_id
        AND (
          nf.cedente_id = (SELECT public.get_user_cedente_id())
          OR ((SELECT public.get_user_role()) = 'consultor' AND EXISTS (
            SELECT 1 FROM public.consultor_cedente cc WHERE cc.consultor_id = (SELECT auth.uid()) AND cc.cedente_id = nf.cedente_id
          ))
        )
    )
  );

CREATE POLICY operacoes_nf_parcelas_gestor_multifundo_select ON public.operacoes_nf_parcelas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.notas_fiscais nf
      WHERE nf.id = operacoes_nf_parcelas.nota_fiscal_id
        AND (SELECT public.get_user_role()) = 'gestor'
        AND private.gestor_tem_acesso_cedente(nf.cedente_id)
    )
  );

GRANT SELECT ON public.operacoes_nf_parcelas TO authenticated;
GRANT ALL ON public.operacoes_nf_parcelas TO service_role;

-- Cada linha de memoria de calculo financeiro passa a poder referenciar uma
-- parcela especifica (quando a NF tem parcelas) em vez de sempre a NF
-- inteira. NULL preserva o comportamento legado (1 linha por NF).
ALTER TABLE public.operacao_calculo_nfs
  ADD COLUMN parcela_id uuid REFERENCES public.nota_fiscal_parcelas(id) ON DELETE RESTRICT;
ALTER TABLE public.operacao_calculo_nfs
  DROP CONSTRAINT operacao_calculo_nfs_operacao_nf_unique;
ALTER TABLE public.operacao_calculo_nfs
  ADD CONSTRAINT operacao_calculo_nfs_operacao_nf_parcela_unique
  UNIQUE NULLS NOT DISTINCT (operacao_id, nota_fiscal_id, parcela_id);

CREATE INDEX idx_operacao_calculo_nfs_parcela ON public.operacao_calculo_nfs(parcela_id) WHERE parcela_id IS NOT NULL;

COMMIT;
