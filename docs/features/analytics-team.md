# 團隊分析

[回功能總覽](../README.md) · 路徑：`/analytics/story-points` · 狀態：**部分實作（日期篩選可用，分析結果尚未開放）**

## 目的
規劃以團隊為主體檢視 Jira 工作分析，支援團隊層級的討論。本頁承接原 Projects 的日曆日期區間篩選；[專案回顧與趨勢](analytics-projects.md) 則只保留 Sprint 篩選。

## 解決的問題
預期減少逐票整理團隊摘要的成本，並讓日曆期間與 Sprint 回顧各有清楚入口。目前完成的是 Project／Team／日期篩選、URL 還原與驗證，未解決實際資料彙整。

## 可以找到的 Insight
目前無可讀取的分析結果。規劃問題包括團隊工作是否集中、指定期間的工作構成是否改變；未來須有可對帳的團隊工作摘要，才可檢查分工與資料完整性。**尚無實作或承諾的指標，不能評估團隊或成員績效。**

## 使用方式
- Project 單選且必選；未選之前 Team、分析區間（含快捷鍵）與查詢不可操作。沒有 Sprint 選單、模式 radio 或個別成員分析入口。
- Team 僅選整個團隊、不提供逐成員排除；只保留在本頁 local state，不寫入 URL、不跨重新整理保存，也不是 server 授權邊界。更換專案保留本頁 Team 與日期草稿。
- 分析區間重用 `DateRangeField`，支援**近1月／近2月／近3月／近6月**與自訂日期。瀏覽器本地日期初始化為**近1月**，有效 URL 日期優先；不是固定30天。近 N 月從 local today 往前 N 個日曆月（遇短月夾至月底），再從翌日起算至今天，含首末日。例如 local today `2026-11-03` 的近1月是 `2026-10-04`–`2026-11-03`。
- 自訂日期須為真實、順序正確的 `YYYY-MM-DD`，範圍含首末日，最多3,660天。初始化日期只填本頁草稿，不自動導航或分析。
- Project 與完整有效日期選擇即時更新 URL；固定格式只接受 `project`、`from`、`to`，例如 `/analytics/story-points?project=SUN&from=2026-10-01&to=2026-10-31`。日期不完整或無效時不序列化成已套用範圍；上一頁／下一頁由有效 URL 還原 Project 與日期，Team 仍是本頁狀態。
- 未知參數（包含 `mode`、`sprint`、group／member 條件）、重複單值參數、無效 Project、不完整／非法／過大日期會明確報錯；無效網址不能查詢，不默默移除條件、猜測日期或擴大範圍。
- 查詢必須同時有有效 Project 與日期。按查詢只驗證／確認條件，顯示分析尚未開放的提示；**沒有分析資料 request，URL 還原、直接連結、重新整理與歷史導航均不自動分析**。
- 舊 `/analytics/members` 及 `/summary`、`/comparison`、`/detail` 四個精確網址以 **307直接跳轉**至本頁，保留所有 query 值，包括無效與重複值；跳轉不代替本頁嚴格驗證。未知子路徑不跳轉。舊 Projects 日期網址則留在 Projects 顯示錯誤，需手動點選移至本頁；合法舊日期條件保留 Project／from／to，不合法條件連到乾淨入口。

## 指標與判定規則
未定義。路徑含 `story-points` 不代表已提供 SP 統計、Velocity 或 Capacity 比較；不能借用其他頁的公式或完成定義。

## Jira 資料依據
本頁沒有實際分析 JQL、REST request 或欄位計算。Project 為本機設定；共用 Team 元件可能預載 Jira 團隊成員 metadata，並不等於取得分析資料。篩選搬移與成員舊網址跳轉都不新增 Jira 分析查詢或寫入。

## 限制與解讀注意事項
團隊間比較需先統一工作母體、期間與點數尺度；目前頁面無法提供結論。日期、Team 與查詢按鈕可用只代表篩選部分完成，ComingSoon 分析結果仍未開放。團隊導覽仍使用群組圖示，沒有標題副標題；Capacity 圖示與用途不變。

## 實作狀態與程式來源
頁面是等待 async `searchParams` 的 Server Component，以純解析結果傳給 Client 篩選，再放入 ComingSoon 的 filters slot。程式核對基準見 [功能總覽](../README.md)，程式與文件更新不代表已部署或 live Jira 驗證。

- [團隊分析頁](../../app/(app)/analytics/story-points/page.tsx)、[篩選介面](../../app/(app)/analytics/story-points/team-analysis-filter.tsx)
- [條件解析與 URL](../../lib/team-analysis-filter.ts)、[日期快捷鍵](../../lib/date-range.ts)、[ComingSoon](../../components/coming-soon.tsx)
- 現有可用的週點數分布請見 [工作量分析](analytics-workload.md)；成員舊入口資訊見 [成員分析搬移說明](analytics-members.md)。
