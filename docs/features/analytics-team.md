# 團隊分析

[回功能總覽](../README.md) · 路徑：`/analytics/story-points` · 狀態：**規劃中（ComingSoon）**

## 目的
規劃以團隊為主體檢視 Jira 工作分析，支援團隊層級的討論。

## 解決的問題
預期減少逐票整理團隊摘要的成本；目前仍是功能占位頁，未解決實際資料彙整。

## 可以找到的 Insight
目前無可讀取的分析結果。規劃問題：團隊工作是否集中？未來須有可對帳的團隊工作摘要，才可檢查分工與資料完整性；**尚無實作或承諾的指標**。

## 使用方式
可開啟頁面閱讀開發中提示；尚無可執行的團隊分析篩選、查詢或明細。

## 指標與判定規則
未定義。路徑含 `story-points` 不代表已提供 SP 統計、Velocity 或 Capacity 比較。

## Jira 資料依據
本頁沒有實際分析 JQL、REST request 或欄位計算。不得借用其他頁的查詢宣稱已接入。

## 限制與解讀注意事項
團隊間比較需先統一工作母體、期間與點數尺度；目前頁面無法提供結論。

## 實作狀態與程式來源
[團隊分析頁](../../app/(app)/analytics/story-points/page.tsx) 使用 [ComingSoon](../../components/coming-soon.tsx)。現有可用的週點數分布請見 [工作量分析](analytics-workload.md)。
