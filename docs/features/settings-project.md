# 專案設定

[回功能總覽](../README.md) · 路徑：`/settings/project` · 狀態：**規劃中（ComingSoon＋ToDo 說明）**

## 目的
規劃維護專案與 Sprint 的人力、可安排點數及延伸開發天數。

## 解決的問題
預期讓規劃分析有明確、可維護的專案參數，而不是分散的人工假設。目前僅列出待開發項目。

## 可以找到的 Insight
目前沒有可查的設定或分析結果。未來可討論「承諾量是否超過實際容量」，但必須先完成設定儲存與分析接入，不能將目前固定容量比當作這項能力。

## 使用方式
可閱讀以下 ToDo，尚無編輯／提交表單：
- **Sprint Capacity**：該 Sprint 團隊可安排的點數。
- **Sprint Resource**：該 Sprint 參與開發的成員，預設成員加上各 Sprint 的彈性增減。
- **Sprint Extended Days**：延伸開發天數；頁面列出 Saku 0、Telasa 約多一週解 Bug 的規劃說明，**不是已生效配置**。

## 指標與判定規則
上述參數尚未接入計算。Planning 的固定每人點數、Capacity 的 mock 試算及 Burn Down 日序各自獨立；不會因 ToDo 文字改變。

## Jira 資料依據
本頁沒有 JQL、REST request 或設定持久化。Sprint 資料目前由 [本機 Sprint 設定](../../lib/jira-sprint-data.ts) 維護，不是此頁的輸出。

## 限制與解讀注意事項
不能由此頁設定團隊成員、容量或延伸天數，也不能宣稱分析已扣除真實請假／延伸日期。

## 實作狀態與程式來源
[專案設定頁](../../app/(app)/settings/project/page.tsx) 使用 [ComingSoon](../../components/coming-soon.tsx)，另顯示 ToDo。相關頁：[Planning](sprint-planning.md)、[Capacity](sprint-capacity.md)。
