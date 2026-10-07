# 作者语言 v3：文字与动效

基础语法、图形树与预算见 author-api；字体先查 font 实体（type.md）。量字与画面使用相同文本、字体、排版字段。

## text 与 measureText

text({...}) 必须有 x/y/text/fontSize；纯色用 color，渐变用 fill；stroke/strokeWidth 支持渐变描边。公共变换、阴影、辉光、模糊见 author-api。

| 字段 | 默认与语义 |
| --- | --- |
| fontFamily | sans-serif；允许查到的家族/精确样式名 |
| fontWeight / fontStyle | 400 / normal；字重 1–1000；normal/italic/oblique |
| align | left；left/center/right 决定 x 对齐哪一边 |
| baseline | middle；top/middle/bottom/alphabetic 决定 y 基线 |
| letterSpacing | 0 像素，可负；不能导致排版宽度为负 |
| lineHeight | 1.2，字号倍数，范围 0.1–10 |
| maxWidth | 0 不限；非零约束排版宽度，最多 8192 |
| wrap | 省略且 maxWidth 非零时 true，否则 false |
| maxLines | 0 不限；1–4096 整数；超限缩字号，最低 1px |

中文逐字断行，英文优先整词，长词可拆字，行尾空白移除。不要横向压扁；先换行、减密度或延长阅读。maxLines 缩字可能损害小屏可读性，须取帧检查。

```text
measureText({text,fontFamily,fontWeight,fontStyle,fontSize,
  letterSpacing,lineHeight,maxWidth,wrap,maxLines})
// 作者可读 width、height、lines
```

默认值与 text 一致，量字和绘制共用布局。底板宽度用量字加左右留白；宿主负责真实字体度量，作者不能提供 Canvas、DOM 或测量器。缺字体回退并报告；回退量字不等于目标字体量字。

## 逐字错峰

perChar: (i,n) => ({x,y,opacity,scale,rotation})：i 为零基字符索引，n 为数量；仅允许这五字段，默认 0/0/1/1/0。scale ≥0，opacity 0–1，rotation 为度。仍是封闭纯表达式，不赋值或访问宿主。按 Unicode 码点拆分，复杂连字不保证逐字 shaping，要看实际帧。

```ts
export default {
  apiVersion: 1, languageVersion: 3, name: "逐字排版验证",
  kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  durationSeconds: 4, seed: 42, parameters: {},
  render(ctx) {
    const title = "让信息有呼吸";
    const box = measureText({text: title, fontSize: 96, fontWeight: 600});
    return [text({id: "title", x: (ctx.width - box.width) / 2, y: 540,
      text: title, fontSize: 96, fontWeight: 600, baseline: "middle",
      color: [.92, .95, .96, 1],
      perChar: (i, n) => ({
        y: tween(ctx.time, stagger(i, .045), .55, 36, 0, "expoOut"),
        opacity: progress(ctx.time, stagger(i, .045), .3),
        scale: 1, rotation: 0
      })})];
  }
}
```

逐字按 maxLength/可证明上界预算，不只按默认字数；给合理文本容量，长内容分段，不为省预算截断原文。chars(text) 返回 Unicode 码点数组，words(text) 按空白拆词，不是中文分词。

## 动效函数

| 签名 | 语义 |
| --- | --- |
| progress(t,start,duration) | 夹到 0–1；duration >0 |
| tween(t,start,duration,from,to,ease) | 数字/RGBA 插值，ease 为缓动名 |
| stagger(i,each) | i×each，通常作开始时间 |
| keyframes(t,[[time,value,ease],...]) | 数字关键帧；时间严格递增，左行 ease 管下一段，默认 linear |
| mix(a,b,t) | 数字/RGBA 插值，允许过冲；最终颜色显式 clamp |
| cubicBezier(x1,y1,x2,y2,t) | 固定步数反解，x 控制点在 0–1 |
| noise(x,y?,z?) | seed 驱动的 0–1 value noise，省略坐标为 0 |
| random(index) | seed 与无符号 32 位整数索引决定，随机寻帧可重复 |

缓动既能直接调用 expoOut(t)，也能给 tween/keyframes 名称：linear；sine/quad/cubic/quart/quint/expo/circ 各有 In、Out、InOut；另有 backOut/elasticOut/bounceOut。例如 sineInOut、quadOut。直接 backOut(t,overshoot?) 默认 1.70158，GPU 要求 overshoot 0–10。

进场之后留阅读停留，退场在片段结束前完成；核对 source_in_us、变速和接缝。函数 keyframes 是源码表达式，实例 code_curves 是可编辑参数轨道，不是同一存储。static 不读时间，但宿主可以把曲线求值结果作为参数传入。

滤镜 tween/keyframes 拒绝过冲缓动；可用直接缓动函数、mix、显式 clamp，仍须通过 GPU 范围证明。CPU 双精度与 GPU f32 语义一致，不承诺逐位相同。

## 数学、数字与色彩

数学：sin/cos/abs/floor/ceil/round、min(a,b)/max(a,b)、clamp(x,min,max)、smoothstep(edge0,edge1,x)。smoothstep 边界递增，clamp 支持数字/RGBA。不支持字符串 + 拼接、数字转字符串、toFixed/toLocaleString 等方法。数字滚动用 round 得到数值，再用 chars("0123456789")、十进制位权表和 repeat 绘制各位字形（见 examples）；静态前缀/单位另画 text，不伪造转换函数。

rgba(r,g,b,a) 构造四通道；luma(color) 为 Rec.709 亮度；contrast(color,amount) 以 0.5 为中心调 RGB；saturate(color,amount) 按亮度调饱和度，后二者夹到 0–1。hsv(h,s,v,a?)/hsl(h,s,l,a?)：h 为周数，s/v/l 在 0–1，alpha 默认 1；toHsv/toHsl 返回 [h,s,v或l,a]，转换结果不能直接当 RGB 绘制。

主色、描边、辉光分别负责可读、分离、质感，不能靠全部提亮解决层级。完成后 observe_video_edit_frame + read_application_media 看真实像素；编译/求值测试证明契约，不能证明字体形状、辉光观感或运动品味。
