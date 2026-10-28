# 逐词关键词卡：拆词、分拍与量字

配方只示范写法与常见做法，不是推荐风格；配色、时长、幅度按风格说明书或需求改。

关键词用 table 参数逐行声明，比把一句话按空格拆开更可靠：中文不会自动分词，每行一个词，用户可直接增删改行，选中卡片即改对应行。原文不能因分词而改变；普通句子优先 recipes-text 的整句逐字揭示。

样例一拍四张卡片、阅读顺序错峰，后续词按拍继续显示。四张是构图选择，不是数量限制；词更多就继续分拍，并按 ceil(词数/4)×每拍秒数延长片段，不能截掉未展示内容。卡片宽度固定，词由排版库在卡内折行，卡片高度取排版结果；两行仍放不下时 `fit` 缩小字号，超过安全高度时改版式／字号。不要用 `fillText` 的第四个参数限宽，它会横向压扁文字。

```ts
import { layoutText, drawText } from "henji-layout/text"
const clamp01 = v => Math.min(1, Math.max(0, v))
const quartOut = t => 1 - (1 - t) ** 4
export default {
  name: "关键词分拍揭示", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 60,
  params: [
    { key: "words", type: "table", title: "关键词", rowKey: "id",
      fields: { id: { type: "text", title: "标识", default: "w", maxLength: 16 }, word: { type: "text", title: "词", default: "关键词", maxLength: 24 } },
      default: [{ id: "w1", word: "看见" }, { id: "w2", word: "关系" }, { id: "w3", word: "理解" }, { id: "w4", word: "变化" }] },
    { key: "wordStyle", type: "textStyle", title: "词样式", default: { fontSize: 54, align: "left", fill: { color: "#f2f5f7" } } },
    { key: "accent", type: "color", title: "卡片颜色", default: "#1f5266" },
    { key: "seconds", type: "number", title: "每拍秒数", default: 3, min: 2, max: 6, step: .1 },
    { key: "each", type: "number", title: "词间隔秒", default: .1, min: 0, max: .2, step: .01 }
  ],
  layers(params, width, height) {
    const rows = params.words, cardWidth = width * .2, pad = 24
    return rows.map((row, index) => {
      const page = Math.floor(index / 4), slot = index % 4
      const x = width * .07 + slot * width * .22, y = height * .45
      const text = layoutText(row.word, params.wordStyle, { box: { width: cardWidth - pad * 2 }, maxWidth: cardWidth - pad * 2, maxLines: 2, fit: { minFontSize: 28 } })
      const cardHeight = Math.max(140, text.box.height + pad * 2)
      const start = t => t - page * params.seconds - .15 - slot * params.each
      return { id: `word-${row.id}`, bounds: [x, y, x + cardWidth, y + cardHeight], data: { parameter: "words", keyField: "id", key: row.id },
        pose: t => {
          const local = start(t)
          if (local < 0 || t >= (page + 1) * params.seconds && page < Math.ceil(rows.length / 4) - 1) return null
          return { y: (1 - quartOut(clamp01(local / .5))) * 32, opacity: clamp01(local / .25) }
        },
        draw(ctx) {
          ctx.fillStyle = params.accent; ctx.beginPath(); ctx.roundRect(x, y, cardWidth, cardHeight, 24); ctx.fill()
          ctx.save(); ctx.translate(x + pad, y + (cardHeight - text.box.height) / 2); drawText(ctx, text); ctx.restore()
        } }
    })
  }
}
```

卡片只负责图形，真实词级配音时刻须另外读到并驱动时间；固定每拍时长不等于对齐语音。检查每拍第一个、中间错峰、最后必要词落定和切拍两侧；大标题与字幕区域仍保持一个焦点。
