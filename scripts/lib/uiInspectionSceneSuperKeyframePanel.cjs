/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 巡检启动器使用 CommonJS 场景工厂。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const { fixture } = require('./uiInspectionSceneVideoEditMotionDraft.cjs')
const { seedVideoEditProject, openVideoEditProjectCard, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { createPlaybackFixture, seedCameraStageDocument } = require('./uiInspectionCameraStagePlayback.cjs')

const button = (page, name) => page.getByRole('button', { name, exact: true })

/** 仅核对面板布局；真实文档与本地动作整理，不调用模型、不跑性能或付费链路。 */
function createSuperKeyframePanelScenes(context) {
  return [
    { id: 'super-keyframe-panel-motion', surface: '剪辑', name: '超级关键帧-原生录音与动作时钟', writesUserData: true,
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
        const microphone = page.getByRole('switch', { name: '麦克风', exact: true })
        const open = async () => { if (!await microphone.isVisible()) await button(page, '超级关键帧').click(); await microphone.waitFor() }
        const close = async () => { await page.keyboard.press('Escape'); await microphone.waitFor({ state: 'hidden' }) }
        await open()
        if (await microphone.getAttribute('aria-checked') !== 'true') await microphone.click()
        await page.getByRole('button', { name: /录音设置/ }).click()
        await page.locator('[data-audio-capture-settings]').waitFor()
        await context.settlePage(page, 300); await capture('native-settings')
        await page.keyboard.press('Escape')
        await context.settlePage(page, 300); await capture('idle')
        await button(page, '开始录制').click(); await button(page, '暂停').waitFor(); await close()
        await page.waitForTimeout(1800)
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
        await drag(.1, .05); await page.waitForTimeout(500); await open(); await button(page, '暂停').click()
        await button(page, '继续录制').waitFor(); await page.waitForTimeout(700)
        await button(page, '继续录制').click(); await button(page, '暂停').waitFor(); await close()
        await page.waitForTimeout(1200); await drag(-.05, .04); await page.waitForTimeout(500)
        await open(); await button(page, '暂停').click(); await button(page, '继续录制').waitFor()
        await context.settlePage(page, 300); await capture('native-audio-paused')
        let document
        for (let i = 0; i < 100; i++) { document = readVideoEditFile(seeded.file); if (document.creativeIntents?.sessions[0]?.state === 'paused' && document.creativeIntents.sessions[0].pages.filter(ref => ref.kind === 'audio').length >= 2) break; await page.waitForTimeout(100) }
        const session = document.creativeIntents?.sessions[0], draft = document.creativeIntents?.drafts[0]
        assert(session && draft, '动作与讲解原稿必须保存')
        const events = session.pages.flatMap(ref => JSON.parse(fs.readFileSync(document.creativeIntents.resources.find(value => value.resourceId === ref.resourceId).path, 'utf8')).entries)
        const audio = events.filter(event => event.kind === 'audio').sort((a, b) => a.monoSpanUs[0] - b.monoSpanUs[0])
        const pointers = events.filter(event => event.kind === 'pointer' && event.phase === 'down' && event.compositionPoint)
        const gapUs = audio.length >= 2 ? audio[1].monoSpanUs[0] - audio[0].monoSpanUs[1] : 0
        const evidence = { audio, pointers, takes: draft.takes, clockSegments: session.clockSegments, gapUs, device: 'native effective recording settings', transcription: 'not requested; paused before paid ASR' }
        fs.writeFileSync(path.join(root, 'native-alignment.json'), JSON.stringify(evidence, null, 2))
        assert(audio.length >= 2 && gapUs >= 600000, '原生音频必须保留暂停的真实空隙')
        assert(pointers.length >= 2 && pointers.every(point => audio.some(block => point.monoUs >= block.monoSpanUs[0] - block.uncertaintyUs && point.monoUs <= block.monoSpanUs[1] + block.uncertaintyUs)), '画面指向必须落在同一单调时钟的音频块内')
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
