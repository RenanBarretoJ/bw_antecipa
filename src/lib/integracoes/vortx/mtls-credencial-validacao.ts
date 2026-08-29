import 'server-only'

import { X509Certificate, createPrivateKey } from 'node:crypto'

export type VortxCredencialErroCodigo =
  | 'VORTX_CREDENTIAL_INVALID_PEM'
  | 'VORTX_CREDENTIAL_INVALID_PRIVATE_KEY'
  | 'VORTX_CREDENTIAL_CERT_KEY_MISMATCH'

export class VortxCredencialValidacaoError extends Error {
  readonly codigo: VortxCredencialErroCodigo

  constructor(message: string, codigo: VortxCredencialErroCodigo) {
    super(message)
    this.name = 'VortxCredencialValidacaoError'
    this.codigo = codigo
  }
}

/**
 * Valida, antes de qualquer criptografia/persistencia, que o certificado e a
 * chave privada mTLS sao PEM validos e formam um par -- usando APIs
 * criptograficas do Node (X509Certificate/createPrivateKey/checkPrivateKey),
 * nunca comparacao textual. Nunca inclui o conteudo do PEM/chave na mensagem
 * de erro.
 */
export function validarParMtls(certificadoPem: string, chavePrivadaPem: string): void {
  let certificado: X509Certificate
  try {
    certificado = new X509Certificate(certificadoPem)
  } catch {
    throw new VortxCredencialValidacaoError(
      'O certificado mTLS informado nao e um PEM X.509 valido.',
      'VORTX_CREDENTIAL_INVALID_PEM',
    )
  }

  let chavePrivada: ReturnType<typeof createPrivateKey>
  try {
    chavePrivada = createPrivateKey(chavePrivadaPem)
  } catch {
    throw new VortxCredencialValidacaoError(
      'A chave privada mTLS informada nao e uma chave PEM valida.',
      'VORTX_CREDENTIAL_INVALID_PRIVATE_KEY',
    )
  }

  let par: boolean
  try {
    par = certificado.checkPrivateKey(chavePrivada)
  } catch {
    throw new VortxCredencialValidacaoError(
      'Nao foi possivel verificar a correspondencia entre certificado e chave privada.',
      'VORTX_CREDENTIAL_CERT_KEY_MISMATCH',
    )
  }
  if (!par) {
    throw new VortxCredencialValidacaoError(
      'O certificado mTLS e a chave privada nao correspondem.',
      'VORTX_CREDENTIAL_CERT_KEY_MISMATCH',
    )
  }
}
