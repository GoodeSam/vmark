# 隱私政策

VMark 尊重你的隱私。以下是確切發生的事情 — 以及不會發生的事情。

## VMark 發送的資料

VMark 包含一個 **自動更新檢查器**，會定期聯絡我們的伺服器以確認是否有新版本可用。這是 VMark **唯一** 的網路請求。

每次檢查只發送以下欄位 — 不多不少：

| 資料 | 範例 | 用途 |
|------|------|------|
| IP 位址 | `203.0.113.42` | 任何 HTTP 請求固有的 — 我們無法不接收 |
| 作業系統 | `darwin`、`windows`、`linux` | 提供正確的更新套件 |
| 架構 | `aarch64`、`x86_64` | 提供正確的更新套件 |
| 應用程式版本 | `0.5.10` | 判斷是否有可用更新 |
| 機器雜湊 | `a3f8c2...`（64 個十六進位字元） | 匿名裝置計數器 — 主機名稱 + 作業系統 + 架構的 SHA-256；不可逆 |

完整的 URL 如下所示：

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

你可以自行驗證 — 端點位於 [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)（搜尋 `"endpoints"`），雜湊位於 [`lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs)（搜尋 `machine_id_hash`）。

## VMark 不發送的資料

- 你的文件或其內容
- 檔案名稱或路徑
- 使用模式或功能分析
- 任何形式的個人資訊
- 當機報告
- 按鍵或編輯資料
- 可逆的硬體識別符或指紋
- 機器雜湊是單向 SHA-256 摘要 — 無法還原以恢復你的主機名稱或任何其他輸入

## 我們如何使用這些資料

我們彙總更新檢查日誌以生成顯示在我們[首頁](/)的即時統計數據：

| 指標 | 計算方式 |
|------|---------|
| **唯一裝置** | 每天/週/月不同機器雜湊的數量 |
| **唯一 IP** | 每天/週/月不同 IP 位址的數量 |
| **請求次數** | 更新檢查請求的總數 |
| **平台** | 每個作業系統 + 架構組合的請求數量 |
| **版本** | 每個應用程式版本的請求數量 |

這些數字公開發布在 [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats)。沒有任何隱藏。

**重要注意事項：**
- 唯一 IP 低估了實際使用者 — 同一路由器/VPN 後面的多人計算為一個
- 唯一裝置提供更準確的計數，但主機名稱變更或全新作業系統安裝會生成新的雜湊
- 請求次數高估了實際使用者 — 一個人每天可能檢查多次

## 資料保留

- 日誌以標準存取日誌格式儲存在我們的伺服器上
- 日誌檔案達到 1 MB 時輪換，僅保留最近 3 個檔案
- 日誌不與任何人分享
- 沒有帳戶系統 — VMark 不知道你是誰
- 機器雜湊不與任何帳戶、電子郵件或 IP 位址關聯 — 它僅是一個匿名裝置計數器
- 我們不使用追蹤 Cookie、指紋識別或任何分析 SDK

## VMark 能讀取磁碟上的哪些內容

VMark 的檔案存取是一個嚴格限定的權限範圍，而不是整個磁碟：

- **靜態範圍**：你的個人資料夾（`$HOME/**`）以及已掛載的磁碟區 — macOS 上的 `/Volumes/**`，Linux 上的 `/mnt/**` 和 `/media/**`。在 Windows 上，它還涵蓋 `C:\` 到 `F:\` 磁碟機，因此只有 `G:\` 之後的磁碟機以及網路共用資料夾需要執行時授權。在 macOS 和 Linux 上，隱藏資料夾（名稱以 `.` 開頭）中的任何內容都在靜態範圍之外。
- **執行時授權**：你明確開啟的檔案 — 來自 Finder 或檔案總管、`vmark` 命令列或檔案對話框 — 只會取得該檔案的授權。只有當 VMark 能確認是你選擇了某個**資料夾**時，才會授權該資料夾：你在 VMark 的資料夾對話框中選擇了它，或從 Finder 開啟了它。VMark 會保存這些資料夾的清單（應用程式資料資料夾中的 `workspace-grants.json`），並在每次啟動時重新授權，因此還原的工作階段和**開啟最近使用的工作區**都能繼續正常運作。若最近使用的工作區不在該清單中，也不在靜態範圍內，開啟時會在該資料夾處顯示資料夾對話框 — 選擇它即可確認。當 AI 助理要求開啟這樣的資料夾時，在你核准請求後，VMark 也會這樣做。
- **圖片與媒體**：本機圖片、影片和音訊透過 VMark 的資源協定顯示，其可及範圍相同 — 靜態範圍加上上述執行時授權。媒體檢視器只為它顯示的那一個檔案新增授權，且僅限具有媒體副檔名的檔案；對其他任何路徑的請求都會被拒絕，而不會擴大範圍。位於這些範圍之外的圖片 — 例如你從靜態範圍外單獨開啟的文件旁邊的圖片 — 在你將其所在資料夾作為工作區開啟之前不會顯示。

這裡的一切都不會被傳送到任何地方；該範圍只決定應用程式本身可以讀取什麼。

## 開放原始碼透明度

VMark 完全開放原始碼。你可以驗證此處描述的一切：

- 更新端點設定：[`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- 機器雜湊生成：[`src-tauri/src/lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) — 搜尋 `machine_id_hash`
- 檔案系統與資源範圍：[`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json)、[`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) 中的 `assetProtocol` 項目、[`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs) 和 [`src-tauri/src/workspace_grants/`](https://github.com/xiaolai/vmark/tree/main/src-tauri/src/workspace_grants)
- 伺服器端統計彙總：[`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — 在我們伺服器上執行以生成[公開統計數據](https://log.vmark.app/api/stats)的確切腳本
- 程式碼庫中沒有其他網路呼叫 — 自行搜尋 `fetch`、`http` 或 `reqwest`

## 停用更新檢查

若你偏好完全停用自動更新檢查，可以在網路層面封鎖 `log.vmark.app`（防火牆、`/etc/hosts` 或 DNS）。VMark 在沒有它的情況下仍然可以正常運作 — 你只是不會收到更新通知。
