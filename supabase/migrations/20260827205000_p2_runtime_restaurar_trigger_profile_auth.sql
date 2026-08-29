-- P2 runtime rehearsal: public.handle_new_user() foi endurecida no SA0, mas a
-- cadeia canônica não recriou o trigger de auth.users. Convites geravam a
-- identidade Auth sem o profile exigido pelas RPCs de provisionamento.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

COMMENT ON TRIGGER on_auth_user_created ON auth.users IS
  'Cria o profile primario seguro para novos usuarios Auth; super_admin nunca nasce de metadata.';
