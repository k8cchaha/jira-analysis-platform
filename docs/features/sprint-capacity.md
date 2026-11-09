# Capacity

[回功能總覽](../README.md) · 路徑：`/sprint/capacity` · 狀態：**部分實作（mock／本機操作示範，非真實容量系統）**

## 目的
展示團隊容量、請假與成員可用點數的操作流程，為未來人力配置管理建立介面。

## 解決的問題
設計上希望集中確認團隊是否提交人力、請假後可安排多少點數；**現在只有假資料試算，不能解決真實容量紀錄與同步**。

## 可以找到的 Insight
| 問題 | 目前可見訊號 | 可採取的行動 |
| --- | --- | --- |
| 請一天假如何影響點數？ | mock 表請8小時，20點變18點 | 體驗試算並討論人力換算規則 |
| 哪些團隊尚未填？ | mock filled 為 false 的紅色按鈕 | 體驗未填狀態；真實提交情況須另行確認 |

所有數字與提交狀態是示範資料，不能據此安排真實人力或判斷團隊是否已提交。

## 使用方式
- 選 Project／Sprint，一選即導航；Sprint 與 Planning 同樣使用本機尚未結束的候選清單。未指定時當前優先，其次最早未來。
- 沒有 Team filter；點團隊按鈕開彈窗。mock filled=true顯示綠色與容量，未填顯示紅色「—」。已填團隊與可測試編輯的團隊可顯示成員表；未填且不可編輯的團隊只顯示尚未填寫提示，不顯示成員明細，沒有成員資料時另顯示空狀態。
- 有登入 viewer ID 且 mock Web／QA 可測試編輯；**不是 Jira 真實團隊權限判定**。
- 編輯請假時數、提交／更新只改 React state；取消不保存。**提交不更新 filled**，不表示已完成真實提交。
- 同專案切 Sprint 保留本機編輯；換專案、離頁或重載會失去。本機資料以 Project 為單位，**不是 Sprint-specific 紀錄**。
- Sprint Note 是固定唯讀假文字，未接註記讀寫。

## 指標與判定規則
- 所有專案假設每人滿額 `10天 × 2點 = 20點`，不依所選 Sprint 長度、假日或出勤計算。
- `個人可用點數 = max(0, 20 − 請假小時 × 0.25)`；8小時扣2點。負數／非有限輸入轉0。
- 本機更新後 `團隊容量 = 成員可用點數合計`；`團隊假期天數 = 請假小時合計 ÷ 8`；頁首總假期為各隊合計。
- 未填的「—」不代表真實容量0；mock 初始資料亦不代表計算完成的真實紀錄。
- **與 Planning 固定容量分派表無資料同步**；TKK此頁也用20點，Planning用40點。

## Jira 資料依據
**沒有 Capacity JQL、Jira REST 讀取／寫入、Capacity API 或資料庫。** server 僅提供登入 viewer ID 與本機 Project／Sprint；容量與成員皆 mock。

## 限制與解讀注意事項
真實請假、人力、權限、提交狀態、持久化、Sprint Note、設定與 Planning 接入都未完成。此頁不能作為真實排程／審核依據。

## 實作狀態與程式來源
[頁面](../../app/(app)/sprint/capacity/page.tsx)、[client／Project key](../../app/(app)/sprint/capacity/capacity-client.tsx)、[mock／試算面板](../../app/(app)/sprint/capacity/capacity-panel.tsx)。未來設定需求見 [專案設定](settings-project.md)。
