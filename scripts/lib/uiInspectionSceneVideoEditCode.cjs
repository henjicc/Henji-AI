const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function createVideoEditCodeScene() {
  return {
    id: 'video-edit-code-contract', surface: '剪辑', name: '剪辑-代码契约与4K GPU有限实验', writesUserData: false,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-code-contract'); fs.mkdirSync(root, { recursive: true })
      await page.getByRole('button', { name: '剪辑', exact: true }).click()
      const assets = fs.readdirSync(path.resolve('out/renderer/assets')).filter(name => /^videoEditCodeProbe-[\w-]+\.js$/.test(name))
      assert.equal(assets.length, 1, '有限实验必须使用正式最新构建的唯一模块')
      const evidence = await page.evaluate(async asset => {
        const probe = await import(new URL(`./assets/${asset}`, window.location.href).href)
        const host = document.createElement('div'); host.setAttribute('data-code-contract-probe', ''); host.style.position = 'fixed'; host.style.inset = '80px 24px 40px'; host.style.zIndex = '100'
        document.body.appendChild(host)
        return await probe.runVideoEditCodeProbe(host)
      }, assets[0])
      fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ ...evidence, builtModule: assets[0] }, null, 2))
      await capture('code-4k-generator-filter')
      assert.equal(evidence.completed, true); assert.deepEqual(evidence.resolution, [3840, 2160])
      assert.equal(evidence.after.externalCopies, evidence.before.externalCopies, '热帧不上传字形或像素')
      assert.equal(evidence.after.pipelineCompiles, evidence.before.pipelineCompiles, '热帧/参数不重建管线')
      assert.equal(evidence.disposed.residentBytes, 0); assert.equal(evidence.disposed.surfaces, 0)
      assert.equal(evidence.disposed.glyphs, 0); assert.equal(evidence.disposed.pipelines, 0)
      assert.equal(evidence.compiler.activeWorkers, 0); assert.equal(evidence.compiler.pending, 0)
      assert.ok(evidence.compiler.cacheHits >= 1, '真实源码检查线程应命中已编译源码')
      await page.locator('[data-code-contract-probe]').evaluate(element => element.remove())
    },
  }
}
module.exports = { createVideoEditCodeScene }
