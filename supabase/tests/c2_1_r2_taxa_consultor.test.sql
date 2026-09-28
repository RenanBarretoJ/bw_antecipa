\set ON_ERROR_STOP on

BEGIN;

SELECT plan(14);

SELECT has_column('public', 'operacoes', 'taxa_proposta_consultor', 'preserva taxa proposta');
SELECT has_column('public', 'operacoes', 'taxa_proposta_por', 'preserva ator da proposta');
SELECT has_column('public', 'operacoes', 'taxa_proposta_consultor_id', 'preserva organizacao Consultora');
SELECT has_column('public', 'operacoes', 'taxa_proposta_em', 'preserva instante da proposta');
SELECT has_column('public', 'operacoes', 'calculo_proposta_memoria', 'preserva snapshot da proposta');

SELECT has_function(
  'public',
  'solicitar_operacao_antecipacao_consultor_atomica',
  ARRAY['uuid','uuid','uuid','uuid','integer','jsonb','text','boolean','text','uuid[]','numeric','text','uuid[]'],
  'RPC dedicada do Consultor existe'
);
SELECT has_function(
  'public',
  'solicitar_operacao_antecipacao_cedente_atomica',
  ARRAY['uuid','uuid','uuid','uuid','integer','jsonb','text','boolean','text','uuid[]','numeric','numeric','integer','numeric','date','text','uuid[]'],
  'wrapper preserva fluxo direto do Cedente'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.solicitar_operacao_antecipacao_consultor_atomica(uuid,uuid,uuid,uuid,integer,jsonb,text,boolean,text,uuid[],numeric,text,uuid[])',
    'EXECUTE'
  ),
  'authenticated pode chamar RPC dedicada do Consultor'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.solicitar_operacao_antecipacao_cedente_atomica(uuid,uuid,uuid,uuid,integer,jsonb,text,boolean,text,uuid[],numeric,numeric,integer,numeric,date,text,uuid[])',
    'EXECUTE'
  ),
  'authenticated pode chamar wrapper do Cedente'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.solicitar_operacao_antecipacao_atomica(uuid,uuid,uuid,uuid,integer,jsonb,text,boolean,text,uuid[],numeric,numeric,integer,numeric,date,text,uuid[])',
    'EXECUTE'
  ),
  'executor legado nao pode ser contornado diretamente'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.operacoes'::regclass
      AND tgname = 'operacoes_proteger_proposta_taxa_consultor'
      AND NOT tgisinternal
  ),
  'trigger torna proposta imutavel'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.operacoes'::regclass
      AND conname = 'operacoes_proposta_consultor_completa_check'
  ),
  'constraint impede proposta parcial'
);
SELECT ok(
  position(
    'private.calcular_memoria_financeira_nf' IN
    pg_get_functiondef(
      'public.solicitar_operacao_antecipacao_consultor_atomica(uuid,uuid,uuid,uuid,integer,jsonb,text,boolean,text,uuid[],numeric,text,uuid[])'::regprocedure
    )
  ) > 0,
  'backend da proposta reutiliza motor financeiro canonico'
);
SELECT ok(
  position(
    'TAXA_MANTIDA_GESTOR' IN
    pg_get_functiondef('public.aprovar_operacao_com_risco_atomica(uuid,numeric,uuid,text)'::regprocedure)
  ) > 0
  AND position(
    'TAXA_ALTERADA_GESTOR' IN
    pg_get_functiondef('public.aprovar_operacao_com_risco_atomica(uuid,numeric,uuid,text)'::regprocedure)
  ) > 0,
  'aprovacao atomica audita manutencao ou alteracao da taxa'
);

SELECT * FROM finish();

ROLLBACK;
