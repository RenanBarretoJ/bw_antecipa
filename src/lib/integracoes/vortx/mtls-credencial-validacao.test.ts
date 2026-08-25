import { describe, expect, it } from 'vitest'
import { validarParMtls, VortxCredencialValidacaoError } from './mtls-credencial-validacao'

// Fixtures de teste descartaveis (autoassinado, 1 dia de validade, CN=test-a)
// -- geradas somente para este teste, nunca reaproveitadas em ambiente real.
const CERT_A = `-----BEGIN CERTIFICATE-----
MIIDAzCCAeugAwIBAgIUbx4RacPpnXhaED1OtTD/QhEFAUYwDQYJKoZIhvcNAQEL
BQAwETEPMA0GA1UEAwwGdGVzdC1hMB4XDTI2MDgyNTE4MjMzM1oXDTI2MDgyNjE4
MjMzM1owETEPMA0GA1UEAwwGdGVzdC1hMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A
MIIBCgKCAQEAsDN8PMJjmfuZkwHvK90KuHzcxwzxaqZ2Q7FVeTtRO4ukiF6Ooyt9
CAOWSj46D6F7myHfAKVHlS9Yl81B8GAXmVXJqZP+D+P2rQiMeT92sJ/Wg+K7s/9L
HDAJlGQ4YsXGMYdppt3Z/3QWWDuDgxSZurCEgMm7jwmexJ2KWGWtU0frVGobSudk
hllKHT9kJbtS0Y8uzgAqB6ms/LDcQIpfSs+0VaJOCRJgsOMDOV+wwUHqg69ISMjt
F6ofeKmAzb6lElu/8VAhjdJbRgUkrfuuzIpm+53o00l+B7hsHLrV7LrydTTiT1Xa
+s+WNra69yI3BUzvYGtI/h3LfyGPx6JEGwIDAQABo1MwUTAdBgNVHQ4EFgQULUzV
R1aJV8DsyoAJiT2RMWZSF9EwHwYDVR0jBBgwFoAULUzVR1aJV8DsyoAJiT2RMWZS
F9EwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAkGl4X4kVzAfZ
4O5B0JIlm2ZZyzmMypKW90cil6E1Sdk7Ic7wzedHU6KBG/46U7E+tgtNALy8pw1E
adPoxQzyaKNoGyimJMQs5NsW3+1aKeA5WbcvylArF8MbebmjGd9RGEbV+eiubLVW
XB0VnuhARpR2/oDYyqp51XEmEFpIS8erU6ZSnM91oHXIvyt6mh1mm2wbJLn6IztD
PSjG43setwvsU4qWvJFiaHi/ebmAiG44XT04y757Fe133Dt7/o4yVnlguQiApswD
1abCxZ+soIK38DWq5pt6rg1ezY//FWWG3VJprrOpIDLzz+7kx4uPC4tcY0tDuThf
rOvxScRlKA==
-----END CERTIFICATE-----
`

const KEY_A = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCwM3w8wmOZ+5mT
Ae8r3Qq4fNzHDPFqpnZDsVV5O1E7i6SIXo6jK30IA5ZKPjoPoXubId8ApUeVL1iX
zUHwYBeZVcmpk/4P4/atCIx5P3awn9aD4ruz/0scMAmUZDhixcYxh2mm3dn/dBZY
O4ODFJm6sISAybuPCZ7EnYpYZa1TR+tUahtK52SGWUodP2Qlu1LRjy7OACoHqaz8
sNxAil9Kz7RVok4JEmCw4wM5X7DBQeqDr0hIyO0Xqh94qYDNvqUSW7/xUCGN0ltG
BSSt+67Mimb7nejTSX4HuGwcutXsuvJ1NOJPVdr6z5Y2trr3IjcFTO9ga0j+Hct/
IY/HokQbAgMBAAECggEAAZRck0Dc2rcGL+qvBbIkE/ZOllw319BpM/8leII/Hq0I
Sw6p8a2En+tEUCMRqy0z6faaRKu2ohA8F5RH+Isr+vxpY+NHPkY5YmC2vamDe17b
cfA45Yqu1jBaDaH+XWhPeAcyO8Q2XZNhVeYmriijnihR78OfMk+QREvzPwqeTKZP
EZcSjEDaIvfI18XdQvQInkJi0DmLaO4KpTbJJuuIiXFIWThBOESqyRIQE/ALQr+c
aMpPXmlAyn8C2U0q1YC1qNyFmky2TK7LvbxYbzr+MUyTksxhvPAidJUmr4Ro6GL/
gJoTNpD9VRMuRoJhZkSSwaIBrmqQ/VVsGwg5lZ4kjQKBgQDs9gwarw1iV40kKVD+
YQeZdV1l+fpDbADKQgLi4we9qVfiiTAtR7/K1UnpZNoF+iCowHDi4lJYC9U5XAcg
ShqS7tFLfb29oTlrq1ZYJSvjMs5URn+qWplKqHWVs3MomkPHcUnpKwGmDDqZ3NNE
BCwezijXQ9vGIujGcSC6AETkNwKBgQC+W7DznMRE7h+tAjh1iOBbVFln06YyOIyH
jBW9XFcTXuC1Cdc/P01VQ5bbhLpORcUHMrLjc7NHz5E1R/vdECZJqlMhhRUSDM0K
Y4X7j9CzShgSG8FqH9oUHykDAHEbACaahbxt3B/2KBg1yV8JuvrgkXGFFNO/CFhX
biinqIu1PQKBgCzTxyptH00RXwQOROI6nONtDoQyLCQBFI0uu7kMVfSNSrDyXwjR
3/iRLPBYQd6LmQ4TiceCJS2+31GAlWCIZEqTn0h2uyRakbBKs4TtU0Yh4GKVC6XA
ietTvxrY3do6hMQALIlNt3wgKB3fZqAhYe9Z9OP0VGlBRWP1FsnZLy81AoGBAIl4
rEzyfOeO1H9cKCvxgp1SSBLsTYzdO9ez+gs7wYKytTLo/XKmo5Gc8zhrHSTjzAuL
uJb8eo+0vhgteR3HyO7QO6LsejAD4JvNDfiDfuPL8aA6PS8H+7UmX7bUPdqS/E4B
oPfxzX82q21ElQbw6rb9Mm86gETooOvbGS8jUGm9AoGBAKJkN+qU6xUzGErceSZf
mqfwJUAbSueuMGt/lo83jHl0QIbs8GdyhcVndr+dY+Y56zdsv/qXaqtm5+wTqFXD
9ZnWXUxtpK1x1A5m695IXbB3GtR0tuJutCIuCM6FFDgzX+HCjXgqSOXTTaC4uNL/
YLjpUcxf5LKHqaV2/V9lx3Tg
-----END PRIVATE KEY-----
`

// Chave RSA distinta (genrsa), nao relacionada ao CERT_A -- usada so para o
// teste de mismatch.
const KEY_B = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCrXVoe88H84KmL
Kf4fN7pjV7R8vB229XwVS+V0mSxQGFaF+VGdaMTraMNky0/J266OgTR1b/pewKor
CtdYCFD1CphNuNs1nspD7UxK45d76fjwHMJ268sF7eaeNDTT86eY9mlJe5+pTrhC
pcHU1ryeECl3qRANGDe3us46nKZRTgdh1ann6+KC8XMzAutVAfz5kCWyh5DstjtQ
CgI/QTqzevbQyRMdkTMfYOmRLyVVts0xvjwEIa127sN7Q8oXQ9Yx5vDomYvlSrjx
saTYNsN1k9gN2Wyx3Ubj+PH+dUkpsnhB0WcV4I2mY8yFDsHk8L4ESnyoLiBZm8x1
XOsLD5YPAgMBAAECggEAHians6h56k9xJU43KzD394C3/fZvWACrW2fmMHS+6jzO
BHaQmJyVgUIGlxZ6rG6dsO8k1sDkEYXeqwIWT6Pu8p5xm8M5tp6AwiDfepG+1oud
REobISdtqlZobE+NN/m39F7uuYIp3nU+UGOvzg4WU81OLoKtk1A+hXI11PQ5Azbo
geNdzrJQZcZqwXGx+pXVgKy8Em9ZNsSA8A2ejPQEsC9VL5nzL55mFa2Jw+60BHn4
D23f3Je29VbRQ/5UfZtSdZL6kQ3iIV1hVrT0fBbCDPMxV84yjfrtv4aHV4WIvIfn
nvhEyOI167ApjUJ7J28K/hjhFoZM3yzHwL/qR2dlwQKBgQDiaFZihwJrcIWPbrD6
bc3NBUXbY3I9TtVnZq73EbQi+TIpLDuwDLaxo34CQ5AnyVkAqyMIYMYeAl4Q0laj
ZArfM5Z341hOZTMeruZ0alyXBhuTXua9XgJUqr4cfdFTgLbbCp1Si0zFy+B77zFB
WENdx/eZlMLivzQKUTkzeagcbwKBgQDBw0NMZQQ3G9xqOCeu3v5eviL6VkoP1Zvs
HtkFZJjYUSl92pB6RoXLFCCLwghm6Q5UXXJvJhCCOOqCgpJtUqynI33IKpvzE7e5
EvGox6ZlzzH5LYEHo6g+vYqxqz86U4+xCz9z3n9LIWYjJxqGCPn1waTN/4Sm6gxQ
XxGC93gwYQKBgF9LCxDtQld2RMDaFiNRlA126rAsayjixW+ACKR1DxypRjOOKpEu
yLZ72c2aIlKcrJlbbqNYGAsJdA4gedbLhMftLqfHSKO2dI21j8nv+oiWSYT9rKCH
sPNx6hKT4kcDJfOLxCu59dZKuXFwe4rFW5VdVRmPQ3esgnrVNP41dkyBAoGAZwbL
XvCLiD3xOi13tDzv5jKVaKS/JqI/ERLp9DskJkkplbjEf6/F7lBaadWXIBklvGgf
s8f6mTNoRlLlRunh0dFGTUuStnIyi17uTf8ylAnSmZq/c+9qQ0oHWCclLH9H9Sx0
5chVyP4OT/y31rMpLap0VfBaeWITgBy8s/Wf26ECgYBlGiN1OM+0bkriF0Y9SrXA
FxgNJWIop733F75+buuLQodQGQmm3Jnd3Dw8LDz/tGfrYoUYMfwIQglFLfkSmKZo
DgrH3Fr6kkmBYYBgfJUCqni24bAFTJ4hyGu4nzNjkf8e1P1N2yTye5FdtFrfsjUZ
fFRM6R1Y3qx9+QW6LxWsXA==
-----END PRIVATE KEY-----
`

describe('validarParMtls', () => {
  it('aceita um par certificado/chave privada valido e correspondente', () => {
    expect(() => validarParMtls(CERT_A, KEY_A)).not.toThrow()
  })

  it('rejeita certificado que nao e PEM X.509 valido (VORTX_CREDENTIAL_INVALID_PEM)', () => {
    try {
      validarParMtls('nao-e-um-certificado', KEY_A)
      throw new Error('deveria ter lancado')
    } catch (error) {
      expect(error).toBeInstanceOf(VortxCredencialValidacaoError)
      expect((error as VortxCredencialValidacaoError).codigo).toBe('VORTX_CREDENTIAL_INVALID_PEM')
    }
  })

  it('rejeita chave privada que nao e PEM valida (VORTX_CREDENTIAL_INVALID_PRIVATE_KEY)', () => {
    try {
      validarParMtls(CERT_A, 'nao-e-uma-chave-privada')
      throw new Error('deveria ter lancado')
    } catch (error) {
      expect(error).toBeInstanceOf(VortxCredencialValidacaoError)
      expect((error as VortxCredencialValidacaoError).codigo).toBe('VORTX_CREDENTIAL_INVALID_PRIVATE_KEY')
    }
  })

  it('rejeita certificado e chave validos individualmente mas que nao formam um par (VORTX_CREDENTIAL_CERT_KEY_MISMATCH)', () => {
    try {
      validarParMtls(CERT_A, KEY_B)
      throw new Error('deveria ter lancado')
    } catch (error) {
      expect(error).toBeInstanceOf(VortxCredencialValidacaoError)
      expect((error as VortxCredencialValidacaoError).codigo).toBe('VORTX_CREDENTIAL_CERT_KEY_MISMATCH')
      expect((error as Error).message).toBe('O certificado mTLS e a chave privada nao correspondem.')
    }
  })

  it('nunca inclui o conteudo do certificado ou da chave na mensagem de erro', () => {
    try {
      validarParMtls('nao-e-um-certificado', 'nao-e-uma-chave-privada')
    } catch (error) {
      expect((error as Error).message).not.toContain('BEGIN')
      expect((error as Error).message).not.toContain(KEY_A)
      expect((error as Error).message).not.toContain(CERT_A)
    }
  })
})
