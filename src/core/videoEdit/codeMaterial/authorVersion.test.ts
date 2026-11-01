import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { AUTHOR_LIBRARIES, latestAuthorLibraryVersions } from './authorLibraries'
import { CODE_AUTHOR_API_VERSION } from '../codeAuthorVersions'
import fs from 'node:fs'
import { expect, it } from 'vitest'
import { PERSISTENCE_FORMATS } from '../../persistence/formats'
import { upgradePersistenceContent } from '../../persistence/migrations'
import { videoEditStyleSchema, videoEditStyleContentHash, videoEditTemplateContentHash } from '../styles/styleSchemas'
import { videoEditTemplateSchema } from '../styles/templateSchemas'
import { HISTORICAL_PREVIEW_AUTHOR, pinPreviewAuthor, previewAuthorIdentity, resolvePreviewAuthor } from './authorVersion'

const read = (id: string, version: number) => JSON.parse(fs.readFileSync(`tests/fixtures/persistence/${id}/v${version}.json`, 'utf8')) as { content: unknown }
it('历史样片与代码模板迁移固定解释版本，原件、内容摘要、版本与预览媒体不变', async () => {
  for (const id of ['video-style-library', 'video-template-library', 'video-style-package', 'document.video_edit', 'document.screen_recording']) {
    const format = PERSISTENCE_FORMATS.find(value => value.id === id)!
    // 补固定解释版本的那一步迁移之前的样本；之后的版本只追加，不再改动这些位置。
    const previous = ({ 'video-style-library': 9, 'video-template-library': 6, 'video-style-package': 12, 'document.video_edit': 53, 'document.screen_recording': 56 } as Record<string, number>)[id]
    const original = read(id, previous).content, frozen = structuredClone(original)
    const upgraded = upgradePersistenceContent(format, original, previous)
    expect(original).toEqual(frozen)
    const pins: unknown[] = []
    const compare = (before: unknown, after: unknown): void => {
      if (Array.isArray(before)) { before.forEach((value, index) => compare(value, (after as unknown[])[index])); return }
      if (!before || typeof before !== 'object') { expect(after).toEqual(before); return }
      const result = after as Record<string, unknown>
      if ('code' in before && before.code && typeof before.code === 'object' && 'files' in before.code) {
        pins.push(result)
        expect(result).toMatchObject(HISTORICAL_PREVIEW_AUTHOR)
        const { apiVersion: _api, libraries: _libraries, ...rest } = result
        expect(rest).toEqual(before)
      } else {
        expect(Object.keys(result)).toEqual(Object.keys(before))
        Object.entries(before).forEach(([key, child]) => compare(child, result[key]))
      }
    }
    compare(original, upgraded)
    expect(pins.length).toBeGreaterThan(0)
    expect(upgradePersistenceContent(format, upgraded, format.version)).toEqual(upgraded)
    if (id === 'video-style-library') {
      const before = videoEditStyleSchema.parse(original), after = videoEditStyleSchema.parse(upgraded)
      expect(await videoEditStyleContentHash(after)).toBe(await videoEditStyleContentHash(before))
      expect(await videoEditStyleContentHash({ ...after, sample: { ...after.sample, apiVersion: 10 } })).not.toBe(await videoEditStyleContentHash(before))
    }
    if (id === 'video-template-library') {
      const before = videoEditTemplateSchema.parse(original), after = videoEditTemplateSchema.parse(upgraded)
      expect(await videoEditTemplateContentHash(after.body)).toBe(await videoEditTemplateContentHash(before.body))
      expect(await videoEditTemplateContentHash({ ...after.body, apiVersion: 10 })).not.toBe(await videoEditTemplateContentHash(before.body))
    }
  }
})
it('显式版本经过写入读回保留，旧源码版本不被隐式升级，未知库在编译前拒绝', () => {
  const format = PERSISTENCE_FORMATS.find(value => value.id === 'video-style-library')!
  const sample = videoEditStyleSchema.parse(read(format.id, 6).content)
  sample.sample.apiVersion = 6; sample.sample.libraries = { 'henji-layout': '1.0.0' }
  expect(upgradePersistenceContent(format, JSON.parse(JSON.stringify(sample)), 6)).toEqual(sample)
  const source = { entry: 'main.js', files: { 'main.js': "import { layoutText } from 'henji-layout/text'; export default { draw() { return layoutText('A') } }" } }
  expect(pinPreviewAuthor(source)).toEqual({ apiVersion: CODE_AUTHOR_API_VERSION, libraries: { 'henji-layout': '2.0.0' } })
  expect(pinPreviewAuthor(source, { apiVersion: 10 }).libraries['henji-layout']).toBe('2.0.0')
  expect(pinPreviewAuthor(source, { apiVersion: 6, libraries: { 'henji-layout': '1.0.0' } })).toEqual({ apiVersion: 6, libraries: { 'henji-layout': '1.0.0' } })
  expect(() => resolvePreviewAuthor({ apiVersion: 10, libraries: { 'henji-layout': '99.0.0' } })).toThrow('未提供')
  const code = PERSISTENCE_FORMATS.find(value => value.id === 'code-version')!
  const old = read(code.id, 8)
  expect(upgradePersistenceContent(code, old, 8)).toEqual(old)
})

it('样片与模板摘要只计入源码实际导入的库，发行未用到的库版本不触发重渲', async () => {
  const code = { entry: 'main.js', files: { 'main.js': "import { layoutText } from 'henji-layout/text'; export default { draw() { layoutText('A') } }" } }
  const pinned = { apiVersion: 10, libraries: { 'henji-layout': '2.0.0' } }
  expect(previewAuthorIdentity(code, pinned)).toEqual(pinned)
  const unused = { apiVersion: 10, libraries: { ...latestAuthorLibraryVersions(10), 'henji-layout': '2.0.0' } }
  expect(Object.keys(unused.libraries).length).toBeGreaterThan(1)
  const format = PERSISTENCE_FORMATS.find(value => value.id === 'video-style-library')!
  const style = videoEditStyleSchema.parse(read(format.id, format.version).content)
  const sample = (pin: typeof pinned) => videoEditStyleContentHash({ ...style, sample: { ...style.sample, code, ...pin } })
  expect(await sample(unused)).toBe(await sample(pinned))
  expect(await videoEditTemplateContentHash({ kind: 'code', code, ...unused })).toBe(await videoEditTemplateContentHash({ kind: 'code', code, ...pinned }))
  // 实际导入的库换版本仍改变摘要。
  const older = { entry: 'main.js', files: { 'main.js': code.files['main.js'] } }
  expect(await videoEditTemplateContentHash({ kind: 'code', code: older, apiVersion: 9, libraries: { 'henji-layout': '1.1.0' } })).not.toBe(await videoEditTemplateContentHash({ kind: 'code', code: older, apiVersion: 9, libraries: { 'henji-layout': '1.2.0' } }))
})

it('缺版本的历史样片使用 effects 1.3 导出迁移，新写入记录当前接口', async () => {
  const { migrateStyleAuthor } = await import('../styles/authorVersionMigration')
  const code = { entry: 'main.js', files: { 'main.js': "import { shadow } from 'henji-effects'; export default { layers() { return [{effects:[shadow()]}] } }" } }
  const migrated = migrateStyleAuthor({ sample: { code } }) as { sample: { apiVersion: number; libraries: Record<string, string> } }
  const pinned = pinPreviewAuthor(code, migrated.sample)
  const release = AUTHOR_LIBRARIES['henji-effects'][pinned.libraries['henji-effects']]
  const effects = await import(/* @vite-ignore */ pathToFileURL(path.resolve(release.frozen!, 'index.mjs')).href) as { shadow: () => unknown }
  expect(effects.shadow()).toBeDefined()
  expect(migrated.sample.apiVersion).toBe(9)
  expect(pinPreviewAuthor(code).apiVersion).toBe(CODE_AUTHOR_API_VERSION)
})

it('未标记样片固定迁移前的效果解释，方向模糊不退回高斯模糊', async () => {
  const code = { entry: 'main.js', files: { 'main.js': "import { blur } from 'henji-effects'; export default { layers() { return [{ effects: [blur({ mode: 'directional', amount: 50 })] }] } }" } }
  const pinned = pinPreviewAuthor(code)
  const release = AUTHOR_LIBRARIES['henji-effects'][pinned.libraries['henji-effects']]
  const url = pathToFileURL(path.resolve(release.frozen!, 'index.mjs')).href
  const effects = await import(/* @vite-ignore */ url) as typeof import('../../../features/videoEdit/authorLibraries/effects.generated')
  expect(effects.blur({ mode: 'directional', amount: 50 })).toEqual({ id: 'blur', params: { mode: 'directional', amount: 50 } })
  expect(pinPreviewAuthor(code, { apiVersion: 7, libraries: { 'henji-effects': '1.0.0' } }).libraries['henji-effects']).toBe('1.0.0')
})
