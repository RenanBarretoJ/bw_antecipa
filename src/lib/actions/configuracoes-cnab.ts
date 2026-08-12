'use server'

/**
 * Compatibilidade das antigas Server Actions do Gestor.
 *
 * Desde o SA3, CNAB, integracoes e credenciais sao configuracoes tecnicas
 * exclusivas do Super Admin. Estes stubs preservam imports legados sem manter
 * um segundo caminho de escrita, em especial os antigos usos de service role.
 */
type ActionState<T = unknown> = { success: boolean; message: string; data?: T }
const MESSAGE = 'Configuracao tecnica restrita ao Super Admin.'
function blocked<T = unknown>(): ActionState<T> { return { success: false, message: MESSAGE } }

export async function criarConfiguracaoCnab(): Promise<ActionState<{ id: string }>> { return blocked() }
export async function criarVersaoConfiguracaoCnab(): Promise<ActionState<{ id: string; versao: number }>> { return blocked() }
export async function publicarVersaoConfiguracaoCnab(): Promise<ActionState> { return blocked() }
export async function desativarConfiguracaoCnab(): Promise<ActionState> { return blocked() }
export async function importarConfiguracaoCnabLegado(): Promise<ActionState<{ configuracaoId: string; versaoId: string }>> { return blocked() }

export type CredencialPortalFidcMetadata = { id: string; ambiente: 'homologacao' | 'producao'; nome: string; status: string; usuarioMascarado: string | null; criadaEm: string; ativadaEm: string | null; revogadaEm: string | null; ultimoUsoEm: string | null }
export async function listarCredenciaisPortalFidc(): Promise<ActionState<CredencialPortalFidcMetadata[]>> { return blocked() }
export async function cadastrarCredencialPortalFidc(): Promise<ActionState<{ id: string }>> { return blocked() }
export async function ativarCredencialPortalFidc(): Promise<ActionState> { return blocked() }
export async function revogarCredencialPortalFidc(): Promise<ActionState> { return blocked() }
export async function criarOuAtualizarIntegracaoFundo(): Promise<ActionState<{ integracaoId: string; versaoId: string; versao: number }>> { return blocked() }
export async function atualizarRascunhoIntegracaoFundo(): Promise<ActionState> { return blocked() }
export async function publicarVersaoIntegracaoFundo(): Promise<ActionState> { return blocked() }
export async function desativarIntegracaoFundo(): Promise<ActionState> { return blocked() }
export async function testarConexaoIntegracaoFundo(): Promise<ActionState<{ execucaoId: string }>> { return blocked() }
export async function gerarArquivoTesteConfiguracaoCnab(): Promise<ActionState<{ nomeArquivo: string; conteudo: string }>> { return blocked() }
