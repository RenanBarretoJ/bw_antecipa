import { describe, expect, it } from 'vitest'
import { possuiAssinaturaPdf } from './arquivo'

describe('seguranca do arquivo de duplicata', () => {
  it('aceita assinatura PDF real', () => {
    expect(possuiAssinaturaPdf(Buffer.from('%PDF-1.7\nfixture sintetica'))).toBe(true)
  })

  it('rejeita extensao PDF com conteudo arbitrario', () => {
    expect(possuiAssinaturaPdf(Buffer.from('<script>alert(1)</script>'))).toBe(false)
  })
})
