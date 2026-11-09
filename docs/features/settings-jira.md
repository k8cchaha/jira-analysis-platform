# Jira 連線資訊

[回功能總覽](../README.md) · 路徑：`/settings/jira` · 狀態：**規劃中（ComingSoon，補充路徑）**

## 目的
規劃提供工作區使用的 Jira 連線資訊檢視與管理入口。

## 解決的問題
預期讓連線配置有清楚的管理入口；目前沒有連線資訊、測試連線或編輯表單。

## 可以找到的 Insight
主要是連線配置與問題排查，不是工作分析。目前不提供 OAuth 健康檢查、scope 診斷或連線狀態統計。

## 使用方式
這個路徑存在，但**目前不列在主導覽的設定分類**；直接開啟仍是開發中提示。實際登入及重新授權沿用既有 OAuth 流程。

## 指標與判定規則
未定義連線狀態指標或可編輯配置。

## Jira 資料依據
此頁本身沒有 JQL 或 Jira REST request。其他已實作功能的 OAuth／Jira transport 仍可正常存在，不依賴此頁完成；見 [Jira 技術參考](../jira-reference.md)。

## 限制與解讀注意事項
尚未提供管理 OAuth credentials 的 UI。文件與前端不得揭露 access／refresh token、client secret 或真實憑證。

## 實作狀態與程式來源
[Jira 連線頁](../../app/(app)/settings/jira/page.tsx)、[主導覽](../../components/app-shell/navigation.ts)、[ComingSoon](../../components/coming-soon.tsx)。
