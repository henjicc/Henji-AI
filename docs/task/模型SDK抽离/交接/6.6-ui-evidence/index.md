# Henji-AI 界面巡检证据

- 生成时间：2026-08-27T12:03:05.179Z
- 原始截图数量：1
- 归档截图数量：0
- 失败数量：2
- 数据模式：真实用户数据
- 结构化日志：[evidence.json](evidence.json)，通过应用查询接口按场景起始时间截取；其中 `passed` 只表示未捕获浏览器或应用运行时错误，不表示场景选择器通过

## 截图去重

原始 `1440x900-sdk66-provider-probe-restore.png` 与最终复验的恢复截图 SHA-256 完全相同，归档时删除重复副本；恢复现场见 [最终复验恢复截图](../6.6-ui-final/1440x900-sdk66-balance-restore.png)。

## 失败场景

- 1440x900 / 6.6-KIE 真实余额：`locator.waitFor` 超时 8000ms；等待首次设置对话框中 role=status 下的“连接成功 / Connected”文本可见。
- 1440x900 / 6.6-APIMart 真实余额：`locator.waitFor` 超时 8000ms；等待首次设置对话框中 role=status 下的“连接成功 / Connected”文本可见。
