# 参数类型与自定义组件类型

模块的 `params` 是声明数组，顺序即面板顺序，数量不设上限，按需开放。每项用 `key` 命名（字母开头，只含字母、数字、下划线，≤64 字符）；`title` 也可写成 `label`，`type: "select"` 等同 `choice`，没有数组默认值的 `range` 按 number 处理。

## 通用字段

每项必须有 `key`、`type`、`title`（≤80 字）；除 image/audio/textStyle/table 外必须有 `default`。可选：

- `description`（≤1000）：写给助手的语义与常用取值，界面不显示。
- `tooltip`（≤200）：悬停参数名时给用户看的一句提示。
- `animatable: true`：允许关键帧（默认 false）。
- `group`（≤40）：分组名，同组参数在面板里归在一起。
- `advanced: true`：折进该组末尾的“更多”。
- `layer`：绑定的图层 id。text 与 textStyle 绑定同一图层后，点选该图层即可改字和样式；其他参数绑定后在选中图层时优先显示。
- `visibleWhen`：`{ param, equals | notEquals | in }`，只能引用声明顺序在前的 choice/boolean/number 参数，三种条件恰好写一个。

## 基础类型

| type | 额外字段 | 值形状 | 控件 |
| --- | --- | --- | --- |
| number | `min` `max` `step` 必填，`unit`，`control`: slider/knob/input | 数值 | 滑杆 / 旋钮 / 输入框 |
| angle | `min` `max`（默认 ±180） | 度数 | 角度盘 |
| point | `space`: frame（默认，0–1、y 向下）/ pixels，`min` `max` 为 `{x,y}` | `{x,y}` | 点位板 |
| range | `min` `max` `step` 必填，`unit` | `[a,b]`，a≤b | 双端滑杆 |
| color | `alpha`（默认 true；false 时 a 固定 1） | 默认值写 `#RRGGBB(AA)` 时代码收到同格式字符串；写 `[r,g,b,a]` 时收到 0–1 数组 | 取色器 |
| gradient | `maxStops` 2–32（默认 8） | `[{at:0–1,color:RGBA}]`，2 项起，at 非降序 | 渐变编辑器 |
| curve | `kind`: tone（默认）/ hue | `[{x,y}]` 各 0–1，2–64 点，x 严格递增，首尾 x=0/1；hue 两端 y 相等 | 曲线编辑器 |
| grade | 无 | `{hue:0–360, strength:0–1, luminance:-1–1}` | 调色色轮 |
| choice | `options` 1–64 项字符串或 `{value,label}`，`control`: dropdown/segmented | 选项 value | 下拉 / 分段 |
| boolean | 无 | true / false | 开关 |
| text | `maxLength` 1–4096 必填，`multiline` | 文本 | 单行 / 多行输入 |
| font | 无 | 字体族名（不含换行和 `;{}`） | 字体选择器 |
| easing | 无 | 缓动名（linear、cubicOut、sineInOut、backOut、elasticOut、bounceOut 等；sine/quad/cubic/quart/quint/expo/circ 各有 In/Out/InOut）或 `[x1,y1,x2,y2]`，x 在 0–1 | 缓动编辑器 |
| seed | 无 | 0–4294967295 的整数 | 种子输入 + 随机 |
| textStyle | 无，默认值可只写部分字段 | 文字样式对象，见 author-text-motion | 文字样式面板 |
| table | `fields`（字段为基础类型或 textStyle），`rowKey` 推荐 | 行对象数组 | 数据表 |
| image | 仅生成器，不可动画 | 引用；代码从 `assets[key]` 取画面，见 author-api-media（含绑定本地网页） | 图片选择 |
| audio | 不可动画 | 引用；分析结果在 `info.audio` | 声音选择 |

font 参数的值是字体族名，作为 textStyle 的 `fontFamily` 传给 layoutText；用户机器缺字体时剪辑会提示，先查 font 实体挑已安装的字体。

## 在源码里取用

- 参数按 `params.键名` 读取，已应用当前帧关键帧：`params.pos.x * width`。
- 渐变取色、曲线取值、缓动求值都是普通函数，按值形状自己实现（线性插值色标、分段线性曲线、贝塞尔反解），或放进项目组件复用。
- table 的行就是普通数组；动态图层用 `rowKey` 字段组成 id，并以 `data: { parameter, keyField, key }` 绑定，选中图层即可改那一行。
- table 声明的 `fields` 是按字段名索引的对象：`fields: { label: { type: "text", title: "标签", default: "指标", maxLength: 60 } }`；字段里不放 key，也不写成数组。只有 params 和 table.default 的行数据是数组。完整数据卡见 recipes-text-data。

## 自定义组件类型

结构重复的参数（几盏灯、几根柱子、一组字幕样式）在模块顶层 `types` 声明一个类型，再在 `params` 里用类型名当 `type`：

```ts
export default {
  name: "两盏光", kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  types: {
    Light: { title: "灯光", layout: "wheel", fields: {
      tint: { type: "grade", title: "色调", default: { hue: 30, strength: .6, luminance: 0 } },
      size: { type: "number", title: "大小", min: .05, max: 1, step: .01, default: .35 },
      pos: { type: "point", title: "位置", default: { x: .5, y: .4 } }
    } }
  },
  params: [
    { key: "key", type: "Light", title: "主光", group: "灯光", animatable: true, default: { pos: { x: .62, y: .38 } } },
    { key: "fill", type: "Light", title: "补光", group: "灯光", default: { tint: { hue: 210, strength: .5, luminance: -.2 }, size: .25, pos: { x: .25, y: .6 } } }
  ],
  draw(ctx, time, params, width, height) {
    const grow = 1 - (1 - Math.min(1, time / .8)) ** 3
    ctx.fillStyle = "#080a14"; ctx.fillRect(0, 0, width, height)
    for (const light of [params.fill, params.key]) {
      const r = light.size * width / 2
      ctx.globalAlpha = .55 * grow
      ctx.fillStyle = `hsl(${light.tint.hue} ${light.tint.strength * 100}% ${50 + light.tint.luminance * 40}%)`
      ctx.beginPath(); ctx.arc(light.pos.x * width, light.pos.y * height, r, 0, Math.PI * 2); ctx.fill()
    }
  }
}
```

- 字段 1–16 个，只能用除 image/audio 外的基础类型，不能嵌套别的自定义类型，字段不带 group/advanced/visibleWhen/layer。
- `layout`：stack（纵向逐行）、row（一行并排，适合 2–3 个短字段）、grid（两列网格）、wheel（大色轮在上，其余字段在下；恰好一个 grade 字段）。
- 类型名不能与基础类型重名。参数的 `default` 可只写部分字段，其余用字段默认值；实例写入时必须给出全部字段。
- 控件外观由界面统一渲染，只能选布局、不能自定义样式。

## 动画插值

- number、angle 和 color 按值插值；point、range、grade 及组件里的这些字段逐分量插值，可用 linear/ease/hold。
- gradient、curve、font、easing、seed、choice、text、boolean 只能 hold；组件里的这类字段也保持前一个关键帧的值。
- angle 与 grade 的色相按数值插值，不走最短路径：angle 从 350° 到 10° 会反向转过 340°，要跨 0° 就把终点写成 370°（max 要够大）；grade 色相限 0–360，跨 0° 时在 360/0 处拆成两段。
