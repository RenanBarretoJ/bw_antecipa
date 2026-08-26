-- P4 - remessas operacionais genericas por adapter.
-- A tabela remessas_cnab permanece como trilha historica do adapter legado.

CREATE TABLE public.remessas_operacionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  integracao_fundo_versao_id uuid NOT NULL REFERENCES public.integracao_fundo_versoes(id) ON DELETE RESTRICT,
  adapter_key text NOT NULL,
  estrategia_agrupamento text NOT NULL,
  status text NOT NULL DEFAULT 'gerada',
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  excel_bucket text,
  excel_storage_path text,
  excel_sha256 text,
  gerado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  gerado_em timestamptz NOT NULL DEFAULT now(),
  enviado_em timestamptz,
  erro_tecnico text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remessas_operacionais_adapter_key_check
    CHECK (adapter_key ~ '^[a-z0-9_]+$'),
  CONSTRAINT remessas_operacionais_agrupamento_check
    CHECK (estrategia_agrupamento IN ('POR_LOTE', 'POR_CEDENTE')),
  CONSTRAINT remessas_operacionais_status_check
    CHECK (status IN ('gerada', 'validada', 'enviando', 'enviada', 'parcial', 'erro', 'cancelada')),
  CONSTRAINT remessas_operacionais_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT remessas_operacionais_excel_path_unique UNIQUE NULLS NOT DISTINCT (excel_bucket, excel_storage_path),
  CONSTRAINT remessas_operacionais_excel_integridade_check CHECK (
    (excel_bucket IS NULL AND excel_storage_path IS NULL AND excel_sha256 IS NULL)
    OR
    (excel_bucket IS NOT NULL AND excel_storage_path IS NOT NULL AND excel_sha256 ~ '^[0-9a-f]{64}$')
  )
);

CREATE TABLE public.remessa_operacional_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remessa_operacional_id uuid NOT NULL REFERENCES public.remessas_operacionais(id) ON DELETE CASCADE,
  cedente_id uuid REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  remessa_cnab_id uuid REFERENCES public.remessas_cnab(id) ON DELETE RESTRICT,
  formato text NOT NULL,
  nome_arquivo text NOT NULL,
  bucket text NOT NULL,
  storage_path text NOT NULL,
  sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'gerada',
  idempotency_key text NOT NULL,
  id_externo text,
  erro_tecnico text,
  enviado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remessa_operacional_arquivos_formato_check
    CHECK (formato IN ('CNAB444', 'VRS_CSV')),
  CONSTRAINT remessa_operacional_arquivos_status_check
    CHECK (status IN ('gerada', 'validada', 'enviando', 'enviada', 'erro', 'cancelada')),
  CONSTRAINT remessa_operacional_arquivos_sha256_check
    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT remessa_operacional_arquivos_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT remessa_operacional_arquivos_storage_unique UNIQUE (bucket, storage_path)
);

CREATE TABLE public.remessa_operacional_operacoes (
  remessa_operacional_id uuid NOT NULL REFERENCES public.remessas_operacionais(id) ON DELETE CASCADE,
  operacao_id uuid NOT NULL REFERENCES public.operacoes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (remessa_operacional_id, operacao_id)
);

CREATE TABLE public.remessa_operacional_chaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remessa_operacional_arquivo_id uuid NOT NULL REFERENCES public.remessa_operacional_arquivos(id) ON DELETE CASCADE,
  operacao_id uuid NOT NULL REFERENCES public.operacoes(id) ON DELETE RESTRICT,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  parcela_id uuid REFERENCES public.nota_fiscal_parcelas(id) ON DELETE RESTRICT,
  chave_unica_ativo text NOT NULL,
  chave_unica_parcela text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remessa_operacional_chaves_ativo_check
    CHECK (chave_unica_ativo ~ '^[A-Za-z0-9._-]{1,100}$'),
  CONSTRAINT remessa_operacional_chaves_parcela_check
    CHECK (chave_unica_parcela IS NULL OR chave_unica_parcela ~ '^[A-Za-z0-9._-]{1,100}$'),
  CONSTRAINT remessa_operacional_chaves_parcela_coerente_check
    CHECK ((parcela_id IS NULL) = (chave_unica_parcela IS NULL)),
  CONSTRAINT remessa_operacional_chaves_identidade_unique
    UNIQUE NULLS NOT DISTINCT (remessa_operacional_arquivo_id, operacao_id, nota_fiscal_id, parcela_id)
);

CREATE INDEX remessas_operacionais_fundo_created_idx
  ON public.remessas_operacionais (fundo_id, created_at DESC);
CREATE INDEX remessas_operacionais_integracao_versao_idx
  ON public.remessas_operacionais (integracao_fundo_versao_id);
CREATE INDEX remessa_operacional_arquivos_remessa_idx
  ON public.remessa_operacional_arquivos (remessa_operacional_id, created_at);
CREATE INDEX remessa_operacional_arquivos_cedente_idx
  ON public.remessa_operacional_arquivos (cedente_id) WHERE cedente_id IS NOT NULL;
CREATE INDEX remessa_operacional_arquivos_cnab_idx
  ON public.remessa_operacional_arquivos (remessa_cnab_id) WHERE remessa_cnab_id IS NOT NULL;
CREATE INDEX remessa_operacional_operacoes_operacao_idx
  ON public.remessa_operacional_operacoes (operacao_id, created_at DESC);
CREATE INDEX remessa_operacional_chaves_arquivo_idx
  ON public.remessa_operacional_chaves (remessa_operacional_arquivo_id);
CREATE INDEX remessa_operacional_chaves_operacao_idx
  ON public.remessa_operacional_chaves (operacao_id);
CREATE INDEX remessa_operacional_chaves_nf_idx
  ON public.remessa_operacional_chaves (nota_fiscal_id);
CREATE INDEX remessa_operacional_chaves_parcela_idx
  ON public.remessa_operacional_chaves (parcela_id) WHERE parcela_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.remessas_operacionais_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER remessas_operacionais_updated_at
BEFORE UPDATE ON public.remessas_operacionais
FOR EACH ROW EXECUTE FUNCTION private.remessas_operacionais_set_updated_at();

CREATE TRIGGER remessa_operacional_arquivos_updated_at
BEFORE UPDATE ON public.remessa_operacional_arquivos
FOR EACH ROW EXECUTE FUNCTION private.remessas_operacionais_set_updated_at();

ALTER TABLE public.remessas_operacionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remessa_operacional_arquivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remessa_operacional_operacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remessa_operacional_chaves ENABLE ROW LEVEL SECURITY;

CREATE POLICY remessas_operacionais_select_fundo
ON public.remessas_operacionais FOR SELECT TO authenticated
USING ((SELECT private.usuario_tem_acesso_fundo(fundo_id)));

CREATE POLICY remessa_operacional_arquivos_select_fundo
ON public.remessa_operacional_arquivos FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.remessas_operacionais r
  WHERE r.id = remessa_operacional_id
    AND (SELECT private.usuario_tem_acesso_fundo(r.fundo_id))
));

CREATE POLICY remessa_operacional_operacoes_select_fundo
ON public.remessa_operacional_operacoes FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.remessas_operacionais r
  WHERE r.id = remessa_operacional_id
    AND (SELECT private.usuario_tem_acesso_fundo(r.fundo_id))
));

CREATE POLICY remessa_operacional_chaves_select_fundo
ON public.remessa_operacional_chaves FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.remessa_operacional_arquivos a
  JOIN public.remessas_operacionais r ON r.id = a.remessa_operacional_id
  WHERE a.id = remessa_operacional_arquivo_id
    AND (SELECT private.usuario_tem_acesso_fundo(r.fundo_id))
));

REVOKE ALL ON TABLE public.remessas_operacionais FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.remessa_operacional_arquivos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.remessa_operacional_operacoes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.remessa_operacional_chaves FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.remessas_operacionais TO authenticated;
GRANT SELECT ON TABLE public.remessa_operacional_arquivos TO authenticated;
GRANT SELECT ON TABLE public.remessa_operacional_operacoes TO authenticated;
GRANT SELECT ON TABLE public.remessa_operacional_chaves TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.remessas_operacionais TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.remessa_operacional_arquivos TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.remessa_operacional_operacoes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.remessa_operacional_chaves TO service_role;

COMMENT ON TABLE public.remessas_operacionais IS
  'Agregado generico de geracao de remessa, independente do formato e do provider.';
COMMENT ON TABLE public.remessa_operacional_arquivos IS
  'Sub-remessas produzidas conforme a estrategia de agrupamento declarada pelo adapter.';
COMMENT ON TABLE public.remessa_operacional_chaves IS
  'Chaves estaveis de ATIVO e FLUXO usadas em reprocessamentos da mesma cessao.';
