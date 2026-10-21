# 终端、光标与数字滚动

配方只示范写法与常见做法，不是推荐风格；配色、时长、幅度按风格说明书或需求改。

配合 recipes-text 使用。打字机只表达“正在输入”，不是所有标题的默认动作。数字强调真实数据，不能为科技感编造读数。

## 打字机与光标

可见字数由时间直接求：`Math.floor(progress * n)`，绘制前缀 `chars.slice(0, shown).join("")`，光标位置用 `ctx.measureText(前缀).width`，不要用整句宽度。光标用矩形，不用字体里的方块符号；多行先自己换行，再按行列放光标。时间决定显隐，随机寻帧不会重打字。输入中常亮，结束后每秒 2 次闪烁。

```ts
const clamp01 = v => Math.min(1, Math.max(0, v))
export default {
  name: "终端输入", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 5,
  params: [
    { key: "value", type: "text", title: "输入内容", default: "输入一个好想法", maxLength: 200, layer: "terminal" },
    { key: "ink", type: "color", title: "字符颜色", default: "#8cf2c2" },
    { key: "size", type: "number", title: "字号", default: 64, min: 24, max: 96, step: 1 },
    { key: "seconds", type: "number", title: "输入秒数", default: 1.4, min: .4, max: 3, step: .1 }
  ],
  layers(params, width, height) {
    const x = width * .08, y = height * .5
    return [{ id: "terminal", bounds: [x, y - params.size, width * .92, y + params.size], draw(ctx, time) {
      const chars = Array.from(params.value)
      const shown = Math.floor(clamp01((time - .2) / params.seconds) * chars.length)
      const prefix = chars.slice(0, shown).join("")
      ctx.font = `${params.size}px monospace`; ctx.fillStyle = params.ink; ctx.textBaseline = "middle"
      ctx.fillText(prefix, x, y)
      const typing = time < .2 + params.seconds
      if (typing || Math.floor(time * 4) % 2 === 0) ctx.fillRect(x + ctx.measureText(prefix).width + 6, y - params.size * .5, params.size * .15, params.size)
    } }]
  }
}
```

## 数字滚动

整数用 `Math.round(目标 × 缓动进度)`；格式化用 `Intl.NumberFormat` 或 `toFixed`，结束精确等于目标。完整数字卡见 examples 的 rolling-data。用 number 参数开放目标值、滚动秒数与颜色。

左对齐随位数增长会挤单位：右锚（`ctx.textAlign = "right"`）或按终值宽度预留列，不让单位每帧随数宽抖动。等宽数字用 `font-variant-numeric` 不可用时选等宽字体，或按 `measureText("0")` 最大字宽固定格宽。千分号、小数点、负号与单位分开排版时保持基线一致。

停留帧复查目标值和单位；开始、位数跨越、最后一帧检查跳动；数字落定对齐说到该数据的配音重音。价格／人名／统计量不得用样例默认值替代用户事实。
