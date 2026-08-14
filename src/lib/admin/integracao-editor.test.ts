import { describe, expect, it } from 'vitest'
import {
  draftIdentityForEditor,
  editIntegrationEditorState,
  initialIntegrationEditorState,
  newIntegrationEditorState,
} from './integracao-editor'

describe('lifecycle do editor de integracoes tecnicas', () => {
  it('distingue nenhuma selecao de CREATE mode', () => {
    expect(initialIntegrationEditorState()).toEqual({ mode: 'none', integrationId: null })
    expect(newIntegrationEditorState()).toEqual({ mode: 'create', integrationId: null })
  })

  it('nunca envia UUID ficticio no CREATE', () => {
    const identity = draftIdentityForEditor(newIntegrationEditorState(), {
      id: crypto.randomUUID(),
      updated_at: new Date().toISOString(),
    })

    expect(identity).toEqual({ integrationId: null, versionId: null, updatedAt: null })
  })

  it('troca para EDIT com o UUID real retornado e reutiliza o mesmo rascunho', () => {
    const integrationId = crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const updatedAt = new Date().toISOString()
    const editor = editIntegrationEditorState(integrationId)

    expect(editor).toEqual({ mode: 'edit', integrationId })
    expect(draftIdentityForEditor(editor, { id: versionId, updated_at: updatedAt })).toEqual({
      integrationId,
      versionId,
      updatedAt,
    })
  })

  it('edita uma integracao sem rascunho criando a proxima versao na mesma integracao', () => {
    const integrationId = crypto.randomUUID()

    expect(draftIdentityForEditor(editIntegrationEditorState(integrationId))).toEqual({
      integrationId,
      versionId: null,
      updatedAt: null,
    })
  })
})
