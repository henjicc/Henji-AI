const assert = require('node:assert/strict')
const test = require('node:test')
const sharp = require('sharp')
const { captureInspectionPage, cssClipToDip } = require('./uiInspectionCapture.cjs')

test('CSS局部坐标乘实际zoom后floor/ceil覆盖并裁到内容区，不按nativeScale改DIP', () => {
  assert.deepEqual(cssClipToDip({ x: 100.2, y: 80.1, width: 64, height: 64 }, 0.9, { width: 1440, height: 900 }),
    { x: 90, y: 72, width: 58, height: 58 })
  assert.deepEqual(cssClipToDip({ x: -10, y: -10, width: 40, height: 40 }, 0.9, { width: 20, height: 20 }),
    { x: 0, y: 0, width: 20, height: 20 })
  assert.throws(() => cssClipToDip({ x: 200, y: 0, width: 1, height: 1 }, 1, { width: 20, height: 20 }), /不在可见/)
  assert.throws(() => cssClipToDip({ x: 0, y: 0, width: 1, height: 1 }, NaN, { width: 20, height: 20 }), /坐标无效/)
})

test('复用既有Electron窗口，选择已有表示并从PNG辨别真实1x或显示器密度；错误尺寸失败', async () => {
  const captures = []; let wrong = false; let labelOne = false; let logicalPixels = false; let disposed = 0
  const scale = 1.5
  const handle = { getContentSize: () => [144, 90], getBounds: () => ({ x: 10, y: 10, width: 144, height: 90 }),
    webContents: { getZoomFactor: () => 0.9 }, capturePage: async (rect) => {
      captures.push(rect)
      const size = rect ?? { width: 144, height: 90 }
      const density = logicalPixels ? 1 : scale
      const png = await sharp({ create: { width: Math.round(size.width * density) + Number(wrong) * 20,
        height: Math.round(size.height * density), channels: 4, background: '#ffffff' } }).png().toBuffer()
      return { isEmpty: () => false, getSize: () => size, getScaleFactors: () => [labelOne ? 1 : scale],
        toPNG: (options) => { assert.equal(options.scaleFactor, labelOne ? 1 : scale); return png } }
    } }
  const page = { screenshot: () => assert.fail('不能回到CDP截图') }
  const app = { browserWindow: async (target) => {
    assert.equal(target, page); return { evaluate: (callback, input) => callback(handle, input), dispose: async () => { disposed += 1 } }
  }, evaluate: (callback, bounds) => callback({ screen: { getDisplayMatching: (actual) => {
    assert.deepEqual(actual, handle.getBounds()); return { scaleFactor: scale }
  } } }, bounds) }
  const whole = await captureInspectionPage(app, page)
  assert.equal((await sharp(whole).metadata()).width, 216)
  assert.equal(captures[0], undefined)
  await captureInspectionPage(app, page, { clip: { x: 100.2, y: 50, width: 64, height: 64 } })
  assert.deepEqual(captures[1], { x: 90, y: 45, width: 54, height: 45 })
  wrong = true
  await assert.rejects(captureInspectionPage(app, page), /截图像素尺寸不匹配.*原生表示/)
  wrong = false; labelOne = true
  let evidence
  await captureInspectionPage(app, page, { onEvidence: (value) => { evidence = value } })
  assert.equal(evidence.captureScale, scale, '标签1仍可携带显示器密度原始PNG')
  assert.equal(evidence.representationScale, 1)
  logicalPixels = true
  await captureInspectionPage(app, page, { onEvidence: (value) => { evidence = value } })
  assert.equal(evidence.captureScale, 1, '实际1x原图如实记录，不插值成显示器密度')
  assert.equal(evidence.width, 144)
  assert.equal(disposed, 5, '成功与失败都释放远程句柄，不关闭窗口')
  await assert.rejects(captureInspectionPage(null, page), /正式 runner/)
})
