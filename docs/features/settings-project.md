# 專案設定

[回功能總覽](../README.md) · 路徑：`/settings/project` · 狀態：**規劃中（內容已清空，僅保留標題）**

## 目的
保留專案設定入口；原 ComingSoon 與 ToDo 內容已清空，尚未提供設定管理。

## 解決的問題
專案與 Sprint 的可維護參數尚未實作，目前沒有可操作的設定項目。

## 可以找到的 Insight
沒有設定或分析結果。未提供容量、成員或延伸天數的配置能力，不能將其他頁的固定假設或示範試算當作本頁設定。

## 使用方式
頁面只顯示「專案設定」標題，沒有說明、ToDo 清單、欄位或操作按鈕。

## 指標與判定規則
沒有設定資料或計算。Planning 的固定每人點數、Capacity 的 mock 試算及 Burn Down 日序維持原本各自獨立的規則。

## Jira 資料依據
本頁沒有 JQL、REST request、環境值讀取或設定持久化。Sprint 資料仍由 [本機 Sprint 設定](../../lib/jira-sprint-data.ts) 維護，不是此頁的輸出。

## 限制與解讀注意事項
不能由此頁設定團隊成員、容量或延伸天數。路由與導覽仍存在；清空內容不會改動實際登入、部署環境或其他頁的規劃參數，也不代表已部署。

## 實作狀態與程式來源
- [專案設定頁](../../app/(app)/settings/project/page.tsx) 只使用 [PageHeader](../../components/page-header.tsx)。
- [設定空白頁回歸](../../tests/settings-pages.test.mjs)；相關頁：[Planning](sprint-planning.md)、[Capacity](sprint-capacity.md)。
