BEGIN;

ALTER TABLE private.vortx_callback_endpoints
 ADD COLUMN cadastro_confirmado_em timestamptz,
 ADD COLUMN cadastro_confirmado_por uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;
CREATE INDEX vortx_callback_confirmador_idx ON private.vortx_callback_endpoints(cadastro_confirmado_por) WHERE cadastro_confirmado_por IS NOT NULL;

-- Shared persistence primitive. Never callable by clients; both entry points authorize first.
CREATE FUNCTION private.vortx_callback_configurar_base(p_fundo_id uuid,p_versao_id uuid,p_segredo_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v public.integracao_fundo_versoes%ROWTYPE; carteira text; e private.vortx_callback_endpoints%ROWTYPE;
BEGIN
 IF p_segredo_hash IS NULL OR p_segredo_hash !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Segredo de callback invalido';
 END IF;
 SELECT iv.* INTO v FROM public.integracao_fundo_versoes iv
 JOIN public.integracoes_fundo i ON i.id=iv.integracao_fundo_id
 JOIN public.fundos f ON f.id=i.fundo_id AND f.ativo
 WHERE iv.id=p_versao_id AND i.fundo_id=p_fundo_id AND i.status='ativa'
  AND i.provider_key='VORTX' AND iv.status='publicada' AND iv.adapter_key='vortx_vrs';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Integracao Vortx indisponivel'; END IF;
 carteira:=trim(v.configuracao_nao_sensivel->>'codigo_carteira');
 IF carteira IS NULL OR carteira !~ '^[A-Za-z0-9._-]{1,100}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Carteira Vortx invalida';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vortx-callback-carteira:'||carteira,0));
 INSERT INTO private.vortx_callback_endpoints(fundo_id,integracao_id,ambiente,codigo_carteira,segredo_hash)
 VALUES(p_fundo_id,v.integracao_fundo_id,v.ambiente,carteira,p_segredo_hash)
 ON CONFLICT(codigo_carteira) DO UPDATE SET segredo_hash=excluded.segredo_hash,
  revisao=private.vortx_callback_endpoints.revisao+1,ativo=true,revogada_em=NULL,rotacionada_em=clock_timestamp(),
  cadastro_confirmado_em=NULL,cadastro_confirmado_por=NULL
 WHERE private.vortx_callback_endpoints.fundo_id=excluded.fundo_id
  AND private.vortx_callback_endpoints.ambiente=excluded.ambiente
  AND private.vortx_callback_endpoints.integracao_id=excluded.integracao_id
 RETURNING * INTO e;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Carteira ja vinculada a outro contexto de callback'; END IF;
 INSERT INTO public.seguranca_eventos(tipo_evento,ator_tipo,origem,severidade,entidade_tipo,entidade_id,dados)
 VALUES('VORTX_CALLBACK_CONFIGURADO','sistema','vortx_callback','info','vortx_callback_endpoints',e.id,
  jsonb_build_object('fundo_id',e.fundo_id,'ambiente',e.ambiente,'revisao',e.revisao));
 RETURN jsonb_build_object('id',e.id,'revisao',e.revisao);
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_callback_configurar_base(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the worker contract, centralizing wallet locking/rotation with the operator path.
CREATE OR REPLACE FUNCTION public.vortx_configurar_callback(p_fundo_id uuid,p_versao_id uuid,p_segredo_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 RETURN private.vortx_callback_configurar_base(p_fundo_id,p_versao_id,p_segredo_hash);
END;
$$;
REVOKE ALL ON FUNCTION public.vortx_configurar_callback(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.vortx_configurar_callback(uuid,uuid,text) TO service_role;

-- Definer required only to expose a minimal DTO from the private registry, never the secret hash.
CREATE FUNCTION public.admin_vortx_callback_status(p_fundo_id uuid,p_versao_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.integracao_fundo_versoes%ROWTYPE; e private.vortx_callback_endpoints%ROWTYPE; ultimo timestamptz;
BEGIN
 IF private.vortx_relatorio_pode_acessar(p_fundo_id) IS NOT TRUE THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Super Admin com vinculo e MFA recente exigidos';
 END IF;
 SELECT iv.* INTO v FROM public.integracao_fundo_versoes iv JOIN public.integracoes_fundo i ON i.id=iv.integracao_fundo_id
 WHERE iv.id=p_versao_id AND i.fundo_id=p_fundo_id AND i.provider_key='VORTX' AND i.status='ativa'
  AND iv.status='publicada' AND iv.adapter_key='vortx_vrs';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Publique a integracao Vortx deste Fundo'; END IF;
 SELECT * INTO e FROM private.vortx_callback_endpoints WHERE fundo_id=p_fundo_id AND integracao_id=v.integracao_fundo_id
  AND ambiente=v.ambiente AND codigo_carteira=trim(v.configuracao_nao_sensivel->>'codigo_carteira');
 IF NOT FOUND THEN RETURN jsonb_build_object('id',NULL,'revisao',0,'ativo',false,'carteira',trim(v.configuracao_nao_sensivel->>'codigo_carteira'),
  'ambiente',v.ambiente,'geradaEm',NULL,'cadastroInformadoEm',NULL,'ultimoEventoEm',NULL); END IF;
 SELECT max(recebido_em) INTO ultimo FROM public.vortx_relatorio_eventos WHERE endpoint_id=e.id AND recebido_em>=e.rotacionada_em;
 RETURN jsonb_build_object('id',e.id,'revisao',e.revisao,'ativo',e.ativo,'carteira',e.codigo_carteira,'ambiente',e.ambiente,
  'geradaEm',e.rotacionada_em,'cadastroInformadoEm',e.cadastro_confirmado_em,'ultimoEventoEm',ultimo);
END;
$$;

CREATE FUNCTION public.admin_vortx_callback_mutar(p_fundo_id uuid,p_versao_id uuid,p_acao text,
 p_revisao_esperada integer,p_segredo_hash text,p_nonce_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.integracao_fundo_versoes%ROWTYPE; e private.vortx_callback_endpoints%ROWTYPE; carteira text;
BEGIN
 IF private.vortx_relatorio_pode_acessar(p_fundo_id) IS NOT TRUE THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Super Admin com vinculo e MFA recente exigidos';
 END IF;
 IF p_acao IS NULL OR p_acao NOT IN ('gerar','rotacionar','revogar','informar_cadastro')
  OR p_revisao_esperada IS NULL OR p_revisao_esperada<0
  OR (p_acao IN ('gerar','rotacionar') AND (p_segredo_hash IS NULL OR p_segredo_hash !~ '^[0-9a-f]{64}$'))
  OR (p_acao IN ('revogar','informar_cadastro') AND p_segredo_hash IS NOT NULL) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Parametros de callback invalidos';
 END IF;
 SELECT iv.* INTO v FROM public.integracao_fundo_versoes iv JOIN public.integracoes_fundo i ON i.id=iv.integracao_fundo_id
 WHERE iv.id=p_versao_id AND i.fundo_id=p_fundo_id AND i.provider_key='VORTX' AND i.status='ativa'
  AND iv.status='publicada' AND iv.adapter_key='vortx_vrs';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Publique a integracao Vortx deste Fundo'; END IF;
 carteira:=trim(v.configuracao_nao_sensivel->>'codigo_carteira');
 IF carteira IS NULL OR carteira !~ '^[A-Za-z0-9._-]{1,100}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Carteira Vortx invalida';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vortx-callback-carteira:'||carteira,0));
 SELECT * INTO e FROM private.vortx_callback_endpoints WHERE codigo_carteira=carteira FOR UPDATE;
 IF FOUND AND (e.fundo_id<>p_fundo_id OR e.integracao_id<>v.integracao_fundo_id OR e.ambiente<>v.ambiente) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Carteira vinculada a outro contexto';
 END IF;
 IF coalesce(e.revisao,0)<>p_revisao_esperada THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Configuracao alterada; atualize antes de continuar';
 END IF;
 IF (p_acao='gerar' AND coalesce(e.ativo,false)) OR (p_acao<>'gerar' AND NOT coalesce(e.ativo,false)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Acao nao permitida no estado atual';
 END IF;
 -- Reuse the canonical VRS credential-sensitive action, consuming its nonce with this mutation.
 IF public.consumir_autorizacao_acao_sensivel('configurar_credencial_vortx_vrs',p_nonce_hash) IS NOT TRUE THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Confirmacao TOTP expirada ou reutilizada';
 END IF;
 IF p_acao IN ('gerar','rotacionar') THEN
  PERFORM private.vortx_callback_configurar_base(p_fundo_id,p_versao_id,p_segredo_hash);
 ELSIF p_acao='revogar' THEN
  UPDATE private.vortx_callback_endpoints SET ativo=false,revisao=revisao+1,revogada_em=clock_timestamp() WHERE id=e.id;
 ELSE
  UPDATE private.vortx_callback_endpoints SET cadastro_confirmado_em=clock_timestamp(),cadastro_confirmado_por=auth.uid(),
   revisao=revisao+1 WHERE id=e.id;
 END IF;
 INSERT INTO public.seguranca_eventos(tipo_evento,ator_usuario_id,ator_tipo,origem,severidade,dados)
 SELECT tipo,auth.uid(),'usuario','vortx_callback_admin','info',jsonb_build_object('fundo_id',p_fundo_id,'ambiente',v.ambiente,
  'acao',p_acao,'action_type','configurar_credencial_vortx_vrs','session_id',auth.jwt()->>'session_id')
 FROM unnest(ARRAY['MFA_ACAO_SENSIVEL_VALIDADA','AUTORIZACAO_SENSIVEL_CONSUMIDA','VORTX_CALLBACK_ADMIN_ALTERADO']) tipo;
 RETURN public.admin_vortx_callback_status(p_fundo_id,p_versao_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_vortx_callback_status(uuid,uuid),public.admin_vortx_callback_mutar(uuid,uuid,text,integer,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_vortx_callback_status(uuid,uuid),public.admin_vortx_callback_mutar(uuid,uuid,text,integer,text,text) TO authenticated;
COMMENT ON FUNCTION public.admin_vortx_callback_mutar(uuid,uuid,text,integer,text,text) IS 'Administracao autenticada de callback VRS: MFA, nonce transacional, Fundo, carteira e revisao esperada. Sem service_role, URL persistida ou importacao.';
COMMIT;
