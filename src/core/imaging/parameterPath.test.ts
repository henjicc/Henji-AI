import { expect, it } from 'vitest'
import { replaceParameterPath } from './parameterPath'
import { textStyleSchema } from './vectorContent/text'

it('字体预览只替换指定数据项的字体，保留嵌套样式和其他行', () => {
  const rows = [{ title: '甲', style: textStyleSchema.parse({ fontFamily: 'Original', fontSize: 48 }) }, { title: '乙', style: textStyleSchema.parse({ fontFamily: 'Second' }) }]
  const result = replaceParameterPath(rows, ['0', 'style', 'fontFamily'], 'Preview')
  expect(result).toMatchObject([{ title: '甲', style: { fontFamily: 'Preview', fontSize: 48 } }, { title: '乙', style: { fontFamily: 'Second' } }])
  expect(rows[0].style.fontFamily).toBe('Original')
  expect(() => replaceParameterPath(rows, ['2', 'style', 'fontFamily'], 'Preview')).toThrow('重新选择')
  expect(() => replaceParameterPath(rows, ['0', 'missing'], 'Preview')).toThrow('重新选择')
})
