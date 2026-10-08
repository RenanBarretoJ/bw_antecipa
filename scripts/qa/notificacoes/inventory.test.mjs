import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applicationProducers, sqlProducers } from './inventory.mjs'

test('R2 inventory retains delegated shared-registration producers and restricted RPC bridges', () => {
  const calls = applicationProducers(`export async function shared() {
    await notificarGestoresCadastro({ cedenteId: 'QA' });
    await admin.rpc('notificar_gestores_cadastro_cedente', {});
  }`, 'src/example.ts')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].kind, 'rpc')
  assert.equal(sqlProducers(`CREATE FUNCTION public.shared() RETURNS int AS $$
    SELECT private.notificar_gestores_cadastro_cedente(id,titulo,mensagem,tipo,event);
  $$;`).length, 1)
})

test('inventory preserves SQL overloads and distinguishes delegated writers', () => {
  const sql = `CREATE FUNCTION public.example(id uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.notificacoes(usuario_id) SELECT id FROM public.profiles p WHERE p.role = 'gestor'; END $$;
CREATE FUNCTION public.example(id uuid, scope text) RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN PERFORM private.notificar_cedente_ativos(id); END $fn$;`
  const result = sqlProducers(sql)
  assert.equal(result.length, 2)
  assert.equal(result[0].directInserts, 1)
  assert.equal(result[0].globalGestorBroadcasts, 1)
  assert.equal(result[1].delegatedCalls, 1)
  assert.notEqual(result[0].signature, result[1].signature)
})

test('inventory sees quoted tables and ignores a read-only function', () => {
  const sql = `CREATE OR REPLACE FUNCTION "private"."write"() RETURNS void AS $$ INSERT INTO "public"."notificacoes"(titulo) VALUES('test'); $$;
CREATE FUNCTION public.read() RETURNS SETOF public.notificacoes AS $$ SELECT * FROM public.notificacoes; $$;`
  assert.equal(sqlProducers(sql).length, 1)
})

test('TypeScript AST ignores comments, reads and declarations; captures direct and delegated calls', () => {
  const result = applicationProducers(`
// notificarGestores('not a call')
export async function producer() {
  await admin.from('notificacoes').insert({ titulo: 'QA' });
  await notificarGestores('QA', 'QA', 'info');
  await admin.from('notificacoes').select('id');
}
export async function notificarCedente() {}
`, 'src/example.ts')
  assert.equal(result.length, 2)
  assert.equal(result[0].function, 'producer')
  assert.equal(result[0].kind, 'direct-write')
  assert.equal(result[1].helper, 'notificarGestores')
})
