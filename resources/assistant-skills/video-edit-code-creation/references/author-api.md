> 作者 API 18：没有位姿的图层也有运动模糊。宿主比较相邻帧的绘制指令，算出每个字、每个形状走了多远，不用多跑作者代码，内容没动就不花算力。只有连续的运动才拖影：文字折行时字跳到别处不算运动。字的拖影限制在自身大小的 0.35 倍以内，不会拖成长线；同一层里卡片这类大块内容照样拖得长。动画写在 `draw(ctx, t)` 的 `t` 或 `info.time` 上都算。`motionBlur: false` 只关这一层。
> 作者 API 17：三维作者的 `host.time`（本场景源时间）、`host.space.material/environment`（标准材质与环境，实时与渲染方式一致）与元素轮廓 `outline()`。作者 API 16：三维作者的图片参数可引用时间线片段，`info.elements[键]` 给出它的位置与形状（见空间配方）。作者 API 15：真实几何用受管 createThree，宿主掌管相机、景深与曝光。其他入口仅显式 space:true 才获得 info.space。普通卡片中心生成一次；three 场景逐子时刻渲染。空间构图调用宿主能力，不手写投影、布局或景深。旧 API 按各自版本保留行为。见 [空间配方](recipes-3d.md)。

# 作者接口：模块契约与内置库


本页是作者接口的模块契约与内置库；每帧画面键与累积模拟见 [author-api-frame](author-api-frame.md)，图层（`pose(t)`、`bounds`、遮罩与调整层）与元素身份见 [author-api-layers](author-api-layers.md)，图层效果链见 [author-api-effects](author-api-effects.md)。

代码素材是标准 ES 模块，在剪辑渲染 Worker 里直接执行，和合成共用同一个 GPU 设备。写普通 JS/TS：`let`、循环、类、闭包、`Math`、数组方法、相对导入都可以用；宿主不解析也不限制你的绘制代码。文字与动效见 author-text-motion，WebGPU/WebGL 与滤镜见 author-shaders，参数类型见 parameter-types。

节目预览可在完整输入和 `frameKey` 相同时复用片段上次输出，跳过作者绘制。`draw` 里用了随机数且随时间变化时，`frameKey` 必须包含时间；随机种子随时间变化也属于画面变化。不要依赖绘制调用次数或上一帧留下的状态。`dataFiles`（见 [author-api-frame](author-api-frame.md)）的身份排除只用于预渲染指纹；节目预览的上次输出键始终包含完整源码和 `dataFiles`，`frameKey` 只在同一源码版本内跨时间复用。

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
| `motionBlur` | `{ shutter?, phase?, maxSamples? }`，layers 的运动曝光默认值；作者接口 18 起 `phase` 默认 `-shutter`，快门在当前帧结束，拖影只留在运动方向的身后 |
| `frameKey` | 可选纯函数，声明这一帧画了什么，供预渲染复用；约定见 author-api-frame |
| `dataFiles` | 可选工程相对路径数组；仅有 frameKey 时，这些非入口文件从代码身份中排除 |
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
- `assets` 为 image 参数的画面（`CanvasImageSource`），按参数键取，如 `assets.logo`；未绑定时没有该键。image 参数可绑素材、视频、下方画面、网页，或同序列里的另一个片段 `{kind:'clip',clipId}`（拿到它此刻的画面，透明处透明；它此刻不在画面上时参数为空）。
- `info`：`time`、`frameDuration`（一帧秒数）、`clip.time` / `clip.duration`（片段内时间与片段时长）、可选 `audio` / `audioTime`（见 author-api-media）、可选 `renderScale`（见下）、可选 `web`（绑定了网页的图片参数这一帧的页面时间、取景与元素矩形，见 author-api-web）。
- 预览降分辨率（1/2、1/4…）与导出按输出分辨率渲染时，宿主按比例缩小栅格与上传，`info.renderScale` 给出输出像素与画布像素之比（≤1，如 0.5；省略即 1）。`ctx` 的坐标、`width` / `height` 仍是画布像素，Canvas 代码不用处理；WebGPU / WebGL 中按像素写的长度乘 `info.renderScale ?? 1`。输出大于序列或填充裁切需要放大时，按序列尺寸渲染后再放大。

## 内置库

随软件发行、不联网，直接 `import`：

| 库 | 当前版本 | 起始接口 | 能写的导入路径 |
| --- | --- | --- | --- |
| three | 0.186.1 | v5 | `three`、`three/webgpu`、`three/tsl`；附加模块写 `three/addons/<子路径>.js`（同 `three/examples/jsm/…`，`.js` 不能省） |
| opentype.js | 2.0.0 | v5 | `opentype.js`，只有具名导出：`import { parse } from "opentype.js"`（没有默认导出，字体字节读进来再 `parse`） |
| henji-layout | 2.1.1 | v10 | `henji-layout/text`（`layoutText`、`drawText` 排版、字素动画与缓存绘制）、`henji-layout/flex`（`layoutBoxes` 盒子布局）、`henji-layout/table`（`layoutTable` 数字与文本表格）；见 author-text-motion |

- 低于起始接口不能导入；另存新版本按当前作者接口编译。
- 新库选兼容最新版；旧导入沿用记录，无记录用第一套。升级：`upgrade_video_edit_code_materials`、`upgradeLibraries:true`（指定素材、保留作者 API、改指可撤销；henji-layout 升到 2.0.2 后，`maxWidth` 配大于 1 的 `maxLines` 和 `fit` 会真正折行，写死 `bounds` 的素材要复核）。明确要升级作者接口时使用 `upgradeAuthorApi:true`，同时选择兼容库，返回实际 `apiVersion` 与 `libraries`；升级与改指共用一次撤销。新建素材默认用当前作者接口，文字、flex 与 table 统一使用 `henji-layout@2.1.1`。
- 同一版本的库各片段共用一份实例，模块顶层不放会被别的片段看到的状态。
- 类型检查按库的真实类型报错。three 接管宿主 WebGL 上下文见 [纵深与三维](recipes-3d.md) 的“用 three 画真实网格”。

## 确定性与性能

- 同一参数历史、同一 `time` 必须得到同一画面。解析动画按时间直接取样；需要累积状态时使用下方的 `createSimulation` 与 `info.simulation.at(time)`，模拟随机值用 `info.random()`，不要在 draw 中推进世界。
- 不访问网络、文件或 DOM；外部图片走 image 参数。
- 宿主不设语言预算或绘制数量上限。试渲染与取帧会返回 `performance`：`cpuMs`、`gpuMs`（提交到队列完成的墙钟）、`budgetMs`（`1000/fps`），Canvas 图层另有 `layers` 沿用与上传统计。超出预算不拒绝画面，按反馈优化最贵的部分：缓存不随时间变化的路径和渐变、减少逐帧 `getImageData`、把逐像素工作移到 createWebGPU。

## 错误

源码在后台 Worker 打包并加载；语法错误、导入缺失、入口缺失或 `draw` 抛错时，操作返回错误与源码位置（文件、行列），按位置修正后提交新操作，不原样重试。缺字体会提示并回退；回退能画不等于品牌字体已验收。

## 类型检查

TS 文件（含默认入口 main.ts）在打包的同时按作者接口做类型检查：`ctx`、`time`、`info`、图层与 `pose` 有上下文类型，`params` 的键名与取值形状按 params 声明推断。能拦下拼错的 Canvas 属性或模块字段、方法参数个数或类型不对、带 pose 却漏写 bounds、读了未声明的参数键等。

- 不阻止创建：成功结果的证据里有一条“类型检查”，问题按 `文件:行:列 TS错误码 信息` 列出（data 里有结构化位置）；加载或试渲染失败时，类型问题附在错误信息末尾。有问题就按位置修正后提交新源码版本，交付前清零。
- JS 文件默认不查，文件开头写 `// @ts-check` 才查；`// @ts-nocheck` 关闭单个文件的检查，只在确认误报时用。
- 拆到别的文件的工厂函数可用全局类型 `AuthorLayer`、`AuthorPose`、`AuthorFrameInfo`、`AuthorParams` 标注，不用导入。
