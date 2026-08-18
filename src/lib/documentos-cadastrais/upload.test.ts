import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  criarCaminhoDocumentoCadastral,
  executarUploadDocumentoCadastral,
  validarArquivoDocumentoCadastral,
  type DocumentoCadastralUploadClient,
} from './upload'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260818194455_p0_upload_documentos_cedente_permission_denied.sql'),
  'utf8',
)
const compensationMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260818195119_p0_compensacao_storage_documentos_cedente.sql'),
  'utf8',
)
const action = readFileSync(join(process.cwd(), 'src/lib/actions/cedente.ts'), 'utf8')
const uploadSource = readFileSync(join(process.cwd(), 'src/lib/documentos-cadastrais/upload.ts'), 'utf8')

function file(type = 'application/pdf', size = 12) {
  return new File([new Uint8Array(size)], 'contrato-social.pdf', { type })
}

function client(input?: { uploadError?: string; rpcError?: string; removeError?: string; data?: unknown }) {
  const upload = vi.fn().mockResolvedValue({ error: input?.uploadError ? { message: input.uploadError } : null })
  const remove = vi.fn().mockResolvedValue({ error: input?.removeError ? { message: input.removeError } : null })
  const rpc = vi.fn().mockResolvedValue({
    data: input && 'data' in input
      ? input.data
      : [{ documento_id: 'doc-1', versao: 1, status: 'enviado', storage_path: '123/contrato_social/id.pdf' }],
    error: input?.rpcError ? { message: input.rpcError, code: '42501' } : null,
  })
  const value = { storage: { from: vi.fn(() => ({ upload, remove })) }, rpc }
  return { value: value as unknown as DocumentoCadastralUploadClient, upload, remove, rpc }
}

describe('P0 upload de documentos cadastrais do cedente', () => {
  it('valida formato, arquivo vazio e limite antes do Storage', () => {
    expect(validarArquivoDocumentoCadastral(file())).toBeNull()
    expect(validarArquivoDocumentoCadastral(file('text/plain'))).toContain('Formato invalido')
    expect(validarArquivoDocumentoCadastral(file('application/pdf', 0))).toContain('vazio')
    expect(validarArquivoDocumentoCadastral(file('application/pdf', 20 * 1024 * 1024 + 1))).toContain('20MB')
  })

  it('gera caminho apenas com contexto resolvido no servidor', () => {
    expect(criarCaminhoDocumentoCadastral({
      cnpj: '00123456000190',
      tipo: 'contrato_social',
      nomeArquivo: 'Contrato Social (atualizado).pdf',
      representanteId: null,
      uploadId: 'upload-1',
    })).toBe('00123456000190/contrato_social/upload-1_Contrato_Social__atualizado_.pdf')

    expect(criarCaminhoDocumentoCadastral({
      cnpj: '00123456000190',
      tipo: 'rg_cpf',
      nomeArquivo: 'rg.pdf',
      representanteId: 'rep-1',
      uploadId: 'upload-2',
    })).toBe('00123456000190/representantes/rep-1/upload-2_rg.pdf')
  })

  it('nao chama o banco quando o Storage falha', async () => {
    const mock = client({ uploadError: 'storage indisponivel' })
    const result = await executarUploadDocumentoCadastral({
      client: mock.value,
      file: file(),
      tipo: 'contrato_social',
      storagePath: '00123456000190/contrato_social/upload-1.pdf',
      representanteId: null,
    })

    expect(result).toMatchObject({ ok: false, etapa: 'storage' })
    expect(mock.rpc).not.toHaveBeenCalled()
    expect(mock.remove).not.toHaveBeenCalled()
  })

  it('remove o objeto quando o registro SQL falha e permite nova tentativa', async () => {
    const failed = client({ rpcError: 'permission denied for table documentos' })
    const first = await executarUploadDocumentoCadastral({
      client: failed.value,
      file: file(),
      tipo: 'contrato_social',
      storagePath: '00123456000190/contrato_social/upload-1.pdf',
      representanteId: null,
    })
    expect(first).toMatchObject({ ok: false, etapa: 'database' })
    expect(failed.remove).toHaveBeenCalledWith(['00123456000190/contrato_social/upload-1.pdf'])

    const retry = client()
    const second = await executarUploadDocumentoCadastral({
      client: retry.value,
      file: file(),
      tipo: 'contrato_social',
      storagePath: '00123456000190/contrato_social/upload-2.pdf',
      representanteId: null,
    })
    expect(second).toMatchObject({ ok: true, documento: { versao: 1 } })
    expect(retry.remove).not.toHaveBeenCalled()
  })

  it('remove o objeto se a RPC retornar sucesso sem documento', async () => {
    const mock = client({ data: null })
    const result = await executarUploadDocumentoCadastral({
      client: mock.value,
      file: file(),
      tipo: 'cartao_cnpj',
      storagePath: '00123456000190/cartao_cnpj/upload-1.pdf',
      representanteId: null,
    })
    expect(result).toMatchObject({ ok: false, etapa: 'database' })
    expect(mock.remove).toHaveBeenCalledTimes(1)
  })

  it('mantem DML direto revogado e restringe a RPC ao cedente autenticado', () => {
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.documentos FROM authenticated')
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toContain("SET search_path = ''")
    expect(migration).toContain("COALESCE(auth.role(), '') <> 'authenticated'")
    expect(migration).toContain("perfil.role = 'cedente'::public.user_role")
    expect(migration).toContain("acesso.perfil = 'administrador'")
    expect(migration).toContain('representante.cedente_id = v_cedente_id')
    expect(migration).toContain('v_owner_id IS DISTINCT FROM v_user_id::text')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.registrar_documento_cadastral_cedente')
    expect(migration).not.toContain('p_fundo_id')
    expect(migration).not.toContain('p_status')
    expect(migration).not.toContain('p_cedente_id')
    expect(migration).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE|ALL).*public\.documentos\s+TO\s+authenticated/i)
  })

  it('limita a compensacao a objetos proprios e ainda nao vinculados', () => {
    expect(migration).toContain('CREATE POLICY storage_docs_cedente_delete_orphan')
    expect(migration).toContain('owner_id = auth.uid()::text')
    expect(migration).toContain('documento.url_arquivo = storage.objects.name')
    expect(migration).toContain("bucket_id = 'documentos-cedentes'")
    expect(compensationMigration).toContain('CREATE POLICY storage_docs_cedente_select_orphan_own')
    expect(compensationMigration).toContain('owner_id = auth.uid()::text')
    expect(compensationMigration).toContain('documento.url_arquivo = storage.objects.name')
  })

  it('remove o insert direto da action e preserva representante no reenvio', () => {
    const uploadAction = action.slice(action.indexOf('export async function uploadDocumento'), action.indexOf('export async function reenviarDocumento'))
    expect(uploadAction).toContain('executarUploadDocumentoCadastral')
    expect(uploadSource).toContain("client.rpc('registrar_documento_cadastral_cedente'")
    expect(uploadAction).not.toContain(".from('documentos')\n    .insert")
    expect(action).toContain("newFormData.set('representante_id', docData.representante_id)")
  })
})
