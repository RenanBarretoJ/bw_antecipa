// R1.14 is offline diagnosis only: no DB client, migrations, subprocess writes or deployment.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {hash} from './r1-4-restorer.mjs'
import {gitBytes} from './r1-5-migration-source.mjs'
import {paths,objectKey,equal,countBy,pattern,aclEntries,functionSemantics,functionSecurity,changedComponents} from './r1-14-analysis.mjs'
import {loadSources,sourceRef,referencesFor,bodyMatches,pathProvenance} from './r1-14-provenance.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const root='rehearsal/reports/',read=async n=>JSON.parse(await readFile(root+n+'.json','utf8'))
const raw=await read('R1_13_RAW_THREE_WAY'),target=await read('R1_13_TARGET_CATALOG'),manifest=await read('R1_5_MANIFESTS'),checkpoint=await read('R1_14_CHECKPOINT')
const composed=await read('R1_14_COMPOSED_PROVENANCE');assert.equal(composed.result,'PASS')
assert.equal(raw.differences.length,897);assert.equal(target.differences.length,897)
assert.equal(hash(await readFile(root+'R1_13_RAW_THREE_WAY.json')),target.sourceSha256)
const captureReports={prod:await read('R1_13_PROD_UPGRADE'),homolog:await read('R1_13_HOMOLOG_UPGRADE'),cleanroom:(await read('R1_13_CLEANROOM')).paths[0]}
const catalogs=Object.fromEntries(paths.map(p=>[p,captureReports[p].applicationObjects]))
for(const p of paths){assert.equal(captureReports[p].result,'PASS');assert.equal(captureReports[p].cleanup,'PASS')}
const recomputed=[]
const maps=paths.map(p=>new Map(catalogs[p].map(o=>[objectKey(o),o])))
for(const key of [...new Set(maps.flatMap(m=>[...m.keys()]))].sort()){
 const os=maps.map(m=>m.get(key)??null);if(os.some(o=>!equal(o,os[0])))recomputed.push(key)
}
assert.deepEqual(recomputed,raw.differences.map(d=>d.key))
console.log(JSON.stringify({stage:'RAW_897_VERIFIED',remoteCalls:0}))
const {sources,baselines}=await loadSources(manifest)
console.log(JSON.stringify({stage:'CANONICAL_SOURCES_HASH_VERIFIED',sources:sources.length}))
const fileIndex=[]
for(const f of checkpoint.files){
 if((f.path.startsWith('src/')||f.path.startsWith('supabase/tests/')||f.path.startsWith('scripts/'))&&/\.(ts|tsx|sql|mjs)$/.test(f.path)&&!f.path.startsWith('scripts/qa/reconciliation/'))fileIndex.push({path:f.path,text:await readFile(f.path,'utf8')})
}
const refCache=new Map(),bodyCache=new Map(),appCache=new Map()
const refsFor=o=>{
 const k=objectKey(o);if(!refCache.has(k)){
  const exact=referencesFor(o,sources),parent=['constraint','policy','trigger','column'].includes(o.kind)?referencesFor({...o,kind:'relation',name:o.name.split('.')[0]},sources):[]
  refCache.set(k,{exact,parent})
 }
 return refCache.get(k)
}
const matchesFor=o=>{const k=o.schema+'.'+o.name+hash(o.definition);if(!bodyCache.has(k))bodyCache.set(k,bodyMatches(o,sources));return bodyCache.get(k)}
const usageFor=o=>{
 const name=['constraint','policy','trigger','column'].includes(o.kind)?o.name.split('.')[0]:o.name
 if(!appCache.has(name))appCache.set(name,fileIndex.flatMap(f=>{
  if(!f.text.includes(name))return []
  return [{path:f.path,lineNumbers:f.text.split('\n').flatMap((l,i)=>l.includes(name)?[i+1]:[]),scope:'TEXT_REFERENCE_NOT_BEHAVIORAL_PROOF'}]
 }))
 return appCache.get(name)
}
function feature(o,refs){
 const s=(o.name+' '+refs.map(r=>r.featureSet+' '+r.path.split('/').at(-1)).join(' ')).toLowerCase(),n=o.name.toLowerCase()
 if(/super_admin|^sa3_|administrar_fundo|auditoria_fundo|auditoria_usuario|autorizacao_acao|papel_primario/.test(n))return 'hybrid admin'
 if(/sequenci|sequencial/.test(n))return 'Integrations / CNAB / RLX'
 if(/companion/.test(n))return 'DOC/DANFE / RLX shared fiscal intake'
 if(/postergacao|evidencia|pos_cessao/.test(n))return 'CERC/logística'
 if(/anbima|pascoa|resultado_financeiro/.test(n))return 'P17/C2'
 if(/dashboard_gestor|relatorio_gestor/.test(n))return 'GUIBOR A5/A6 / Gestor analytics'
 if(/cnpj_valido|estabelecimento_pode|^get_user_|contexto_multifundo|contexto_operacao/.test(n))return 'core multifundo / cadastro e operações'
 if(/aprovar_operacao/.test(n))return 'P17/C2 / operação e risco'
 if(/parcelas_nota|requisito_publicado/.test(n))return 'DOC/DANFE'
 if(/notific|notification/.test(n))return 'Notifications'
 if(/email04|email_automation|email_intake/.test(n))return /operator/.test(n)?'RLX UI05':/health|automation|lease|dispatch|subscription/.test(n)?'RLX automation':'RLX transport'
 if(/fiscal_intake|fiscal_identity/.test(n))return 'RLX shared fiscal intake'
 if(/nfse|fiscal_net|fatos_fiscais/.test(n))return 'HEALTH'
 if(/sacado/.test(n)&&!n.startsWith('cedentes.sacado_'))return 'SACADO'
 if(/consultor|consultoria/.test(n))return 'C5/LEITOR'
 if(/comissao|base_calculo|guibor|analytics/.test(n))return 'GUIBOR A5/A6'
 if(/taxas_cedente|calculo|taxa_proposta/.test(n))return 'P17/C2'
 if(/cancelad|liberar_nf/.test(n))return 'P16'
 if(/credencial/.test(n))return /inline/.test(s)?'Inline credentials':'Integrations credential-first'
 if(/cnab|integracao|aquisic|carteira|estoque|liquidacoes_atuais|retornos_/.test(n))return /vortx/.test(n)?'Vórtx':'Integrations / CNAB / RLX'
 if(/webhook|entrega|ctes|cte_|canhoto|logistic|desembols/.test(n))return 'CERC/logística'
 if(/document|duplicata|comunicac|template/.test(n))return 'DOC/DANFE'
 if(/usuario_papeis|admin_|mfa_|seguranca|sessoes_elevadas|autorizacoes_acoes/.test(n))return 'hybrid admin'
 if(/cedente|representantes|escrow|testemunhas|devedores|usuario_fundos|^fundos|politica|eventos_dominio|logs_auditoria|operacoes|notas_fiscais/.test(n))return 'core multifundo / cadastro e operações'
 if(/rlx/.test(n))return 'RLX transport'
 if(/storage|handle_new_user|update_updated_at|auth|profile/.test(n))return 'platform/runtime (application-owned)'
 return refs.length?'shared application / '+[...new Set(refs.map(r=>r.featureSet??'BASELINE'))].join('+'):'unknown'
}
const diffRows=[],master=[],aclRows=[],columnRows=[],functionRows=[],policyRows=[],triggerRows=[],constraintRows=[],indexRows=[]
const docSources=[{url:'https://www.postgresql.org/docs/17/ddl-priv.html',use:'ACL codes, grantor/grantee, ownership, privileges are distinct from RLS'},{url:'https://www.postgresql.org/docs/17/ddl-rowsecurity.html',use:'Permissive policies combine with OR; no automatic removal'},{url:'https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes',use:'Reviewed; no server upgrade or extension change in this offline round'}]
const schedulerPath='scripts/email-intake/automation-scheduler.mjs',scheduler=await readFile(schedulerPath,'utf8')
assert(scheduler.includes("assert(['preview','homolog'].includes(mode))"));assert(scheduler.includes("'PRODUCTION_FORBIDDEN'"))
const aclNote='R1.13 captures sorted coalesce(relacl,acldefault(...)), not pg_class.relacl NULL provenance. Original captured array is preserved verbatim. No claim that role membership or browser reachability was revalidated.'
for(const d of target.differences){
 const values=paths.map(p=>d.objects[p]),o=values.find(Boolean),r=refsFor(o),related=[...new Map([...r.exact,...r.parent].map(x=>[x.version,x])).values()]
 const aclOnly=d.changedFields.join(',')==='acl',parent=o.name.split('.')[0],usage=usageFor(o)
 let category='MANUAL_DECISION_REQUIRED',reason='Observed state is not sufficient to choose intended canonical semantics.',targetState=null,forward='UNDECIDED',manual=true,confidence='LOW',unresolved=true,data=false,preflight=null
 let group='OBJECT:'+o.schema+'.'+o.name,proof=null
 const sourceMatches=o.kind==='function'?Object.fromEntries(paths.map(p=>[p,d.objects[p]?matchesFor(d.objects[p]):[]])):Object.fromEntries(paths.map(p=>[p,[]]))
 const provenance=Object.fromEntries(paths.map(p=>[p,pathProvenance(p,d.objects[p],related,baselines,manifest,sourceMatches[p])]))
 const composedProof=o.kind==='function'?composed.checks.find(c=>c.name===o.schema+'.'+o.name):null
 if(composedProof)for(const p of paths)provenance[p]={...provenance[p],status:'COMPOSED_CANONICAL_BODY_SOURCE_MATCH',composedProof,lastIntentionalChange:composedProof.sourceChain.at(-1),aclProvenanceSeparate:true}
 if(aclOnly){
  const relationObjects=paths.map(p=>catalogs[p].find(x=>x.kind==='relation'&&x.schema===o.schema&&x.name===parent))
  assert(relationObjects.every(Boolean),'MISSING_PARENT_RELATION')
  for(let i=0;i<3;i++)assert.deepEqual(values[i].acl,relationObjects[i].acl,'NOT_THE_PARENT_ACL')
  const expanded=relationObjects.map(v=>aclEntries(v.acl))
  const added=expanded[0].filter(x=>!expanded[2].some(y=>equal(x,y)))
  const removed=expanded[2].filter(x=>!expanded[0].some(y=>equal(x,y)))
  assert.equal(removed.length,0);assert(added.length>0);assert(added.every(x=>['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'].includes(x.privilege)))
  group=added.some(x=>x.grantee==='service_role')?'ACL:SERVICE_ROLE_RESIDUAL_DXTM':'ACL:AUTHENTICATED_RESIDUAL_DXTM'
  reason='PROD/HOMOLOG retain D/x/t/m privileges absent in clean-room. Known P2.6.4 revokes selected authenticated DML, not these privileges; default privileges are changed for future objects. This explains persistence, not original grant intent. No blanket revoke/grant justified.'
  confidence='HIGH_OBSERVATION_LOW_TARGET'
  proof={parentRelation:o.schema+'.'+parent,inheritedAclSurface:o.kind!=='relation',expanded,liveMinusCleanroom:added,cleanroomMinusLive:removed,relatedHardening:sourceRef(sources.find(s=>s.entry.version==='20260817150507'))}
  if(o.kind==='relation'){
   const roleNames=[...new Set(['postgres','anon','authenticated','service_role','PUBLIC',...expanded.flat().map(a=>a.grantee)])]
   aclRows.push({relation:o.schema+'.'+o.name,object_key:d.key,raw:Object.fromEntries(paths.map((p,i)=>[p,values[i].acl])),captureSemantics:aclNote,expandedPrivileges:Object.fromEntries(paths.map((p,i)=>[p,Object.fromEntries(roleNames.map(role=>[role,expanded[i].filter(a=>a.grantee===role)]))])),provenance,feature:feature(o,related),securityRationale:reason,targetAcl:null,targetCategory:category,targetRationale:'MANUAL_DECISION_REQUIRED: establish intended privileges and effective callers before changing any ACL',relationState:Object.fromEntries(paths.map((p,i)=>[p,values[i].definition])),effectivePolicies:Object.fromEntries(paths.map(p=>[p,catalogs[p].filter(x=>x.kind==='policy'&&x.schema===o.schema&&x.name.startsWith(o.name+'.'))])),applicationReferences:usage,testsRequired:['Exact role privilege assertions including negative D/x/t/m cases','Browser and SECURITY DEFINER/RPC flows','service_role job and Storage flows','A6/C5/SACADO/Notifications cross-fund and MFA regression'],proof})
  }
 }else if(o.kind==='function'&&values.every(Boolean)){
  const sem=values.map(v=>functionSemantics(v.definition))
  if(sem.every(v=>equal(v,sem[0]))&&values.every(v=>equal(v.acl,values[0].acl)&&v.owner===values[0].owner)){
   category='REPRESENTATION_ONLY';group='FUNCTION:LEXICAL_REPRESENTATION';manual=false;unresolved=false;forward='NO';confidence='HIGH'
   targetState={action:'PRESERVE_CURRENT_SEMANTICS_PER_PATH',semanticTokenHash:hash(JSON.stringify(sem[0])),definitions:values.map(v=>hash(v.definition)),owner:o.owner,acl:o.acl}
   reason='Function header, ordered executable tokens, string/identifier/dollar literals, tail, owner and ACL match. Only code whitespace/comments differ; no SQL rewrite or broad comparator normalization.'
   assert(sourceMatches.cleanroom.length||composedProof,'REPRESENTATION_WITHOUT_BODY_PROVENANCE')
   proof={kind:'OFFLINE_LEXICAL_IDENTITY',negativeControls:'r1-14-analysis.test.mjs',sourceMatches:sourceMatches.cleanroom.length,composedProof,rawDefinitionsChanged:false}
  }else{
   group='FUNCTION:CORRIGIR_DUPLICATA_ENCODING'
   assert.equal(o.name,'corrigir_duplicata','NEW_FUNCTIONAL_DIFFERENCE_STOP')
   reason='LIKE pattern for aceite_textual has different mojibake literals. Both observed spellings need functional intent confirmation; neither path wins automatically. Preserve rejection/audit behavior; explicit Portuguese/ASCII/encoding negative tests required.'
   proof={differentLiteralTokens:paths.map((p,i)=>({path:p,literals:sem[i].body.filter(t=>t.type==='literal'&&/Ã|Â/.test(t.value))}))}
  }
 }else if(o.kind==='function'&&o.name==='email04_dispatch'){
  assert(!values[0]&&values[1]&&!values[2])
  const security=functionSecurity(values[1]);assert.equal(security.security,'DEFINER');assert.equal(security.publicExecute,false);assert.equal(security.authenticatedExecute,false);assert.equal(security.serviceRoleExecute,false)
  assert(values[1].definition.includes('vault.decrypted_secrets'));assert(values[1].definition.includes('net.http_post'))
  category='ENV_SPECIFIC_EXPECTED';group='RUNTIME:HOMOLOG_SCHEDULER';unresolved=false;manual=false;forward='NO';confidence='HIGH'
  targetState={prod:'KEEP_ABSENT',homolog:'PRESERVE_ENVIRONMENT_OBJECT',cleanroom:'KEEP_ABSENT',activateScheduler:false}
  reason='Explicit scheduler helper managed by activation script restricted to Preview/homolog, forbidden in production; not a promotion migration. Secrets are referenced through Vault, never extracted.'
  proof={path:schedulerPath,sha256:hash(scheduler),lines:[13,14,46,56,57,60],security}
  provenance.homolog={...provenance.homolog,status:'ENVIRONMENT_SCRIPT_SOURCE_IDENTIFIED',lastIntentionalChange:proof}
 }else if(o.kind==='column'){
  const presence=values.some(v=>!v),components=changedComponents(d.objects)
  group=presence?'BASELINE:CEDENTE_ESCROW_COLUMNS':'BASELINE:TIMESTAMP_NULLABILITY'
  reason=presence?'The four nullable escrow columns originate in restored baseline 002, not a newly authorized homolog feature. Prod absence has no intentional DROP found in pinned migrations. Do not resurrect or delete automatically.':'NOT NULL exists in restored baseline 002 and homolog/clean-room; prod permits NULL. No verified intentional ALTER found for prod state. A default does not prove historical non-null data.'
  data=!presence
  if(data)preflight=`SELECT count(*) AS null_count FROM public."${parent}" WHERE "${o.name.split('.').at(-1)}" IS NULL;`
  columnRows.push({object_key:d.key,column:o.schema+'.'+o.name,states:d.objects,components:Object.fromEntries(paths.map((p,i)=>[p,values[i]?{present:true,nullable:!values[i].definition.notNull,type:values[i].definition.type,typmod:'Encoded in format_type; raw atttypmod not captured',default:values[i].definition.default,collation:values[i].definition.collation,identity:values[i].definition.identity,generated:values[i].definition.generated}:{present:false}])),changedComponents:components,provenance,feature:feature(o,related),applicationAssumptions:usage,target:null,targetCategory:category,rationale:reason,DATA_COMPAT_CHECK_REQUIRED:data,FUTURE_PREFLIGHT_QUERY:preflight,preflightExecuted:false,baselineSource:sourceRef(sources.find(s=>s.entry.version==='002'))})
 }else if(o.kind==='constraint'&&['comunicacoes_remetente_nome_check','documento_upload_intents_storage_path_check'].includes(o.name.split('.').at(-1))){
  const name=o.name.split('.').at(-1),prior=captureReports.prod.fidelity.constraints.find(c=>c.name===name)
  assert.equal(prior.result,'PASS');assert.equal(prior.negativeControl,'PASS')
  for(const v of values)assert([prior.remote.definition,prior.restored.definition].includes(v.definition.ddl),'CONSTRAINT_PROOF_PAIR_DOES_NOT_MATCH')
  assert(values.every(v=>v.definition.validated&&!v.definition.deferrable&&!v.definition.deferred))
  category='REPRESENTATION_ONLY';group='CONSTRAINT:PROVEN_AND_REASSOCIATION';manual=false;unresolved=false;confidence='HIGH';forward='NO'
  targetState={action:'KEEP_EXISTING_SEMANTICS',acceptedExactDefinitions:[prior.remote.definition,prior.restored.definition]}
  reason='Current three-way definition pairs exactly match previously proven reparse/behavior pairs, including negative control. No generic parenthesis stripping.'
  proof={source:'R1_13_PROD_UPGRADE.json:fidelity.constraints',sourceSha256:hash(await readFile(root+'R1_13_PROD_UPGRADE.json')),name,exactPairVerified:true,priorCases:prior.behavior.reduce((n,b)=>n+b.cases.length,0),negativeControl:'PASS',rerun:false}
 }else if(o.kind==='constraint'){
  group=parent==='taxas_cedente'?'CONSTRAINT:TAXAS_RANGE': 'CONSTRAINT:ADMIN_ORIGEM'
  reason=parent==='taxas_cedente'?'Prod combined CHECK also validates nonnegative prazo_min and prazo_max >= prazo_min; homolog/clean-room only nonnegative rate. Not name-only equivalence. Prod intentional source not found; document desired bounds and data preflight before composing.':'Prod additionally allows bootstrap_producao. No source found in versioned migrations across local Git refs; do not remove permitted historical value or promote an unverified admin permission.'
  data=true
  preflight=parent==='taxas_cedente'?'SELECT count(*) AS incompatible_count FROM public.taxas_cedente WHERE prazo_min < 0 OR prazo_max < prazo_min OR taxa_percentual < 0;':"SELECT count(*) AS affected_count FROM public.usuario_papeis WHERE origem = 'bootstrap_producao';"
 }else if(o.kind==='policy'){
  group='POLICY:LEGACY_PROD_EXTRA'
  reason='Additional prod-only PERMISSIVE SELECT policy. Its expression combines with other policies by OR and may widen access. Compare all policies, role/organization/fund paths and later security fixes; absence elsewhere does not authorize DROP.'
 }else if(o.kind==='index'){
  group='INDEX:LEGACY_TAXAS';reason='Prod-only standalone nonunique btree(cedente_id); no equivalent index found by this exact name. Preserve pending source/performance/dependency review. No automatic DROP.'
 }
 const securitySensitive=aclOnly||['function','policy','trigger'].includes(o.kind)||o.name.includes('usuario_papeis')
 const tests=usage.filter(u=>/test|spec|smoke/.test(u.path))
 const row={OBJECT_KEY:d.key,KIND:o.kind,FEATURE:feature(o,related),PATTERN:pattern(d.objects),PROD_STATE:d.objects.prod,HOMOLOG_STATE:d.objects.homolog,CLEANROOM_STATE:d.objects.cleanroom,PROD_PROVENANCE:provenance.prod,HOMOLOG_PROVENANCE:provenance.homolog,CLEANROOM_PROVENANCE:provenance.cleanroom,LATEST_INTENTIONAL_CHANGE:unresolved?null:(sourceMatches.cleanroom.at(-1)??proof),SECURITY_IMPACT:{sensitive:securitySensitive,reason:securitySensitive?'Privileges, RLS, security-definer or authorization-adjacent object; preserve current protections':'No direct ACL change identified'},DATA_IMPACT:{compatibilityRequired:data,presenceChange:values.some(v=>!v),reason},TARGET_CATEGORY:category,TARGET_STATE:targetState,RATIONALE:reason,FORWARD_REQUIRED:forward,DATA_COMPAT_CHECK_REQUIRED:data,FUTURE_PREFLIGHT_QUERY:preflight,TEST_EVIDENCE:{existingReferences:tests,priorFeatureRegression:'R1_13_FULL_SQL.json (historical evidence, not proof of this new target)',decisionProof:proof},CONFIDENCE:confidence,MANUAL_APPROVAL_REQUIRED:manual,UNRESOLVED_INTENT:unresolved,ROOT_CAUSE_GROUP:group,EXACT_SOURCE_REFERENCES:r.exact,RELATED_SOURCE_REFERENCES:r.parent,APPLICATION_REFERENCES:usage,AUTOMATIC_RECONCILIATION_PROPOSED:false}
 master.push(row)
 const rawRow={object_key:d.key,object_kind:o.kind,schema:o.schema,object_name:o.name,identifier:o.signature||o.name,initial_classification:d.classification,pattern:row.PATTERN,changed_fields:d.changedFields,changed_definition_components:changedComponents(d.objects),root_cause_group:group}
 for(const [i,p] of paths.entries())Object.assign(rawRow,{[p+'_present']:!!values[i],[p+'_definition']:values[i]?.definition??null,[p+'_definition_hash']:values[i]?hash(JSON.stringify(values[i].definition)):null,[p+'_object_hash']:values[i]?.hash??null,[p+'_owner']:values[i]?.owner??null,[p+'_acl']:values[i]?.acl??null,[p+'_nullable']:o.kind==='column'&&values[i]?!values[i].definition.notNull:null})
 diffRows.push(rawRow)
 if(o.kind==='function')functionRows.push({object_key:d.key,states:Object.fromEntries(paths.map((p,i)=>[p,values[i]?functionSecurity(values[i]):null])),provenance,decision:category,group,proof,reason,wrapperDelegateEvidence:'Only directly referenced functions; dynamic SQL must be separately reviewed'})
 if(o.kind==='policy')policyRows.push({object_key:d.key,states:d.objects,definitionDiffers:!aclOnly,aclOnlyParentEffect:aclOnly,relation:o.schema+'.'+parent,provenance,decision:category,reason,effectivePolicySets:Object.fromEntries(paths.map(p=>[p,catalogs[p].filter(x=>x.kind==='policy'&&x.schema===o.schema&&x.name.startsWith(parent+'.'))]))})
 if(o.kind==='trigger')triggerRows.push({object_key:d.key,states:d.objects,definitionDiffers:!aclOnly,aclOnlyParentEffect:aclOnly,provenance,decision:category,reason,ordering:'Same trigger name and DDL in all three paths; no order change',decomposition:values.map(v=>({timing:/\b(BEFORE|AFTER|INSTEAD OF)\b/.exec(v.definition.ddl)?.[1]??null,events:v.definition.ddl.split(/\bON\b/)[0],when:/\bWHEN\s+([\s\S]*?)\s+EXECUTE/.exec(v.definition.ddl)?.[1]??null,function:/EXECUTE (?:FUNCTION|PROCEDURE) ([\s\S]*)$/.exec(v.definition.ddl)?.[1]??null,enabled:v.definition.enabled,functionOwner:v.definition.functionOwner,ddl:v.definition.ddl}))})
 if(o.kind==='constraint')constraintRows.push({object_key:d.key,states:d.objects,definitionDiffers:!aclOnly,aclOnlyParentEffect:aclOnly,type:o.definition.ddl.match(/^(CHECK|FOREIGN KEY|PRIMARY KEY|UNIQUE|EXCLUDE)/)?.[1]??'UNKNOWN',provenance,decision:category,reason,proof,DATA_COMPAT_CHECK_REQUIRED:data,FUTURE_PREFLIGHT_QUERY:preflight})
 if(o.kind==='index')indexRows.push({object_key:d.key,states:d.objects,unique:false,method:'btree',columns:['cedente_id'],predicate:null,include:[],opclass:'DEFAULT; raw OID not captured',constraintBacked:catalogs.prod.some(x=>x.kind==='constraint'&&/UNIQUE|PRIMARY KEY/.test(x.definition.ddl)&&x.name==='taxas_cedente.idx_taxas_cedente_id'),dependencyProof:'No constraint of this name in captured catalog; pg_depend proof still required before removal',otherIndexes:catalogs.prod.filter(x=>x.kind==='index'&&x.definition.includes('ON public.taxas_cedente ')),provenance,decision:category,reason})
}
assert.equal(master.length,897);assert.equal(aclRows.length,57);assert.equal(columnRows.length,7)
assert.equal(functionRows.length,179);assert.equal(policyRows.length,140);assert.equal(triggerRows.length,70)
assert(triggerRows.every(t=>t.aclOnlyParentEffect));assert.equal(policyRows.filter(p=>p.definitionDiffers).length,2)
const groups=Object.entries(Object.groupBy(master,r=>r.ROOT_CAUSE_GROUP)).map(([id,rs])=>({id,objectsAffected:rs.length,objects:rs.map(r=>r.OBJECT_KEY),features:[...new Set(rs.map(r=>r.FEATURE))],provenanceStatus:rs.some(r=>r.UNRESOLVED_INTENT)?'PARTIAL_OR_UNKNOWN_INTENT':'OBSERVATION_PROVEN',provenanceReferences:[...new Set(rs.flatMap(r=>[...r.EXACT_SOURCE_REFERENCES,...r.RELATED_SOURCE_REFERENCES].map(x=>x.version)))],rootCauseStatus:id.startsWith('ACL:')?'SHARED_PRIVILEGE_DELTA_PROVEN_ORIGINAL_GRANT_CAUSE_UNRESOLVED':'SEE_PER_OBJECT_PROOF',intendedFix:rs[0].RATIONALE,canonicalTarget:rs.every(r=>r.TARGET_STATE)?'PER_OBJECT_TARGETS_DEFINED':'BLOCKED_PENDING_DECISION',risk:rs.some(r=>r.SECURITY_IMPACT.sensitive)?'HIGH':'REVIEW_REQUIRED',tests:[...new Set(rs.flatMap(r=>r.TEST_EVIDENCE.existingReferences.map(x=>x.path)))],manualDecisions:rs.filter(r=>r.MANUAL_APPROVAL_REQUIRED).length,dataChecks:rs.filter(r=>r.DATA_COMPAT_CHECK_REQUIRED).length}))
const summary={rows:master.length,kind:countBy(master,r=>r.KIND),feature:countBy(master,r=>r.FEATURE),pattern:countBy(master,r=>r.PATTERN),targetCategory:countBy(master,r=>r.TARGET_CATEGORY),forwardRequired:countBy(master,r=>r.FORWARD_REQUIRED),manual:master.filter(r=>r.MANUAL_APPROVAL_REQUIRED).length,unresolved:master.filter(r=>r.UNRESOLVED_INTENT).length,dataCompatRows:master.filter(r=>r.DATA_COMPAT_CHECK_REQUIRED).length,distinctDataQueries:new Set(master.map(r=>r.FUTURE_PREFLIGHT_QUERY).filter(Boolean)).size,securitySensitive:master.filter(r=>r.SECURITY_IMPACT.sensitive).length,rootCauseGroups:groups.length,directRelationAclDecisions:57,automaticReconciliationProposals:0}
const intro='# R1.14 — diagnóstico offline de schema e ACL\n\nFontes: catálogos locais reconstruídos da R1.13; não é leitura atual de produção/homolog. Nenhuma mutation de schema/ACL, dado de negócio remoto, migration, CI ou deploy. JSON contém definições completas.\n\n'
const renderRows=rows=>rows.map(r=>'## '+(r.OBJECT_KEY??r.object_key??r.relation??r.column)+'\n\n```json\n'+JSON.stringify(r,null,2)+'\n```\n').join('\n')
const artifacts={
 R1_14_CATALOG_DIFF_RAW:{scope:'IMMUTABLE_R1_13_LOCAL_THREE_WAY',sourceSha256:target.sourceSha256,rows:diffRows,summary},
 R1_14_SCHEMA_ACL_DEPARA:{result:'DECISION_BLOCKED',ready:false,summary,rows:master,documents:docSources,limitations:['No global source precedence','No mutation or automatic reconciliation proposed','Source references are not automatically last intentional changes','ACL captures retain R1.13 effective fallback semantics; raw relacl NULL is not recoverable from that capture','Existing feature regression does not certify a new target','Unknown provenance remains explicitly manual and prevents readiness']},
 R1_14_RELATION_ACL_DEPARA:{rows:aclRows,count:aclRows.length,captureSemantics:aclNote},
 R1_14_NULLABILITY_DEPARA:{rows:columnRows,count:columnRows.length,futureQueriesExecuted:false},
 R1_14_FUNCTION_DEPARA:{rows:functionRows,count:functionRows.length},
 R1_14_POLICY_DEPARA:{rows:policyRows,count:policyRows.length},
 R1_14_TRIGGER_DEPARA:{rows:triggerRows,count:triggerRows.length},
 R1_14_CONSTRAINT_DEPARA:{rows:constraintRows,count:constraintRows.length},
 R1_14_INDEX_DEPARA:{rows:indexRows,count:indexRows.length},
 R1_14_ROOT_CAUSE_GROUPS:{groups,summary,groupingIsNotPermissionToApply:true},
 R1_14_SOURCE_INDEX:{sources:sources.map(s=>sourceRef(s)),excludedUnapprovedSourceEntries:manifest.CLEAN_ROOM_CANONICAL.entries.filter(e=>!e.source_kind).map(e=>({version:e.version,classification:e.classification,path:e.path})),sourceFailures:0,bytesExecuted:0,docs:docSources},
}
for(const [name,value] of Object.entries(artifacts))await writeFile(root+name+'.json',JSON.stringify(value,null,2)+'\n',{flag:'wx'})
for(const name of ['R1_14_CATALOG_DIFF_RAW','R1_14_SCHEMA_ACL_DEPARA','R1_14_RELATION_ACL_DEPARA','R1_14_NULLABILITY_DEPARA'])await writeFile(root+name+'.md',intro+'```json\n'+JSON.stringify(summary,null,2)+'\n```\n\n'+renderRows(artifacts[name].rows),{flag:'wx'})
console.log(JSON.stringify({stage:'DIAGNOSIS_REPORTS_WRITTEN',summary,groups:groups.map(g=>({id:g.id,count:g.objectsAffected})),remoteCalls:0}))
// Assert the baseline and source artefact cannot silently be mistaken for fresh live state.
assert.equal(manifest.PROD_TO_RECONCILED_UPGRADE.applyOrder.includes('20261005173648'),false)
assert.equal(hash(await readFile('supabase/migrations/20261005173648_sacado_rls_non_sacado_short_circuit.sql')),'1006e35b48f871c4f14a72f7a3f2045b1f40c13f4bb80d7efeda0e26be8df3ac')
assert.equal(gitBytes(['rev-parse','HEAD']).toString().trim(),checkpoint.head)
