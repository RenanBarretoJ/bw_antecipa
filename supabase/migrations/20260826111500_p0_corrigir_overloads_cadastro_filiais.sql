-- P0 - corrige overload duplicado deixado pela migration anterior.
--
-- CREATE OR REPLACE FUNCTION so substitui uma funcao existente quando a
-- lista de TIPOS de parametro e identica; ao acrescentar parametros no
-- final (mesmo com DEFAULT) o Postgres identifica uma assinatura diferente
-- e CRIA uma segunda funcao (overload) em vez de substituir a original.
-- 20260826110000_p0_cadastro_cnpj_cep_bancos_filiais.sql deixou
-- cadastrar_filial_cedente(3 args) e salvar_conta_estabelecimento_cedente(6
-- args) vivos ao lado das versoes estendidas -- risco real de "function is
-- not unique" no PostgREST quando uma chamada nomeada casa com as duas
-- assinaturas via DEFAULT. As versoes estendidas sao supersets compativeis
-- (todos os parametros novos tem DEFAULT NULL), entao e seguro remover
-- apenas as assinaturas antigas.

BEGIN;

DROP FUNCTION IF EXISTS public.cadastrar_filial_cedente(text, text, text);
DROP FUNCTION IF EXISTS public.salvar_conta_estabelecimento_cedente(uuid, text, text, text, text, boolean);

NOTIFY pgrst, 'reload schema';

COMMIT;
