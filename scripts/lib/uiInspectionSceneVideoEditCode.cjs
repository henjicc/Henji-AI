const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function createVideoEditCodeScene() {
  return {
    id: 'video-edit-code-contract', surface: '剪辑', name: '剪辑-代码契约与4K GPU有限实验', writesUserData: false,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('.ui-tour/cache/video-edit-code-contract'); fs.mkdirSync(root, { recursive: true })
      await page.getByRole('button', { name: '剪辑', exact: true }).click()
      const assets = fs.readdirSync(path.resolve('out/renderer/assets')).filter(name => /^videoEditCodeProbe-[\w-]+\.js$/.test(name))
      assert.equal(assets.length, 1, '有限实验必须使用正式最新构建的唯一模块')
      const evidence = await page.evaluate(async asset => {
        const imported = await import(new URL(`./assets/${asset}`, window.location.href).href)
          const probe = imported.runVideoEditCodeProbe ? imported : Object.values(imported).find(value => value && typeof value === 'object' && typeof value.runVideoEditCodeProbe === 'function')
        const host = document.createElement('div'); host.setAttribute('data-code-contract-probe', ''); host.style.position = 'fixed'; host.style.inset = '80px 24px 40px'; host.style.zIndex = '100'
        document.body.appendChild(host)
        return await probe.runVideoEditCodeProbe(host)
      }, assets[0])
      fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ ...evidence, builtModule: assets[0] }, null, 2))
      await capture('code-4k-generator-filter')
      assert.equal(evidence.completed, true); assert.deepEqual(evidence.resolution, [3840, 2160])
      assert.ok(evidence.hotFrames > 0 && evidence.completedGpuFrameMs.p95 > 0, '正式会话必须实际完成热帧渲染')
      assert.equal(evidence.recovered, true, '作者异常必须传回正式会话并能继续渲染')
      assert.deepEqual(evidence.randomFramePixels[0], evidence.randomFramePixels.at(-1), '乱序指定帧应确定性重放')
      await page.locator('[data-code-contract-probe]').evaluate(element => element.remove())
    },
  }
}
module.exports = { createVideoEditCodeScene }
