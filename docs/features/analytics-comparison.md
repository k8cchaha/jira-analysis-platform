# 比較分析已搬移

原比較分析已整合至 [專案回顧與趨勢](analytics-projects.md)，唯一入口為 `/analytics/projects`；本文件僅保留搬移提示，功能目的、篩選契約與限制以該文件為準。

原 `/analytics/comparison` 頁面已移除。舊根路徑及已知子頁別名以 **307直接跳轉**至 `/analytics/projects`，保留所有 query 值（含無效值與重複值），不在跳轉層驗證或修正。

目前入口僅提供專案／整個Team／複選Sprint篩選介面，沒有日期模式、可用的比較對象選取器、比較分析、圖表或計算。舊日期網址抵達Projects後報錯並提供手動移至 [團隊分析](analytics-team.md) 的連結，並非自動跳頁或分析。本文件不是獨立功能頁說明；程式核對基準與現況見 [功能總覽](../README.md)，不代表已部署或 live Jira 驗證。

[回功能總覽](../README.md)
