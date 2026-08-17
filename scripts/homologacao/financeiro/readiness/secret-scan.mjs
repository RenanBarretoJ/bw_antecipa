import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'

const repositoryFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
const ignoredExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.woff', '.woff2', '.ttf', '.lock'])
const ignoredPaths = [/^docs\/manual\//, /^package-lock\.json$/, /^\.env\.example$/]
const patterns = [
  { id: 'PRIVATE_KEY', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: 'SUPABASE_JWT', pattern: /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/ },
  { id: 'AWS_ACCESS_KEY', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { id: 'URL_CREDENTIAL', pattern: /(?:postgres(?:ql)?|mysql):\/\/[^\s:@/]+:[^\s@/]{8,}@/i },
  { id: 'HARDCODED_SECRET', pattern: /(?:password|passwd|secret|token|api[_-]?key|service[_-]?role[_-]?key)\s*[:=]\s*['"][^'"\r\n]{16,}['"]/i },
]

const findings = []
let scanned = 0
for (const relativePath of repositoryFiles) {
  const normalized = relativePath.replaceAll('\\', '/')
  if (ignoredPaths.some((pattern) => pattern.test(normalized)) || ignoredExtensions.has(extname(normalized).toLowerCase())) continue
  const absolutePath = resolve(relativePath)
  if (!existsSync(absolutePath)) continue
  const content = readFileSync(absolutePath, 'utf8')
  if (content.includes('\0')) continue
  scanned += 1
  content.split(/\r?\n/).forEach((line, index) => {
    for (const candidate of patterns) {
      if (!candidate.pattern.test(line)) continue
      const lower = line.toLowerCase()
      if (/(example|placeholder|dummy|fake|test-token|process\.env|redact|pattern:|expected|encodeuricomponent|env\(|127\.0\.0\.1|localhost)/.test(lower)) continue
      findings.push({ path: normalized, line: index + 1, type: candidate.id })
    }
  })
}

const result = {
  schema: 'bw-antecipa-p2-6-1-secret-scan-v1',
  scannedRepositoryTextFiles: scanned,
  status: findings.length ? 'FAIL' : 'PASS',
  findings,
  note: 'O artefato registra somente caminho, linha e classe; valores nunca sao persistidos.',
}
writeFileSync(resolve('docs/financeiro/secret-scan-p2-6-1.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(result, null, 2))
if (findings.length) process.exitCode = 1
