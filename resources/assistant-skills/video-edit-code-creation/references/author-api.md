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
| `frameKey` | 可选纯函数，声明这一帧画了什么，供预渲染复用；见下方约定 |
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
- `assets` 为 image 参数的画面（`CanvasImageSource`），按参数键取，如 `assets.logo`；未绑定时没有该键。
- `info`：`time`、`frameDuration`（一帧秒数）、`clip.time` / `clip.duration`（片段内时间与片段时长）、可选 `audio` / `audioTime`（见 author-api-media）、可选 `renderScale`（见下）、可选 `web`（绑定了网页的图片参数这一帧的页面时间、取景与元素矩形，见 author-api-media）。
- 预览降分辨率（1/2、1/4…）与导出按输出分辨率渲染时，宿主按比例缩小栅格与上传，`info.renderScale` 给出输出像素与画布像素之比（≤1，如 0.5；省略即 1）。`ctx` 的坐标、`width` / `height` 仍是画布像素，Canvas 代码不用处理；WebGPU / WebGL 中按像素写的长度乘 `info.renderScale ?? 1`。输出大于序列或填充裁切需要放大时，按序列尺寸渲染后再放大。

## 每帧画面键与片子数据

模块可选声明（完整类型见 `resources/video-edit-author/author-api.d.ts`）：

```text
frameKey?(params: AuthorParameters, width: number, height: number, info: AuthorFrameInfo): unknown
dataFiles?: readonly string[]
```

`frameKey` 是纯函数，返回 JSON 数据：null、布尔、字符串、有限数字、数组或普通对象。不能包含 undefined、函数、symbol、bigint、循环引用、NaN/Infinity 或异步结果。只用参数、尺寸、时刻和模块自己的数据，不读 GPU、画布、素材像素或网页布局；不调用文字测量、栅格或绘制入口。宿主按代码身份、返回值、本帧排到的素材/网页内容与取帧时间、相关片子数据记录及画面参数判断能否复用。提供 frameKey 后，Canvas、文字栅格、layers 读取素材、WebGPU 与 WebGL 都走声明键，不再尝试录画布；报错或返回非 JSON 值时保守使用版本摘要，并记录原因。目前用于代码生成片段，附加代码滤镜继续按版本依赖失效。

`frameKey` 描述这一帧的整个曝光区间，宿主每帧只调用一次。`info.time` 与 `info.clip` 始终是中心帧上下文；`info.frameDuration` 为一帧秒数。宿主在 frameKey 的 `info.exposure` 提供 `{ start, end, shutter, phase }`：start/end 为包含中心时刻的完整曝光范围（素材秒数），shutter/phase 为有效快门角度；未开启图层运动模糊时 start = end = time，角度均为 0。默认快门 180°、相位 -90°，范围为 time ± frameDuration / 4；自定义快门与相位按模块 motionBlur 求值。

作者负责把曝光范围内会影响画面的量全部放进返回值，包括文字、位置、颜色、镜头轨迹与落点，以及曝光边界内的出现/退场。可以用 frameDuration 作保守 padding，但不能只描述中心时刻，也不能只给段落名。两次返回值相同，且 dataFiles 以外的代码与输入相同，整个曝光画面必须相同。宿主不再替作者枚举快门候选时刻。不要依赖调用次数、顺序或上次调用留下的状态。

`dataFiles` 填工程内完整相对路径（例如 `film/demo/film.ts`），不写通配符或文件夹；入口文件始终计入代码身份，不存在的路径忽略。这些文件对画面的影响必须全部体现在 frameKey 返回值里，只有声明 frameKey 才会排除；其他文件、入口、钉住的组件与库版本、作者 API 版本仍计入代码身份。不要把未由画面键表达的画法或着色器放进去。漏报会留下旧画面；修正声明后，用剪辑的“删除渲染文件”恢复。

写法：先算出这一刻要画的清单，frameKey 返回清单，draw 只按清单画。多文件工程把描述数据放在 dataFiles；同一求清单函数供声明和绘制使用，别各写一套。

```ts
const film = [{ at: 0, end: 2, text: "开场", x: 120 }, { at: 2, end: 5, text: "正文", x: 160 }]
const picture = (params, width, height, info) => ({
  background: params.background,
  labels: film.filter(item => info.time >= item.at && info.time < item.end)
    .map(item => ({ text: item.text, x: item.x, y: height / 2, color: params.ink }))
})
export default {
  name: "按清单绘制", kind: "generator", mode: "dynamic",
  params: [
    { key: "background", type: "color", title: "背景", default: "#21262f" },
    { key: "ink", type: "color", title: "文字", default: "#ffffff" }
  ],
  frameKey: picture,
  draw(ctx, time, params, width, height, assets, info) {
    const list = picture(params, width, height, info)
    ctx.fillStyle = list.background; ctx.fillRect(0, 0, width, height)
    ctx.font = "64px sans-serif"
    for (const label of list.labels) {
      ctx.fillStyle = label.color; ctx.fillText(label.text, label.x, label.y)
    }
  }
}
```

此完整例子把 film 内联在入口，所以改它仍改变代码身份。工程中将 film 搬到 `film/demo/film.ts` 并导入，再在模块上写 `dataFiles: ["film/demo/film.ts"]`，即可让不影响当前清单的数据改动复用已有画面。

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
| `cacheKey` | 可选内容键（字符串或数字）。与上一帧同一图层的值相同、bounds/clip 与用到的图片没变时，引擎不再调用 draw，沿用上一帧的画面，pose 照常每帧求值。动画落定后给它，例如 `'settled'`；内容还在变时不给，或每次变化换一个值 |
| `data` | `{ parameter, index }` 或 `{ parameter, keyField, key }`，把图层绑定到 table 参数的一行 |
| `factory` | `{ file, name }`，指向生成这类图层的工厂函数，选中后可跳转 |

相邻、没有 pose 的图层会合并到同一张画布上绘制，保留 Canvas 的混合关系；其中只用默认叠加、最近在变的层由引擎单独栅格，静止的层沿用（见 performance）。有 pose 的图层各自栅格化后按位姿合成。

draw 里的坐标始终是画布像素，`setTransform`、`resetTransform`、`getTransform` 也一样（运动层的栅格缩放由宿主叠上）。渐变、图案对象（含图案的 `setTransform`）可以缓存到模块变量跨帧复用；预先画好、反复贴的图块缓存成 `transferToImageBitmap()` 得到的 ImageBitmap，不要缓存 OffscreenCanvas。

`layoutText` 按内容、样式、选项与字体代次复用只读布局，可在 `layers()` 中调用。逐字用一次 `drawText` 的 `graphemes` 回调返回位移与透明度，null 隐藏。图集全程沿用，落定不换路径；底板和装饰线保持整段，用 `backgroundAndDecorationOpacity` 控制。分层、连写、档位和 flex 内容尺寸、截断、基线规则见 author-text-motion；表格字段对象与数据卡见 recipes-text-data。

```ts
import { layoutText, drawText } from "henji-layout/text"
export default {
  name: "分层标题", kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  params: [
    { key: "title", type: "text", title: "标题", default: "痕迹AI", maxLength: 40, layer: "title" },
    { key: "titleStyle", type: "textStyle", title: "标题样式", layer: "title", default: { fontSize: 120, fontWeight: 700 } }
  ],
  layers(params, width, height) {
    const enter = t => 1 - Math.pow(2, -10 * Math.min(1, Math.max(0, t / .6)))
    const title = layoutText(params.title, params.titleStyle, { maxWidth: 1100, maxLines: 1, fit: { minFontSize: 48 }, anchor: { x: width / 2, y: 540, horizontal: .5, vertical: .5 } })
    return [
      { id: "plate", bounds: [360, 440, 1560, 640], pose: t => ({ y: (1 - enter(t)) * 80, opacity: enter(t) }),
        draw(ctx) { ctx.fillStyle = "#1d2a33"; ctx.beginPath(); ctx.roundRect(360, 440, 1200, 200, 20); ctx.fill() } },
      { id: "title", bounds: [410, 470, 1510, 610], pose: t => ({ y: (1 - enter(t - .1)) * 60, opacity: enter(t - .1) }),
        draw(ctx) { drawText(ctx, title) } }
    ]
  }
}
```

## 确定性与性能

- 同一参数、同一 `time` 必须得到同一画面：随机用自己写的种子哈希（见 author-text-motion），不用 `Math.random()`、`Date.now()` 或跨帧累积状态。宿主按帧缓存并可能乱序取帧，跨帧状态会在拖动、导出时出错。
- 不访问网络、文件或 DOM；外部图片走 image 参数。
- 宿主不设语言预算或绘制数量上限。试渲染与取帧会返回 `performance`：`cpuMs`、`gpuMs`（提交到队列完成的墙钟）、`budgetMs`（`1000/fps`），Canvas 图层另有 `layers` 沿用与上传统计。超出预算不拒绝画面，按反馈优化最贵的部分：缓存不随时间变化的路径和渐变、减少逐帧 `getImageData`、把逐像素工作移到 createWebGPU。

## 多文件与元素

- 入口默认 `main.ts`，可用相对导入拆文件，或 `@组件/名称` 导入项目组件，见 multifile-components。
- 图层 id 是元素身份：拖动、缩放、旋转写入 `video_edit.clip.element_overrides`，按 id 保存；改名或删除图层会让旧覆盖失效。改字、改色优先改参数。
- 源码结构变化新增版本再重绑，不要改写已被片段引用的版本。

## 错误

源码在后台 Worker 打包并加载；语法错误、导入缺失、入口缺失或 `draw` 抛错时，操作返回错误与源码位置（文件、行列），按位置修正后提交新操作，不原样重试。缺字体会提示并回退；回退能画不等于品牌字体已验收。

## 类型检查

TS 文件（含默认入口 main.ts）在打包的同时按作者接口做类型检查：`ctx`、`time`、`info`、图层与 `pose` 有上下文类型，`params` 的键名与取值形状按 params 声明推断。能拦下拼错的 Canvas 属性或模块字段、方法参数个数或类型不对、带 pose 却漏写 bounds、读了未声明的参数键等。

- 不阻止创建：成功结果的证据里有一条“类型检查”，问题按 `文件:行:列 TS错误码 信息` 列出（data 里有结构化位置）；加载或试渲染失败时，类型问题附在错误信息末尾。有问题就按位置修正后提交新源码版本，交付前清零。
- JS 文件默认不查，文件开头写 `// @ts-check` 才查；`// @ts-nocheck` 关闭单个文件的检查，只在确认误报时用。
- 拆到别的文件的工厂函数可用全局类型 `AuthorLayer`、`AuthorPose`、`AuthorFrameInfo`、`AuthorParams` 标注，不用导入。


## Canvas 阴影的源图形范围

运动层不要把源文字/图形完全画到图层栅格外，再用 `shadowOffsetX/Y` 把影子投回做辉光。这种写法不受支持：即使内容范围推算已计入偏移和模糊，Canvas 栅格裁切仍可能使整条投影消失。请在层内绘制，用 `effects: () => [glow(...)]` 做光晕；或把运动层 bounds 扩大到同时容纳原图形与投影，再通过 layer.clip 限定最终显示范围。静止层按整幅画布栅格，不凭源图形在画布外就报告这一风险。

普通层内阴影继续支持，阴影越界不等于正文丢失。`query_video_edit_review` 的 `motion:{}` 会对运动层可录制的文字、矩形/圆角矩形与图像返回 `shadow_outside_source` 风险和时间；任意 Path2D、直接绘制及 GPU 内部阴影没有这份几何证据。效果是否真的出现，应使用 `visual.effects`（效果链）或显式 `visual.probes`（生成器参数）作像素比较。

## API 7：图层效果链与 henji-effects

新源码使用作者接口 7，`henji-effects` 随代码版本冻结（新源码锁定 1.2.0）。API 4–6 保留原行为，不自动升级。支持 `glow`、`blur`（`mode` 选 uniform 均匀 / directional 方向 / radial 放射 / lens 镜头）、`chromaticAberration`、`colorGrade`、`sharpen`、`blackWhite`、`mosaic` 和 `look`。工厂仅返回描述，不执行 GPU。参数、默认值、硬范围、单位和动画说明来自同一内置登记表及冻结声明；未知字段、NaN、Infinity、越界值会报错，不自动夹值。

`effects(t)` 每个可见层在中心作者时间求值一次，时间与 draw 相同；位姿仍按曝光采样。即使 draw 的 cacheKey 恒定，effects 仍逐帧求值。静态无 pose 的效果层也独立栅格；尽量给 bounds（内容在作者坐标中的矩形），省略时按完整作者画幅。宿主根据整链支撑外扩，不需要把光晕手工塞进 bounds。效果先于位姿变换、opacity、clip 和运动曝光；效果本身不多次曝光。

空间量按完整作者画幅高度计算，不按小 bounds 或外扩后的纹理高度。blur 的 `amount`（模糊度）四种方式共用：40 约为画面高度 1% 的背景虚化，常用 0–100、可以写得更大；方向用 `angle`，放射用内容范围中的 `center_x/center_y` 百分比，镜头用 `highlights` 控制光斑亮度。不要把 Canvas 像素直接填进模糊度。pose.blur 保留原画面像素语义，最终使用 GPU 虚化，含 `blurShape: "lens"`。

主图像按数组顺序处理；glow 产生的光保留产生时的状态，后续显式效果不改它。因此 `[blur(), glow()]` 先模糊后发光，`[glow(), blur()]` 只模糊主体；最终 pose.blur 同时处理主体与光，并使用固定质量规划。主体与光先在透明层内合成普通预乘 RGBA，再统一施加位姿、裁剪、不透明度和曝光权重。glow.blend 只控制本层主体的核心提亮；下方画面上的光总是相加。source_opacity=0 留纯光，pose.opacity=0 连光一起隐藏。

API 7 本帧实际产生发光 underlay 时，光以预乘 RGBA 的零 alpha RGB 传过片段和嵌套边界；其他画面沿用 RGB≤alpha 钳制。**限制：发光“相加照亮下方”只在代码片段直接合成到下方时成立。片段上的任何效果、任何转场（包括内置擦除、交叉溶解及 gl-transitions）都会产出普通画面，零 alpha 光会被截掉，因此效果期间光晕消失，转场首尾可能跳变。需要调光色时在作者 effects 内调参数／调发光前的内容。透明文件仍是普通预乘 RGBA，背景相关相加须有背景。**

`look("风格件名", { 旋钮键: 数值 })` 用 `henji-effects@1.2.0`。先查当前序列绑定的工程风格副本 `video_edit.project_style.effect_presets`，同名覆盖全局 `video_edit.effect_preset`。读取说明、用途、knobs 的范围和默认值再写；省略旋钮取默认值，未知键、非数值、越界直接报错。映射先求原曲线，再覆盖目标效果实例的参数；两点为线性、多点为分段线性。enabled、amount 和未映射参数的曲线照常生效。

风格件可包含多个内置效果；声音、代码效果、蒙版或只能用于片段的效果不能放进作者图层。缺失和同级重名报错。工程风格件随风格包分享；全局件跨机器另行导入。离屏任务固定启动快照，预览跟随全局库更新。新建或修改前展示具体定义，请用户确认一次；全局写 `video_edit.effect_preset.definition`，归属风格写 `video_edit.style.effect_presets`，导入风格后按原有绑定／升级路径更新工程副本。

```ts
import { glow, blur } from "henji-effects"
export default {
  name: "局部光点", width: 1920, height: 1080, durationSeconds: 4,
  layers(_params, width, height) {
    return [{ id: "light", bounds: [width / 2 - 30, height / 2 - 30, width / 2 + 30, height / 2 + 30],
      effects: t => [blur({ amount: 12 }), glow({ strength: 25 + 10 * Math.sin(t), radius: 30 })],
      draw(ctx) { ctx.fillStyle = "white"; ctx.beginPath(); ctx.arc(width / 2, height / 2, 25, 0, Math.PI * 2); ctx.fill() }
    }]
  }
}
```
