# 终端、光标与数字滚动

配合 recipes-text 使用。打字机只表达“正在输入”，不是所有标题的默认动作。数字强调真实数据，不能为科技感编造读数。

## 打字机与光标

普通排版可让perChar.opacity按t达到每字时刻变为1，不用更换整个字符串；但measureText量的是完整文字，不是当前可见前缀。作者没有substr／join和可读字形坐标数组，不能把整句宽度当光标位置。

终端可明确设计成固定单元格：chars取字，repeat按常量上界画格中字符，显示数量由progress与floor得到；光标用rect，不用字体里的方块符号。每格一字，中英均居中，保留统一格宽，所以它是网格终端，不宣称比例字体紧密排版光标。多行须另算行列，不把单行光标公式套在自动换行上。

样例开放内容、色彩、字号与输入时长，16格是一份样例的字符声明容量，不是工程数量上限；长内容要扩展布局／分行并核对编译工作预算，不截断原文。输入中常亮，结束后每秒2次闪烁。source时间决定显隐，随机寻帧不会重打字。

```ts
export default {
  apiVersion: 1, languageVersion: 3, name: "格子终端输入",
  kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  durationSeconds: 5, seed: 8,
  parameters: {
    value: {type: "text", title: "输入内容", default: "输入一个好想法", maxLength: 16},
    ink: {type: "color", title: "字符颜色", default: [.55,.95,.76,1]},
    size: {type: "number", title: "字号", default: 64, min: 24, max: 96, step: 1},
    seconds: {type: "number", title: "输入秒数", default: 1.4, min: .4, max: 3, step: .1}
  },
  render(ctx) {
    const letters = chars(ctx.params.value);
    const n = letters.length;
    const shown = floor(progress(ctx.time, .2, ctx.params.seconds) * n);
    const cell = ctx.params.size * 1.15;
    const cursor = ctx.time < .2 + ctx.params.seconds || floor(ctx.time * 4) % 2 === 0;
    return [group({id: "terminal", x: ctx.width * .08, y: ctx.height * .5}, [
      repeat(16, i => text({id: "cell", x: i * cell + cell / 2, y: 0,
        text: n > 0 ? letters[min(i, n - 1)] : "",
        fontFamily: "monospace", fontSize: ctx.params.size,
        align: "center", baseline: "middle", color: ctx.params.ink,
        opacity: i < shown && i < n ? 1 : 0})),
      rect({id: "cursor", x: shown * cell, y: -ctx.params.size * .5,
        width: ctx.params.size * .15, height: ctx.params.size,
        fill: ctx.params.ink, opacity: cursor ? 1 : 0})
    ])];
  }
}
```

## 数字滚动

本语言没有String、toFixed、toLocaleString、正则替换。先round(tween(...))得到整数，再用chars("0123456789")与十进制位权表取各位，repeat画text；完整可编译数字例在examples的rolling-data。用number参数开放目标值、滚动秒数与颜色，scale／位置固定，结束精确等于目标。

左对齐随位数增长会挤单位：右锚或居中，单位跟最终占位宽度／预留列而非每帧数宽抖动。数字格宽可按已查询等宽数字字体或measureText量数字表的最大字宽确定。千分号独立静态text／预留格，小数点独立绘制，负数单独符号；不能声称已有格式化函数。位数与位权表是样例数值范围，需要更大范围时扩充表或改算法，不用来限制工程数据条数。

停留帧复查目标值和单位；开始、位数跨越、最后一帧检查跳动；数字落定对齐说到该数据的配音重音。价格／人名／统计量不得用样例默认值替代用户事实。
