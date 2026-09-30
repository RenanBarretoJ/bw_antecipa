// Explicit non-production allowlist shared by the controlled certification tools.
export const homolog = process.argv.includes('--homolog')
export const ref = homolog ? 'fhgkmggthxikfpogrvaa' : 'prnudoydwiramsxjnxzn'
export const phase = homolog ? 'R3_HOMOLOG' : 'R3'
export const medvale = {
  cedente: 'c7abb7ee-0c6b-4dd6-9bf2-83efc375d0b8',
  fund: '4a9ea066-b75e-4b01-a2ea-ed72c92ee5bd',
  link: '522b136a-fc3d-49e7-9abf-2fde516bf365',
}
// Preserve ALL pre-existing configuration, including suspended links and historical versions.
// Only the newly created QA access is excluded during the comparison.
export function medvaleSnapshot(qaUser = null) {
  if (qaUser && !/^[0-9a-f-]{36}$/.test(qaUser)) throw new Error('INVALID_QA_USER')
  const cid = `'${medvale.cedente}'`
  const funds = `select fundo_id from public.cedente_fundos where cedente_id=${cid}`
  const predicates = {
    cedentes: `id=${cid}`,
    cedente_fundos: `cedente_id=${cid}`,
    fundos: `id in (${funds})`,
    cedente_fundo_politicas: `cedente_fundo_id in (select id from public.cedente_fundos where cedente_id=${cid})`,
    politicas_operacionais: `fundo_id in (${funds})`,
    politica_operacional_versoes: `fundo_id in (${funds})`,
    contas_escrow: `cedente_id=${cid}`,
    taxas_cedente: `cedente_id=${cid}`,
    cedente_estabelecimentos: `cedente_id=${cid}`,
    cedente_acessos: `cedente_id=${cid}${qaUser ? ` and user_id<>'${qaUser}'` : ''}`,
  }
  return 'select ' + Object.entries(predicates).map(([table, where]) =>
    `(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.${table} t where ${where}) ${table}`
  ).join(',')
}
