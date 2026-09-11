const path = require('node:path')
const { mkdir, writeFile } = require('node:fs/promises')
const { execFileSync } = require('node:child_process')
const sharp = require('sharp')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')

function createCanvasUploadsScene(context) {
  return {
    id: 'canvas-unified-upload', surface: '画布', name: '画布-统一上传与展示尺寸', writesUserData: true,
    async setup(page, app) {
      const { projectId, panoramaSource } = await context.seedAndOpenCanvasPanoramaProject(page)
      const fixtureDir = path.resolve('.ui-tour/upload-fixtures')
      await mkdir(fixtureDir, { recursive: true })
      const landscape = path.join(fixtureDir, 'landscape.png')
      const portrait = path.join(fixtureDir, 'portrait.png')
      const video = path.join(fixtureDir, 'video.mp4')
      const audio = path.join(fixtureDir, 'audio.wav')
      await sharp(panoramaSource).resize(1600, 900).toFile(landscape)
      await sharp(panoramaSource).resize(900, 1600).toFile(portrait)
      const { ffmpegPath } = require('ffmpeg-ffprobe-static')
      execFileSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=12', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { windowsHide: true, stdio: 'pipe' })
      execFileSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-af', 'afade=t=in:d=0.5,afade=t=out:st=2:d=1', audio], { windowsHide: true, stdio: 'pipe' })
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
      await page.locator(`[data-project-id="${projectId}"]:visible`).waitFor()
      await page.evaluate(async projectId => {
        const nodes = [
          { id: 'upload-landscape', type: 'universalUploadNode', position: { x: 60, y: 80 }, data: {} },
          { id: 'upload-portrait', type: 'universalUploadNode', position: { x: 570, y: 80 }, data: {} },
          { id: 'upload-video', type: 'universalUploadNode', position: { x: 60, y: 490 }, data: {} },
          { id: 'upload-audio', type: 'universalUploadNode', position: { x: 570, y: 620 }, data: {} },
          { id: 'upload-reference', type: 'imageNode', position: { x: 1060, y: 80 }, data: { prompt: '图片生成节点 · 大小对照' } },
        ]
        await window.henjiNative.db.execute(
          'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ?, history_json = ? WHERE id = ?',
          [nodes.length, JSON.stringify(nodes), '[]', JSON.stringify({ x: 65, y: 45, zoom: 0.65 }), JSON.stringify({ past: [], future: [], imagePool: [] }), projectId])
      }, projectId)
      await page.locator(`[data-project-id="${projectId}"]:visible`).click()
      const cases = [
        ['landscape', landscape, 'uploadNode', 427, 240],
        ['portrait', portrait, 'uploadNode', 240, 427],
        ['video', video, 'videoUploadNode', 427, 240],
        ['audio', audio, 'audioUploadNode', 453, 226],
      ]
      for (const [name, file, type, width, height] of cases) {
        const node = page.locator(`.react-flow__node[data-id="upload-${name}"]`)
        await node.locator('input[type="file"]').setInputFiles(file)
        await page.locator(`.react-flow__node-${type}[data-id="upload-${name}"]`).waitFor()
        await page.waitForFunction(({ id, width, height }) => {
          const box = document.querySelector(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect()
          return box && Math.abs(box.width / 0.65 - width) < 2 && Math.abs(box.height / 0.65 - height) < 2
        }, { id: `upload-${name}`, width, height })
      }
      await page.waitForFunction(() => [...document.querySelectorAll('.react-flow__node img')].filter(img => img.naturalWidth > 0).length >= 3)
      const audioNode = page.locator('.react-flow__node[data-id="upload-audio"]')
      await audioNode.locator('svg rect').nth(10).waitFor({ state: 'attached' })
      if (await page.locator('.react-flow__node video').count()) throw new Error('视频封面展示时不应启动播放器')
      await writeFile('.ui-tour/canvas-unified-upload.png', await captureInspectionPage(app, page))

      // 已上传图片的替换入口也应保持相同面积，保存重开保留手动尺寸。
      const imageNode = page.locator('.react-flow__node[data-id="upload-landscape"]')
      await imageNode.locator('input[type="file"]').setInputFiles(portrait)
      await page.waitForFunction(() => {
        const box = document.querySelector('.react-flow__node[data-id="upload-landscape"]')?.getBoundingClientRect()
        return box && Math.abs(box.width / 0.65 - 240) < 2 && Math.abs(box.height / 0.65 - 427) < 2
      })
      await context.resizeCanvasNodeAndAssertHitBox(page, audioNode, audioNode.locator('.canvas-node-paint-frame > div').first(), '上传音频')
      const resized = await audioNode.boundingBox()
      await page.locator('.react-flow__pane').click({ position: { x: 15, y: 350 } })
      await writeFile('.ui-tour/canvas-unified-upload-resized.png', await captureInspectionPage(app, page))
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
      await page.locator(`[data-project-id="${projectId}"]:visible`).waitFor()
      await page.locator(`[data-project-id="${projectId}"]:visible`).click()
      await audioNode.waitFor()
      const reopened = await audioNode.boundingBox()
      if (Math.abs(reopened.width - resized.width) > 2 || Math.abs(reopened.height - resized.height) > 2) throw new Error('音频手动尺寸重开后丢失')
    },
  }
}

module.exports = { createCanvasUploadsScene }
