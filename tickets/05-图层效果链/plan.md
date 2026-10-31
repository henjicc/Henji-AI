# 05 图层效果链与 henji-effects（以后再做第 13 项第一批第一步）
摘要：让作者代码的图层直接挂宿主内置效果（发光、色差、模糊等），宿主在“图层纹理 → 合成”之间用 GPU 执行；`pose.blur` 并入同一条链。
提供薄作者库 `henji-effects`（只返回描述，类型由效果登记表生成），技能文档改成“风格件 → 内置效果 → 自己写”三档，代码复核提示手写阴影/模糊/发光。
分级：大（作者接口 + 剪辑渲染 Worker + 技能）；执行 Codex Astra high；设计审查、实现交叉审查（Opus xhigh）与 /code-review；效果观感验收归 Claude。

## 依据
- 方案：docs/task/代码效果与渲染改进/效果库.md（“已定的决定”1、3、7，“代码设计”1、3、4、5、8，“效果样板：发光”）。
- 样板：发光 `src/core/videoEdit/glow.ts` + `src/features/videoEdit/engine/` 下发光实现（提交 eefb5173b）；色差 `chromaticAberration.ts`；包含 `effectIncludes.ts`。
- 现状：作者图层虚化 `videoEditAuthorRuntime.ts`（Canvas2D blur）与 `videoEditAuthorGpu.ts`（lens）；片段效果链 `videoEditCodeGpu.ts` 的 builtin。

## 范围（本 ticket 做）
1. 效果定义补 `space: 'layer' | 'frame' | 'clip'` 与 `bleed(params, reference)`；只有 layer 类可挂图层。第一步至少接通：发光、色差、模糊（均匀/方向/放射/镜头四方式按现有实现转发）、锐化、调色、黑白、马赛克——以现有实现为准，没有现成 GPU 实现的不新写。
2. 作者图层 `effects?: (t) => EffectDescriptor[]`（与 `pose` 同样按时间求值）：宿主按顺序执行，图层栅格按 bleed 外扩（参数随时间变化按档位取整，沿用图层虚化边距做法）；整条链一次提交；效果在图层自身坐标里算（先效果后变换），空间量按参考高度换算，随预览降分辨率与推近栅格倍率一致。
3. 透明图层上的光：发光类效果交出“叠在下方”的第二张纹理，按相加叠到下方画面（方案“代码设计”3）；投影类的“普通叠在下方”留接口不实现。
4. `pose.blur`（含 `blurShape`）改由 GPU 模糊执行，写法不变；与 Canvas2D 模糊人眼对比无差别即可。
5. `henji-effects` 作者库：`glow()`、`blur()` 等工厂只返回 `{ id, params }`；类型（参数范围、单位、分组、说明进 JSDoc）由登记表生成并纳入现有作者类型产物；未知参数/越界在作者类型检查与运行时都报清楚。`look(名字, 旋钮?)` 先按名字解析现有效果预设（风格包优先、全局其次），旋钮留空——风格件格式升级不在本 ticket。
6. 观察与复核：取帧读回报出每层挂的效果与实际参数；代码复核静态检查手写 `shadowBlur`、`filter: blur()` 或发光算法而库里有对应效果时给提示。
7. 技能文档：author-api.md 增加 effects 与 henji-effects；三档规则写进 video-edit-code-creation 技能（按 henji-application-capability 做覆盖分级，不新增 MCP 工具）。

## 不做
执行器的逐点合并/金字塔共用/距离场（下一步）；投影、描边、扫光、溶解显影等新效果（批 F）；风格件格式与旋钮；调整层；“点选画面元素来调整”；测量基线（等显卡空闲）。

## 验收
- 片子类场景：透明底标题挂发光，叠在深色与浅色背景上都不发灰（相加），停住时不抖、不闪；参数动画连续。
- 预渲染与导出同结果（同一执行器）；帧指纹（ticket 01）随效果参数变化正确失效，未变不失效。
- `pose.blur` 旧工程画面人眼无差别。
- L2 验证 + check:assistant-capabilities + 作者类型产物检查通过；真实设备着色器用例补“图层发光相加”。
- 真机：Claude 在开发版建测试时间线目视验收（不动《元宝搜索》工程）。

## 依赖与顺序
等 ticket 03 合并后在 worktree `task/05-图层效果链` 开工（同改渲染 Worker 相邻文件）。
