# 隐私

VMark 尊重你的隐私。以下是确切发生的——以及不会发生的。

## VMark 发送的内容

VMark 包含一个 **自动更新检查器**，会定期联系我们的服务器以查看是否有新版本可用。这是 VMark 发出的 **唯一** 网络请求。

每次检查只发送以下字段——仅此而已：

| 数据 | 示例 | 用途 |
|------|------|------|
| IP 地址 | `203.0.113.42` | 任何 HTTP 请求都会固有地包含——我们无法不接收它 |
| 操作系统 | `darwin`、`windows`、`linux` | 用于提供正确的更新包 |
| 架构 | `aarch64`、`x86_64` | 用于提供正确的更新包 |
| 应用版本 | `0.5.10` | 用于判断是否有可用更新 |
| 机器哈希 | `a3f8c2...`（64 位十六进制） | 匿名设备计数——由主机名+操作系统+架构的 SHA-256 生成；不可逆 |

完整 URL 如下：

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

你可以自行验证——端点在 [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) 中（搜索 `"endpoints"`），哈希生成逻辑在 [`lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) 中（搜索 `machine_id_hash`）。

## VMark 不会发送的内容

- 你的文档或其内容
- 文件名或路径
- 使用模式或功能分析
- 任何形式的个人信息
- 崩溃报告
- 按键或编辑数据
- 可逆的硬件标识符或指纹
- 机器哈希是单向 SHA-256 摘要——无法逆向恢复你的主机名或任何其他输入

## 我们如何使用数据

我们汇总更新检查日志，生成显示在我们[首页](/)上的实时统计数据：

| 指标 | 计算方式 |
|------|---------|
| **唯一设备** | 每日/每周/每月不同机器哈希的数量 |
| **唯一 IP** | 每日/每周/每月不同 IP 地址的数量 |
| **请求次数** | 更新检查请求的总次数 |
| **平台** | 每种操作系统+架构组合的请求数量 |
| **版本** | 每个应用版本的请求数量 |

这些数字在 [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats) 公开发布。没有任何隐藏。

**重要说明：**
- 唯一 IP 数量低估了真实用户——同一路由器/VPN 后面的多人只计为一个
- 唯一设备提供更准确的计数，但主机名更改或全新操作系统安装会生成新的哈希
- 请求次数高估了真实用户——同一人每天可能检查多次

## 数据保留

- 日志以标准访问日志格式存储在我们的服务器上
- 日志文件在 1 MB 时轮换，只保留最近 3 个文件
- 日志不与任何人共享
- 没有账户系统——VMark 不知道你是谁
- 机器哈希不与任何账户、电子邮件或 IP 地址关联——它只是一个假名设备计数器
- 我们不使用跟踪 Cookie、指纹识别或任何分析 SDK

## VMark 能读取磁盘上的哪些内容

VMark 的文件访问是一个严格限定的权限范围，而不是整个磁盘：

- **静态范围**：你的主文件夹（`$HOME/**`）以及已挂载的卷——macOS 上的 `/Volumes/**`，Linux 上的 `/mnt/**` 和 `/media/**`。在 Windows 上，它还涵盖 `C:\` 到 `F:\` 驱动器，因此只有 `G:\` 及之后的驱动器和网络共享需要运行时授权。在 macOS 和 Linux 上，隐藏文件夹（名称以 `.` 开头）中的任何内容都在静态范围之外。
- **运行时授权**：你明确打开的文件——来自访达或文件资源管理器、`vmark` 命令行或文件对话框——只会获得针对该文件的授权。只有当 VMark 能确认是你选择了某个**文件夹**时，才会授权该文件夹：你在 VMark 的文件夹对话框中选择了它，或从访达打开了它。VMark 会保存这些文件夹的列表（应用数据文件夹中的 `workspace-grants.json`），并在每次启动时重新授权，因此恢复的会话和**打开最近工作区**都能继续正常使用。如果最近的工作区不在该列表中，也不在静态范围内，打开它时会在该文件夹处弹出文件夹对话框——选择它即可确认。当 AI 助手请求打开这样的文件夹时，在你批准请求后，VMark 也会这样做。
- **图片与媒体**：本地图片、视频和音频通过 VMark 的资源协议显示，其可达范围相同——静态范围加上上述运行时授权。媒体查看器只为它显示的那一个文件添加授权，且仅限带有媒体扩展名的文件；对任何其他路径的请求都会被拒绝，而不会扩大范围。位于这些范围之外的图片——例如你从静态范围外单独打开的文档旁边的图片——在你将其所在文件夹作为工作区打开之前不会显示。

这里的一切都不会被发送到任何地方；该范围只决定应用本身可以读取什么。

## 开源透明度

VMark 完全开源。你可以验证这里描述的一切：

- 更新端点配置：[`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- 机器哈希生成：[`src-tauri/src/lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs)——搜索 `machine_id_hash`
- 文件系统与资源范围：[`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json)、[`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) 中的 `assetProtocol` 条目、[`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs) 和 [`src-tauri/src/workspace_grants/`](https://github.com/xiaolai/vmark/tree/main/src-tauri/src/workspace_grants)
- 服务端统计聚合：[`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json)——在我们服务器上运行以生成[公开统计数据](https://log.vmark.app/api/stats)的确切脚本
- 代码库中不存在其他网络调用——自行搜索 `fetch`、`http` 或 `reqwest`

## 禁用更新检查

如果你更希望完全禁用自动更新检查，可以在网络层面屏蔽 `log.vmark.app`（防火墙、`/etc/hosts` 或 DNS）。VMark 在没有它的情况下也能正常工作——你只是不会收到更新通知。

## 报告安全问题

如果你在 VMark 中发现了安全漏洞，例如 MCP 桥接、内嵌浏览器、更新程序或文件处理方面的问题，请通过 [GitHub 的私密漏洞报告](https://github.com/xiaolai/vmark/security/advisories/new)私下提交，不要创建公开的 issue。[安全策略](https://github.com/xiaolai/vmark/blob/main/SECURITY.md)说明了受理范围以及提交后的处理方式。
