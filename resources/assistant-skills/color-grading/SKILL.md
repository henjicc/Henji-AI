---
name: color-grading
description: 在剪辑或图片编辑里调色时使用：校正曝光与白平衡、统一镜头颜色、套用电影感/日系/胶片等风格、调肤色与天空、检查调色结果。时间线其他操作用 video-edit-workbench，修图与选区用 image-edit-workbench。
---

# 全能调色：先读数，再调参，调完再读数

## 铁律

1. **偏色和曝光看读数，不看截图。** 视觉模型对细微色偏、曝光判断不准。剪辑用 `observe_video_edit_color`，图片用 `observe_image_edit_color`，读中灰偏差（EV）、高光/暗部溢出、估计光源色温与可信度、肤色候选。截图只用来判断内容和风格。
2. **参数写入走通用属性。** 剪辑写 `video_edit.effect.parameters`（片段下 `definition_id=effect:color_grade` 的效果），图片写 `image_edit.layer.params`（`definition_id=color_grade` 的调整层）。写入是整个对象替换：先读现有参数，合并后再写；一次写入就是一步撤销。没有“设置色温”之类的专用工具。
3. **分析与匹配是建议。** `analyze_video_edit_color`（自动校色、参考镜头匹配）和 `analyze_image_edit_color`（图片自动校色，或传 `referenceRef` 拿另一张图做参考）只返回绝对建议值，不改作品；按返回说明合并或整体替换后写入。
4. **调完再读一次。** 写入后用同一个 observe 工具读 after 读数，对照下面的验收数值；不达标就再调，达标后再给用户看结果。

工具按需加载：内置 Pi 用 `load_application_tools({names:[...]})`，只加载这一步要用的。剪辑：`observe_video_edit_color`、`analyze_video_edit_color`、`export_video_edit_color_lut`；图片：`observe_image_edit_color`、`analyze_image_edit_color`、`export_image_edit_color_lut`。

## 固定顺序

1. **观察**：读调色前读数（剪辑 `stage=before_grade` 或片段还没有全能调色时的 `after_grade`；图片 `stage=before_grade` 配合调整层引用）。记下画面基调：`key=low` 是低调画面（夜景、舞台），`high` 是高调画面（雪景、白底），不要把它们硬拉到中灰。
2. **一级校正**：先白平衡和曝光，再黑白点与反差，最后饱和度。可以先调 analyze 拿建议；白平衡可信度低于 0.4 时画面可能是有意偏色（日落、霓虹），只做部分校正或保留。
3. **镜头匹配**（剪辑）：`analyze_video_edit_color` 传 `referenceClipRef`（同序列已调好的参考镜头），默认 `matchMethod=mkl`，返回可直接微调的滑块值；整体替换参数，并在同一事务把被替换参数的 `frame_curves` 清掉。多个镜头逐个对同一参考匹配。图片同理：`analyze_image_edit_color` 传 `referenceRef`（素材、生成结果、画布节点或另一份图片文档），返回 `apply=replace`，把返回的七个滑块整体写成该调整层的 `params`。
4. **风格**：从[风格词典](references/styles.md)选最接近用户描述的配方，按强度（0–1）缩放后合并写入；风格不包含白平衡和曝光，不会覆盖一级校正。用户描述模糊时提出 2–3 个候选配方（名称 + 一句话效果），让用户选。
5. **二级**：肤色、天空、单一颜色用混色器（8 色 × 色相/饱和度/明亮度）；需要精确选区时用 HSL 辅助，先开蒙版观察再校正，完成后关闭蒙版。
6. **检查**：读 after 读数和画面，写明哪些已验证、哪些只是建议。
7. **导出（用户要带到别的软件时）**：`export_video_edit_color_lut`（剪辑效果引用，可指定帧）/ `export_image_edit_color_lut`（调整层或调色滤镜引用）写出 `.cube`（默认 33 格点；要更精确用 65）或 `.cdl`。CDL 只能表达每通道斜率/偏移/幂与整体饱和度，调色里有混色器、色相曲线、HSL 辅助、LUT 或明显对比度时会被拒绝，改导出 cube。告诉用户回执里的 `omitted`（锐化、晕影、效果强度、蒙版等不进文件）和读回色差。

## 验收数值（起点，按用途突破）

| 项 | 目标 |
|---|---|
| 中灰曝光偏差 | 普通画面 \|EV\| ≤ 0.3；低调/高调画面保持原基调 |
| 高光溢出 / 暗部死黑 | ≤ 0.5%，除非是有意的纯白背景或剪影 |
| 白平衡 | 可信度 ≥ 0.6 时估计光源接近 6500 K（±400 K） |
| 肤色 | 肤色候选足够时 `hueOffsetDegrees` 在 ±8° 内 |
| 过饱和 | `oversaturatedPercent` ≤ 2% |

## 参数速查

| 参数 | 单位与用法 |
|---|---|
| `temperature_kelvin` | 光源色温（K），6500 不变。读数给出的估计光源直接写入即可中和；数值越低画面越冷 |
| `tint` | ±100，正值偏洋红，校正荧光灯偏绿用正值 |
| `exposure` | EV，+1 亮度翻倍；先用它把中灰拉回，再用高光/阴影/白/黑收尾 |
| `contrast` | 围绕中灰的斜率，只作用亮度、不改色相；+100 斜率 3 倍 |
| `highlights` `shadows` `whites` `blacks` | ±100；高光溢出用 `highlights`/`whites` 负值回收，不要压整体曝光 |
| `tone_highlights` `tone_lights` `tone_darks` `tone_shadows` | 参数曲线四段，±100，端点不动；比写曲线控制点稳 |
| `saturation` / `vibrance` | OkLCh 彩度；自然饱和度保护肤色，优先用它 |
| `mixer_<色>_hue/saturation/luminance` | 色名：red orange yellow green aqua blue purple magenta；±100 |
| `wheel_mode` | `grading`（分级：shadow/midtone/highlight/global 染色 + `grade_blending`/`grade_balance`）或 `primary`（Lift/Gamma/Gain/Offset） |
| `<区>_hue` / `<区>_strength` / `<区>_luminance` | 色轮：色相角 0 红 60 黄 120 绿 180 青 240 蓝 300 洋红；强度 0 不染色 |

曲线控制点、LUT、HSL 辅助与晕影的字段契约以 describe 返回的参数 schema 为准。
