# 终端、光标与数字滚动

配方只示范写法与常见做法，不是推荐风格；配色、时长、幅度按风格说明书或需求改。

配合 recipes-text 使用。打字机只表达“正在输入”，不是所有标题的默认动作。数字强调真实数据，不能为科技感编造读数。

## 打字机与光标

底板默认从首个字素出现时就整段显示，不逐字切成小底板；用 `backgroundAndDecorationOpacity`（0–1）单独控制整段底板与装饰线的显隐或淡入。阴影和外描边置于下层，填色后再画内描边与居中描边。打完后仍沿用同一图集；动画图集独立绘制字素簇，会失去字素之间的连写。

可见字数由时间直接求：`Math.floor(progress * n)`，n 是整句排版结果的字素数。整句用 `layoutText` 定下折行与光标位置，再用 `drawText(ctx, full, { graphemes: shown })` 显示前 shown 个字素，不重新排版前缀、不另排单字。同内容布局与字素图集跨帧复用，绘制事实保留整句约束和遗漏。光标放在最后一个已显示字素的 `x + advance`、所在行的 `y` 与 `height` 上；用矩形，不用字体里的方块符号。时间决定显隐，随机寻帧不会重打字。输入中常亮，结束后每秒 2 次闪烁。需要平滑错峰入场时用 recipes-text 的字素动画回调。

```ts
import { layoutText, drawText } from "henji-layout/text"
const clamp01 = v => Math.min(1, Math.max(0, v))
export default {
  name: "终端输入", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 5,
  params: [
    { key: "value", type: "text", title: "输入内容", default: "输入一个好想法", maxLength: 200, layer: "terminal" },
    { key: "style", type: "textStyle", title: "字符样式", layer: "terminal", default: { fontFamily: "monospace", fontSize: 64, align: "left", fill: { color: "#8cf2c2" } } },
    { key: "seconds", type: "number", title: "输入秒数", default: 1.4, min: .4, max: 3, step: .1 }
  ],
  layers(params, width, height) {
    const x = width * .08, y = height * .4, options = { maxWidth: width * .84, forceGraphemes: true }
    const full = layoutText(params.value, params.style, options), size = full.style.fontSize
    const marks = full.graphemes
    return [{ id: "terminal", bounds: [x, y, x + width * .84, y + Math.max(full.box.height, size * 1.25)], draw(ctx, time) {
      const shown = Math.floor(clamp01((time - .2) / params.seconds) * marks.length)
      const last = marks[shown - 1], line = full.lines[last ? last.line : 0]
      ctx.save(); ctx.translate(x, y)
      drawText(ctx, full, { graphemes: shown })
      if (time < .2 + params.seconds || Math.floor(time * 4) % 2 === 0) {
        ctx.fillStyle = full.style.fill.color
        ctx.fillRect((last ? (last.x ?? 0) + last.advance : line?.x ?? 0) + size * .1, line?.y ?? 0, size * .15, line?.height ?? size * 1.25)
      }
      ctx.restore()
    } }]
  }
}
```

## 数字滚动

整数用 `Math.round(目标 × 缓动进度)`；格式化用 `Intl.NumberFormat` 或 `toFixed`，结束精确等于目标。完整数字卡见 examples 的 rolling-data。用 number 参数开放目标值、滚动秒数与颜色。

左对齐随位数增长会挤单位：用 `layoutText` 的 `anchor` 把数字右锚（`horizontal: 1`），或先排终值、取它的 `box.width` 作固定盒宽（`box: { width }` 配 `align: "right"`），不让单位每帧随数宽抖动。数字选等宽字体。千分号、小数点、负号与单位分开排版时，按各自 `lines[0].alphabeticBaseline` 对齐字母基线（`baseline` 默认是中线，字号不同时对不齐）。

停留帧复查目标值和单位；开始、位数跨越、最后一帧检查跳动；数字落定对齐说到该数据的配音重音。价格／人名／统计量不得用样例默认值替代用户事实。

## 内容自适应的数据卡

根只给宽度，高度随可见行数；同一行用 baseline 对齐不同字号。表格字段按名字索引，default 才是行数组。容器先整体滑入，文字随容器走。

```ts
import { drawText } from "henji-layout/text"
import { layoutBoxes } from "henji-layout/flex"
const clamp01 = v => Math.min(1, Math.max(0, v))
export default {
  name: "基线数据卡", kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  params: [{ key: "rows", type: "table", title: "数据", rowKey: "id", fields: {
    id: { type: "text", title: "标识", default: "row", maxLength: 40 },
    label: { type: "text", title: "标签", default: "指标", maxLength: 80 },
    value: { type: "text", title: "数值", default: "0", maxLength: 20 },
    unit: { type: "text", title: "单位", default: "%", maxLength: 12 }
  }, default: [{ id: "accuracy", label: "识别准确率", value: "98.6", unit: "%" }] }],
  layers(params, width, height) {
    const text = (content, fontSize) => ({ content, style: { fontSize, align: "left" as const, fill: { color: "#f2f3f5" } }, options: { maxLines: 1 } })
    const boxes = layoutBoxes({ id: "card", style: { width: 960, padding: 48, gap: 28, flexDirection: "column" }, children: params.rows.map(row => ({
      id: row.id, style: { alignItems: "baseline" as const, gap: 24 }, children: [
        { id: row.id + "-label", style: { flexGrow: 1 }, text: text(row.label, 36) },
        { id: row.id + "-value", style: { width: 200 }, text: text(row.value, 72) },
        { id: row.id + "-unit", style: { width: 100 }, text: text(row.unit, 36) }
      ]
    })) }, { width, height })
    const card = boxes.card
    return [{ id: "card", bounds: [0, 0, card.width, card.height],
      pose: t => ({ x: (width - card.width) / 2, y: (height - card.height) / 2 + (1 - clamp01(t / .7)) ** 3 * 96 }),
      draw(ctx) {
        ctx.fillStyle = "#17191d"; ctx.beginPath(); ctx.roundRect(0, 0, card.width, card.height, 20); ctx.fill()
        for (const box of Object.values(boxes)) if (box.text) {
          ctx.save(); ctx.translate(box.contentBox.x, box.contentBox.y); drawText(ctx, box.text); ctx.restore()
        }
      }
    }]
  }
}
```
