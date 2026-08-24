-- P1 Claude (fix): torna o backfill de token_hash legado seguro para
-- reaplicacao. A migration 20260824180000_p1_super_admin_integracao_transportadora.sql
-- (JA aplicada em homolog -- por isso esta e uma NOVA migration
-- corretiva, nao uma edicao no lugar) faz backfill de
-- integracoes_transportadoras.token_hash para integracoes_transportadoras_tokens
-- e depois remove a coluna antiga, dentro do MESMO arquivo. Isso e seguro
-- na primeira aplicacao (coluna existe), mas reaplicar o arquivo inteiro
-- depois falha com 42703 (column "token_hash" does not exist) -- a coluna
-- origem ja foi removida pela primeira aplicacao.
--
-- Sem efeito pratico em dados: nenhuma integracao de transportadora real
-- foi criada antes desta correcao (confirmado por auditoria SQL em
-- homolog), entao o backfill sempre teve 0 linhas. O problema e
-- exclusivamente de robustez da migration para reaplicacao total do
-- arquivo (tecnica de verificacao de idempotencia usada em todas as
-- migrations deste dominio nesta sessao) -- nunca acontece organicamente
-- (o Supabase rastreia migrations aplicadas e nunca reaplica uma sozinha).
--
-- Correcao: o backfill+drop so executa se a coluna token_hash ainda
-- existir em integracoes_transportadoras -- idempotente tanto para uma
-- reaplicacao (coluna ja removida -> no-op) quanto para uma implantacao
-- do zero (coluna existe -> comportamento original preservado).

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'integracoes_transportadoras'
      AND column_name = 'token_hash'
  ) THEN
    EXECUTE $sql$
      INSERT INTO public.integracoes_transportadoras_tokens (integracao_id, token_hash, status, criado_por, criado_em)
      SELECT id, token_hash, CASE WHEN ativo THEN 'ativo' ELSE 'revogado' END, created_by, created_at
      FROM public.integracoes_transportadoras
      WHERE token_hash IS NOT NULL
      ON CONFLICT (token_hash) DO NOTHING
    $sql$;

    EXECUTE 'ALTER TABLE public.integracoes_transportadoras DROP CONSTRAINT IF EXISTS integracoes_transportadoras_token_hash_unique';
    EXECUTE 'ALTER TABLE public.integracoes_transportadoras DROP COLUMN IF EXISTS token_hash';
  END IF;
END;
$$;

COMMIT;
