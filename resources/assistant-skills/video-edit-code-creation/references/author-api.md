# 作者接口：模块、绘制与图层

代码素材是标准 ES 模块，在剪辑渲染 Worker 里直接执行，和合成共用同一个 GPU 设备。写普通 JS/TS：`let`、循环、类、闭包、`Math`、数组方法、相对导入都可以用；宿主不解析也不限制你的绘制代码。文字与动效见 author-text-motion，WebGPU/WebGL 与滤镜见 author-shaders，参数类型见 parameter-types。

## 完整最小源码

ts 围栏须为完整作者源码，测试会直接加载；调用片段用 text，工具输入用 json。

```ts
export default {
  name: "图形核心", kind: "generator", mode: "dynamic",
  width: 1920, height: 1080, durationSeconds: 5,
  params: [
    { key: "accent", type: "color", title: "强调色", default: "#73b3a6" },
    { key: "enter", type: "number", title: "入场时长", min: .1, max: 3, step: .05, default: 1 }
  ],
  draw(ctx, time, params, width, height) {
    const p = Math.min(1, Math.max(0, time / params.enter))
    const eased = 1 - (1 - p) ** 3
    ctx.globalAlpha = eased
    ctx.fillStyle = "#21262f"
    ctx.beginPath(); ctx.roundRect(120 + eased * 80, 120, 680, 180, 16); ctx.fill()
    ctx.strokeStyle = params.accent; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(152 + eased * 80, 264); ctx.lineTo(152 + eased * 80 + 616 * eased, 264); ctx.stroke()
  }
}
```

## 模块契约

`export default` 一个对象：

| 字段 | 说明 |
| --- | --- |
| `name` | 必填，素材名 |
| `kind` | `generator`（默认，自己画内容）或 `filter`（处理下方画面，只能用 createWebGPU，见 author-shaders） |
| `mode` | `dynamic`（默认）或 `static`（同一参数下每帧画面相同，宿主可复用） |
| `width` / `height` / `durationSeconds` | 可选的放置提示；实际画布尺寸与时间由宿主给出，不要假定等于提示值 |
| `params` / `types` | 参数声明数组与自定义组件类型，见 parameter-types |
| `frames` | 滤镜需要的相邻帧偏移（宿主帧单位，非零、不重复），见 author-shaders |
| `motionBlur` | `{ shutter?, phase?, maxSamples? }`，layers 的运动曝光默认值 |
| 绘制入口 | `draw`、`layers`、`createWebGL`、`createWebGPU` 至少一个；`layers` 不能与 GPU 入口同时声明 |
| `dispose` | 可选；实例释放时调用 |

绘制入口签名：

```text
draw(ctx, time, params, width, height, assets, info)
layers(params, width, height, assets, info) => Layer[]
```

- `ctx` 是 `OffscreenCanvasRenderingContext2D`，画布即输出尺寸，左上角为原点。
- `time` 是素材源时间（秒，随片段裁剪、变速、倒放连续），关键帧与动画都按它写。
- `params` 为当前帧参数值（已应用关键帧曲线），见 parameter-types 的取值表。
- `assets` 为 image 参数的画面（`CanvasImageSource`），按参数键取，如 `assets.logo`；未绑定时没有该键。
- `info`：`time`、`frameDuration`（一帧秒数）、`clip.time` / `clip.duration`（片段内时间与片段时长）、可选 `audio` / `audioTime`（见 author-api-media）。

## 图层：layers

需要点选、拖动或运动模糊的元素写成图层；会动的一律用 `pose` 表达，draw 不读 time（只画一次、按位姿合成，见 performance）。`layers()` 每帧返回数组，按顺序从底到顶合成：

| 字段 | 说明 |
| --- | --- |
| `id` | 稳定字符串，用于点选、元素覆盖、标注定位；动态图层用数据键组成，如 `node-3` |
| `name` | 可选显示名 |
| `bounds` | `[x0, y0, x1, y1]` 内容范围（画布像素）；带 `pose` 的图层必填，也用于选框 |
| `clip` | 可选裁切矩形 `[x0, y0, x1, y1]` |
| `draw(ctx, t)` | 绘制本图层；坐标仍是画布像素 |
| `pose(t)` | 可选；返回 `{x, y, rotation, scale, scaleX, scaleY, opacity, blur}` 或 `null`（本时刻不显示）。变换作用在画布坐标上：先绕画布原点缩放、旋转（弧度），再平移 x/y；绕自身中心缩放时把 `中心 × (1 − scale)` 加进 x/y。有 pose 的图层只画一次内容，位姿在快门内按 `pose(t)` 采样 |
| `motionBlur` | 有 pose 时默认开启运动模糊，`false` 只关这一层；序列运动模糊总开关关掉时一律不模糊 |
| `blurShape` | `gaussian`（默认）或 `lens`（镜头散焦），配合 pose 的 `blur` |
| `data` | `{ parameter, index }` 或 `{ parameter, keyField, key }`，把图层绑定到 table 参数的一行 |
| `factory` | `{ file, name }`，指向生成这类图层的工厂函数，选中后可跳转 |

相邻、没有 pose 的图层会合并到同一张画布上绘制，保留 Canvas 的混合关系；有 pose 的图层各自栅格化后按位姿合成。

draw 里的坐标始终是画布像素，`setTransform`、`resetTransform`、`getTransform` 也一样（运动层的栅格缩放由宿主叠上）。渐变、图案对象可以缓存到模块变量跨帧复用。

```ts
export default {
  name: "分层标题", kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  params: [
    { key: "title", type: "text", title: "标题", default: "痕迹AI", maxLength: 40, layer: "title" },
    { key: "titleStyle", type: "textStyle", title: "标题样式", layer: "title", default: { fontSize: 120, fontWeight: 700 } }
  ],
  layers(params, width, height) {
    const enter = t => 1 - Math.pow(2, -10 * Math.min(1, Math.max(0, t / .6)))
    return [
      { id: "plate", bounds: [360, 440, 1560, 640], pose: t => ({ y: (1 - enter(t)) * 80, opacity: enter(t) }),
        draw(ctx) { ctx.fillStyle = "#1d2a33"; ctx.beginPath(); ctx.roundRect(360, 440, 1200, 200, 20); ctx.fill() } },
      { id: "title", bounds: [410, 470, 1510, 610], pose: t => ({ y: (1 - enter(t - .1)) * 60, opacity: enter(t - .1) }),
        draw(ctx) {
          const style = params.titleStyle
          ctx.font = `${style.fontWeight ?? 700} ${style.fontSize ?? 120}px ${style.fontFamily ?? "sans-serif"}`
          ctx.fillStyle = style.fill?.color ?? "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"
          ctx.fillText(params.title, width / 2, 540, 1100)
        } }
    ]
  }
}
```

## 确定性与性能

- 同一参数、同一 `time` 必须得到同一画面：随机用自己写的种子哈希（见 author-text-motion），不用 `Math.random()`、`Date.now()` 或跨帧累积状态。宿主按帧缓存并可能乱序取帧，跨帧状态会在拖动、导出时出错。
- 不访问网络、文件或 DOM；外部图片走 image 参数。
- 宿主不设语言预算或绘制数量上限。试渲染与取帧会返回 `performance`：`cpuMs`、`gpuMs`（提交到队列完成的墙钟）、`budgetMs`（`1000/fps`）。超出预算不拒绝画面，按反馈优化最贵的部分：缓存不随时间变化的路径和渐变、减少逐帧 `getImageData`、把逐像素工作移到 createWebGPU。

## 多文件与元素

- 入口默认 `main.ts`，可用相对导入拆文件，或 `@组件/名称` 导入项目组件，见 multifile-components。
- 图层 id 是元素身份：拖动、缩放、旋转写入 `video_edit.clip.element_overrides`，按 id 保存；改名或删除图层会让旧覆盖失效。改字、改色优先改参数。
- 源码结构变化新增版本再重绑，不要改写已被片段引用的版本。

## 错误

源码在后台 Worker 打包并加载；语法错误、导入缺失、入口缺失或 `draw` 抛错时，操作返回错误与源码位置（文件、行列），按位置修正后提交新操作，不原样重试。缺字体会提示并回退；回退能画不等于品牌字体已验收。
