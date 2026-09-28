# 链接检查

VMark 会验证 markdown 中的本地链接和图片目标是否真实存在于磁盘上。它与 [Markdown 检查](/zh-CN/guide/lint) 一起在 `Alt + Mod + V` 或 **视图 → 检查 Markdown** 时运行。

## 它检查什么

对文档中的每个本地链接和图片：

- `[text](./other.md)` —— 文件 `./other.md` 能解析且存在
- `![alt](./image.png)` —— 图片文件存在
- `[text](./other.md#section)` —— 文件存在（锚点检查由 [`linkFragments` 规则](/zh-CN/guide/lint#规则参考)处理）

当目标缺失时，lint 徽章和 `F2` / `Shift + F2` 导航中会出现一条记录。其呈现方式取决于模式：在源码模式下，链接会带上 CodeMirror 的红色诊断下划线；在所见即所得模式下，包含该链接的整个块会在左边缘标上一条红色竖条，并带有淡淡的底色 —— 所见即所得模式下的 lint 标记是块级的，绝不会是内联下划线。

## 它跳过什么

- **仅片段链接**（`#anchor`）—— 由 `linkFragments` 规则处理，针对当前文档的标题进行检查
- **外部 URL** —— 任何 URI 协议（`http:`、`https:`、`mailto:`、`obsidian:`、`vscode:`……）以及协议相对的 `//host/…` URL。Windows 盘符路径（`C:\…`、`C:/…`）仍会作为文件路径进行检查
- **未命名文档** —— 没有保存的文件路径，相对 URL 无法相对于任何目录解析
- **网络路径和驱动器相对路径** —— UNC 路径（`\\server\share\…`）永远不会被查找，因为在 Windows 上检查它会通过网络联系该主机（并可能向其提供你的 Windows 登录凭据）。驱动器相对路径 `C:file.md`（盘符后面没有斜杠）同样会被跳过：它相对于应用的工作目录，而不是相对于文档

## 解析方式

链接检查将相对路径相对于源文件目录解析，而将绝对路径视为它所指明的那个文件：

| `/repo/docs/intro.md` 中的链接 | 解析为 |
|---|---|
| `[a](./other.md)` | `/repo/docs/other.md` |
| `[a](../shared.md)` | `/repo/shared.md` |
| `[a](images/logo.png)` | `/repo/docs/images/logo.png` |
| `[a](/docs/intro.md)` | `/docs/intro.md`（绝对路径指明的就是该文件；在 Windows 上，它位于文档自身所在的驱动器） |

文件查找前会去除片段 —— `[a](./other.md#section)` 只检查 `./other.md`。

## 性能

- **异步** —— 与同步规则并行运行；结果就绪时合并进来
- **去重** —— 每个唯一的解析路径每次运行只检查一次，即使被多处链接也是如此
- **不按键触发** —— 每次按键都执行 fs.exists 会拖累性能；只在显式触发 lint 时运行
- **运行时错误容忍** —— 如果 `fs.exists` 抛出异常（权限被拒、能力作用域问题），结果是 `error`（跳过），而不是 `missing`。沉默优于错误。

## 诊断代码

| 代码 | 严重级别 | 触发条件 |
|---|---|---|
| **M001** | 错误 | 在解析后的本地路径上未找到图片文件 |
| **M002** | 错误 | 在解析后的本地路径上未找到链接的文件 |

## 另请参阅

- [Markdown 检查](/zh-CN/guide/lint) —— 完整规则参考
- [设置 → Markdown → Lint](/zh-CN/guide/settings#lint)
