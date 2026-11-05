import { expect, it } from 'vitest'
import { codeImageReference } from './contract'
import { codeMaterialImageReferenceSchema } from './parameterValueSchema'
import { codeWebLayerCss, codeWebLayerIssue } from './webSource'

const web = (layer: unknown) => ({ kind: 'web', path: '/project/site/index.html', layer })

it('作者写入与落盘校验对 layer 的判断一致', () => {
  for (const layer of [{ only: ['#title'] }, { hide: ['#title', '.body'] }]) {
    expect(codeImageReference(web(layer), '网页')).toMatchObject({ layer })
    expect(codeMaterialImageReferenceSchema.safeParse(web(layer)).success).toBe(true)
  }
  for (const layer of [{}, { only: [] }, { only: ['#a'], hide: ['#b'] }, { show: ['#a'] }, ['#a'], { only: '#a' }, { only: ['#a', '#a'] }]) {
    expect(codeWebLayerIssue(layer)).toBeTruthy()
    expect(() => codeImageReference(web(layer), '网页')).toThrow()
    expect(codeMaterialImageReferenceSchema.safeParse(web(layer)).success).toBe(false)
  }
})

it('藏文字不改布局也不碰背景；只留文字把背景清掉', () => {
  const hide = codeWebLayerCss({ hide: ['#title'] })
  expect(hide).toContain(':is(#title), :is(#title) *')
  expect(hide).not.toMatch(/visibility|display|background|[^-]color: transparent/)
  const only = codeWebLayerCss({ only: ['#title', '.body'] })
  expect(only).toContain('[data-henji-stage]')
  expect(only).toContain(':is(.body) *')
  expect(only).not.toMatch(/display/)
  // 目标和祖先都不碰 visibility，页面自己隐藏的内容继续隐藏。
  expect(only).toContain('body *:not(:is(#title), :is(#title) *, :is(.body), :is(.body) *, :has(#title), :has(.body)) { visibility: hidden')
  expect(only).not.toMatch(/visibility: visible/)
  expect(only).toContain('background-image: none')
  // 页面写的发光会被格子切开，两层都去掉，发光交给效果库。
  expect(only).toContain('text-shadow: none')
  expect(hide).toContain('text-shadow: none')
})
