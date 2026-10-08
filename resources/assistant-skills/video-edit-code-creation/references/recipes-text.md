# 文字配方：揭示、遮罩与排版

先读 type 查已安装字体，author-text-motion 查接口，templates 查换字自适应。终端光标和数字见 recipes-text-data；每帧从时间直接求画面，不累计打字状态。

## 逐字／逐词揭示

- 普通标题用perChar：(i,n)给每字y/opacity/scale/rotation，不能写blur、颜色或fontSize。逐字间隔1–2帧，位移约0.3–0.6字号，透明度比位移先完成；定版后停止。
- 用stagger(i,each)得开始时刻，progress得可见进度、tween的expoOut求位移。错峰跨度为(n−1)×each；建议≤0.6秒，长标题分拍或压缩间隔，不删字。
- chars按Unicode码点，不能保证复杂连字／组合字形的逐字shaping。words按空白拆词，不是中文分词；中文关键词先按语义明确分段，每段作为独立text参数／文字对象。
- 逐词排连续短语时按measureText的完整段宽度摆各段并留间隔；多个词横向排不下则按语义换行。别拿单词长度×字号估计；不能在受限源码里使用split/reduce/join/字符串拼接。
- words适合有明确空白边界的卡片式词组：数组长度读.length，repeat上界必须常量或有整数范围的参数，索引先确保非空且在范围内；内容更多时分页／分拍，不能截断剩余词。密排多词的累积宽度若表达过重，拆为语义段参数或项目组件，不伪造通用字符串方法。
- 随配音揭示必须有真实词级时刻；按时刻表或实例曲线求进度。按字数比例推算只叫近似，不能称逐词识别。

## 从一条线后升起

遮挡窗口保持不动，文字从它的下边缘以下约1.4字高升到最终位置；group.clip是局部固定矩形，文字在children里移动。底板／线也可随同一进度出现。不要移动整个裁切组来假装窗口静止；字体变长要重测窗口，否则末尾被裁。

完整样例把词句作为一个文本参数，measureText以完整文案量行框；同字段绘制，多行也能裁切。文字从窗口下缘升起，再逐字错峰。颜色、字号、字体、节奏可改；只从进场到停留，退出按实例曲线或新增节奏参数处理。

```ts
export default {
  apiVersion: 1, languageVersion: 3, name: "线后文字揭示",
  kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  durationSeconds: 5, seed: 2,
  parameters: {
    title: {type: "text", title: "揭示文字", default: "让灵感浮出画面", maxLength: 80},
    font: {type: "font", title: "字体", default: "sans-serif"},
    size: {type: "number", title: "字号", default: 96, min: 32, max: 180, step: 1},
    ink: {type: "color", title: "文字与线颜色", default: [.9,.95,.98,1]},
    enter: {type: "number", title: "升起秒数", default: .65, min: .3, max: 1.2, step: .05},
    each: {type: "number", title: "字符间隔秒", default: .045, min: 0, max: .12, step: .005}
  },
  render(ctx) {
    const s = ctx.params.size;
    const box = measureText({text: ctx.params.title, fontFamily: ctx.params.font,
      fontSize: s, fontWeight: 700, maxWidth: ctx.width * .84, wrap: true, lineHeight: 1.2});
    const each = min(ctx.params.each, .6 / max(1, chars(ctx.params.title).length - 1));
    return [group({id: "window", x: ctx.width * .08, y: (ctx.height - box.height) / 2,
      opacity: ctx.params.title === "" ? 0 : 1,
      clip: {x: 0, y: 0, width: max(1, box.width + s * .1), height: box.height}}, [
      text({id: "title", x: 0, y: 0, text: ctx.params.title,
        fontFamily: ctx.params.font, fontSize: s, fontWeight: 700,
        baseline: "top", maxWidth: ctx.width * .84, wrap: true, lineHeight: 1.2,
        color: ctx.params.ink,
        perChar: (i,n) => ({
          y: tween(ctx.time, .15 + stagger(i, each), ctx.params.enter, box.height + s * .4, 0, "expoOut"),
          opacity: progress(ctx.time, .15 + stagger(i, each), ctx.params.enter * .5)
        })}),
      line({id: "edge", x1: 0, y1: box.height - 2, x2: max(1, box.width), y2: box.height - 2,
        width: 2, color: ctx.params.ink, trimEnd: progress(ctx.time, .1, ctx.params.enter)})
    ])];
  }
}
```

## 对齐、字距、行距

text的align决定x锚左／中／右；baseline决定y锚top/middle/bottom/alphabetic。绕中心变换用稳定量字框设group的anchorX/Y，不按可见字数移动锚点。

作者letterSpacing是像素，取字号×em建议；lineHeight是字号倍数。标题行距1.05–1.2、正文1.4–1.6；大标题字距−.01～−.03em，大写标签+.05～+.15em，中文正文0～+.02em。字幕实体tracking是千分之一em、leading是1080p参考像素，不能把作者字段单位照搬。

换字／字体后测完整布局，检查孤字、下伸字母、边缘裁切、遮罩内逐字过冲。遮罩先全帧看关系再按标注放大，不能只凭量字数值验收。
