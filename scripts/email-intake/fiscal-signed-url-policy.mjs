/** Preview-only evidence adapter. Clients must be independent real Auth sessions. */
export function fiscalSignedUrlPolicy({ db, actor, foreignActor, fund, foreignFund, appOrigin, storageOrigin, ref, detect }) {
  if (fund === foreignFund || storageOrigin !== `https://${ref}.supabase.co`) throw Error('SIGNED_URL_POLICY_CONTEXT')
  return {
    appOrigin, storageOrigin, allowedBuckets: ['notas-fiscais', 'documentos-v2'], maxTtlSeconds: 600,
    async authorize({ bucket, path, requestPath, actionId }) {
      const proof = { actorAuthenticated: false, authorized: false, scopeMatches: false, crossFundDenied: false }
      const match = /^\/cedente\/notas-fiscais\/([a-f0-9-]{36})$/.exec(requestPath)
      if (!match || !/^[a-f0-9]{40,64}$/.test(actionId ?? '')) return proof
      const id = match[1]
      const [identity, outsider, visible, denied] = await Promise.all([
        actor.auth.getUser(), foreignActor.auth.getUser(),
        actor.from('notas_fiscais').select('id,fundo_id,cedente_id').eq('id', id).maybeSingle(),
        foreignActor.from('notas_fiscais').select('id').eq('id', id).maybeSingle(),
      ])
      if (identity.error || outsider.error || !identity.data.user || !outsider.data.user
        || identity.data.user.id === outsider.data.user.id || visible.error || denied.error) return proof
      proof.actorAuthenticated = true
      const expected = (await db.query(`select n.fundo_id,n.cedente_id,o.bucket,o.path
        from public.notas_fiscais n cross join lateral
        jsonb_to_record(public.fiscal_intake_get_original(n.id)) as o(bucket text,path text)
        where n.id=$1`, [id])).rows
      if (expected.length !== 1) return proof
      const original = expected[0]
      proof.scopeMatches = original.fundo_id === fund && original.bucket === bucket && original.path === path
      proof.authorized = visible.data?.id === id && visible.data.fundo_id === fund && visible.data.cedente_id === original.cedente_id
      if (!proof.scopeMatches || !proof.authorized || denied.data) return proof
      const memberships = (await db.query("select fundo_id from public.usuario_fundos where usuario_id=$1 and status='ativo'", [outsider.data.user.id])).rows
      if (memberships.length !== 1 || memberships[0].fundo_id !== foreignFund) return proof
      const storageDenied = await foreignActor.storage.from(bucket).createSignedUrl(path, 600)
      if (!storageDenied.error || storageDenied.data?.signedUrl) return proof
      // A bearer URL is transferable; isolation must deny unauthorized issuance.
      const session = (await foreignActor.auth.getSession()).data.session
      if (!session) return proof
      const parts = ('base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')).match(/.{1,3180}/g)
      const cookie = parts.map((value, i) => `${parts.length === 1 ? `sb-${ref}-auth-token` : `sb-${ref}-auth-token.${i}`}=${value}`).join('; ')
      const response = await fetch(new URL(requestPath, appOrigin), { method: 'POST', redirect: 'manual',
        headers: { 'Next-Action': actionId, origin: appOrigin, 'content-type': 'text/plain;charset=UTF-8', cookie },
        body: JSON.stringify([id]), signal: AbortSignal.timeout(10000) })
      const body = await response.text()
      if (response.status !== 200 || !response.headers.get('content-type')?.startsWith('text/x-component') || detect(body).length) return proof
      const results = body.split('\n').flatMap(line => {
        const frame = /^[a-f0-9]+:(\{.*\})$/.exec(line)
        if (!frame) return []
        try { return [JSON.parse(frame[1])] } catch { return [] }
      })
      proof.crossFundDenied = results.some(result => result.success === false
        && result.message === 'Arquivo indisponivel ou sem permissao de acesso.' && !('url' in result))
      return proof
    },
  }
}
