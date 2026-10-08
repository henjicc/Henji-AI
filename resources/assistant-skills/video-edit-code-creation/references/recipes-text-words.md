# 逐词关键词卡：拆词、分拍与量字

words(text)按空白分词；中文写成“看见 关系 理解 变化”才有四个词，不是自动中文语义分词。原文不能因分词而改变，普通句子优先recipes-text的整句perChar；明确关键词／英文词组才用此配方。

完整样例一拍四张关键词卡、阅读顺序错峰，后续词按拍继续显示。四张是构图选择，不是产品数量限制；输入更多就继续分拍，扩参数容量时同时按实际词数延长源时长与片段，不能把未展示内容截掉。最慢展示每拍6秒，当前80字符声明在空白拆词最坏约40词、10拍以内，60秒源时长能容纳；实际成片按ceil(词数/4)×每拍秒数裁出，并核对源时间。

卡片用measureText量完整词、不量当前显字；空词组整组隐藏。词越长卡片越高，若超过安全高度则改版式／字号，不横向压扁或让maxLines偷偷缩小。这里是词卡揭示，不是连续句子的自动紧密排版。

```ts
export default {
  apiVersion: 1, languageVersion: 3, name: "关键词分拍揭示",
  kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  durationSeconds: 60, seed: 3,
  parameters: {
    value: {type: "text", title: "关键词（空格分隔）", default: "看见 关系 理解 变化", maxLength: 80},
    accent: {type: "color", title: "卡片颜色", default: [.12,.32,.4,1]},
    seconds: {type: "number", title: "每拍秒数", default: 3, min: 2, max: 6, step: .1},
    each: {type: "number", title: "词间隔秒", default: .1, min: 0, max: .2, step: .01}
  },
  render(ctx) {
    const tokens = words(ctx.params.value);
    const n = tokens.length;
    const page = min(floor(ctx.time / ctx.params.seconds), max(0, ceil(n / 4) - 1));
    const local = ctx.time - page * ctx.params.seconds;
    const width = ctx.width * .2;
    const tile = (i) => {
      const index = min(page * 4 + i, max(0, n - 1));
      const word = n > 0 ? tokens[index] : "";
      const box = measureText({text: word, fontSize: 54, maxWidth: width - 48, wrap: true});
      return group({id: "wordCard", x: ctx.width * .07 + i * ctx.width * .22,
        y: ctx.height * .45 + tween(local, .15 + stagger(i, ctx.params.each), .5, 32, 0, "quartOut"),
        opacity: page * 4 + i < n ? progress(local, .15 + stagger(i, ctx.params.each), .25) : 0}, [
        rect({id: "plate", x: 0, y: 0, width: width, height: box.height + 48,
          radius: 24, fill: ctx.params.accent}),
        text({id: "word", x: 24, y: 24, text: word, fontSize: 54,
          baseline: "top", maxWidth: width - 48, wrap: true, color: ctx.style.palette.fg})
      ]);
    };
    return repeat(4, i => tile(i));
  }
}
```

word卡只负责图形，真实词级配音时刻须另外读到并驱动时间；固定每拍时长不等于对齐语音。检查每拍第一个、中间错峰、最后必要词落定和切拍两侧；大标题与字幕区域仍保持一个焦点。
