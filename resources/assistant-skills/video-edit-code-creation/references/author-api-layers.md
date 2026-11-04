# 作者接口：图层、元素身份、阴影范围、画面来源与调整层

模块契约见 [author-api](author-api.md)；图层效果链见 [author-api-effects](author-api-effects.md)。

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

`layoutText` 按内容、样式、选项与字体字节复用只读布局，可在 `layers()` 中调用。逐字用一次 `drawText` 的 `graphemes` 回调返回位移与透明度，null 隐藏。整段与逐字绘制共用字素几何；底板和装饰线保持整段，用 `backgroundAndDecorationOpacity` 控制。分层、连写、档位和 flex 内容尺寸、截断、基线规则见 author-text-motion；字体静态声明见 author-text-motion；简单数字表用 `henji-layout/table`，用法见 recipes-text-data。

```ts
import { layoutText, drawText } from "henji-layout/text"
export const textFonts = { bindings: [{ text: "title", style: "titleStyle" }] }
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

## Canvas 阴影的源图形范围

运动层不要把源文字/图形完全画到图层栅格外，再用 `shadowOffsetX/Y` 把影子投回做辉光。这种写法不受支持：即使内容范围推算已计入偏移和模糊，Canvas 栅格裁切仍可能使整条投影消失。请在层内绘制，用 `effects: () => [glow(...)]` 做光晕；或把运动层 bounds 扩大到同时容纳原图形与投影，再通过 layer.clip 限定最终显示范围。静止层按整幅画布栅格，不凭源图形在画布外就报告这一风险。

普通层内阴影继续支持，阴影越界不等于正文丢失。`query_video_edit_review` 的 `motion:{}` 会对运动层可录制的文字、矩形/圆角矩形与图像返回 `shadow_outside_source` 风险和时间；任意 Path2D、直接绘制及 GPU 内部阴影没有这份几何证据。效果是否真的出现，应使用 `visual.effects`（效果链）或显式 `visual.probes`（生成器参数）作像素比较。

## 画面来源 fill（作者接口 v14）

`{ id: 'bg', bounds?, fill: t => gradient({…}), effects?, pose?, clip? }`：不写 draw，宿主在 bounds 里用 GPU 画原生生成器（目前只有渐变 gradient），bounds 不写时铺满画布。暗底上的大面积渐变用它，在高精度里算、不出色带；Canvas2D 的 createLinearGradient 是 8 位栅格，暗部会出色带。gradient 工厂随下一版 henji-effects 提供，在那之前写效果描述对象 `{ id: 'gradient', params: {…} }`。

## 调整层

`{ id: 'grade', adjust: t => [效果描述…], clip?, pose?: t => ({ opacity }) }`：给本模块里在它之前（下层）合成好的全部图层整体加效果，按作者画幅换算；与 draw、fill、effects 互斥。pose 只用 opacity（与原画混合），clip 限定作用范围。暗角、颗粒这类整幅效果只能放在 adjust 或片段效果链里，放进普通图层的 effects 会报错。取帧观察里它是 kind 为 adjust 的元素，没有画面选框，按 id 或源码定位。grain、vignette 工厂随下一版 henji-effects 提供，在那之前直接写效果描述对象。

调整层里的效果按反预乘计算：透明底的零 alpha 光会被去掉（调色、暗角、颗粒都一样）；要处理光，在产生光的图层 effects 里调。有不透明背景时光已叠入背景，不受影响。

## 多文件与元素

- 入口默认 `main.ts`，可用相对导入拆文件，或 `@组件/名称` 导入项目组件，见 multifile-components。
- 图层 id 是元素身份：拖动、缩放、旋转写入 `video_edit.clip.element_overrides`，按 id 保存；改名或删除图层会让旧覆盖失效。改字、改色优先改参数。
- 源码结构变化新增版本再重绑，不要改写已被片段引用的版本。
- 点选可调：人可能想改的元素都给稳定 `id`，同一元素里两个同类效果给 `key`；改代码时保持 id 与 key 不变。
- 画在 draw 里、用户可能想改的视觉属性（颜色、文字与文字样式、字号、粗细、圆角、间距、描边宽度）写成参数，用 `layer` 绑到元素，数据卡用 `data` 绑到行；参数按组写。只有文字绑了参数的元素，复核会给 `UNBOUND_VISUAL` 提示。
- 尺寸由内容算：底板、框、连线的大小用 henji-layout 的文字测量与 `layoutBoxes`，前后元素用布局排，不手算坐标。
- 重写代码前先读片段的 `edits`：用户手动改过的值独立存放在覆盖里，重写不会丢；要改这些值或把覆盖写回代码，先问用户。
