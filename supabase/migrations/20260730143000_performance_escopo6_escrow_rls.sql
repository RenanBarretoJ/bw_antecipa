-- Escopo 6 de performance: restringe escrow ao fundo/carteira efetivamente autorizados.
-- Nenhum indice e criado nesta migration: os candidatos dependem de EXPLAIN em homologacao.

ALTER TABLE public.consultor_cedente ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultor_cedente TO authenticated;

DROP POLICY IF EXISTS consultor_cedente_gestor_all ON public.consultor_cedente;
CREATE POLICY consultor_cedente_gestor_all
  ON public.consultor_cedente
  FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'gestor')
  WITH CHECK (public.get_user_role() = 'gestor');

DROP POLICY IF EXISTS consultor_cedente_select_own ON public.consultor_cedente;
CREATE POLICY consultor_cedente_select_own
  ON public.consultor_cedente
  FOR SELECT
  TO authenticated
  USING (consultor_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS cedentes_consultor_select ON public.cedentes;
CREATE POLICY cedentes_consultor_select
  ON public.cedentes
  FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() = 'consultor'
    AND EXISTS (
      SELECT 1
      FROM public.consultor_cedente cc
      WHERE cc.consultor_id = (SELECT auth.uid())
        AND cc.cedente_id = cedentes.id
    )
  );

DROP POLICY IF EXISTS contas_escrow_gestor_all ON public.contas_escrow;
CREATE POLICY contas_escrow_gestor_all
  ON public.contas_escrow
  FOR ALL
  TO authenticated
  USING (
    public.get_user_role() = 'gestor'
    AND EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.usuario_fundos uf
        ON uf.fundo_id = cf.fundo_id
       AND uf.usuario_id = (SELECT auth.uid())
       AND uf.status = 'ativo'
      WHERE cf.cedente_id = contas_escrow.cedente_id
        AND cf.status IN ('ativo', 'suspenso')
    )
  )
  WITH CHECK (
    public.get_user_role() = 'gestor'
    AND EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.usuario_fundos uf
        ON uf.fundo_id = cf.fundo_id
       AND uf.usuario_id = (SELECT auth.uid())
       AND uf.status = 'ativo'
      WHERE cf.cedente_id = contas_escrow.cedente_id
        AND cf.status IN ('ativo', 'suspenso')
    )
  );

DROP POLICY IF EXISTS contas_escrow_consultor_select ON public.contas_escrow;
CREATE POLICY contas_escrow_consultor_select
  ON public.contas_escrow
  FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() = 'consultor'
    AND EXISTS (
      SELECT 1
      FROM public.consultor_cedente cc
      WHERE cc.consultor_id = (SELECT auth.uid())
        AND cc.cedente_id = contas_escrow.cedente_id
    )
  );

DROP POLICY IF EXISTS movimentos_escrow_gestor_all ON public.movimentos_escrow;
CREATE POLICY movimentos_escrow_gestor_all
  ON public.movimentos_escrow
  FOR ALL
  TO authenticated
  USING (
    public.get_user_role() = 'gestor'
    AND EXISTS (
      SELECT 1
      FROM public.contas_escrow ce
      JOIN public.cedente_fundos cf
        ON cf.cedente_id = ce.cedente_id
       AND cf.status IN ('ativo', 'suspenso')
      JOIN public.usuario_fundos uf
        ON uf.fundo_id = cf.fundo_id
       AND uf.usuario_id = (SELECT auth.uid())
       AND uf.status = 'ativo'
      WHERE ce.id = movimentos_escrow.conta_escrow_id
    )
  )
  WITH CHECK (
    public.get_user_role() = 'gestor'
    AND EXISTS (
      SELECT 1
      FROM public.contas_escrow ce
      JOIN public.cedente_fundos cf
        ON cf.cedente_id = ce.cedente_id
       AND cf.status IN ('ativo', 'suspenso')
      JOIN public.usuario_fundos uf
        ON uf.fundo_id = cf.fundo_id
       AND uf.usuario_id = (SELECT auth.uid())
       AND uf.status = 'ativo'
      WHERE ce.id = movimentos_escrow.conta_escrow_id
    )
  );

DROP POLICY IF EXISTS movimentos_escrow_consultor_select ON public.movimentos_escrow;
CREATE POLICY movimentos_escrow_consultor_select
  ON public.movimentos_escrow
  FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() = 'consultor'
    AND EXISTS (
      SELECT 1
      FROM public.contas_escrow ce
      JOIN public.consultor_cedente cc
        ON cc.cedente_id = ce.cedente_id
       AND cc.consultor_id = (SELECT auth.uid())
      WHERE ce.id = movimentos_escrow.conta_escrow_id
    )
  );

CREATE OR REPLACE FUNCTION public.listar_documentos_atuais_cedente(
  p_cedente_id uuid
)
RETURNS TABLE (
  id uuid,
  tipo text,
  versao integer,
  status text,
  nome_arquivo text,
  url_arquivo text,
  motivo_reprovacao text,
  created_at timestamptz,
  representante_id uuid,
  analisado_em timestamptz,
  atualizacao_solicitada_em timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (d.tipo, d.representante_id)
    d.id,
    d.tipo::text,
    d.versao,
    d.status::text,
    d.nome_arquivo,
    d.url_arquivo,
    d.motivo_reprovacao,
    d.created_at,
    d.representante_id,
    d.analisado_em,
    d.atualizacao_solicitada_em
  FROM public.documentos d
  WHERE d.cedente_id = p_cedente_id
  ORDER BY d.tipo, d.representante_id NULLS FIRST, d.versao DESC, d.created_at DESC, d.id DESC;
$$;

REVOKE ALL ON FUNCTION public.listar_documentos_atuais_cedente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_documentos_atuais_cedente(uuid) TO authenticated;
