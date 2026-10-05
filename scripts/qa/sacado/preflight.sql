-- Read-only preflight: no authorization is created by this inventory.
-- Candidate funds are evidence for review, not an authorization decision.
begin read only;
set local statement_timeout = '20s';
set local search_path = '';

with legacy as (
  select s.id, s.user_id, regexp_replace(s.cnpj, '\D', '', 'g') cnpj,
         p.role::text profile_role, p.status::text profile_status
  from public.sacados s
  left join public.profiles p on p.id = s.user_id
  where s.user_id is not null
), evidence as (
  select l.id, nf.fundo_id, 'NF' source
  from legacy l
  join public.notas_fiscais nf
    on regexp_replace(nf.cnpj_destinatario, '\D', '', 'g') = l.cnpj
  where nf.fundo_id is not null
  union
  select l.id, cf.fundo_id, 'OPERACAO'
  from legacy l
  join public.notas_fiscais nf
    on regexp_replace(nf.cnpj_destinatario, '\D', '', 'g') = l.cnpj
  join public.operacoes_nfs onf on onf.nota_fiscal_id = nf.id
  join public.operacoes op on op.id = onf.operacao_id
  join public.cedente_fundos cf on cf.id = op.cedente_fundo_id
  union
  -- Cadastro is only secondary evidence; never expand to every fund automatically.
  select l.id, cf.fundo_id, 'CADASTRO_CEDENTE'
  from legacy l
  join public.cedentes c on regexp_replace(c.sacado_cnpj, '\D', '', 'g') = l.cnpj
  join public.cedente_fundos cf on cf.cedente_id = c.id
), candidates as (
  select l.id, l.cnpj, l.profile_role, l.profile_status,
         count(distinct e.fundo_id) fund_count,
         coalesce(jsonb_agg(distinct jsonb_build_object(
           'fundo_id', e.fundo_id, 'source', e.source
         )) filter (where e.fundo_id is not null), '[]'::jsonb) evidence
  from legacy l left join evidence e on e.id = l.id
  group by l.id, l.cnpj, l.profile_role, l.profile_status
)
select jsonb_build_object(
  'legacy_rows', (select count(*) from legacy),
  'unlinked_companies', (select count(*) from public.sacados where user_id is null),
  'missing_profile', (select count(*) from legacy where profile_role is null),
  'invalid_cnpj_length', (select count(*) from legacy where length(cnpj) <> 14),
  'normalized_duplicates', (select count(*) from (
    select regexp_replace(cnpj, '\D', '', 'g')
    from public.sacados group by 1 having count(*) > 1
  ) d),
  'requires_explicit_fund_review', (select count(*) from candidates where fund_count <> 1),
  'candidates', (select coalesce(jsonb_agg(to_jsonb(c) order by c.cnpj), '[]'::jsonb) from candidates c),
  'original_a6_history_count', (select count(*) from supabase_migrations.schema_migrations where version = '20260929193129'),
  'migration_count', (select count(*) from supabase_migrations.schema_migrations)
) preflight;

commit;
