/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 巡检启动器使用 CommonJS 场景工厂。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const { fixture } = require('./uiInspectionSceneVideoEditMotionDraft.cjs')
const { seedVideoEditProject, openVideoEditProjectCard } = require('./uiInspectionVideoEditDocuments.cjs')
const { createPlaybackFixture, seedCameraStageDocument } = require('./uiInspectionCameraStagePlayback.cjs')

const button = (page, name) => page.getByRole('button', { name, exact: true })

/** 仅核对面板布局；真实文档与本地动作整理，不调用模型、不跑性能或付费链路。 */
function createSuperKeyframePanelScenes(context) {
  return [
    { id: 'super-keyframe-panel-motion', surface: '剪辑', name: '超级关键帧面板-idle录制候选', writesUserData: true,
      setup: async (page, _app, { capture }) => {
        const root = path.resolve('.tmp/u4-super-keyframe'); fs.mkdirSync(root, { recursive: true })
        const source = path.join(root, 'source.png')
        await sharp({ create: { width: 1280, height: 720, channels: 3, background: { r: 120, g: 150, b: 170 } } }).png().toFile(source)
        await button(page, '剪辑').first().click()
        const seeded = await seedVideoEditProject(page, fixture(source))
        await page.evaluate(async ({ source, projectId, id }) => {
          const documents = window.henjiNative.documents
          const resource = await documents.importFile({ sourcePath: source, container: { kind: 'project', projectId }, folder: 'materials' })
          const read = await documents.readDocument({ id }); read.content.media[0].path = resource.path
          await documents.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content: read.content })
        }, { source, projectId: seeded.projectId, id: seeded.documentId })
        await openVideoEditProjectCard(page, seeded.projectId)
        await page.locator('[data-video-edit-clip="motion-clip"] [aria-label^="选择片段"]').click()
        const controls = page.locator('[data-creative-intent-controls]')
        const toggle = () => page.getByRole('button', { name: /^(超级关键帧|正在示范)$/ })
        const open = async () => { if (!await controls.isVisible()) await toggle().click(); await controls.waitFor({ state: 'visible' }) }
        const close = async () => { if (await controls.isVisible()) await toggle().click(); await controls.waitFor({ state: 'hidden' }) }
        await open()
        assert(await page.getByLabel('使用标注', { exact: true }).isDisabled())
        assert.equal(await controls.getByRole('radio', { name: '分时摆放' }).getAttribute('aria-checked'), 'true')
        await context.settlePage(page, 300); await capture('idle')
        await controls.getByRole('radio', { name: '录制轨迹' }).click()
        await page.getByLabel('录制速度', { exact: true }).waitFor({ state: 'visible' })
        await context.settlePage(page, 300); await capture('record-selected')
        await controls.getByRole('radio', { name: '分时摆放' }).click()
        await button(page, '开始示范').click(); await close()
        const drag = async (dx, dy) => {
          const box = await page.locator('[data-video-edit-program-display]').boundingBox(); assert(box)
          const x = box.x + box.width * .5, y = box.y + box.height * .5
          await page.mouse.move(x, y); await page.mouse.down()
          await page.mouse.move(x + box.width * dx, y + box.height * dy, { steps: 8 }); await page.mouse.up()
          await page.waitForTimeout(200)
        }
        await drag(-.1, -.05)
        const ruler = page.getByRole('slider', { name: '剪辑时间定位', exact: true })
        await ruler.focus(); for (let frame = 0; frame < 30; frame++) await ruler.press('ArrowRight')
        await drag(.1, .05); await open(); await button(page, '结束示范').click()
        await button(page, '整理').click()
        await button(page, '应用').waitFor({ state: 'visible', timeout: 30000 })
        await context.settlePage(page, 300); await capture('candidates-top')
        await button(page, '应用').scrollIntoViewIfNeeded()
        await context.settlePage(page, 300); await capture('candidates-bottom')
      } },
    { id: 'super-keyframe-panel-camera', surface: '镜头参考', name: '超级关键帧面板-镜头参考', writesUserData: true,
      setup: async (page, _app, { capture }) => {
        await context.setupToolbox(page)
        const id = await seedCameraStageDocument(page, { name: 'u4镜头参考面板巡检', scene: createPlaybackFixture() })
        await context.clickNamedButton(page, /^(3D 镜头参考|3D Camera Reference)/i)
        await page.locator(`[data-project-id="${id}"]`).click()
        await button(page, '超级关键帧').click()
        await page.locator('[data-creative-intent-controls]').waitFor({ state: 'visible' })
        await context.settlePage(page, 300); await capture('camera')
      } },
  ]
}
module.exports = { createSuperKeyframePanelScenes }
