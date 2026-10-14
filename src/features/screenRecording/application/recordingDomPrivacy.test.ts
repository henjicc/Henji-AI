// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { sensitiveDomRegions } from './recordingDomPrivacy'
it('只采集可见密码框几何，原值/名称/占位符不进入快照', () => {
  document.documentElement.style.width = '1000px'
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000); vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800)
  document.body.innerHTML = '<input type="password" value="DO-NOT-READ" name="secret"><input type="text" value="ordinary"><input type="password" style="display:none">'
  document.querySelectorAll('input').forEach(el => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 40, width: 200, height: 30, left: 20, top: 40, right: 220, bottom: 70, toJSON: () => ({}) }))
  const ids = new WeakMap<Element, string>(), regions = sensitiveDomRegions(document, ids)
  expect(regions).toHaveLength(1); expect(regions[0]).toMatchObject({ x: 20, y: 40, width: 200, height: 30 }); expect(sensitiveDomRegions(document, ids)[0].id).toBe(regions[0].id)
  expect(JSON.stringify(regions)).not.toContain('DO-NOT-READ'); expect(JSON.stringify(regions)).not.toContain('secret')
  document.body.innerHTML = ''; vi.restoreAllMocks()
})
