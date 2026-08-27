export type IntegrationEditorState =
  | { mode: 'none'; integrationId: null }
  | { mode: 'create'; integrationId: null }
  | { mode: 'edit'; integrationId: string }

type DraftIdentity = {
  id: string
  updated_at: string
}

export function initialIntegrationEditorState(integrationId?: string | null): IntegrationEditorState {
  return integrationId
    ? { mode: 'edit', integrationId }
    : { mode: 'none', integrationId: null }
}

export function newIntegrationEditorState(): IntegrationEditorState {
  return { mode: 'create', integrationId: null }
}

export function editIntegrationEditorState(integrationId: string): IntegrationEditorState {
  return { mode: 'edit', integrationId }
}

export function adapterSubmissionFields(locked: boolean) {
  return locked
    ? { selectName: undefined, hiddenName: 'adapterKey' as const }
    : { selectName: 'adapterKey' as const, hiddenName: undefined }
}

export function draftIdentityForEditor(editor: IntegrationEditorState, draft?: DraftIdentity | null) {
  if (editor.mode !== 'edit') {
    return { integrationId: null, versionId: null, updatedAt: null }
  }

  return {
    integrationId: editor.integrationId,
    versionId: draft?.id ?? null,
    updatedAt: draft?.updated_at ?? null,
  }
}
