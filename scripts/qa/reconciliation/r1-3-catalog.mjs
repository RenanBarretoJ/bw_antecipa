// Critical C5/A6 target; protected objects are also compared before/after each forward.
export const a6Names = ['dashboard_consultor_resumo','relatorio_consultor_analitico',
  'dashboard_consultor_resumo_a6','relatorio_consultor_analitico_a6','consultor_escopo_analitico',
  'configurar_comissao_consultor_fundo']
export const c5Names = ['consultor_usuario_pode_visualizar_cedente_fundo','consultor_usuario_pode_visualizar_cedente',
  'consultor_usuario_pode_visualizar_fundo','consultor_usuario_pode_visualizar_operacao',
  'consultor_usuario_pode_visualizar_nota_fiscal','consultor_usuario_pode_visualizar_entrega',
  'consultor_pode_visualizar_cedente','consultor_listar_cedente_ids_visiveis','consultor_pode_visualizar_operacao',
  'listar_cedentes_visiveis_consultor','listar_fundos_visiveis_consultor',
  'consultor_pode_visualizar_nota_fiscal','logistica_usuario_pode_ler_entrega','buscar_cedentes_visiveis_consultor']
export async function functions(db, names) {
  return (await db.query(`SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,
    pg_get_function_result(p.oid) result,l.lanname,p.prosecdef,p.provolatile,p.proconfig,
    pg_get_userbyid(p.proowner) owner,p.prosrc,
    ARRAY(SELECT format('%s:%s:%s',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
      FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a ORDER BY 1) acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname IN ('public','private') AND p.proname=ANY($1::text[]) ORDER BY 1,2,3`,[names])).rows
}
export async function target(db) {
  return { functions: await functions(db,[...a6Names,...c5Names]),
    sacadoShortCircuit: await functions(db,['sacado_tem_acesso_cnpj_fundo','sacado_tem_acesso_operacao_nf','sacado_tem_acesso_operacao']),
    policies: (await db.query(`SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
      FROM pg_policies WHERE schemaname='public' AND (policyname LIKE '%consultor_select%' OR policyname IN('fundos_consultor_vinculado_select')) ORDER BY 1,2,3`)).rows,
    indexes: (await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND indexname LIKE '%c5%' ORDER BY 1")).rows }
}
export async function protectedCatalog(db) {
  return { a6: await functions(db,a6Names),
    policies:(await db.query(`SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies
      WHERE schemaname='storage' OR tablename IN('notificacoes','sacados','sacado_acessos') ORDER BY 1,2,3`)).rows,
    functions:(await db.query(`SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition,p.proacl::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.prokind='f'
      AND (p.proname LIKE '%sacado%' OR p.proname LIKE '%notifica%' OR p.proname LIKE '%storage%') ORDER BY 1,2,3`)).rows }
}
