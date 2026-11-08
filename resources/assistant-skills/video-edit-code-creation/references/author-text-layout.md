# 复杂排版

`layoutText`、`drawText`、文字样式与逐字动画见 [文字与动效](author-text-motion.md)。

## 同一段里混样式与混方向

一段字要混颜色、字号、字重时，把内容写成富文本交给 `layoutText`，第二个参数是基础样式。只有 `runs` 必填：`align` 沿用基础样式，`direction` 默认自动，`spaceBefore`、`spaceAfter` 默认 0。折行、挤压、基线都按整段算，不要拆成几个 `layoutText` 手工拼。

```text
layoutText({ paragraphs: [{ runs: [{ text: "少了一个", style }, { text: "字", style: { ...style, fill: { color: "#d3331f" } } }] }] }, style, { maxWidth: 800, box: { width: 800 } })
```

方向按 Unicode 双向算法处理：阿拉伯文、希伯来文从右到左连写，夹在里面的数字和拉丁字母仍从左到右，中文开头的段落只翻转其中从右到左的片段。默认由第一个强方向字符决定整段基准方向；段落写 `direction: "rtl"` 或 `"ltr"`（或 `options.direction`）可以强制。纯从右到左的段落要靠右时自己写 `align: "right"`。

## 竖排、分栏、绕排、缩进和列表

这些都是 `layoutText` 的选项或段落字段，不用手算每行位置：

| 写法 | 作用 |
| --- | --- |
| `writingMode: "vertical"` | 竖排：从上到下成列，第一列在最右。中文直立并用字体的竖排标点，拉丁字母和数字转 90 度。一列的高度来自 `box.height` 或 `maxHeight`；字素的 `x` 是列中线，`y` 是字的起点 |
| `columns: { count, gap }` | 分栏续排，排满一栏接下一栏。给了 `box.height` 按它算栏高，放不下的进 `omittedRanges`、`truncated` 为真，配 `fit` 自动缩字号；没给高度时各栏自动等高 |
| `exclusions: [{ x, y, width, height, shape, margin }]` | 文字绕开这些区域（图片、人物），`shape` 为 `rect` 或 `ellipse`，坐标相对放置盒左上。需要确定的行内尺寸 |
| `columns`、`exclusions` 的对齐 | 分栏和绕排总从盒子起点排，`verticalAlign` 不生效，否则内容挪动后会压到绕排区域 |
| 段落 `firstLineIndent`、`indent`、`indentEnd` | 首行缩进、整段缩进，单位是作品像素 |
| 段落 `list: { type, level, start, indent, marker }` | 列表。`type` 为 `decimal`、`cjk`（一、）、`alpha`、`bullet`，同一 `level`、同一 `type` 的相邻段落自动计数，换类型或写新的 `start` 重新数；`list.indent` 的单位是字号倍数（默认 2），段落 `indent` 才是作品像素。折行悬挂在标记之后，从右到左的段落标记在右边；标记不进原文，字素的 `source` 是空范围 |

表格单元格写 `{ text, colSpan, rowSpan }` 合并单元格，被占住的格子不用写；`cells` 里的 `box` 已经是合并后的范围。

`glyphLayers(layout, { id, pose, effects, offset, clip })` 把整段拆成每字一层：`pose(t, index, { cx, cy }, grapheme)` 里的 `cx`、`cy` 是字面中心，返回值就是图层位姿。逐字飞入、散开这类动作用它，每个字的范围按它实际的墨迹、描边和阴影算好了。底板和下划线不进这些层，要的话另画。

## 盒子布局：layoutBoxes

`layoutBoxes(tree, { width, height })` 按 CSS flex 规则排一棵框树，返回以 id 为键的框 `{ x, y, width, height, contentBox, text? }`。节点 `style` 写 `flexDirection`（默认 `"row"`）、`gap`、`padding`、`margin`、`width`/`height`（数字或 `"50%"`）、`alignItems`、`justifyContent`、`flexGrow` 等；带 `text: { content, style, options }` 的节点自动量字，宽度跟内容走。绘制该节点文字时先 `ctx.translate(box.contentBox.x, box.contentBox.y)` 再 `drawText(ctx, box.text)`。人名条、卡片、标签组这类“底板包住几行字”的版式用它算，不手算宽高。id 不能重复，文字节点不能有子框。

根节点省略宽高或写 `"auto"` 时按内容收缩，画幅 size 是尺寸上限与百分比参照；铺满画幅须显式写 `style: { width: "100%", height: "100%" }`。卡片可只给 width，height 随内容；整组居中放在图层 pose 中，或用显式满幅容器居中。

文字 `options.maxLines/maxHeight` 的测量高度按实际显示行数返回，不为遗漏行留白；`totalLines/truncated/omittedRanges` 仍保存完整事实。需要正文全部可读时用 fit、增宽或改版，不能用截断隐藏原文。

同一 row 用 `alignItems: "baseline"`（单项可用 `alignSelf: "baseline"`），标签、数值和单位按首行 `alphabeticBaseline` 自动对齐，不手写 y 补偿；嵌套容器沿用首个参考子节点的基线。使用排版库的基线对齐即可，不再手工叠加补偿。完整表格参数与数据卡见 recipes-text-data。
