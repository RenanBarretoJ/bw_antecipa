-- R1.16 FWD-01: exact R1.15 approved list; no CRUD/function/sequence grants changed.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public, private;
DO $r116$
DECLARE
  r record;
  v_before text[];
  v_after text[];
  v_rel regclass;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.aquisicoes_atuais', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=r/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=r/postgres']::text[]),
    ('public.autorizacoes_acoes_sensiveis', 'service_role', ARRAY['postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[]),
    ('public.canhotos', 'authenticated', ARRAY['authenticated=arwDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=arw/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.carteira_atual', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=r/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=r/postgres']::text[]),
    ('public.cedente_acessos', 'authenticated', ARRAY['authenticated=Dxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[], ARRAY['postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[]),
    ('public.cedente_fundo_migracao_legado_relatorio', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.cedente_fundo_politicas', 'authenticated', ARRAY['authenticated=arwdDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=arwd/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.cedente_fundos', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.cedentes', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[]),
    ('public.contas_escrow', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[]),
    ('public.cte_notas_fiscais', 'authenticated', ARRAY['authenticated=arwDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=arw/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.ctes', 'authenticated', ARRAY['authenticated=arwDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=arw/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.devedores_solidarios', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[]),
    ('public.documento_analises', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.documento_requisito_instancias', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.documento_tipos', 'authenticated', ARRAY['authenticated=arwDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=arw/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.documento_versoes', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.documento_vinculos', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.documentos', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[]),
    ('public.documentos_gerados', 'authenticated', ARRAY['authenticated=arwDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=arw/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.documentos_repositorio', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.duplicata_correcoes', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.duplicata_validacoes', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.duplicata_versoes', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.duplicatas', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.estoque_atual', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=r/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=r/postgres']::text[]),
    ('public.eventos_dominio', 'authenticated', ARRAY['authenticated=arDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=ar/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.eventos_entrega', 'authenticated', ARRAY['authenticated=arwDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=arw/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.fundos', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.integracao_execucoes', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.liquidacoes_atuais', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=r/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=r/postgres']::text[]),
    ('public.logs_auditoria', 'authenticated', ARRAY['authenticated=arDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[], ARRAY['authenticated=ar/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[]),
    ('public.mfa_recovery_codes', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.mfa_reset_solicitacoes', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.movimentos_escrow', 'authenticated', ARRAY['authenticated=Dxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[], ARRAY['postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[]),
    ('public.nota_fiscal_entregas', 'authenticated', ARRAY['authenticated=arwDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=arw/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.notas_fiscais', 'authenticated', ARRAY['authenticated=arwdDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[], ARRAY['authenticated=arwd/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[]),
    ('public.operacao_calculo_nfs', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.operacoes', 'authenticated', ARRAY['authenticated=arwdDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[], ARRAY['authenticated=arwd/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[]),
    ('public.operacoes_nfs', 'authenticated', ARRAY['authenticated=arwdDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[], ARRAY['authenticated=arwd/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[]),
    ('public.politica_operacional_versoes', 'authenticated', ARRAY['authenticated=arwdDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=arwd/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.politica_requisitos_documentais', 'authenticated', ARRAY['authenticated=arwdDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=arwd/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.politicas_operacionais', 'authenticated', ARRAY['authenticated=arwdDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=arwd/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.remessas_cnab', 'authenticated', ARRAY['authenticated=arwDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=arw/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.remessas_cnab_operacoes', 'authenticated', ARRAY['authenticated=arwDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=arw/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.representantes', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[]),
    ('public.retornos_integracao', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.seguranca_eventos', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.seguranca_rate_limits', 'authenticated', ARRAY['authenticated=Dxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.sequencias_remessa', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.sessoes_elevadas', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.solicitacoes_alteracao_cedente', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[]),
    ('public.taxas_cedente', 'authenticated', ARRAY['authenticated=arwdDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[], ARRAY['authenticated=arwd/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[]),
    ('public.template_versoes', 'authenticated', ARRAY['authenticated=arwdDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=arwd/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.templates_documentos', 'authenticated', ARRAY['authenticated=arwdDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=arwd/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[]),
    ('public.testemunhas', 'authenticated', ARRAY['authenticated=Dxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[], ARRAY['postgres=arwdDxtm/postgres','service_role=arwd/postgres']::text[]),
    ('public.usuario_fundos', 'authenticated', ARRAY['authenticated=rDxtm/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[], ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres']::text[])
  ) AS approved(relation_name, role_name, baseline_acl, target_acl)
  LOOP
    v_rel := to_regclass(r.relation_name);
    IF v_rel IS NULL THEN RAISE EXCEPTION 'R1_16_ACL_RELATION_MISSING: %', r.relation_name; END IF;
    SELECT ARRAY(SELECT a::text FROM unnest(c.relacl) a ORDER BY a::text)
      INTO v_before FROM pg_class c WHERE c.oid = v_rel;
    IF v_before IS DISTINCT FROM r.baseline_acl AND v_before IS DISTINCT FROM r.target_acl THEN
      RAISE EXCEPTION 'R1_16_ACL_UNEXPECTED_BASELINE: %', r.relation_name;
    END IF;
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE %s FROM %I RESTRICT', v_rel, r.role_name);
    SELECT ARRAY(SELECT a::text FROM unnest(c.relacl) a ORDER BY a::text)
      INTO v_after FROM pg_class c WHERE c.oid = v_rel;
    IF v_after IS DISTINCT FROM r.target_acl THEN
      RAISE EXCEPTION 'R1_16_ACL_TARGET_MISMATCH: %', r.relation_name;
    END IF;
    IF has_table_privilege(r.role_name, v_rel, 'TRUNCATE')
       OR has_table_privilege(r.role_name, v_rel, 'REFERENCES')
       OR has_table_privilege(r.role_name, v_rel, 'TRIGGER')
       OR has_table_privilege(r.role_name, v_rel, 'MAINTAIN') THEN
      RAISE EXCEPTION 'R1_16_ACL_EFFECTIVE_MAINTENANCE_REMAINS: %', r.relation_name;
    END IF;
  END LOOP;
END;
$r116$;
COMMIT;
