import { describe, expect, it } from 'vitest'
import { formatDateGroupLabel, groupHistoricoByDate, resumirMetadataHistorico, type HistoricoEventoView } from './formatters'

describe('eventos-dominio formatters', () => {
  it('remove metadados tecnicos ou sensiveis do resumo', () => {
    const resumo = resumirMetadataHistorico({
      numero_nf: '13197',
      documento: 'XML da NF-e',
      sha256: 'abc',
      bucket: 'documentos-v2',
      storage_path: 'cedente/nf/file.xml',
      token: 'secret',
      resultado: 'aprovado',
    })

    expect(resumo).toEqual([
      'NF: 13197',
      'Documento: XML da NF-e',
      'Resultado: aprovado',
    ])
  })

  it('agrupa eventos por data preservando a ordem recebida', () => {
    const events: HistoricoEventoView[] = [
      evento('1', '2026-07-28T12:00:00.000Z'),
      evento('2', '2026-07-28T10:00:00.000Z'),
      evento('3', '2026-07-27T10:00:00.000Z'),
    ]

    const groups = groupHistoricoByDate(events)

    expect(groups).toHaveLength(2)
    expect(groups[0].events.map((event) => event.id)).toEqual(['1', '2'])
    expect(groups[1].events.map((event) => event.id)).toEqual(['3'])
  })

  it('nomeia hoje e ontem para grupos da timeline', () => {
    const now = new Date('2026-07-28T15:00:00.000Z')

    expect(formatDateGroupLabel('2026-07-28T10:00:00.000Z', now)).toBe('Hoje')
    expect(formatDateGroupLabel('2026-07-27T10:00:00.000Z', now)).toBe('Ontem')
  })
})

function evento(id: string, createdAt: string): HistoricoEventoView {
  return {
    id,
    tipoEvento: 'documento_enviado',
    categoria: 'documento',
    descricao: 'Documento enviado.',
    atorNome: 'Breno',
    atorPerfil: 'cedente',
    origem: 'teste',
    metadataResumo: [],
    visibilidade: 'ambos',
    createdAt,
  }
}
