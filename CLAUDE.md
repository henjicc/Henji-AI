本项目的 AI 规则唯一主要来源是 `AGENTS.md`，下面直接引用它，本文件不重复维护同一份内容。

@AGENTS.md

---

## Claude Code 专属补充

以下是 Claude Code 与 Codex 的执行差异，规则内容本身以 `AGENTS.md` 与 `docs/rules/` 为准。

### skill 的调用方式

`AGENTS.md` 规则索引里出现的 skill，在 Claude Code 中**用 Skill 工具按名称调用**，不要去读 `.codex/skills/` 下的文件路径：

| skill 名 | Claude Code | Codex |
|---|---|---|
| `henji-ui-surface` | Skill 工具调用 | 读 `.codex/skills/henji-ui-surface/SKILL.md` |
| `canvas-node-builder` | Skill 工具调用 | 读 `.codex/skills/canvas-node-builder/SKILL.md` |
| `henji-model-adaptation` | Skill 工具调用 | 读 `.codex/skills/henji-model-adaptation/SKILL.md` |
| `henji-application-capability` | Skill 工具调用 | 读 `.codex/skills/henji-application-capability/SKILL.md` |
| `henji-ai-adaptation-assistant` | Skill 工具调用 | 读 `.codex/skills/henji-ai-adaptation-assistant/SKILL.md` |

对应文件在 `.claude/skills/<skill 名>/SKILL.md`。**两份 skill 内容必须保持同步**：修改任一侧后，同步另一侧再提交。

### 命令执行

本机是 Windows + PowerShell。`docs/rules/testing.md` 第三节的人工核查脚本是 PowerShell 语法，用 PowerShell 工具执行；npm 命令两种 shell 都可以。
