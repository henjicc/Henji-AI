# t91 代码创作 skill 补全

状态：文案、路由、样例与读取清单已补全，待总管理者审查及 Git 提交。任务只修改 runtime skill、两份指定测试与本任务记录／总览 t91 行；未修改源码与 SDK、未操作 Git 写命令、未付费或启动 Electron。

## 范围与依据

逐篇读取只读原文 `D:/VibeCode/AEPR控制测试/packages/knowledge/guides/`，对照本项目已有 references；保留有效经验与执行边界，用真实作者语言和应用接口翻译，不按字节比例机械补字。

查证依据：codeMaterial 的 contract/compilerV3/evaluateV3/motion/textLayout；builtinEffects 与 shaderGraph/components.generated.json（shaders 4.0.2）；timedContent/subtitleStyle/text 与 videoEditFields/videoEditReflection；cameraStage 的 motion/render 能力定义；annotations/timeline-check/parameter-types/multifile-components。没有依赖对 AE、VGPU API 或外部项目性能的记忆推断。

## 逐篇对照

| 原文篇目 | 本项目 reference | 补回／为何不搬 |
| --- | --- | --- |
| motion/timing.md | motion.md | 秒／帧刻度、距离翻倍约加30%时长、快慢3:1、逐字1–2帧、错峰跨度与完整落定区分、属性错位、幅度／蓄力／跟随／静止；曲线依CODE_EASE_NAMES，hold不当作者曲线；不搬AE曲线速度影响换算、快门开关 |
| motion/choreography.md | motion.md | 因果接力60–80%与普通重叠30–50%区分、焦点扩散／阅读／固定种子三种错峰、弧线／同向／有动机的镜头、完整转场语法、接力连帧检查；延迟从时间函数求值，无表达式／空间切线 |
| direct/review.md | review.md、review-ai.md | 三遍看片、静／动／数据／参考／局部／连续帧／小屏／循环、可执行批注、同语义A/B、八维4/6/8/10锚点、自检、完整17类AI味及旧有闪字项、用户反馈；不搬批量ae_frame、compareWith、客户端审阅文件／强制制作说明与渲染器切换 |
| recipes/templates.md | templates.md | 五维自适应、稳定行框、完整文案量字、group与空内容、字号比例、时长边界、十类压力场景、自定义类型／多文件／钉版本组件；不搬隐藏参考字层、sourceRectAtTime、主属性、复制父级陷阱与MOGRT保护区 |
| direct/brief.md | brief-concept.md | 简报交付范围、观看环境／静音／弹幕／大屏／循环、平台经验遮挡、真Logo与真界面；简报留对话／正式实体，不默认创制作说明 |
| direct/concept.md | brief-concept.md、approach.md | 稳妥／大胆／意外方向、官方可见特征3–5条、质感与空间拆解、先主停留帧、实现风险／能力选型；不搬样张合成目录／插件安装流程 |
| direct/structure.md | structure.md | 能量与节拍保留，补阅读计时、方向语义、三层速度、信息类型细节、重音落地、音效职责、粗排先于精修；不搬固定A2/A3或虚构自动音频节拍 |
| direct/preferences.md | preferences.md | 含糊反馈落实尺度／动作、长期与单次范围、选择理由与同类合并；保留正式共享记忆800字边界，重复修改不自动推断长期口味；不创建用户目录偏好文件 |
| design/layout.md | layout.md | 常见规格、90/93安全区经验、1080p边距、128px间距档、字号字重双对比、分屏比例／列表／金句／画中画、灰度检查；不搬AE安全框默认或认定平台遮挡为固定标准 |
| design/type.md | type.md、recipes-text.md | 字号阶梯1.333/1.5、真实font参数、字距／行距作者与字幕单位转换、符号缺字、精确字体样式与混排；不搬Tracking单位到作者letterSpacing或伪造字体名 |
| design/color.md | color-texture.md | 渐变／单色颗粒、投影／暗角／背景虚化尺度、低透明光晕、统一光向、真实颜色／编码边界；不搬AE工作色彩开关、插件名或“形状模糊必裁边”的宿主特定结论 |
| design/styles.md | styles.md | 六档真实曲线、回弹与强度范围、类别色、科技底纹、纪实叠化／确定性手持近似、主档和局部换档；闪白不作默认冲击 |
| direct/approach.md | approach.md | 生成器／代码滤镜／成熟组件／WGSL／内置效果／AI素材／剪辑转场选择表、确定性／可改性／成本、查组件查效果试一帧三步、常用组合；不搬DynamicFX／CUDA桥接或别项目性能数据 |
| recipes/text.md | recipes-text.md、recipes-text-data.md、recipes-text-words.md | 完整遮罩逐字样例、格子终端与形状光标、words真实空白分词／分拍样例、数字位权与既有完整数字样例、字距行距；无substr/String/toFixed、无虚构逐词识别、perChar不支持颜色／blur |
| recipes/captions.md | recipes-captions.md | 字幕阅读与断句建议、caption真实属性与多描边样式、两条路线、花字参数／多层描边／声音、完整量字人名条、项目组件发布；代码画面不能代替字幕文本导出，没有字符区间样式／字幕动画器 |
| recipes/glass.md | recipes-glass-lines.md | Glass／FlutedGlass／GlassTiles／Crystal角色、真实参数范围、折射输入与边光、模糊量纲、侧转双轮廓边界；无MB插件与屏幕投影遮罩，Frost不是毛玻璃输入滤镜 |
| recipes/icons-lines.md | recipes-glass-lines.md | path/line真trim字段、双向生长、绝对SVG命令边界、图标尺度与圆角卡片；无icons下载／SVG自动转换工具，不把emoji当图标 |
| recipes/3d-camera.md | recipes-3d.md | 三维镜头参考真实工具／后台输出、结果导入、伪3D投影与分母保护、近远速度／遮挡边界；不搬AE相机／rotateX/Y／景深／预合成连续栅格化 |

## 关键设计与选型

成熟方案优先：复用本项目已经接入的 shaders 4.0.2 组件（Glass 等）、全能调色／辉光Pro／方向模糊，优先现有 measureText/group/perChar/path 与项目组件库；不用手写新玻璃／调色引擎或引入运行依赖。比较的是组件组合、代码算法、内置效果和固定AI媒体的可编辑性／确定性／成本，选择依据写进 approach。此任务未扩展渲染实现，不需要外部库安装或许可改动。

新增8份reference：approach、recipes-text、recipes-text-data、recipes-text-words、recipes-captions、recipes-glass-lines、recipes-3d、review-ai。review-ai是审查清单；其他7份均有独立export default完整作者源码。数字完整例继续复用examples，不复制实现。

发现已有文案与代码不一致，同范围修正：type的“没有font参数”、author-api／annotations的“没有元素覆盖”；实际已有font与clip.element_overrides。只修技能说明，未改变能力通／不通、欠账或已确定不做项，按assistant-status第零节无需更新台账。

设计建议的字数、错峰、四张词卡等为创作起点／单份样例布局，不成为产品数量限制；长内容用分拍。投影分母、作者字符容量、渲染／采样工作预算和观察最大宽度保留为真实技术边界并说明理由。

## 设计自查

1. **助手只凭名称和说明能否用对？** 能更准确选路：路由区分字幕／代码、输入滤镜／生成器、空间参考／伪3D；工具与属性名称由正式目录测试核对，完整样例由v3编译器与求值器验证。品味与视觉正确仍须读真实帧，不能仅凭文案保证。
2. **能否AI先做、人只确认？** 助手先量字、排版、错峰、分拍、试帧与A/B，用户确认方向及open标注的处理结果；不让用户从零调像素，不替用户resolved，不增加付费授权。
3. **产物能否直接流进其他工作区？** 仍是项目代码素材／固定版本、时间线实例和项目组件，可复用／打包；三维与AI产物沿正式媒体引用导入，不要求手动跨工具搬文件。字幕文本仍由caption维护，代码花字不冒充字幕文件。

## 验证与边界

本轮按L1：runtime skill的局部说明与可编译样例、两份读取清单测试，不改源码／schema／运行链。使用用户指定四份精确测试，不跑全量／Reality／付费调用／Electron开发实例。只改测试清单，不触发双工程tsc；未改.codex/.claude技能，不触发check:skill-sync。

- `npx vitest run src/core/application-control/domains/assistantSkill/videoEditCodeCreationSkill.test.ts src/core/videoEdit/codeMaterial/skillExamples.test.ts electron/main/services/embedded-agent/skills.test.ts electron/main/services/mcp/skills.test.ts --silent`：最终4文件34项通过（4＋20＋6＋4）；第一轮33项通过，新增逐词完整例后按受影响范围重跑。
- `npx eslint electron/main/services/mcp/skills.test.ts electron/main/services/embedded-agent/skills.test.ts --report-unused-disable-directives --max-warnings 0`：最终通过，0警告。
- `npm run check:main-imports`：通过，扫描573个main/preload文件；按用户“改electron/main必跑”执行，未改主进程实现。
- 本任务显式文件范围的`git diff --check`：通过；Git仅提示已有LF/CRLF自动转换设置，未操作写命令。新文件由加载／编译测试实际读取。
- SKILL.md为5846字节；全部reference满足8KiB边界（examples例外16KiB），原有author-shaders为8171字节接近上限，未修改它；主文件全部链接与实际参考清单一致。
- 大小／全部路由／工具事务名／实体属性核对由videoEditCodeCreationSkill与加载入口测试覆盖。
- 本轮未真实GPU取帧／试听／编码／性能验证；样例编译与CPU求值只证明作者契约、多时刻有限数值与寻帧确定性，不宣称视觉验收。

源码可考虑后续补的能力（未实施）：紧密比例文字打字机的前缀度量／可读字形位置；真运动模糊的受控时间采样；字幕字符范围样式／词级强调。现有网格终端、方向模糊与独立代码关键词已给替代路线，不把这些建议伪装成现有API。

## 修改文件清单

- resources/assistant-skills/video-edit-code-creation/SKILL.md：补齐路由与导演阶段，入口保持6KiB内。
- 同目录references的 motion/review/templates/brief-concept/structure/preferences/layout/type/styles/color-texture.md：逐篇补经验与实际做法。
- 同目录references的 author-api/annotations.md：修正元素覆盖过时说明。
- 同目录references的 approach/recipes-text/recipes-text-data/recipes-text-words/recipes-captions/recipes-glass-lines/recipes-3d/review-ai.md：新增选型、配方、空间与完整症状清单。
- electron/main/services/mcp/skills.test.ts：静态完整reference清单加入新增文件。
- electron/main/services/embedded-agent/skills.test.ts：显式断言新增reference可发现，保留逐个读取／大小校验。
- docs/task/代码画面与AI协作/00-任务总览.md：只增加t91行。
- 本任务文件：对照、选型、自查与验证证据。

总管理者注意：工作区原有SDK改动和vitest.exp.config.ts不属于本任务；没有清理或写Git。任务不需要重启主进程；已验证内置与MCP加载入口能读新文件，正在运行的模型会话是否重新加载未验证。
