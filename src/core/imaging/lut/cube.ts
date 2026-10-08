export const CUBE_LUT_MAX_BYTES = 24 * 1024 * 1024
export interface CubeLut { title: string; kind: '1d' | '3d'; size: number; domainMin: [number, number, number]; domainMax: [number, number, number]; data: Float32Array }
/** Strict Adobe .cube, red changes fastest. Float data, no 8-bit quantization. */
export function parseCubeLut(text: string): CubeLut {
  if (new TextEncoder().encode(text).byteLength > CUBE_LUT_MAX_BYTES) throw new Error('LUT 文件过大，最多24MiB。')
  let title = ''; let kind: CubeLut['kind'] | undefined; let size = 0
  const domainMin: CubeLut['domainMin'] = [0, 0, 0]; const domainMax: CubeLut['domainMax'] = [1, 1, 1]
  const rows: number[] = []; const headers = new Set<string>()
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.replace(/("[^"]*")|#.*$/g, (match, quoted: string | undefined) => quoted ?? '').trim(); if (!line) continue
    const [head, ...rest] = line.split(/\s+/)
    if (['TITLE', 'LUT_1D_SIZE', 'LUT_3D_SIZE', 'DOMAIN_MIN', 'DOMAIN_MAX'].includes(head)) {
      if (rows.length || headers.has(head)) throw new Error('LUT 头字段重复或位于数据之后。')
      headers.add(head)
      if (head === 'TITLE') { const match = line.match(/^TITLE\s+"(.*)"$/); if (!match) throw new Error('LUT TITLE 需要引号。'); title = match[1]; continue }
      if (head.startsWith('LUT_')) {
        if (kind || rest.length !== 1 || !/^\d+$/.test(rest[0])) throw new Error('只支持单个1D或3D LUT，尺寸必须是整数。')
        kind = head === 'LUT_3D_SIZE' ? '3d' : '1d'; size = Number(rest[0])
        if (size < 2 || size > (kind === '3d' ? 65 : 65536)) throw new Error('3D LUT 尺寸需为2–65，1D为2–65536。')
      } else {
        const values = rest.map(Number)
        if (values.length !== 3 || rest.some(value => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) || values.some(value => !Number.isFinite(Math.fround(value)))) throw new Error('DOMAIN_MIN/MAX 必须包含三个有限数值。')
        ;(head === 'DOMAIN_MIN' ? domainMin : domainMax).splice(0, 3, ...values)
      }
      continue
    }
    const tokens = line.split(/\s+/); const values = tokens.map(Number)
    if (!kind || values.length !== 3 || tokens.some(value => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) || values.some(value => !Number.isFinite(value) || Math.abs(value) > 65504)) throw new Error('LUT 数据必须是尺寸声明后的三个有限颜色值。')
    rows.push(...values)
    if (rows.length > (kind === '3d' ? size ** 3 : size) * 3) throw new Error('LUT 数据数量与尺寸不一致。')
  }
  if (!kind || rows.length !== (kind === '3d' ? size ** 3 : size) * 3) throw new Error('LUT 数据数量与尺寸不一致。')
  if (domainMin.some((value, i) => Math.fround(value) >= Math.fround(domainMax[i]) || !Number.isFinite(Math.fround(domainMax[i] - value)))) throw new Error('DOMAIN_MAX 必须逐通道大于 DOMAIN_MIN，且差值可表示为有限浮点数。')
  const data = new Float32Array(rows.length / 3 * 4)
  for (let i = 0; i < rows.length / 3; i++) data.set([...rows.slice(i * 3, i * 3 + 3), 1], i * 4)
  return { title, kind, size, domainMin, domainMax, data }
}
