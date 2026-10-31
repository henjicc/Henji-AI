# 13 风格件、look() 与技能三档（以后再做第 13 项第一批其余）
摘要：效果预设升级为“风格件”（说明、用途、旋钮映射、归属全局或风格包，风格包同名覆盖全局），henji-effects 的 look() 引用风格件；技能改成三档规则（风格件 → 内置效果 → 自己写），代码复核标出手写阴影、模糊、发光而效果库有对应效果的地方。
分级：大（持久格式）；执行 Codex sol high，worktree `D:\VibeCode\Henji-AI-t13`，分支 `task/13-风格件与技能三档`；技能措辞由 Claude 把关；Opus 交叉审查 + /code-review。

## 依据
docs/task/代码效果与渲染改进/效果库.md：已定的决定 1、2，代码设计第 5 节（henji-effects）、第 6 节（风格件）、第 8 节（AI 怎么选）；ticket 05 的 henji-effects 实现。

## 范围
1. 效果预设格式升级为风格件：说明、用途、旋钮（名称、范围、映射到哪些效果的哪些参数，线性或分段）、归属；旧预设读成没有旋钮的风格件；按 persistence.md 升版本、迁移、黄金样本。风格包导出/导入带上自己的风格件，同名覆盖全局。
2. 助手能按名称与说明列出、读取风格件；新建或修改风格件要用户确认（代表用户口味）——按项目安全分级，只用一次确认，不加权限模型。
3. henji-effects 的 look('<风格件名>', 旋钮) 解析为效果链，作者代码可直接用。
4. 技能三档规则写进 video-edit-code-creation；代码复核静态检查：作者代码手写 shadowBlur、filter: blur() 或发光算法而效果库有对应效果时提示改用。
## 不做
效果合并（ticket 11）与新效果（ticket 12）；风格件管理界面（后续由 Claude 做）。
## 验收
迁移黄金样本、风格包往返、look() 解析与作者运行测试、复核静态检查测试；check:persistence-compat、check:assistant-capabilities、check:skill-sync、L2 通过。
