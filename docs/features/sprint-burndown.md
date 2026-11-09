# 開發狀況／Burn Down

[回功能總覽](../README.md) · 路徑：`/sprint/burndown` · 狀態：**已實作（Jira 唯讀，含目前工作目錄的 By Resolved）**

## 目的
觀察所選 Sprint 已估點 Dev-Task 的每日完成、剩餘點數與理想節奏，並檢視團隊／成員完成與未完成工作單。

## 解決的問題
- 單看目前 Done 數量，無法看出完成點數的日序與剩餘節奏。
- 母票 Sprint 與子工作單的關係不容易手動整理。
- Done transition 與 Jira Resolved 日期可能不同，需要明確選擇完成依據。
- 等需求／待資訊的母票可能需要另行觀察，不能混稱實際交付。

## 可以找到的 Insight
| 問題 | 訊號 | 可能行動 |
| --- | --- | --- |
| 剩餘工作是否落後理想節奏？ | 完整載入後實際剩餘高於理想、完成集中末段 | 查每日／未完成明細，確認大票與等待，再討論拆票／協作／範圍 |
| 為何 Done 票在另一日才計完成？ | 兩種完成模式出現不同日期 | 到 Jira 核對工作流與 Resolved，確認適用的分析口徑 |
| 完成度是否因受阻覆寫而提高？ | 開啟覆寫後末端黃柱與完成度增加 | 取消覆寫對照，查母票 Request Info／Pending／Reproduce 與負責人 |
| 哪些人仍有較多剩餘點數？ | 成員未完成 SP 與票單 | 開明細確認分工與需協助項目，不直接排名效率 |
| 為何沒有實際線？ | 尚未掃到每日資料／無可信完成紀錄／載入錯誤 | 先看進度與錯誤，必要時重新載入；不要當剩餘0 |

## 使用方式
1. 選 Project、Sprint，一選即導航並開 SSE。Sprint 來自本機人工資料；頁面列所有已開始 Sprint，可指定歷史，未指定時只優先當前，**沒有當前不自動退回最近歷史**。
2. Team 可多選並排除成員；完整載入後依目前子票 Assignee 在 client 重算，不重查工作單 JQL。未選／名單未完成／0成員時目前維持全體。
3. **By Resolved 預設未勾**：未勾用 Done transition，勾選用目前 Resolved。切換換 URL／SSE／完成 markers、關閉舊完成明細；換 Project／Sprint 保留模式。有效 URL 旗標僅 `byResolved=1`，缺省為舊模式；非法／重複旗標拒絕。
4. 剩餘點數、已完成、**受阻母票計為已完成**預設都勾選；這些是 client 顯示／重算，不另查 JQL。
5. 灰虛線＝理想剩餘，紅線＝實際剩餘，藍柱＝Sprint 當日完成，綠柱＝開局前完成，黃柱＝受阻覆寫。點柱開唯讀清單，清單內 Team 只縮小該清單。
6. 下方成員開發狀況與圖同源，顯示完成／未完成張數與 SP、完成度及已完成 Actual SP，張數可開明細。
7. 「中途加入的票」只是 UI 占位：勾選使原三個顯示項目灰化停用、保留其值，**尚無替代圖、加票歷史或 scope-change 分析**。
8. 載入 `base → day → done` 漸進顯示；錯誤不當完成，可手動重試，會丟棄舊完成 markers。

## 指標與判定規則
### 母體
- Sprint 中 Story／Task／Bug 母票下的 **Dev-Task only**，不含 QA，不限制子票目前狀態。
- SP缺值進未估清單、不計燃盡或成員統計；**0是已估有效值**。SP非數字、負值或非有限值報錯。Actual缺值／非法值為null，不作燃盡基準。
- Assignee、SP、母票狀態與 Sprint membership 都是讀取現值，不是每日歷史快照。

### 完成日期模式
| 規則 | 未勾 By Resolved | 勾 By Resolved |
| --- | --- | --- |
| 開局完成 | start前曾 `status CHANGED TO "Done" BEFORE` | 目前 `resolved < start` |
| 每日完成 | `status CHANGED TO "Done" ON day` | `resolved >= day AND resolved < nextDay` |
| 重開的票 | 曾 Done 仍可能算完成 | 清空 Resolved 不算；保留日期則依日期計算 |
| 多次完成 | 同票以最後掃到的 Sprint 內 Done 日覆寫；pre-start標記優先 | 不重建歷史 Resolved，只看現行值 |
| 補值／狀態限制 | 不改原 transition 邏輯 | 無 updated fallback，不要求現在 Done，不加 resolution 名稱限制 |

兩模式互斥，不同時查再 fallback。日查詢截止 `min(UTC今天, Sprint end)`，最多60天；Sprint之後／未來完成不移到末日。Resolved 日期邊界交由 Jira帳號時區解讀，app今天仍是UTC日期，不能聲稱全系統統一UTC+8。

### 線與完成度
令 `T=已篩選已估 Dev SP合計`，`P=開局前已完成SP`，`R0=T−P`，空起點日期為 `start−1天`。
- 理想從 R0 以日曆日等速降到 end 的0，包括週末，不扣請假：`round1(R0 × (1 − clamp((d − (start−1)) ÷ (end − (start−1)), 0, 1)))`。
- 每日完成 D 為當日 SP合計；pre-start優先，不重複計每日。
- 實際剩餘＝`T − P − 累計D − 當日受阻覆寫B`；未來／未掃描日為null、不畫。沒有可信完成紀錄時也不畫，null不代表0。
- 受阻覆寫依母票**目前**狀態精確匹配 Request Info／Pending／Reproduce。除pre-start外，匹配票從一般日桶移出，集中到目前最後掃描節點；不壓低開局或改理想線。無受阻歷史時點，**不是實際完成交付**。
- 成員完成判斷：`doneBeforeStart OR doneDate <= today OR 母票受阻覆寫`。所以即使 Resolved 空白，受阻覆寫仍可使它計完成。
- 完成度＝`完成 SP ÷（完成 SP＋未完成 SP）×100%`，一位小數；分母0顯示「—」，不是張數完成比。Actual只累計已完成且有值者。

## Jira 資料依據
- 母票：`sprintParentIssuesJql()`；工作單：`sprintDevTasksJql()`。
- 舊完成：`sprintDevTasksDoneBeforeJql()`／`sprintDevTasksDoneOnJql()`。
- Resolved：`sprintDevTasksResolvedBeforeJql()`／`sprintDevTasksResolvedOnJql()`；合成 keys 範例：
  ```jql
  parent in (SUN-50, SUN-51) AND issuetype = "Dev-Task" AND resolved >= "2026-10-26" AND resolved < "2026-10-27"
  ```
- Jira REST：POST search/jql，每筆 base／每日查詢完整分頁；讀 SP、Actual、assignee、parent、status、summary 與母票 metadata。完成查詢回 keys，由 server／stream 標記 shared task DTO，client不另算 timestamp。
- 頁面僅產生 shell／endpoint；站內 `GET /api/sprint/burndown/stream` 執行讀取與 SSE。詳見 [Jira 技術參考](../jira-reference.md)。

## 限制與解讀注意事項
- 不重建歷史 scope／估點變更／assignee，也未支援 QA完成度或預測完工日。
- default受阻覆寫會改完成度，要討論實際交付應先取消覆寫；不能把黃柱當 Done 或 Resolved 事件。
- 圖與明細雖同源，**受阻與pre-start／當日Done交集時，dialog篩選未完全遵循圖表分桶優先序，清單SP可能不等柱高**。目前「其他」群明細排除未指派，但aggregate含未指派，張數也可能不一致；不宣稱所有明細嚴格對帳。
- 逐日及系列上限60天會截斷超長Sprint；理想仍按原end，截斷處可能未降到0。
- Sprint日期是人工設定，須有效且正確；改本機日期會影響查詢與曲線。
- 開流錯誤對EventSource可能是HTTP200＋error frame，看到200不等於載入成功；須看done／error與進度。

## 實作狀態與程式來源
By Resolved已在目前工作目錄接通，不是占位按鈕；本文件不表示已提交／部署或經真實 Jira 時區驗證。
- [頁面](../../app/(app)/sprint/burndown/page.tsx)、[client／模式與篩選](../../app/(app)/sprint/burndown/burndown-client.tsx)、[參數](../../lib/burndown-params.ts)
- [Jira service](../../lib/jira-burndown.ts)、[曲線聚合](../../lib/burndown-series.ts)、[成員聚合](../../lib/burndown-status.ts)
- [SSE API](../../app/api/sprint/burndown/stream/route.ts)、[每日明細](../../app/(app)/sprint/burndown/day-tasks-dialog.tsx)、[成員 UI](../../app/(app)/sprint/burndown/development-status.tsx)、[JQL](../../lib/jira-jql.ts)
