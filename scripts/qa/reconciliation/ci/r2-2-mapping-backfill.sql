-- Explicit one-time data migration, not a general authorization exception.
-- TODO: retained only as immutable migration evidence after the homolog rollout.
DO $r22_mapping$
DECLARE
  approved constant jsonb := '__APPROVED_MAPPING__'::jsonb;
  main_fund constant uuid := 'ca8b721e-333c-4051-a87b-9359e51449c4';
  adversarial_fund constant uuid := '0d81663a-e91d-8e2d-5e26-710ebb177e12';
  a record; p public.profiles%ROWTYPE; s public.sacados%ROWTYPE;
  n integer; v_before jsonb;
BEGIN
  -- Prevent concurrent changes to the evidence or authorization during this transition.
  LOCK TABLE public.fundos,public.profiles,public.sacados,public.usuario_papeis,public.usuario_fundos,
    public.cedentes,public.cedente_acessos,public.cedente_fundos,public.notas_fiscais,
    public.operacoes,public.operacoes_nfs IN SHARE ROW EXCLUSIVE MODE;
  IF jsonb_array_length(approved)<>8 OR (SELECT count(*) FROM public.sacados)<>8 THEN
    RAISE EXCEPTION 'R22_UNEXPECTED_LEGACY_SET';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.fundos WHERE id=main_fund AND ativo AND cnpj='84810000000147')
    OR NOT EXISTS(SELECT 1 FROM public.fundos WHERE id=adversarial_fund AND ativo AND cnpj='84810000000228') THEN
    RAISE EXCEPTION 'R22_FUND_IDENTITY_MISMATCH';
  END IF;
  IF EXISTS(SELECT 1 FROM public.sacado_acessos) THEN RAISE EXCEPTION 'R22_ACCESS_SET_NOT_EMPTY'; END IF;
  FOR a IN SELECT * FROM jsonb_to_recordset(approved)
    AS x(id uuid,sacado uuid,cnpj text,email text,name text,"mainNotes" integer,"adversarialNotes" integer)
  LOOP
    SELECT * INTO STRICT p FROM public.profiles WHERE id=a.id;
    SELECT * INTO STRICT s FROM public.sacados WHERE id=a.sacado;
    IF p.role::text<>'cedente' OR p.status::text<>'ativo' OR p.email IS DISTINCT FROM a.email
      OR s.user_id IS DISTINCT FROM a.id OR s.cnpj IS DISTINCT FROM a.cnpj
      OR s.razao_social IS DISTINCT FROM a.name THEN
      RAISE EXCEPTION 'R22_APPROVED_IDENTITY_MISMATCH';
    END IF;
    IF (SELECT count(*) FROM auth.users WHERE id=a.id AND email=a.email)<>1 THEN
      RAISE EXCEPTION 'R22_AUTH_IDENTITY_MISMATCH';
    END IF;
    IF EXISTS(SELECT 1 FROM public.cedentes WHERE user_id=a.id)
      OR EXISTS(SELECT 1 FROM public.cedente_acessos WHERE user_id=a.id)
      OR EXISTS(SELECT 1 FROM public.usuario_fundos WHERE usuario_id=a.id)
      OR (SELECT count(*) FROM public.usuario_papeis WHERE usuario_id=a.id)<>1
      OR NOT EXISTS(SELECT 1 FROM public.usuario_papeis WHERE usuario_id=a.id
        AND papel::text='cedente' AND ativo AND origem='perfil_primario') THEN
      RAISE EXCEPTION 'R22_UNEXPECTED_EXISTING_AUTHORIZATION';
    END IF;
    IF (SELECT count(*) FROM public.notas_fiscais WHERE cnpj_destinatario=a.cnpj AND fundo_id=main_fund)<>a."mainNotes"
      OR (SELECT count(*) FROM public.notas_fiscais WHERE cnpj_destinatario=a.cnpj AND fundo_id=adversarial_fund)<>a."adversarialNotes"
      OR EXISTS(SELECT 1 FROM public.notas_fiscais WHERE regexp_replace(cnpj_destinatario,'\D','','g')=a.cnpj
        AND (cnpj_destinatario<>a.cnpj OR fundo_id IS NULL OR fundo_id NOT IN(main_fund,adversarial_fund)))
      OR EXISTS(SELECT 1 FROM public.notas_fiscais nf JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id=nf.id
        JOIN public.operacoes op ON op.id=onf.operacao_id JOIN public.cedente_fundos cf ON cf.id=op.cedente_fundo_id
        WHERE nf.cnpj_destinatario=a.cnpj AND cf.fundo_id<>main_fund)
      OR EXISTS(SELECT 1 FROM public.cedentes c JOIN public.cedente_fundos cf ON cf.cedente_id=c.id
        WHERE regexp_replace(c.sacado_cnpj,'\D','','g')=a.cnpj) THEN
      RAISE EXCEPTION 'R22_FISCAL_BASELINE_MISMATCH';
    END IF;
  END LOOP;
  -- All identities and evidence are checked before the first role change.
  FOR a IN SELECT * FROM jsonb_to_recordset(approved) AS x(id uuid,sacado uuid,cnpj text)
  LOOP
    SELECT jsonb_build_object('role',role,'status',status) INTO v_before FROM public.profiles WHERE id=a.id;
    UPDATE public.profiles SET role='sacado' WHERE id=a.id AND role::text='cedente';
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>1 OR NOT EXISTS(SELECT 1 FROM public.usuario_papeis WHERE usuario_id=a.id AND papel::text='sacado' AND ativo)
      OR EXISTS(SELECT 1 FROM public.usuario_papeis WHERE usuario_id=a.id AND papel::text='cedente' AND ativo) THEN
      RAISE EXCEPTION 'R22_CANONICAL_ROLE_SYNC_FAILED';
    END IF;
    INSERT INTO public.sacado_acessos(user_id,sacado_id,fundo_id) VALUES(a.id,a.sacado,main_fund);
    INSERT INTO public.logs_auditoria(ator_tipo,ator_identificador,origem,tipo_evento,entidade_tipo,entidade_id,dados_antes,dados_depois)
    VALUES('sistema','R2.2_APPROVED_QA_MAPPING','migration','SACADO_QA_VINCULO_RECONCILIADO','sacado',a.sacado,
      jsonb_build_object('profile',v_before,'user_id',a.id,'legacy_user_id_preserved',true),
      jsonb_build_object('role','sacado','user_id',a.id,'fundo_id',main_fund,'adversarial_access',false));
  END LOOP;
  IF (SELECT count(*) FROM public.sacado_acessos)<>8
    OR EXISTS(SELECT 1 FROM public.sacado_acessos WHERE fundo_id<>main_fund OR status<>'ativo') THEN
    RAISE EXCEPTION 'R22_ACCESS_POSTCONDITION_FAILED';
  END IF;
END;
$r22_mapping$;
