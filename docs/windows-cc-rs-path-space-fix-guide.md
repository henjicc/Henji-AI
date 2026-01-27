# Windows 上 `cc-rs` 报 `failed to find tool "C:\\Program"` 的修复指南（Tauri 2 / Rust）

## 症状

构建（常见于 Tauri/Rust 项目依赖含 `build.rs`、`cc` crate 的场景）时报错类似：

> `error occurred in cc-rs: failed to find tool "C:\\Program": 系统找不到指定的文件。(os error 2)`

## 根因（为什么会变成 `C:\Program`）

`cc-rs` 会从环境变量里读取 C/C++ 编译器命令（优先常见为 `CC` / `CXX`）。当这些变量被设置成带空格的路径（例如 `C:\Program Files\...`）且未被 `cc-rs` 正确解析时，会被按空格切分，最终把 `C:\Program` 当成可执行文件去找，于是报错。

典型触发方式：

- 你的系统/终端环境里已经存在 `CC`/`CXX`，值是 `C:\Program Files\...` 这种带空格的全路径。
- 你在项目里添加了 `.cargo/config.toml`，但它没有覆盖掉已有的同名环境变量，导致 `cc-rs` 仍读到旧值。

## Henji-AI 是怎么避免的（可迁移的关键点）

Henji-AI 的策略是 **不把 `CC/CXX` 设置成带空格的全路径**，而是：

1. 将 `CC`/`CXX` 固定为不含空格的短命令名：`cl.exe`
2. 启动时先执行 `VsDevCmd.bat` 注入 MSVC 环境（让 `cl.exe/link.exe` 进入 `PATH`），再启动 `tauri dev/build`

对应实现：

- `.cargo/config.toml`：`CC = "cl.exe"`, `CXX = "cl.exe"`, `linker = "link.exe"`
- `package.json` 脚本：先 `VsDevCmd.bat`，再 `set CC=cl.exe` / `set CXX=cl.exe`

## 新项目修复方案（推荐按顺序做）

### 1) 检查你当前环境是否已经污染了 `CC/CXX`

在 PowerShell 执行：

```powershell
Get-ChildItem Env:CC,Env:CXX -ErrorAction SilentlyContinue
```

如果输出里出现了类似 `C:\Program Files\...` 的值，优先按下面第 2/3 步修复（不要继续依赖这个值）。

### 2) 在项目根目录添加/修改 `.cargo/config.toml`（强制覆盖）

在新项目根目录创建 `.cargo/config.toml`（或修改已有文件）：

```toml
[env]
CC = { value = "cl.exe", force = true }
CXX = { value = "cl.exe", force = true }

[target.x86_64-pc-windows-msvc]
linker = "link.exe"
```

说明：

- `force = true` 的目的：**即使系统环境里已有 `CC/CXX`，也强制以这里为准**，避免被带空格的旧值覆盖。
- 只写 `CC = "cl.exe"` 在某些环境里可能不会覆盖外部同名变量，从而“看似配置了但仍报错”。

### 3) 确保启动时拿到 MSVC 工具链（让 `cl.exe` 在 PATH 里）

如果你不是在 “Developer PowerShell / x64 Native Tools Command Prompt” 里运行命令，建议像 Henji-AI 一样在 `package.json` 增加 Windows 专用脚本（npm 在 Windows 下默认用 `cmd.exe` 执行脚本，`call`/`set` 可用）：

```jsonc
{
  "scripts": {
    "tauri:dev:win": "call \"%ProgramFiles(x86)%\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\Tools\\VsDevCmd.bat\" -arch=amd64 && set \"CC=cl.exe\" && set \"CXX=cl.exe\" && tauri dev",
    "tauri:build:win": "call \"%ProgramFiles(x86)%\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\Tools\\VsDevCmd.bat\" -arch=amd64 && set \"CC=cl.exe\" && set \"CXX=cl.exe\" && tauri build"
  }
}
```

注意：

- 如果你装的是 VS Community/Enterprise，而不是 BuildTools，请把路径中的 `BuildTools` 改成对应版本目录（例如 `Community`）。
- 你也可以不改脚本，改为在 VS 提供的 “Developer PowerShell/Prompt” 中执行 `tauri dev`，效果等价：目标都是让 `cl.exe/link.exe` 可被找到。

### 4) 验证

建议在一次干净构建下验证（避免缓存干扰）：

```powershell
cargo clean
```

然后用你的 Windows 启动脚本运行（例如 `npm run tauri:dev:win`）。

如果仍报同类错误，优先再次确认：

- `Env:CC` / `Env:CXX` 是否仍是带空格路径（第 1 步）
- 你的构建是否确实读取到了项目根目录的 `.cargo/config.toml`
- 当前终端是否能执行 `cl.exe`（`Get-Command cl.exe`）

## 常见误区

- **误区 1：把 `CC` 写成 `C:\Program Files\...\cl.exe`（即使加引号也可能踩坑）**  
  更稳妥的做法是：用 `cl.exe` + `PATH`（通过 `VsDevCmd.bat` 或 Developer Prompt 注入）。

- **误区 2：只复制 `.cargo/config.toml` 就能解决一切**  
  如果你的环境里已有 `CC/CXX`，且没有 `force = true`，很可能仍然读到旧值；另外 `cl.exe` 不在 `PATH` 也会失败（只是报错形态不同）。

