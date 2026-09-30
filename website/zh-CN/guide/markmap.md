# Markmap 思维导图

VMark 支持 [Markmap](https://markmap.js.org/)，可在 Markdown 文档中直接创建交互式思维导图树。与 Mermaid 的静态思维导图类型不同，Markmap 使用普通 Markdown 标题作为输入，并提供交互式平移/缩放/折叠功能。

## 插入思维导图

### 使用菜单

**菜单：** 插入 > 思维导图

**键盘快捷键：**`Alt + Shift + Cmd + K`（macOS）/ `Alt + Shift + Ctrl + K`（Windows/Linux）

### 使用代码块

输入带有 `markmap` 语言标识符的围栏代码块：

````markdown
```markmap
# Mindmap

## Branch A
### Topic 1
### Topic 2

## Branch B
### Topic 3
### Topic 4
```text
````

### 通过 AI 助手

没有专门的思维导图工具。通过 [VMark 的 MCP 服务器](/zh-CN/guide/mcp-setup) 连接的 AI 客户端插入思维导图的方式与插入其他 Markdown 内容相同——使用 `document` 或 `selection` 工具，将一个 ` ```markmap ` 代码块写入文档。

## 编辑模式

### 富文本模式（所见即所得）

在所见即所得模式中，Markmap 思维导图渲染为交互式 SVG 树。你可以：

- **平移**——通过点击拖动（普通滚动会滚动文档，而不是思维导图）
- **缩放**——按住 `Ctrl` 并滚动
- **折叠/展开** 节点——点击每个分支处的圆圈
- **适应视图**——点击适应按钮（悬停时出现在右上角）
- **双击** 思维导图以编辑源码

### 带实时预览的源码模式

在源码模式中，当光标位于 markmap 代码块内时，浮动预览面板会显示思维导图，并随输入实时更新。预览默认关闭——可通过 **视图 → 切换图表预览**（`Alt + Mod + P`）或命令面板开启。

## 输入格式

Markmap 使用标准 Markdown 作为输入。标题定义树的层级结构：

| Markdown | 角色 |
|----------|------|
| `# 一级标题` | 根节点 |
| `## 二级标题` | 第一层分支 |
| `### 三级标题` | 第二层分支 |
| `#### 四级标题+` | 更深层分支 |

### 节点中的富文本内容

节点可以包含内联 Markdown：

````markdown
```markmap
# Project Plan

## Research
### Read **important** papers
### Review [existing tools](https://example.com)

## Implementation
### Write `core` module
### Add tests
- Unit tests
- Integration tests

## Documentation
### API reference
### User guide
```text
````

标题下的列表项会成为该标题的子节点。

### 实时演示

以下是直接在本页渲染的交互式思维导图——试试平移、缩放和折叠节点：

```markmap
# VMark Features

## Editor
### WYSIWYG Mode
### Source Mode
### Focus Mode
### Typewriter Mode

## AI Integration
### MCP Server
### AI Genies
### Smart Paste

## Markdown
### Mermaid Diagrams
### Markmap Mindmaps
### LaTeX Math
### Code Blocks
- Syntax highlighting
- Line numbers

## Platform
### macOS
### Windows
### Linux
```

## 交互功能

| 操作 | 方法 |
|------|------|
| **平移** | 点击拖动 |
| **缩放** | `Ctrl` + 滚动 |
| **折叠节点** | 点击分支点处的圆圈 |
| **展开节点** | 再次点击圆圈 |
| **适应视图** | 点击适应按钮（悬停时出现在右上角） |

## 主题集成

Markmap 思维导图会自动适应 VMark 的当前主题（White、Paper、Mint、Sepia 或 Night）。分支颜色会针对每种主题的可读性进行调整。

## 导出为 PNG

在所见即所得模式中，悬停在已渲染的思维导图上会显示 **导出** 按钮。点击它可选择主题：

| 主题 | 背景 |
|------|------|
| **浅色** | 白色背景 |
| **深色** | 深色背景 |

思维导图通过系统保存对话框以 2 倍分辨率 PNG 格式导出。

## 使用技巧

### Markmap 与 Mermaid 思维导图

VMark 同时支持 Markmap 和 Mermaid 的 `mindmap` 图表类型：

| 功能 | Markmap | Mermaid 思维导图 |
|------|---------|-----------------|
| 输入格式 | 标准 Markdown | Mermaid DSL |
| 交互性 | 平移、缩放、折叠 | 静态图像 |
| 富文本内容 | 链接、粗体、代码、列表 | 纯文本 |
| 最适合 | 大型交互式树状图 | 简单静态图表 |

当你需要交互性或已有 Markdown 内容时，使用 **Markmap**。当你需要与其他 Mermaid 图表配合使用时，使用 **Mermaid 思维导图**。

### 了解更多

- **[Markmap 文档](https://markmap.js.org/)**——官方参考
- **[Markmap 演练场](https://markmap.js.org/repl)**——交互式演练场，用于测试思维导图
