-- P0 Claude: separa "matching tecnico" (avaliarMatchingRemessaVenda,
-- inalterado) de "aprovacao documental" (nova) para o requisito nf_remessa.
--
-- Bug corrigido: status_validacao (resultado do matching tecnico) era
-- tratado como decisao final e satisfazia o requisito nf_remessa
-- automaticamente, mesmo quando a politica vigente configurou
-- nivel_validacao='manual'/'hibrido' para esse requisito -- a gestora nunca
-- tinha a chance de revisar antes da remessa virar "Validada".
--
-- Este migration NAO altera avaliarMatchingRemessaVenda nem a semantica de
-- status_validacao (matching, inalterado). aprovacao_documental e uma
-- decisao SEPARADA, em cima de uma remessa ja VALIDADA no matching:
--   NULL               -> nao aplicavel: matching <> VALIDADA (nada para
--                         aprovar ainda), OU a politica vigente do
--                         requisito nf_remessa e 'estrutural'/nao
--                         configurada -- comportamento automatico
--                         preservado, sem regressao para quem ja confiava
--                         nisso.
--   aguardando_analise -> matching VALIDADA e a politica exige
--                         'manual'/'hibrido'; sem decisao da gestora ainda.
--   aprovado/rejeitado -> decisao explicita da gestora, via o novo RPC
--                         analisar_nota_fiscal_remessa.
--
-- A reconciliacao do requisito de politica (private.reconciliar_requisito_
-- nf_remessa, migration 20260821070000) passa a exigir tambem a aprovacao
-- documental resolvida (NULL ou 'aprovado') alem do matching VALIDADA.

BEGIN;

-- 1. Colunas de aprovacao documental --------------------------------------

ALTER TABLE public.nota_fiscal_remessas
  ADD COLUMN IF NOT EXISTS aprovacao_documental text,
  ADD COLUMN IF NOT EXISTS aprovacao_analisado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS aprovacao_analisado_em timestamptz,
  ADD COLUMN IF NOT EXISTS aprovacao_motivo_rejeicao text;

ALTER TABLE public.nota_fiscal_remessas
  DROP CONSTRAINT IF EXISTS nota_fiscal_remessas_aprovacao_documental_check;
ALTER TABLE public.nota_fiscal_remessas
  ADD CONSTRAINT nota_fiscal_remessas_aprovacao_documental_check
  CHECK (aprovacao_documental IS NULL OR aprovacao_documental IN ('aguardando_analise', 'aprovado', 'rejeitado'));

ALTER TABLE public.nota_fiscal_remessas
  DROP CONSTRAINT IF EXISTS nota_fiscal_remessas_aprovacao_motivo_rejeicao_check;
ALTER TABLE public.nota_fiscal_remessas
  ADD CONSTRAINT nota_fiscal_remessas_aprovacao_motivo_rejeicao_check
  CHECK (aprovacao_documental <> 'rejeitado' OR length(trim(coalesce(aprovacao_motivo_rejeicao, ''))) > 0);

COMMENT ON COLUMN public.nota_fiscal_remessas.aprovacao_documental IS
  'Decisao documental da gestora, SEPARADA do matching tecnico (status_validacao). NULL = nao aplicavel (matching <> VALIDADA, ou o requisito nf_remessa da politica vigente nao exige validacao manual/hibrida -- comportamento automatico preservado). aguardando_analise = matching VALIDADA e a politica exige manual/hibrido, sem decisao ainda. aprovado/rejeitado = decisao explicita via analisar_nota_fiscal_remessa.';
COMMENT ON COLUMN public.nota_fiscal_remessas.aprovacao_motivo_rejeicao IS
  'Motivo da rejeicao documental (aprovacao_documental=rejeitado). Distinto de motivos_validacao, que e do matching tecnico e pode coexistir (ex.: matching VALIDADA mas rejeitado na analise documental).';

CREATE INDEX IF NOT EXISTS idx_nota_fiscal_remessas_aguardando_analise
  ON public.nota_fiscal_remessas(nota_fiscal_venda_id)
  WHERE aprovacao_documental = 'aguardando_analise';

-- 2. registrar_nota_fiscal_remessa: computa aprovacao_documental no INSERT.
--    Alteracao aditiva -- matching/seguranca/RLS existentes inalterados.

CREATE OR REPLACE FUNCTION public.registrar_nota_fiscal_remessa(
  p_nota_fiscal_venda_id uuid,
  p_chave_acesso text,
  p_numero text,
  p_serie text,
  p_emitente_cnpj text,
  p_emitente_razao_social text,
  p_destinatario_cnpj text,
  p_destinatario_razao_social text,
  p_data_emissao date,
  p_valor_total numeric,
  p_quantidade_total numeric,
  p_itens jsonb,
  p_status_validacao text,
  p_referencia_nf_venda_confirmada boolean,
  p_motivos_validacao jsonb,
  p_bucket text,
  p_path text,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text := get_user_role();
  actor_id uuid := auth.uid();
  venda record;
  chave_limpa text := regexp_replace(coalesce(p_chave_acesso, ''), '\D', '', 'g');
  v_id uuid;
  v_nivel_validacao text;
  v_aprovacao_documental text;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('cedente', 'gestor') THEN
    RAISE EXCEPTION 'Usuario sem permissao para enviar NF de remessa';
  END IF;
  IF p_status_validacao NOT IN ('VALIDADA', 'REVISAO_MANUAL', 'REJEITADA') THEN
    RAISE EXCEPTION 'Status de validacao da remessa invalido';
  END IF;
  IF p_bucket <> 'documentos-v2' OR p_tamanho_bytes <= 0 OR p_sha256 !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Metadados de armazenamento invalidos';
  END IF;
  IF chave_limpa !~ '^[0-9]{44}$' THEN
    RAISE EXCEPTION 'Chave de acesso da remessa invalida';
  END IF;
  IF p_valor_total < 0 THEN
    RAISE EXCEPTION 'Valor total da remessa invalido';
  END IF;

  SELECT id, cedente_id, fundo_id, cedente_fundo_id, chave_acesso
    INTO venda
  FROM public.notas_fiscais
  WHERE id = p_nota_fiscal_venda_id;

  IF venda.id IS NULL THEN
    RAISE EXCEPTION 'NF de venda nao encontrada';
  END IF;
  IF venda.fundo_id IS NULL OR venda.cedente_fundo_id IS NULL THEN
    RAISE EXCEPTION 'NF de venda sem contexto de fundo e vinculo';
  END IF;
  IF venda.chave_acesso IS NOT NULL AND venda.chave_acesso = chave_limpa THEN
    RAISE EXCEPTION 'A remessa nao pode ter a mesma chave de acesso da NF de venda';
  END IF;

  IF actor_role = 'cedente' AND venda.cedente_id <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'NF de venda fora do cedente autenticado';
  END IF;
  IF actor_role = 'gestor' AND NOT private.usuario_tem_acesso_fundo(venda.fundo_id) THEN
    RAISE EXCEPTION 'Fundo nao autorizado para o gestor autenticado';
  END IF;

  IF EXISTS (SELECT 1 FROM public.nota_fiscal_remessas WHERE chave_acesso = chave_limpa) THEN
    RAISE EXCEPTION 'Chave de acesso da remessa ja cadastrada';
  END IF;

  -- Nivel de validacao do requisito nf_remessa vigente para esta venda,
  -- lido do snapshot instanciado por instanciar_requisitos_nota (fonte mais
  -- confiavel -- nao a politica viva). Sem requisito instanciado (politica
  -- sem nf_remessa configurado, estado valido), trata como automatico --
  -- nunca inventa um gate manual onde nenhum requisito de politica existe.
  SELECT dri.nivel_validacao_snapshot
    INTO v_nivel_validacao
  FROM public.documento_requisito_instancias dri
  WHERE dri.nota_fiscal_id = p_nota_fiscal_venda_id
    AND dri.tipo_documento_codigo_snapshot = 'nf_remessa'
    AND dri.status <> 'cancelado'
  ORDER BY dri.created_at DESC
  LIMIT 1;

  v_aprovacao_documental := CASE
    WHEN p_status_validacao <> 'VALIDADA' THEN NULL
    WHEN v_nivel_validacao IN ('manual', 'hibrido') THEN 'aguardando_analise'
    ELSE NULL
  END;

  INSERT INTO public.nota_fiscal_remessas (
    nota_fiscal_venda_id, cedente_id, fundo_id, cedente_fundo_id,
    chave_acesso, numero, serie,
    emitente_cnpj, emitente_razao_social, destinatario_cnpj, destinatario_razao_social,
    data_emissao, valor_total, quantidade_total, itens,
    status_validacao, referencia_nf_venda_confirmada, motivos_validacao,
    aprovacao_documental,
    bucket, path, nome_original, mime_type, tamanho_bytes, sha256, criado_por
  )
  VALUES (
    venda.id, venda.cedente_id, venda.fundo_id, venda.cedente_fundo_id,
    chave_limpa, nullif(p_numero, ''), nullif(p_serie, ''),
    nullif(regexp_replace(coalesce(p_emitente_cnpj, ''), '\D', '', 'g'), ''), nullif(p_emitente_razao_social, ''),
    nullif(regexp_replace(coalesce(p_destinatario_cnpj, ''), '\D', '', 'g'), ''), nullif(p_destinatario_razao_social, ''),
    p_data_emissao, coalesce(p_valor_total, 0), p_quantidade_total, coalesce(p_itens, '[]'::jsonb),
    p_status_validacao, coalesce(p_referencia_nf_venda_confirmada, false), coalesce(p_motivos_validacao, '[]'::jsonb),
    v_aprovacao_documental,
    p_bucket, p_path, p_nome_original, lower(p_mime_type), p_tamanho_bytes, lower(p_sha256), actor_id
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'status_validacao', p_status_validacao,
    'nota_fiscal_venda_id', venda.id,
    'aprovacao_documental', v_aprovacao_documental
  );
END;
$$;

-- 3. reconciliar_requisito_nf_remessa: a satisfacao agora tambem exige que a
--    aprovacao documental (quando aplicavel) esteja resolvida como aprovada
--    -- uma remessa 'aguardando_analise' ou 'rejeitada' na etapa documental
--    nao satisfaz o requisito mesmo com matching VALIDADA.

CREATE OR REPLACE FUNCTION private.reconciliar_requisito_nf_remessa(p_nota_fiscal_venda_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_satisfeito boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.nota_fiscal_remessas r
    WHERE r.nota_fiscal_venda_id = p_nota_fiscal_venda_id
      AND r.status_validacao = 'VALIDADA'
      AND (r.aprovacao_documental IS NULL OR r.aprovacao_documental = 'aprovado')
  ) INTO v_satisfeito;

  UPDATE public.documento_requisito_instancias
  SET status = 'satisfeito', satisfeito_em = now()
  WHERE nota_fiscal_id = p_nota_fiscal_venda_id
    AND tipo_documento_codigo_snapshot = 'nf_remessa'
    AND status = 'pendente'
    AND v_satisfeito;

  UPDATE public.documento_requisito_instancias
  SET status = 'pendente', satisfeito_em = NULL, versao_aprovada_id = NULL
  WHERE nota_fiscal_id = p_nota_fiscal_venda_id
    AND tipo_documento_codigo_snapshot = 'nf_remessa'
    AND status = 'satisfeito'
    AND NOT v_satisfeito;
END;
$function$;

-- 4. Trigger de reconciliacao passa a disparar tambem em UPDATE de
--    aprovacao_documental (alem de INSERT e UPDATE de status_validacao) --
--    para que aprovar/rejeitar via analisar_nota_fiscal_remessa reconcilie
--    automaticamente, sem chamada manual dentro do RPC de analise.

DROP TRIGGER IF EXISTS nota_fiscal_remessas_reconciliar_requisito ON public.nota_fiscal_remessas;
CREATE TRIGGER nota_fiscal_remessas_reconciliar_requisito
  AFTER INSERT OR UPDATE OF status_validacao, aprovacao_documental ON public.nota_fiscal_remessas
  FOR EACH ROW EXECUTE FUNCTION private.trigger_reconciliar_requisito_nf_remessa();

-- 5. analisar_nota_fiscal_remessa: decisao da gestora sobre a aprovacao
--    documental de uma remessa em 'aguardando_analise'. Mesmo padrao de
--    analisar_cte_documento/analisar_canhoto_documento (fase5_logistica_
--    pos_cessao): gestor-only, motivo obrigatorio ao rejeitar, fail-closed
--    quando o estado atual nao e o esperado.

CREATE OR REPLACE FUNCTION public.analisar_nota_fiscal_remessa(
  p_nota_fiscal_remessa_id uuid,
  p_resultado text,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remessa_row record;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor pode analisar NF de remessa';
  END IF;
  IF p_resultado NOT IN ('aprovado', 'rejeitado') THEN RAISE EXCEPTION 'Resultado invalido'; END IF;
  IF p_resultado = 'rejeitado' AND length(trim(coalesce(p_motivo, ''))) = 0 THEN RAISE EXCEPTION 'Motivo obrigatorio ao rejeitar'; END IF;

  SELECT * INTO remessa_row FROM public.nota_fiscal_remessas WHERE id = p_nota_fiscal_remessa_id FOR UPDATE;
  IF remessa_row.id IS NULL THEN
    RAISE EXCEPTION 'NF de remessa nao encontrada';
  END IF;

  -- Fail-closed: so pode decidir uma remessa que esteja de fato aguardando
  -- analise -- nunca uma sem aprovacao aplicavel (NULL), ja decidida
  -- (aprovado/rejeitado) ou com matching que nunca chegou a VALIDADA.
  IF remessa_row.aprovacao_documental IS DISTINCT FROM 'aguardando_analise' THEN
    RAISE EXCEPTION 'NF de remessa nao esta aguardando analise documental';
  END IF;

  UPDATE public.nota_fiscal_remessas
  SET aprovacao_documental = p_resultado,
      aprovacao_analisado_por = auth.uid(),
      aprovacao_analisado_em = now(),
      aprovacao_motivo_rejeicao = CASE WHEN p_resultado = 'rejeitado' THEN p_motivo ELSE NULL END
  WHERE id = p_nota_fiscal_remessa_id;

  RETURN jsonb_build_object(
    'id', p_nota_fiscal_remessa_id,
    'aprovacao_documental', p_resultado,
    'nota_fiscal_venda_id', remessa_row.nota_fiscal_venda_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.analisar_nota_fiscal_remessa(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analisar_nota_fiscal_remessa(uuid, text, text) TO authenticated;

COMMIT;
