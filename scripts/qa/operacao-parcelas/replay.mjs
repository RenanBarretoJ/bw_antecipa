// Integração SQL local em PostgreSQL 17 descartável. Sem acesso a ambientes remotos.
// Fixture estrutural reduzida: helpers financeiros e RPC de NF vêm das migrations
// reais; Auth/MFA/acesso a fundo usam doubles explícitos. Não substitui smoke autenticado.
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

const container=`bw-parcelas-qa-${randomUUID().slice(0,8)}`
const scope='operacao-parcelas-layout4'
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
const sql=text=>docker(['exec','-i',container,'psql','-h','127.0.0.1','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],text)
const source=name=>readFileSync(`supabase/migrations/${name}`,'utf8')
function func(text,name){const start=text.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);assert(start>=0,name);const end=text.indexOf('$$;',text.indexOf('AS $$',start));assert(end>start,name);return text.slice(start,end+3)}
const a5=source('20260929191004_guibor_a5_base_antecipacao.sql')
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const [op,nf1,nf2,p1,p2,actor,other,fund,cf]=[1,2,3,4,5,6,7,8,9].map(uid)
const call=(p=p1,nf=nf1)=>`SELECT public.remover_parcela_operacao_gestor_atomica('${op}','${nf}','${p}');`
const auth=`SET ROLE authenticated; SET request.jwt.claim.sub='${actor}'; SET qa.mfa='valid';`
let created=false
const checks=[]
try{
 docker(['run','-d','--name',container,'--label',`bw.scope=${scope}`,'--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']);created=true
 for(let i=0;i<60;i++){try{docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);break}catch{if(i===59)throw new Error('PostgreSQL indisponível');await new Promise(r=>setTimeout(r,500))}}
 sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE SCHEMA private;
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,nome_completo text,role text,status text DEFAULT 'ativo');
 CREATE TABLE public.cedente_fundos(id uuid PRIMARY KEY,fundo_id uuid,cedente_id uuid);
 CREATE TABLE public.qa_fundos(usuario_id uuid,fundo_id uuid);
 CREATE TABLE public.operacoes(id uuid PRIMARY KEY,cedente_id uuid,cedente_fundo_id uuid,status text,aprovado_em timestamptz,
 valor_bruto_total numeric,valor_liquido_desembolso numeric,taxa_desconto numeric,politica_snapshot jsonb,base_antecipacao_snapshot jsonb,
 calculo_data_base date,metodo_calculo_financeiro text,prazo_dias integer,data_vencimento date,calculo_memoria jsonb,aceite_sacado_exigido boolean,aceite_sacado_status text,aceite_sacado_em timestamptz);
 CREATE TABLE public.notas_fiscais(id uuid PRIMARY KEY,numero_nf text,status text,valor_bruto numeric,data_vencimento date,aprovacao_sacado_em timestamptz,valor_antecipado numeric,arquivo_original text);
 CREATE TABLE public.operacoes_nfs(operacao_id uuid REFERENCES public.operacoes,nota_fiscal_id uuid REFERENCES public.notas_fiscais,PRIMARY KEY(operacao_id,nota_fiscal_id));
 CREATE TABLE public.nota_fiscal_parcelas(id uuid PRIMARY KEY,nota_fiscal_id uuid REFERENCES public.notas_fiscais,numero_parcela integer,valor_nominal numeric,data_vencimento date,status text);
 CREATE TABLE public.operacoes_nf_parcelas(operacao_id uuid REFERENCES public.operacoes,nota_fiscal_id uuid REFERENCES public.notas_fiscais,parcela_id uuid UNIQUE REFERENCES public.nota_fiscal_parcelas);
 CREATE TABLE public.operacao_calculo_nfs(operacao_id uuid,nota_fiscal_id uuid,parcela_id uuid,valor_presente numeric);
 CREATE TABLE public.logs_auditoria(id uuid DEFAULT gen_random_uuid(),usuario_id uuid,ator_tipo text,origem text,tipo_evento text,entidade_tipo text,entidade_id uuid,dados_antes jsonb,dados_depois jsonb,created_at timestamptz DEFAULT now());
 CREATE TABLE public.eventos_dominio(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,fundo_id uuid,cedente_id uuid,cedente_fundo_id uuid,nota_fiscal_id uuid,operacao_id uuid,tipo_evento text,categoria text,ator_usuario_id uuid,ator_nome_snapshot text,ator_perfil_snapshot text,origem text,descricao text,metadata jsonb,visibilidade text,correlation_id text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION public.get_user_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT role FROM public.profiles WHERE id=auth.uid()$$;
 CREATE FUNCTION public.obter_sessao_mfa_atual() RETURNS TABLE(status text) LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('qa.mfa',true),''),'expired')$$;
 CREATE FUNCTION private.usuario_tem_acesso_fundo(f uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM public.qa_fundos WHERE usuario_id=auth.uid() AND fundo_id=f)$$;
 GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
 ${func(a5,'private.valor_base_antecipacao_snapshot')}
 ${func(a5,'private.proteger_base_antecipacao_snapshot')}
 CREATE TRIGGER operacoes_proteger_base_antecipacao BEFORE INSERT OR UPDATE ON public.operacoes FOR EACH ROW EXECUTE FUNCTION private.proteger_base_antecipacao_snapshot();
 ${func(source('20260929141740_p17_360_dias_corridos.sql'),'private.calcular_memoria_financeira_nf')}
 ${func(a5,'public.remover_nf_operacao_gestor_atomica')}
 `)
 sql(source('20261016134715_operacao_remover_parcela_atomica.sql'))
 const seed=()=>sql(`RESET ROLE; TRUNCATE public.eventos_dominio,public.logs_auditoria,public.operacao_calculo_nfs,public.operacoes_nf_parcelas,public.operacoes_nfs,public.nota_fiscal_parcelas,public.operacoes,public.notas_fiscais,public.cedente_fundos,public.profiles,public.qa_fundos CASCADE;
 INSERT INTO public.profiles(id,nome_completo,role) VALUES('${actor}','Gestor QA','gestor'),('${other}','Consultor QA','consultor');
 INSERT INTO public.cedente_fundos VALUES('${cf}','${fund}','${uid(10)}'); INSERT INTO public.qa_fundos VALUES('${actor}','${fund}');
 INSERT INTO public.operacoes(id,cedente_id,cedente_fundo_id,status,valor_bruto_total,valor_liquido_desembolso,taxa_desconto,politica_snapshot,base_antecipacao_snapshot,calculo_data_base,metodo_calculo_financeiro,prazo_dias,data_vencimento,aceite_sacado_exigido,aceite_sacado_status)
 VALUES('${op}','${uid(10)}','${cf}','em_analise',2000,1900,2,'{"calculo_financeiro":{"metodo":"TRINTA_360"}}',
 '{"itens":[{"nota_fiscal_id":"${nf1}","parcela_id":"${p1}","valor_base":400},{"nota_fiscal_id":"${nf1}","parcela_id":"${p2}","valor_base":600},{"nota_fiscal_id":"${nf2}","parcela_id":null,"valor_base":1000}]}', '2026-10-16','TRINTA_360',30,'2026-12-15',true,'pendente');
 INSERT INTO public.notas_fiscais VALUES('${nf1}','101','aceita',1000,'2026-12-15',now(),950,'original-101.xml'),('${nf2}','102','em_antecipacao',1000,'2026-11-15',NULL,950,'original-102.pdf');
 INSERT INTO public.operacoes_nfs VALUES('${op}','${nf1}'),('${op}','${nf2}');
 INSERT INTO public.nota_fiscal_parcelas VALUES('${p1}','${nf1}',1,400,'2026-11-15','cedida'),('${p2}','${nf1}',2,600,'2026-12-15','cedida');
 INSERT INTO public.operacoes_nf_parcelas VALUES('${op}','${nf1}','${p1}'),('${op}','${nf1}','${p2}');
 INSERT INTO public.operacao_calculo_nfs VALUES('${op}','${nf1}','${p1}',390),('${op}','${nf1}','${p2}',580);`)
 function verify(name,body){sql(`DO $$BEGIN ${body} END$$;`);checks.push(name)}
 function deny(name,change,code='42501'){
  seed();sql(change);sql(`BEGIN; ${auth} DO $$ BEGIN BEGIN PERFORM public.remover_parcela_operacao_gestor_atomica('${op}','${nf1}','${p1}'); RAISE EXCEPTION 'EXPECTED DENIAL'; EXCEPTION WHEN SQLSTATE '${code}' THEN NULL; END; END $$; ROLLBACK;`)
  assert.equal(sql('SELECT count(*) FROM public.operacoes_nf_parcelas'), '2');checks.push(name)
 }
 seed();const before=sql(`SELECT base_antecipacao_snapshot FROM public.operacoes WHERE id='${op}'`)
 sql(`${auth} ${call()}`)
 verify('retira só a parcela, preserva aceite da NF, memória restante e arquivos',`IF (SELECT count(*) FROM public.operacoes_nf_parcelas)<>1 OR (SELECT status FROM public.notas_fiscais WHERE id='${nf1}')<>'aceita' OR (SELECT status FROM public.nota_fiscal_parcelas WHERE id='${p1}')<>'disponivel' OR (SELECT status FROM public.nota_fiscal_parcelas WHERE id='${p2}')<>'cedida' OR (SELECT count(*) FROM public.operacao_calculo_nfs)<>1 OR (SELECT count(*) FROM public.operacoes_nfs)<>2 THEN RAISE EXCEPTION 'mutacao indevida'; END IF; IF (SELECT count(*) FROM public.notas_fiscais WHERE arquivo_original IS NOT NULL)<>2 THEN RAISE EXCEPTION 'arquivos alterados'; END IF;`)
 assert.equal(sql(`SELECT base_antecipacao_snapshot FROM public.operacoes WHERE id='${op}'`),before);checks.push('snapshot imutável preservado')
 verify('recalcula base congelada, líquido, prazo e vencimento',`IF (SELECT valor_bruto_total FROM public.operacoes)<>1600 OR (SELECT valor_liquido_desembolso FROM public.operacoes)<>1557.09 OR (SELECT prazo_dias FROM public.operacoes)<>41 OR (SELECT data_vencimento FROM public.operacoes)<>'2026-12-15'::date THEN RAISE EXCEPTION 'totais divergentes'; END IF;`)
 sql(`${auth} ${call()}`);verify('retry não duplica auditoria/histórico',`IF (SELECT count(*) FROM public.logs_auditoria WHERE tipo_evento='PARCELA_REMOVIDA_OPERACAO')<>1 OR (SELECT count(*) FROM public.eventos_dominio)<>1 THEN RAISE EXCEPTION 'duplicado'; END IF;`)
 sql(`${auth} ${call(p2)}`);verify('última parcela retira NF e preserva outra NF',`IF (SELECT count(*) FROM public.operacoes_nfs)<>1 OR (SELECT valor_bruto_total FROM public.operacoes)<>1000 OR (SELECT status FROM public.notas_fiscais WHERE id='${nf1}')<>'aprovada' THEN RAISE EXCEPTION 'ultima parcela'; END IF;`)
 deny('outro fundo negado','DELETE FROM public.qa_fundos;')
 deny('Consultor negado',`UPDATE public.profiles SET role='consultor' WHERE id='${actor}';`)
 deny('perfil inativo negado',`UPDATE public.profiles SET status='inativo' WHERE id='${actor}';`)
 deny('operação aprovada negada',`UPDATE public.operacoes SET status='aprovada',aprovado_em=now();`,'22023')
 seed();assert.throws(()=>sql(`BEGIN;${auth} SET qa.mfa='expired';${call()}COMMIT;`));checks.push('MFA expirado negado')
 seed();assert.throws(()=>sql(`${auth} ${call(p1,nf2)}`));assert.equal(sql('SELECT count(*) FROM public.operacoes_nf_parcelas'),'2');checks.push('parcela de outra NF negada')
 seed();assert.throws(()=>sql(`BEGIN;SET ROLE anon;${call()}COMMIT;`));checks.push('anon sem grant de execução')
 seed();assert.throws(()=>sql(`BEGIN;${auth} DELETE FROM public.operacoes_nf_parcelas;COMMIT;`));checks.push('authenticated sem DELETE direto')
 seed();sql(`UPDATE public.operacoes SET taxa_desconto=NULL;`);sql(`${auth} ${call()}`);assert.equal(sql('SELECT valor_liquido_desembolso IS NULL FROM public.operacoes'),'t');checks.push('taxa ausente mantém líquido ausente')
 seed();sql(`DELETE FROM public.operacoes_nfs WHERE nota_fiscal_id='${nf2}';`);sql(`${auth} ${call()} ${call(p2)}`);verify('última NF cancela operação vazia conforme a RPC legada',`IF (SELECT status FROM public.operacoes)<>'cancelada' OR (SELECT count(*) FROM public.operacoes_nfs)<>0 OR (SELECT count(*) FROM public.operacoes_nf_parcelas)<>0 THEN RAISE EXCEPTION 'cancelamento'; END IF;`)
 seed();sql('ALTER TABLE public.operacoes DISABLE TRIGGER operacoes_proteger_base_antecipacao;UPDATE public.operacoes SET base_antecipacao_snapshot=NULL;ALTER TABLE public.operacoes ENABLE TRIGGER operacoes_proteger_base_antecipacao;');sql(`${auth} ${call()}`);assert.equal(sql('SELECT valor_bruto_total FROM public.operacoes'),'1600.00');checks.push('operação legada sem snapshot')
 seed();sql(`ALTER TABLE public.operacoes DISABLE TRIGGER operacoes_proteger_base_antecipacao;UPDATE public.operacoes SET base_antecipacao_snapshot='{"itens":[]}';ALTER TABLE public.operacoes ENABLE TRIGGER operacoes_proteger_base_antecipacao;`);assert.throws(()=>sql(`${auth} ${call()}`));assert.equal(sql('SELECT count(*) FROM public.operacoes_nf_parcelas'),'2');assert.equal(sql('SELECT count(*) FROM public.logs_auditoria'),'0');checks.push('snapshot incompleto reverte retirada e auditoria')
 seed();sql(`INSERT INTO public.nota_fiscal_parcelas VALUES('${uid(11)}','${nf2}',1,1000,'2026-11-15','disponivel');`);assert.throws(()=>sql(`${auth} ${call()}`));assert.equal(sql('SELECT count(*) FROM public.operacoes_nf_parcelas'),'2');checks.push('NF parcelada sem vínculo ativo impede subtotal incompleto')
 seed();sql(`CREATE FUNCTION public.qa_impedir_evento() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'QA falha de evento'; END$$; CREATE TRIGGER qa_falha_evento BEFORE INSERT ON public.eventos_dominio FOR EACH ROW EXECUTE FUNCTION public.qa_impedir_evento();`);assert.throws(()=>sql(`${auth} ${call()}`));assert.equal(sql('SELECT count(*) FROM public.operacoes_nf_parcelas'),'2');assert.equal(sql('SELECT count(*) FROM public.logs_auditoria'),'0');sql('DROP TRIGGER qa_falha_evento ON public.eventos_dominio;');checks.push('falha no histórico reverte mutação e auditoria juntas')
 seed();const concurrent=request=>new Promise((resolve,reject)=>{const proc=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1']);let err='';proc.stderr.on('data',d=>err+=d);proc.on('close',code=>code?reject(new Error(err)):resolve());proc.stdin.end(`${auth} BEGIN; ${request} SELECT pg_sleep(0.2); COMMIT;`)})
 await Promise.all([concurrent(call()),concurrent(call(p2))]);assert.equal(sql('SELECT count(*) FROM public.operacoes_nfs'),'1');assert.equal(sql('SELECT count(*) FROM public.operacoes_nf_parcelas'),'0');assert.equal(sql('SELECT valor_bruto_total FROM public.operacoes'),'1000.00');checks.push('retiradas simultâneas serializadas, sem perda de NF alheia')
 console.log(JSON.stringify({status:'PASS',postgres:'17',checks,coverage:'fixture estrutural reduzida + helpers/RPCs reais; Auth/MFA simulados',container}))
}finally{
 if(created){assert.equal(docker(['inspect','--format','{{index .Config.Labels "bw.scope"}}',container]),scope);docker(['rm','-f','-v',container])}
}
