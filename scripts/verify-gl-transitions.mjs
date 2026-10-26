#!/usr/bin/env node
/**
 * gl-transitions 收录核验：同一组输入画面、同一组默认参数，
 *   - 改好的 WGSL（scripts/lib/glTransitionWgsl.cjs）在 Dawn（vgpu/node）上渲染；
 *   - 上游 GLSL 在无头 Chromium 的 WebGL（SwiftShader，纯 CPU）里渲染作参考；
 * 逐个比较进度 0、0.25、0.5、0.75、1 的画面，并核对两端是否逐像素等于前后两段。
 * 门槛沿用上游：任一通道差超过 16/255 的像素不超过 1%（160×90 下一条整行边界约 1.1%，按 1.2% 计）。
 * 结果决定 src/core/videoEdit/glTransitions/zh.json 的收录与排除；升级包版本后先跑本脚本。
 *
 *   node scripts/verify-gl-transitions.mjs --from <已解压的 gl-transitions 包目录> [--out <输出目录>]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { adaptGlTransitionWgsl } = require('./lib/glTransitionWgsl.cjs')
const argument = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }
const PKG = argument('--from')
if (!PKG) { console.error('用法：node scripts/verify-gl-transitions.mjs --from <gl-transitions 包目录> [--out <目录>]'); process.exit(1) }
const OUT = argument('--out') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'gl-transitions-verify-'))
const W = 160; const H = 90; const PROGRESS = [0, 0.25, 0.5, 0.75, 1]; const LIMIT = 1.2

function images() {
  const from = new Uint8Array(W * H * 4); const to = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; const d = Math.hypot(x - W * 0.6, y - H * 0.4)
    from.set([Math.round(x / (W - 1) * 255), Math.round(y / (H - 1) * 255), Math.round((Math.sin(x * 0.15) * Math.cos(y * 0.2) * 0.5 + 0.5) * 255), 255], i)
    to.set([Math.round((Math.cos(d * 0.12) * 0.5 + 0.5) * 255), Math.round((1 - x / (W - 1)) * 200 + 30), Math.round(y / (H - 1) * 255), 255], i)
  }
  return { from, to }
}
const zero = type => ({ float: 0, int: 0, bool: false, vec2: [0, 0], vec3: [0, 0, 0], vec4: [0, 0, 0, 0], ivec2: [0, 0] })[type]
const defaults = transition => Object.fromEntries(Object.entries(transition.params).map(([key, param]) => [key, param.default ?? zero(param.type)]))
function pack(layout, values) {
  const view = new DataView(new ArrayBuffer(layout.size))
  for (const uniform of layout.uniforms) {
    const value = values[uniform.name]
    ;(Array.isArray(value) ? value : [value]).forEach((number, index) => {
      const at = uniform.offset + index * 4
      if (['int', 'bool', 'ivec2'].includes(uniform.type)) view.setInt32(at, typeof number === 'boolean' ? Number(number) : Math.trunc(number), true)
      else view.setFloat32(at, number, true)
    })
  }
  return new Uint8Array(view.buffer)
}

async function renderWgsl(all, layouts, { from, to }) {
  const { init } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vgpu/dist/node.js')).href)
  const gpu = await init({}); const device = gpu.gpu
  const texture = data => { const value = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: 0x02 | 0x04 }); device.queue.writeTexture({ texture: value }, data, { bytesPerRow: W * 4 }, [W, H]); return value }
  const a = texture(from); const b = texture(to)
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const group = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: 2, buffer: { type: 'uniform' } }, { binding: 1, visibility: 2, sampler: { type: 'filtering' } }, { binding: 2, visibility: 2, texture: { sampleType: 'float' } }, { binding: 3, visibility: 2, texture: { sampleType: 'float' } }] })
  const layout = device.createPipelineLayout({ bindGroupLayouts: [group] })
  const output = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: 0x01 | 0x10 })
  const result = {}
  for (const transition of all) {
    try {
      const module = device.createShaderModule({ code: adaptGlTransitionWgsl(transition.name, fs.readFileSync(path.join(PKG, 'wgsl', `${transition.name}.wgsl`), 'utf8')) })
      device.pushErrorScope('validation')
      const pipeline = device.createRenderPipeline({ layout, vertex: { module, entryPoint: 'henjiVertex' }, fragment: { module, entryPoint: 'henjiFragment', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } })
      const error = await device.popErrorScope(); if (error) throw new Error(error.message)
      const uniform = device.createBuffer({ size: layouts[transition.name].size, usage: 0x40 | 0x08 })
      const frames = []
      for (const progress of PROGRESS) {
        device.queue.writeBuffer(uniform, 0, pack(layouts[transition.name], { ...defaults(transition), progress, ratio: W / H }))
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, device.createBindGroup({ layout: group, entries: [{ binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: sampler }, { binding: 2, resource: a.createView() }, { binding: 3, resource: b.createView() }] }))
        pass.draw(3); pass.end()
        const bytesPerRow = Math.ceil(W * 4 / 256) * 256
        const buffer = device.createBuffer({ size: bytesPerRow * H, usage: 0x01 | 0x08 })
        encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow }, { width: W, height: H, depthOrArrayLayers: 1 })
        device.queue.submit([encoder.finish()])
        await buffer.mapAsync(1)
        const mapped = new Uint8Array(buffer.getMappedRange()); const pixels = new Uint8Array(W * H * 4)
        for (let y = 0; y < H; y++) pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + W * 4), y * W * 4)
        buffer.unmap(); buffer.destroy(); frames.push(pixels)
      }
      uniform.destroy(); result[transition.name] = frames
    } catch (error) { result[transition.name] = `WGSL 失败：${error.message.split('\n')[0]}` }
  }
  gpu.dispose?.()
  return result
}

async function renderGlsl(all, { from, to }) {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'))
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage()
  await page.setContent(`<canvas id=c width=${W} height=${H}></canvas>`)
  await page.evaluate(({ W, H, from, to }) => {
    const gl = document.getElementById('c').getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false })
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 4, 4, -1]), gl.STATIC_DRAW)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    const texture = data => { const value = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, value); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data)); for (const [key, mode] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, mode); return value }
    window.__gl = { gl, a: texture(from), b: texture(to) }
  }, { W, H, from: [...from], to: [...to] })
  const result = {}
  for (const transition of all) {
    const params = Object.fromEntries(Object.entries(transition.params).map(([key, param]) => [key, param.type]))
    result[transition.name] = await page.evaluate(({ W, H, glsl, params, values, PROGRESS }) => {
      const { gl, a, b } = window.__gl
      const shader = (type, source) => { const value = gl.createShader(type); gl.shaderSource(value, source); gl.compileShader(value); if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value)); return value }
      try {
        const program = gl.createProgram()
        gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 _p;varying vec2 _uv;void main(){gl_Position=vec4(_p,0.0,1.0);_uv=vec2(0.5,0.5)*(_p+vec2(1.0,1.0));}'))
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `precision highp float;varying vec2 _uv;uniform sampler2D from, to;uniform float progress, ratio;vec4 getFromColor(vec2 uv){return texture2D(from, uv);}vec4 getToColor(vec2 uv){return texture2D(to, uv);}\n${glsl}\nvoid main(){gl_FragColor=transition(_uv);}`))
        gl.bindAttribLocation(program, 0, '_p'); gl.linkProgram(program)
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
        gl.useProgram(program); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.viewport(0, 0, W, H)
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a); gl.uniform1i(gl.getUniformLocation(program, 'from'), 0)
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b); gl.uniform1i(gl.getUniformLocation(program, 'to'), 1)
        gl.uniform1f(gl.getUniformLocation(program, 'ratio'), W / H)
        for (const [key, type] of Object.entries(params)) {
          const at = gl.getUniformLocation(program, key); if (!at) continue; const value = values[key]
          if (type === 'float') gl.uniform1f(at, value); else if (type === 'int' || type === 'bool') gl.uniform1i(at, Number(value))
          else if (type === 'vec2') gl.uniform2fv(at, value); else if (type === 'vec3') gl.uniform3fv(at, value); else if (type === 'vec4') gl.uniform4fv(at, value); else if (type === 'ivec2') gl.uniform2iv(at, value)
        }
        return PROGRESS.map(progress => {
          gl.uniform1f(gl.getUniformLocation(program, 'progress'), progress); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3)
          const pixels = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
          let text = ''
          for (let y = H - 1; y >= 0; y--) { const row = pixels.subarray(y * W * 4, (y + 1) * W * 4); for (let at = 0; at < row.length; at += 8192) text += String.fromCharCode.apply(null, row.subarray(at, at + 8192)) }
          return btoa(text)
        })
      } catch (error) { return `GLSL 失败：${error.message}` }
    }, { W, H, glsl: transition.glsl, params, values: defaults(transition), PROGRESS })
    if (Array.isArray(result[transition.name])) result[transition.name] = result[transition.name].map(text => Buffer.from(text, 'base64'))
  }
  await browser.close()
  return result
}

function compare(a, b) {
  let bad = 0; let max = 0
  for (let at = 0; at < a.length; at += 4) {
    let pixel = 0
    for (let channel = 0; channel < 4; channel++) pixel = Math.max(pixel, Math.abs(a[at + channel] - b[at + channel]))
    if (pixel > 16) bad++
    max = Math.max(max, pixel)
  }
  return { percent: bad / (a.length / 4) * 100, max }
}
// GLSL 输出直通色，WGSL 改造后输出预乘色：比较前把参考画面预乘。
const premultiply = pixels => Uint8Array.from(pixels, (value, index) => index % 4 === 3 ? value : Math.round(value * pixels[index - (index % 4) + 3] / 255))

const all = JSON.parse(fs.readFileSync(path.join(PKG, 'gl-transitions.json'), 'utf8')).filter(transition => !transition.textures?.length)
const layouts = JSON.parse(fs.readFileSync(path.join(PKG, 'layouts.json'), 'utf8'))
const inputs = images()
const wgsl = await renderWgsl(all, layouts, inputs)
const glsl = await renderGlsl(all, inputs)
const report = {}
for (const { name } of all) {
  if (typeof wgsl[name] === 'string' || typeof glsl[name] === 'string') { report[name] = { pass: false, reason: [wgsl[name], glsl[name]].filter(value => typeof value === 'string').join('；') }; continue }
  const start = compare(wgsl[name][0], inputs.from).max; const end = compare(wgsl[name][PROGRESS.length - 1], inputs.to).max
  const frames = PROGRESS.map((_, index) => compare(wgsl[name][index], premultiply(glsl[name][index])))
  const worst = Math.max(...frames.map(frame => frame.percent))
  report[name] = { pass: start === 0 && end === 0 && worst <= LIMIT, start, end, worst: Math.round(worst * 100) / 100, frames }
}
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'gl-transitions-verify.json'), JSON.stringify(report, null, 1))
for (const [name, value] of Object.entries(report)) console.log(`${value.pass ? '通过' : '未过'}  ${name.padEnd(26)} ${value.reason ?? `两端差 ${value.start}/${value.end}，中间帧最多 ${value.worst}% 像素超差`}`)
console.log(`报告：${path.join(OUT, 'gl-transitions-verify.json')}`)
process.exit(0)
