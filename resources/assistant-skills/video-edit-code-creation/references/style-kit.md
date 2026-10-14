# 风格模板：建、用、自查、演进

风格模板（风格包）是用户的个人风格档案，一个用户可以有多套。它约束代码画面、文字、标题模板、字幕、关键帧和就地生成，让每次产出都像同一个人做的。风格属于用户：内容来自用户的选择和明确评价，不能把你自己挑的方向写成用户口味。

## 放在哪里

| 位置 | 实体 | 用途 |
| --- | --- | --- |
| 本机风格库 | `video_edit.style_preset` | 内置三套（只读）＋个人风格，跨工程复用 |
| 工程快照 | `video_edit.style_kit` | 应用到工程时复制一份，本机库删改不影响已有工程 |
| 生效绑定 | `video_edit.sequence.style_kit_id`、`video_edit.clip.style_kit_id` | 绑定序列才生效；片段可覆盖 |

`video_edit.style_kit.content`（个人预设同名属性）是完整档案：

- profile：summary 一句话定位、scenarios 适用场景、concepts 抽象概念。
- tokens：配色、字体、字号阶梯、形状、质感、版式、motion 动效。
- rhythm：可选剪辑节奏，auto 或 null 表示不约束。
- caption.treatment：字幕处理，outline 描边字、plate 半透明底板、pop 粗描边花字；字幕“跟随风格”按它生成。
- rules：做 / 不做 / 统一 / 可变，每条带强度与适用范围。
- notes：补充说明；generation：就地生成是否注入；samples：样张组件。

`video_edit.style_kit.keyframe_curves` 只读，给出五种动作的关键帧曲线。

## 设计规则：每条入库内容都要满足

1. **可执行、可检验、有强度。** 能映射到真实参数或能力；取帧或读回后能判断有没有违反；strength 写 must（违反即返工）、prefer（默认遵守，偏离要说理由）或 flexible（可破例，写明情形）。“要高级感”“要有感觉”不能入库，先翻译。
2. **抽象概念必须翻译。** concepts 每项写 meaning 含义、criteria 判据（至少一条，取帧可判断）、tendencies 参数倾向、positive 正例、negative 反例、strength 与 exceptions。翻译稿先给用户看，确认后写入。
3. **写清统一与变化。** keep 规则列全片必须一致的项（强调色职责、标题字体、圆角线宽）；vary 规则列允许浮动的项和范围（时长 ±20%、方向随语义）。只有 keep 会让 AI 死板，只有 vary 会跑偏。
4. **优先级固定。** 用户本次明确要求 > 绑定的风格 > 共享记忆里的跨风格口味 > 技能默认值。本次临时要求只用于本次，不写回风格。
5. **动效写成令牌。** 入场、出场、移动、强调、转场各有曲线与时长；曲线写缓动名或贝塞尔 [x1,y1,x2,y2]，y 超出 0–1 即回弹，需同时 allowOvershoot=true。travel 是位移幅度（画高比例），settle 要求落地静止，readingSpeed 与 minHold 决定停留时长，sync 决定动作落点对齐语音还是节拍。

入库前自查：每个概念至少一条判据；每条规则有强度；没有互相矛盾的 do 与 dont；节奏没想清楚就保持 auto，不硬填。

## 建一套风格

1. **定来源。** 参考素材用 `extract_video_edit_reference_style`（只给配色，气质靠读图补）；现有作品用 `extract_video_edit_work_style`；只有描述时，以最接近的内置预设 content 为底。三者可以混用。
2. **出两到三个方向。** 方向之间至少在两条风格轴上明显不同（见 styles.md 五轴）。每个方向写成完整 content，名字带“方向A/B/C”，用 `change_application_entities` 在当前工程创建为 `video_edit.style_kit`，不绑定。所有方向沿用同一组 samples，用户在风格面板切换即可对比同一套样张。需要亲自取帧比较时，新建一条“风格样张”序列，用 `insert_video_edit_style_component` 放入同一组样张，再用 `observe_video_edit_frame` 取帧；交付时告诉用户这条序列可以删除。
3. **用户挑选并给意见。** 把意见翻译成概念或规则（按设计规则 2），把翻译稿给用户确认，再改 content。只改样张不满意的部分，不推倒重来。
4. **命名、写适用场景、存库。** 确认的方向写入 `video_edit.style_preset`（本机库，跨工程可用），需要时绑定当前序列；删除没选中的候选。

## 用风格做东西

- **开工先读。** 宿主上下文给出当前风格摘要；动手前用 `read_application_entity` 读完整 content。方案里引用要用的条目，例如“按『留白』：同屏一个焦点”。
- **代码画面。** 一律引用 ctx.style（路径见 author-api）。曲线用 tween 或 ease 传 ctx.style.motion.enterEase 等，名字和贝塞尔都接受；时长用对应 duration，位移用 travel×画高。
- **文字、标题、字幕。** 序列绑定风格后，新建文字、图形文字、内置标题模板和无样式字幕都已按风格取默认字体、字号、颜色与入出场曲线。不要再手动改成另一套，除非用户要求。字幕样式下拉里有“跟随风格”预设。
- **关键帧。** 读 `video_edit.style_kit.keyframe_curves`，把动作起点关键帧设为对应角色的 interpolation 与 bezier，两帧间隔取 durationSeconds。
- **停留时长。** 一行字至少停留：字数 ÷ readingSpeed ＋ minHold 秒，不为凑节奏压缩阅读。
- **节奏。** rhythm 中不是 auto 的项要遵守：镜头时长区间、切点、主转场、音效密度、人声时压低音乐。
- **就地生成。** 默认把风格定位、概念和配色并入画面提示词，准备结果的 stylePrompt 会显示注入了什么。用户这次要别的画风时，传 applyStyle=false。

## 交付前自查

1. 逐条 must 规则与 must 概念的判据：取受影响画面读图或读回参数，违反就改，不带病交付。
2. prefer 项偏离时写明理由；flexible 破例时说明属于哪种情形。
3. 交付说明三件事：照风格做了什么、哪里破例以及为什么、哪些还没取帧验证。

## 演进：评价写到哪里

| 用户的话 | 处理 |
| --- | --- |
| “这套风格以后都别弹跳” | 只属于这套风格：提议在 rules 加一条 dont（must），用户确认后写入 |
| “标题再大一点就对了，以后都这样” | 改 tokens.typeScale，说明影响范围后写入 |
| “我做什么都不喜欢粒子” | 跨风格口味：写共享记忆（见 preferences.md），不改某一套风格 |
| “这次客户要红色” | 只用于本次，不写回风格 |
| “这个太花了” | 先用同一帧 A/B 确认是配色、运动还是材质，再提议具体条目 |

写入前把改动列给用户看，例如“新增规则：不做｜回弹入场｜必须”。只有用户确认后才写；写后回读确认才说“已记住”。工程快照改了只影响本工程；要让以后的工程也生效，同时更新本机库里的同一套个人风格。
