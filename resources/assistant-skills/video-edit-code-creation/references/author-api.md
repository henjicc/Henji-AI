# 作者接口（apiVersion 1）

源码只能是一个 `export default` 静态对象，最多 64 KiB。未知字段、未知语法一律拒绝。

```ts
export default {
  apiVersion: 1,
  name: "标题条",          // 1–160 字
  kind: "generator",      // generator 画图形；filter 处理所在片段的画面
  mode: "dynamic",        // static 不能读任何时间字段
  width: 1920, height: 1080,  // 作者画布像素，1–8192 整数
  durationSeconds: 5,     // 源时长秒，(0, 1800]
  seed: 1,                // random 的种子，0–4294967295 整数
  parameters: {},         // 见参数与关键帧
  render(ctx) { const x = ctx.width * 0.5; return [] }
}
```

## render 写法

- 只能是 `render(ctx)`；函数体只有 `const` 声明和最后一个 `return`。
- 没有 if、循环、赋值、箭头函数、模板字符串、对象展开、方法调用。分支用 `条件 ? 甲 : 乙`，两边同类型。
- 运算：`+ - * / %`、比较、`=== !==`（同类型标量）、`&& || !`。不能写除以字面量 0。
- 函数：`sin cos abs floor ceil round min max clamp mix smoothstep random rgba sample`。`clamp(值,下,上)`、`mix(甲,乙,比例)` 接受数值或颜色；`smoothstep(下,上,值)` 要求下 < 上；`random(n)` 的 n 用非负整数。
- 颜色：`[r,g,b,a]` 或 `rgba(r,g,b,a)`，各通道 0–1；取分量用 `.r .g .b .a`。
- 参数：`ctx.params.键名`。

## ctx 字段

`time` 源时间秒（关键帧也按它计时）、`localTime` 片段内秒、`sequenceTime` 序列秒、`frame` 序列帧号、`fps`、`width`、`height`。static 模式只能用 `width`、`height`。`u`、`v` 是 0–1 的像素坐标，只用于滤镜。

## 生成器输出

`return [图形, ...]`，最多 256 项，坐标是作者画布像素：

- `rect({x,y,width,height,fill,radius})`：x、y 为左上角；radius 可省略。
- `ellipse({x,y,width,height,fill})`：外接矩形左上角与尺寸。
- `line({x1,y1,x2,y2,width,color})`
- `text({x,y,text,fontSize,color,fontFamily,align})`：y 是文字垂直中心；align 为 `"left" "center" "right"`，决定 x 是左端、中心还是右端；fontFamily 为 `"sans-serif" "serif" "monospace"`，后两项可省略。每帧文字合计不超过 8192 字。
- `image({source,x,y,width,height,opacity})`：source 只能是图片参数 `ctx.params.键名`；参数为空时不绘制。

## 滤镜输出

`return` 一个颜色。`sample(ctx.u, ctx.v)` 读取输入画面；最多采样 4 次、128 次标量运算；不能出现文本或字符串参数；不能使用图片参数。

## 预算与报错

AST 8192 节点、深度 64、求值 20000 次操作、参数 32 项。报错格式为类别加说明，常见类别：SYNTAX（语法，含行:列）、TYPE（类型不符）、BUDGET（超预算）、PARAMETERS（参数声明或值无效）、NON_FINITE（出现无穷或 NaN）、CONTEXT（请求时间超出声明时长等）。按行列修正后作为新操作重新提交，不要原样重试。
