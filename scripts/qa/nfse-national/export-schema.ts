import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { canonicalSchema } from '../../../src/lib/nfse/canonical/schema'

const schema = z.toJSONSchema(canonicalSchema, { target: 'draft-2020-12', reused: 'ref' })
writeFileSync(new URL('../../../docs/analises/nfse-canonical-1.1.0.schema.json', import.meta.url),
  JSON.stringify({ ...schema, $id: 'urn:bw-antecipa:nfse-canonical:1.1.0', title: 'NFS-e canônica: extração documental sem elegibilidade' }, null, 2) + '\n', 'utf8')
