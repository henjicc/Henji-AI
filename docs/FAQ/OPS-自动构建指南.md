# GitHub Actions 自动构建指南

本指南介绍如何使用 GitHub Actions 自动构建 Windows 和 macOS 版本的痕迹AI应用程序。

## 📋 前置要求

1. **GitHub 仓库**：确保你的项目已经推送到 GitHub
2. **仓库权限**：需要对仓库有写入权限
3. **Actions 启用**：确保仓库的 Actions 功能已启用（默认启用）

## 🚀 快速开始

### 1️⃣ 推送代码到 GitHub

如果还没有推送代码到 GitHub：

```bash
# 初始化 Git 仓库（如果还没有）
git init

# 添加远程仓库
git remote add origin https://github.com/你的用户名/Henji-AI.git

# 添加所有文件
git add .

# 提交
git commit -m "Add GitHub Actions workflow"

# 推送到 main 分支
git push -u origin main
```

### 2️⃣ 触发构建

workflow 会在以下情况自动触发：

- **推送到 main 分支**：每次你 `git push` 到 main 都会触发构建
- **创建标签**：例如 `git tag v1.0.0 && git push --tags`
- **提交 Pull Request**：向 main 分支提交 PR 时
- **手动触发**：在 GitHub Actions 页面手动运行

#### 手动触发步骤：

1. 访问你的仓库页面
2. 点击顶部的 **"Actions"** 标签
3. 在左侧选择 **"Build Henji-AI"** workflow
4. 点击右上角的 **"Run workflow"** 按钮
5. 选择分支（通常是 `main`）
6. 点击绿色的 **"Run workflow"** 按钮

### 3️⃣ 查看构建进度

1. 在 **Actions** 页面，你会看到正在运行的 workflow
2. 点击某个运行记录可以查看详细日志
3. 展开 `build-windows` 或 `build-macos` 可以看到每个步骤的输出

### 4️⃣ 下载构建产物

构建完成后：

1. 进入该次运行的详情页面
2. 滚动到底部的 **"Artifacts"** 区域
3. 下载你需要的安装包：
   - `windows-installer`：包含 `.msi` 安装程序
   - `macos-dmg`：包含 `.dmg` 镜像文件
   - `macos-app`：包含 `.app` 应用程序包

> **注意**：Artifacts 会在 90 天后自动删除。

## ⚙️ Workflow 配置说明

### 触发条件

```yaml
on:
  push:
    branches: [main]         # 推送到 main 分支
    tags: ['v*']            # 推送版本标签（如 v1.0.0）
  pull_request:
    branches: [main]         # PR 到 main 分支
  workflow_dispatch:         # 手动触发
```

### 构建作业

#### Windows 构建 (`build-windows`)

- **运行环境**：`windows-latest`（Windows Server 2022）
- **构建命令**：使用 Visual Studio 开发环境编译
- **输出产物**：`.msi` 安装程序

#### macOS 构建 (`build-macos`)

- **运行环境**：`macos-latest`（macOS 14 Sonoma）
- **构建目标**：`universal-apple-darwin`（同时支持 Intel 和 Apple Silicon）
- **输出产物**：`.dmg` 安装镜像

## 🔧 高级配置

### 修改触发分支

如果你的主分支不是 `main`，需要修改 `.github/workflows/build.yml`：

```yaml
on:
  push:
    branches:
      - master  # 改成你的分支名
```

### 仅在发布版本时构建

如果你只想在打标签时构建：

```yaml
on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
```

然后通过以下方式触发构建：

```bash
git tag v1.0.0
git push origin v1.0.0
```

### 添加版本号自动更新

在构建前自动更新 `package.json` 和 `tauri.conf.json` 中的版本号，可以在 workflow 中添加步骤：

```yaml
- name: Update version
  if: startsWith(github.ref, 'refs/tags/')
  run: |
    VERSION=${GITHUB_REF#refs/tags/v}
    npm version $VERSION --no-git-tag-version
```

## 🛡️ 代码签名（可选）

### Windows 代码签名

需要添加以下 secrets 到仓库：

1. 进入仓库 **Settings** → **Secrets and variables** → **Actions**
2. 添加以下 secrets：
   - `WINDOWS_CERTIFICATE`：Base64 编码的 PFX 证书
   - `WINDOWS_CERTIFICATE_PASSWORD`：证书密码

然后在 workflow 中添加签名步骤。

### macOS 代码签名

需要 Apple Developer 账号和证书，配置较为复杂，初期可以跳过。

## ⚠️ 注意事项

1. **构建时间**：
   - Windows 构建：约 10-15 分钟
   - macOS 构建：约 15-20 分钟
   - 首次构建会更慢（需要下载依赖）

2. **GitHub Actions 配额**：
   - 公开仓库：无限制
   - 私有仓库：每月 2000 分钟免费额度

3. **并行构建**：
   - Windows 和 macOS 会同时构建，互不影响
   - 如果一个失败，另一个仍会继续

4. **依赖缓存**：
   - workflow 已配置 npm 和 Rust 依赖缓存
   - 这会显著加速后续构建

5. **构建失败排查**：
   - 查看 Actions 页面的详细日志
   - 常见问题：依赖安装失败、编译错误、权限问题

## 📦 发布到 GitHub Releases

如果你想自动创建 GitHub Release 并上传安装包，可以添加一个新的 job：

```yaml
release:
  if: startsWith(github.ref, 'refs/tags/')
  needs: [build-windows, build-macos]
  runs-on: ubuntu-latest
  steps:
    - name: Download artifacts
      uses: actions/download-artifact@v4
    
    - name: Create Release
      uses: softprops/action-gh-release@v1
      with:
        files: |
          windows-installer/*.msi
          macos-dmg/*.dmg
        draft: false
        prerelease: false
```

这样，每次你推送版本标签时，就会自动创建一个 Release 并上传安装包。

## 🆘 常见问题

### Q: 构建失败了怎么办？

A: 点击失败的 workflow 运行，查看红色的步骤，展开日志查看具体错误信息。

### Q: 如何加速构建？

A: workflow 已经配置了依赖缓存。如果还想更快，可以减少触发频率（如仅在标签时构建）。

### Q: 能否只构建某个平台？

A: 可以手动触发 workflow 时选择，或修改 workflow 文件，为每个平台创建独立的 workflow。

### Q: 构建产物在哪里？

A: 在 Actions 页面的运行详情底部 "Artifacts" 区域下载。

## 📚 相关资源

- [GitHub Actions 官方文档](https://docs.github.com/cn/actions)
- [Tauri 官方文档 - CI/CD](https://tauri.app/v1/guides/building/cross-platform)
- [actions/setup-node](https://github.com/actions/setup-node)
- [dtolnay/rust-toolchain](https://github.com/dtolnay/rust-toolchain)
