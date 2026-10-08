# 参数类型与自定义组件类型

`parameters` 是 `键名: 声明` 的静态对象，数量不设上限，按需开放。键名以字母开头，只含字母、数字、下划线，≤64 字符。

## 通用字段

每项必须有 `type`、`title`（≤80 字）和 `default`。可选：

- `description`（≤1000）：写给助手的语义与常用取值，界面不显示。
- `tooltip`（≤200）：悬停参数名时给用户看的一句提示。
- `animatable: true`：允许关键帧（默认 false）。
- `group`（≤40）：分组名，同组参数在面板里归在一起。
- `advanced: true`：折进该组末尾的“更多”。
- `visibleWhen`：`{ param, equals | notEquals | in }`，只能引用声明顺序在前的 choice/boolean/number 参数，三种条件恰好写一个。

## 基础类型

| type | 额外字段 | 值形状 | 控件 |
| --- | --- | --- | --- |
| number | `min` `max` `step` 必填，`unit`，`control`: slider/knob/input | 数值 | 滑杆 / 旋钮 / 输入框 |
| angle | `min` `max`（默认 ±180） | 度数 | 角度盘 |
| point | `space`: frame（默认，0–1、y 向下）/ pixels，`min` `max` 为 `{x,y}` | `{x,y}` | 点位板 |
| range | `min` `max` `step` 必填，`unit` | `[a,b]`，a≤b | 双端滑杆 |
| color | `alpha`（默认 true；false 时 a 固定 1） | `[r,g,b,a]` 各 0–1 | 取色器 |
| gradient | `maxStops` 2–32（默认 8） | `[{at:0–1,color:RGBA}]`，2 项起，at 非降序 | 渐变编辑器 |
| curve | `kind`: tone（默认）/ hue | `[{x,y}]` 各 0–1，2–64 点，x 严格递增，首尾 x=0/1；hue 两端 y 相等 | 曲线编辑器 |
| grade | 无 | `{hue:0–360, strength:0–1, luminance:-1–1}` | 调色色轮 |
| choice | `options` 1–64 项字符串或 `{value,label}`，`control`: dropdown/segmented | 选项 value | 下拉 / 分段 |
| boolean | 无 | true / false | 开关 |
| text | `maxLength` 1–4096 必填，`multiline` | 文本 | 单行 / 多行输入 |
| font | 无 | 字体族名（不含换行和 `;{}`） | 字体选择器 |
| easing | 无 | 缓动名（linear、cubicOut、sineInOut、backOut、elasticOut、bounceOut 等；sine/quad/cubic/quart/quint/expo/circ 各有 In/Out/InOut）或 `[x1,y1,x2,y2]`，x 在 0–1 | 缓动编辑器 |
| seed | 无 | 0–4294967295 的整数 | 种子输入 + 随机 |
| image | 仅生成器，`default: null`，不可动画 | 见“图片参数就地生成” | 图片选择 |

font 参数的值直接给 `text.fontFamily`；用户机器缺字体时剪辑会提示，先查 font 实体挑已安装的字体。

## 在源码里取用

- 数值、颜色、点位等直接读：`ctx.params.pos.x * ctx.width`。
- 渐变取色：`sampleGradient(ctx.params.palette, t)`，t 夹在 0–1，色标间线性插值。
- 曲线取值：`sampleCurve(ctx.params.response, x)`，分段线性。
- 缓动：`ease(ctx.params.motionEase, t)`。
- 这三个函数只在 CPU 帧级代码里可用；滤镜的逐像素表达式只能读 number/angle/seed/boolean/color/frame 空间 point/range/grade 及对应组件字段，需要渐变或曲线时先在帧级算好，再作为 `shaderFilter` 的属性传入，或写 WGSL。

## 自定义组件类型

结构重复的参数（几盏灯、几根柱子、一组字幕样式）在素材顶层用 `types` 声明一个类型，再在 `parameters` 里用类型名当 `type`。部件函数接收组件值，主 render 只拼装：

```ts
export default {
  apiVersion: 1, languageVersion: 3, name: "两盏光",
  kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  durationSeconds: 4, seed: 7,
  types: {
    Light: {title: "灯光", layout: "wheel", fields: {
      tint: {type: "grade", title: "色调", default: {hue: 30, strength: .6, luminance: 0}},
      size: {type: "number", title: "大小", min: .05, max: 1, step: .01, default: .35},
      pos: {type: "point", title: "位置", default: {x: .5, y: .4}}
    }}
  },
  parameters: {
    key: {type: "Light", title: "主光", group: "灯光", animatable: true,
      default: {pos: {x: .62, y: .38}}},
    fill: {type: "Light", title: "补光", group: "灯光",
      default: {tint: {hue: 210, strength: .5, luminance: -.2}, size: .25, pos: {x: .25, y: .6}}},
    sky: {type: "gradient", title: "背景渐变", group: "背景",
      default: [{at: 0, color: [.03,.04,.08,1]}, {at: 1, color: [.1,.06,.12,1]}]},
    enter: {type: "easing", title: "入场缓动", group: "节奏", advanced: true, default: "expoOut"}
  },
  render(ctx) {
    const grow = ease(ctx.params.enter, progress(ctx.time, 0, .8));
    const light = (id, l) => ellipse({id: id,
      x: (l.pos.x - l.size / 2) * ctx.width, y: l.pos.y * ctx.height - l.size * ctx.width / 2,
      width: l.size * ctx.width, height: l.size * ctx.width,
      fill: hsl(l.tint.hue / 360, l.tint.strength, .5 + l.tint.luminance * .4, .55 * grow)});
    return [
      rect({id: "sky-top", x: 0, y: 0, width: ctx.width, height: ctx.height / 2,
        fill: sampleGradient(ctx.params.sky, .25)}),
      rect({id: "sky-bottom", x: 0, y: ctx.height / 2, width: ctx.width, height: ctx.height / 2,
        fill: sampleGradient(ctx.params.sky, .75)}),
      light("fill", ctx.params.fill), light("key", ctx.params.key)
    ];
  }
}
```

- 字段 1–16 个，只能用除 image 外的基础类型，不能嵌套别的自定义类型，字段不带 group/advanced/visibleWhen。
- `layout`：stack（纵向逐行）、row（一行并排，适合 2–3 个短字段）、grid（两列网格）、wheel（大色轮在上，其余字段在下；恰好一个 grade 字段）。
- 类型名不能与基础类型重名。参数的 `default` 可只写部分字段，其余用字段默认值；实例写入时必须给出全部字段。
- 控件外观由界面统一渲染，只能选布局、不能自定义样式，所以用户看到的面板风格始终一致。

## 动画插值

- number、angle 和 color 按值插值；point、range、grade 及组件里的这些字段逐分量插值，可用 linear/ease/hold。
- gradient、curve、font、easing、seed、choice、text、boolean 只能 hold；组件里的这类字段也保持前一个关键帧的值。
- angle 与 grade 的色相按数值插值，不走最短路径：angle 从 350° 到 10° 会反向转过 340°，要跨 0° 就把终点写成 370°（max 要够大）；grade 色相限 0–360，跨 0° 时在 360/0 处拆成两段。
