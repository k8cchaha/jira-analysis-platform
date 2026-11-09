# 儀表板

[回功能總覽](../README.md) · 路徑：`/dashboard` · 狀態：**已實作（Jira 讀取＋受限本人補填）**

## 目的
登入後集中查看同一指派範圍的注意事項、缺失欄位及目前開發／測試單分布，從數字進入明細或 Jira 票，安排下一步。

## 解決的問題
- 高優先 Bug、到期票與待 Review／資訊的票散落在不同查詢。
- 估點、實際點數、原因分類與影響範圍缺漏不容易集中確認。
- 查團隊資料與替本人補填有不同權限，不能因看得到就可修改。

## 可以找到的 Insight
| 問題 | 訊號 | 可能行動 |
| --- | --- | --- |
| 哪些 Bug 值得優先確認？ | S0／S1；P2 超過10天未更新 | 開明細確認 Priority、處理情形與責任人，再安排追蹤 |
| 哪些期限需要追蹤？ | 已逾期／今天起三天區間內到期 | 查票確認期限、狀態與承諾，協商下一步 |
| 哪些票需要 Review 或資訊？ | 現在 In Review／Request Info | 確認 Reviewer、欠缺資訊與回覆對象 |
| 哪些工作單資料需補？ | SP／Actual、Defect Cause、Impact Scope 缺失 | self 可依資格補填；查團隊時提醒相關人處理 |
| 指派的開發／測試單在哪一欄？ | 看板三欄與票卡 | 開 Jira 查下一步，討論協作與 Review |

Priority 不是業務影響的自動評估；未更新不代表沒有工作；缺值不代表效率差。系統提供追查訊號，不會自動判定原因、SLA 違約或採取上述行動。

## 使用方式
### 範圍
- **自己（預設）**：立即套用，以 Jira `currentUser()` 查詢，不增加 Dashboard 近 N 天條件。
- **指定人**：搜尋 display name，server 以 accountId 再驗證；單一結果可自動套用，多結果須選人再查詢。近 N 天預設30。
- **團隊／專案**：團隊多選、可逐團隊排除成員，專案可選；完整名單載入後按查詢／Enter。先逐團隊排除，再 union／去重；在 A 被排除仍可能由 B 納入。
- person／team 的所有 Dashboard 工作查詢都加 **`created >= -Nd`**。它是建立日視窗，不是完成日／更新日視窗；既有 Updated、Due date 與固定發布條件仍保留。
- 已套用範圍在 URL 還原；未知或不完整範圍報錯，不改查本人或放大範圍。

### 卡片與明細
- 警示卡與缺失卡獨立載入；成功且數量大於0才可開明細。Loading／error 不是0；0只代表本查詢無匹配。
- 所有警示明細唯讀。缺失資料明細只有 self 可能補填；指定人模式即使選本人也唯讀。
- 缺失明細自動取得全部 batches，無可見分頁。補填只送有改動的票，最多50張；部分失敗保留失敗草稿，成功後刷新對應數量。
- 草稿未保存時有導航／關閉保護。明細保留開啟時範圍；不是凍結 Jira 資料快照。
- **顯示非預期關閉的票**預設未勾，只移除 Points 讀取的 resolution 限制；不是所有關閉票清單，不改其他卡片或原始寫入資格。self 立即套用，其他模式須查詢；URL 使用 `includeUnexpectedClosed=1`。

### 任務看板
- Dev-Task＋QA-Task，排除 literal `Done`，三欄 **To Do／In Progress／In Review**；沒有拖放或站內更新狀態。
- self 額外預設勾「近30天建立／更新」：`created >= -30d OR updated >= -30d`。這是看板自己的 local control，取消／清空可移除，改值即查，不寫入 Dashboard URL。
- nonself 看板沒有這個 control，仍套用上方 **created-only** 視窗。
- 票卡顏色來自母票 Story／Task／Bug，不是 Priority 或子票類型；點票卡外連 Jira。

## 指標與判定規則
### 警示
| 群組 | 判定 |
| --- | --- |
| S0／S1 | Bug，Priority Critical (P0)／High (P1)，To Do category 或 In Progress |
| S2 | Bug，Priority Medium (P2)，相同處理狀態，且 `updated < -10d` |
| 待處理 | 現在 status＝In Review 或 Request Info；不限票種 |
| 已逾期 | `duedate < startOfDay()`，To Do category／In Progress／In Review |
| 即將到期 | `startOfDay() <= duedate < startOfDay("+3d")`，相同處理狀態，不限票種 |

Bug base 目前**沒有固定專案限制**；選定專案才加交集。卡片為完整查詢計數，不是抽樣或 approximate count。

日數有不同口徑：Bug 未更新日數為 server 觀測時刻距 Updated 的完整24小時；Pending「停留日數」為 Updated 到瀏覽器今天的日曆日差，**不是進入狀態後的時間**；Due 顯示瀏覽器日曆日距離，但到期分組由 Jira `startOfDay()` 解讀。

### 缺失資料
- **Points**：Dev／QA、原始 resolution＝EMPTY／Done／Fixed；兩分支取 unique issue union：`status = Done` 且 Actual 空／0，或非 To Do category 且 SP 空／0。不是每張票都必須同時缺兩欄。
- **Defect Cause**：SUN／TKK／JIRATRY Bug，非 To Do、非 In Progress／Dev Ready，原始 resolution 範圍，Defect Cause empty。Root Cause／Solution 供閱讀，不由系統推導原因。
- **Impact Scope**：SUN Story／Task／Bug，Impact 空、Release Package 非空，且 `created >= 2026-11-01 OR Release Package = Sprint9`；**不限狀態**。nonself 的近 N 天仍與此條件取交集。
- 同票符合 Points 兩分支只算一張；0count不代表 Jira 全部資料完整。

### 寫入資格
| 類別 | 可用操作 |
| --- | --- |
| 警示／看板 | 全模式唯讀，外連 Jira 不等於站內寫入 |
| 缺失資料 person／team | 唯讀，沒有 Save／編輯 options |
| Points self | 仍在原始 missing union 的票可補填或調整已有值；提交原值，替換為正數，可小數，不可0／負數／清空 |
| Defect Cause self | 只補 empty，至少一個該票有效多選 option；不覆蓋已填 |
| Impact Scope self | 只補 empty，runtime 確認 single／multi、set 權限與有效 options；不清空、不覆蓋 |
| Expanded Points 新增列 | 不符合原始 self eligibility 者依然唯讀，即使同一張列表其他列可編輯 |

server 再用 **原始本人 JQL AND 提交 Issue IDs** 檢查資格，並驗證現值、schema、permission、options；集中 JQL 本身不是授權。

## Jira 資料依據
- `dashboardAlertJql(key, scope)`＋`DASHBOARD_ALERT_JQL`／`DASHBOARD_ALERT_KEYS`。
- `missingDataListJql(kind, scope, options)`供數量與明細；`missingDataUpdateJql(kind, ids)`保留原始寫入範圍。
- `scrumBoardDevTasksJql(scope, boardDays)`雖名稱含 DevTasks，實際含 QA。
- 完整查詢與 REST endpoint 對照見 [Jira 技術參考](../jira-reference.md)。例：
  ```jql
  (status = "In Review") AND assignee = currentUser() ORDER BY key ASC
  ```
- Jira：GET field metadata、POST search/jql（讀取）、GET issue values／editmeta、GET user／group/member。補填經 `updateMissingDataAction` 最後 field-only PUT issue。
- 站內 GET：`/api/dashboard/alerts`、`/alerts/bugs`、`/alerts/due`、`/alerts/pending`、`/missing-data`、`/scrum-board`、`/lookups`（均在 `/api/dashboard` 下）。

## 限制與解讀注意事項
- 不是持續推播；載入、範圍變更、retry／save refresh 才查。多張卡與明細是分別讀取，不是同一原子快照。
- 看板僅排 literal Done；In Progress／In Review 以外的狀態都歸 To Do，可能包括 Request Info 或其他 closed 狀態。To Do 欄不是嚴格 To Do status count；缺 status 會跳過。
- 查詢完整分頁有筆數、頁數與 scope 長度限制；超限報錯，不顯示假的完整 count。警示／看板 client JQL decoder 的8,000字元限制小於 server 的32,000，較大範圍仍可能無法顯示。
- Points 投影為一位小數，原值比較亦用此精度；不是 raw 任意精度比較。驗證後 GET→PUT 有競態空窗，不能承諾原子 compare-and-set。
- Jira 工作流、Priority 名稱、欄位 schema 與 options 必須符合設定；不支援或不完整 metadata 應被視為錯誤／不可編輯，而非缺值為零。

## 實作狀態與程式來源
- [頁面](../../app/(app)/dashboard/page.tsx)、[篩選](../../app/(app)/dashboard/dashboard-filter.tsx)、[缺失面板](../../app/(app)/dashboard/missing-data-panel.tsx)、[補填明細](../../app/(app)/dashboard/missing-data-dialog.tsx)
- [Dashboard service](../../lib/jira-dashboard.ts)、[警示 service](../../lib/jira-dashboard-alerts-server.ts)、[看板 service](../../lib/jira-scrum-board-server.ts)、[看板 UI](../../app/(app)/dashboard/scrum-board.tsx)
- [scope／成員解析](../../lib/jira-dashboard-lookups.ts)、[Server Action](../../app/(app)/dashboard/actions.ts)、[JQL](../../lib/jira-jql.ts)
