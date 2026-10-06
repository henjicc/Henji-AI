import { describe, expect, it } from 'vitest'
import { parseCubeLut } from './cubeLut'
describe('严格 .cube 解析', () => {
  it('注释、BOM、科学计数、非默认DOMAIN与1D/3D红通道先变', () => {
    const one = parseCubeLut('\uFEFF# sample\nTITLE "Look #1" # title\nLUT_1D_SIZE 2 # size\nDOMAIN_MIN -1 -2 -3\nDOMAIN_MAX 1 2 3\n0 0 0\n1e0 +1.0 1 # white')
    expect(one).toMatchObject({ title: 'Look #1', kind: '1d', size: 2, domainMin: [-1, -2, -3], domainMax: [1, 2, 3] }); expect([...one.data]).toEqual([0, 0, 0, 1, 1, 1, 1, 1])
    const rows = Array.from({ length: 8 }, (_, i) => `${i % 2} ${Math.floor(i / 2) % 2} ${Math.floor(i / 4)}`).join('\n')
    const three = parseCubeLut(`LUT_3D_SIZE 2\n${rows}`)
    expect(three.kind).toBe('3d'); expect([...three.data.slice(4, 8)]).toEqual([1, 0, 0, 1])
  })
  it.each(['LUT_3D_SIZE 66', 'LUT_3D_SIZE 1', 'LUT_3D_SIZE 2.5', 'LUT_3D_SIZE 2\n0 0 0', 'LUT_1D_SIZE 2\n0 0 0\n1 1 1\n1 1 1', 'LUT_1D_SIZE 2\nLUT_3D_SIZE 2', 'LUT_1D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 0 1 1\n0 0 0\n1 1 1', 'LUT_1D_SIZE 2\n0 NaN 0\n1 1 1', 'LUT_1D_SIZE 2\n0 0 0\nDOMAIN_MIN 0 0 0\n1 1 1'])('拒绝尺寸/数量/域/错行：%s', text => { expect(() => parseCubeLut(text)).toThrow() })
  it('接受65³上限，全部颜色为浮点且没有8位量化', () => {
    const lut = parseCubeLut(`LUT_3D_SIZE 65\n${'0.123456 -0.1 1.2\n'.repeat(65 ** 3)}`)
    expect(lut.data.length).toBe(65 ** 3 * 4); expect(lut.data[0]).toBeCloseTo(.123456, 6)
  })
  it.each(['LUT_1D_SIZE 2\n0 0x1 0\n1 1 1', 'LUT_1D_SIZE 2\nDOMAIN_MAX 1e50 1 1\n0 0 0\n1 1 1', 'LUT_1D_SIZE 2\nDOMAIN_MIN 1 0 0\nDOMAIN_MAX 1.000000001 1 1\n0 0 0\n1 1 1'])('拒绝非cube数值与GPU不可表示域：%s', text => { expect(() => parseCubeLut(text)).toThrow() })
})
