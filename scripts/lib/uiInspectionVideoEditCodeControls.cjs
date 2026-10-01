const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const dynamicSource = `export default {apiVersion:1,name:"原创轨道标题",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:91,parameters:{speed:{type:"number",title:"移动速度",default:80,min:0,max:400,step:1,animatable:true},ink:{type:"color",title:"标题颜色",default:[0.2,1,1,0.8],animatable:true},enabled:{type:"boolean",title:"显示图形",default:true},shape:{type:"choice",title:"图形样式",default:"圆",options:["圆","方"]},label:{type:"text",title:"标题文字",default:"原创代码 · 混合剪辑",maxLength:128}},render(ctx){const x=250+ctx.time*ctx.params.speed;return [rect({x:x,y:1100,width:260,height:260,radius:ctx.params.shape==="圆"?130:0,fill:ctx.params.enabled?ctx.params.ink:[0,0,0,0]}),line({x1:x,y1:1420,x2:x+1800,y2:1420,width:14,color:ctx.params.ink}),text({x:x+150,y:1600,text:ctx.params.label,fontSize:130,color:[1,1,1,1]})];}}`
const staticSource = `export default {apiVersion:1,name:"透明静态卡片",kind:"generator",mode:"static",width:3840,height:2160,durationSeconds:3,seed:12,parameters:{ink:{type:"color",title:"底色",default:[0.1,0.25,1,0.5]},logo:{type:"image",title:"透明徽标",default:null,animatable:false}},render(ctx){return [rect({x:130,y:130,width:980,height:600,radius:48,fill:ctx.params.ink}),text({x:210,y:420,text:"静态画面复用",fontSize:115,color:[1,1,1,1]}),image({source:ctx.params.logo,x:1200,y:240,width:1000,height:700})];}}`
async function makePicture(root) {
  const file = path.join(root, 'transparent-4k.png')
  if (!fs.existsSync(file)) await sharp({ create: { width: 3840, height: 2160, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 128 / 255 } } }).png().toFile(file)
  return file
}
async function inspectCodeControls({ page, app, capture, evidence, change, file, root, document, dynamicClip, staticClip, dynamicSource, snapshots, saved, seek, comparePng }) {
  const button = name => page.getByRole('button', { name, exact: true })
  const png = () => page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => canvas.toDataURL('image/png'))
  const select = async clip => { await page.locator(`[data-video-edit-clip="${clip.id}"]`).getByRole('button').nth(1).click(); await page.locator(`[data-video-edit-code-parameters="${clip.id}"]`).waitFor({ state: 'visible' }) }
  const codeOf = (value, clip = dynamicClip) => value.sequences[0].clips.find(value => value.id === clip.id).code
  await select(dynamicClip)
  assert.ok(await page.getByLabel('移动速度', { exact: true }).isVisible()); assert.ok(await page.getByLabel('标题文字', { exact: true }).isVisible()); assert.ok(await page.getByLabel('显示图形', { exact: true }).isVisible())
  assert.equal(await page.locator('[data-video-edit-code-parameter="logo"]').count(), 0)
  await seek(page, 120)
  const before = await png()
  await page.getByLabel('移动速度', { exact: true }).evaluate(input => {
    const canvas = document.querySelector('canvas[aria-label="剪辑画面"]')
    const state = { inputs: [], frames: [] }
    const onInput = () => state.inputs.push(performance.now())
    input.addEventListener('input', onInput)
    const observer = new MutationObserver(() => {
      const last = state.inputs.at(-1)
      if (last && Number(canvas.dataset.requestedAt) >= last) state.frames.push({ inputAt: last, at: performance.now(), frame: Number(canvas.dataset.presentedFrame), decodeMs: Number(canvas.dataset.decodeMs), cacheBytes: Number(canvas.dataset.cacheBytes) })
    })
    observer.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
    window.__codeParameterFrames = { state, stop() { input.removeEventListener('input', onInput); observer.disconnect(); return state } }
  })
  await page.getByLabel('移动速度', { exact: true }).fill('200'); await page.getByLabel('移动速度', { exact: true }).press('Tab')
  await saved(page, file, value => codeOf(value).parameters.speed === 200)
  await page.waitForFunction(previous => document.querySelector('canvas[aria-label="剪辑画面"]').toDataURL('image/png') !== previous, before)
  const response = await page.evaluate(() => window.__codeParameterFrames.stop())
  assert.ok(response.frames.length, '参数输入需有完成合成后画面回执')
  evidence.manualParameter = { inputs: response.inputs, frames: response.frames, inputToCorrectFrameMs: response.frames.at(-1).at - response.inputs.at(-1), includesReadback: false }
  await button('撤销').click(); await saved(page, file, value => codeOf(value).parameters.speed === 80)
  await page.waitForFunction(previous => document.querySelector('canvas[aria-label="剪辑画面"]').toDataURL('image/png') === previous, before)
  await seek(page, 0); await button('为移动速度添加关键帧').click()
  await saved(page, file, value => codeOf(value).curves?.speed?.length === 1)
  await seek(page, 120)
  await page.getByLabel('移动速度', { exact: true }).fill('200'); await page.getByLabel('移动速度', { exact: true }).press('Tab')
  document = await saved(page, file, value => codeOf(value).curves?.speed?.length === 2)
  assert.equal(codeOf(document).parameters.speed, 80); assert.deepEqual(codeOf(document).curves.speed.map(point => point.sourceInUs), [0, 2_000_000])
  await seek(page, 60); assert.equal(Number(await page.getByLabel('移动速度', { exact: true }).inputValue()), 140)
  assert.equal((await comparePng(await png(), snapshots[60])).equal, false, '源时刻曲线必须实际改变中间画面')
  await capture('code-parameter-curve')
  await button('查看与编辑源码').click()
  await page.getByLabel('代码素材源码', { exact: true }).fill(dynamicSource.replace('const x=', 'while(true){} const x='))
  await button('检查并预览').click()
  await page.getByText(/render 中仅允许 const 和最后一个 return/).first().waitFor({ state: 'visible' })
  assert.equal(codeOf(JSON.parse(fs.readFileSync(file, 'utf8'))).versionId, dynamicClip.code.versionId)
  await page.getByLabel('代码素材源码', { exact: true }).fill(dynamicSource.replaceAll('speed', 'pace'))
  await button('检查并预览').click(); await page.getByLabel('源码候选预览', { exact: true }).waitFor({ state: 'visible', timeout: 20000 })
  const errors = page.getByRole('alert').filter({ hasText: /\S/ })
  assert.equal(await errors.count(), 0, `恢复有效源码后不能残留整页或局部旧错误：${JSON.stringify(await errors.allTextContents())}`)
  assert.equal(await button('应用已检查源码').isEnabled(), false)
  await page.getByLabel('确认参数与关键帧迁移', { exact: true }).check(); await capture('code-source-migration-candidate')
  await button('应用已检查源码').click()
  document = await saved(page, file, value => codeOf(value).versionId !== dynamicClip.code.versionId)
  assert.equal(codeOf(document).curves, undefined); assert.equal(codeOf(document).parameters.pace, 80)
  await button('撤销').click(); await saved(page, file, value => codeOf(value).versionId === dynamicClip.code.versionId && codeOf(value).curves?.speed?.length === 2)
  await button('重置移动速度').click(); await saved(page, file, value => !codeOf(value).curves && codeOf(value).parameters.speed === 80)
  await select(staticClip)
  assert.equal(await page.locator('[data-video-edit-code-parameter="speed"]').count(), 0)
  await seek(page, 120); const withoutLogo = await png()
  await page.getByLabel('透明徽标工程图片', { exact: true }).click()
  await page.getByRole('option', { name: 'transparent-4k.png', exact: true }).click()
  document = await saved(page, file, value => Boolean(codeOf(value, staticClip).parameters.logo))
  await page.waitForFunction(previous => document.querySelector('canvas[aria-label="剪辑画面"]').toDataURL('image/png') !== previous, withoutLogo)
  const withLogo = await png()
  const pixel = async source => [...await sharp(Buffer.from(source.split(',')[1], 'base64')).extract({ left: 1700, top: 500, width: 1, height: 1 }).ensureAlpha().raw().toBuffer()]
  const [base, actual] = await Promise.all([pixel(withoutLogo), pixel(withLogo)])
  const expected = [128 + base[0] * 127 / 255, base[1] * 127 / 255, base[2] * 127 / 255, 255]
  assert.ok(actual.every((channel, index) => Math.abs(channel - expected[index]) <= 2), `透明PNG需只转换一次alpha：${JSON.stringify({ base, actual, expected })}`)
  evidence.controls = { curveMidpoint: 140, originalVersionRestored: true, migrationConfirmed: true, pngAlpha: { base, actual, expected }, imageBinding: codeOf(document, staticClip).parameters.logo, sourceEditor: true }
  await capture('code-image-parameter-4k')
  await button('清除图片').click(); await saved(page, file, value => codeOf(value, staticClip).parameters.logo === null)
  await page.waitForFunction(previous => document.querySelector('canvas[aria-label="剪辑画面"]').toDataURL('image/png') === previous, withoutLogo)
  await button('撤销').click(); await saved(page, file, value => Boolean(codeOf(value, staticClip).parameters.logo))
  await page.waitForFunction(previous => document.querySelector('canvas[aria-label="剪辑画面"]').toDataURL('image/png') === previous, withLogo)
  await change([{ kind: 'set_properties', entityType: 'video_edit.clip', target: { kind: 'video_edit.clip', id: `${document.id}:${dynamicClip.id}` }, properties: { 'video_edit.clip.code_curves': { speed: [
    { id: 'reality-curve-start', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, value: 80, interpolation: 'linear' },
    { id: 'reality-curve-end', sourceInUs: 2_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, value: 200, interpolation: 'linear' },
  ] } } }])
  evidence.controls.imageClearUndo = true; evidence.controls.publicCurveInPlayback = true
  for (const frame of [0, 60, 120]) { await seek(page, frame); snapshots[frame] = await png() }
  await seek(page, 120)
}
module.exports = { dynamicSource, staticSource, makePicture, inspectCodeControls }
