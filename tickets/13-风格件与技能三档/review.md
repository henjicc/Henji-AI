# 13 审查记录
摘要：交叉审查 1 轮（Opus xhigh，813c67040）：重要 2、小问题 8、原有 1；Claude 裁定见下，交回 Codex 修复。

## 交叉审查与裁定
1. 重要：风格件归属 owner 在风格里重复存一份（schema 要求等于所在风格 id、摘要也算它），“复制为个人风格”不改 owner 会被拒、导入换 id 改写 owner 后摘要与 contentHash 对不上被判样片过期 → **归属由所在容器推出，不持久化**（本分支新版本尚未发布，直接从当前版本去掉该字段并更新黄金样本；读写时由容器回填）。
2. 重要：全局库不查重名，助手新建、改名、saveStylePiece 能造出重名，让已有工程的 look(名称) 全部报错 → 所有入口统一唯一名：程序入口（助手、definition 改名）重名直接报错并列出冲突名；界面保存/改名同样报错提示（原有的 savePreset/renamePreset 一并改，属同源）。
3. 找不到风格件的错误要列出可用名称与当前绑定风格，工程副本旧时提示可重新 bind_video_edit_style；definition 多传键列出键名；技能里“先查绑定风格的 effect_presets”改成工程副本 `video_edit.project_style.effect_presets`。
4. 模板预览带上模板所属风格（template.style.id）。
5. 静态复核：filter 的模板字符串与拼接也要识别；动态 shadowBlur 归为 structural_candidate、常量 0 不报；带偏移的投影不建议改发光（按效果目录里是否有对应效果给建议，不写死）。
6. video-preset-package v11 黄金样本补 effect 条目；formatMigrations 6→7、9→10、10→11 补逐版本注释。
7. 效果库版本号只留一个来源（登记表与 LOCAL_LIBRARY_FORMATS 一致）。
8. 效果库操作（含收藏）不推进整个剪辑领域版本：改为只发布效果库自己的修订，若现有发布机制做不到就写明原因。
9. look() 解析按（风格件修订、旋钮值）缓存，不每帧深拷贝与校验。
10. 工程副本的风格成员提供与全局一致的 creation_items（同一解析函数）。
11. 原有：creation_items 不带 frame_curves → 同源一并修。

## /code-review（high，102735cea..1e17090fc）与裁定（第 2 轮修补）
1. 重要：库模板属于风格 A、序列绑定风格 B 时，预览用 A 的风格件，加到时间线后 look() 落到 B 或全局 → **模板代码里的 look() 一律按模板所属风格解析**（应用模板时把该风格的风格件随模板带进工程，没有就建工程副本）；预览与渲染用同一条解析规则。
2. 重要：`values[knob.key] ?? knob.default` 读到原型属性（constructor 等）→ 用 Object.hasOwn。
3. 风格库最低可读提到 7、预设分享包提到 11 → 让存储的效果参数始终等于旋钮默认值求值后的结果（旧版本读到的画面一致），据此不提高最低可读版本；做不到就在登记处写明理由。
4. look() 缓存键含逐帧变化的旋钮值 → 结构按风格件修订展开一次，逐帧只做旋钮插值，不深拷贝、不逐帧 schema 校验。
5. 助手写入的撤销快照无限增长 → 跟随正式撤销栈的保留策略回收。
7. saveStylePiece 无正式调用方 → 删除，写入只走事务入口。
8. 预览缓存键含整份风格对象 → 预览键只取风格 id 与风格件内容摘要（核心侧）；界面传参由 Claude 跟进。
9. 重名校验两处 → 收成一处。
10. 原有：离屏预览会话与预设预览缓存键不随全局风格件变化 → 键带上全局效果库修订。
清理：codeEffectReview 的 member() 重复、offsetShadow 每次重扫整函数、指纹每次序列化全部风格件。
第 6 条（面板内联与 helper 两份）由 Claude 在界面改用 helper。
