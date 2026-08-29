BEGIN;

REVOKE ALL ON FUNCTION public.cadastrar_filial_cedente(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cadastrar_filial_cedente(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.salvar_conta_estabelecimento_cedente(uuid,text,text,text,text,boolean,text,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_conta_estabelecimento_cedente(uuid,text,text,text,text,boolean,text,text,text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.registrar_documento_estabelecimento_upload(uuid,uuid,uuid,text,text,bigint,text,text,text,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_documento_estabelecimento_upload(uuid,uuid,uuid,text,text,bigint,text,text,text,uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.registrar_documento_cadastral_cedente(public.documento_tipo,text,text,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_documento_cadastral_cedente(public.documento_tipo,text,text,uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.solicitar_alteracao_cadastral_cedente(jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_alteracao_cadastral_cedente(jsonb,jsonb,jsonb,jsonb)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.registrar_documento_logistico_antecipado(uuid[],uuid,text,text,text,bigint,text,text,text,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_documento_logistico_antecipado(uuid[],uuid,text,text,text,bigint,text,text,text,jsonb)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
