-- Incremental municipal NFS-e identity. No historical row, approval or snapshot rewrite.
-- The national DANFSe branch retains its original key and provenance requirements.
begin;
set local lock_timeout = '5s';

alter table public.notas_fiscais drop constraint nfse_fatos_check;
alter table public.notas_fiscais add constraint nfse_fatos_check
check (tipo_documento_fiscal is distinct from 'NFSE' or (
  valor_liquido_origem is not null
  and ((valor_liquido_origem = 'DOCUMENTO_EXPLICITO' and valor_liquido is not null
    and valor_liquido > 0 and valor_liquido <= valor_bruto)
    or (valor_liquido_origem = 'NAO_INFORMADO' and valor_liquido is null))
  and vencimento_origem is not null and data_vencimento >= data_emissao
  and fiscal_proveniencia is not null and jsonb_typeof(fiscal_proveniencia) = 'object'
  and fiscal_proveniencia ?& array['strategy', 'source', 'competencia', 'sha256', 'vencimento_documento']
  and fiscal_proveniencia->>'sha256' ~ '^[0-9a-f]{64}$'
  and (
    (fiscal_proveniencia->>'strategy' in ('danfse_v2_labels', 'danfse_v2_visual')
      and fiscal_proveniencia->>'source' in ('PDF_TEXT_NATIVE', 'PDF_VISUAL_FALLBACK')
      and chave_acesso is not null and chave_acesso ~ '^[0-9]{50}$'
      and chave_acesso !~ '^([0-9])\1{49}$')
    or
    (fiscal_proveniencia->>'strategy' = 'nfse_municipal_visual'
      and fiscal_proveniencia->>'source' = 'PDF_VISUAL_FALLBACK'
      and chave_acesso is null
      and numero_nf ~ '^[1-9][0-9]{0,14}$'
      and cnpj_emitente ~ '^[0-9]{14}$'
      and cnpj_destinatario ~ '^[0-9]{14}$'
      and valor_bruto > 0
      and fiscal_proveniencia ?& array['orgao_emissor', 'codigo_verificacao']
      and jsonb_typeof(fiscal_proveniencia->'orgao_emissor') = 'string'
      and fiscal_proveniencia->>'orgao_emissor' ~ '^(PREFEITURA|MUNICIPIO|SECRETARIA)'
      and length(fiscal_proveniencia->>'orgao_emissor') between 8 and 200
      and fiscal_proveniencia->>'orgao_emissor' = upper(btrim(regexp_replace(fiscal_proveniencia->>'orgao_emissor', '\s+', ' ', 'g')))
      and fiscal_proveniencia->>'orgao_emissor' !~ '[^A-Z0-9 /().,''-]'
      and jsonb_typeof(fiscal_proveniencia->'codigo_verificacao') = 'string'
      and fiscal_proveniencia->>'codigo_verificacao' ~ '^[A-Za-z0-9][A-Za-z0-9./-]{3,79}$')
  )
) is true) not valid;
alter table public.notas_fiscais validate constraint nfse_fatos_check;

-- Verification code is deliberately not in the uniqueness key: a changed code
-- cannot turn the same issuer/authority/number into a second invoice.
create unique index nfse_municipal_identity_unique on public.notas_fiscais
  (cnpj_emitente, (fiscal_proveniencia->>'orgao_emissor'), numero_nf)
  where tipo_documento_fiscal = 'NFSE'
    and fiscal_proveniencia->>'strategy' = 'nfse_municipal_visual';

-- Existing immutable-facts trigger also protects the municipal identity in provenance.
-- No grants, policies, access scope or SECURITY DEFINER functions are changed.
commit;
