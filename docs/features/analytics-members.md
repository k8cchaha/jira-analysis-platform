# 成員分析

[回功能總覽](../README.md) · 路徑：`/analytics/members` · 狀態：**規劃中（ComingSoon）**

## 目的
規劃檢視團隊成員的 Jira 工作摘要，方便討論分工與資料。

## 解決的問題
預期減少手動收集個人工作摘要的負擔；目前只有占位說明，沒有摘要資料。

## 可以找到的 Insight
目前沒有分析結果。規劃問題：個人的工作構成是否改變？未來需要可追溯的工作摘要，才能核對分工或工作類型；並非已實作的個人效能分析。

## 使用方式
閱讀開發中提示；尚無成員查詢、分析篩選或明細操作。

## 指標與判定規則
未定義。尚未實作工時、產出品質、效率或歷史 assignee 歸屬。

## Jira 資料依據
本頁沒有實際 JQL、REST request 或欄位聚合。

## 限制與解讀注意事項
票數與 SP 不等於績效；角色、難度及未記錄工作都會影響解讀。現在不能從此頁評估任何成員。

## 實作狀態與程式來源
[成員分析頁](../../app/(app)/analytics/members/page.tsx) 使用 [ComingSoon](../../components/coming-soon.tsx)。現有按成員的週點數表見 [工作量分析](analytics-workload.md)，Sprint 摘要見 [開發狀況](sprint-burndown.md)。
