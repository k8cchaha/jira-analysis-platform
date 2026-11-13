# 功能說明文件

這份文件依 **2026-11-10 的實際頁面與程式行為**整理；在既有 Burn Down Resolved 分析與專案入口整合基礎上，核對本次 Projects Sprint-only、日期篩選搬至團隊分析與成員舊入口搬移。2026-11-11 另同步設定頁清空與暫時環境診斷移除；2026-11-12 同步帳號選單、預設值設定、相容頁面的初始化規則，以及 Projects 唯讀 Sprint 回顧與六項比較指標。它說明產品頁面的目的、解決的問題、可找的 Insight 與 Jira 資料依據；**不是部署證明、真實 Jira 資料報告或未來功能承諾**。

## 建議閱讀方式
- **第一次認識產品**：先看下方功能總覽，再讀對應頁面的「目的／Insight／使用方式」。
- **確認數字怎麼算**：看各頁「指標與判定規則／限制」，不要跨頁套用完成定義。
- **開發、維護或稽核查詢**：看 [Jira 技術參考](jira-reference.md)，依 builder／service 回到程式來源。
- **新增或更新文件**：使用 [功能頁文件模板](feature-template.md)。

Markdown 是權威來源，留在 repository 版本管理；未來需要 HTML／PDF／Word 時應從這一份轉出，不另維護第二套內容。功能說明以 Markdown 文件維護，未產生或發布外部閱覽頁。

## 狀態定義
| 狀態 | 意義 |
| --- | --- |
| 已實作 | 目前程式有實際功能與資料管線；不表示沒有已知限制或已部署 |
| 部分實作 | 有介面、篩選或示範操作，但核心資料／保存能力未完成 |
| 規劃中 | ComingSoon／ToDo，沒有可用的分析或管理操作 |
| 舊服務、無頁面 | 保留 library／query，但目前無對應產品路由 |

## 功能總覽
依目前主導覽分類列出；路徑對應實際 `page.tsx`，不是預定路由或舊網址別名。

| 分類／功能頁 | 現有路徑 | 目的 | 解決的問題 | 主要 Insight／用途 | 狀態 |
| --- | --- | --- | --- | --- | --- |
| [儀表板](features/dashboard.md) | `/dashboard` | 集中個人／指定人／團隊的注意事項與缺值 | 分散查詢、難追補填 | 優先 Bug、期限、待 Review／資訊、資料品質與指派看板 | 已實作；僅本人合格缺值可補填 |
| Sprint／[Planning](features/sprint-planning.md) | `/sprint/planning` | 確認 Sprint 規劃與分派 | 未估、未拆、未分派與組合不清 | 分派集中、Bug／維運占比、規劃完整性 | 已實作；Dev＋QA，容量固定假設 |
| Sprint／[開發狀況／Burn Down](features/sprint-burndown.md) | `/sprint/burndown` | 觀察每日完成／剩餘節奏 | 不易看完成日序與剩餘工作 | 實際與理想節奏、未完成票、完成口徑差異、受阻覆寫 | 已實作；已估Dev-only |
| Sprint／[Capacity](features/sprint-capacity.md) | `/sprint/capacity` | 示範容量與請假試算 | 未來需要集中人力確認 | 目前僅mock試算，不能判斷真實容量 | 部分實作；無持久化／Jira容量資料 |
| 分析／[工作量分析](features/analytics-workload.md) | `/analytics/workload` | 觀察成員週點數分布 | 總量無日序、指標混用、難追原票 | SP／Actual週分布、集中與缺值 | 已實作；Jira唯讀、明確查詢才執行 |
| 分析／[專案回顧與趨勢](features/analytics-projects.md) | `/analytics/projects` | 比較已結束 Sprint 的唯讀工作摘要 | 輸出、工作構成與承諾／品質口徑不清 | SP／Actual輸出、六類Dev Type、Commitment、Bug／Dev、TKK／SUN壓力、目前未完成及本地明細 | 已實作；手動查詢，現值非歷史快照，無Capacity比較 |
| 分析／[團隊分析](features/analytics-team.md) | `/analytics/story-points` | 規劃指定日曆期間的團隊工作摘要 | 團隊彙整負擔、日期篩選入口不清 | 尚無結果；可選專案、整個Team與日期區間 | 部分實作；日期篩選可用，結果ComingSoon |
| 報表／[儲存的報表](features/reports-saved.md) | `/reports/saved/list` | 規劃重用報表設定 | 重複輸入常用條件 | 設定管理，非新分析指標 | 規劃中；ComingSoon |
| 報表／[匯出紀錄](features/reports-exports.md) | `/reports/exports/list` | 規劃查看／下載匯出成果 | 檔案與版本追蹤 | 交付管理，尚無檔案 | 規劃中；ComingSoon |
| 設定／[系統設定](features/settings-system.md) | `/settings/system` | 保留系統設定入口 | 設定管理尚未實作 | 僅頁面標題；環境診斷與讀值入口已移除 | 規劃中；內容已清空 |
| 設定／[專案設定](features/settings-project.md) | `/settings/project` | 保留專案設定入口 | 可維護的規劃參數尚未實作 | 僅頁面標題，無設定或ToDo內容 | 規劃中；內容已清空 |

### 補充路徑與舊功能
- [預設值設定](filter-defaults.md)：右上角帳號選單中的彈窗，可依登入帳號在同一瀏覽器保存專案／整組團隊預設值；只初始化之後進入相容頁面時的未指定條件，不新增路由、不覆蓋 URL 或現在的篩選。
- [Jira 連線資訊](features/settings-jira.md)：`/settings/jira` 路由存在，但不在目前主導覽分類；ComingSoon，無連線管理操作。
- [指派給我的 Issues（舊服務）](features/legacy-assigned-issues.md)：舊 `/issues/assigned/list` **目前不存在**；只保留 service／JQL／測試，不能當可用頁面。
- 原趨勢分析與比較分析已整合至 **專案回顧與趨勢**（唯一入口 `/analytics/projects`）；舊 `/analytics/trends`、`/analytics/comparison` 根路徑及其已知子頁別名，以 **307直接跳轉**至該入口，保留所有 query 值（含無效值與重複值），不先驗證或修正條件。舊文件保留為搬移提示，見 [趨勢分析搬移說明](features/analytics-trends.md)／[比較分析搬移說明](features/analytics-comparison.md)。
- 原成員分析的實體頁面、`AppRoute` 與導覽項目已移除；`/analytics/members` 根路徑及 `/summary`、`/comparison`、`/detail` 以307直接跳轉至 `/analytics/story-points`，保留所有 query 值，不代表成員統計已完成。舊文件僅保留 [成員分析搬移說明](features/analytics-members.md)，不再列為功能頁。
- 合計17個精確、單跳307別名；無wildcard、未知子路徑與API不變。舊 Projects 日期網址不自動跳頁，而是錯誤＋手動移至團隊分析連結：合法舊 `mode=dates`＋Project／from／to 保留該條件，不合法則連乾淨團隊入口。日期篩選預設近1個瀏覽器本地日曆月，支援近1／2／3／6月及自訂日期；兩頁的Team僅local整個群組，URL還原不自動分析。
- 登入、OAuth callback、根路徑跳轉及舊 analysis URL redirect 是支援流程，不另列分析功能頁。安全與授權見 [Jira 技術參考](jira-reference.md)。

以上覆蓋目前 `app/(app)` 的12個實體功能頁路由（11個主導覽目的地＋補充 `/settings/jira`），分析只有工作量／專案回顧與趨勢／團隊分析三個 canonical 頁，以及1項無路由的舊服務。導覽可能依登入者配置只顯示儀表板；**此表不是使用者權限清單，導覽隱藏也不等於 server API 授權**。

## 五個閱讀前提醒
1. **同名點數不一定有相同母體**：Planning與Projects為Sprint母票下Dev＋QA、Burn Down已估Dev-only、工作量是期間曾Done的Dev、Dashboard缺值是狀態依賴的Dev＋QA。
2. **完成日期不同**：Projects依驗證Jira帳號時區的Resolved完整日及含首末日Sprint區間；Burn Down固定Resolved但有顯示截點及獨立受阻覆寫；工作量取transition母體後以Resolved→Updated→末日投影，不能互套。
3. **容量不同**：Planning固定點數、Capacity mock試算、工作量Output%的每週10點基準互不相通；Projects暫無Capacity比較。
4. **現值不是歷史快照**：assignee、SP、父子關係與Resolved可被修改；重查歷史可能得到不同結果。
5. **Insight是追查線索**：票數、SP或百分比不是自動產生的因果、工時、效率或績效結論。

## 文件維護契約
- 功能變更同步更新本索引的狀態與對應頁；更改母體／公式／日期／權限時，也更新 [Jira 技術參考](jira-reference.md)。
- 完整production JQL只定義在 [jira-jql.ts](../lib/jira-jql.ts)，custom field mapping只在 [jira-fields.ts](../lib/jira-fields.ts)；文件範例不是第二份production定義。
- 尚未接入的builders、介面或ToDo，不宣稱已實作；合成範例明確標示，不使用真實票資料、accountId或憑證。
- 發版前以當時程式再確認「已實作／部分／規劃」與來源；本文件日期表示整理基準，不代表每次查詢的資料時間。
- 本次文件更新採頁面／程式對照、離線模型／路由／篩選與mock Jira回歸，以及本機合成元件明暗／手機／桌面操作與截圖檢查；未呼叫live Jira、執行真實PUT或驗證部署。
