const assert = require('node:assert/strict')
const test = require('node:test')
const { WINDOWS_MAX_FRAME_INSET_DIP, maximizedFrameInsets } = require('./uiInspectionSceneWindowStartup.cjs')
const { SELECTION_MIN_CONTRAST, averageColor, contrastRatio } = require('./uiInspectionSceneGenerationVideoViewer.cjs')

test('窗口最大化外框：Windows 不可见缩放边在上限内，macOS 必须为 0（侵入菜单栏会被抓到）', () => {
  // 2026-10-04 副屏 150% 实测
  const insets = maximizedFrameInsets({ x: 2553, y: -7, width: 2576, height: 1416 }, { x: 2560, y: 0, width: 2560, height: 1400 })
  assert.deepEqual(insets, { left: 7, top: 7, right: 9, bottom: 9 })
  assert.ok(Object.values(insets).every((value) => value <= WINDOWS_MAX_FRAME_INSET_DIP))
  // 窗口顶部压进菜单栏（macOS 25px 菜单栏下仍从 y=0 开始）
  const intruding = maximizedFrameInsets({ x: 0, y: 0, width: 1440, height: 900 }, { x: 0, y: 25, width: 1440, height: 875 })
  assert.equal(intruding.top, 25)
})

test('裁剪选区可见性：按亮度对比度判定，石墨与纸白实测值都过线，同色不过', () => {
  assert.ok(contrastRatio([98, 99, 101], [39, 41, 44]) >= SELECTION_MIN_CONTRAST)
  assert.ok(contrastRatio([162, 166, 169], [219, 221, 225]) >= SELECTION_MIN_CONTRAST)
  assert.ok(contrastRatio([60, 60, 60], [56, 56, 56]) < SELECTION_MIN_CONTRAST)
  const width = 10
  const data = Buffer.alloc(width * 3 * 3)
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < width; x += 1) data.fill(x < 5 ? 200 : 20, (y * width + x) * 3, (y * width + x) * 3 + 3)
  }
  const image = { data, info: { width, height: 3, channels: 3 } }
  assert.deepEqual(averageColor(image, 0, 0.5), [200, 200, 200])
  assert.deepEqual(averageColor(image, 0.5, 1), [20, 20, 20])
})
