状态：ticket 07 实现完成；提交 b694b9b6b7578fff3efade326992e6f3f9865c62，仅保留在任务分支，未推送。
改动：19 个文件，新增 408 行、删除 43 行；技能规则、色带检测、拆轨建议、正式契约与精确测试。
验证：显式 19 文件的 verify:changed L2、check:skill-sync、check:assistant-capabilities 全部通过；独立审查 2 轮，1 项重要问题已修。

## 实现

- 技能入口增加两条必读规则；code-project 原样保留第 15 项的五条判断、反例与“举例，不是清单”，要求片段和轨道命名。color-texture 与 review 修改已有段落，避免和旧渐变配方冲突：不做氛围用大面积极浅渐变；确需时 GPU 加交错梯度噪声，按最终画面半级亮度计算，不按透明度；Canvas2D 渐变限小范围；暗部渐变、阴影、光晕修改后拉高暗部对比度约 6 倍取帧检查。
- query_video_edit_review 的 visual.banding 默认随 visual 开启，可显式关闭；不传 visual 时保持结构复核。检查优先 checkpoints 帧及已取效果基线，复用原尺寸最终合成、现有 Worker、来源身份校验与分页快照。相同基线不重复渲染；新增帧计入既有 120 帧／2.5 亿像素计算预算，开始渲染前超预算即说明如何缩小范围，不截断证据。
- banding 返回半开帧区间、秒数、画面比例区域、台阶方向和级数；subjectRef 为查询序列，clipRefs 列同帧片段。合成帧不能证明哪一层造成色带，因此不会冒充源层归因。改法随记录返回。
- separate_track_suggestion 是建议，非错误。仅对入口直接导出的字面量 layers 中，能证明不读时间、参数或邻层的全幅常驻绘制／角落小字给提示，定位代码片段、源码文件、行与图层。核对整组绘制，未知 helper、工厂、子组、非 source-over、save/restore 等均保守跳过；放置有变换、曲线、跟随、防抖、效果、淡化、元素覆盖或路径上转场时也不硬判。
- 新记录类型、字段、用途和改法都在既有能力正式声明中登记；Pi/MCP 继续同源投影，assistant-status.md 同步实际能力和未验证范围。无新增工具、UI、持久格式或标准效果件。

## 检测与选型边界

已调研 [Netflix CAMBI 官方说明](https://github.com/Netflix/vmaf/blob/master/resource/doc/cambi.md)：其 libvmaf 原生工具可按帧检测并输出热图，但接入会新增原生处理管线。现有 pixelmatch 用于两帧差异，不能直接检测单帧色带。本次沿 ticket 指定的 Worker 路线实现原尺寸宽平台和连续一级亮度台阶启发式，不声称实现 CAMBI 或提供其分数，未新增依赖。

检测同时横向、纵向扫描；要求多个宽平台连续变化并有足够跨扫描线支持，过滤纯色、窄边缘、纹理噪声与有效抖动。原尺寸扫描避免缩图把抖动平均掉。存在噪声的轻微色带、任意角度或未采帧中的断层仍可能漏检；候选也可能是有意阶梯色块，仍需读图。未检测到不保证整片或编码输出无色带。

拆轨提示只覆盖可证明的窄范围；参数化图层、复杂辅助函数／父组和镜头排版关系无法可靠静态判定，不为增加提示覆盖率猜测。没有提示不代表该层应该合并在内容模块中。

## 验证证据

1. `npm run verify:changed -- --level L2`，显式传入本次全部 19 个文件：通过。
   - 7 个精确测试文件、90 项测试通过：bandingReview、codeTrackReview、review、videoEditMotionReviewWorkerClient、videoEditReview、videoEditVisualReview、videoEditCodeCreationSkill。
   - 本次 TS 文件 ESLint、渲染层 tsc、Electron tsc、依赖图、主进程传递导入检查全部通过。
   - 覆盖极浅径向渐变（21/22/26 → 13/14/16）、暗底约 14/255 的柔和窗口阴影；相同浮点画面加最终半级交错噪声后不报；纯色、照片类纹理噪声、暗部视频噪点、抗锯齿文字边缘不报。
   - 另有 4K 原尺寸浅台阶／抖动正反例、真实 Worker 入口读取与释放位图的内核用例、公共入口时间／位置／片段定位、分页不重复渲染、基线复用、不写作品及放置动画禁止误拆的用例。
2. `npm run check:skill-sync`：通过，5 个技能、25 个共享文件一致。运行时创作技能本身是 resources 下单份包，本次未修改 .codex/.claude 两份项目技能；仍按计划实际运行同步聚合门禁。
3. `npm run check:assistant-capabilities`：通过；结构门禁、15 项覆盖测试、31 文件／237 项不变量测试全部通过。
4. `git diff --cached --check`：通过。提交后 `git status --short` 无输出。

本地日志位于任务工作树 `.tmp/t07-verify.log`、`.tmp/t07-skill-sync.log`、`.tmp/t07-capabilities.log`，均未提交。

### 门禁修正与环境处理

- 原技能测试把行内记录类型、效果参数当成工具名误报；现在从正式输出 JSON Schema 和效果参数声明派生合法符号。固定 10/16 KiB 文档长度断言在基线也已失败（例如 author-api.md 19085 字节），且与容量放开规则冲突，已删除该断言；保留参考链接、真实工具／属性、作者模块和事务行为检查，没有提高阈值或维护数字清单。
- 首次冷 tsc 达到 Node 默认约 4 GB 堆上限而退出；最终完整 L2 在本次命令进程设置 `NODE_OPTIONS=--max-old-space-size=8192` 后通过，未改项目或系统配置。中途发现的技能测试 Zod 类型封装问题已改为正式 JSON Schema 读取。
- 工作树缺少 FFmpeg，check:skill-sync 的巡检模块导入因此失败。仅在任务工作树创建忽略的 `native/video-decoder/ffmpeg` 联接，指向主仓已有同版本二进制，之后门禁通过；未安装、下载、重装依赖或修改主仓二进制。原 node_modules 联接保持不变。

## 独立审查与范围

- 第 1 轮：1 项重要问题——候选自身独立不代表可拆，邻层 destination-out 挖洞或不平衡 Canvas 状态会依赖同一画布。
- 处理：检查整个返回组，不明合成、ctx 逃逸与 save/restore 均不给拆轨建议；加入挖洞、helper、别名、元素访问及状态泄漏反例，同时保留普通独立动态内容的合法建议。
- 第 2 轮：增量审查无新增确定问题，确认首轮重要问题已解决。
- 实际排查包含共享静态建议入口、所有嵌套放置路径、最终合成取帧、Worker 传递与释放、预算、分页和来源失效、输出契约及技能规则；未发现其他确定的同类缺陷。未扩成全仓审计。

## 偏离与遗留

- 计划标注 Opus high 审查；当前可用协作模型不含 Opus，本次使用可用的全新独立上下文完成两轮审查，未声称做过 Opus 审查。技能措辞仍交由既定的 Claude 后续把关。
- 未运行 Reality、Electron 构建、真实 Pi/MCP、真实《元宝搜索》工程或编码输出验收；改前／改后结论来自确定性合成样本，不冒充真实成片验证。
- 未操作 D:/视频制作，未触碰 9334 开发实例，未切分支、合并、修改 main 或推送；除本 result.md 外未向主工作区写交付文件。任务分支工作区干净。

## 提交范围

分支：`task/07-单独成轨与色带检查`
基线：`05c5d683a`
提交：`b694b9b6b7578fff3efade326992e6f3f9865c62`

```text
docs/rules/assistant-status.md                     |  2 +
 .../video-edit-code-creation/SKILL.md              |  2 +
 .../references/code-project.md                     | 15 ++++
 .../references/color-texture.md                    |  6 +-
 .../video-edit-code-creation/references/review.md  |  2 +-
 .../videoEditCodeCreationSkill.test.ts             | 17 ++--
 .../domains/videoEdit/videoEditReviewCapability.ts | 12 +--
 src/core/videoEdit/bandingReview.test.ts           | 54 +++++++++++++
 src/core/videoEdit/bandingReview.ts                | 61 ++++++++++++++
 src/core/videoEdit/codeTrackReview.test.ts         | 33 ++++++++
 src/core/videoEdit/codeTrackReview.ts              | 94 ++++++++++++++++++++++
 src/core/videoEdit/review.ts                       |  6 +-
 .../videoEditMotionReviewWorkerClient.test.ts      | 11 ++-
 .../videoEditMotionReviewWorkerClient.ts           |  2 +-
 .../videoEdit/application/videoEditReview.test.ts  | 13 +++
 .../videoEdit/application/videoEditReview.ts       | 23 ++++--
 .../application/videoEditVisualReview.test.ts      | 58 ++++++++++---
 .../videoEdit/application/videoEditVisualReview.ts | 25 ++++--
 .../engine/videoEditMotionReviewWorker.ts          | 15 +++-
 19 files changed, 408 insertions(+), 43 deletions(-)
```
