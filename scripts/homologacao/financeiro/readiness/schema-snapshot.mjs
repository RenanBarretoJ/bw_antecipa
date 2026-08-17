import pg from 'pg'

const DOMAIN_SCHEMAS = ['public', 'private', 'storage']

function compact(value) {
  if (value === null || value === undefined) return null
  return String(value).replace(/\s+/g, ' ').trim()
}

function normalizeRows(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    typeof value === 'string' ? compact(value) : value,
  ])))
}

export async function openDatabase(connectionString, applicationName, readOnly = false) {
  const url = new URL(connectionString)
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  const client = new pg.Client({
    connectionString,
    application_name: applicationName,
    statement_timeout: 240_000,
    query_timeout: 240_000,
    ssl: local ? false : { rejectUnauthorized: false },
  })
  await client.connect()
  if (readOnly) await client.query('BEGIN READ ONLY')
  return client
}

export async function closeDatabase(client, readOnly = false) {
  if (readOnly) await client.query('ROLLBACK').catch(() => undefined)
  await client.end().catch(() => undefined)
}

export async function captureSchemaSnapshot(client, label) {
  const schemas = await client.query(`select nspname as schema
    from pg_namespace where nspname = any($1::text[]) order by 1`, [DOMAIN_SCHEMAS])
  const relations = await client.query(`select n.nspname as schema,c.relname as name,c.relkind,
      c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,
      coalesce(am.amname,'') as access_method
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    left join pg_am am on am.oid=c.relam
    where n.nspname=any($1::text[]) and c.relkind in ('r','p','v','m','S')
    order by 1,2,3`, [DOMAIN_SCHEMAS])
  const columns = await client.query(`select n.nspname as schema,c.relname as relation,a.attnum as position,
      a.attname as name,pg_catalog.format_type(a.atttypid,a.atttypmod) as type,
      a.attnotnull as not_null,pg_get_expr(d.adbin,d.adrelid) as default,
      a.attidentity as identity,a.attgenerated as generated,
      coalesce(coll.collname,'') as collation
    from pg_attribute a join pg_class c on c.oid=a.attrelid
    join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    left join pg_collation coll on coll.oid=a.attcollation
    where n.nspname=any($1::text[]) and c.relkind in ('r','p','v','m')
      and a.attnum>0 and not a.attisdropped order by 1,2,3`, [DOMAIN_SCHEMAS])
  const types = await client.query(`select n.nspname as schema,t.typname as name,t.typtype,
      pg_catalog.format_type(t.typbasetype,t.typtypmod) as base_type,t.typnotnull as not_null,
      t.typdefault as default,array_remove(array_agg(e.enumlabel order by e.enumsortorder),null) as enum_values
    from pg_type t join pg_namespace n on n.oid=t.typnamespace
    left join pg_enum e on e.enumtypid=t.oid
    where n.nspname=any($1::text[]) and t.typtype in ('d','e')
    group by n.nspname,t.typname,t.typtype,t.typbasetype,t.typtypmod,t.typnotnull,t.typdefault
    order by 1,2`, [DOMAIN_SCHEMAS])
  const constraints = await client.query(`select n.nspname as schema,c.relname as relation,k.conname as name,
      k.contype,pg_get_constraintdef(k.oid,true) as definition,k.condeferrable as deferrable,
      k.condeferred as initially_deferred,k.convalidated as validated
    from pg_constraint k join pg_class c on c.oid=k.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=any($1::text[]) order by 1,2,3`, [DOMAIN_SCHEMAS])
  const indexes = await client.query(`select n.nspname as schema,c.relname as relation,i.relname as name,
      ix.indisunique as unique,am.amname as method,pg_get_indexdef(i.oid) as definition,
      pg_get_expr(ix.indpred,ix.indrelid) as predicate
    from pg_index ix join pg_class c on c.oid=ix.indrelid
    join pg_class i on i.oid=ix.indexrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_am am on am.oid=i.relam
    where n.nspname=any($1::text[]) order by 1,2,3`, [DOMAIN_SCHEMAS])
  const views = await client.query(`select n.nspname as schema,c.relname as name,c.relkind,
      pg_get_viewdef(c.oid,true) as definition
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=any($1::text[]) and c.relkind in ('v','m') order by 1,2`, [DOMAIN_SCHEMAS])
  const routines = await client.query(`select n.nspname as schema,p.proname as name,
      pg_get_function_identity_arguments(p.oid) as identity_arguments,
      pg_get_function_result(p.oid) as result,p.prokind,p.prosecdef as security_definer,
      p.provolatile as volatility,p.proparallel as parallel,p.proconfig as config,
      pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname=any($1::text[]) order by 1,2,3`, [DOMAIN_SCHEMAS])
  const triggers = await client.query(`select n.nspname as schema,c.relname as relation,t.tgname as name,
      t.tgenabled as enabled,pg_get_triggerdef(t.oid,true) as definition
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=any($1::text[]) and not t.tgisinternal order by 1,2,3`, [DOMAIN_SCHEMAS])
  const policies = await client.query(`select schemaname as schema,tablename as relation,policyname as name,
      permissive,roles,cmd,qual,with_check from pg_policies
    where schemaname=any($1::text[]) order by 1,2,3`, [DOMAIN_SCHEMAS])
  const tableGrants = await client.query(`select table_schema as schema,table_name as relation,
      grantee,privilege_type,is_grantable
    from information_schema.table_privileges
    where table_schema=any($1::text[]) and grantee in ('anon','authenticated','service_role','PUBLIC')
    order by 1,2,3,4`, [DOMAIN_SCHEMAS])
  const routineGrants = await client.query(`select routine_schema as schema,routine_name as routine,
      grantee,privilege_type,is_grantable
    from information_schema.routine_privileges
    where routine_schema=any($1::text[]) and grantee in ('anon','authenticated','service_role','PUBLIC')
    order by 1,2,3,4`, [DOMAIN_SCHEMAS])
  const sequences = await client.query(`select sequence_schema as schema,sequence_name as name,data_type,
      start_value,minimum_value,maximum_value,increment,cycle_option
    from information_schema.sequences where sequence_schema=any($1::text[]) order by 1,2`, [DOMAIN_SCHEMAS])
  const buckets = await client.query(`select id::text,name,public,file_size_limit,allowed_mime_types
    from storage.buckets order by id`)

  const snapshot = {
    label,
    schemas: normalizeRows(schemas.rows),
    relations: normalizeRows(relations.rows),
    columns: normalizeRows(columns.rows),
    types: normalizeRows(types.rows),
    constraints: normalizeRows(constraints.rows),
    indexes: normalizeRows(indexes.rows),
    views: normalizeRows(views.rows),
    routines: normalizeRows(routines.rows),
    triggers: normalizeRows(triggers.rows),
    policies: normalizeRows(policies.rows),
    grants: normalizeRows([...tableGrants.rows.map((row) => ({ kind: 'table', ...row })), ...routineGrants.rows.map((row) => ({ kind: 'routine', ...row }))]),
    sequences: normalizeRows(sequences.rows),
    storage_buckets: normalizeRows(buckets.rows),
  }
  snapshot.counts = Object.fromEntries(Object.entries(snapshot)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => [key, value.length]))
  return snapshot
}

const KEYS = {
  schemas: ['schema'], relations: ['schema', 'name', 'relkind'], columns: ['schema', 'relation', 'position'],
  types: ['schema', 'name'], constraints: ['schema', 'relation', 'name'], indexes: ['schema', 'relation', 'name'],
  views: ['schema', 'name'], routines: ['schema', 'name', 'identity_arguments'], triggers: ['schema', 'relation', 'name'],
  policies: ['schema', 'relation', 'name'], grants: ['kind', 'schema', 'relation', 'routine', 'grantee', 'privilege_type'],
  sequences: ['schema', 'name'], storage_buckets: ['id'],
}

function rowKey(row, keys) {
  return keys.map((key) => row[key] ?? '').join('|')
}

function classifyDifference(category, key, homologRow, cleanRoomRow) {
  const row = homologRow ?? cleanRoomRow
  const schema = row?.schema

  // Supabase Storage local 2.111.0 provisions Iceberg catalog objects that are
  // not present in the managed homolog project. They are infrastructure-owned,
  // not referenced by BW migrations, and are allowlisted by exact object name.
  const icebergObject = schema === 'storage'
    && ['iceberg_namespaces', 'iceberg_tables'].includes(row?.relation ?? row?.name)
  const icebergGrant = category === 'grants'
    && schema === 'storage'
    && ['iceberg_namespaces', 'iceberg_tables'].includes(row?.relation)
  if (icebergObject || icebergGrant) {
    return {
      classification: 'ALLOWED_ENVIRONMENT',
      reason: 'Objeto interno do Supabase Storage local (Iceberg), fora do dominio BW.',
    }
  }

  // The managed and local Storage releases expose the same public contract for
  // filename(text), but pg_get_functiondef reflects their internal release code.
  if (category === 'routines' && key === 'storage|filename|name text') {
    return {
      classification: 'ALLOWED_ENVIRONMENT',
      reason: 'Implementacao interna versionada pelo Supabase Storage; assinatura preservada.',
    }
  }

  return { classification: 'MATERIAL', reason: null }
}

export function compareSchemaSnapshots(homolog, cleanRoom) {
  const materialDifferences = []
  const allowedDifferences = []
  for (const [category, keys] of Object.entries(KEYS)) {
    const left = new Map(homolog[category].map((row) => [rowKey(row, keys), row]))
    const right = new Map(cleanRoom[category].map((row) => [rowKey(row, keys), row]))
    for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
      const homologRow = left.get(key) ?? null
      const cleanRoomRow = right.get(key) ?? null
      if (JSON.stringify(homologRow) === JSON.stringify(cleanRoomRow)) continue
      const classification = classifyDifference(category, key, homologRow, cleanRoomRow)
      const difference = {
        category,
        key,
        homolog: homologRow,
        clean_room: cleanRoomRow,
        ...classification,
      }
      if (classification.classification === 'MATERIAL') materialDifferences.push(difference)
      else allowedDifferences.push(difference)
    }
  }
  return {
    status: materialDifferences.length === 0 ? 'PASS' : 'FAIL',
    homolog: { counts: homolog.counts },
    clean_room: { counts: cleanRoom.counts },
    material_differences: materialDifferences,
    allowed_differences: allowedDifferences,
  }
}
