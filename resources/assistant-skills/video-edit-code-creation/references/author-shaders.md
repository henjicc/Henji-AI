# GPU 代码：WebGPU、WebGL 与滤镜

需要逐像素计算、处理下方画面、多遍着色或大量粒子时，用 `createWebGPU`（原生 WebGPU，与合成共用同一 `GPUDevice`）或 `createWebGL`（WebGL2）。效果、效率优先，不限制 WGSL 的写法与遍数。

## createWebGPU

```text
async createWebGPU(device) => {
  draw(target, time, params, width, height, assets, info, inputs?) => void | Promise<void>,
  dispose?() => void | Promise<void>
}
```

- `createWebGPU` 每个实例只调用一次：在这里建着色器模块、管线、缓冲；`draw` 每帧调用，只写 uniform、建绑定组、提交命令。
- `target` 是本帧输出纹理，格式以 `target.format` 为准（可能是 `rgba8unorm` 或 `rgba16float`），按格式缓存管线。输出为预乘 alpha。
- `inputs.images[参数名]` 是图片、视频参数的纹理 `{ texture, width, height }`（预乘 alpha，视频每帧是当前帧）。生成器和滤镜都有。**GPU 入口一律直接采样它，不要读 `assets`**：读 `assets` 会把这一帧从 GPU 拷成位图，4K 视频每帧多花好几毫秒；不读就不拷。
- 滤镜另有 `inputs.current`（当前输入画面）和 `inputs.frames`（模块 `frames` 声明的相邻帧 `{ offset, texture, available }`，顺序与声明一致）。输入纹理归时间线所有，只读，不要销毁，只在这次 `draw` 里有效，不要跨帧缓存纹理对象。
- 中间纹理由你创建与释放：尺寸变化时等待 `device.queue.onSubmittedWorkDone()` 后销毁旧纹理；`dispose` 里释放缓冲和纹理。
- 用 `textureLoad` 按像素读输入最稳定；需要插值时自己做双线性。

## 滤镜（kind: "filter"）

滤镜读取下方画面并输出同尺寸画面，只能用 createWebGPU。最小例子：

```ts
const shader = `
struct P { gain: vec4f }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var current: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let q = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3)); return vec4f(q[i], 0, 1);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let c = textureLoad(current, vec2i(pos.xy), 0);
  return vec4f(c.r * p.gain.x, c.g, c.b, c.a);
}`
export default {
  name: "红色增益", kind: "filter", mode: "static",
  params: [{ key: "gain", type: "number", title: "红色增益", min: 0, max: 1, step: .01, default: .8, animatable: true }],
  async createWebGPU(device) {
    const module = device.createShaderModule({ code: shader })
    const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const pipelines = new Map()
    return {
      async draw(target, time, params, width, height, assets, info, inputs) {
        let pipeline = pipelines.get(target.format)
        if (!pipeline) {
          pipeline = await device.createRenderPipelineAsync({ layout: "auto", vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format: target.format }] } })
          pipelines.set(target.format, pipeline)
        }
        device.queue.writeBuffer(buffer, 0, new Float32Array([params.gain, 0, 0, 0]))
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store" }] })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: inputs.current.createView() }] }))
        pass.draw(3); pass.end()
        device.queue.submit([encoder.finish()])
      },
      async dispose() { await device.queue.onSubmittedWorkDone(); buffer.destroy() }
    }
  }
}
```

## 多遍与相邻帧

- 多遍：前几遍写入自建的中间纹理（如 `rgba16float` / `rgba32float`），最后一遍写 `target`。可分离模糊、辉光、色散、光流类效果都这样写。
- 相邻帧：模块声明 `frames: [-1, 1]`，`inputs.frames` 按同样顺序给出纹理；`available` 为 false 时（片段边缘）退回当前帧，不要伪造内容。
- 时间、帧长、尺寸通过 uniform 传入；不在 GPU 侧累积跨帧状态。

## createWebGL

`createWebGL(gl)` 返回 `{ draw(time, params, width, height, assets, info), dispose? }`。宿主提供透明、预乘 alpha 的 WebGL2 画布并在每帧清空，绘制结果复制到输出。适合迁移现成的 WebGL/GLSL 代码；新写的 GPU 效果优先 WebGPU。WebGL 入口不接收滤镜输入。

## 内置着色器组件

效果面板里的 shaders 组件（纹理、模糊、扭曲、风格化、转场）是剪辑内置效果与转场，用 `video_edit.builtin_effect`（`effect:shaders.组件名` / `transition:shaders.组件名`）添加，作者代码不直接调用。需要同类但可定制的效果时，在 createWebGPU 里自写 WGSL。组件目录见 shader-components-* 参考。
