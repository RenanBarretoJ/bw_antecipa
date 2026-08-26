-- P0 - corrige "permission denied for table solicitacoes_alteracao_cedente"
-- ao enviar solicitacao de alteracao cadastral.
--
-- Causa raiz: 20260817150507_p2_6_4_canonicalizar_acl_rls.sql revogou
-- INSERT em solicitacoes_alteracao_cedente de authenticated (linha do
-- REVOKE INSERT ... array que inclui esta tabela) e devolveu apenas
-- SELECT. A policy RLS sac_cedente_insert continuou existindo, mas GRANT
-- de tabela e verificado antes de RLS -- sem o GRANT, a policy nunca e
-- avaliada e o Postgres responde "permission denied for table", nao o
-- erro de RLS. src/lib/actions/cedente.ts (solicitarAlteracaoCedente)
-- nunca foi migrado para uma RPC quando isso aconteceu (diferente de
-- cedentes/cedente_estabelecimentos, que ja usam RPC-only mutation).
--
-- Correcao: RPC SECURITY DEFINER dedicada, mesmo padrao das demais RPCs
-- de cadastro do cedente. Nenhum GRANT de escrita direta e reaberto.

BEGIN;

CREATE OR REPLACE FUNCTION public.solicitar_alteracao_cadastral_cedente(
  p_dados_atuais jsonb,
  p_dados_propostos jsonb,
  p_representantes_atuais jsonb DEFAULT '[]'::jsonb,
  p_representantes_propostos jsonb DEFAULT '[]'::jsonb
)
RETURNS public.solicitacoes_alteracao_cedente
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cedente_id uuid;
  v_owner_user_id uuid;
  v_result public.solicitacoes_alteracao_cedente%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Autenticacao obrigatoria para solicitar alteracao cadastral.' USING ERRCODE = '42501';
  END IF;

  v_cedente_id := public.get_user_cedente_id();
  IF v_cedente_id IS NULL THEN
    RAISE EXCEPTION 'Cedente nao encontrado para o usuario autenticado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT c.user_id INTO v_owner_user_id FROM public.cedentes c WHERE c.id = v_cedente_id;

  IF v_owner_user_id IS DISTINCT FROM (SELECT auth.uid())
     AND public.get_user_cedente_acesso_perfil() IS DISTINCT FROM 'administrador' THEN
    RAISE EXCEPTION 'Sem permissao para solicitar alteracoes cadastrais.' USING ERRCODE = '42501';
  END IF;

  IF p_dados_propostos IS NULL OR jsonb_typeof(p_dados_propostos) <> 'object' THEN
    RAISE EXCEPTION 'Dados propostos invalidos.' USING ERRCODE = '22023';
  END IF;
  IF p_dados_atuais IS NULL OR jsonb_typeof(p_dados_atuais) <> 'object' THEN
    RAISE EXCEPTION 'Dados atuais invalidos.' USING ERRCODE = '22023';
  END IF;
  IF p_representantes_propostos IS NOT NULL AND jsonb_typeof(p_representantes_propostos) <> 'array' THEN
    RAISE EXCEPTION 'Representantes propostos invalidos.' USING ERRCODE = '22023';
  END IF;
  IF p_representantes_atuais IS NOT NULL AND jsonb_typeof(p_representantes_atuais) <> 'array' THEN
    RAISE EXCEPTION 'Representantes atuais invalidos.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.solicitacoes_alteracao_cedente s
    WHERE s.cedente_id = v_cedente_id AND s.status = 'pendente'
  ) THEN
    RAISE EXCEPTION 'Ja existe uma solicitacao de alteracao aguardando aprovacao.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.solicitacoes_alteracao_cedente (
    cedente_id, dados_atuais, dados_propostos, representantes_atuais, representantes_propostos
  ) VALUES (
    v_cedente_id, p_dados_atuais, p_dados_propostos,
    coalesce(p_representantes_atuais, '[]'::jsonb), coalesce(p_representantes_propostos, '[]'::jsonb)
  )
  RETURNING * INTO v_result;

  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois
  ) VALUES (
    auth.uid(), 'usuario', 'cedente_cadastro', 'ALTERACAO_CADASTRAL_SOLICITADA',
    'cedentes', v_cedente_id, p_dados_atuais, p_dados_propostos
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.solicitar_alteracao_cadastral_cedente(jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_alteracao_cadastral_cedente(jsonb, jsonb, jsonb, jsonb) TO authenticated;

COMMENT ON FUNCTION public.solicitar_alteracao_cadastral_cedente(jsonb, jsonb, jsonb, jsonb) IS
  'Cria a solicitacao de alteracao cadastral do proprio cedente autenticado (owner ou acesso administrador); nao aceita cedente_id do cliente. Substitui o INSERT direto que ficou quebrado apos a revogacao de GRANT em 20260817150507.';

NOTIFY pgrst, 'reload schema';

COMMIT;
