// Offline diagnostic helpers. Never execute SQL or normalize the raw catalogue.
import assert from 'node:assert/strict'
import { hash } from './r1-4-restorer.mjs'
export const objectKey = o => JSON.stringify([o.kind,o.schema,o.name,o.signature])
export const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b)
export const paths = ['prod','homolog','cleanroom']
export const countBy = (rows,fn) => rows.reduce((out,row) => {const k=fn(row);out[k]=(out[k]??0)+1;return out}, {})
export function pattern(objects) {
  const [p,h,c]=paths.map(k=>objects[k])
  return equal(p,h)?'PROD == HOMOLOG != CLEANROOM':equal(p,c)?'PROD == CLEANROOM != HOMOLOG':equal(h,c)?'HOMOLOG == CLEANROOM != PROD':'ALL_THREE_DIFFERENT'
}
export function aclEntries(acl) {
  if (acl===null) return null // Not interchangeable with an empty array.
  const codes={r:'SELECT',a:'INSERT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN',X:'EXECUTE',U:'USAGE',C:'CREATE',c:'CONNECT',T:'TEMPORARY',s:'SET',A:'ALTER SYSTEM'}
  return acl.flatMap(raw=>{
    const m=raw.match(/^([^=]*)=([^/]*)\/(.+)$/);assert(m,'UNSUPPORTED_ACL_SYNTAX')
    assert(!/["\\]/.test(m[1]+m[3]),'QUOTED_ACL_REQUIRES_CATALOG_PARSER')
    const entries=[]
    for(let i=0;i<m[2].length;i++){
      const privilege=codes[m[2][i]];assert(privilege,'UNSUPPORTED_PRIVILEGE')
      const grantOption=m[2][i+1]==='*';if(grantOption)i++
      entries.push({grantee:m[1]||'PUBLIC',grantor:m[3],privilege,grantOption})
    }
    return entries
  })
}
// Limited SQL/PLpgSQL lexical proof: preserve literals, quoted identifiers and
// nested dollar strings byte-for-byte. Unknown syntax never becomes equivalence.
export function tokens(sql) {
  const out=[];let i=0,gap=''
  while(i<sql.length){
    if(/\s/.test(sql[i])){gap+=sql[i++];continue}
    if(sql.startsWith('--',i)){const n=sql.indexOf('\n',i);i=n<0?sql.length:n;gap+=' ';continue}
    if(sql.startsWith('/*',i)){
      let depth=1;i+=2
      while(depth&&i<sql.length){if(sql.startsWith('/*',i)){depth++;i+=2}else if(sql.startsWith('*/',i)){depth--;i+=2}else i++}
      assert.equal(depth,0,'UNTERMINATED_COMMENT');gap+=' ';continue
    }
    const start=i;let type='syntax'
    const prefix=/^(?:[eEnNbBxX](?=')|[uU]&(?=['"]))/u.exec(sql.slice(i))?.[0]
    if(prefix)i+=prefix.length
    if(sql[i]==="'"||sql[i]==='"'){
      const quote=sql[i++];type=quote==="'"?'literal':'identifier';let closed=false
      while(i<sql.length){if(sql[i]==='\\'){i+=2;continue}if(sql[i]===quote){i++;if(sql[i]===quote){i++;continue}closed=true;break}i++}
      assert(closed,'UNTERMINATED_QUOTE')
    }else if(sql[i]==='$' && /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.test(sql.slice(i))){
      const tag=sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)[0]
      const end=sql.indexOf(tag,i+tag.length);assert(end>=0,'UNTERMINATED_DOLLAR');i=end+tag.length;type='literal'
    }else{
      const m=sql.slice(i).match(/^(?:[A-Za-z_\u0080-\uFFFF][A-Za-z_0-9$\u0080-\uFFFF]*|[0-9]+(?:\.[0-9]+)?|::|:=|->>|->|#>>|#>|<=|>=|<>|!=|\|\||<<|>>|[-+*/<>=~!@#%^&|`?]+|.)/s)
      assert(m);i+=m[0].length
    }
    if(type==='literal'&&out.at(-1)?.type==='literal')out.push({type:'literal_gap',value:/[\r\n]/.test(gap)?'newline':'other'})
    out.push({type,value:sql.slice(start,i)});gap=''
  }
  return out
}
export function functionParts(ddl){
  const m=/\bAS\s+(\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)/i.exec(ddl);assert(m,'FUNCTION_BODY_NOT_DOLLAR_QUOTED')
  const start=m.index+m[0].length,end=ddl.lastIndexOf(m[1]);assert(end>=start)
  const header=ddl.slice(0,m.index),body=ddl.slice(start,end),tail=ddl.slice(end+m[1].length)
  const language=/\bLANGUAGE\s+(\w+)/i.exec(header)?.[1]?.toLowerCase();assert(['plpgsql','sql'].includes(language),'UNSUPPORTED_LANGUAGE')
  return {header,body,tail,language}
}
export function functionSemantics(ddl){
  const p=functionParts(ddl)
  return {header:tokens(p.header),body:tokens(p.body),tail:tokens(p.tail)}
}
export function functionSecurity(o){
  if(!o)return null
  const p=functionParts(o.definition),header=p.header
  const grants=aclEntries(o.acl)
  return {signature:o.signature,owner:o.owner,language:p.language,security:/SECURITY\s+DEFINER/i.test(header)?'DEFINER':'INVOKER',searchPath:/SET search_path TO ([^\n]+)/i.exec(header)?.[1]??'NOT_SET',volatility:/\bIMMUTABLE\b/i.test(header)?'IMMUTABLE':/\bSTABLE\b/i.test(header)?'STABLE':'VOLATILE',acl:o.acl,expanded:grants,publicExecute:grants.some(g=>g.grantee==='PUBLIC'&&g.privilege==='EXECUTE'),authenticatedExecute:grants.some(g=>['PUBLIC','authenticated'].includes(g.grantee)&&g.privilege==='EXECUTE'),serviceRoleExecute:grants.some(g=>['PUBLIC','service_role'].includes(g.grantee)&&g.privilege==='EXECUTE'),delegates:[...new Set([...p.body.matchAll(/\b(public|private)\.([a-z_0-9]+)\s*\(/gi)].map(m=>m[1]+'.'+m[2]))],bodyTokenSha256:hash(JSON.stringify(tokens(p.body)))}
}
export function changedComponents(objects){
  const defs=paths.map(k=>objects[k]?.definition??null)
  if(defs.every(d=>d&&typeof d==='object'&&!Array.isArray(d)))return [...new Set(defs.flatMap(Object.keys))].filter(k=>new Set(defs.map(d=>JSON.stringify(d[k]))).size>1)
  return ['presence_or_definition']
}
