const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function createVideoEditCompositeScene() {
  return { id: 'video-edit-composite-contract', surface: '剪辑', name: '剪辑-基础图层离屏与转场4K GPU验收', writesUserData: false,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-composite-contract'); fs.mkdirSync(root, { recursive: true })
      const display = await app.evaluate(({ BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows().find(window => !window.isDestroyed())
        const bounds = window.getBounds(); const chosen = screen.getDisplayMatching(bounds)
        return { window: bounds, chosen, primaryId: screen.getPrimaryDisplay().id }
      })
      assert.notEqual(display.chosen.id, display.primaryId, '用户要求正式测试位于副屏1')
      await page.getByRole('button', { name: '剪辑', exact: true }).click()
      const assets = fs.readdirSync(path.resolve('out/renderer/assets')).filter(name => /^videoEditCodeProbe-[\w-]+\.js$/.test(name))
      assert.equal(assets.length, 1, '使用最新正式产物的唯一有限实验模块')
      let evidence
      try {
        evidence = await page.evaluate(async asset => {
          const probe = await import(new URL(`./assets/${asset}`, window.location.href).href)
          const host = document.createElement('div'); host.setAttribute('data-composite-contract-probe', ''); host.style.cssText = 'position:fixed;inset:80px 24px 40px;z-index:100'
          document.body.appendChild(host); return probe.runVideoEditCompositeProbe(host)
        }, assets[0])
        fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ ...evidence, display, builtModule: assets[0] }, null, 2))
        await capture('composite-4k-graphic-filter-transition')
        assert.equal(evidence.completed, true); assert.deepEqual(evidence.resolution, [3840, 2160]); assert.equal(evidence.hotFrames, 180); assert.equal(evidence.cacheHits, 180)
        for (const key of ['textureAllocations', 'pipelineCompiles', 'externalCopies']) assert.equal(evidence.after[key], evidence.before[key], `热帧${key}复用`)
        for (const key of ['residentBytes', 'surfaces', 'glyphs', 'pipelines']) assert.equal(evidence.disposed[key], 0, `${key}全部释放`)
        assert.equal(evidence.compiler.activeWorkers, 0); assert.equal(evidence.compiler.pending, 0)
      } catch (error) { await capture('composite-4k-failed').catch(() => {}); throw error }
      finally { await page.locator('[data-composite-contract-probe]').evaluateAll(elements => elements.forEach(element => element.remove())) }
    },
  }
}
module.exports = { createVideoEditCompositeScene }
