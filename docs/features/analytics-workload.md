# 工作量分析

[回功能總覽](../README.md) · 路徑：`/analytics/workload` · 狀態：**已實作（Jira 唯讀）**

## 目的
讓團隊負責人與成員觀察指定期間的 Dev-Task 點數如何分布於各成員、各週，並追到構成數字的工作單。

## 解決的問題
- 只看票數無法區分不同規模工作；只看總點數又看不到時間分布。
- Story Points 與 Actual Story Points 容易被混加，或將缺值誤當成零。
- 圖表數字無法追溯時，難以確認突增、空白與資料品質問題。

## 可以找到的 Insight
| 問題 | 訊號 | 可能行動 |
| --- | --- | --- |
| 工作點數集中在哪些週或成員？ | 週格與 Total 明顯集中 | 開啟格子明細，確認大型工作、結案時點或分工集中 |
| SP 與 Actual 的分布是否不同？ | 切換指標後週格／總計差異 | 回到工作單檢查估計方式、Actual 填寫完整性與工作內容 |
| 空白代表沒工作嗎？ | 空格與明確顯示的0意義不同；切換指標後也可能不同 | 回 Jira 核對母體與欄位完整性，不直接判斷成員閒置 |

這些是資料查核與分工討論的線索，**不是員工效率或績效排名**。

## 使用方式
1. 選擇團隊，等待完整成員名單載入；可逐團隊排除成員，專案可選。
2. 選分析區間，預設「近1月」，可切近2月／3月／6月或自訂日期。近 N 月是回推日曆月後的翌日起到今天，不等於固定 30／60／90 天。
3. 按「查詢」或 Enter 才讀取工作量；重新整理、上一頁／下一頁只還原條件，不自動查詢。
4. SP／Actual 切換、Total 排序、點選週格明細均使用已取得的同一份資料，不另發工作量 JQL。
5. 格子明細顯示母票類型、Ticket、Summary、Resolution、Resolved、SP、Actual；Resolved 顯示原始欄位日期，不保證等於分桶日期。

## 指標與判定規則
- **母體**：目前 assignee 屬於已解析成員、符合選定專案、期間內曾轉為 Done 的 Dev-Task。不是所有工作、QA-Task，也不是所有目前 Done 的票。
- **取票與歸日不同**：JQL 用 Done transition 選票；歸日用目前 REST `resolutiondate`，不能稱為歷史完成時間重建。
- 完成日投影：可解析的 Resolved 優先，否則 `updated`，都無法解析則歸到區間末日；早於起日整票排除，晚於迄日夾到末日。時間戳以 **UTC+8** 切日。
- 可繪日期截止到 `min(迄日, UTC+8 今天)`。週一為起日；**週一起日早於分析起日的整週不顯示**，末週可不完整。
- 例：區間 `2026-10-04～2026-11-03`，週欄從 `10/05` 開始，最後包含 `11/02` 週；`10/04` 所在的 `09/28` 週排除，因此不計入表格 Total。
- `週格 = 該成員、保留週內、所選指標有值的工作單點數合計`；`Total = 顯示週格合計`。
- `Output% = Total ÷（顯示週數 × 10）× 100%`，不封頂；空白週與部分週仍算一週。這個 10 是固定參考基準，**不是 Capacity 設定或實際出勤**。
- SP 與 Actual 各自可缺值；不互相補值。0 是有效值；未指派另列「未指派」，選定成員即使沒有活動仍保留列。
- 缺值清單在完成日期排除前收集，可能包含不貢獻表格 Total 的票；不能直接用缺值張數對帳格子張數。

## Jira 資料依據
- Builder：`workloadDevTasksJql(scope, range)`；單日用 `workloadDoneDuringJql()` 的 `ON`，多日用 `DURING`。
- 示意（accountId 為合成值，須由 server 解析，不是 client 自訂 JQL）：
  ```jql
  issuetype = "Dev-Task" AND status CHANGED TO "Done" DURING ("2026-10-05", "2026-11-03") AND assignee = "example-account" AND project in (sun) ORDER BY key ASC
  ```
- Jira REST：`POST /rest/api/3/search/jql`，區間整批查詢並完整分頁；成員解析用 user／group lookup。
- 主要欄位：assignee、status、resolution、resolutiondate、updated、parent、summary、SP、Actual SP；欄位映射見 [Jira 技術參考](../jira-reference.md)。
- 站內傳輸：`GET /api/analytics/workload/heatmap/stream`，SSE `base → done`，**沒有逐日 Jira 掃描**；「整批」不代表只會發一個 HTTP request，分頁仍需更多 request。

## 限制與解讀注意事項
- 現在的指派人、點數、Resolution 與 Resolved 可能被修改；重查歷史區間的結果會改變。
- 重新開啟的票仍可能因曾 Done 而命中，再依目前日期投影；fallback／夾到末日不等於那天真實完成。
- 查詢 Done 日期的 JQL 邊界由 Jira 解讀，前端預設區間用瀏覽器今天，時間戳分桶與 server 截止用 UTC+8；不要假設所有時區完全相同。
- Output% 未校正請假、角色、工作難度、跨團隊點數尺度與 QA／其他工作，不能直接當利用率、工時或生產力。
- 無法完整解析團隊或超過限制時失敗，不使用部分名單或擴大查詢。

## 實作狀態與程式來源
- [頁面](../../app/(app)/analytics/workload/page.tsx)、[查詢提交控制](../../app/(app)/analytics/workload/workload-query-client.tsx)、[篩選](../../app/(app)/analytics/workload/workload-filter.tsx)
- [Jira service](../../lib/jira-workload.ts)、[聚合與完成日投影](../../lib/workload-heatmap.ts)、[週表與 Output%](../../app/(app)/analytics/workload/workload-heatmap-grid.tsx)
- [SSE API](../../app/api/analytics/workload/heatmap/stream/route.ts)、[JQL](../../lib/jira-jql.ts)
