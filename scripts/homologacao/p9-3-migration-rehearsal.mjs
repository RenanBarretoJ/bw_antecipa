#!/usr/bin/env node
// Isolated local structural rehearsal; every cycle rolls back completely.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const connectionString = process.env.P9_3_LOCAL_DATABASE_URL
if (!connectionString) throw new Error('P9_3_LOCAL_DATABASE_URL ausente')
const destination = new URL(connectionString)
if (!['127.0.0.1', 'localhost'].includes(destination.hostname)) throw new Error('Rehearsal aceita somente Postgres local')
const sql = readFileSync('supabase/migrations/20260916205302_p9_3_documento_upload_intents.sql', 'utf8')
const sqlCascade = readFileSync('supabase/migrations/20260916210153_p9_3_intents_documento_fk_cascade.sql', 'utf8')
const client = new pg.Client({ connectionString })
await client.connect()
const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const intent = '33333333-3333-4333-8333-333333333333'
const path = `00123456000190/contrato_social/${intent}_qa.pdf`
const base = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage; create schema private;
  create type public.documento_tipo as enum ('contrato_social');
  create type public.documento_status as enum ('enviado');
  create table auth.users(id uuid primary key);
  create table public.cedentes(id uuid primary key, user_id uuid, cnpj text);
  create table public.representantes(id uuid primary key);
  create table public.documentos(id uuid primary key default gen_random_uuid(), cedente_id uuid,
    tipo public.documento_tipo, representante_id uuid, url_arquivo text unique, versao integer, status public.documento_status);
  create table public.logs_auditoria(id uuid primary key default gen_random_uuid(), usuario_id uuid,
    tipo_evento text, entidade_tipo text, entidade_id uuid, dados_depois jsonb,
    origem text, ator_tipo text default 'usuario', ator_identificador text);
  create table storage.objects(bucket_id text, name text, owner_id text, metadata jsonb,
    primary key(bucket_id,name));
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('app.test_uid',true),'')::uuid $$;
  create function public.get_user_cedente_id() returns uuid language sql security definer set search_path='' as $$
    select c.id from public.cedentes c where c.user_id=auth.uid() limit 1 $$;
  create function public.registrar_documento_cadastral_cedente(p_tipo public.documento_tipo,
    p_storage_path text,p_nome_arquivo text,p_representante_id uuid)
    returns table(documento_id uuid,versao integer,status public.documento_status,storage_path text)
    language plpgsql security definer set search_path='' as $$
    begin
      return query insert into public.documentos(cedente_id,tipo,representante_id,url_arquivo,versao,status)
        values(public.get_user_cedente_id(),p_tipo,p_representante_id,p_storage_path,1,'enviado')
        returning id,documentos.versao,documentos.status,documentos.url_arquivo;
    end $$;
  grant usage on schema public,auth to authenticated;
  grant execute on function auth.uid() to authenticated;
  grant execute on function public.get_user_cedente_id() to authenticated;
  grant execute on function public.registrar_documento_cadastral_cedente(public.documento_tipo,text,text,uuid) to authenticated;
  insert into auth.users(id) values ('${a}'),('${b}');
  insert into public.cedentes(id,user_id,cnpj) values ('${a}','${a}','00123456000190'),('${b}','${b}','00999999000100');
  select set_config('app.test_uid','${a}',true);
`
try {
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    await client.query('BEGIN')
    try {
      await client.query(base)
      await client.query(sql)
      await client.query(sqlCascade)
      assert.equal((await client.query("select relrowsecurity from pg_class where oid='public.documento_upload_intents'::regclass")).rows[0].relrowsecurity, true)
      await client.query(`insert into public.documento_upload_intents
        (id,cedente_id,usuario_id,tipo_documento,storage_path,nome_original,mime_type,tamanho_esperado,expires_at,cleanup_after)
        values ($1,$2,$2,'contrato_social',$3,'qa.pdf','application/pdf',100,now()+interval '15 minutes',now()+interval '3 hours')`, [intent,a,path])
      await client.query(`insert into storage.objects(bucket_id,name,owner_id,metadata)
        values ('documentos-cedentes',$1,$2,'{"mimetype":"application/pdf","size":"100"}')`, [path,a])
      const first = await client.query('select * from public.finalizar_documento_upload_intent($1)', [intent])
      const retry = await client.query('select * from public.finalizar_documento_upload_intent($1)', [intent])
      assert.equal(first.rows[0].novo_registro, true)
      assert.equal(retry.rows[0].novo_registro, false)
      assert.equal((await client.query('select count(*)::int as n from public.documentos')).rows[0].n, 1)
      assert.equal((await client.query('select count(*)::int as n from public.logs_auditoria')).rows[0].n, 1)
      await client.query('SET ROLE authenticated')
      const ownerRows = await client.query('select count(*)::int as n from public.documento_upload_intents')
      assert.equal(ownerRows.rows[0].n, 1)
      await client.query(`select set_config('app.test_uid','${b}',true)`)
      const crossRows = await client.query('select count(*)::int as n from public.documento_upload_intents')
      assert.equal(crossRows.rows[0].n, 0)
      await client.query('SAVEPOINT cross_rpc')
      try {
        await client.query('select * from public.finalizar_documento_upload_intent($1)', [intent])
        throw new Error('Cross-tenant RPC deveria falhar')
      } catch (error) {
        assert.equal(error.code, '42501')
        await client.query('ROLLBACK TO SAVEPOINT cross_rpc')
      }
      await client.query('SAVEPOINT arbitrary_update')
      try {
        await client.query(`update public.documento_upload_intents set status='CLEANED' where id=$1`, [intent])
        throw new Error('UPDATE autenticado deveria falhar')
      } catch (error) {
        assert.equal(error.code, '42501')
        await client.query('ROLLBACK TO SAVEPOINT arbitrary_update')
      }
      await client.query('RESET ROLE')
      await client.query('SET ROLE anon')
      await client.query('SAVEPOINT anon_select')
      try {
        await client.query('select id from public.documento_upload_intents')
        throw new Error('Anon deveria ser negado')
      } catch (error) {
        assert.equal(error.code, '42501')
        await client.query('ROLLBACK TO SAVEPOINT anon_select')
      }
      await client.query('RESET ROLE')
      await client.query('SAVEPOINT bad_path')
      try {
        await client.query(`insert into public.documento_upload_intents
          (id,cedente_id,usuario_id,tipo_documento,storage_path,nome_original,mime_type,tamanho_esperado,expires_at,cleanup_after)
          values (gen_random_uuid(),$1,$1,'contrato_social',$2,'qa.pdf','application/pdf',100,
            now()+interval '15 minutes',now()+interval '3 hours')`, [a, `${a}/../outside.pdf`])
        throw new Error('Path traversal deveria falhar')
      } catch (error) {
        assert.equal(error.code, '23514')
        await client.query('ROLLBACK TO SAVEPOINT bad_path')
      }
      await client.query('delete from public.documentos where url_arquivo=$1', [path])
      assert.equal((await client.query('select count(*)::int as n from public.documento_upload_intents')).rows[0].n, 0)
      console.log(JSON.stringify({ cycle, schema: 'PASS', rls: 'PASS', idempotency: 'PASS', audit: 'PASS', resetCascade: 'PASS' }))
    } finally {
      await client.query('ROLLBACK')
    }
  }
} finally {
  await client.end()
}
