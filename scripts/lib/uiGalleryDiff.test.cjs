const { test } = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const { compareGalleryImages, expectedGalleryCaptures, validateGalleryRun } = require('./uiGalleryDiff.cjs')
test('彩色逐像素检查拦尺寸与色差，不能用灰度掩盖换色', async () => {
  const image = background => sharp({ create: { width: 16, height: 16, channels: 4, background } }).png().toBuffer()
  const a = await image('red')
  assert.equal((await compareGalleryImages(a, a)).passed, true)
  const changed = await compareGalleryImages(a, await image('blue'))
  assert.equal(changed.passed, false)
  assert.ok(changed.diff.length)
  await assert.rejects(compareGalleryImages(a, await sharp(a).resize(8, 8).toBuffer()), /尺寸/)
})

test('基线必须来自审计通过且有窗口尺寸证据的正式捕获', () => {
  const window = { completed: { outer: {width:1440,height:900}, content: {width:1440,height:900}, nativeScaleFactor:1, zoomFactor:1, renderer:{width:1440,height:900,dpr:1} }, captures: [{suffix:'one'}] }
  const evidence = {metadata:{themePreset:'paper'}, scenes:{'1440x900 / gallery':{window}}}
  const audit = { metadata:{themePreset:'paper',failures:[]}, scenes:{one:{multiplePrimary:[]}}, crossScene:{} }
  assert.equal(validateGalleryRun(audit,evidence,'paper',['one']).nativeScaleFactor,1)
  assert.throws(()=>validateGalleryRun(audit,evidence,'paper',['two']), /捕获/)
  assert.throws(()=>validateGalleryRun({...audit,scenes:{one:{multiplePrimary:[{}]}}},evidence,'paper',['one']), /审计/)
  assert.throws(()=>validateGalleryRun(audit,{...evidence,scenes:{}},'paper',['one']), /尺寸/)
})
test('捕获清单来自正式配置，缺图不能比较为零', () => {
  const list = expectedGalleryCaptures({ steps: [{ capture: 'gallery-one-top' }, { capture: { name: 'gallery-one-bottom' } }] })
  assert.equal(list.length, 4)
  assert.ok(list.includes('paper/1440x900-review-ui-gallery-gallery-one-bottom.png'))
  assert.throws(() => expectedGalleryCaptures({ steps: [] }), /捕获/)
})
