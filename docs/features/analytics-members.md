# 成員分析已搬移

原成員分析入口已整合至 [團隊分析](analytics-team.md)，唯一入口為 `/analytics/story-points`；本文件僅保留搬移提示，功能目的、日期篩選契約與限制以該文件為準。

原 `/analytics/members` 實體頁面、`AppRoute` 與主導覽項目已移除，不再列為獨立產品頁。以下四個舊網址以 **307直接跳轉**至 `/analytics/story-points`，不經另一個舊入口：

- `/analytics/members`
- `/analytics/members/summary`
- `/analytics/members/comparison`
- `/analytics/members/detail`

跳轉層保留所有 query 值（含無效值與重複值），不驗證、捨棄或修正條件；抵達團隊分析後才依固定 `project`／`from`／`to` 契約嚴格驗證。未知子路徑與更深路徑不列為跳轉別名；抵達新入口也不自動分析。

團隊分析目前只提供 Project／整個 Team／日期區間篩選與 ComingSoon 提示，沒有分析結果、個人成效、排行榜或 Jira 分析資料管線。搬移不代表新增成員統計或完成原占位功能；現有按成員的週點數表見 [工作量分析](analytics-workload.md)，Sprint 摘要見 [開發狀況](sprint-burndown.md)。

程式來源為 [精確跳轉設定](../../next.config.ts) 與 [團隊分析頁](../../app/(app)/analytics/story-points/page.tsx)。程式核對基準與現況見 [功能總覽](../README.md)；程式與文件更新不代表已部署或 live Jira 驗證。

[回功能總覽](../README.md)
