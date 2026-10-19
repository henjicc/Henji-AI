# 作者语言 v3：音频与画面输入

## 内容音频（v3）

生成器和滤镜均支持以下只读接口；滤镜在 CPU 每帧求值后通过 uniform 传入，不逐像素分析声音。

- `ctx.audio.level(t?)`：当前帧 RMS，按数字满幅夹取到 0–1。`t` 为相对当前片段本地时间的秒数，省略为 0；负数回看，正数预读。分析区间外返回 0。
- `ctx.audio.band(name,t?)`：频段 RMS，0–1；`name` 为字面量 `"bass"`（0–250Hz）、`"mid"`（250–4000Hz）或 `"treble"`（4000Hz 至 Nyquist）。声道分别计算能量，再求均值。
- `ctx.audio.beats`、`ctx.audio.onsets`：只读升序秒数数组，基准为分析区间起点。可用 `.length` 和索引读取。
- `ctx.audio.bpm`：检测 BPM；没有稳定节拍为 0。
- `ctx.audio.beatPhase(t?)`：相邻检测节拍之间的 0–1 进度；拍点重置为 0。末拍后最多外推一拍，再返回 0。
- `ctx.audio.barPhase(t?)`：以最强检测拍为起点的四拍分组相位。这是估计分组，未识别真实拍号或强拍位置。

默认分析本片段区间内、轨道编号更低的序列混音，使用原混音器的静音/独奏、音量、变速、效果与过渡。指定音源可声明 `music:{type:"audio",title:"声音",default:null}`，由参数控件或通用属性绑定 `{kind:"audio",mediaId:"工程内音频或视频素材ID"}`。使用声明顺序中第一个已绑定的 audio 参数；全部为空时使用默认混音。指定素材按源时间 0 开始分析，读取时间随代码片段本地时间。未绑定任何有声音的来源时返回 0 和空数组。

分析在 Worker 中离线执行，分块读取已有解码器的 PCM；按媒体内容版本、混音配置及区间缓存，不依赖播放顺序。修改来源后重新分析。长任务失败与取消不会发布半份结果。助手可调用 `analyze_video_edit_beats`（`documentRef`、`sequenceRef`、`mediaRef`）分析原素材，再通过 `video_edit.media.audio_analysis` 读取 BPM、节拍与起音；未分析返回 null。`video_edit.document.audio_analysis_progress` 为运行中进度。

最短生成器：

```ts
export default {apiVersion:1,languageVersion:3,name:"音频响度",kind:"generator",mode:"dynamic",width:1920,height:1080,durationSeconds:10,seed:1,parameters:{},render(ctx){
  const level = ctx.audio.level();
  return [ellipse({x:100,y:100,width:40+level*120,height:40+level*120,fill:[1,1,1,1]})];
}}
```

最短滤镜：

```ts
export default {apiVersion:1,languageVersion:3,name:"音频滤镜",kind:"filter",mode:"dynamic",width:1920,height:1080,durationSeconds:10,seed:1,parameters:{},render(ctx){
  return mix(sample(ctx.u,ctx.v),[1,1,1,1],ctx.audio.level()*.2);
}}
```

## 视频与下方画面 image 参数（v3）

声明仍为 `picture:{type:"image",title:"输入画面",default:null}`，`image({source:ctx.params.picture,x:0,y:0,width:ctx.width,height:ctx.height})` 消费该画面。

参数值支持 `{kind:"image",mediaId}`、`{kind:"video",mediaId,time?:number}`、`{kind:"sequence",mediaId:"below"}`。视频 `time` 是源素材非负秒数；省略时随片段本地时间，不经过代码片段的源速度换算。超出视频范围明确失败。`below` 在当前序列帧合成更低轨道的画面，排除当前轨道与更高轨道、字幕覆盖，避免循环。代码没有路径或 URL 访问权；所有输入走工程媒体引用、正式解码与合成。同一来源与取样时刻复用正式GPU画面，重复参数不额外回读或上传；下层画面随当前作品修改失效，输入移除或关闭时释放，画面留白保持原输入画布黑底。输入可保留高精度纹理，但代码生成器的输出精度仍由现有渲染契约决定，不据此承诺完整HDR处理。
