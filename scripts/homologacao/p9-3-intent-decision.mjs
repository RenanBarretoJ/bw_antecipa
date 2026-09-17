export function classificarIntentParaCleanup(row, now = Date.now()) {
  const prefix = row.representante_id
    ? `${row.cnpj}/representantes/${row.representante_id}/${row.id}_`
    : `${row.cnpj}/${row.tipo_documento}/${row.id}_`
  if (row.storage_bucket !== 'documentos-cedentes' || !row.storage_path.startsWith(prefix) ||
    /(^|\/)\.\.(\/|$)|\\|\/\//.test(row.storage_path) ||
    row.referenced && row.status !== 'FINALIZED') return 'UNKNOWN'
  if (row.status === 'FINALIZED' || row.referenced) return 'REFERENCED'
  if (row.status === 'CLEANED') return 'CLEANED'
  if (row.object_present && row.storage_owner_id !== row.usuario_id) return 'UNKNOWN'
  if (now < Date.parse(row.cleanup_after)) return 'PENDING_GRACE_PERIOD'
  if (!row.object_present) return 'NO_OBJECT'
  if (row.attempt_count >= 3) return 'RETRY_EXHAUSTED'
  if (row.status === 'CLEANUP_PENDING' && now < Date.parse(row.updated_at) + row.attempt_count * 60_000) return 'RETRY_BACKOFF'
  return row.documento_versao_id ? 'UNKNOWN' : 'ELIGIBLE'
}
