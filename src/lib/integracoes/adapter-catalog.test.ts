import { describe, expect, it } from 'vitest'
import { ADAPTER_CATALOG, capabilitiesDisponiveisParaAdapter, obterAdapterCatalogo, VORTX_VRS_CAPABILITIES } from './adapter-catalog'
import { INTEGRATION_CAPABILITIES } from './capabilities'

describe('obterAdapterCatalogo', () => {
  it('retorna null para adapterKey vazio/nulo (modo Custom/generico)', () => {
    expect(obterAdapterCatalogo('')).toBeNull()
    expect(obterAdapterCatalogo(null)).toBeNull()
    expect(obterAdapterCatalogo(undefined)).toBeNull()
  })

  it('retorna null para adapter desconhecido', () => {
    expect(obterAdapterCatalogo('adapter_inexistente')).toBeNull()
  })

  it('retorna a entrada Vortx VRS 2.0 com metadados corretos', () => {
    const entry = obterAdapterCatalogo('vortx_vrs')
    expect(entry).toMatchObject({
      adapterKey: 'vortx_vrs',
      providerKey: 'VORTX',
      credentialKind: 'vortx_mtls',
      showsGenericEndpoint: false,
      showsGenericIdentity: false,
    })
    expect(entry?.capabilities).toEqual(VORTX_VRS_CAPABILITIES)
    expect(entry?.defaultBaseUrl.homologacao).toBe('https://api-stg.vortx.com.br')
  })

  it('retorna a entrada Portal FIDC / Sinqia com credentialKind usuario_senha', () => {
    const entry = obterAdapterCatalogo('sinqia_portal_fidc')
    expect(entry?.credentialKind).toBe('usuario_senha')
    expect(entry?.showsGenericEndpoint).toBe(true)
  })
})

describe('VORTX_VRS_CAPABILITIES', () => {
  it('nao inclui CARTEIRA (contrato ainda nao fechado)', () => {
    expect(VORTX_VRS_CAPABILITIES).not.toContain('CARTEIRA')
  })

  it('e um subconjunto valido de INTEGRATION_CAPABILITIES', () => {
    for (const capability of VORTX_VRS_CAPABILITIES) {
      expect(INTEGRATION_CAPABILITIES).toContain(capability)
    }
  })
})

describe('capabilitiesDisponiveisParaAdapter', () => {
  it('restringe as capabilities ao catalogo do adapter selecionado', () => {
    expect(capabilitiesDisponiveisParaAdapter('vortx_vrs')).toEqual(VORTX_VRS_CAPABILITIES)
  })

  it('libera todas as capabilities quando nenhum adapter do catalogo esta selecionado (modo Custom)', () => {
    expect(capabilitiesDisponiveisParaAdapter('')).toEqual(INTEGRATION_CAPABILITIES)
    expect(capabilitiesDisponiveisParaAdapter(null)).toEqual(INTEGRATION_CAPABILITIES)
  })
})

describe('ADAPTER_CATALOG', () => {
  it('todo adapterKey e unico no catalogo', () => {
    const keys = ADAPTER_CATALOG.map((item) => item.adapterKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
