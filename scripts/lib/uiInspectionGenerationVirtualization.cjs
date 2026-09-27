const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

// 隔离资料中的真实媒体与布局验证，不访问供应商或真实用户历史。
function createGenerationVirtualizationScenes(context) {
  if (process.env.GENERATION_VIRTUAL_CHECK !== '1') return []
  return [{
    id: 'generation-history-virtualization', surface: '生成', name: '生成-虚拟历史交互', writesUserData: true,
    async setup(page, _app, inspection) {
      const source = path.resolve('docs/others/gegl/tests/compositions/data/boats.png')
      const imageBytes = [...await fs.readFile(source)]
      // 30 秒静音 PCM WAV，用于验证真实播放生命周期，避免发出测试噪声。
      const wave = Buffer.alloc(44 + 8000 * 2 * 30)
      wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8)
      wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22)
      wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28)
      wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34)
      wave.write('data', 36); wave.writeUInt32LE(wave.length - 44, 40)
      await context.setupGeneration(page)
      await page.evaluate(async ({ imageBytes, waveBytes }) => {
        const image = await window.henjiNative.image.persistImageBinary(new Uint8Array(imageBytes), 'png')
        const audio = image.replace(/\.[^.]+$/, '-virtual-test.wav')
        await window.henjiNative.fs.writeFile(audio, new Uint8Array(waveBytes))
        await window.henjiNative.db.execute("DELETE FROM history WHERE id GLOB '__virtual_check_*'", [])
        for (let start = 0; start < 1000; start += 100) {
          const values = [], params = []
          for (let i = start; i < start + 100; i++) {
            values.push('(?,?,?,?,?,?,?,?,?)')
            params.push(`__virtual_check_${i}`, 'kie', 'kie-z-image', i === 999 ? 'audio' : 'image',
              `交互样本 ${i}。${'保留原始内容与阅读位置。'.repeat(i % 7)}`, '{}', i === 999 ? audio : image,
              'success', new Date(1700000000000 + i * 1000).toISOString())
          }
          await window.henjiNative.db.execute('INSERT INTO history (id,provider_id,model_id,type,prompt,params,file_path,status,created_at) VALUES ' + values.join(','), params)
        }
      }, { imageBytes, waveBytes: [...wave] })
      await page.reload({ waitUntil: 'domcontentloaded' })
      const last = page.locator('[data-generation-task-id="__virtual_check_999"]')
      await last.waitFor({ timeout: 30000 })
      const scroll = async fraction => {
        await page.evaluate(fraction => {
          document.activeElement?.blur?.()
          const element = document.querySelector('.app-scroll-container')
          element.scrollTop = (element.scrollHeight - element.clientHeight) * fraction
        }, fraction)
        await page.waitForTimeout(500)
      }
      await scroll(0.4)
      const geometry = await page.evaluate(() => {
        const scroller = document.querySelector('.app-scroll-container')
        const top = scroller.getBoundingClientRect().top
        const rows = [...scroller.querySelectorAll('[data-index]')]
        const anchor = rows.find(row => row.getBoundingClientRect().bottom > top)
        const above = rows.find(row => row.getBoundingClientRect().bottom < top)
        if (!anchor || !above) throw new Error('缺少可见锚点或上方预读行')
        return { fraction: scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight),
          count: rows.length, anchor: anchor.dataset.index, above: above.dataset.index, top: anchor.getBoundingClientRect().top }
      })
      assert.ok(geometry.fraction > 0.35 && geometry.fraction < 0.45, `阅读位置被改变：${geometry.fraction}`)
      assert.ok(geometry.count < 30, `挂载行过多：${geometry.count}`)
      const above = page.locator(`[data-index="${geometry.above}"]`)
      await above.evaluate(row => { row.style.height = `${row.getBoundingClientRect().height + 120}px` })
      await page.waitForTimeout(300)
      const shiftedTop = await page.locator(`[data-index="${geometry.anchor}"]`).evaluate(row => row.getBoundingClientRect().top)
      assert.ok(Math.abs(shiftedTop - geometry.top) < 2, `上方高度变化移动阅读锚点：${shiftedTop - geometry.top}`)
      await above.evaluate(row => { row.style.height = '' })
      await page.waitForTimeout(300)
      const focus = await page.locator(`[data-index="${geometry.anchor}"] button`).first().elementHandle()
      await focus.focus()
      await page.evaluate(() => { document.querySelector('.app-scroll-container').scrollTop = 0 })
      await page.waitForTimeout(300)
      assert.equal(await focus.evaluate(element => document.activeElement === element && element.isConnected), true, '离屏卡片丢失焦点')
      await focus.evaluate(element => element.blur())
      await page.waitForTimeout(100)
      assert.equal(await focus.evaluate(element => element.isConnected), false, '失焦后卡片未释放')
      await scroll(1)
      const audio = await last.locator('audio').elementHandle()
      await page.waitForFunction(element => element.duration >= 29, audio)
      await last.getByTitle(/^(播放\/暂停|Play\/Pause)$/).click()
      await page.waitForFunction(element => !element.paused, audio)
      await audio.evaluate(element => { element.currentTime = 7; element.volume = 0.35 })
      await scroll(0.1)
      const playing = await audio.evaluate(element => ({ connected: element.isConnected, paused: element.paused, time: element.currentTime, error: element.error?.message }))
      assert.ok(playing.connected && !playing.paused && playing.time > 7, `离屏播放中断：${JSON.stringify(playing)}`)
      // 通过原播放器按钮暂停，不能用直接改 React 状态的测试旁路。
      await last.getByTitle(/^(播放\/暂停|Play\/Pause)$/).click()
      const paused = await audio.evaluate(element => ({ time: element.currentTime, volume: element.volume }))
      await scroll(0.1)
      assert.equal(await audio.evaluate(element => element.isConnected), false, '暂停并离屏后音频卡片未释放')
      await scroll(1)
      await page.waitForFunction(() => document.querySelector('[data-generation-task-id="__virtual_check_999"] audio')?.readyState >= 1)
      const restored = await last.locator('audio').evaluate(element => ({ time: element.currentTime, volume: element.volume, paused: element.paused }))
      assert.ok(Math.abs(restored.time - paused.time) < 0.2, `播放位置未恢复：${JSON.stringify({ paused, restored })}`)
      assert.equal(restored.volume, paused.volume)
      assert.equal(restored.paused, true)
      await inspection.capture('media-restored')
      await scroll(0.5)
      const imageId = await page.evaluate(() => [...document.querySelectorAll('[data-generation-task-id] img')]
        .find(element => { const rect = element.getBoundingClientRect(); return rect.top > 70 && rect.bottom < innerHeight * 0.65 })
        ?.closest('[data-generation-task-id]').dataset.generationTaskId)
      assert.ok(imageId, '没有位于视口内且未被生成面板遮挡的图片')
      const image = page.locator(`[data-generation-task-id="${imageId}"] img`).first()
      await image.click()
      await page.locator('[data-image-viewer="true"]').waitFor()
      await page.waitForFunction(() => {
        const viewer = document.querySelector('[data-image-viewer="true"]')
        return viewer && Number(getComputedStyle(viewer).opacity) >= 0.99
          && [...viewer.querySelectorAll('img')].some(image => image.complete && image.naturalWidth > 0)
      })
      await inspection.capture('image-viewer')
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').filter({ visible: true }).waitFor({ state: 'hidden' })
      const search = page.getByPlaceholder(/^(搜索提示词 \/ 模型 \/ 提供商 \/ 错误信息|Search prompt \/ model \/ provider \/ error)$/)
      await search.focus()
      await search.fill('交互样本 999。')
      await last.waitFor()
      await page.waitForFunction(() => document.querySelectorAll('[data-generation-task-id]').length === 1)
      await last.getByTitle(/^(删除|Delete)$/).click()
      await last.waitFor({ state: 'detached' })
      await search.fill('')
      await scroll(0.5)
      assert.ok(await page.locator('[data-generation-task-id]').count() < 30)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('[data-generation-task-id="__virtual_check_998"]').waitFor()
      assert.equal(await page.locator('[data-generation-task-id="__virtual_check_999"]').count(), 0, '删除的任务重载后复活')
      await inspection.capture('filtered-delete-reload')
      console.log('[generation-virtualization]', JSON.stringify({ geometry, shiftedTop, paused, restored }))
    },
  }]
}

module.exports = { createGenerationVirtualizationScenes }
