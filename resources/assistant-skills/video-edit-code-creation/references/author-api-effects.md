# 作者接口：图层效果链与效果身份

图层本身见 [author-api-layers](author-api-layers.md)。

## API 7：图层效果链与 henji-effects

新源码使用当前作者接口，`henji-effects` 随代码版本冻结（新源码锁定 1.4.0）。API 4–6 保留原行为，不自动升级。支持 `glow`、`blur`（`mode` 选 uniform 均匀 / directional 方向 / radial 放射 / spin 旋转 / lens 镜头；`range` 选 full 整幅 / progressive 渐进 / tilt 移轴，配 `range_x`、`range_y`、`range_angle`、`range_width`、`range_falloff`）、`chromaticAberration`、`colorGrade`、`sharpen`、`blackWhite`、`mosaic`、`shadow`、`stroke`、`lightSweep`、`dissolve` 和 `look`。工厂仅返回描述，不执行 GPU。参数、默认值、硬范围、单位和动画说明来自同一内置登记表及冻结声明；未知字段、NaN、Infinity、越界值会报错，不自动夹值。

`effects(t)` 每个可见层在中心作者时间求值一次，时间与 draw 相同；位姿仍按曝光采样。即使 draw 的 cacheKey 恒定，effects 仍逐帧求值。静态无 pose 的效果层也独立栅格；尽量给 bounds（内容在作者坐标中的矩形），省略时按完整作者画幅。宿主根据整链支撑外扩，不需要把光晕手工塞进 bounds。效果先于位姿变换、opacity、clip 和运动曝光；效果本身不多次曝光。

空间量按完整作者画幅高度计算，不按小 bounds 或外扩后的纹理高度。blur 的 `amount`（模糊度）五种方式共用：40 约为画面高度 1% 的背景虚化，常用 0–100、可以写得更大；方向用 `angle`，放射用内容范围中的 `center_x/center_y` 百分比，镜头用 `highlights` 控制光斑亮度。不要把 Canvas 像素直接填进模糊度。pose.blur 保留原画面像素语义，最终使用 GPU 虚化，含 `blurShape: "lens"`。

主图像按数组顺序处理；glow 产生的光保留产生时的状态，后续显式效果不改它。因此 `[blur(), glow()]` 先模糊后发光，`[glow(), blur()]` 只模糊主体；最终 pose.blur 同时处理主体与光，并使用固定质量规划。主体与光先在透明层内合成普通预乘 RGBA，再统一施加位姿、裁剪、不透明度和曝光权重。glow.blend 只控制本层主体的核心提亮；下方画面上的光总是相加。source_opacity=0 留纯光，pose.opacity=0 连光一起隐藏。

API 7 本帧实际产生发光 underlay 时，光以预乘 RGBA 的零 alpha RGB 传过片段和嵌套边界；其他画面沿用 RGB≤alpha 钳制。**限制：发光“相加照亮下方”只在代码片段直接合成到下方时成立。片段上的任何效果、任何转场（包括内置擦除、交叉溶解及 gl-transitions）都会产出普通画面，零 alpha 光会被截掉，因此效果期间光晕消失，转场首尾可能跳变。需要调光色时在作者 effects 内调参数／调发光前的内容。透明文件仍是普通预乘 RGBA，背景相关相加须有背景。**

投影 `drop_shadow`、描边 `stroke`、扫光 `light_sweep`、溶解显影 `dissolve_reveal` 与发光的轮廓方式 `glow` 的 `mode: "shape"`（按形状发光，深色字也能发出着色组颜色的光）同样用于图层。工厂是 `shadow`、`stroke`、`lightSweep`、`dissolve`（henji-effects 1.3.0 起），例如 `stroke({ width: 50 })`、`shadow({ softness: 50 })`；锁定更早版本的源码可以直接写描述对象 `{ id: "stroke", params: { width: 50 } }`，参数、范围与报错完全相同。投影产生普通透明度的影子，按普通画面遮挡、过片段边界不受上面的限制；轮廓发光以及扫光、溶解显影的“发光”组产生零 alpha 光，规则同上。光与影都保留产生时的状态，后产生的叠在先产生的上面，所以先放改内容的效果、再放影、最后放光：`[溶解显影, 描边, 扫光, 投影, 发光]`，光晕叠在影子上面而不被影子压暗。`[投影, 溶解显影]` 会让内容消散而影子留着；`[描边, 投影]` 才是描了边的字投下的影子。

henji-effects 1.4.0 起新增：`gradient`（也可作图层 `fill`）、`gradientMap`、`posterize`、`invert`、`halftone`、`ditherPattern`、`paper`、`scratches`、`glitch`、`mirror`、`repeat`、`bulge`、`twirl`、`wave`、`cornerPin`、`displace`、`vignette`（调整层与片段）、`grain`、`lensFlare`、`lightLeak`；参数与内置效果同源，按 `video_edit.builtin_effect` 查实际范围。

`look("风格件名", { 旋钮键: 数值 })` 从 `henji-effects@1.2.0` 起可用。先查当前序列绑定的工程风格副本 `video_edit.project_style.effect_presets`，同名覆盖全局 `video_edit.effect_preset`。读取说明、用途、knobs 的范围和默认值再写；省略旋钮取默认值，未知键、非数值、越界直接报错。映射先求原曲线，再覆盖目标效果实例的参数；两点为线性、多点为分段线性。enabled、amount 和未映射参数的曲线照常生效。

风格件可包含多个内置效果；声音、代码效果、蒙版或只能用于片段的效果不能放进作者图层。缺失和同级重名报错。工程风格件随风格包分享；全局件跨机器另行导入。离屏任务固定启动快照，预览跟随全局库更新。新建或修改前展示具体定义，请用户确认一次；全局写 `video_edit.effect_preset.definition`，归属风格写 `video_edit.style.effect_presets`，导入风格后按原有绑定／升级路径更新工程副本。

```ts
import { glow, blur } from "henji-effects"
export default {
  name: "局部光点", width: 1920, height: 1080, durationSeconds: 4,
  layers(_params, width, height) {
    return [{ id: "light", bounds: [width / 2 - 30, height / 2 - 30, width / 2 + 30, height / 2 + 30],
      effects: t => [blur({ amount: 12 }), glow({ strength: 25 + 10 * Math.sin(t), radius: 30 })],
      draw(ctx) { ctx.fillStyle = "white"; ctx.beginPath(); ctx.arc(width / 2, height / 2, 25, 0, Math.PI * 2); ctx.fill() }
    }]
  }
}
```

## 效果身份 key（API 11）

效果描述可以带稳定身份 `key`：`{ id: 'glow', key: 'titleGlow', params: { … } }`。缺省时 key 就是效果 ID，同一元素里第二个同 ID 的效果为 `glow#2`，风格件为 `look:<名称>`；同一元素里 key 重复直接报错。用户在效果控件里、助手经 `video_edit.code_element` 按 key 改这个元素的效果参数、关掉代码给的效果或在链末追加效果，这些覆盖单独存放，不改源码；改代码时保持元素 id 与 key 不变，否则覆盖会显示为“代码里已没有这个效果”。工厂的 `{ key }` 第二参数随下一版 henji-effects 提供，在那之前直接写效果描述对象。API 10 及更早的代码写 key 会报错。源码新用到的 key 与已有追加效果相同时，追加效果自动换成 `<效果 ID>+N`，代码给的那一项保留这个 key。
