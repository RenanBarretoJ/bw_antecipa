import assert from 'node:assert/strict'
export function classifyPolicy(comparisons,table,variant){
 const rows=comparisons.filter(c=>c.table===table&&c.candidateVariant===variant)
 assert(rows.length>0,'EMPTY_MATRIX_IS_NOT_PROOF')
 const sum=field=>rows.reduce((n,r)=>n+r[field].length,0)
 const counts={comparisons:rows.length,added:sum('added'),removed:sum('removed'),legitimateLost:sum('legitimateLost'),candidateUnexpected:sum('candidateUnexpected')}
 const changed=rows.filter(r=>r.added.length||r.removed.length)
 if(counts.added||counts.legitimateLost||counts.candidateUnexpected)return {classification:'MANUAL_DECISION_REQUIRED',reason:'REGRESSION_OR_UNRESOLVED_ACCESS',counts,changed}
 if(counts.removed)return {classification:'MANUAL_DECISION_REQUIRED',reason:'LEGACY_EXTRA_ROWS_OUTSIDE_CANONICAL_CONTRACT',counts,changed}
 return {classification:'REDUNDANT_REMOVE_FUTURE',reason:'IDENTICAL_ROW_SETS_ALL_MATRIX_CASES',counts,changed}
}
