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

参数值支持 `{kind:"image",mediaId}`、`{kind:"video",mediaId,time?:number,spans?:[...]}`、`{kind:"sequence",mediaId:"below"}`。视频 `time` 是源素材非负秒数，省略时从片段入点起随片段本地时间（裁掉开头时视频也跟着往后，不经过代码片段的变速与倒放换算）；超出视频范围明确失败。`below` 是当前序列帧中更低轨道的合成画面，排除当前及更高轨道与字幕覆盖，避免循环。代码没有路径或 URL 访问权，所有输入走工程媒体引用、正式解码与合成；同一来源与取样时刻复用同一画面。需要逐像素处理下方画面时写滤镜（author-shaders）。

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
