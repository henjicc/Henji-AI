# 作者语言 v3：文字与动效

基础语法、图形树与预算见 author-api；字体先查 font 实体（type.md）。量字与画面使用相同文本、字体、排版字段。

## 分组运动曝光（API2/3）

`group` 可给 `motionBlur:{enabled:true,shutter:180,phase:-90,maxSamples:64}`。省略整个字段保持普通合成；`enabled:false` 或 `shutter:0` 关闭。快门角度 0–720 度，默认相位为负半快门，曝光范围须在中心前后两帧内；角度按微度精度处理。

宿主只在子时刻重算组的 x/y、旋转、缩放、倾斜、锚点和透明度，内容、视频输入、着色器及空间模糊保持帧中心结果；组内再有运动组时先完成内组曝光，再作为外组内容，属于分层合成。源时钟、参数曲线和元素覆盖随变速/倒放换算，声音按局部播放时钟取样。位姿求值中的 ctx.frame 可以为小数，需要整帧随机索引时显式 floor。

片段边界截断曝光后归一，超出真实源或动态声明时长的样本透明；关闭不会补出不存在的源帧。单层 1–64 样本，按路径自适应，整帧共用位姿及像素采样预算，超额明确拒绝。观察和元素编辑仍使用帧中心结构；最终拖影要取成片画面检查。

## 分层镜头散焦（API3）

`group({blurShape:"lens",blur:12},children)`：blur 为作者画幅内的弥散圆半径，0–256，0保持清晰；默认或 `blurShape:"gaussian"` 保留原有柔化。圆盘散焦区别于普通雾化，适合焦外光斑。对一组的文字、图片、视频及嵌套内容整体处理，之后应用蒙版/裁剪和运动曝光，半径冻结在帧中心。

焦点转移复用普通参数与曲线，例如给前/后景分别设 `blur:abs(ctx.params.focus-0)*24` 和 `blur:abs(ctx.params.focus-1)*24`，focus 从0到1。这是分层二维近似，不推断视频内部深度或物体遮挡；需要真实三维景深时使用三维画面来源。

透明色按预乘RGBA卷积，保留透明边缘；图形有可扩散留边，明确 clip 仍裁掉范围外的散焦。大半径按采样间距连续降采样，纹理复用现有分组缓存，尺寸变化释放旧存储；整帧采样与常驻资源都有预算，超额会明确拒绝。散焦不自动增加亮度；完成后取清晰/焦外及焦点交换帧检查实际像素。

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

perChar: (i,n) => ({x,y,opacity,scale,rotation,skewX,fill,blur,glow})：i 为零基字符索引，n 为数量；前五字段默认 0/0/1/1/0，skewX 默认 0 度。fill 接受颜色或三种渐变；blur 为 0–256；glow 为 {radius,intensity,color}，范围同图形。省略 fill/blur/glow 时继承 text 设置；每项可依赖 i/n 和帧上下文。例如 `perChar:(i,n)=>({fill:rgba(i/n,0,1,1),blur:i,skewX:15,glow:{radius:4,intensity:1,color:[1,1,1,1]}})`。scale ≥0，opacity 0–1，rotation 为度。仍是封闭纯表达式，不赋值或访问宿主。按 Unicode 码点拆分，复杂连字不保证逐字 shaping，要看实际帧。

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

滤镜 tween 接受过冲缓动，输出通道在片元末端夹取；帧级 keyframes 同样由 CPU 求值，逐像素 keyframes 仍要求无过冲缓动。逐像素计算保留有限范围证明。CPU 双精度与 GPU f32 语义一致，不承诺逐位相同。

## 数学、数字与色彩

数学：sin/cos/abs/floor/ceil/round、min(a,b)/max(a,b)、clamp(x,min,max)、smoothstep(edge0,edge1,x)，以及 sqrt/pow/atan2 等完整数学函数、PI/TAU/E 与 `**`（见 author-api-expressions）。smoothstep 边界递增，clamp 支持数字/RGBA。字符串可用 `+` 拼接、模板插值、formatNumber/formatTime；没有 toFixed/toLocaleString 等方法。数字滚动可直接 `formatNumber(round(v), {thousands: true}) + "%"`；需要每位单独滚动时再用 chars("0123456789")、位权表和 repeat 绘制各位字形（见 examples）。

rgba(r,g,b,a) 构造四通道；luma(color) 为 Rec.709 亮度；contrast(color,amount) 以 0.5 为中心调 RGB；saturate(color,amount) 按亮度调饱和度，后二者夹到 0–1。hsv(h,s,v,a?)/hsl(h,s,l,a?)：h 为周数，s/v/l 在 0–1，alpha 默认 1；toHsv/toHsl 返回 [h,s,v或l,a]，转换结果不能直接当 RGB 绘制。

主色、描边、辉光分别负责可读、分离、质感，不能靠全部提亮解决层级。完成后 observe_video_edit_frame + read_application_media(mode="image") 看真实像素；编译/求值测试证明契约，不能证明字体形状、辉光观感或运动品味。
