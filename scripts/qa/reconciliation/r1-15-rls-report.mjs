import assert from 'node:assert/strict'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {hash} from './r1-4-restorer.mjs'
import {inventory} from '../../email-intake/disposable-resources.mjs'
import {classifyPolicy} from './r1-15-rls-classify.mjs'
import {gitBytes} from './r1-5-migration-source.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const dir='rehearsal/reports/',file='R1_15_RLS_1791405503672.json',read=async n=>JSON.parse(await readFile(dir+n,'utf8'))
const proof=await read(file),old=await read('R1_15_DECISION_PACKAGE.json'),oldStatus=await read('R1_15_STATUS.json'),cp=JSON.parse(await readFile(proof.checkpoint,'utf8'))
assert.equal(proof.result,'PASS_REAL_RLS_CAPTURE');assert.equal(proof.cleanup,'PASS');assert.equal(proof.runs.length,2)
const taxa=classifyPolicy(proof.comparisons,'taxas_cedente','WITHOUT_TAXAS_LEGACY'),devedores=classifyPolicy(proof.comparisons,'devedores_solidarios','WITHOUT_DEVEDORES_LEGACY')
assert.equal(taxa.classification,'REDUNDANT_REMOVE_FUTURE');assert.equal(devedores.classification,'MANUAL_DECISION_REQUIRED')
for(const c of proof.comparisons){assert.equal(c.added.length,0);assert.equal(c.legitimateLost.length,0)}
for(const run of proof.runs){
 for(const r of run.variants.find(v=>v.variant==='WITHOUT_BOTH').results)assert.deepEqual(r.ids,r.expectedCanonicalIds,'CANDIDATE_OUTSIDE_CANONICAL_CONTRACT:'+r.scenario)
 for(const c of proof.comparisons.filter(c=>c.projectId===run.projectId)){
  if(c.candidateVariant==='WITHOUT_TAXAS_LEGACY'&&c.table==='devedores_solidarios')assert.deepEqual(c.baseline,c.candidate)
  if(c.candidateVariant==='WITHOUT_DEVEDORES_LEGACY'&&c.table==='taxas_cedente')assert.deepEqual(c.baseline,c.candidate)
 }
}
const securityConstraints={testActor:'authenticated for all 2240 data SELECTs',rolsuper:false,rolbypassrls:false,tableOwner:false,rowSecurityActive:true,sessionReplicationRole:'origin',newTestGrants:false,changedOtherPolicies:false,changedOtherAclOrFunctionSecurity:false,historicalMigrationsEdited:false,syntheticDataIdenticalWithinVariants:true,independentStackResultsIdentical:true,remoteCalls:0,remoteWrites:0}
const conclusions=[
 {policy:'public.taxas_cedente.taxas_cedente_select',...taxa,userDecisionRequired:false,scope:'20 actors, 6 cedentes, 2 funds, 7 query shapes, independently repeated in 2 fresh stacks. No removal executed outside local transaction.',reasonPt:'Conjuntos idênticos antes/depois em todos os cenários do alvo; acesso delegado ADMIN/OPERACIONAL e acessos legítimos de Gestor/Consultor/Cedente preservados. Nenhum novo acesso.'},
 {policy:'public.devedores_solidarios.Cedentes podem ver seus devedores',...devedores,userDecisionRequired:true,reasonPt:'A policy antiga adiciona linhas por cedentes.user_id sem exigir papel Cedente nem vínculo Gestor ao Fundo. A RLS de cedentes ainda permite a linha por ownership; isso não constitui delegação ativa. O candidato preserva acesso delegado legítimo e elimina os extras nos casos testados.',extraAccessClassification:'AMPLIACAO_LEGADA_INDEVIDA_RELATIVA_AO_CONTRATO_CANONICO',notDelegatedProof:'Os dois atores com extras não têm cedente_acessos ativo para essas linhas. Um é Gestor vinculado somente ao Fundo B lendo devedor do Fundo A; outro é Consultor LEITOR, sem permissão canônica de SELECT de devedores.',decision:'MANUAL: confirmar aposentadoria desse alcance legado ou definir composição explícita. Não é policy redundante; não remover automaticamente.'},
]
const quality=[],exec=promisify(execFile)
const code=(await readdir('scripts/qa/reconciliation')).filter(f=>/^r1-15-rls.*\.mjs$/.test(f)).map(f=>'scripts/qa/reconciliation/'+f)
for(const [id,bin,args] of [['unit',process.execPath,['--test','scripts/qa/reconciliation/r1-15-rls.test.mjs']],['lint',process.execPath,['node_modules/eslint/bin/eslint.js','--max-warnings','0',...code]],['diff','git',['diff','--check']],['staged_diff','git',['diff','--cached','--check']]]){
 const {stdout,stderr}=await exec(bin,args,{windowsHide:true,maxBuffer:4*1024*1024,timeout:120000});quality.push({id,command:[bin,...args],result:'PASS',stdout,stderr})
}
for(const f of [...cp.files,...cp.reports])assert.equal(hash(await readFile(f.path)),f.sha256,'PRESERVATION_FAILURE:'+f.path)
assert.equal(gitBytes(['rev-parse','HEAD']).toString().trim(),cp.head)
assert.equal(gitBytes(['branch','--show-current']).toString().trim(),cp.branch)
assert.deepEqual(await inventory(),cp.docker)
const revised=structuredClone(old)
revised.at=new Date().toISOString();revised.revision='LOCAL_RLS_AUTHORIZED_COMPLEMENT';revised.supersedes='R1_15_DECISION_PACKAGE.json (preserved, historical no-RLS gate)'
revised.applicationDdl=true
revised.applicationDdlScope='AUTHORIZED_NEW_DISPOSABLE_LOCAL_STACKS_ONLY; canonical setup plus two policy variants, rolled back and resources removed. No remote DDL or forward implementation.'
revised.liveCatalogScope='Five read-only catalog calls belong to the earlier R1.15 evidence. This complement made zero remote calls; all new proof used locally assembled canonical stacks.'
revised.summary.ready=true;revised.summary.blockers=[];revised.summary.technicalMaterialKeys=61;revised.summary.userMaterialKeys=10
revised.summary.technicalPartialGroups=['H:taxas_cedente_select'];revised.summary.userGroups=['C','D','F','G','H:devedores_solidarios'];revised.summary.userDecisionsRequired=5
revised.rlsProof={file,sha256:hash(await readFile(dir+file)),constraints:securityConstraints,conclusions}
const h=revised.groups.find(g=>g.GROUP_ID==='DECISION-H')
h.RECOMMENDED_TARGET={taxas_cedente_select:'REDUNDANT_REMOVE_FUTURE','Cedentes podem ver seus devedores':'MANUAL_DECISION_REQUIRED'}
h.CONFIDENCE='HIGH_FOR_OBSERVED_MATRIX; MANUAL_BUSINESS_APPROVAL_FOR_LEGACY_SCOPE_CHANGE'
h.RATIONALE='Actual authenticated RLS A/B performed twice. Taxas: identical. Devedores: two actor scenarios expose legacy extra rows outside canonical contract, not active delegated access. Candidate preserves all declared legitimate row sets.'
h.SECURITY_IMPACT='See R1_15_RLS_REPORT.md: 20 non-bypass actors, active RLS, nested cedentes RLS intact, exact ACL/owner/function security preserved; cross-fund legacy-owner expansion demonstrated locally.'
h.TEST_PLAN_COMPLETED={stacks:2,actorsPerStack:20,queryShapesPerTable:7,dataSelects:2240,comparisons:1680,missingRealRlsProof:false}
h.TEST_PLAN=['Future forward regression after approval; same matrix plus production-target catalog refresh','No data rows from remote environments were inspected; do not infer occurrence of synthetic edge cases in production']
const fwd=revised.forwards.find(f=>f.id==='FWD-06')
fwd.prod='Taxas: future removal only after target/forward approval. Devedores: HOLD pending explicit legacy-scope decision.'
fwd.homolog='Retain existing canonical policies; no legacy introductions.';fwd.cleanroom=fwd.homolog
fwd.dependencies=['Approve exact target','Decide legacy devedores ownership expansion','Refresh target catalogs before any authorized rollout']
fwd.target=[{group:'DECISION-H',target:h.RECOMMENDED_TARGET}]
fwd.tests='Real A/B proof complete in this complement; future forward must rerun preservation/security regression.'
revised.localAuthorizedException='Only local disposable schema setup and the two named policy variants. No other policy/grant/security mutation after canonical assembly.'
await writeFile(dir+'R1_15_RLS_DECISION_PACKAGE.json',JSON.stringify(revised,null,2)+'\n',{flag:'wx'})
const labelIds=ids=>ids.length?ids.map(id=>{const c=proof.runs[0].fixture.cedentes.find(c=>c.taxaId===id||c.devedorId===id);assert(c);return c.key}).join(', '):'—'
const b=proof.runs[0].variants[0].results,t=proof.runs[0].variants[1].results,d=proof.runs[0].variants[2].results
const tableRows=proof.runs[0].fixture.actors.map(a=>{
 const find=(rs,table)=>rs.find(r=>r.scenario===a.name+':'+table+':ALL').ids
 return `| ${a.name} | ${a.role}${a.papel?' / '+a.papel:''} | ${a.funds.join(', ')||'sem vínculo'} | ${labelIds(find(b,'taxas_cedente'))} → ${labelIds(find(t,'taxas_cedente'))} | ${labelIds(find(b,'devedores_solidarios'))} → ${labelIds(find(d,'devedores_solidarios'))} |`
})
const md=[
 '# R1.15 — prova real de RLS concluída','',
 '**RLS_PROOF = PASS. DECISION_PACKAGE_READY = YES, para decisão, não para rollout.** A autorização posterior permitiu montar schema somente em stacks locais novas. Este complemento supera o bloqueio técnico anterior; todos os relatórios anteriores foram preservados byte a byte.','',
 '## Resultado por policy','',
 '| Policy antiga | Prova A/B | Classificação |','| --- | --- | --- |',
 '| taxas_cedente_select | Nenhuma diferença de IDs; nenhum acesso legítimo perdido ou novo acesso | REDUNDANT_REMOVE_FUTURE |',
 '| Cedentes podem ver seus devedores | Linhas extras por ownership legado em Gestor de outro Fundo e Consultor LEITOR | MANUAL_DECISION_REQUIRED |','',
 'A retirada da policy de devedores **não é tratada como remoção de redundância**, pois altera o conjunto permitido. Os extras são ampliação indevida frente ao contrato canônico testado, não acesso delegado legítimo. Decidir explicitamente a aposentadoria desse alcance ou uma composição autorizada. Nenhum ajuste remoto ou forward foi feito.','',
 '## Método e preservação','',
 '- Duas stacks Supabase independentes montadas com 264 fontes canônicas verificadas por hash em cada uma; sem leitura ou escrita remota. Montagem usa administrador local, mas **nenhuma consulta de acesso é executada como administrador/owner**.',
 '- Após a montagem, apenas as duas policies em análise foram materializadas a partir do catálogo já capturado. Quatro variantes: baseline com ambas, sem taxas, sem devedores, sem ambas. Cada retirada foi transacional e revertida.',
 '- 20 atores, 6 cedentes, 2 Fundos, 2 tabelas, 7 formatos de consulta (global e cada cedente): **2.240 SELECTs de dados**, **1.680 comparações baseline/candidate**. As duas stacks retornaram conjuntos idênticos entre si.',
 '- Todas as consultas: current_user authenticated; rolsuper=false; rolbypassrls=false; não-owner; row_security_active=true; session_replication_role=origin; auth.uid()/claims/papel de domínio conferidos.',
 '- O login web, token assinado e MFA interativo não fazem parte deste ensaio SQL. Claims são sintéticas coerentes com os usuários criados pelo Auth trigger. Não se usou service_role como ator.',
 '- RLS nunca foi desabilitada. Nenhuma policy fora das duas-alvo mudou após a montagem. ACLs de relações/funções/schemas, owners, search_path, security-definer, flags RLS, roles e triggers foram comparados a cada variante. As 57 ACLs revisadas conferem com o clean-room certificado.',
 '- Dados e atores não mudaram entre variantes: fingerprints completos de 15 tabelas sintéticas antes/depois; consultas/claims/IDs iguais. Os profiles foram criados pelo trigger canônico, conferidos exatamente uma vez por usuário e não ajustados. Controles negativos de atributo crítico passaram.',
 '- Recursos criados pelo ensaio removidos ao final; inventário Docker inicial preservado. Migrations históricas e todo o trabalho anterior preservados.','',
 '## Matriz compacta (consulta global)','',
 'As letras identificam cedentes sintéticos, não dados reais. A2 é outro cedente do Fundo A; REV é owner com associação revogada; LEITOR_OWNER e GESTOR_OWNER são owners legados com outros papéis. O JSON contém IDs exatos, filtros, queries, claims, conjuntos de policies e hashes por cenário.','',
 '| Ator | Papel | Fundos autorizados | Taxas: baseline → sem policy | Devedores: baseline → sem policy |','| --- | --- | --- | --- | --- |',...tableRows,'',
 'Além da consulta global, a matriz repete filtros diretos por cada cedente, incluindo o outro Fundo e ownership alheio. Os casos delegado ADMIN e OPERACIONAL mantêm as mesmas linhas; delegado/owner revogado não recupera acesso pela policy antiga. LEITOR comum não recebe taxas ou devedores.','',
 '## Explicação das linhas adicionais','',
 '1. **Gestor B / owner legado de cedente A:** baseline mostra devedor B legítimo e devedor A extra. Sem a policy antiga, só B permanece. O ator não tem usuario_fundos ativo em A nem cedente_acessos ativo para essa linha.',
 '2. **Consultor LEITOR / owner legado:** baseline mostra o devedor do cedente legado. Sem a policy antiga, não mostra devedores, como as policies canônicas desse domínio determinam. Não há delegação ativa de Cedente para esse ator.',
 'A causa local é a composição: a policy antiga usa cedentes.user_id = auth.uid(), e a policy aninhada cedentes_acesso_select aceita get_user_cedente_id() sem exigir papel Cedente. O fallback de owner desse helper mantém a linha visível na subconsulta. A policy canônica de devedores exige papel Cedente + associação/owner resolvido, ou Gestor com acesso ao Fundo. O ensaio preservou esses helpers e todas as policies aninhadas.','',
 'Isso não afirma que esses vínculos existam em produção: nenhum business row remoto foi consultado. A evidência prova o comportamento dos casos sintéticos autorizados.','',
 '## Estado do pacote','',
 '- 71 chaves materiais: 61 agora têm proposta técnica; 10 permanecem concentradas em cinco decisões (C, D, F, G e H/devedores).',
 '- Continuam sete pacotes de forward propostos, cinco preflights agregados principais e um condicional para retirada de escrow. Nenhuma consulta de dados reais foi executada.',
 '- Taxas pode sair do bloqueio técnico de H. Devedores exige decisão de negócio/segurança; não foi removida automaticamente.',
 '- Não houve build, CI, full SQL geral ou smoke web nesta complementação; somente ensaio RLS dirigido, testes dos helpers, lint e diff checks. Não representa autorização de deploy.','',
 '## Artefatos','',
 `[Prova completa](${file}) · [Pacote revisado](R1_15_RLS_DECISION_PACKAGE.json) · [Decisões restantes](R1_15_RLS_USER_DECISIONS.md) · [Status](R1_15_RLS_STATUS.json).`,
 '',
 'As skills Supabase/PostgreSQL orientaram a verificação do ator efetivo, a separação ACL/RLS e a comparação sem grants adicionais. Referências de execução: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) e [PostgreSQL SET ROLE](https://www.postgresql.org/docs/17/sql-set-role.html).','',
 'Após decisão dos alvos, ainda será necessária uma rodada separada e autorizada para implementar forwards e reexecutar a certificação correspondente.','',
]
await writeFile(dir+'R1_15_RLS_REPORT.md',md.join('\n'),{flag:'wx'})
const human=`# R1.15 — decisões após a prova real de RLS\n\n**Pacote pronto para decidir alvos, não para executar migrations ou rollout.** O bloqueio de prova local foi resolvido. Produção e homolog não foram consultados nem alterados nesta complementação.\n\nContinuam cinco decisões, agora com H restrito a devedores:\n\n- **C — Escrow:** decidir manter campos nullable como contrato ou aposentá-los. Existem em homolog/clean-room, não só clean-room; não remover automaticamente. Retirada exige preflight agregado e destino explícito para dados preenchidos.\n- **D — Timestamps:** recomendação NOT NULL condicionada a três contagens de NULL iguais a zero. Alternativa nullable exige contrato deliberado. Nunca inventar datas históricas.\n- **F — bootstrap_producao:** confirmar a legitimidade do rótulo de auditoria antes de propagar/retirar. Proveniência intencional ainda não demonstrada; preflight de ocorrência somente após aprovação.\n- **G — Encoding da duplicata:** decidir UTF-8 correto + compatibilidade explícita com os padrões malcodificados observados; decidir também se “sem” isolado deve alinhar com o parser. Preservar histórico e autorização.\n- **H — Devedores:** a policy antiga dá acesso extra por ownership legado a Gestor de outro Fundo e Consultor LEITOR. Não é delegação legítima no contrato testado. Recomendo decidir explicitamente a retirada desse alcance; alternativa é definir uma composição restrita com novo contrato e testes. **Não remover automaticamente e não classificar como redundante.**\n\n**Taxas:** a policy antiga taxas_cedente_select é REDUNDANT_REMOVE_FUTURE na matriz autenticada executada duas vezes, com acesso delegado/operacional preservado. A remoção continua sendo apenas proposta para forward futuro autorizado.\n\nAs propostas técnicas anteriores de ACL, service_role CRUD, CHECK de taxas e índice permanecem. Detalhes e risco de cada decisão: [pacote anterior preservado](R1_15_USER_DECISIONS.md); evidência atual: [prova RLS](R1_15_RLS_REPORT.md) e [manifest revisado](R1_15_RLS_DECISION_PACKAGE.json).\n`
await writeFile(dir+'R1_15_RLS_USER_DECISIONS.md',human,{flag:'wx'})
const status={...Object.fromEntries(Object.entries(oldStatus).filter(([k])=>/^(R1_15_|PRODUCTION_|HOMOLOG_|DOCKER_)/.test(k))),at:new Date().toISOString(),result:'DECISION_PACKAGE_READY_FOR_USER_TARGET_DECISIONS',R1_15_DECISION_PACKAGE_READY:'YES',R1_15_REAL_RLS_PROOF:'PASS',R1_15_POLICY_ANALYSIS:'MANUAL',policyAnalysisMeaning:'Proof complete; devedores target requires explicit decision because row set changes.',R1_15_USER_DECISIONS_REQUIRED:5,technicalMaterialKeys:61,manualMaterialKeys:10,conclusions,securityConstraints,quality,preserved:proof.preservation,proof:{path:dir+file,sha256:hash(await readFile(dir+file)),queryCount:2240,comparisonCount:1680,stacks:proof.stacks.map(s=>({projectId:s.projectId,result:s.result,cleanup:s.cleanup,sources:s.applied.length}))},noCommitPushDeploy:true,fullSqlBuildCiRerun:false,remoteCallsThisComplement:0,limitations:['RLS proof covers captured canonical schema with exact two legacy policies; no new production catalog refresh or business data inspection.','No web login/MFA interactive smoke; actors were exercised directly through authenticated SQL role with coherent synthetic claims.','Devedores classification is relative to canonical role/fund/delegation contract; occurrence in real production records is unknown.']}
await writeFile(dir+'R1_15_RLS_STATUS.json',JSON.stringify(status,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({ready:'YES_FOR_DECISION_NOT_ROLLOUT',policy:conclusions.map(c=>({policy:c.policy,classification:c.classification,counts:c.counts})),preserved:proof.preservation,quality:quality.map(q=>[q.id,q.result]),cleanup:proof.cleanup}))
