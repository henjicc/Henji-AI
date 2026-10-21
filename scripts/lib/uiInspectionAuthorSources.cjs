// 验收场景共用的作者原代码夹具：标准 ES 模块，与正式作者宿主接口一致，不使用旧作者语言。

/** 单遍 WGSL 滤镜：`expression` 读当前输入 `c`（预乘 RGBA）与参数向量 `p.v`（按 params 顺序最多四项）。 */
function authorFilterSource({ name, params, expression }) {
  const keys = params.map(param => param.key)
  if (keys.length > 4) throw new Error('验收滤镜最多四个数值参数')
  return `const shader = \`
struct P { v: vec4f }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var current: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let q = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3)); return vec4f(q[i], 0, 1);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let c = textureLoad(current, vec2i(pos.xy), 0);
  return ${expression};
}\`
export default {
  name: ${JSON.stringify(name)}, kind: "filter", mode: "static",
  params: ${JSON.stringify(params)},
  async createWebGPU(device) {
    const module = device.createShaderModule({ code: shader })
    const buffer = device.createBuffer({ size: 16, usage: 72 })
    const pipelines = new Map()
    return {
      async draw(target, time, params, width, height, assets, info, inputs) {
        let pipeline = pipelines.get(target.format)
        if (!pipeline) { pipeline = await device.createRenderPipelineAsync({ layout: "auto", vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format: target.format }] } }); pipelines.set(target.format, pipeline) }
        device.queue.writeBuffer(buffer, 0, new Float32Array([${keys.map(key => `params.${key}`).concat(Array(4 - keys.length).fill('0')).join(', ')}]))
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store" }] })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: inputs.current.createView() }] }))
        pass.draw(3); pass.end()
        device.queue.submit([encoder.finish()])
      },
      async dispose() { await device.queue.onSubmittedWorkDone(); buffer.destroy(); pipelines.clear() }
    }
  }
}`
}

const number = (key, title, value, min, max, step, animatable = false) => ({ key, type: 'number', title, default: value, min, max, step, ...(animatable ? { animatable } : {}) })
const CSS = 'const css = c => typeof c === "string" ? c : `rgba(${c[0] * 255}, ${c[1] * 255}, ${c[2] * 255}, ${c[3]})`'

/** 动态生成器：移动的圆/方块、线与标题；`const x=` 是源码错误验收用的稳定插入点。 */
function trackTitleSource({ withControls = true } = {}) {
  const params = [number('speed', '移动速度', 80, 0, 400, 1, withControls), { key: 'ink', type: 'color', title: '标题颜色', default: [0.2, 1, 1, 0.8], ...(withControls ? { animatable: true } : {}) },
    ...(withControls ? [{ key: 'enabled', type: 'boolean', title: '显示图形', default: true }, { key: 'shape', type: 'choice', title: '图形样式', default: '圆', options: ['圆', '方'] }, { key: 'label', type: 'text', title: '标题文字', default: '原创代码 · 混合剪辑', maxLength: 128 }] : [])]
  return `${CSS}
export default {
  name: "原创轨道标题", kind: "generator", mode: "dynamic", width: 3840, height: 2160, durationSeconds: 10,
  params: ${JSON.stringify(params)},
  draw(ctx, time, params) {
    const x=250 + time * params.speed
    const label = params.label ?? "原创代码 · 混合剪辑", round = (params.shape ?? "圆") === "圆"
    if (params.enabled !== false) { ctx.fillStyle = css(params.ink); ctx.beginPath(); ctx.roundRect(x, 1100, 260, 260, round ? 130 : 0); ctx.fill() }
    ctx.strokeStyle = css(params.ink); ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(x, 1420); ctx.lineTo(x + 1800, 1420); ctx.stroke()
    ctx.fillStyle = "#ffffff"; ctx.font = "130px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x + 150, 1600)
  }
}`
}

/** 静态卡片：半透明底色、文字与可选透明徽标图片。 */
function staticCardSource({ withLogo = true } = {}) {
  const params = [{ key: 'ink', type: 'color', title: '底色', default: [0.1, 0.25, 1, 0.5] }, ...(withLogo ? [{ key: 'logo', type: 'image', title: '透明徽标' }] : [])]
  return `${CSS}
export default {
  name: "透明静态卡片", kind: "generator", mode: "static", width: 3840, height: 2160, durationSeconds: 3,
  params: ${JSON.stringify(params)},
  draw(ctx, time, params, width, height, assets) {
    ctx.fillStyle = css(params.ink); ctx.beginPath(); ctx.roundRect(130, 130, 980, 600, 48); ctx.fill()
    ctx.fillStyle = "#ffffff"; ctx.font = "115px sans-serif"; ctx.textBaseline = "middle"; ctx.fillText("静态画面复用", 210, 420)
    if (assets.logo) ctx.drawImage(assets.logo, 1200, 240, 1000, 700)
  }
}`
}

const AGENT_COLOR_SOURCE = `export default {
  name: "智能体原创色块", kind: "generator", mode: "static", width: 3840, height: 2160, durationSeconds: 5,
  params: [{ key: "red", type: "number", title: "红色", default: .2, min: 0, max: 1, step: .01, animatable: true }],
  draw(ctx, time, params) { ctx.fillStyle = \`rgb(\${params.red * 255}, \${.3 * 255}, \${.8 * 255})\`; ctx.fillRect(960, 540, 1920, 1080) }
}`

const ASSET_SOURCE = `export default {
  name: "跨工程代码资产", kind: "generator", mode: "dynamic", width: 3840, height: 2160, durationSeconds: 3,
  params: [
    { key: "amount", type: "number", title: "图形透明度", default: .5, min: 0, max: 1, step: .01, animatable: true },
    { key: "logo", type: "image", title: "原图片" },
    { key: "label", type: "text", title: "标题内容", default: "跨工程代码资产", maxLength: 64 }
  ],
  draw(ctx, time, params, width, height, assets) {
    ctx.fillStyle = \`rgba(0, 153, 255, \${params.amount})\`; ctx.fillRect(130 + time * 100, 500, 1000, 500)
    if (assets.logo) ctx.drawImage(assets.logo, 1800, 300, 1000, 600)
    ctx.fillStyle = "#ffffff"; ctx.font = "130px sans-serif"; ctx.textBaseline = "middle"; ctx.fillText(params.label, 200, 1500)
  }
}`

const redGainFilter = (name, gain, animatable) => authorFilterSource({ name, params: [number('gain', name === '可编辑资产滤镜' ? '红色强度' : '红色增益', gain, 0, 1, .01, animatable)], expression: 'vec4f(c.r * p.v.x,c.g,c.b,c.a)' })

const OBSERVATION_SOURCES = {
  flash: `export default {
  name: "单帧观察验收", kind: "generator", mode: "dynamic", width: 640, height: 360, durationSeconds: 2,
  layers(params, width, height) {
    return [{ id: "背景", draw(ctx, time) { ctx.fillStyle = time >= .5 && time < .51 ? "#ff0000" : "#0000ff"; ctx.fillRect(0, 0, 640, 360) } }]
  }
}`,
  sound: `export default {
  name: "声音驱动验收", kind: "generator", mode: "dynamic", width: 640, height: 360, durationSeconds: 2,
  layers(params, width, height, assets, info) {
    const audio = info.audio, index = audio ? Math.floor((info.audioTime ?? info.clip.time) * audio.fps) : -1
    const level = audio && index >= 0 && index < audio.levels.length ? audio.levels[index] : 0
    return [{ id: "声音标记", draw(ctx) { ctx.fillStyle = "#00ff00"; ctx.fillRect(level * 500, 80, 60, 40) } }]
  }
}`,
  input: `export default {
  name: "画面输入验收", kind: "generator", mode: "dynamic", width: 640, height: 360, durationSeconds: 2,
  params: [{ key: "picture", type: "image", title: "画面" }],
  layers(params, width, height, assets) {
    return [{ id: "输入", draw(ctx) { if (assets.picture) ctx.drawImage(assets.picture, 0, 0, 640, 360) } }]
  }
}`,
  shared: `export default {
  name: "四路输入", kind: "generator", mode: "dynamic", width: 640, height: 360, durationSeconds: 2,
  params: [{ key: "a", type: "image", title: "原片" }, { key: "b", type: "image", title: "重复原片" }, { key: "c", type: "image", title: "下层" }, { key: "d", type: "image", title: "重复下层" }],
  draw(ctx, time, params, width, height, assets) {
    ["a", "b", "c", "d"].forEach((key, i) => { if (assets[key]) ctx.drawImage(assets[key], i * 160, 0, 160, 360) })
  }
}`,
  motion: `export default {
  name: "快门曝光验收", kind: "generator", mode: "dynamic", width: 640, height: 360, durationSeconds: 2,
  motionBlur: { shutter: 180, maxSamples: 64 },
  params: [{ key: "blurEnabled", type: "boolean", title: "运动曝光", default: true }],
  layers(params) {
    return [
      { id: "背景", draw(ctx) { ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, 640, 360) } },
      { id: "运动层", bounds: [160, 160, 168, 200], motionBlur: params.blurEnabled, pose: t => ({ x: (t - 1) * 1920 }),
        draw(ctx) { ctx.fillStyle = "rgba(255, 0, 0, 0.50196)"; ctx.fillRect(160, 160, 8, 40) } }
    ]
  }
}`,
  lens: `export default {
  name: "层级焦点验收", kind: "generator", mode: "dynamic", width: 640, height: 360, durationSeconds: 2,
  params: [{ key: "focus", type: "number", title: "焦点", default: 0, min: 0, max: 1, step: .01, animatable: true }],
  layers(params) {
    return [
      { id: "背景", draw(ctx) { ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, 640, 360) } },
      { id: "近处", bounds: [160, 160, 176, 200], blurShape: "lens", motionBlur: false, pose: () => ({ blur: params.focus * 24 }),
        draw(ctx) { ctx.fillStyle = "#ff0000"; ctx.fillRect(160, 160, 16, 40) } },
      { id: "远处", bounds: [400, 160, 416, 200], blurShape: "lens", motionBlur: false, pose: () => ({ blur: (1 - params.focus) * 24 }),
        draw(ctx) { ctx.fillStyle = "#0000ff"; ctx.fillRect(400, 160, 16, 40) } }
    ]
  }
}`,
}

const PERFORMANCE_GENERATOR = `export default {
  name: "持续动态标题条", kind: "generator", mode: "dynamic", width: 3840, height: 2160, durationSeconds: 63,
  params: [{ key: "amount", type: "number", title: "强度", default: .6, min: 0, max: 1, step: .01, animatable: true }],
  draw(ctx, time, params) {
    ctx.fillStyle = \`rgba(255, 217, 51, \${params.amount})\`; ctx.fillRect(200 + time * 40, 1700, 1200, 180)
    ctx.fillStyle = "rgba(51, 153, 255, .7)"; ctx.beginPath(); ctx.ellipse(3360, 460 + time * 20, 160, 160, 0, 0, Math.PI * 2); ctx.fill()
  }
}`
const PERFORMANCE_FILTER = authorFilterSource({ name: '受控暖色', params: [number('warm', '暖色', .9, 0, 1, .01, true)], expression: 'vec4f(c.r,c.g * p.v.x,c.b * p.v.x,c.a)' })

module.exports = { authorFilterSource, trackTitleSource, staticCardSource, redGainFilter, AGENT_COLOR_SOURCE, ASSET_SOURCE, OBSERVATION_SOURCES, PERFORMANCE_GENERATOR, PERFORMANCE_FILTER }
