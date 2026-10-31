# U9 代码调整层交付

状态：实现、自审修复、最终验证和任务分支提交完成；未推送、未合并到 main。

## 分支与提交

- 工作目录：`D:\VibeCode\Henji-AI-t19u9`。
- 分支：`task/19-U9-代码调整层`；基点 `3fba9c4d9`。
- 提交：`1a016e121d8c36ef239d1fb75c3843dadb96c1bf`，`feat(video-edit): 支持代码调整层`；51 个文件。
- 提交后任务工作区干净；未切分支、未 rebase、未操作主工作区代码。

## 已落地

- `adjust(t)` 与 `draw`、`fill`、`effects` 互斥，要求稳定 id；旧作者接口明确拒绝调整层。
- 调整层作用于本模块此前合成的整幅画面，在同一个帧编码器内复用原生效果链；H 按作者画幅高度计算。只采样 pose.opacity，clip 限定回写范围；不透明度按原栈与处理结果混合全部 RGBA 通道。
- 首个高精度触发层升到 rgba16float 并复制已合成内容；同帧继续复用浮点目标，无触发的后续帧恢复原格式。调整层的位置切开静止批组。
- 支持 layer/frame 效果；frame 效果进入普通图层 effects 会报「暗角按整幅画面算，请放进调整层 adjust。」等对应名称错误，look 展开也遵守同一校验。
- 颗粒与暗角只增加 `space: 'frame'`、`grain`/`vignette` 作者工厂。参数、默认值、着色器和观感未改；生成产物已更新，未冻结新的 henji-effects（留给 U16）。
- 调整层进入确定性包装、帧指纹、精确源码位置和取帧观察；观察带 `kind: 'adjust'`、实际效果与参数，不含 bounds，corners 为空。逻辑选择可按 id/源码读回；画面几何查询排除调整层，不画选框。
- 调整层内光影的完整输出进入后续效果，避免光绕过调色；保留产光标记。运动复核排除无几何调整层。
- 技能 `resources/assistant-skills/video-edit-code-creation/references/author-api.md` 已简短写入第 4 节限制：透明底零 alpha 光会被调整层反预乘调色去掉；在产光图层 effects 内调光色；有不透明背景时不受影响。措辞供 Claude 复核，本会话没有冒充 Claude 的复核结论。

## 持久格式

| 格式 | 本次版本 | 最低可读版本 |
|---|---|---|
| code-author-api | 8 → 9 | 9 |
| code-version | 9 → 10 | 10 |
| code-asset | 14 → 15 | 15 |
| document.video_edit | 49 → 50 | 50 |
| document.screen_recording | 52 → 53 | 53 |

每种格式只升一次，逐版本迁移保留旧源码、作者接口与库锁定；新黄金样本由正式构造器/序列化器生成，既有样本与发布承诺未改写。基线和兼容快照只追加本次版本。U7、U15a 在尚未发布的作者 API v9 上追加，不再各升作者 API。

## 验证

- 最终 `npm run verify:changed -- --level L2 <51 个显式本次文件> --test <精确消费者>` 通过；复现清单及脚本在本工作目录 `.tmp/u9-files.json`、`.tmp/u9-verify.ps1`，最终输出 `.tmp/u9-final-l2.log`。
- 21 个测试文件、499 项通过，零失败、零跳过；包括 44 项真实 WebGPU 用例。覆盖互斥、空间错误、opacity/clip、精度升级与复制、静止分组、指纹、源码导航、逻辑选择、公共取帧 kind、运动复核及持久读写。
- 渲染层与 Electron 两套 tsc、改动文件 ESLint、依赖图、主进程传递导入、持久格式基线全部通过。
- `check:author-effects`、`check:persistence-compat`（66 种格式）、`check:assistant-capabilities`（结构、15 项覆盖、31 文件 237 项不变量）、`check:skill-sync`（5 个技能、25 个共享文件）全部通过。
- 真实作者链：正式打包器编译生成的作者工厂与模块，经模块导入/确定性包装/正式作者 Runtime 和 GPU 效果链执行。640×360 与半分辨率 320×180 下，暗角、颗粒、整体调色与片段同参数结果的逐像素最大误差均 ≤1/255；同时核对半透明输入、opacity=1/.35、clip 外不变。额外实跑发光→调色，透明边缘与片段串行链一致到 ≤1/255。
- Canvas2D 栅格输入使用固定像素桥，GPU 工序与效果合成是真实 WebGPU；没有宣称做过浏览器 Canvas 视觉、真实 Electron 窗口或 1080p 性能验收。日志中的格式不匹配来自既有主动拒绝验证用例，该用例通过。
- `git diff --check`、暂存区检查通过。既有 GPU 快照与蓝噪声生成物的规范化 blob 摘要均与 HEAD 相同，未更新像素基线或放宽阈值。

## 审查与实际排查范围

独立干净上下文共审 3 轮：首轮 3 项重要问题（非几何元素逻辑选择被过滤、adjust 未登记精确源码范围、空 corners 导致运动速度为 -Infinity）全部修复并补回归；第 2、3 轮只审增量，无新增问题。主代理另检查并修复调整层内产光绕过后续调色的链路。

实际检查了作者模块与确定性包装、普通图层/调整层/片段原生链及 look、帧指纹与 frameKey、首次精度升级和历史复用、静止批组、源码位置、id/源码逻辑选择、画面命中排除、公共取帧效果观察、运动复核、五种持久容器。上述范围内未发现其他有证据的同源缺陷；未扩大为其他效果单或全项目审计。

## 约束核对

未修改 `.tsx` 界面文件；未改 U1/U2/U3 效果实现；未安装/卸载依赖；未删除或替换 node_modules/FFmpeg 联接点；未启停或占用 9334 开发版；未访问 `D:\视频制作`。重任务在本会话内串行执行。除本结果文件外，没有修改主工作区。没有推送、合并 main、切分支或 rebase。

## 审查修复 1（2026-11-01）

状态：按 review-U9.md 末尾 Claude 裁定完成代码调整层全部条目；实现、三轮独立审查修复、最终验证与任务分支追加提交完成。

- 分支：`task/19-U9-代码调整层`；基于 `2935ca760` 追加提交 `f8bb34e7c305894ab599fdbb2ecf48c6fced0c8d`（`fix(video-edit): 修复调整层帧复用与旧接口兼容`），本次 25 个文件。
- 提交后本任务工作区干净。没有 push、merge main、切分支或 rebase；主工作区仅修改获准的 tickets/19 目录中的本结果和 design.md。

### 裁定落实

1. 第 1、2、原有 10 条：输出复用经 `videoEditCodeOutputKey.ts`、`videoEditCodeSources.ts` 与 `VideoEditAuthorPrograms.frameKey` 委托同一 `fingerprintAuthorFrameKey`；删除跳过图层效果的开关。求值后的普通图层/调整层效果摘要都参与键，固定 `settled` 不会隐藏动态效果或颗粒。静止效果仍可复用。
2. 第 3、原有 11 条：作者功能起始版本集中到 `src/core/videoEdit/codeAuthorVersions.ts`，程序类型、参数显隐、图层效果与调整层判定消费具名常量；既有持久模块保留原导出入口。本分支叠在 U0（8）上，调整层仍为 `CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION = 9`，没有新增持久版本、迁移或样本。最终合并的 API 号由 Claude 按合并顺序统一常量与样本；本单没有合并 main 或自行降号。
3. 第 4 条：低于调整层起始版本时，普通 effects 或 look 展开中的 frame 效果提示使用片段效果链，并说明升级到相应接口后才可用 adjust。
4. 第 5 条：旧接口只忽略宿主对 adjust 的解释，保留作者原对象、同名自定义数据、方法接收者及继承 draw；渲染和两类指纹路径一致。上文“旧接口拒绝 adjust”的交付描述以本节为准。
5. 第 6 条：调整层观察带作者坐标的可选四元组 clip，并传到公共取帧 effects 结果；运行时与公共入口均有回归。
6. 第 7 条：技能已逐字落实裁定：“调整层里的效果按反预乘计算：透明底的零 alpha 光会被去掉（调色、暗角、颗粒都一样）；要处理光，在产生光的图层 effects 里调。有不透明背景时光已叠入背景，不受影响。”
7. 第 8 条：在 design.md 第 11.4 节追加一行 U15b 待办，点名 CodeSourceEditor、VideoEditCodeElementsPanel、CodeParameterPanel 的源码定位、已选元素、不透明度与显示开关。本单没有改 .tsx。
8. 第 9 条：调整层的位移、缩放、旋转静态覆盖及关键帧明确报错。直接编辑/自动关键帧/运行时共用几何约束；通用事务沿既有候选试渲染读取真实源码、参数、源时间与效果链，写入前校验，不依赖可见帧缓存。同事务同时改参数或效果链也不能绕过；已试渲染的同一候选不重复执行。opacity、hidden 仍可用。

### U3/U4/U5 接入：按帧取种子的声明

字段名为 **`frameSeeded?: boolean`**，定义在 `VideoEditBuiltinEffectDefinition`。依赖宿主传入帧号生成种子的效果，在自身定义上写 **`frameSeeded: true`**；颗粒定义已声明。划痕、故障、镜头光晕、漏光如果使用宿主帧号取种子，合并时同样声明，不再追加任何按效果 id 判断的分支。

`authorEffectsFingerprint(effects, environment, frame)` 按定义声明把传入帧号纳入效果摘要。调整层传入 `Math.round(info.time / info.frameDuration)`，与实际 GPU 调整链相同；普通图层效果的宿主帧号仍为 0，摘要默认也为 0。输出复用键与预渲染共用上述摘要，作者无需为宿主注入的种子再手动补 frameKey。作者 draw 等自身绘制变化仍须由自己的 frameKey 表达。

### 最终验证

- `pwsh -NoLogo -NoProfile -File .tmp/u9-review-verify.ps1`：实际执行 `npm run verify:changed -- --level L2 <本次25个显式文件> --test <精确消费者>`，16 个文件、522 项通过，零失败/跳过；含 17 项真实 WebGPU。两套 tsc、精确 ESLint、依赖图、主进程传递导入、66 种持久格式基线全部通过。最终日志 `.tmp/u9-review-l2-final.log`；显式文件 `.tmp/u9-review-files.json`。
- `check:author-effects`、`check:persistence-compat`（66 种格式）、`check:assistant-capabilities`（结构、15 项覆盖、31 文件 237 项不变量）、`check:skill-sync`（5 个技能、25 个共享文件）全部通过，日志 `.tmp/u9-review-gates.log`。
- 真实 GPU 回归包括：frameKey 恒为 settled + 调整层颗粒的相邻帧像素不同；普通层效果参数随时间变化时不命中旧输出；静止效果保持命中；三种路径与禁止输出复用的逐帧直出逐像素一致。另用不同效果的声明验证种子判断不依赖 film_grain id。既有打包/调整链、opacity/clip、精度与透明边缘用例也通过。Canvas 输入沿既有固定像素桥，GPU 工序真实执行；没有把它冒充浏览器 Canvas 视觉验收。
- GPU 日志中格式不兼容诊断来自既有主动拒绝用例，该用例通过；没有改像素基线、放宽阈值或跳过失败。
- 两次 `electron:bundle` 均通过，分别用于修复前基线与最终源码；两次正式 `test:reality -- --suite ui --only =video-edit-style-reuse --size 1440x900 --allow-writes` 都通过，使用隔离临时资料和独立端口。没有占用/连接/启停 9334 开发版。

### ticket 21 章节静止复用 CPU 对照

输入为只读复制的 ticket 21 改后“章节标题”main.ts/kit.ts，4K（3840×2160）、60fps，同一 1440×900 窗口和 NVIDIA Lovelace 非软件适配器。前后各运行一次正式场景；下表沿用原场景排除前两组预热、取同会话相邻帧的 132 帧 codePerformance.cpuMs 口径（CPU 求值/准备墙钟，非整机 CPU 占用）。

| 代码 | CPU 中位数 ms | CPU p90 ms | 图层沿用率 | 上传次数/字节 |
|---|---:|---:|---:|---:|
| 修复前 2935ca760 | 0.70（原值 0.699999988079071） | 0.90 | 100%（924/924） | 0 / 0 |
| 修复后 f8bb34e7c | 0.50 | 0.70 | 100%（924/924） | 0 / 0 |

原有沿用率 ≥99%、零上传、章节中位数/p90 <2ms 门槛均保留并通过；没有静止复用退化。本次单次前后对照不用于宣称稳定的普遍提速比例。

- 原始数据：`.tmp/u9-style-reuse/evidence/after-u9-before/evidence.json`、`after-u9-after/evidence.json`。
- 汇总与六帧像素核对：`.tmp/u9-review-performance.json`。30、90、220、350、585、599 六个 3840×2160 锚点前后逐像素一致；前后实际 Electron 截图已目视。
- 真实场景日志/截图：`.tmp/u9-review-reality-before/`、`.tmp/u9-review-reality-after/`；构建日志 `.tmp/u9-review-before-bundle.log`、`.tmp/u9-review-after-bundle.log`。均位于本任务工作目录，不进入提交。

### 审查、范围与 Claude 交回

独立干净上下文审查 3 轮：首轮 2 项重要问题（旧对象克隆改变 this/继承 draw、用可见帧缓存作写约束）均修复；第 2 轮发现效果链组合写入绕过，已修复并补回归；第 3 轮只审增量，无新增重要问题。主代理另修正新增测试的参数位置和效果描述字面量类型，最终全部验证通过。

实际排查了输出键与作者程序入口、frameKey/录制两条指纹、普通图层/调整层/静止分组、旧接口 4/7/8、自定义方法接收者、look 展开、clip 公共读回、直接元素编辑/关键帧与通用事务候选试渲染及参数/效果链组合状态。范围内确认的同源缺陷均已修复；检查后未发现其他有证据的同源问题。没有扩大到其他效果单实现或全项目审计，U3/U4/U5 未合并实现仍需按字段接入后验证。

交回 Claude：第 7 条技能原文措辞复核；第 8 条由 U15b 实现；最终合并时统一作者接口起始常量与样本并通知 U3/U4/U5 采用 frameSeeded。本会话没有调用 Claude、用户已登录浏览器/网页账号或外部聊天服务。没有改依赖或执行 npm install/ci/uninstall，没有删除 node_modules/FFmpeg 联接点，没有访问 D:\视频制作。


## 接入 main（2026-11-01）

状态：接入、自查修复、两轮独立审查、匹配验证及本分支提交完成，可进入合并审查；未合并到 main、未推送。

### 基点与最终提交

- 按 `git rebase --onto main 3fba9c4d9 task/19-U9-代码调整层` 只重放 U9 自身的 3 个提交，没有带入 U0 旧提交。
- 最终再以 `git rebase main` 接上工作期间新增的进度文档与 U12 测试修正；最终 main 为 `87fc65e3caebc1f18b1caed290eaac90f05ce3c6`，是本分支 HEAD 的祖先。第二次 rebase 无冲突；相较已验证树只有上述两份 main 文档/测试增量，无运行时代码变化。
- 分支仍为 `task/19-U9-代码调整层`，最终 HEAD 为 `102b8461f20cb4374fd55ca4d6b3ac988144e916`。
- `git log main..HEAD` 只有 U9 的 4 个提交：`9e83b5e1c`（调整层实现）、`9cafa7ee7`（技能措辞）、`6aadb0269`（帧复用与旧接口兼容）、`102b8461f`（接入版本与兼容修复）。任务工作区干净。

### 最终版本表

本节为接入后的最终版本；此前各节版本表仅记录当时分支状态。

| 格式 | main 版本 | U9 最终版本 | 最低可读版本 | 唯一新增样本 |
|---|---:|---:|---:|---|
| code-author-api | 8 | 9 | 9 | code-author-api/v9.json |
| code-version | 9 | 10 | 10 | code-version/v10.json |
| code-asset | 14 | 15 | 15 | code-asset/v15.json |
| document.video_edit | 51 | 52 | 52 | document.video_edit/v52.json |
| document.screen_recording | 54 | 55 | 55 | document.screen_recording/v55.json |

- 调整层起始常量 `CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION = 9`，作者接口版本仍从具名常量集中导出。每种格式相对 main 只升一次，迁移保留旧源码、作者接口与库锁定。
- 五种样本使用正式 `generatePersistenceFixtures` 构造器重新生成（调用脚本 `.tmp/u9-main-fixtures.ts`）；新剪辑与录制样本同时保留 main 的音频、过渡和 `visibleWhen.all` 案例，并包含调整层源码。
- `persistence:baseline`、`persistence:release-snapshot` 正式脚本重新生成基线和发布承诺，没有手工改指纹。main 已登记的 v50/v53 等旧样本与历史发布承诺均保留。`git diff main...HEAD -- tests/fixtures/persistence` 恰为上表五个新增文件，无修改或删除。

### 接入修复与同源检查

- 保留 main 的唯一 id 断言、有序目录、`definePlanner` 和具名 WGSL 共享块。U9 不新增效果 id 或规划器；颗粒、暗角继续使用目录内既有定义与规划链，作者声明/工厂按 main 顺序重新生成，没有重复登记或内嵌公共 WGSL。
- main 的 look 预检固定使用普通图层空间，会提前拒绝调整层中的暗角、颗粒。预检和实际解析现共用目标空间与作者版本，继续检查直接参数、曲线和旋钮映射的空间限制；检查了直接描述、look 展开及旧接口提示三条路径。
- 独立审查发现确定性包装与普通层录制指纹无条件读取继承的 `adjust` getter，旧 API 4/7/8 可能因此抛错或改变作者状态。现由正式模块加载器将作者版本传给确定性包装；预览/导出作者程序、预渲染指纹和候选合成三个生产加载调用方均已传递。普通层指纹保留未知自定义字段的原有语义，不提前读取继承 getter。
- 回归覆盖继承 getter 不被旧接口读取、draw 的作者接收者、新接口 adjust 的确定性，以及自定义数据变化仍影响录制指纹。原测试把旧接口同名字段当宿主字段一律忽略，现改为验证原有未知字段语义；没有放宽像素/性能阈值。
- 扩展到预渲染直接消费者时，发现测试替身整模块覆盖导致缺少 `isAuthorAdjustment` 正式导出；改为仅替换原生加载边界，正式判断函数继续参与验证。

### 最终验证

- `npm run verify:changed -- --level L2 <66 个显式本次文件> --test <直接消费者>`：通过。37 个测试文件、732 项通过，零失败/跳过；含 47 项真实 WebGPU（调整层/精度/复用 17 项，风格效果与登记入口编译 30 项）。两套 tsc、文件级 ESLint、依赖图、主进程传递导入与 66 种持久格式基线全部通过。
- `check:author-effects`、`check:persistence-compat`、`check:assistant-capabilities`、`check:skill-sync` 全部通过。助手结构、覆盖 1 文件 15 项、不变量 31 文件 238 项通过；技能同步为 5 个 skill、25 个共享文件。
- 接上 main 新增测试后，另跑 `videoEditBuiltinEffects.test.ts`：1 文件 7 项通过。两笔 main 增量没有运行时代码变化，其余有效验证证据复用。
- 独立干净上下文审查共 2 轮：首轮 1 项重要旧接口兼容问题已修复；第二轮只审增量，无新增重要或小问题。后续测试替身修正通过其 5 项精确回归及最终 L2。
- 日志与复现清单位于本任务忽略目录：`.tmp/u9-main-files.json`、`.tmp/u9-main-tests.json`、`.tmp/u9-main-verify.ps1`、`.tmp/u9-main-l2-final.log`、`.tmp/u9-main-gates-final.log`、`.tmp/u9-main-forward-test.log`。GPU 的格式不匹配诊断来自既有主动拒绝用例，该用例通过；没有更新像素基线或跳过失败。
- 实际检查范围为作者加载/确定性、渲染和效果链、输出复用与两种指纹、look 空间预检、元素覆盖及通用事务试渲染、公共观察、五种持久容器及 main 音频/过渡迁移。范围内确认的问题均已修复，检查后未发现其他有证据的同源缺陷；没有新增真实 Electron 窗口或性能验收结论。

### 保留边界

- 三处 `.tsx` 面板的调整层逻辑选择联动，继续按 design.md 第 11.4 节交给 U15b；本次不将其宣称为已完成。没有改变既定设计方向、依赖或验收门槛。
- 未修改 `.tsx`；未安装/卸载依赖；未删除、替换 node_modules 或 FFmpeg 联接点；未启停、连接或占用 9334 开发版；未访问 `D:\视频制作`；未使用已登录浏览器、网页账号或外部聊天服务。重任务串行。主工作区直接修改仅为获准的 tickets/19 下本结果文件；代码只在本任务分支提交，未 push、未合并 main、未切到其他分支。
