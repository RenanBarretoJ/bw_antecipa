import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const cardRemovido = join(root, 'src/components/notas-fiscais/CanhotoDaEntrega.tsx')
const componenteConsolidado = readFileSync(join(root, 'src/components/documentos-v2/RequisitoComprovanteEntrega.tsx'), 'utf8')
const checklist = readFileSync(join(root, 'src/components/documentos-v2/ChecklistCedente.tsx'), 'utf8')
const paginaCedente = readFileSync(join(root, 'src/app/cedente/notas-fiscais/[id]/page.tsx'), 'utf8')
const paginaGestor = readFileSync(join(root, 'src/app/gestor/notas-fiscais/[id]/page.tsx'), 'utf8')

describe('comprovante de entrega / canhoto -- confirmacao (nao redesenho) de que a consolidacao continua valendo', () => {
  it('o card avulso CanhotoDaEntrega.tsx foi removido e nao existe mais no repositorio', () => {
    expect(existsSync(cardRemovido)).toBe(false)
  })

  it('nenhuma pagina de NF (cedente/gestor) referencia CanhotoDaEntrega -- upload so acontece dentro de Requisitos documentais', () => {
    expect(paginaCedente).not.toContain('CanhotoDaEntrega')
    expect(paginaGestor).not.toContain('CanhotoDaEntrega')
  })

  it('o requisito de comprovante de entrega e dispachado dentro do checklist "Requisitos documentais"', () => {
    expect(checklist).toContain('RequisitoComprovanteEntrega')
    expect(checklist).toMatch(/familiaDocumental === 'comprovante_entrega'/)
  })

  it('o componente consolidado nao renderiza nenhum seletor manual venda/remessa (sem <select>) -- o vinculo e sempre automatico', () => {
    expect(componenteConsolidado).not.toMatch(/<select/i)
    expect(componenteConsolidado).toContain('inferirVinculoRemessaCanhoto')
  })
})
