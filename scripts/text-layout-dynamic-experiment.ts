import type { Font, openHarness } from './text-layout-worker-experiment'
import type { CodeAuthorBundle } from '../src/core/videoEdit/codeAuthorProgram'
import type { StaticTextFonts } from '../src/core/videoEdit/codeMaterial/textFonts'

export async function runDynamicTextExperiment(_fonts: Font[], host: Awaited<ReturnType<typeof openHarness>>): Promise<unknown> {
  const cases = await (await fetch('dynamic-cases.json')).json() as Array<{ id: string; code: string; precise: boolean; resources: StaticTextFonts }>
  const rows = [], failures: string[] = [], captures = []
  try {
    for (const item of cases) {
      const code = item.code.replace('henji-layout/text', new URL('author-text.mjs', location.href).href)
      const bundle: CodeAuthorBundle = { code, map: '', locations: { layers: {} }, apiVersion: 10, libraries: { 'henji-layout': '2.0.0' }, textEntry: 'main.js', textFonts: [{ file: 'main.js', ...item.resources }] }
      await host.send({ id: 0, kind: 'authorMetadata', url: item.id, apiVersion: 10, bundle })
      await host.snapshot()
      const response = await host.frame(item.id, bundle, 1)
      const snapshot = await host.snapshot()
      const selected = snapshot.selections.filter(value => value.text.trim())
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 240
      const ctx = canvas.getContext('2d')!; ctx.drawImage(response.bitmap!, 0, 0); response.bitmap!.close()
      const ink = ctx.getImageData(0, 0, 640, 240).data.some((value, index) => index % 4 !== 3 && value > 0)
      const glyphs = new Set(selected.map(value => value.text))
      if (!ink || selected.some(value => value.missing) || [...'★✓①한𠀀'].some(value => !glyphs.has(value))) failures.push(`${item.id}: 墨迹/缺字/覆盖不满足裁定`)
      if (item.precise && item.resources.dynamicText) failures.push(`${item.id}: 可证明的写法退回了完整候选集`)
      rows.push({ id: item.id, selected, ink, preparedText: item.resources.dynamicText ? null : item.resources.declaration.text ?? [] })
      captures.push({ name: item.id, dataUrl: canvas.toDataURL() })
      await host.release(item.id)
    }
    return { cases: [], rows, captures, gate: { passed: !failures.length, failures } }
  } finally { await host.close() }
}
