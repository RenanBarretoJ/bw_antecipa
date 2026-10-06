// R4-only audit exception authorized by the operator. Never changes application data.
import assert from 'node:assert/strict'
export const webhookAnchorSql=`SELECT jsonb_build_object(
  'eventIds',coalesce((SELECT jsonb_agg(id ORDER BY id) FROM public.integracao_logistica_webhook_eventos),'[]'::jsonb),
  'storageIds',coalesce((SELECT jsonb_agg(id ORDER BY id) FROM storage.objects),'[]'::jsonb),
  'fundIds',coalesce((SELECT jsonb_agg(fundo_id ORDER BY fundo_id) FROM (
    SELECT DISTINCT e.fundo_id FROM public.integracao_logistica_webhook_eventos e
    WHERE e.status='NAO_IDENTIFICADO' AND e.recebido_em>now()-interval '1 hour'
    AND NOT EXISTS(SELECT 1 FROM public.notas_fiscais nf WHERE nf.fundo_id=e.fundo_id)
  ) q),'[]'::jsonb)) anchor`
export async function captureWebhooks(db){return (await db.query(webhookAnchorSql)).rows[0].anchor}
export const concurrentSql=`WITH allowed_events AS (
  SELECT e.id,e.bucket,e.path FROM public.integracao_logistica_webhook_eventos e
  WHERE NOT(e.id=ANY($1::uuid[])) AND e.fundo_id=ANY($3::uuid[])
    AND e.status='NAO_IDENTIFICADO'
    AND e.nota_fiscal_venda_id IS NULL AND e.nota_fiscal_remessa_id IS NULL
    AND e.cte_id IS NULL AND e.canhoto_id IS NULL AND e.tipo_vinculo IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.notas_fiscais nf WHERE nf.fundo_id=e.fundo_id)
    AND e.path LIKE 'webhooks-transportadora/'||e.integracao_id::text||'/'||e.id::text||'/%'
), allowed_storage AS (
  SELECT s.id FROM storage.objects s JOIN allowed_events e ON s.bucket_id=e.bucket AND s.name=e.path
  WHERE NOT(s.id=ANY($2::uuid[]))
), preserved_events AS (
  SELECT to_jsonb(t) row FROM public.integracao_logistica_webhook_eventos t
  WHERE NOT EXISTS(SELECT 1 FROM allowed_events a WHERE a.id=t.id)
), preserved_storage AS (
  SELECT to_jsonb(t) row FROM storage.objects t
  WHERE NOT EXISTS(SELECT 1 FROM allowed_storage a WHERE a.id=t.id)
)
SELECT 'public.integracao_logistica_webhook_eventos' name,count(*)::int count,
md5(coalesce(string_agg(row::text,'' ORDER BY row::text),'')) hash,
(SELECT count(*)::int FROM allowed_events) concurrent FROM preserved_events
UNION ALL SELECT 'storage.objects',count(*)::int,
md5(coalesce(string_agg(row::text,'' ORDER BY row::text),'')),
(SELECT count(*)::int FROM allowed_storage) FROM preserved_storage`
export async function normalizeWebhooks(db,rows,anchor){
  if(!anchor)return rows
  for(const name of ['eventIds','storageIds','fundIds'])assert(Array.isArray(anchor[name])&&anchor[name].every(x=>/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(x)),'INVALID_WEBHOOK_ANCHOR')
  const checked=(await db.query(concurrentSql,[anchor.eventIds,anchor.storageIds,anchor.fundIds])).rows
  return rows.map(r=>{const v=checked.find(x=>x.name===r.name);return v?{name:v.name,count:v.count,hash:v.hash}:r})
}
