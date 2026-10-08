import test from 'node:test'
import assert from 'node:assert/strict'
import {aclEntries,tokens,functionSemantics,pattern} from './r1-14-analysis.mjs'
test('ACL preserves NULL, empty, PUBLIC, grantor, grant option and MAINTAIN',()=>{
 assert.equal(aclEntries(null),null);assert.deepEqual(aclEntries([]),[])
 assert.deepEqual(aclEntries(['=X*/postgres']),[{grantee:'PUBLIC',grantor:'postgres',privilege:'EXECUTE',grantOption:true}])
 assert.equal(aclEntries(['authenticated=Dxtm/postgres']).length,4)
 assert.throws(()=>aclEntries(['authenticated=Z/postgres']))
})
test('lexical proof ignores comments and code whitespace only',()=>{
 assert.deepEqual(tokens("begin\r\n-- 'comment'\nreturn 'a'; end;"),tokens("begin\nreturn 'a'; end;"))
 assert.deepEqual(tokens('select /* a /* b */ c */ 1'),tokens('select 1'))
 assert.notDeepEqual(tokens("select 'a\r\nb'"),tokens("select 'a\nb'"))
 assert.notDeepEqual(tokens("select $$a\r\nb$$"),tokens("select $$a\nb$$"))
 assert.notDeepEqual(tokens("select 'a'\n'b'"),tokens("select 'a' 'b'"))
 assert.notDeepEqual(tokens("select '%nÃ£o%'"),tokens("select '%nÃƒÂ£o%'"))
 assert.notDeepEqual(tokens('x >= 1'),tokens('x > = 1'))
 assert.notDeepEqual(tokens("select E'x'"),tokens("select E 'x'"))
 assert.notDeepEqual(tokens("select U&'x'"),tokens("select U & 'x'"))
 assert.throws(()=>tokens("select 'unterminated"))
})
test('function wrapper and literal are not normalized away',()=>{
 const ddl=body=>`CREATE FUNCTION public.f() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$${body}$function$;`
 assert.deepEqual(functionSemantics(ddl("begin\r\nreturn 'x'; end;")),functionSemantics(ddl("begin\nreturn 'x'; end;")))
 assert.notDeepEqual(functionSemantics(ddl("begin return 'x'; end;")),functionSemantics(ddl("begin return 'y'; end;")))
 assert.notDeepEqual(functionSemantics(ddl("begin return 'x'; end;")),functionSemantics(ddl("begin return 'x'; end;").replace('DEFINER','INVOKER')))
})
test('triplet is diagnostic and absence remains absence',()=>{
 assert.equal(pattern({prod:null,homolog:{a:1},cleanroom:{a:1}}),'HOMOLOG == CLEANROOM != PROD')
 assert.equal(pattern({prod:1,homolog:2,cleanroom:3}),'ALL_THREE_DIFFERENT')
})
