# Claude Code 对接 kie.ai 使用指南

# Claude Code 对接 kie.ai 使用指南

通过简单的环境变量配置,就能让本机的 Claude Code 走 kie.ai 的代理通道,使用你在 kie.ai 的账号额度。全程约 3 分钟。

---

## 准备工作:你需要的两个配置项

| 配置项 | 值                                       |
|---|-----------------------------------------|
| `ANTHROPIC_BASE_URL` | `https://api.kie.ai/claude`             |
| `ANTHROPIC_API_KEY` | `Bearer <你的 kie.ai API Key>`            |
| `ANTHROPIC_AUTH_TOKEN` | `<你的 kie.ai API Key>`（与`ANTHROPIC_API_KEY`二选一，不需要加 Bearer） |

> **重要提醒**
>
> - `ANTHROPIC_BASE_URL` 只需要写到 `https://api.kie.ai/claude`,不需要写后面的 `/v1/messages`,Claude Code 会自动补全。
> - API Key 的填写方式有两种，**二选一**：
>   - 方式一：使用 `ANTHROPIC_API_KEY`，值必须以 `Bearer ` 开头（注意 Bearer 后有一个空格），示例：`Bearer sk-kie-abc123xxx`
>   - 方式二：使用 `ANTHROPIC_AUTH_TOKEN`，直接填 Key，**不需要加 Bearer**，示例：`sk-kie-abc123xxx`

---

## 第一步:安装 Claude Code

### Mac 用户

打开「终端」,粘贴执行:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

### Windows 用户

从开始菜单搜索并打开 **PowerShell**,粘贴执行:

```powershell
irm https://claude.ai/install.ps1 | iex
```

安装完成后,运行 `claude --version` 能看到版本号即表示安装成功。

> ⚠️ 如果无法运行claude 命令,检查是否为claude添加了环境变量
>
> ⚠️ 安装后请**不要登录 Anthropic 账号**,我们将在下一步直接使用 kie.ai 的凭据接入。
> 

如果显示

`x Installation failed`

`Failed to fetch version from https://downloads. claude.ai/claude-code-releases/latest: ECONNREFUSED`

请先写入代理网络环境

```powershell
$env:HTTP_PROXY="http://127.0.0.1:`你的端口号`
$env:HTTPS_PROXY="http://127.0.0.1:`你的端口号`
irm https://claude.ai/install.ps1 | iex
```
示例：`http://127.0.0.1:7897`


---

## 第二步:配置凭据

### 方式 A:写入系统环境变量(推荐)

一次配置,以后任意终端运行 `claude` 都会自动走 kie.ai。

#### Mac

打开终端,把下面整段粘贴执行(请先把 Key 换成你自己的，二选一):

```bash
# 方式一：ANTHROPIC_API_KEY（需加 Bearer）
echo 'export ANTHROPIC_BASE_URL="https://api.kie.ai/claude"' >> ~/.zshrc
echo 'export ANTHROPIC_API_KEY="Bearer 你的kie_API_Key"' >> ~/.zshrc
source ~/.zshrc
```

```bash
# 方式二：ANTHROPIC_AUTH_TOKEN（不需要加 Bearer）
echo 'export ANTHROPIC_BASE_URL="https://api.kie.ai/claude"' >> ~/.zshrc
echo 'export ANTHROPIC_AUTH_TOKEN="你的kie_API_Key"' >> ~/.zshrc
source ~/.zshrc
```

#### Windows

打开 PowerShell,粘贴执行(请先把 Key 换成你自己的，二选一):

```powershell
# 方式一：ANTHROPIC_API_KEY（需加 Bearer）
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "https://api.kie.ai/claude", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "Bearer 你的kie_API_Key", "User")
```

```powershell
# 方式二：ANTHROPIC_AUTH_TOKEN（不需要加 Bearer）
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "https://api.kie.ai/claude", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", "你的kie_API_Key", "User")
```

执行完后,**必须关闭所有打开的终端窗口,再重新打开**,新窗口里才能读到变量。

---

### 方式 B:写入 Claude Code 配置文件

只在运行 `claude` 时生效,不会影响系统其它程序,更适合洁癖用户。

打开下面这个文件(若不存在请新建),写入内容并替换 Key:

- **Mac**:`~/.claude/settings.json`
- **Windows**:`C:\Users\<你的用户名>\.claude\settings.json`

```json
// 方式一：ANTHROPIC_API_KEY（需加 Bearer）
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.kie.ai/claude",
    "ANTHROPIC_API_KEY": "Bearer 你的kie_API_Key"
  }
}
```

```json
// 方式二：ANTHROPIC_AUTH_TOKEN（不需要加 Bearer）
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.kie.ai/claude",
    "ANTHROPIC_AUTH_TOKEN": "你的kie_API_Key"
  }
}
```

---

### 方式 C: CC-SWITCH

安装步骤：

- 下载 CC-Switch-Windows.msi 文件。
```
https://github.com/farion1231/cc-switch/releases
```
- 双击运行安装包，按照向导完成安装。
- 安装完成后，在开始菜单或桌面找到 CC Switch 并启动。

填入信息：
- API KEY（无需Bearer）
- 请求地址 'https://api.kie.ai/claude' (建议关闭完整URL)
- 在高级选项中填入KIE文档中对应的模型名

保存后启用即可

---


## 第三步:验证是否成功

打开终端,在任意目录运行:

```bash
claude
```

进入交互界面后,随便问一句话(例如「你好」)。

- ✅ 能正常回复 → 已成功对接 kie.ai,并在kie的logs页面中查看到具体使用记录,可以开始使用
- ❌ 提示要登录 Anthropic 账号 → 请查看下方「常见问题」第 1 条

---

## 常见问题

| 现象 | 原因 / 解决方案 |
|---|---|
| 启动时仍要求登录 Anthropic 账号 | 环境变量未生效。请**完全关闭所有终端窗口**(Mac:右键「退出终端」;Windows:关掉所有 PowerShell 进程)后重新打开 |
| 报错 `401 Unauthorized` | API Key 错误或已过期；若用 `ANTHROPIC_API_KEY` 请确认带了 `Bearer ` 前缀；若用 `ANTHROPIC_AUTH_TOKEN` 则直接填 Key 不加前缀；请到 kie.ai 后台核对 |
| 报错 `model not found` | 进入 claude 后输入 `/model` 命令,切换到 kie.ai 支持的模型 |
| Windows 改完仍无效 | 必须关闭**所有**终端,包括 VSCode、Cursor 等编辑器的内置终端,整个软件退出后重开 |

如需查看 Claude Code 实际发出的请求,可使用 `claude --debug` 启动并查看详细日志。

---

## 安全提示

- API Key 请妥善保管,**切勿**截图、复制到聊天群或提交到代码仓库
- 若配置文件放在项目目录下,务必将 `.claude/settings.json` 加入 `.gitignore`(放在用户主目录下则默认安全)
- 一旦泄漏,请立即到 kie.ai 后台重置 Key

---

如有任何问题,欢迎随时联系我们。

