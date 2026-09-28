# Link Check

VMark 會驗證 markdown 中本機連結與圖片的目標是否實際存在於磁碟上。它與 [markdown lint 引擎](/zh-TW/guide/lint) 一起，於 `Alt + Mod + V` 或 **檢視 → 檢查 Markdown** 時執行。

## 它檢查什麼

對文件中的每個本機連結與圖片：

- `[text](./other.md)` — 檔案 `./other.md` 可解析且存在
- `![alt](./image.png)` — 圖片檔案存在
- `[text](./other.md#section)` — 檔案存在（錨點檢查由 [`linkFragments` 規則](/zh-TW/guide/lint#規則參考)處理）

當目標遺失時，lint 徽章與 `F2` / `Shift + F2` 導覽中會出現一筆項目。其繪製方式取決於模式：在原始碼模式中，連結會帶有 CodeMirror 的紅色診斷底線；在所見即所得模式中，包含該連結的整個區塊會在左緣標上一條紅色標示條並帶有淡淡的底色 — 所見即所得模式的 lint 標記是區塊層級的，絕不會是行內底線。

## 它略過什麼

- **僅有片段的連結**（`#anchor`）— 由 `linkFragments` 規則對當前文件的標題進行檢查
- **外部 URL** — 任何 URI 協定（`http:`、`https:`、`mailto:`、`obsidian:`、`vscode:`……）以及省略協定的 `//host/…` URL。Windows 磁碟機代號路徑（`C:\…`、`C:/…`）仍會當作檔案路徑檢查
- **未命名文件** — 沒有已儲存的檔案路徑時，相對 URL 無法相對於任何目錄解析
- **網路路徑與相對於磁碟機的路徑** — UNC 路徑（`\\server\share\…`）絕不會被查找，因為在 Windows 上檢查它會透過網路連線到該主機（並可能向其提供你的 Windows 登入憑證）。相對於磁碟機的 `C:file.md`（磁碟機代號後面沒有斜線）也會略過：它是相對於應用程式的工作目錄，而非相對於文件

## 路徑解析方式

Link Check 會將相對路徑相對於來源檔案所在目錄解析，並將絕對路徑視為它所指名的檔案：

| 在 `/repo/docs/intro.md` 中的連結 | 解析為 |
|---|---|
| `[a](./other.md)` | `/repo/docs/other.md` |
| `[a](../shared.md)` | `/repo/shared.md` |
| `[a](images/logo.png)` | `/repo/docs/images/logo.png` |
| `[a](/docs/intro.md)` | `/docs/intro.md`（絕對路徑指名的就是該檔案；在 Windows 上會落在文件本身所在的磁碟機） |

片段在檔案查找前會被去除 — `[a](./other.md#section)` 只檢查 `./other.md`。

## 效能

- **非同步** — 與同步規則並行執行；結果準備好時併入
- **去重** — 每個唯一解析路徑於每次執行只檢查一次，即使被多次連結
- **不於每次按鍵時觸發** — 對每次按鍵呼叫 `fs.exists` 會造成卡頓；只在明確的 lint 觸發時執行
- **操作錯誤容忍** — 若 `fs.exists` 拋出例外（權限不足、capability 範圍問題），結果為 `error`（略過），而非 `missing`。寧可靜默也不要誤報。

## 診斷代碼

| 代碼 | 嚴重程度 | 觸發條件 |
|---|---|---|
| **M001** | Error | 圖片檔案在解析後的本機路徑找不到 |
| **M002** | Error | 連結指向的檔案在解析後的本機路徑找不到 |

## 另請參閱

- [Markdown Lint](/zh-TW/guide/lint) — 完整規則參考
- [設定 → Markdown → Lint](/zh-TW/guide/settings#lint)
