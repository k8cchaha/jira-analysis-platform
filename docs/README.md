# 功能說明文件

這份文件以 **2026-11-09 目前 repository 工作目錄**為基準，包含尚未提交的 By Resolved 實作。它說明產品頁面的目的、解決的問題、可找的 Insight 與 Jira 資料依據；**不是部署版本證明、真實 Jira 資料報告或未來功能承諾**。

## 建議閱讀方式
- **第一次認識產品**：先看下方功能總覽，再讀對應頁面的「目的／Insight／使用方式」。
- **確認數字怎麼算**：看各頁「指標與判定規則／限制」，不要跨頁套用完成定義。
- **開發、維護或稽核查詢**：看 [Jira 技術參考](jira-reference.md)，依 builder／service 回到程式來源。
- **新增或更新文件**：使用 [功能頁文件模板](feature-template.md)。

Markdown 是權威來源，留在 repository 版本管理；未來需要 HTML／PDF／Word 時應從這一份轉出，不另維護第二套內容。本次只建立 Markdown 文件，未產生或發布外部閱覽頁。

## 狀態定義
| 狀態 | 意義 |
| --- | --- |
| 已實作 | 目前程式有實際功能與資料管線；不表示沒有已知限制或已部署 |
| 部分實作 | 有介面、篩選或示範操作，但核心資料／保存能力未完成 |
| 規劃中 | ComingSoon／ToDo，沒有可用的分析或管理操作 |
| 舊服務、無頁面 | 保留 library／query，但目前無對應產品路由 |

## 功能總覽
| 分類／功能頁 | 目的 | 解決的問題 | 主要 Insight／用途 | 狀態 |
| --- | --- | --- | --- | --- |
| [儀表板](features/dashboard.md) | 集中個人／指定人／團隊的注意事項與缺值 | 分散查詢、難追補填 | 優先 Bug、期限、待 Review／資訊、資料品質與指派看板 | 已實作；僅本人合格缺值可補填 |
| [Planning](features/sprint-planning.md) | 確認 Sprint 規劃與分派 | 未估、未拆、未分派與組合不清 | 分派集中、Bug／維運占比、規劃完整性 | 已實作；Dev＋QA，容量固定假設 |
| [開發狀況／Burn Down](features/sprint-burndown.md) | 觀察每日完成／剩餘節奏 | 不易看完成日序與剩餘工作 | 實際與理想節奏、未完成票、完成口徑差異、受阻覆寫 | 已實作；已估Dev-only |
| [Capacity](features/sprint-capacity.md) | 示範容量與請假試算 | 未來需要集中人力確認 | 目前僅mock試算，不能判斷真實容量 | 部分實作；無持久化／Jira容量資料 |
| [工作量分析](features/analytics-workload.md) | 觀察成員週點數分布 | 總量無日序、指標混用、難追原票 | SP／Actual週分布、集中與缺值 | 已實作；Jira唯讀、明確查詢才執行 |
| [專案分析](features/analytics-projects.md) | 選專案與Sprint／日期分析條件 | 範圍選擇不一致 | 尚無分析結果 | 部分實作；僅篩選介面 |
| [團隊分析](features/analytics-team.md) | 規劃團隊工作摘要 | 團隊彙整負擔 | 尚無結果，規劃團隊視角 | 規劃中 |
| [成員分析](features/analytics-members.md) | 規劃個人工作摘要 | 個人資料分散 | 尚無結果，規劃成員視角 | 規劃中 |
| [趨勢分析](features/analytics-trends.md) | 規劃跨時間變化觀察 | 難區分波動與長期變化 | 尚無時間序列／預測 | 規劃中 |
| [比較分析](features/analytics-comparison.md) | 規劃2～4個同類對象比較 | 比較口徑不一致 | 尚無比較結果 | 規劃中 |
| [儲存的報表](features/reports-saved.md) | 規劃重用報表設定 | 重複輸入常用條件 | 設定管理，非新分析指標 | 規劃中 |
| [匯出紀錄](features/reports-exports.md) | 規劃查看／下載匯出成果 | 檔案與版本追蹤 | 交付管理，尚無檔案 | 規劃中 |
| [系統設定](features/settings-system.md) | 規劃工作區設定入口 | 配置分散 | 管理用途，尚無操作 | 規劃中 |
| [專案設定](features/settings-project.md) | 規劃容量、成員與延伸天數 | 缺可維護的規劃參數 | ToDo說明，尚未接入計算 | 規劃中 |

### 補充路徑與舊功能
- [Jira 連線資訊](features/settings-jira.md)：`/settings/jira` 路由存在，但不在目前主導覽分類；ComingSoon，無連線管理操作。
- [指派給我的 Issues（舊服務）](features/legacy-assigned-issues.md)：舊 `/issues/assigned/list` **目前不存在**；只保留 service／JQL／測試，不能當可用頁面。
- 登入、OAuth callback、根路徑跳轉及舊 analysis URL redirect 是支援流程，不另列分析功能頁。安全與授權見 [Jira 技術參考](jira-reference.md)。

以上覆蓋目前 `app/(app)` 的15個功能頁路由，以及1項無路由的舊服務。導覽可能依登入者配置只顯示儀表板；**此表不是使用者權限清單，導覽隱藏也不等於 server API 授權**。

## 五個閱讀前提醒
1. **同名點數不一定有相同母體**：Planning Dev＋QA、Burn Down 已估Dev-only、工作量是期間曾Done的Dev、Dashboard缺值是狀態依賴的Dev＋QA。
2. **完成日期不同**：Burn Down預設transition／可選Resolved；工作量取transition母體後以Resolved→Updated→末日投影，不能互套。
3. **容量不同**：Planning固定點數、Capacity mock試算、工作量Output%的每週10點基準互不相通。
4. **現值不是歷史快照**：assignee、SP、父子關係與Resolved可被修改；重查歷史可能得到不同結果。
5. **Insight是追查線索**：票數、SP或百分比不是自動產生的因果、工時、效率或績效結論。

## 文件維護契約
- 功能變更同步更新本索引的狀態與對應頁；更改母體／公式／日期／權限時，也更新 [Jira 技術參考](jira-reference.md)。
- 完整production JQL只定義在 [jira-jql.ts](../lib/jira-jql.ts)，custom field mapping只在 [jira-fields.ts](../lib/jira-fields.ts)；文件範例不是第二份production定義。
- 尚未接入的builders、介面或ToDo，不宣稱已實作；合成範例明確標示，不使用真實票資料、accountId或憑證。
- 發版前以當時程式再確認「已實作／部分／規劃」與來源；本文件日期表示整理基準，不代表每次查詢的資料時間。
- 本次整理採靜態程式查核與本機文件驗證，未新增產品程式、未呼叫live Jira或執行真實PUT。
