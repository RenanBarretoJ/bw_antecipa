-- P0: corrige "permission denied for table documentos" na analise do Gestor.
-- O hardening de ACL (P2.6.4 + hotfix_dashboard_gestor_acl) revogou INSERT/UPDATE/DELETE
-- de authenticated em public.documentos e manteve apenas SELECT via RLS multifundo.
-- As server actions de Aprovar/Reprovar/Solicitar Atualizacao ainda faziam UPDATE
-- direto na tabela; passam a usar RPCs SECURITY DEFINER estreitas, com a mesma
-- regra de autorizacao multifundo ja usada pela policy de leitura
-- (documentos_gestor_multifundo_select): qualquer fundo vinculado ativo do
-- gestor, sem depender do fundo ativo selecionado na sessao.

BEGIN;

CREATE OR REPLACE FUNCTION public.analisar_documento_gestor(
  p_documento_id uuid,
  p_decisao text,
  p_motivo text DEFAULT NULL
)
RETURNS TABLE (
  documento_id uuid,
  status public.documento_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_cedente_id uuid;
  v_status_atual public.documento_status;
  v_documento public.documentos%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria para analisar documento.';
  END IF;

  IF p_decisao NOT IN ('aprovado', 'reprovado') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Decisao invalida.';
  END IF;

  IF p_decisao = 'reprovado' AND (p_motivo IS NULL OR length(btrim(p_motivo)) = 0) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Motivo da reprovacao e obrigatorio.';
  END IF;

  SELECT documento.cedente_id, documento.status
  INTO v_cedente_id, v_status_atual
  FROM public.documentos documento
  WHERE documento.id = p_documento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Documento nao encontrado.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cedente_fundos cf
    WHERE cf.cedente_id = v_cedente_id
      AND cf.status = 'ativo'
      AND private.usuario_tem_acesso_fundo(cf.fundo_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Documento nao pertence a um fundo autorizado para este gestor.';
  END IF;

  IF v_status_atual NOT IN ('enviado', 'em_analise') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Documento com status atual nao permite analise.';
  END IF;

  UPDATE public.documentos
  SET status = p_decisao::public.documento_status,
      motivo_reprovacao = CASE WHEN p_decisao = 'reprovado' THEN p_motivo ELSE NULL END,
      analisado_por = v_actor_id,
      analisado_em = now()
  WHERE id = p_documento_id
  RETURNING * INTO v_documento;

  RETURN QUERY SELECT v_documento.id, v_documento.status;
END;
$function$;

REVOKE ALL ON FUNCTION public.analisar_documento_gestor(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analisar_documento_gestor(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.solicitar_atualizacao_documento_gestor(
  p_documento_id uuid
)
RETURNS TABLE (
  documento_id uuid,
  atualizacao_solicitada_em timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_cedente_id uuid;
  v_documento public.documentos%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria para solicitar atualizacao.';
  END IF;

  SELECT documento.cedente_id
  INTO v_cedente_id
  FROM public.documentos documento
  WHERE documento.id = p_documento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Documento nao encontrado.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cedente_fundos cf
    WHERE cf.cedente_id = v_cedente_id
      AND cf.status = 'ativo'
      AND private.usuario_tem_acesso_fundo(cf.fundo_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Documento nao pertence a um fundo autorizado para este gestor.';
  END IF;

  UPDATE public.documentos
  SET atualizacao_solicitada_em = now(),
      atualizacao_solicitada_por = v_actor_id
  WHERE id = p_documento_id
  RETURNING * INTO v_documento;

  RETURN QUERY SELECT v_documento.id, v_documento.atualizacao_solicitada_em;
END;
$function$;

REVOKE ALL ON FUNCTION public.solicitar_atualizacao_documento_gestor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_atualizacao_documento_gestor(uuid) TO authenticated;

COMMIT;
