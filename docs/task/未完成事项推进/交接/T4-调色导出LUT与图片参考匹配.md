# T4 交接：全能调色导出 .cube / .cdl 与图片参考匹配

日期：2026-10-27。来源：`docs/task/全能调色完善/00-任务总览.md`“阶段 3–4 未完成部分”中的“导出 .cube/.cdl”“图片参考匹配（拿另一张图做参考）”。两项都已完成；未改剪辑引擎（`src/features/videoEdit/engine/**`）。

## 1. 实现要点

### 1.1 导出 .cube / .cdl

**能力分级**：能力增量（新增文件写入副作用 + 算法型操作）。“把调色烘焙成 LUT / 拟合 CDL 并写文件”无法用属性写入表达，按算法型专用能力处理；参数本身的读写仍走通用属性，没有新增实体或属性。

**助手调用**（两个域各一个，算法与写文件共用 `src/services/colorGradeExport.ts`）：

| 能力 | 目标 | 参数 |
|---|---|---|
| `export_video_edit_color_lut` | `documentRef` + `effectRef`（`video_edit.effect`，片段上的全能调色效果） | `frame?`（序列帧，须在片段内；调色带关键帧时按该帧求值，省略取播放头，播放头不在片段内取片段首帧）、`format`、`lutSize?`、`path`、`overwrite?` |
| `export_image_edit_color_lut` | `layerRef`（`image_edit.layer` 调整层，或 `image_edit.layer_filter` 图层上的调色滤镜） | `format`、`lutSize?`、`path`、`overwrite?` |

- `format`：`cube`（3D LUT，逐格点精确求值）或 `cdl`（ASC CDL v1.01 XML，拟合近似）。
- `lutSize`：17 / 33 / 65，默认 **33**。理由：33 是 Resolve、Premiere、OBS 等通用默认值，文件约 0.95 MB，实测误差已远低于可见阈值（见下表）；65 精度更高但约 7.2 MB、生成需数秒、部分软件与相机不接受，作为“高精度”选项；17 只给有尺寸限制的设备。
- `path` 扩展名必须与格式一致；目标存在且未传 `overwrite` 时写入前拒绝。
- 回执：`path / format / lutSize / bytes / omitted / approximated / inexpressible / cdl? / accuracy{meanDeltaE,maxDeltaE,samples} / message / verification`；剪辑另带 `clipRef` 与实际使用的 `frame`。
- 写入前的一切失败（扩展名、已存在、效果不是全能调色、帧越界、LUT 资源丢失、CDL 表达不了、计算失败）抛 `ColorGradeExportRejection`，处理器包成 `notExecutedFailure`，执行层判为“没有执行”，修正后可直接重试。
- 成功证据：写出后用正式解析器读回（`.cube` 用 `parseCubeLut`，`.cdl` 用 `parseAscCdl`），对 512 个测试色与正式调色比较 CIEDE2000；`cube` 平均 ≤1、`cdl` 平均 ≤3 才 `verified=true`。

**色彩空间与工作域**：调色在两宿主都是“sRGB 原色（同 Rec.709）的 sRGB 编码值”上执行（图片端 `applyImageColorGradeV3` 先换到 `srgb/srgb` 再进 `executeColorGradeCpuPlan`；剪辑端同一份 `planColorGrade` + 共享 WGSL）。因此 LUT 输入 = 调色前编码值，输出 = 调色后编码值，`DOMAIN 0–1`，输出裁切到 0–1（显示参考）。文件注释与 CDL `Description` 写明了这一点。真值就是正式 CPU 调色执行器（与 WGSL 对照过的同一份实现），逐格点求值，没有任何拟合。

**进不了 LUT 的部分（如实列在回执 `omitted` / `approximated`，并写进文件注释）**：
- 去掉：锐化、HSL 选区锐化、晕影（依赖相邻像素或画面位置）；剪辑的效果强度 <100% 与作用区域；图片的不透明度 <100%、非正常混合模式、蒙版（属于合成，文件按 100% 写入）。
- 近似：HSL 辅助开了键控去噪/模糊时，按未平滑的选区逐色计算（选区边缘比画面里硬）。
- 输入 LUT、创意 Look 会一起烘焙进 `.cube`（读取项目里已导入的 LUT 资源）。

**CDL**：10 个参数（每通道 slope/offset/power + saturation），对 9³ 格点在 OkLab 中用 Levenberg–Marquardt 最小二乘拟合正式调色（已在已知 CDL 上验证可精确还原）。拟合后平均 ΔE2000 > 3 时写入前拒绝，消息点名主因（混色器、色相曲线、HSL 辅助、LUT、分级色轮的明暗分区）并建议改导 `.cube`；通过时回执 `inexpressible` 仍列出这些“只能整体近似”的部分。

**误差实测**（512 个 Roberts R3 准随机测试色，不落在任何格点上；ΔE2000 平均 / 最大）：

| 调色 | 17 格 | 33 格 | 65 格 | CDL |
|---|---|---|---|---|
| 白平衡 5600 K + 曝光 0.2 | 0.07 / 1.49 | 0.02 / 0.37 | 0.008 / 0.24 | 0.94 / 2.31（通过） |
| 白平衡 5200 K + 曝光 0.3 + 饱和度 12 | 0.15 / 1.65 | 0.04 / 0.63 | 0.01 / 0.28 | 1.51 / 7.34（通过） |
| 一级色轮 LGG + 曝光 | 0.06 / 1.09 | 0.01 / 0.59 | 0.005 / 0.31 | 0.03 / 0.19（通过） |
| 对比度 10 | 0.20 / 1.93 | 0.05 / 0.92 | 0.014 / 0.45 | 2.34 / 19.6（通过但最大误差大） |
| 基本校正（色温、色调、对比 20、饱和、高光阴影） | 0.33 / 2.00 | 0.10 / 1.49 | 0.03 / 0.63 | 7.0（拒绝） |
| 创意（混色器、色相曲线、分级色轮、点曲线、淡化） | 0.54 / 7.55 | 0.18 / 3.47 | 0.06 / 1.55 | 7.3（拒绝） |

耗时（node，单线程）：33 格 0.2–0.9 s，65 格 1.5–5.7 s，CDL 约 0.6 s。因此求值放在 Worker（`colorGradeExport.worker.ts`），界面与助手调用都不阻塞渲染线程。

**界面入口**（遵守“面板要安静”）：两宿主全能调色面板顶部现有动作行（自动 / 按住对比 / 重置）末尾加一个静默图标按钮（`FileDown`，tooltip“导出调色为 LUT 或 CDL”），点开是三项动作菜单：导出 3D LUT（33 格点）、导出高精度 3D LUT（65 格点）、导出 ASC CDL（近似）。不加强调色、不占新行。选路径走 PAL 的系统保存对话框（`saveDialog`，由对话框确认覆盖），完成后用 `notifyUser` 一句话回报（含读回色差、未包含项）；失败走面板原有的错误出口。共用组件 `src/components/colorGrade/ColorGradeExportButton.tsx`（领域组合件，放在 `components/colorGrade/`，不是 `components/ui` 原件，不登记复用表，与记录 006 一致）。

### 1.2 图片参考匹配

**能力分级**：能力增量，但不新增工具——扩展已有算法能力 `analyze_image_edit_color`（与剪辑 `analyze_video_edit_color` + `referenceClipRef` 对称）。写入仍走通用属性 `image_edit.layer.params`。

**助手调用**：`analyze_image_edit_color` 新增可选 `referenceRef`，接受 `asset`（素材库图片）、`generation.result`、`image_edit.preview`、`canvas.node`（画布节点；带图片编辑会话的节点按该文档当前合成结果读取，否则读节点图片）、`image_edit.document`（另一份图片文档的当前合成）。回执新增 `apply`：
- 不传参考：自动校色，`apply=merge`，返回 `temperature_kelvin/tint/exposure`，合并后写入（行为与之前一致）。
- 传参考：`apply=replace`，返回七个滑块 `temperature_kelvin/tint/exposure/contrast/saturation/highlights/shadows`，用这组值**整体**写成调整层 `params`（其余参数回到默认，避免旧调色叠加；与剪辑匹配“整体替换”同一语义）。一次写入即一步撤销。

**算法复用**：`suggestImageEditColorV3` 在有参考像素时直接调用剪辑同一个 `suggestColorGradeMklMatch`（OkLab Pitié–Kokaram MKL + Nelder–Mead 反拟合到七个滑块），只取这七个键；没有复制算法。源画面仍是“隐藏该调色层后的合成”（与自动校色同一读取器），参考画面统一缩到长边 ≤256 px。

**界面**：图片调色面板动作行下新增一行“校色参考”：按钮“选择参考图片”（系统打开对话框选本机图片，含素材库所在文件夹里的文件），选中后显示文件名，旁边一个清除按钮；有参考时“自动”按钮变为“匹配颜色”。匹配结果经 `commitLayerParamsPreview` 写入，一步撤销，可再在滑块上微调。

## 2. 改动文件

| 文件 | 作用 |
|---|---|
| `src/core/imaging/lut/colorGradeExport.ts`（新） | 导出核心：空间操作剔除、正式 CPU 调色逐色求值、.cube 生成、CDL 公式/拟合/读写、读回误差测量 |
| `src/core/imaging/lut/colorGradeExport.worker.ts`（新） | 在 Worker 里生成导出文本 |
| `src/core/imaging/lut/colorGradeExport.test.ts`（新） | LUT 读回误差、格点顺序、恒等、CDL 读回与拒绝 |
| `src/services/colorGradeExport.ts`（新） | 唯一导出入口：扩展名/覆盖检查、Worker 求值、写文件、读回核对、日志、回执与界面保存对话框 |
| `src/services/colorGradeExport.test.ts`（新） | 写入前拒绝不落盘、读回核对、CDL 回执 |
| `src/features/videoEdit/application/videoEditColorGradeExport.ts`（新） | 剪辑：定位效果、按帧求值关键帧、读项目 LUT、列出强度/作用区域 |
| `src/features/videoEdit/application/videoEditColorGradeExport.test.ts`（新） | 公共能力端到端：按帧求值、回执、不改剪辑、越界/非调色/已存在拒绝 |
| `src/features/videoEdit/application/applicationDomain.ts` | 注册 `export_video_edit_color_lut` 处理器 |
| `src/features/videoEdit/panels/VideoEditColorGradePanel.tsx` | 动作行加导出菜单 |
| `src/features/imageEdit/v3/application/imageEditColorGradeExportV3.ts`（新） | 图片：定位调色层/调色滤镜、读 LUT 资源、列出不透明度/混合/蒙版 |
| `src/features/imageEdit/v3/application/imageEditColorGradeExportV3.test.ts`（新） | 公共能力端到端（调整层 cube、调色滤镜 cdl、非调色层拒绝）与文档参考读取 |
| `src/features/imageEdit/v3/application/imageEditColorReferenceV3.ts`（新） | 参考画面读取（文件、素材、生成结果、预览、画布节点、图片文档） |
| `src/features/imageEdit/v3/application/imageEditColorObservationV3.ts` | `suggestImageEditColorV3` 支持参考像素，返回 `{parameters, apply}` |
| `src/features/imageEdit/v3/application/imageEditColorObservationV3.test.ts` | 适配新返回值；新增参考匹配用例 |
| `src/features/imageEdit/v3/editor/ImageEditorColorGradeParametersV3.tsx` | “校色参考”行、匹配写入、导出菜单 |
| `src/features/imageEdit/application/registerImageEditCapabilityHandlers.ts` | `analyze_image_edit_color` 接参考；注册 `export_image_edit_color_lut` |
| `src/components/colorGrade/ColorGradeExportButton.tsx`（新） | 两宿主共用的导出图标按钮 + 菜单 |
| `src/core/application-control/domains/shared/colorGradeExportSchema.ts`（新） | 两个导出能力共用的输入/回执 schema 与描述 |
| `src/core/application-control/domains/imageEdit/imageEditColorCapabilities.ts` | `analyze_image_edit_color` 加 `referenceRef`/`apply`；新增 `export_image_edit_color_lut` |
| `src/core/application-control/domains/videoEdit/videoEditColorGradeCapability.ts` | 新增 `export_video_edit_color_lut` |
| `src/core/application-control/domains/videoEdit/videoEditApplicationCapabilities.ts` | 把剪辑导出能力并入剪辑能力列表 |
| `src/core/application-control/builtinApplicationCapabilityRegistry.ts` | 登记图片导出能力 |
| `electron/main/services/application-runtime/outputContract.test.ts` | 三个能力的代表性回执样本 |
| `resources/assistant-skills/color-grading/SKILL.md` | 技能补充：图片参考匹配、导出步骤与限制 |
| `docs/rules/assistant-status.md` | 台账顶部新增 2026-10-27 条目 |

## 3. 验证

实际执行（均在本工作树）：

- `npx vitest run src/core/imaging/lut src/services/colorGradeExport.test.ts src/features/videoEdit/application/videoEditColorGradeExport.test.ts src/features/imageEdit/v3/application/imageEditColorGradeExportV3.test.ts src/features/imageEdit/v3/application/imageEditColorObservationV3.test.ts src/core/imaging/adjustments electron/main/services/application-runtime/outputContract.test.ts`：全部通过（toolCatalog 指纹见第 5 节）。
- `npx vitest run src/core/application-control/applicationControlCoverage.test.ts src/features/application-control/externalCapabilityInventory.test.ts src/core/application-control/domains/videoEdit/videoEditAssistantDescriptions.test.ts src/core/application-control/domains/imageEdit/imageEditPreviewSchemaContract.test.ts src/core/application-control/domains/assistantSkill/colorGradingSkill.test.ts src/features/imageEdit/v3/editor/ImageEditorColorGradeParametersV3.test.tsx src/features/videoEdit/application/videoEditColorGrade.test.tsx src/components/colorGrade/ColorGradeSections.test.tsx electron/main/services/embedded-agent/piEngine.test.ts`：全部通过。
- `node scripts/check-assistant-capabilities.cjs`：通过。
- `node scripts/check-color-tokens.cjs`、`check-surface-tokens.cjs`（0 错误；本次文件里的 S8 告警都是原有行）、`check-icon-tokens.cjs --strict`、`ui-residue-scan.cjs --strict --no-report`、`check-ui-design.cjs`（4 处问题均不在本次文件）：通过。
- 改动文件 eslint：0 问题。
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p tsconfig.electron.json --noEmit`：通过（exit 0）。

未覆盖：
- 渲染层 `tsc -p tsconfig.json` 按约定由主控跑。
- Worker 在测试里用同协议的内联替身执行；真实 Worker 加载、系统保存/打开对话框、`readFile` 读本机参考图、`createImageBitmap` 解码、图片端真实合成读取器只在真实 Electron 里成立，未跑。
- 剪辑 `check:application-control-invariants` 聚合套件未跑（本次没有新增实体、属性、集合或 store 动作）。
- 内置 Pi / 外部 MCP 端到端（`assistant:cli`）未跑。
- 导出的 .cube 在 Resolve/Premiere 等第三方软件里的加载未实测；格式按 Adobe Cube LUT 1.0 规范（红最快、`TITLE`、`LUT_3D_SIZE`、`DOMAIN_MIN/MAX`），已用本项目严格解析器读回。

## 4. 需要用户在真实开发版里确认

1. 剪辑：选一个带全能调色的片段，在全能调色面板顶部点导出图标 → “导出 3D LUT（.cube，33 格点）”，保存后应出现一句通知（含平均色差）；再把这个 .cube 作为另一个片段的“创意 Look”导入，对比两段画面应一致（锐化、晕影不在 LUT 里）。
2. 同一处选“导出 ASC CDL”：只有白平衡/曝光/轻微饱和度时应成功；加上混色器或较大对比度时应提示“无法用 CDL 表达……请改为导出 .cube”，且不生成文件。
3. 片段调色带关键帧时，把播放头放在不同位置导出，结果应跟着当前帧的参数变。
4. 图片编辑：调整层面板里点“选择参考图片”选一张本机图片，按钮变成“匹配颜色”，点一下后画面向参考靠拢，滑块出现色温/色调/曝光/对比度/饱和度/高光/阴影的值；Ctrl+Z 一步撤回；点清除后按钮回到“自动”。
5. 图片调色面板同样能导出 .cube / .cdl。
6. 窄停靠宽度下顶部动作行多一个图标后不折行、不裁切（`--dev-checks` 下布局守卫无命中）。

## 5. 对外契约版本 / 指纹

`electron/main/services/application-runtime/toolCatalog.test.ts` 指纹用例失败（预期，已按约定不改版本与指纹）。最后一次运行的失败原文：

```
FAIL electron/main/services/application-runtime/toolCatalog.test.ts > 对外工具目录的投影与授权过滤 > 公开 tools/list 的规范化指纹与契约版本绑定，变更须显式升级版本
AssertionError: 工具参数/说明/输出变化时须升级 EXTERNAL_CONTRACT_VERSION，再登记该版本指纹：edca68df0b82021365d99eb4de7be84f8d5a227895f6394cceadde1f0a10a1fc: expected 'dbc2d8d4ff9b79bcc84137b94862ce87fda04…' to be 'edca68df0b82021365d99eb4de7be84f8d5a2…' // Object.is equality
```

- 当前 `EXTERNAL_CONTRACT_VERSION = '2.74.0'`。建议升到 **2.75.0**（新增两个工具 + `analyze_image_edit_color` 新增可选输入与回执字段，向后兼容，次版本号），登记注释可写：`Color grade export: export_video_edit_color_lut / export_image_edit_color_lut (.cube/.cdl); analyze_image_edit_color referenceRef + apply.`
- 注意：上面的指纹 `edca68df…` 是在本工作树“当时全部未提交改动”上算的，工作树里还有其他子代理的改动；主控合并后需要重新跑一次取最终指纹。
- `outputContract.test.ts` 已补三个能力的代表性回执，通过。
- 台账 `docs/rules/assistant-status.md`：已更新（顶部 2026-10-27 条目，属于第零节第 1 条“不通 → 通”）。

## 6. 风险与遗留

1. **发现的渲染缺陷（未修，不在本任务范围，建议单独处理）**：`src/core/imaging/adjustments/unifiedGrade.ts` 的 `gradeContrastSlope` 与 `src/core/imaging/effects/wgsl/colorGradeUnified.ts` 的 `cgContrastSlope` 在“对比度 > 0 且亮度经曝光等推过 1”时不连续：感知亮度刚低于 1 时彩度缩放按指数衰减到接近 0（近白），刚超过 1 时直接返回 1（恢复全彩度）。实测曝光 +0.4、对比度 +20 时，输入 (0.968, 0.895, 0.196) 输出蓝通道 0.899，再亮 1/256 输出蓝通道跳到 0.128，ΔE 约 27，画面里表现为亮黄/亮橙高光处出现断层色带。CPU 与 WGSL 同源，导出的 LUT 也忠实复现了这处断层（这类调色 33 格 LUT 的最大误差也因此偏大）。建议修法：`perceptual > 1` 时用 `perceptual = 1` 处的斜率（两处同改），并重跑 `videoEditColorGrade.gpu.test.ts` 对照与 `unifiedGrade.test.ts`；会改变已有工程高光处的观感，需要用户确认。
2. CDL 的通过阈值（平均 ΔE ≤ 3）对“对比度 10”这类调色会通过但最大误差约 20（饱和色区域）；回执与文件 `Description` 都写了平均/最大色差，助手技能也提示告诉用户。是否收紧到同时限制最大误差，待用户决定。
3. 图片界面的参考只做了“本机图片文件”；素材库/画布节点/另一份图片文档作为参考目前只有助手可用（`referenceRef`）。项目里没有现成的“素材选择器”组件，界面内选素材库或画布节点需要先有统一的选择入口。
4. 菜单栏（`contributeAppMenus`）没有加导出入口：剪辑工作区目前本身没有菜单栏贡献，图片编辑的菜单由其他任务维护；只在面板动作行提供。
5. `electron/main/services/embedded-agent/toolDisclosureProfiles.ts` 的剪辑创意工具预披露名单没有加 `export_video_edit_color_lut`（不在本代理文件范围）；Pi 仍可按需 `load_application_tools` 加载，技能里已写工具名。
6. 既有问题（未改）：`analyze_image_edit_color` / `observe_image_edit_color` 的 `layerRef` 只接受 `image_edit.layer`，对图层上的调色滤镜，经公共入口会被“实体不存在”拒绝；新导出能力已接受 `image_edit.layer_filter`。
7. 图片参考读取 `image_edit.document` 时，若该文档未打开会调用 `ensureImageEditDocumentInstanceV3` 加载一份实例（只读用途，不修改）。

## 7. 建议提交（两项分开）

**提交 1**：`feat(color-grade): 全能调色可导出 .cube 3D LUT 与 ASC CDL`

- `src/core/imaging/lut/colorGradeExport.ts`、`colorGradeExport.worker.ts`、`colorGradeExport.test.ts`
- `src/services/colorGradeExport.ts`、`colorGradeExport.test.ts`
- `src/features/videoEdit/application/videoEditColorGradeExport.ts`、`videoEditColorGradeExport.test.ts`、`applicationDomain.ts`
- `src/features/videoEdit/panels/VideoEditColorGradePanel.tsx`
- `src/features/imageEdit/v3/application/imageEditColorGradeExportV3.ts`、`imageEditColorGradeExportV3.test.ts`（其中第三个用例“参考可以是另一份图片文档”依赖提交 2 的 `imageEditColorReferenceV3.ts`，可挪到提交 2 或两提交合并时一起）
- `src/components/colorGrade/ColorGradeExportButton.tsx`
- `src/core/application-control/domains/shared/colorGradeExportSchema.ts`、`domains/videoEdit/videoEditColorGradeCapability.ts`、`domains/videoEdit/videoEditApplicationCapabilities.ts`、`builtinApplicationCapabilityRegistry.ts`
- `src/core/application-control/domains/imageEdit/imageEditColorCapabilities.ts`、`src/features/imageEdit/application/registerImageEditCapabilityHandlers.ts`、`src/features/imageEdit/v3/editor/ImageEditorColorGradeParametersV3.tsx`（这三个文件同时含提交 2 的改动，按 hunk 拆分或与提交 2 合并）
- `electron/main/services/application-runtime/outputContract.test.ts`、`resources/assistant-skills/color-grading/SKILL.md`、`docs/rules/assistant-status.md`、契约版本与指纹（主控）

**提交 2**：`feat(color-grade): 图片调色可拿另一张图做参考匹配颜色`

- `src/features/imageEdit/v3/application/imageEditColorReferenceV3.ts`
- `src/features/imageEdit/v3/application/imageEditColorObservationV3.ts`、`imageEditColorObservationV3.test.ts`
- 上面三个共享文件中参考匹配相关的 hunk（`analyze_image_edit_color` 的 `referenceRef`/`apply`、处理器读参考、面板“校色参考”行与匹配写入）

若按 hunk 拆分成本高，建议两项合并为一个提交：`feat(color-grade): 全能调色导出 .cube/.cdl 与图片参考匹配`。
