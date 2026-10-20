import 'server-only'
import JSZip from 'jszip'
import { crc32 } from 'node:zlib'

export const MAX_REPORT_BYTES = 20 * 1024 * 1024
export class ZipRelatorioError extends Error {
  constructor(readonly codigo: 'ZIP_CONTRATO_INVALIDO' | 'ZIP_LIMITE' | 'ZIP_INTEGRIDADE') { super(codigo) }
}
type EntradaComFluxo = JSZip.JSZipObject & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }
function possuiFluxo(entry: JSZip.JSZipObject): entry is EntradaComFluxo {
  return 'internalStream' in entry && typeof entry.internalStream === 'function'
}
/** Public JSZip API omitted from bundled ZipObject types; verify it at runtime.
 * https://stuk.github.io/jszip/documentation/api_zipobject/internal_stream.html
 */
export function streamCsvZip(entry: JSZip.JSZipObject): JSZip.JSZipStreamHelper<Uint8Array> {
  if (!possuiFluxo(entry)) throw new ZipRelatorioError('ZIP_CONTRATO_INVALIDO')
  return entry.internalStream('uint8array')
}

/** Strict single-CSV ZIP32 envelope. JSZip performs decoding/decompression; this
 * preflight bounds its directory and rejects ambiguous/unsupported containers.
 * Never writes paths to disk or extracts arbitrary archive contents.
 */
function envelopeUnico(bytes: Buffer) {
  if (bytes.length < 98 || bytes.length > MAX_REPORT_BYTES || bytes.readUInt32LE(0) !== 0x04034b50) throw new ZipRelatorioError('ZIP_CONTRATO_INVALIDO')
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0 || end + 22 > bytes.length || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length
    || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0
    || bytes.readUInt16LE(end + 8) !== 1 || bytes.readUInt16LE(end + 10) !== 1) throw new ZipRelatorioError('ZIP_CONTRATO_INVALIDO')
  const directory = bytes.readUInt32LE(end + 16), directorySize = bytes.readUInt32LE(end + 12)
  if (directory < 30 || directory + directorySize !== end || directorySize < 46 || bytes.readUInt32LE(directory) !== 0x02014b50
    || directorySize !== 46 + bytes.readUInt16LE(directory + 28) + bytes.readUInt16LE(directory + 30) + bytes.readUInt16LE(directory + 32)
    || bytes.readUInt16LE(directory + 34) !== 0 || bytes.readUInt32LE(directory + 42) !== 0) throw new ZipRelatorioError('ZIP_CONTRATO_INVALIDO')
  const flags = bytes.readUInt16LE(directory + 8), method = bytes.readUInt16LE(directory + 10)
  const size = bytes.readUInt32LE(directory + 24), compressed = bytes.readUInt32LE(directory + 20)
  const checksum = bytes.readUInt32LE(directory + 16)
  if ((flags & ~0x080e) !== 0 || ![0, 8].includes(method) || bytes.readUInt16LE(6) !== flags || bytes.readUInt16LE(8) !== method) throw new ZipRelatorioError('ZIP_CONTRATO_INVALIDO')
  if (!size || size > MAX_REPORT_BYTES || !compressed || compressed > MAX_REPORT_BYTES) throw new ZipRelatorioError('ZIP_LIMITE')
  const nameLength = bytes.readUInt16LE(26), dataStart = 30 + nameLength + bytes.readUInt16LE(28)
  const remainder = directory - dataStart - compressed
  if (dataStart > directory || (flags & 8 ? ![12, 16].includes(remainder) : remainder !== 0)
    || nameLength !== bytes.readUInt16LE(directory + 28)
    || !bytes.subarray(30, 30 + nameLength).equals(bytes.subarray(directory + 46, directory + 46 + nameLength))) throw new ZipRelatorioError('ZIP_CONTRATO_INVALIDO')
  if (!(flags & 8) && (bytes.readUInt32LE(14) !== checksum || bytes.readUInt32LE(18) !== compressed || bytes.readUInt32LE(22) !== size)) throw new ZipRelatorioError('ZIP_INTEGRIDADE')
  return { size, checksum }
}

export async function extrairCsvZipVortx(input: Uint8Array): Promise<Uint8Array> {
  try {
    const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength), envelope = envelopeUnico(bytes)
    // Do not use checkCRC32=true: it eagerly inflates before enforcing actual output bounds.
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false })
    const entries = Object.values(zip.files)
    if (entries.length !== 1) throw new ZipRelatorioError('ZIP_CONTRATO_INVALIDO')
    const entry = entries[0], name = entry.unsafeOriginalName ?? entry.name
    if (entry.dir || name !== entry.name || name.length > 256 || /[\\/:\u0000-\u001f]/.test(name)
      || !/\.csv$/i.test(name) || (Number(entry.unixPermissions ?? 0) & 0xf000) === 0xa000) throw new ZipRelatorioError('ZIP_CONTRATO_INVALIDO')
    return await new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Buffer[] = []; let count = 0, checksum = 0, settled = false
      const stream = streamCsvZip(entry)
      const fail = (code: ZipRelatorioError['codigo']) => {
        if (settled) return
        settled = true; clearTimeout(timer); stream.pause(); chunks.length = 0; reject(new ZipRelatorioError(code))
      }
      const timer = setTimeout(() => fail('ZIP_LIMITE'), 10000)
      stream.on('data', (chunk: Uint8Array) => {
        if (settled) return
        count += chunk.byteLength
        if (count > envelope.size || count > MAX_REPORT_BYTES) { fail('ZIP_LIMITE'); return }
        checksum = crc32(chunk, checksum); chunks.push(Buffer.from(chunk))
      }).on('error', () => fail('ZIP_INTEGRIDADE')).on('end', () => {
        if (settled) return
        if (count !== envelope.size || checksum !== envelope.checksum) { fail('ZIP_INTEGRIDADE'); return }
        settled = true; clearTimeout(timer); resolve(Buffer.concat(chunks, count))
      }).resume()
    })
  } catch (error) { throw error instanceof ZipRelatorioError ? error : new ZipRelatorioError('ZIP_CONTRATO_INVALIDO') }
}
