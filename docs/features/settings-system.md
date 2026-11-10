# 系統設定

[回功能總覽](../README.md) · 路徑：`/settings/system` · 狀態：**部分實作（暫時環境診斷，唯讀、僅限管理員）**

## 目的
暫時確認目前伺服器執行環境中的六項設定及其用途，協助排查部署設定；不是一般設定管理介面，診斷完成後應移除此功能。

## 解決的問題
避免將憑證貼進對話、日誌或文件。管理員可在應用程式內確認設定是否存在、是否為空字串，必要時手動顯示單項敏感值。

## 可以找到的 Insight
這是設定診斷，不是分析或健康監控。值已設定不代表正確、仍有效或已取得 Jira 權限；此頁不測試 OAuth、callback 或 Jira 連線。

## 使用方式
1. 以符合既有管理員 email 政策的帳號登入，進入系統設定。頁面與每次顯示均重新驗證 server session；直接開啟網址也不能繞過授權。Session 必須有有效格式的使用者 ID，且沒有 Jira 授權錯誤。
2. 非敏感的三項直接顯示值；三項敏感值預設完全遮蔽，初始 HTML／RSC／client props 不含原值、前後綴或長度。
3. 按「顯示敏感值」後仍須按「確認顯示」，才會透過 Server Action 讀取該單項值；一次只顯示一項。
4. 「隱藏／清除」、改選其他項目、切換瀏覽器分頁或離頁會清除介面暫存；晚到回應不重新顯示。**這不能撤回已到達瀏覽器的網路回應或 DevTools 中已見的憑證**，不要在螢幕分享時顯示。
5. 未設定（不存在）與空字串明確區分。長值換行顯示；沒有修改、保存、匯出、下載或自動複製功能，也不存 browser storage。

| 變數 | 顯示方式 | 用途 |
| --- | --- | --- |
| `ATLASSIAN_PAT` | 敏感、預設遮蔽 | Atlassian 個人存取權杖名稱；目前 production 程式不使用此變數，Jira 請求使用 OAuth。 |
| `AUTH_ATLASSIAN_SECRET` | 敏感、預設遮蔽 | Atlassian OAuth client secret，用於登入與更新 token。 |
| `AUTH_SECRET` | 敏感、預設遮蔽 | Auth.js JWT session 與應用程式分頁 token 的加密密鑰。 |
| `AUTH_ATLASSIAN_ID` | 完整值 | Atlassian OAuth client ID，用於登入與更新 token。 |
| `AUTH_URL` | 完整值 | 應用程式穩定網址，用於 Auth.js 部署及 OAuth callback 設定。 |
| `ATLASSIAN_JIRA_CLOUD_URL` | 完整值 | 目標 Jira Cloud 網址，用於匹配授權站點、Issue 連結與登入頁站點名稱。 |

## 指標與判定規則
唯讀、固定白名單；不列舉任意環境變數。授權後才於 request-time 讀取 `process.env[key]`，不讀 `.env.local` 或憑證檔，不快取診斷結果。這個順序保證不包含 `auth()` 本身讀取登入設定的行為。

管理員判定共用既有 `ADMIN_EMAILS` 政策與 `isAdminEmail()`，不是 client 傳入 email 或導覽狀態。Session email 來自 Atlassian `/me` 的登入資料，未增加 `email_verified` 檢查或另一次 Jira 身分驗證，也不改其他頁的授權。

## Jira 資料依據
本頁沒有 JQL 或 Jira REST request，不變更欄位、查詢或 Jira transport。`auth()` 沿用原本的 session／OAuth 更新流程；登入及權限配置本身不由此頁修改。

## 限制與解讀注意事項
- 此功能讓通過 server 管理員驗證的人員主動取得完整敏感值，仍有瀏覽器、錄影、螢幕分享及第三方瀏覽器工具的暴露風險。請限於必要診斷使用，完成後移除。
- 顯示的是目前這次 request 所在伺服器的環境值，不是其他部署／執行個體、憑證檔內容或 Auth.js 最終推導設定。例如未設定 `AUTH_URL` 不代表 Auth.js 一定無法推導網址。
- Server Action 重新授權且沿用 Next 的 POST／Origin 檢查及 no-store 回應；隱藏不代表可以取消已送出的請求或安全抹除瀏覽器記憶體。
- 不宣稱已部署、真實環境值已驗證或 Jira 連線健康。驗證只使用合成 fixture／mock auth，未做實際瀏覽器／部署測試。

## 實作狀態與程式來源
- [系統設定頁](../../app/(app)/settings/system/page.tsx) 重用 [PageHeader](../../components/page-header.tsx)，排除 prerender 後才讀取安全 DTO。
- [固定項目與型別](../../app/(app)/settings/system/environment.ts)、[server reader／授權](../../app/(app)/settings/system/environment-server.ts)、[Server Action](../../app/(app)/settings/system/actions.ts)、[診斷介面](../../app/(app)/settings/system/environment-diagnostics.tsx)。
- [共用管理員政策](../../components/app-shell/navigation.ts)、[離線診斷回歸](../../tests/system-environment.test.mjs)。

### 診斷完成後移除
將系統設定頁恢復一般占位／設定頁，並一併移除同目錄 `environment.ts`、`environment-server.ts`、`environment-diagnostics.tsx`、`actions.ts` 及專屬測試，避免留下可直接呼叫的單項顯示 action；同步更新本文件、功能總覽與 README。共用 `isAdminEmail()` 不包含環境診斷或憑證值，可保留。
