import 'server-only'

import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

function ipv4Privado(address: string) {
  const octets = address.split('.').map(Number)
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    || octets[0] === 0
}

function ipv6Privado(address: string) {
  const normalized = address.toLowerCase()
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
}

export function enderecoRedePrivada(address: string) {
  const family = isIP(address)
  return family === 4 ? ipv4Privado(address) : family === 6 ? ipv6Privado(address) : false
}

export async function validarEndpointTecnicoSeguro(raw: string) {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') {
    throw new Error('O endpoint tecnico deve usar HTTPS sem credenciais na URL.')
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || enderecoRedePrivada(hostname)) {
    throw new Error('O endpoint tecnico informado nao e permitido.')
  }
  const allowlist = (process.env.PORTAL_FIDC_ENDPOINT_ALLOWLIST || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
  if (allowlist.length > 0 && !allowlist.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    throw new Error('O dominio do endpoint nao esta autorizado para o Portal FIDC.')
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => enderecoRedePrivada(address))) {
    throw new Error('O endpoint tecnico resolve para uma rede nao permitida.')
  }
  return url.toString()
}
