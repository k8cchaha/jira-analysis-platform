# 開發狀況／Burn Down

[回功能總覽](../README.md) · 路徑：`/sprint/burndown` · 狀態：**已實作（Jira 唯讀，完整載入後依 Resolved 分析）**

## 目的
觀察所選 Sprint 已估點 Dev-Task 的每日完成、剩餘點數與理想節奏，並檢視團隊／成員完成與未完成工作單。

## 解決的問題
- 單看目前 Done 數量，無法看出完成點數的日序與剩餘節奏。
- 母票 Sprint 與子工作單的關係不容易手動整理。
- Jira 狀態與 Resolved 日期可能不同，需要統一且明確的完成依據。
- 等需求／待資訊的母票可能需要另行觀察，不能混稱實際交付。
- 逐日查詢造成紅線逐段延伸；改為完整資料載入後一次分析並顯示。

## 可以找到的 Insight
| 問題 | 訊號 | 可能行動 |
| --- | --- | --- |
| 剩餘工作是否落後理想節奏？ | 完整載入後實際剩餘高於理想、完成集中末段 | 查每日／未完成明細，確認大票與等待，再討論拆票／協作／範圍 |
| 為何 Done 票未計完成，或計在另一日？ | 現行 Resolved 空白或帳號日曆日期與預期不同 | 到 Jira 核對工作流、Resolved 與帳號時區；此頁不再依 Done transition 判定 |
| 完成度是否因受阻覆寫而提高？ | 開啟覆寫後末端黃柱與完成度增加 | 取消覆寫對照，查母票 Request Info／Pending／Reproduce 與負責人 |
| 哪些人仍有較多剩餘點數？ | 成員未完成 SP 與票單 | 開明細確認分工與需協助項目，不直接排名效率 |
| 為何沒有實際線？ | 尚未完整載入／無可信完成紀錄／Sprint 尚未開始／載入錯誤 | 看載入與錯誤狀態，必要時重新載入；不要當剩餘0 |

## 使用方式
1. 選 Project、Sprint，一選即導航並開 SSE。Sprint 來自本機人工資料；頁面列所有已開始 Sprint，可指定歷史，未指定時只優先當前，**沒有當前不自動退回最近歷史**。
2. Team 可多選並排除成員；完整載入後依目前子票 Assignee 在 client 重算，不重查工作單 JQL。未選／名單未完成／0成員時目前維持全體。
3. **完成日期固定使用現行 Resolved**，不再有 By Resolved checkbox 或模式切換。新 URL／SSE endpoint 不產生 `byResolved`；舊連結缺省或單一 `byResolved=1` 均使用同一規則，非法／重複旗標拒絕。換 Project／Sprint 或重試會丟棄舊完成 markers、關閉舊完成明細，保留 Team／顯示偏好。
4. 剩餘點數、已完成、**受阻母票計為已完成**預設都勾選；這些是 client 顯示／重算，不另查 JQL。受阻覆寫是獨立例外，取消它後才是純 Resolved 完成結果。
5. 灰虛線＝理想剩餘，紅線＝實際剩餘，藍柱＝Sprint 當日完成，綠柱＝開局前完成，黃柱＝受阻覆寫。點柱開唯讀清單，清單內 Team 只縮小該清單。
6. 下方成員開發狀況與圖同源，顯示完成／未完成張數與 SP、完成度及已完成 Actual SP，張數可開明細。
7. 「中途加入的票」checkbox **暫時隱藏**，保留未勾選的 UI 占位實作；原三個顯示項目仍可操作。**尚無替代圖、加票歷史或 scope-change 分析**，隱藏不改變計算、URL 或資料載入。
8. 所有母票與 Dev-Task 分頁載入、完成日期投影成功後才送 `base → done`；client 收到兩者才一次顯示完整圖表與成員結果。不再逐日延伸紅線。失敗不顯示部分圖，可手動重試。

## 指標與判定規則
### 母體
- Sprint 中 Story／Task／Bug 母票下的 **Dev-Task only**，不含 QA，不限制子票目前狀態。
- SP缺值進未估清單、不計燃盡或成員統計；**0是已估有效值**。SP非數字、負值或非有限值報錯。Actual缺值／非法值為null，不作燃盡基準。
- Assignee、SP、母票狀態與 Sprint membership 都是讀取現值，不是每日歷史快照。

### 完成日期：固定 Resolved
| 規則 | 判定 |
| --- | --- |
| 開局完成 | REST `resolutiondate` 的帳號日曆日期早於 start，標記 `doneBeforeStart` |
| 每日完成 | 同份完整資料中，帳號日曆日期落在 start 至最後可見日（含），標記 `doneDate` 並按日分組 |
| 空 Resolved／重開清空日期 | null／缺值／空字串不算一般日期完成；不因目前 Done 或曾經 Done 補值 |
| 重開保留日期 | 仍依現行日期計算，不要求現在 Done |
| 多次完成 | 不重建歷史 Resolved，只看現行值；舊 Done transition 查詢已移除 |
| 補值／狀態限制 | 無 updated fallback，不加 resolution 名稱限制 |
| 非空非法日期 | 包括不存在的日曆日期或沒有 offset 的 timestamp，回受控錯誤，不猜值；未估點工作單亦驗證 |

日期由 server 使用與搜尋相同 credentials 唯讀取得 `GET /rest/api/3/myself` 的帳號時區，驗證 `accountId` 等於已登入 viewer，並以具名時區解析 timestamp（`Z`／`±HHMM`／`±HH:MM`），包含 DST。Jira 回 profile 時區或 instance default；不以 timestamp 文字的 offset 代替帳號時區，也不用瀏覽器／主機預設或 UTC+8 補值。缺失／非法時區、身分不符、lookup 失敗均顯示錯誤。現有 OAuth scope 定義包含 `read:jira-user`，真實 grant 未驗證。

最後可見日是 `min(UTC今天, Sprint end, start+59天)`；Sprint 尚未開始則沒有可見完成日。Sprint之後／未來／60天視窗之外的完成不移到末日，也不傳成可計入成員統計的普通完成 marker。app今天仍是UTC日期，不能聲稱全系統統一UTC+8。工作量分析仍使用自己的 Done-transition 母體及日期投影，不因本頁修改而改變。

### 線與完成度
令 `T=已篩選已估 Dev SP合計`，`P=開局前已完成SP`，`R0=T−P`，空起點日期為 `start−1天`。
- 理想從 R0 以日曆日等速降到 end 的0，包括週末，不扣請假：`round1(R0 × (1 − clamp((d − (start−1)) ÷ (end − (start−1)), 0, 1)))`。
- 每日完成 D 為當日 SP合計；pre-start優先，不重複計每日。
- 實際剩餘＝`T − P − 累計D − 當日受阻覆寫B`；完整載入後一次畫到最後可見日，後續日期為null、不畫。沒有可信完成紀錄時也不畫，null不代表0。
- 受阻覆寫依母票**目前**狀態精確匹配 Request Info／Pending／Reproduce。除pre-start外，匹配票從一般日桶移出，集中到靜態最後可見日（歷史 Sprint 為末日或60天截點）；不壓低開局或改理想線。無受阻歷史時點，**不是實際完成交付**。
- 成員完成判斷：`doneBeforeStart OR doneDate <= today OR 母票受阻覆寫`。所以即使 Resolved 空白，預設啟用的受阻覆寫仍可使它計完成；取消覆寫才能純依 Resolved 判斷。
- 完成度＝`完成 SP ÷（完成 SP＋未完成 SP）×100%`，一位小數；分母0顯示「—」，不是張數完成比。Actual只累計已完成且有值者。

## Jira 資料依據
- 母票：`sprintParentIssuesJql()`；工作單：`sprintDevTasksJql()`。合成 keys 範例：
  ```jql
  parent in (SUN-50, SUN-51) AND issuetype = "Dev-Task"
  ```
- Jira REST：POST `/rest/api/3/search/jql`，母票／Dev-Task 搜尋均完整分頁；子票讀 `resolutiondate`、SP、Actual、assignee、parent、status、summary，母票讀 status／assignee metadata。
- 母票非空時，另以相同 server credentials GET `/rest/api/3/myself` 驗證帳號與時區；不新增每日查詢或開局完成查詢。HTTP 次數只隨資料分頁改變，不隨 Sprint 天數增加。
- 完整資料依 `resolutiondate` 投影為 shared task DTO；server、圖表、每日明細及成員結果共用 markers，不再有 Burn Down completion JQL builders 或 daily iterator。
- 頁面僅產生 shell／endpoint；站內 `GET /api/sprint/burndown/stream` 執行讀取與 `base → done`，共用 SSE framing 仍保留供其他功能使用。詳見 [Jira 技術參考](../jira-reference.md)。

## 限制與解讀注意事項
- 不重建歷史 scope／估點變更／assignee，也未支援 QA完成度或預測完工日。
- default受阻覆寫會改完成度，要討論實際交付應先取消覆寫；不能把黃柱當 Done 或 Resolved 事件。
- 圖與明細雖同源，**受阻與pre-start／當日Resolved交集時，dialog篩選未完全遵循圖表分桶優先序，清單SP可能不等柱高**。目前「其他」群明細排除未指派，但aggregate含未指派，張數也可能不一致；不宣稱所有明細嚴格對帳。
- 系列顯示上限60天會截斷超長Sprint；理想仍按原end，截斷處可能未降到0。這不是逐日查詢次數上限。
- Sprint日期是人工設定，須有效且正確；改本機日期會影響分類與曲線。
- 完整分頁仍需等待 Jira，不是單一 HTTP request 或即時推播，也不是跨多個請求的原子快照。
- 開流錯誤對EventSource可能是HTTP200＋error frame，看到200不等於載入成功；須確認完整base及done，而非只看HTTP狀態。

## 實作狀態與程式來源
目前程式已接通完整載入後依 Resolved 分析；By Resolved checkbox、舊 Burn Down Done-transition 與逐日 Resolved 查詢已移除。「中途加入的票」控制項暫時隱藏，現有三個顯示／覆寫控制項仍可操作。程式核對基準見 [功能總覽](../README.md)；不代表已部署或經真實 Jira 時區驗證。
- [頁面](../../app/(app)/sprint/burndown/page.tsx)、[client／篩選](../../app/(app)/sprint/burndown/burndown-client.tsx)、[參數](../../lib/burndown-params.ts)
- [Jira service](../../lib/jira-burndown.ts)、[日期投影](../../lib/burndown-completion.ts)、[曲線聚合](../../lib/burndown-series.ts)、[成員聚合](../../lib/burndown-status.ts)
- [SSE API](../../app/api/sprint/burndown/stream/route.ts)、[每日明細](../../app/(app)/sprint/burndown/day-tasks-dialog.tsx)、[成員 UI](../../app/(app)/sprint/burndown/development-status.tsx)、[JQL](../../lib/jira-jql.ts)
