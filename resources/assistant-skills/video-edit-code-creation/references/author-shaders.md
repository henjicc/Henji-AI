# 作者语言 v3：着色器

着色器在 GPU 上按像素算颜色，管光、雾、流动、噪点、玻璃、扭曲、转场这类“质感层”。三种用法，自由组合：

1. **按名字用框架组件**：`shaders` 库的 160 多个组件（极光、网格渐变、玻璃、胶片颗粒……），目录见 [shader-components](shader-components.md)。
2. **`layers` 图层树**：多个组件叠加、混合、遮罩、嵌套，写法与框架预设 JSON 相同。
3. **自己写 WGSL**：在素材 `shaders` 里定义，之后和内置组件一样按名字用。库里没有的效果直接写，不受限于目录。

先找组件拼，拼不出再自己写；自己写的也可以和组件一起放进图层树。

## shader 图层（生成器素材）

```text
shader({id:"sky", name:"Aurora", time:ctx.time,
  params:{speed:2, intensity:70, colorA:rgba(.05,.2,.25,1)},
  x:0, y:0, width:ctx.width, height:ctx.height, opacity:1, blend:"normal"})
```

- `name` 或 `layers` 二选一。`name` 是组件名或自己写的着色器名，属性写在 `params`。
- 着色器的输出就是这一图层的画面，可放进 group，接受组的平移、旋转、缩放、透明度、混合与 clip。图层本身不接受 shadow、glow、blur；需要时套在组上。
- `time` 省略时取 `ctx.time`。可以慢放、倒放、循环（比如 `ctx.time*.5`、`ctx.time%4`），同一时刻永远同一画面；静态素材必须显式写固定 time。
- 带速度属性的组件（目录里带 ⏱）实际动画时间是“time × 速度”。

### layers：图层树

```text
shader({id:"bg", x:0, y:0, width:ctx.width, height:ctx.height, layers:[
  {type:"SolidColor", props:{color:[.02,.03,.06,1]}},
  {type:"Aurora", id:"aurora", props:{speed:ctx.params.speed, intensity:70}},
  {type:"FilmGrain", props:{strength:.12}},
  {type:"Circle", id:"spot", props:{visible:false, radius:.4, softness:.5}},
  {type:"Glow", props:{intensity:.6, maskSource:"spot"}}
]})
```

- 先写的在下面。**滤镜组件作用于它之前画好的所有兄弟图层**；只想处理某几层时，把它们放进滤镜的 `children`。
- 每层：`type`（组件名）、可选 `id`、`props`、`children`。
- 通用属性：`blendMode`（normal、multiply、screen、overlay、softLight、hardLight、linearDodge、linearBurn、colorDodge、colorBurn、darken、lighten、difference、exclusion、hue、saturation、color、luminosity）、`opacity`（0–1）、`visible`、`maskSource`（另一个图层的 id）+ `maskType`（alpha、luminance 等）、`transform`、`boundingBox`。
- 遮罩：给遮罩层写 id 和 `visible:false`，被遮的层写 `maskSource`。
- 转场组件放进图层树就是“揭示”：`progress` 0 完整显示它的 children，1 完全擦掉。

### 属性值

- 属性名写组件原名（`colorA`）；剪辑效果参数的下划线写法（`color_a`）也认。
- 数值按组件自己的量纲和范围（目录里的实体参数写了范围和含义），可用任意帧表达式：参数、时间、数学、缓动。
- 颜色：作者 RGBA（`rgba(...)`、`[r,g,b,a]`、`ctx.style.palette.*`），也可以写 CSS 颜色串。组件内部按线性光混合。
- 位置：`{x, y}` 或 `[x, y]`，0–1 画面比例，y 向下。剪辑效果实体里的位置参数是两个百分比（`center_x`、`center_y`），代码里不要照搬。
- 选项写选项值（字符串）；开关写 true/false；渐变色标写 `[{color:..., position:0}, ...]`。
- 属性里不能写网址；图片素材用 image 图层或参数。

## 滤镜素材里的着色器

```text
const chroma = shaderFilter("ChromaticAberration", {strength:.25});
const grain = shaderFilter("FilmGrain", {strength:.4}, chroma);
return clamp(mix(grain, blur(4), .3), 0, 1);
```

- `shaderFilter(名字, 属性, 可选上一道)`：对输入画面（或上一道 shaderFilter 的结果）跑一个滤镜组件或自己写的滤镜。
- `shaderFilter({layers:[...]}, 可选上一道)`：完整图层树。没写 `@input` 时自动把输入画面放在最下面；要控制位置就自己写 `{type:"@input"}`。
- 返回的是当前像素的颜色，可以和 sample、blur、glow、mix、saturate 等继续组合。
- 滤镜属性只能用帧级表达式（参数、时间、数学），不能逐像素变化（不读 ctx.u/v、不采样输入）；要逐像素算就自己写 WGSL。
- 同一帧里参数完全相同的工序只算一次；每帧最多 8 道 shaderFilter。

## 自己写 WGSL

```text
export default {
  apiVersion:1, languageVersion:3, name:"水波折射", kind:"filter", mode:"dynamic",
  width:1920, height:1080, durationSeconds:6, seed:1,
  parameters:{amount:{type:"number", title:"波幅", default:.01, min:0, max:.05, step:.001}},
  shaders:{
    ripple:{kind:"filter",
      props:{amount:{default:.01}, freq:{default:40}},
      wgsl:`
        let w = sin(uv.y * freq + time * 3.0) * amount;
        return textureSample(childTexture, childSampler, uv + vec2f(w, 0.0));`},
    halo:{kind:"generator",
      props:{tint:{type:"color", default:"rgb(255, 190, 90)"}, center:{type:"position", default:{x:.5, y:.4}}},
      wgsl:`
        let d = length((uv - center) * vec2f(aspect, 1.0));
        return vec4f(tint.rgb, tint.a * (1.0 - smoothstep(0.0, 0.45, d)));`}
  },
  render(ctx){ return shaderFilter("ripple", {amount:ctx.params.amount}); }
}
```

- 素材顶层 `shaders: { 名字: 定义 }`。名字不能和内置组件重名。
- `kind`：`generator` 自己画；`filter` 处理之前画好的画面。
- `props`：`{名: {type?, default, min?, max?, label?, description?}}`。type 为 number、color、position、angle、boolean；省略时按默认值推断（字符串→颜色，{x,y}→位置）。
- `wgsl`：一个**函数体**，必须 `return` 一个 vec4f 颜色。可多行模板字符串，不能有 `${}` 插值。不能在里面声明顶层函数或绑定。
- 函数体里直接可用的名字：
  - `uv`：vec2f，0–1，y 向下；`time`：f32 秒（声明了 `speedProp` 时是“秒×该属性”）；`aspect`：宽/高；`viewport`：vec2f 像素尺寸；
  - 属性按名字：数值 f32、颜色 vec4f（线性光 RGB + alpha）、位置 vec2f（uv）、角度 f32 弧度、开关 f32（0/1）；
  - 滤镜额外有 `child`（当前像素的输入颜色）；要取相邻像素用 `textureSample(childTexture, childSampler, uv2)`，它给预乘颜色、返回时自动还原。
  - `pointer` 在剪辑里没有意义，不要用。
- 生成器返回直通 alpha；颜色在线性光里算，最后由引擎转回画面编码。
- `textureSample` 必须在统一控制流里调用；在 if/循环分支里采样用 `textureSampleLevel(childTexture, childSampler, uv2, 0.0)`。
- 写好后先放在单独的关键帧上试：提交源码版本时会真实编译并试渲染，WGSL 报错带“素材源码第 N 行”，按行修正后提交新版本，不要原样重试。
- 自己写的着色器也能放进 layers 图层树，和组件混合、遮罩。

## 效果、转场与代码素材的关系

- 片段效果：`video_edit.effect` 的 definition_id 写 `effect:shaders.<组件名>`，参数按实体目录（下划线键、位置百分比、生成器多一个 `blend_mode`）。关键帧写 `frame_curves`。
- 视频过渡：`video_edit.transition` 的 kind 写 `shaders.<转场组件名>`，进度由时间线驱动。
- 一个效果解决不了（多层叠加、遮罩、自写算法、和图形同步动画）时，写代码素材。

## 性能与边界

- 每帧最多 32 个 shader 图层；同一帧里图结构、属性、时间与尺寸都相同的图层只渲染一次。
- 组件第一次出现时要编译管线（约半秒到一秒），之后同结构复用；属性和时间变化不重新编译。
- 依赖上一帧状态的组件（粒子、流体、轨迹）、跟随鼠标的组件、网页/摄像头/网址素材组件不在目录里，剪辑里无法任意寻帧重现。
- 4K 下大多数组件每帧不到 1 毫秒，重的材质类（玻璃、液态金属、体素）和多层叠加会更贵；做完取帧看画面，长片段播放时注意是否掉帧。
