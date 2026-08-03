import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const componente = readFileSync(resolve(process.cwd(), 'src/components/contratos/UploadDocumentoAssinadoOperacao.tsx'), 'utf8')
const rota = readFileSync(resolve(process.cwd(), 'src/app/api/operacoes/[id]/documentos-assinados/route.ts'), 'utf8')
const servidor = readFileSync(resolve(process.cwd(), 'src/lib/operacoes/documentos-assinados.server.ts'), 'utf8')
const pagina = readFileSync(resolve(process.cwd(), 'src/app/gestor/operacoes/[id]/page.tsx'), 'utf8')
const actions = readFileSync(resolve(process.cwd(), 'src/lib/actions/operacao.ts'), 'utf8')

describe('arquitetura do upload de documentos assinados', () => {
  it('remove upload direto e path controlado pelo browser', () => {
    expect(componente).not.toContain('createClient')
    expect(componente).not.toContain('.storage')
    expect(componente).not.toContain('uploadPath')
    expect(componente).toContain("formData.set('tipoDocumento', tipoDocumento)")
    expect(componente).toContain("formData.set('arquivo', arquivo)")
    expect(componente).not.toMatch(/formData\.set\(['\"](?:bucket|path|fundoId|cedenteId|userId)/)
  })

  it('autoriza com JWT e contexto multifundo antes de criar cliente administrativo', () => {
    const auth = servidor.indexOf('autorizarGestorDocumentoAssinado(input.operacaoId)')
    const admin = servidor.indexOf('createAdminClient()', auth)
    expect(auth).toBeGreaterThan(-1)
    expect(admin).toBeGreaterThan(auth)
    expect(servidor).toContain(".from('usuario_fundos')")
    expect(servidor).toContain(".eq('status', 'ativo')")
    expect(servidor).toContain(".from('cedente_fundos')")
  })

  it('usa tipo fechado, path server-side, URL curta e auditoria de envio/substituicao', () => {
    expect(rota).toContain('isTipoDocumentoAssinadoOperacao')
    expect(servidor).toContain('construirPathDocumentoAssinado')
    expect(servidor).toContain('DOCUMENTO_ASSINADO_ANEXADO')
    expect(servidor).toContain('DOCUMENTO_ASSINADO_SUBSTITUIDO')
    expect(servidor).toContain('const expiraEmSegundos = 60')
  })

  it('elimina server actions que aceitavam path arbitrario e mantem os tres botoes', () => {
    expect(actions).not.toContain('export async function salvarTermoAssinado')
    expect(actions).not.toContain('export async function salvarComprovantePagamento')
    expect(actions).not.toContain('export async function salvarNotificacaoAssinada')
    expect(pagina.match(/<UploadDocumentoAssinadoOperacao/g)?.length).toBe(6)
    expect(pagina).toContain('TERMO_CESSAO_ASSINADO')
    expect(pagina).toContain('NOTIFICACAO_SACADO_ASSINADA')
    expect(pagina).toContain('COMPROVANTE_DESEMBOLSO_TED')
  })

  it('bloqueia clique duplo e confirma substituicao', () => {
    expect(componente).toContain('if (!arquivo || enviando) return')
    expect(componente).toContain('window.confirm')
    expect(componente).toContain('disabled={enviando')
  })

  it('mantem a linha responsiva e reduz a substituicao a uma acao acessivel por icone', () => {
    expect(componente).toContain('className="flex w-full min-w-0 items-center gap-2"')
    expect(componente).toContain('className="min-w-0 flex-1 gap-2 text-xs"')
    expect(componente).toContain('size="icon-sm"')
    expect(componente).toContain('title="Substituir documento"')
    expect(componente).toContain('aria-label="Substituir documento"')
    expect(componente).toContain('className="min-w-0 truncate"')
    expect(componente).not.toContain("'Substituir'")
  })
})
