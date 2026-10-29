# 音频与画面输入

## 内容音频

声明 audio 参数或不声明（使用默认混音）时，生成器的 `info.audio` 是宿主离线分析结果，`info.audioTime` 是当前帧在分析区间内的秒数：

| 字段 | 含义 |
| --- | --- |
| `fps` / `duration` | 分析帧率与时长（秒） |
| `levels[]` | 每分析帧 RMS，0–1 |
| `bands.bass/mid/treble[]` | 0–250Hz、250–4000Hz、4000Hz 至 Nyquist 的频段 RMS，0–1 |
| `beats[]` / `onsets[]` | 升序秒数，基准为分析区间起点 |
| `bpm` | 检测 BPM；没有稳定节拍为 0 |
| `beatsPerBar` / `barOrigin` | 估计的分组与起点，不是真实拍号 |

没有可分析的声音时 `info.audio` 不存在，代码要兜底为静止状态。

```ts
const level = (info, offset = 0) => {
  const audio = info.audio
  if (!audio) return 0
  const index = Math.floor(((info.audioTime ?? info.clip.time) + offset) * audio.fps)
  return index >= 0 && index < audio.levels.length ? audio.levels[index] : 0
}
export default {
  name: "音频响度", kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  params: [{ key: "music", type: "audio", title: "声音" }],
  draw(ctx, time, params, width, height, assets, info) {
    const size = 40 + level(info) * 120
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(160, 160, size / 2, 0, Math.PI * 2); ctx.fill()
  }
}
```

默认分析本片段区间内、轨道编号更低的序列混音，使用原混音器的静音/独奏、音量、变速、效果与过渡。指定音源时声明 `{ key: "music", type: "audio", title: "声音" }`，由参数控件或通用属性绑定 `{kind:"audio",mediaId:"工程内音频或视频素材ID"}`；使用声明顺序中第一个已绑定的 audio 参数。指定素材按源时间 0 开始分析，读取时间随片段本地时间。

分析在 Worker 中离线执行，按媒体内容、混音配置与区间缓存，修改来源后重新分析。助手可调用 `analyze_video_edit_beats`（`documentRef`、`sequenceRef`、`mediaRef`）分析原素材，再通过 `video_edit.media.audio_analysis` 读取 BPM、节拍与起音；未分析返回 null。`video_edit.document.audio_analysis_progress` 为运行中进度。

## 图片、视频与下方画面

声明 `{ key: "picture", type: "image", title: "输入画面" }`，绘制时从 `assets.picture` 取画面（未绑定时不存在）：

```text
draw(ctx, time, params, width, height, assets) {
  if (assets.picture) ctx.drawImage(assets.picture, 0, 0, width, height)
}
```

参数值支持 `{kind:"image",mediaId}`、`{kind:"video",mediaId,time?:number,spans?:[...]}`、`{kind:"sequence",mediaId:"below"}`，以及本地网页 `{kind:"web",path,...}`（见下文“网页画面”）。视频 `time` 是源素材非负秒数，省略时从片段入点起随片段本地时间（裁掉开头时视频也跟着往后，不经过代码片段的变速与倒放换算）；超出视频范围明确失败。`below` 是当前序列帧中更低轨道的合成画面，排除当前及更高轨道与字幕覆盖，避免循环。代码没有路径或 URL 访问权，所有输入走工程媒体引用、正式解码与合成；同一来源与取样时刻复用同一画面。需要逐像素处理下方画面时写滤镜（author-shaders）。

### 视频取帧时间表 spans

一个片段里要让录屏“这段 1 倍速、这里停住、这里跳过一段、这里快放”，给视频参数写 `spans`，不要拆成多个静帧片段（交接处会跳、叠、闪）。每段 `{from, to, src, rate?, cursor?}`：片段时间 `t` 落在 `[from, to)` 时取源素材 `src + (t − from) × rate` 秒（`rate` 缺省 1，`0` 为停住，`4` 为四倍速）；`cursor:false` 时这一段不画录制鼠标与点击涟漪（网页重演录屏打字时鼠标停在输入框上可以关掉）。`t` 与“跟随片段”同一时间轴：片段入点加 `info.clip.time`，片段没裁过开头、没被切开时就是 `info.clip.time`。不落在任何一段的帧这个参数不参与：不解码、不占显存与会话，`assets` / `inputs.images` 里没有这个键，代码按未绑定处理（`if (assets.picture)`）。段按 `from` 升序且不重叠，`from < to`，`src`、`rate` 非负，最多 512 段；`time` 与 `spans` 不能同时给；取帧时间超出素材时长明确失败。

```text
// 0–4 秒正常播，4–6 秒停在源 4 秒且不画鼠标，6–8 秒不显示，8–10 秒从源 20 秒起四倍速快放
{ kind: "video", mediaId: "录屏素材ID", spans: [
  { from: 0, to: 4, src: 0 },
  { from: 4, to: 6, src: 4, rate: 0, cursor: false },
  { from: 8, to: 10, src: 20, rate: 4 },
] }
```

同一片段可以带很多视频参数（如每扇窗口一个），只有落在段内（或三秒内要进入下一段）的参数占解码会话。整个节目同一时刻的视频输入超过 7 路时，多出的改为共用素材的解码会话，画面照常但播放变慢；超过 32 路直接报错。

## 网页画面

图片参数可绑定本地网页：浏览器在隔离的离屏页面里真正排版绘制（HTML、CSS、JS、React 都行），按页面时间出这一刻的画面，与视频参数一样从 `assets` / `inputs.images` 取。

**什么时候用**：默认用显卡画法——普通标题、花字、字幕式文字、简单表格、数据卡用内置排版库算位置、显卡直接画，没有额外进程，推近按矢量重画始终清楚，每个字都能做特效。网页画面只用在显卡画法做不好或做不像的地方：复刻真实网页应用界面、依赖大量 CSS 的富排版、本来就是网页的内容。它每个来源多开一个隔离页面，每帧 seek、排版绘制再交给合成，成本明显更高。

**网页文件夹**是专门放这个网页的文件夹，入口是其中的 `index.html`，放项目里（如 `素材/网页/知多少/`，构建好的静态文件）；零散的 html 文件不行。文件夹就是站点根，移动、复制、收集素材和打包都整个带上，页面只能取到这里的文件，别的网址照常联网，拿不到痕迹的任何接口；文件改了打开着的页面自动重新载入。页面实现时间约定，确定性由页面负责（CSS 动画、过渡在 seek 里 `pause()` 后设 `currentTime`，不滚动整个文档）：

```text
window.henjiWeb = { ready /* Promise：资源字体就绪 */, duration /* 秒 */,
  async seek(t) {} /* 摆成第 t 秒，可任意前后跳 */, boxes(selectors) {} /* 可选：{选择器: [x,y,w,h]|null} */ }
```

**绑定值**（参数照常声明 `type: "image"`，用通用实体工具写片段代码参数）：

```text
{ kind: "web", path: "<项目>/素材/网页/知多少/index.html",  // 网页文件夹或其中的 index.html
  width: 1920, height: 1080,       // 视口 CSS 像素，默认 1920×1080
  region: [640, 360, 640, 360],    // 只渲染这一块，默认整个视口
  scale: 6,                        // 每 CSS 像素几个画面像素，默认 2
  spans: [{ from: 0, to: 4, src: 0 }],  // 页面时间，time / spans 同视频参数；都不给随片段时间
  boxes: ["#send"] }               // 每帧读矩形的选择器
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
