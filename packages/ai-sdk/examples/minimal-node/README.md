# minimal-node

用 `@henjicc/ai-sdk@0.1.1` 调用 KIE `z-image`。示例不会下载结果文件；成功后只输出供应商返回的 URL。

## 安装

在项目级 `.npmrc` 配置 GitHub Packages。Token 至少需要 `read:packages` 和私有仓库读取权限，
只通过环境变量注入，不要写进文件：

```ini
@henjicc:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

```bash
npm install
npm run dry-run
```

`dry-run` 会走真实 catalog、builder、预处理和 KIE provider，但用本地 `Response` 截住请求，
输出中的 `networkCalls` 必须是 `0`。

## 一次真实调用

当前模型目录估价是 **$0.004/张**。确认账户有余额后，仅在当前终端注入密钥：

```bash
KIE_API_KEY='你的密钥' npm start
```

示例在付费创建端点前有一次性闸门：即使 SDK 的“安全预连接重试”判断被触发，也会在第二次 POST
到达网络前本地拒绝，因此一次进程最多发出一个 KIE 创建请求。状态轮询是只读 GET，不会重复创建任务。

`generate()` 返回 `pending + taskId` 时，示例继续调用 `continuePolling()` 直到得到 URL；SDK 不负责把
URL 下载到磁盘。取消时应保留本次 `requestId` 或供应商 `taskId`，调用
`client.cancel({ namespace: 'generation', taskId })`。
