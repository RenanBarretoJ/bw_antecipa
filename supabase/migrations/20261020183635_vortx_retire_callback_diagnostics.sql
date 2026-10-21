-- Retire diagnostic writes only. No business-event mutation, grant expansion or guard change.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
REVOKE ALL ON FUNCTION
 public.vortx_reservar_captura_callback(uuid,uuid,uuid),
 public.vortx_concluir_captura_callback(uuid,text,text,text,integer,boolean,integer),
 public.vortx_registrar_callback_rejeitado(uuid,text,integer,text,integer,text,text,text,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public.vortx_reservar_captura_callback(uuid,uuid,uuid) IS
 'Retired diagnostic entrypoint. No API role may reserve raw callback captures.';
COMMENT ON FUNCTION public.vortx_concluir_captura_callback(uuid,text,text,text,integer,boolean,integer) IS
 'Retired diagnostic entrypoint. No API role may retain raw callback requests.';
COMMENT ON FUNCTION public.vortx_registrar_callback_rejeitado(uuid,text,integer,text,integer,text,text,text,timestamptz) IS
 'Retired diagnostic entrypoint. No API role may retain rejected callback JSON.';
COMMIT;
