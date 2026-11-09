# Planning

[回功能總覽](../README.md) · 路徑：`/sprint/planning` · 狀態：**已實作（Jira 唯讀；容量為固定假設）**

## 目的
協助團隊在進行中或未來 Sprint 檢查工作是否估點、拆單、分派，以及工作組合與承擔是否集中。

## 解決的問題
- 母票的需求規劃與子工作單的執行分派混在一起，不容易辨認。
- 未估、未拆、未指派的票容易被忽略。
- 只看總 SP 無法知道 Bug／維運占比或哪些團隊／成員承擔特定類型。

## 可以找到的 Insight
| 問題 | 訊號 | 可能行動 |
| --- | --- | --- |
| 工作是否已準備好開始？ | 未估時／未開子單／未分派清單 | 到 Jira 估點、拆 Dev／QA 工作單、指定 Owner |
| 是否有人排太滿？ | 固定容量下分派比例高或超過100% | 展開票單確認大票與工作構成，再協調改派／拆票／移出範圍 |
| Bug／維運是否集中？ | 票種或 Dev Type 占比高 | 切張數與點數區分很多小票／少數大票，討論 Sprint 目標 |
| 哪個人或團隊承擔某分類？ | 分類 tooltip／成員明細份額集中 | 查技能依賴、安排協作或備援 |
| 要找誰確認 Epic 需求？ | Reporter View 的 Reporter→Epic→母票 | 依 Epic Reporter（或 fallback 母票 Reporter）溝通 |

分派比例以假設容量計算；高低不等於真實過載／閒置，更不等於效率。

## 使用方式
1. 選 Project、Sprint：一選即更新 URL 並載入，不需查詢按鈕。Sprint 是本機人工資料，選項包含**所有尚未結束的進行中與未來 Sprint**。
2. 未指定時優先當前 Sprint，其次最早未來 Sprint；沒有可選項則空狀態。不是只支援「目前＋下一個」。
3. Team 支援整團隊多選，不提供逐人排除；名單完成後，以目前工作單 **Assignee** 在 browser 篩選，不重查工作單 JQL。未選／名單未完成／0成員時目前仍維持全體，不能當作已確認套用團隊。
4. 預設「任務分派狀況」；成員列可展開工作單。切「任務規劃總覽」，預設 Team View，可切 Reporter View。
5. 票種／開發類型圖各自預設點數，可切張數；單一團隊且篩選生效時可看分類內成員份額。
6. 未估時／未開子單／未分派在選定 Project＋Sprint 後即各自取得清單；點按只開清單。**未估時套 Team；未分派、未開子單不套 Team**。0或錯誤按鈕停用。
7. 此頁所有票單唯讀；需到 Jira 補資料或更改分派。沒有「只看 Dev-Task」功能，母體保留 Dev＋QA。

## 指標與判定規則
### 母體與規劃總覽
- 先查 Sprint 內 **Story／Task／Bug 母票**，再查這些母票下 **Dev-Task＋QA-Task**；不以子票是否直接有 Sprint 作主資料錨點，不加 Dashboard 近30天，也不限狀態。
- Team View：Team→Dev Type→工作單，分派與加總依**子票 Assignee／SP**。
- Reporter View：Reporter→Epic→母票，含未開子單母票，顯示母票自身 SP；有 Epic 優先 Epic Reporter，否則母票 Reporter。團隊篩選比**母票自己的 Assignee**，不是 Reporter 或子票 Assignee。
- 右側兩圖一直使用已篩選 **Dev＋QA 工作單**，不隨 Reporter View 改為母票點數；兩者總數可能不同。

### 分派與容量
- `已分派 SP = 該 Assignee 工作單 SP 合計`。
- 固定每人容量：**SUN 20、TKK 40、PRIDE 20（占位假設）**，未指派無容量。
- **只有出現在這批工作單的 Assignee 才加入容量分母**；沒工作單的真實團隊成員不加入。團隊容量為這些人的固定容量合計。
- `分派比例 = 已分派 SP ÷ 固定容量 × 100%`，一位小數；分母≤0顯示「—」。團隊比例<70藍、70～90綠、>90～100琥珀、>100紅，進度條最多畫100%。
- **不讀取 Capacity 頁的請假試算**，未扣實際請假／假日；未指派仍可有點數，但沒有個人容量。
- SP 有效非負有限值保留，一位小數；缺值／非法值顯示「—」、加總當0，數字0保留。

### 品質清單與分類
- 未估時：Dev＋QA 的 `SP in (Empty, 0)`；0可同時出現在主表與未估清單。
- 未分派：Dev＋QA 的 `assignee is empty`。
- 未開子單：**全部母票減去有 Dev 或 QA 子票的母票**；不是沒有任意種類的 sub-task，也不是單一 Jira「無子單」指令。
- 票種圖按工作單母票的 Story／Task／Bug，未知類型不計該圖；Dev Type 圖按 Pre-Spike／Spike／Dev／Bug／OP-Task／OP-Bug／未分類，空白或未知值歸未分類。
- 份額為分類 SP／張數除以對應總量；hover 的成員／團隊份額分母是**該分類**，不是整個 Sprint。母票 Bug 類型與子票 Dev Type Bug 是不同概念。

## Jira 資料依據
- 主資料：`sprintParentIssuesJql(sprintId)`→`sprintChildTasksJql(parentKeys)`。
  ```jql
  sprint = 7518 AND issuetype in (story, task, bug)
  ```
  ```jql
  parent in (SUN-50, SUN-51) AND issuetype in ("Dev-Task", "QA-Task")
  ```
  keys為合成示例，真實 keys 由 server 母票搜尋取得。
- 品質：`sprintChildTasksUnestimatedJql()`、`sprintChildTasksUnassignedJql()`；未開子單在 service 作差集。
- Reporter 補查：`epicIssuesByKeyJql()`，PM 群組用 Jira group lookup 作排序輔助。
- 外連 Jira 搜尋：`sprintChildTasksOfParentTypeJql()`、`sprintChildTasksOfDevTypeJql()`、`sprintChildTasksUnclassifiedDevTypeJql()`。
- Jira REST：POST search/jql 完整分頁；主要欄位 SP、Dev Type、assignee、parent、status、summary、reporter 及 Epic 關係。
- 站內：RSC 頁面讀主資料；`GET /api/sprint/planning/subset` 讀品質清單。查詢與欄位詳見 [Jira 技術參考](../jira-reference.md)。

## 限制與解讀注意事項
- 固定容量只涵蓋有票 Assignee，不代表全團隊真實可用量；TKK 在 Planning 的40點也與 Capacity mock 的20點不同。
- Jira 外連圖表搜尋只帶 Sprint／分類，**不保留 Team／member 篩選**；未分類外連只找 EMPTY，圖內還含未知已填值，外連與圖中數量不保證一致。
- Epic Reporter／PM lookup 失敗可能使用母票 Reporter 或退化排序；不是精確組織責任模型。
- Assignee、點數、類型、母票與 Epic 關係皆為查詢現值，不是 Sprint 開始時的承諾快照。
- 子集請求與主資料分開，不是同一原子快照；超過完整查詢限制報錯，不提供估算的完整列表。

## 實作狀態與程式來源
- [頁面](../../app/(app)/sprint/planning/page.tsx)、[client](../../app/(app)/sprint/planning/planning-client.tsx)、[分派 UI](../../app/(app)/sprint/planning/assignment-status.tsx)
- [主資料與 subset](../../lib/planning-data.ts)、[分派聚合](../../lib/assignment-status.ts)、[總覽聚合](../../lib/planning-overview.ts)、[總覽 UI](../../app/(app)/sprint/planning/planning-overview.tsx)
- [subset API](../../app/api/sprint/planning/subset/route.ts)、[Sprint 資料](../../lib/jira-sprint-data.ts)、[JQL](../../lib/jira-jql.ts)
