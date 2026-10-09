-- R1.16 FWD-05: canonical function with only the approved negative-text compatibility delta.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
-- Match the certified capture context: public types remain schema-qualified.
SET LOCAL search_path = pg_catalog;

DO $r116$
DECLARE
  v_oid oid := 'public.corrigir_duplicata(uuid,jsonb,text,text)'::regprocedure;
  v_before text;
  v_hash text;
  v_acl text[];
  v_target constant text := $r116_definition$CREATE OR REPLACE FUNCTION public.corrigir_duplicata(p_duplicata_id uuid, p_campos jsonb, p_motivo text, p_resultado_confronto text)
 RETURNS public.duplicatas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_role text := (SELECT public.get_user_role());
  v_old public.duplicatas%ROWTYPE;
  v_new public.duplicatas%ROWTYPE;
  v_version uuid;
  v_key text;
  v_old_value jsonb;
  v_new_value jsonb;
  v_actor_name text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Usuario nao autenticado'; END IF;
  IF length(btrim(coalesce(p_motivo, ''))) = 0 THEN RAISE EXCEPTION 'Informe o motivo da correcao'; END IF;
  SELECT * INTO v_old FROM public.duplicatas d WHERE d.id = p_duplicata_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Duplicata nao encontrada'; END IF;
  IF NOT (
    (v_role = 'cedente' AND v_old.cedente_id = (SELECT public.get_user_cedente_id()))
    OR (
      v_role = 'consultor'
      AND (SELECT private.usuario_pode_operar_cedente(v_old.cedente_id))
      AND (SELECT private.consultor_tem_acesso_fundo(v_old.fundo_id))
    )
    OR (v_role = 'gestor' AND (SELECT private.usuario_tem_acesso_fundo(v_old.fundo_id)))
  ) THEN RAISE EXCEPTION 'Usuario sem permissao para corrigir a duplicata'; END IF;
  IF v_old.status_validacao IN ('VALIDADA', 'REJEITADA') THEN
    RAISE EXCEPTION 'Duplicata finalizada nao pode ser alterada';
  END IF;
  IF v_role IN ('cedente', 'consultor') AND NOT EXISTS (
    SELECT 1 FROM public.notas_fiscais nf
    WHERE nf.id = v_old.nota_fiscal_id
      AND nf.status IN ('rascunho', 'requer_ajuste')
  ) THEN
    RAISE EXCEPTION 'A correcao pelo cedente deve ocorrer antes da submissao da NF';
  END IF;
  v_version := v_old.versao_atual_id;
  IF v_version IS NULL THEN RAISE EXCEPTION 'Duplicata sem versao documental atual'; END IF;

  FOREACH v_key IN ARRAY ARRAY['numero','numero_fatura','parcela','data_emissao','data_vencimento','valor_nominal','nome_cedente_documento','cnpj_cedente_documento','nome_sacado_documento','cnpj_sacado_documento','local_pagamento','aceite_textual'] LOOP
    IF p_campos ? v_key THEN
      v_old_value := to_jsonb(v_old)->v_key;
      v_new_value := p_campos->v_key;
      IF v_old_value IS DISTINCT FROM v_new_value THEN
        INSERT INTO public.duplicata_correcoes (
          duplicata_id, duplicata_versao_id, campo, valor_original, valor_corrigido,
          motivo, corrigido_por
        ) VALUES (v_old.id, v_version, v_key, v_old_value, v_new_value, btrim(p_motivo), v_user_id);
      END IF;
    END IF;
  END LOOP;

  UPDATE public.duplicatas SET
    numero = CASE WHEN p_campos ? 'numero' THEN nullif(btrim(p_campos->>'numero'), '') ELSE numero END,
    numero_fatura = CASE WHEN p_campos ? 'numero_fatura' THEN nullif(btrim(p_campos->>'numero_fatura'), '') ELSE numero_fatura END,
    parcela = CASE WHEN p_campos ? 'parcela' THEN coalesce(btrim(p_campos->>'parcela'), '') ELSE parcela END,
    data_emissao = CASE WHEN p_campos ? 'data_emissao' THEN nullif(p_campos->>'data_emissao', '')::date ELSE data_emissao END,
    data_vencimento = CASE WHEN p_campos ? 'data_vencimento' THEN nullif(p_campos->>'data_vencimento', '')::date ELSE data_vencimento END,
    valor_nominal = CASE WHEN p_campos ? 'valor_nominal' THEN nullif(p_campos->>'valor_nominal', '')::numeric ELSE valor_nominal END,
    nome_cedente_documento = CASE WHEN p_campos ? 'nome_cedente_documento' THEN nullif(btrim(p_campos->>'nome_cedente_documento'), '') ELSE nome_cedente_documento END,
    cnpj_cedente_documento = CASE WHEN p_campos ? 'cnpj_cedente_documento' THEN nullif(regexp_replace(p_campos->>'cnpj_cedente_documento', '[^0-9]', '', 'g'), '') ELSE cnpj_cedente_documento END,
    nome_sacado_documento = CASE WHEN p_campos ? 'nome_sacado_documento' THEN nullif(btrim(p_campos->>'nome_sacado_documento'), '') ELSE nome_sacado_documento END,
    cnpj_sacado_documento = CASE WHEN p_campos ? 'cnpj_sacado_documento' THEN nullif(regexp_replace(p_campos->>'cnpj_sacado_documento', '[^0-9]', '', 'g'), '') ELSE cnpj_sacado_documento END,
    local_pagamento = CASE WHEN p_campos ? 'local_pagamento' THEN nullif(btrim(p_campos->>'local_pagamento'), '') ELSE local_pagamento END,
    aceite_textual = CASE WHEN p_campos ? 'aceite_textual' THEN nullif(btrim(p_campos->>'aceite_textual'), '') ELSE aceite_textual END,
    aceite_detectado_textualmente = CASE
      WHEN NOT (p_campos ? 'aceite_textual') THEN aceite_detectado_textualmente
      WHEN nullif(btrim(p_campos->>'aceite_textual'), '') IS NULL THEN 'INDETERMINADO'
      WHEN lower(p_campos->>'aceite_textual') LIKE '%nao%'
        OR lower(p_campos->>'aceite_textual') LIKE '%não%'
        -- Exact two legacy encodings observed in R1.15, case-normalized like the input.
        OR lower(p_campos->>'aceite_textual') LIKE lower('%nÃƒÂ£o%')
        OR lower(p_campos->>'aceite_textual') LIKE lower('%nÃ£o%')
        OR btrim(lower(p_campos->>'aceite_textual')) = 'sem'
        OR lower(p_campos->>'aceite_textual') LIKE '%sem %' THEN 'NAO'
      ELSE 'SIM'
    END,
    status_validacao = 'REVISAR',
    metodo_extracao = 'MANUAL',
    resultado_confronto = p_resultado_confronto,
    validado_por = NULL,
    validado_em = NULL,
    motivo_rejeicao = NULL
  WHERE id = v_old.id RETURNING * INTO v_new;

  SELECT coalesce(p.nome_completo, p.email, 'Usuario') INTO v_actor_name FROM public.profiles p WHERE p.id = v_user_id;
  INSERT INTO public.eventos_dominio (
    tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
    tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
    ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
    origem_evento, origem_registro_id
  ) VALUES (
    v_new.fundo_id, v_new.fundo_id, v_new.cedente_id, v_new.cedente_fundo_id, v_new.nota_fiscal_id,
    'duplicata_corrigida', 'analise', v_user_id, v_actor_name, v_role,
    'app', 'Campos da duplicata foram corrigidos manualmente.',
    jsonb_build_object('duplicata_id', v_new.id, 'campos', (SELECT jsonb_agg(key) FROM jsonb_each(p_campos))),
    'ambos', 'duplicatas', v_new.id::text || ':' || extract(epoch FROM clock_timestamp())::text
  );
  RETURN v_new;
END;
$function$
$r116_definition$;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n'),
         ARRAY(SELECT a::text FROM unnest(p.proacl) a ORDER BY a::text)
    INTO v_before,v_acl FROM pg_proc p WHERE p.oid=v_oid AND pg_get_userbyid(p.proowner)='postgres';
  IF NOT FOUND OR v_acl IS DISTINCT FROM ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[] THEN
    RAISE EXCEPTION 'R1_16_DUPLICATA_SECURITY_BASELINE_MISMATCH';
  END IF;
  v_hash := encode(sha256(convert_to(v_before,'UTF8')),'hex');
  IF v_hash NOT IN ('0d5bac03b62e2dc893ab70efab928dfc03e6d81b1fd7ebb6c8893689673fb17b','a19ed236025fcac39978047edb9971037644268102e92b48a39d0a61b259bbfd') AND v_before IS DISTINCT FROM v_target THEN
    RAISE EXCEPTION 'R1_16_DUPLICATA_UNEXPECTED_DEFINITION';
  END IF;
  EXECUTE v_target;
  IF replace(pg_get_functiondef(v_oid),E'\r\n',E'\n') IS DISTINCT FROM v_target
     OR (SELECT ARRAY(SELECT a::text FROM unnest(p.proacl) a ORDER BY a::text) FROM pg_proc p WHERE p.oid=v_oid) IS DISTINCT FROM v_acl
     OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=v_oid) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'R1_16_DUPLICATA_POSTCONDITION_FAILED';
  END IF;
END;
$r116$;
COMMIT;
