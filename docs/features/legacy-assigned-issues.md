# 指派給我的 Issues（舊服務）

[回功能總覽](../README.md) · 舊路徑：`/issues/assigned/list` · 狀態：**目前無頁面路由，僅保留 service／JQL／測試**

## 目的
舊功能設計是檢視近期指派給自己的 Issues，並編輯 Story Points。此文件記錄保留的技術能力，**不是可用頁面的操作指南**。

## 解決的問題
原設計解決近期個人票單查閱與估點編輯；目前不能由舊路徑使用此功能。

## 可以找到的 Insight
保留查詢可回答「近30天建立且目前指派給我的票有哪些」，但沒有當前 UI 可提供這份清單。不能稱為所有待辦、完成紀錄或生產力分析。

## 使用方式
目前無頁面、對應 Server Action 或列表 API 消費此 service；不要指示使用者到舊路徑操作。現有的個人缺值補填入口在 [Dashboard](dashboard.md)，兩者的更新規則不同。

## 指標與判定規則
- 固定範圍：`assignee = currentUser() AND created >= -30d`，依 created 新到舊。
- 舊 README 的「最新50張」是歷史頁面描述，不是目前可驗證的列表行為。
- 保留 service 仍有欄位發現、project scope、每票 editmeta／schema／set 操作、required 判定與 PUT 流程；不能因此認為已有可呼叫的安全 UI 入口。
- 舊 service 的值型別可接受數字或 null，曾支援清空；**Dashboard 補填必須為正數且不可清空／寫0**，不可互套。

## Jira 資料依據
保留於 `jira-jql.ts`：
```jql
assignee = currentUser() AND created >= -30d ORDER BY created DESC
```
- Constant：`RECENT_ASSIGNED_ISSUES_JQL`。
- 更新 builder：`recentAssignedIssuesUpdateJql(issueIds)`，保留本人範圍並加 `id in (...)`。
- 保留 service 路徑：GET fields、POST search/jql、GET issue（editmeta）、PUT issue；本次文件整理未執行它們。

## 限制與解讀注意事項
若未來恢復頁面，必須重新接入完整的輸入驗證、登入、授權與測試；不能將未使用 service 的存在當成已完成產品功能或把 builder 單獨當授權。

## 實作狀態與程式來源
[保留的 Story Points service](../../lib/jira-story-points.ts)、[JQL 定義](../../lib/jira-jql.ts)。目前 `app/` 沒有此頁面路由；此差異已同步註明於 repository README。
