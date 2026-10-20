import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extrairCsvZipVortx, MAX_REPORT_BYTES, streamCsvZip } from './relatorios-zip.server'

const csv = Buffer.from('campo;valor\nqa;1.00\n')
const make = (name = 'posicao.csv', bytes = csv, extra = false, streamFiles = false) => {
  const zip = new JSZip(); zip.file(name, bytes)
  if (extra) zip.file('outro.csv', csv)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', streamFiles })
}
const directory = (zip: Buffer) => zip.readUInt32LE(zip.length - 6)
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
describe('bounded maintained ZIP extraction for Vortx CSV transport', () => {
  it.each([false, true])('accepts one CSV, including a data descriptor: %s', async streamFiles => {
    expect(Buffer.from(await extrairCsvZipVortx(await make('POSICAO.CSV', csv, false, streamFiles)))).toEqual(csv)
  })
  it.each(['../posicao.csv', 'folder/posicao.csv', 'arquivo.zip', 'arquivo.xlsx', 'C:posicao.csv'])('rejects unsafe/unsupported entry %s', async name => {
    await expect(extrairCsvZipVortx(await make(name))).rejects.toThrow('ZIP_CONTRATO_INVALIDO')
  })
  it('rejects ambiguity rather than choosing an arbitrary CSV', async () => {
    await expect(extrairCsvZipVortx(await make('posicao.csv', csv, true))).rejects.toThrow('ZIP_CONTRATO_INVALIDO')
  })
  it('rejects invalid/truncated envelopes', async () => {
    await expect(extrairCsvZipVortx(csv)).rejects.toThrow('ZIP_CONTRATO_INVALIDO')
    const zip = await make(); await expect(extrairCsvZipVortx(zip.subarray(0, zip.length - 1))).rejects.toThrow('ZIP_CONTRATO_INVALIDO')
  })
  it('rejects encrypted and ZIP64/multi-disk flags', async () => {
    const zip = await make(); const central = directory(zip)
    zip.writeUInt16LE(zip.readUInt16LE(6) | 1, 6); zip.writeUInt16LE(zip.readUInt16LE(central + 8) | 1, central + 8)
    await expect(extrairCsvZipVortx(zip)).rejects.toThrow('ZIP_CONTRATO_INVALIDO')
    const zip64 = await make(); zip64.writeUInt16LE(0xffff, zip64.length - 12)
    await expect(extrairCsvZipVortx(zip64)).rejects.toThrow('ZIP_CONTRATO_INVALIDO')
  })
  it('checks the streamed CRC, not just two matching untrusted header values', async () => {
    const zip = await make(); const central = directory(zip)
    zip.writeUInt32LE(123, 14); zip.writeUInt32LE(123, central + 16)
    await expect(extrairCsvZipVortx(zip)).rejects.toThrow('ZIP_INTEGRIDADE')
  })
  it('rejects declared inflation over 20 MiB before decompression', async () => {
    const zip = await make(); const central = directory(zip)
    zip.writeUInt32LE(MAX_REPORT_BYTES + 1, 22); zip.writeUInt32LE(MAX_REPORT_BYTES + 1, central + 24)
    const load = vi.spyOn(JSZip, 'loadAsync')
    await expect(extrairCsvZipVortx(zip)).rejects.toThrow('ZIP_LIMITE'); expect(load).not.toHaveBeenCalled()
  })
  it('does not trust a forged small uncompressed length', async () => {
    const zip = await make('posicao.csv', Buffer.alloc(1024 * 1024, 65)), central = directory(zip)
    zip.writeUInt32LE(1, 22); zip.writeUInt32LE(1, central + 24)
    await expect(extrairCsvZipVortx(zip)).rejects.toThrow('ZIP_LIMITE')
  })
  it('accepts exactly 20 MiB of actual decompressed output with matching CRC', async () => {
    const bytes = Buffer.alloc(MAX_REPORT_BYTES, 65), zip = await make('posicao.csv', bytes)
    expect(Buffer.from(await extrairCsvZipVortx(zip)).equals(bytes)).toBe(true)
  }, 20000)
  it('bounds stalled extraction and pauses it on failure', async () => {
    const zipBytes = await make(), zip = await JSZip.loadAsync(zipBytes), entry = Object.values(zip.files)[0]
    const stream = streamCsvZip(entry), pause = vi.spyOn(stream, 'pause')
    vi.spyOn(stream, 'resume').mockReturnValue(stream); Object.assign(entry, { internalStream: vi.fn().mockReturnValue(stream) })
    vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(zip); vi.useFakeTimers()
    const assertion = expect(extrairCsvZipVortx(zipBytes)).rejects.toThrow('ZIP_LIMITE')
    await vi.advanceTimersByTimeAsync(10000); await assertion; expect(pause).toHaveBeenCalled()
  })
})
