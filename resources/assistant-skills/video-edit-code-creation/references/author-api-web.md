# 网页画面

图片参数可绑定本地网页；其余图片、视频与音频输入见 [author-api-media](author-api-media.md)。

图片参数可绑定本地网页：浏览器在隔离的离屏页面里真正排版绘制（HTML、CSS、JS、React 都行），按页面时间出这一刻的画面，与视频参数一样从 `assets` / `inputs.images` 取。

**什么时候用**：默认用显卡画法——普通标题、花字、字幕式文字、简单表格、数据卡用内置排版库算位置、显卡直接画，没有额外进程，推近按矢量重画始终清楚，每个字都能做特效。网页画面只用在显卡画法做不好或做不像的地方：复刻真实网页应用界面、依赖大量 CSS 的富排版、本来就是网页的内容。它每个来源多开一个隔离页面，每帧 seek、排版绘制再交给合成，成本明显更高。

**网页文件夹**是专门放这个网页的文件夹，入口是其中的 `index.html`，放项目里（如 `素材/网页/知多少/`，构建好的静态文件）；零散的 html 文件不行。文件夹就是站点根，移动、复制、收集素材和打包都整个带上，页面只能取到这里的文件，别的网址照常联网，拿不到痕迹的任何接口；文件改了打开着的页面自动重新载入。页面实现时间约定，确定性由页面负责（CSS 动画、过渡在 seek 里 `pause()` 后设 `currentTime`，不滚动整个文档）；画面只由 seek 的时间决定，不靠 localStorage、IndexedDB、Cookie 这类存储——同一网页文件夹的页面共用存储，关掉重开、别的剪辑用它时都还在：

```text
window.henjiWeb = { ready /* Promise：资源字体就绪 */, duration /* 秒 */,
  async seek(t) {} /* 摆成第 t 秒，可任意前后跳 */, boxes(selectors) {} /* 可选：{选择器: [x,y,w,h]|null} */ }
```

**舞台**：把全部内容放进一个标有 `data-henji-stage` 的根元素，左上角固定在视口 (0,0)、大小等于视口（如 `position:absolute;left:0;top:0;width:1920px;height:1080px`）；背景画在舞台上，动态新增内容也挂在舞台里。宿主从舞台快照直接出图，取帧快好几倍、跳远不出黑块；普通浏览器里照常显示。不标舞台时宿主会自动搬入快照舞台，显式标舞台更稳。跨源图片与跨源 iframe 不进入快照，同源 iframe 可用。
取帧时宿主会把舞台搬进自己的画布：舞台元素本身不要替换或移除；不要用依赖舞台父元素的选择器（如 `body > main`）或可能取到宿主画布的 `document.querySelector('canvas')`；弹层、portal 等动态内容也挂在舞台里，舞台之外不要有会变化的可见内容。

**绑定值**（参数照常声明 `type: "image"`，用通用实体工具写片段代码参数）：

```text
{ kind: "web", path: "<项目>/素材/网页/知多少/index.html",  // 网页文件夹或其中的 index.html
  width: 1920, height: 1080,       // 视口 CSS 像素，默认 1920×1080
  region: [640, 360, 640, 360],    // 只渲染这一块，默认整个视口
  scale: 6,                        // 每 CSS 像素几个画面像素，默认 2
  spans: [{ from: 0, to: 4, src: 0 }],  // 页面时间，time / spans 同视频参数；都不给随片段时间
  boxes: ["#send"],                // 每帧读矩形的选择器
  layer: { only: ["#title"] } }    // 按文字拆层，见下面“逐字特效”
```

**清晰度**：画面是 region 宽高 × scale（取整数），每边最多 8192；页面始终按整个视口排版，取景只决定画哪块。不推近时 scale = 输出宽 ÷ 视口宽；推近 N 倍时 region 取露出的 1/N、scale = 输出宽 ÷ region 宽（4K 推近 3 倍：640×360、6 倍），每个输出像素都有设备像素，成本按画面像素算、推多近不涨。一段推近里取景与倍率不变（变了会重新栅格、文字抖）；幅度很大就分远景、近景两个参数各用 spans，交接处叠化。

**元素矩形**：`info.web[key]` 是 `{ time, width, height, region, scale, duration, boxes }`，`boxes[选择器]` 为视口 CSS 像素 `[x, y, w, h]` 或 null，换到画面像素 `(x - region[0]) * scale`：

```text
draw(ctx, time, params, width, height, assets, info) {
  if (!assets.app) return
  ctx.drawImage(assets.app, 0, 0, width, height)
  const web = info.web?.app, box = web?.boxes["#send"]
  if (!box) return
  const sx = width / web.region[2], sy = height / web.region[3]
  ctx.strokeRect((box[0] - web.region[0]) * sx, (box[1] - web.region[1]) * sy, box[2] * sx, box[3] * sy)
}
```

页面打不开、没有 `window.henjiWeb`、seek 超过 30 秒或取不到画面时这一帧报错，不会换成旧画面。


**网页文本几何（作者接口 12 起）**：在模块上声明 `webText: { app: ["#title"] }`（键是 `type:"image"` 的参数名）。绑定网页时，四种作者入口共用 `info.web.app.text["#title"]`；换成普通图片或未绑定时不采样。逐字效果只选需要的元素，500 字素实时采样 P95 预算 25ms；整页 5000 字素成本显著更高，不能按每帧实时使用。

结果先看 `status`：`ready` 才读 `geometry`；其余为 `not-found`、`unsupported` 或带原因的 `unavailable`。`geometry.text` 是 DOM 原文，`graphemes` / `words` 的 `source` 是半开 UTF-16 区间，字素含 `rects`、`bounds`、盒中心 `pivot`；字体是 CSS 声明，`lineFragments` 是文字 run 的行片段。坐标均为视口 CSS 像素；换到实际纹理用 `web.imageMapping.viewportToImage`，不要再乘 DPR。几何随同一票据画面交付；预览回退时只读返回的同幅几何，不把请求时刻当作返回画面时刻。

Range 返回排版盒，`baseline:null`，不提供字形墨迹和真实基线。Canvas、SVG text、表单、伪元素、iframe 和 Shadow DOM 内文字不在自动采样范围。

文本几何要求网页提供 `[data-henji-stage]` 舞台：舞台 CSS 尺寸等于视口、原点为 `(0,0)`，根上没有 transform、padding 或 border。`henjiWeb.seek(t)` 完成后须把动画定位并暂停，直到下次 seek 不自主改布局；paint 监听器不得改 DOM。字体须加载成功，所选文字子树与祖先不能仍在播放动画或滚动。缺舞台或快照不可用时返回 `unavailable/capture-path`；布局、字体、滚动或动画不稳定返回 `unavailable/unsynchronized`，`details` 记录具体原因。

**逐字特效**：要让网页里每个字单独动（位移、缩放、旋转、淡入、打字机、变色、沿路径走都一样），把同一个网页绑定成两层，再按 `cells` 切文字层。字形和排版都是浏览器的结果，不用重新排版。

- 绑定值加 `layer`：`{ only: [选择器] }` 只留这些元素的文字，背景透明；`{ hide: [选择器] }` 只藏它们的文字，其余原样，字移开后露出的就是这层。两层用同一份 `path`、`width`、`height`、`region`、`scale`、时间。
- `geometry.cells` 与 `graphemes` 一一对应，是画面像素整数 `[x, y, w, h]`，互不重叠地铺满文字；所有字不动时拼出来与网页原画面一致（页面文字自带的发光和阴影除外，见下）。竖排或没有位置的字素为 null。同一个参数声明的所有选择器一起算，不会互相切到。

每个字写成一个图层：用 `pose` 动，运动模糊、点选和 `effects` 都是现成的。发光、模糊、描边用 `henji-effects`，不要在网页里写 `text-shadow`，拆层时宿主会把页面文字自带的发光和阴影去掉（留着会被格子切开）。

```text
import { glow } from "henji-effects"
const clamp = value => Math.min(1, Math.max(0, value))
export default {
  name: "网页逐字", kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  webText: { text: ["#title"] },
  params: [{ key: "clean", type: "image", title: "干净背景" }, { key: "text", type: "image", title: "文字层" }],
  layers(params, width, height, assets, info) {
    const layers = []
    if (assets.clean) layers.push({ id: "背景", bounds: [0, 0, width, height], draw(ctx) { ctx.drawImage(assets.clean, 0, 0, width, height) } })
    if (!assets.text) return layers
    const web = info.web?.text, result = web?.text?.["#title"]
    // 预览回退到上一幅时位置可能还没到（pending-picture）：这一帧把文字层整张画上，不留空，也不要抛错
    if (result?.status !== "ready") { layers.push({ id: "文字", bounds: [0, 0, width, height], draw(ctx) { ctx.drawImage(assets.text, 0, 0, width, height) } }); return layers }
    // 格子是文字层的画面像素，画面大小随 scale 和监视器显示档变化，一律换算到画布
    const kx = width / web.imageMapping.contentWidth, ky = height / web.imageMapping.contentHeight
    result.geometry.cells.forEach((cell, index) => {
      if (!cell) return
      const [x, y, w, h] = cell
      layers.push({
        id: "字" + index, bounds: [x * kx, y * ky, (x + w) * kx, (y + h) * ky],
        draw(ctx) { ctx.drawImage(assets.text, x, y, w, h, x * kx, y * ky, w * kx, h * ky) },
        // 这里决定每个字怎么动，下面是逐字错峰上浮淡入
        pose: t => { const p = clamp(t * 2 - index * .08); return { x: 0, y: (1 - p) * 60, opacity: p } },
        effects: () => [glow({ strength: 20, radius: 26 })],
      })
    })
    return layers
  },
}
// 片段参数：clean: { kind: "web", path, layer: { hide: ["#title"] } }，text: { kind: "web", path, layer: { only: ["#title"] } }
```

旋转、缩放绕字的中心转。`pose` 绕画布原点变换，格子的中心也不一定是字的中心，所以用 `graphemes[index].pivot`（视口 CSS 像素）算出中心 `cx, cy` 再补偿：

```text
const [a, , , d, e, f] = web.imageMapping.viewportToImage, pivot = result.geometry.graphemes[index].pivot
const cx = (pivot[0] * a + e) * kx, cy = (pivot[1] * d + f) * ky
// 旋转 r、缩放 s：
pose = { rotation: r, scale: s, x: cx - s * (cx * Math.cos(r) - cy * Math.sin(r)), y: cy - s * (cx * Math.sin(r) + cy * Math.cos(r)) }
```

- 成本：每层各开一个页面，不进页面时间缓存，只走实时取帧。一段文字逐字动时只选需要的元素。
- 文字背后如果是这个元素自己的背景（按钮底色），`only` 不带这块底色，`hide` 会保留它。
- 每个选择器只能命中一个元素，一组字用多个选择器分别写；选择器不要嵌套。载入时命中多个或写错会报错。页面 seek 之后才变成多个的情况查不出来，其余的字会没有格子。
- `background-clip: text` 的渐变字拆不开，底色就是字，文字层里没有它。图片、SVG、伪元素不算文字，两层都会留下。要逐字动的文字写成普通 `color`。
- 不需要字分开时用不到这些：对整块文字做效果直接处理网页画面，只高亮某个字用 `geometry.graphemes` 的位置就够。

`breaks` 每项为 `{offset, kind}`，offset 是原文 UTF-16 位置，kind 分别为 `line-break`（BR）、`block`、`language`、`replaced-element`。`layoutStatus` 区分普通盒、零宽、折叠空白、display:none、visibility:hidden 与 content-visibility:hidden；零宽保留位置盒，隐藏文本保留来源。`transparent` 表示贡献布局片段的来源全部透明，`outsideRegion` 表示布局片段全部在取景外；`regionRects` 是与取景的矩形交集。`rendered` 只表示有非透明且落入取景的正宽布局片段，不证明最终墨迹可见（遮挡、mask 等仍不由 Range 判断）。
