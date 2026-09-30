import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

// Development-time extraction of the official bodies into ONE runtime core.
// Never rewrites installed SQL or an existing migration. Output is reviewed SQL.
const c4 = readFileSync('supabase/migrations/20260924143332_c4_consultor_notas_fiscais_por_cedente.sql', 'utf8').replaceAll('\r\n', '\n')
const reconciliation = readFileSync('supabase/migrations/20260925205512_c1_1_reconciliar_documentos_consultor.sql', 'utf8').replaceAll('\r\n', '\n')
const target = 'supabase/migrations/20260929220304_fiscal_intake_shared_persistence.sql'
const definitions = [
  ['registrar_parcelas_nota_fiscal', c4, "(SELECT auth.uid()) IS NULL OR v_role NOT IN ('gestor', 'cedente', 'consultor')"],
  ['reconciliar_documentos_base_nf', reconciliation, "auth.uid() IS NULL OR actor_role NOT IN ('gestor', 'cedente', 'consultor')"],
  ['instanciar_requisitos_nota', c4, "auth.uid() IS NULL OR get_user_role() NOT IN ('gestor', 'cedente', 'consultor')"],
  ['registrar_documento_upload', c4, "auth.uid() IS NULL OR actor_role NOT IN ('gestor', 'cedente', 'consultor') OR p_enviado_por <> auth.uid()"],
]
let output = `-- RLX-EMAIL-03: one persistence core for human and fenced fiscal actors.
-- Official C4/C1.1 business rules are moved, not independently reimplemented.
BEGIN;
ALTER TABLE public.notas_fiscais ADD COLUMN fiscal_reservation_id uuid UNIQUE REFERENCES private.fiscal_identity_reservations(id);
ALTER TABLE public.notas_fiscais ADD COLUMN source_channel text CHECK (source_channel IN ('MANUAL_UPLOAD','EMAIL_INTAKE'));
ALTER TABLE public.documentos_repositorio ALTER COLUMN criado_por DROP NOT NULL;
ALTER TABLE public.documentos_repositorio ADD COLUMN fiscal_reservation_id uuid REFERENCES private.fiscal_identity_reservations(id);
ALTER TABLE public.documentos_repositorio ADD CONSTRAINT documento_fiscal_actor CHECK (criado_por IS NOT NULL OR fiscal_reservation_id IS NOT NULL);
ALTER TABLE public.documento_versoes ALTER COLUMN enviado_por DROP NOT NULL;
ALTER TABLE public.documento_versoes ADD COLUMN fiscal_reservation_id uuid REFERENCES private.fiscal_identity_reservations(id);
ALTER TABLE public.documento_versoes ADD CONSTRAINT versao_fiscal_actor CHECK (enviado_por IS NOT NULL OR fiscal_reservation_id IS NOT NULL);
CREATE INDEX documento_fiscal_reservation ON public.documentos_repositorio(fiscal_reservation_id) WHERE fiscal_reservation_id IS NOT NULL;
CREATE INDEX versao_fiscal_reservation ON public.documento_versoes(fiscal_reservation_id) WHERE fiscal_reservation_id IS NOT NULL;

CREATE FUNCTION private.fiscal_assert_nf(p_nf uuid,p_id uuid,p_token uuid,p_generation bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r private.fiscal_identity_reservations%ROWTYPE;
BEGIN
  r := private.fiscal_assert_owner(p_id,p_token,p_generation);
  IF NOT EXISTS (SELECT 1 FROM public.notas_fiscais nf WHERE nf.id=p_nf AND nf.fiscal_reservation_id=r.id
    AND nf.fundo_id=r.fundo_id AND nf.cedente_id=r.cedente_id AND nf.cedente_fundo_id=r.cedente_fundo_id
    AND nf.estabelecimento_id=r.estabelecimento_id AND nf.status::text='rascunho'
    AND encode(extensions.digest(nf.chave_acesso,'sha256'),'hex')=r.identity_sha256)
    THEN RAISE EXCEPTION 'FISCAL_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.fiscal_assert_nf(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
`
for (const [name, source, guard] of definitions) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  assert.ok(start >= 0, name)
  const headerEnd = source.indexOf('AS ', start)
  const delimiter = source.slice(headerEnd + 3).match(/^\$[a-z_]*\$/i)?.[0]
  assert.ok(delimiter)
  const end = source.indexOf(delimiter + ';', headerEnd + 3 + delimiter.length) + delimiter.length + 1
  const original = source.slice(start, end)
  const closingArgs = original.indexOf(')')
  const args = original.slice(original.indexOf('(') + 1, closingArgs).trim().split(',').map(p => p.trim())
  const argNames = args.map(p => p.split(/\s+/)[0])
  const argTypes = args.map(p => p.split(/\s+/)[1])
  let core = original.replace(`public.${name}`, `private.fiscal_${name}`)
  const lastArg = core.indexOf(')')
  core = core.slice(0, lastArg) + ',\n  p_reservation_id uuid DEFAULT NULL, p_owner_token uuid DEFAULT NULL, p_generation bigint DEFAULT NULL\n' + core.slice(lastArg)
  assert.ok(core.includes(`IF ${guard} THEN`), name)
  core = core.replace(`IF ${guard} THEN`, `IF p_reservation_id IS NULL AND (${guard}) THEN`)
  core = core.replace('BEGIN\n', `BEGIN\n  IF p_reservation_id IS NOT NULL THEN\n    PERFORM private.fiscal_assert_nf(p_nota_fiscal_id,p_reservation_id,p_owner_token,p_generation);\n  END IF;\n`)
  core = core.replace('SET search_path = public', "SET search_path = ''")
    .replace(/(?<![.\w])get_user_role\(/g, 'public.get_user_role(')
    .replace(/(?<![.\w])get_user_cedente_id\(/g, 'public.get_user_cedente_id(')
    .replace('public.reconciliar_documentos_base_nf(p_nota_fiscal_id)',
      'private.fiscal_reconciliar_documentos_base_nf(p_nota_fiscal_id,p_reservation_id,p_owner_token,p_generation)')
  if (name === 'registrar_documento_upload') {
    core = core.replace('(documento_tipo_id, status, criado_por)', '(documento_tipo_id, status, criado_por, fiscal_reservation_id)')
      .replace("VALUES (p_documento_tipo_id, 'pendente', p_enviado_por)", "VALUES (p_documento_tipo_id, 'pendente', p_enviado_por, p_reservation_id)")
      .replace('status, substitui_versao_id, enviado_por\n', 'status, substitui_versao_id, enviado_por, fiscal_reservation_id\n')
      .replace("'em_analise', p_substitui_versao_id, p_enviado_por\n", "'em_analise', p_substitui_versao_id, p_enviado_por, p_reservation_id\n")
    // A caller of the private fiscal core must still bind the real human/null system actor.
    core = core.replace('  SELECT * INTO requirement', `  IF p_reservation_id IS NOT NULL AND p_enviado_por IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'FISCAL_ACTOR_DENIED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO requirement`)
  }
  if (name === 'reconciliar_documentos_base_nf') {
    core = core.replace('FROM public.profiles profile\n    WHERE profile.id = auth.uid()',
      'FROM (SELECT 1) actor_row LEFT JOIN public.profiles profile ON profile.id = auth.uid()')
    core = core.replace("'origem', 'documento_base_nf'", "'origem', 'documento_base_nf', 'fiscal_reservation_id', p_reservation_id,\n        'actor_type', CASE WHEN auth.uid() IS NULL THEN 'SYSTEM' ELSE 'HUMAN' END")
  }
  output += '\n' + core + '\n'
  output += `REVOKE ALL ON FUNCTION private.fiscal_${name}(${[...argTypes, 'uuid', 'uuid', 'bigint'].join(',')}) FROM PUBLIC,anon,authenticated,service_role;\n`
  output += `CREATE OR REPLACE FUNCTION public.${name}(\n  ${args.join(',\n  ')}\n)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $wrapper$
  SELECT private.fiscal_${name}(${argNames.join(',')},NULL,NULL,NULL);
$wrapper$;\n`
}
output += '\nCOMMIT;\n'
writeFileSync(target, output, 'utf8')
console.log(JSON.stringify({ migration: target, sharedCores: definitions.length }))
