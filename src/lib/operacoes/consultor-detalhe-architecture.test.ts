import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('acompanhamento compartilhado cedente e consultor', () => {
  const view = readFileSync('src/components/operacoes/OperacaoAcompanhamentoPage.tsx', 'utf8')
  it('compartilha a visualização entre os dois portais sem copiar a página', () => {
    expect(readFileSync('src/app/cedente/operacoes/[id]/page.tsx','utf8')).toContain('OperacaoAcompanhamentoPage')
    expect(readFileSync('src/app/consultor/operacoes/[id]/page.tsx','utf8')).toContain('perfil="consultor"')
  })
  it('não importa ações de escrita e informa o modo somente leitura', () => {
    expect(view).not.toContain("'use client'")
    expect(view).not.toMatch(/cancelarOperacao|aprovarOperacao|reprovarOperacao|Upload|RemoverItemOperacao/)
    expect(view).toContain('somente leitura')
    expect(view).toContain('AndamentoOperacaoCard')
    expect(view).toContain('HistoricoTimelineCard')
  })
  it('protege o retorno e não oferece resolução de pendências ao consultor', () => {
    expect(view).toContain('returnToParam === basePath')
    expect(view).toContain("perfil === 'cedente' && pendencia.acaoHref")
  })
  it('exibe o link Ver para o consultor mantendo Cancelar exclusivo do cedente', () => {
    const list = readFileSync('src/components/operacoes/OperacoesPaginadas.tsx','utf8')
    expect(list).not.toContain("perfil !== 'consultor' && <td")
    expect(list).toContain("perfil === 'cedente' && item.status === 'solicitada'")
  })
})
