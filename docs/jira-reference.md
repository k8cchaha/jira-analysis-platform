# Jira 技術參考

[回功能總覽](README.md) · 基準：2026-11-10目前本機工作目錄（含尚未提交的Burn Down固定Resolved與專案回顧與趨勢整合），不是live Jira驗證或部署紀錄。

## 1. 「Jira指令」分三層閱讀
| 層次 | 回答的問題 | 權威來源 |
| --- | --- | --- |
| JQL | 查哪些票、用哪個指派／日期／Sprint／排序條件？ | [lib/jira-jql.ts](../lib/jira-jql.ts) |
| REST API | 如何搜尋、取得欄位／人員、檢查編輯資格及寫入？ | 各server service＋[jira-http.ts](../lib/jira-http.ts) |
| 欄位／投影計算 | 值代表什麼、怎麼算、怎樣解讀空值與日期？ | [jira-fields.ts](../lib/jira-fields.ts)＋各聚合模組 |

JQL是查詢語言，不是工時或Insight計算引擎。`POST /search/jql`是讀取搜尋；`PUT /issue`才是這些功能的票欄位修改。消費端不可自行拼接JQL，完整規則見 [AGENTS.md](../AGENTS.md)。

## 2. 欄位辭典
固定ID是現行mapping，不代表在任何Jira site／project都可用；編輯仍需runtime metadata及每票驗證。

| 資料 | REST欄位 | JQL引用／意義 | 主要用途 |
| --- | --- | --- | --- |
| Story Points（SP） | `customfield_10005` | `cf[10005]`，非負數字 | Planning分派、Burn Down基準、工作量SP、Dashboard缺值 |
| Actual Story Points | `customfield_13736` | `cf[13736]`，數字 | Dashboard缺值、已完成Actual摘要、工作量Actual |
| Dev Type | `customfield_14642` | `cf[14642]`，option | Planning工作單分類 |
| Impact Scope | `customfield_14848` | `cf[14848]` | Dashboard缺值及本人補填；single／multi必須發現 |
| Release Package | `customfield_13476` | `cf[13476]` | Dashboard Impact範圍；唯讀JQL不假設schema |
| Defect Cause | runtime發現ID | `"Defect Cause[Select List (multiple choices)]"` | Bug缺失分類／多選補填 |
| Root Cause／Solution | runtime發現ID | 本功能不以其查詢 | Defect補填的唯讀文字參考 |
| Assignee | `assignee.accountId`／displayName | `assignee`／`currentUser()` | 當前歸屬、範圍；名字不是身分驗證 |
| Status | `status` | `status`、`statusCategory`、`status CHANGED` | 現值狀態與歷史轉換是不同語意 |
| Resolution | `resolution` | `resolution` | 關閉原因／處置值，不是日期 |
| Resolved | **`resolutiondate`** | **`resolved`** | 完成日現行欄位；不是`fields.resolved` |
| Created／Updated／Due | `created`／`updated`／`duedate` | 同名日期欄位 | 建立視窗、未更新、到期、工作量fallback |
| Parent／Sprint／Epic | `parent`及相關關係metadata；Sprint清單本機 | `parent`、`sprint`、`key` | 子票母體與需求群組；Sprint ID是人工映射 |
| Summary／Reporter／Issue Type／Priority | 標準metadata | 對應標準欄位 | 明細、Reporter View、票種及Bug警示 |

**SP／Actual是點數，不自動等於小時、產能或績效。** `0`與missing在各功能不同，見第5節。不要為runtime欄位猜一個固定ID；`jira-fields.ts`提供schema／`customFieldJql()`，完整queries仍在`jira-jql.ts`。

## 3. 功能 → Query builder
| 功能／階段 | 使用的具名定義 | 重點 |
| --- | --- | --- |
| Dashboard警示 | `DASHBOARD_ALERT_JQL`、`DASHBOARD_ALERT_KEYS`、`dashboardAlertJql()` | base外加server scope；counts／details同builder |
| Dashboard缺失讀取 | `MISSING_POINTS_JQL`、`MISSING_POINTS_WITH_UNEXPECTED_CLOSED_JQL`、`MISSING_DEFECT_CAUSE_JQL`、`MISSING_IMPACT_SCOPE_JQL`；`missingDataReadJql()`／`missingDataListJql()` | 非預期關閉只擴Points read，不擴write |
| Dashboard補填 | `missingDataUpdateJql()` | 原始self query AND submitted numeric issue IDs |
| Dashboard看板 | `scrumBoardDevTasksJql()` | 實際Dev＋QA、排literal Done、無Sprint anchor |
| Planning主資料 | `sprintParentIssuesJql()`→`sprintChildTasksJql()` | 母票Sprint→Dev＋QA子票 |
| Planning品質清單 | `sprintChildTasksUnestimatedJql()`、`sprintChildTasksUnassignedJql()` | 未開子單是母票與有Dev／QA子票的母票差集 |
| PlanningReporter補查 | `epicIssuesByKeyJql()` | 補Epic Reporter；不是子票完成分析 |
| Planning圖表外連 | `sprintChildTasksOfParentTypeJql()`、`sprintChildTasksOfDevTypeJql()`、`sprintChildTasksUnclassifiedDevTypeJql()` | 不保留Team；未分類只查EMPTY |
| Burn Down母體 | `sprintParentIssuesJql()`→`sprintDevTasksJql()` | 已估Dev-only用於聚合 |
| Burn Down完成 | 同份 Dev-Task REST `resolutiondate`＋`createBurndownCompletionResolver()` | 完整分頁後依驗證帳號時區分組，無額外開局／逐日JQL、不fallback；舊completion builders已移除 |
| 工作量 | `workloadDoneDuringJql()`／`workloadDevTasksJql()` | 期間曾Done的Dev，再按當前欄位投影 |
| 舊Assigned service | `RECENT_ASSIGNED_ISSUES_JQL`／`recentAssignedIssuesUpdateJql()` | 固定本人created近30天；目前無頁面 |
| Capacity、專案回顧與趨勢、其餘ComingSoon頁 | 無功能資料query | Capacity mock；專案回顧與趨勢沿用Projects篩選，無分析引擎／圖表／計算；其餘未接入 |

保留的Dev-only `sprintUnestimatedJql()`／`sprintUnassignedJql()`不是目前Planning Dev＋QA清單來源。共用analysis builders存在不代表ComingSoon頁已接入。

### 3.1 Dashboard警示base
以下**只是base，不可直接當已套用指派範圍的完整query**；`dashboardAlertJql()`負責組成最終查詢。

| key | 現行base JQL |
| --- | --- |
| `s0s1` | `issuetype = "Bug" AND priority IN ("Critical (P0)", "High (P1)") AND (statusCategory = "To Do" or status = "In Progress")` |
| `s2` | `issuetype = "Bug" AND priority IN ("Medium (P2)") AND (statusCategory = "To Do" or status = "In Progress") and updated < -10d` |
| `inReview` | `status = "In Review"` |
| `requestInfo` | `status = "Request Info"` |
| `overdue` | `duedate < startOfDay() AND (statusCategory = "To Do" or status in ("In Progress", "In Review"))` |
| `upcoming` | `duedate >= startOfDay() AND duedate < startOfDay("+3d") AND (statusCategory = "To Do" or status in ("In Progress", "In Review"))` |

Bug base 無固定 project 條件，In Review 無 Dev／QA 票種限制；不可額外加上這些不存在的 base 限制。

### 3.2 完整JQL示例
以下inputs全為**合成帳號／票ID／key示例**，沒有查真實票。範例是builder輸出的說明，不是允許client任意提供JQL，也不是第二份production定義。

**A. Dashboard Review（self）**：`dashboardAlertJql("inReview", { mode: "self" })`
```jql
(status = "In Review") AND assignee = currentUser() ORDER BY key ASC
```

**B. Dashboard Review（team，sorted accounts／projects，30天）**：`dashboardAlertJql("inReview", resolvedScope)`
```jql
(status = "In Review") AND assignee in ("alice", "bob") AND created >= -30d AND project in (sun, tkk) ORDER BY key ASC
```

**C. Points缺失（原始self）**：`MISSING_POINTS_JQL`
```jql
issuetype in (DEV-Task, QA-Task) and resolution in (EMPTY, Done, Fixed) and ((status = Done and cf[13736] in (EMPTY, 0)) or (statusCategory not in ("To Do") and cf[10005] in (EMPTY, 0))) and assignee = currentUser()
```
Expanded Points constant只移除resolution限制，仍保留兩個missing分支。

**D. Defect Cause缺失**：`MISSING_DEFECT_CAUSE_JQL`
```jql
project in (sun, tkk, jiratry) and issuetype = bug and assignee = currentUser() and statusCategory != "To Do" and status not in ("In Progress", "Dev Ready") and resolution in (EMPTY, Done, Fixed) and "Defect Cause[Select List (multiple choices)]" is EMPTY
```

**E. Impact Scope缺失**：`MISSING_IMPACT_SCOPE_JQL`
```jql
project = sun and issuetype in (story, task, bug) and cf[14848] is EMPTY and (created >= "2026-11-01" or cf[13476] = "Sprint9") and cf[13476] is not EMPTY and assignee = currentUser()
```

**F. 本人Impact補填資格**：`missingDataUpdateJql("impact-scope", ["101", "102"])`
```jql
(project = sun and issuetype in (story, task, bug) and cf[14848] is EMPTY and (created >= "2026-11-01" or cf[13476] = "Sprint9") and cf[13476] is not EMPTY and assignee = currentUser()) AND id in (101,102)
```
仍需service檢查原值／empty、schema、permission與allowed choices，builder不是完整授權。

**G. 看板self、local近30天**：`scrumBoardDevTasksJql({ mode: "self" }, 30)`
```jql
issuetype in ("Dev-Task", "QA-Task") AND status not in ("Done") AND assignee = currentUser() AND (created >= -30d OR updated >= -30d) ORDER BY key ASC
```
這個created-or-updated例外屬看板control；nonself仍有Dashboard created-only window。

**H. Sprint母票**：`sprintParentIssuesJql(7518)`
```jql
sprint = 7518 AND issuetype in (story, task, bug)
```

**I. Planning Dev＋QA**：`sprintChildTasksJql(["SUN-51", "SUN-50"])`
```jql
parent in (SUN-50, SUN-51) AND issuetype in ("Dev-Task", "QA-Task")
```

**J. Planning未估時**：`sprintChildTasksUnestimatedJql(["SUN-50", "SUN-51"])`
```jql
parent in (SUN-50, SUN-51) AND issuetype in ("Dev-Task", "QA-Task") AND cf[10005] in (Empty, 0)
```
未分派改由具名builder加`assignee is empty`；未開子單需要service差集，沒有本頁使用的單一「無子單」JQL。

**K. Burn Down全部Dev工作單**：`sprintDevTasksJql(["SUN-50", "SUN-51"])`
```jql
parent in (SUN-50, SUN-51) AND issuetype = "Dev-Task"
```
完整搜尋分頁包含 REST `resolutiondate`。server 用同 credentials 的 `GET /rest/api/3/myself` 驗證帳號及取得時區，再以 `createBurndownCompletionResolver()` 將帶 offset 的 timestamp 投影為帳號日曆日期：start 前為開局，其後在最後可見日內依日分組。**不另查開局或每日完成JQL**，不加目前status、不用updated或UTC+8補值、不把區間後完成夾到末日。非法非空日期或帳號／時區資料失敗，回受控錯誤，不展示部分資料。

Burn Down已移除By Resolved checkbox及舊Done-transition／逐日Resolved查詢；新網址不帶旗標，缺省或單一舊`byResolved=1`都走同一Resolved規則，非法／重複旗標在credentials與Jira I/O前拒絕。受阻母票覆寫仍預設啟用，可使Resolved空白的工作單計完成，取消它才是純Resolved結果。

**L. 工作量期間**：`workloadDevTasksJql(resolvedScope, { from: "2026-10-05", to: "2026-11-03" })`
```jql
issuetype = "Dev-Task" AND status CHANGED TO "Done" DURING ("2026-10-05", "2026-11-03") AND assignee = "example-account" AND project in (sun) ORDER BY key ASC
```
單日改`ON`，期間`to`不加一天；日期先驗證。這是選票條件，接著`resolveCompletionDate()`以現行欄位分桶，不是用transition timestamp直接繪圖。

## 4. REST與站內資料流
Jira請求由server透過OAuth cloud transport：`https://api.atlassian.com/ex/jira/{cloudId}`＋REST path。cloudId來自已解析credentials，不接受瀏覽器任意改cloud或JQL；外連Ticket／query開網站不等於站內API寫入。

| Method／Jira REST | 用途 | 消費功能 |
| --- | --- | --- |
| GET `/rest/api/3/field` | ID／name／schema及scope發現 | Dashboard、保留Assigned service等 |
| POST `/rest/api/3/search/jql` | 依具名JQL搜尋；`nextPageToken`完整分頁 | Dashboard、Planning、Burn Down、工作量 |
| GET `/rest/api/3/issue/{id}?fields=…` | 讀live values；必要時`expand=editmeta` | 缺失明細、更新前驗證 |
| PUT `/rest/api/3/issue/{id}` | field-only更新，要求HTTP204 | Dashboard合格self補填；Assigned僅保留service |
| GET `/rest/api/3/user/search` | display name搜尋，最多前20結果 | Dashboard指定人 |
| GET `/rest/api/3/user?accountId=…` | server再次驗身分 | person scope |
| GET `/rest/api/3/myself` | 同search credentials的accountId／timeZone；需`read:jira-user` | Burn Down帳號時區分桶 |
| GET `/rest/api/3/group/member?groupname=…` | startAt分頁、完整會員 | team scope、共用預載、Planning群組輔助 |

**沒有接入Jira Agile Sprint API**：Project與Sprint records目前是本機配置。Capacity沒有容量REST／PUT；專案回顧與趨勢沒有分析JQL／REST或功能資料I/O，共用Team可能讀成員metadata但不查分析數據；其餘ComingSoon頁也未接入功能資料I/O。專案回顧、跨期趨勢與同條件比較集中於 `/analytics/projects`，舊趨勢／比較根路徑及已知子頁別名以307直接跳轉至該入口並保留所有query值（含無效／重複值），不新增Jira查詢或寫入。

| 站內入口 | 資料流 |
| --- | --- |
| Dashboard `/api/dashboard/alerts` | 按kind取兩個exact counts |
| Dashboard `/api/dashboard/alerts/bugs`、`/due`、`/pending` | 明細讀取，readonly |
| Dashboard `/api/dashboard/missing-data` | `kind`＋`view=summary` 或 `view=page`＋可選綁定 pageToken |
| Dashboard `/api/dashboard/scrum-board`、`/lookups` | 看板與user／group metadata |
| `updateMissingDataAction` | 驗證self提交→原始資格query＋IDs→live值／editmeta→field-onlyPUT |
| Planning RSC＋`/api/sprint/planning/subset` | 主資料與3個品質清單，各自讀取 |
| `/api/sprint/burndown/stream` | 完整母票／Dev分頁＋帳號時區＋resolutiondate markers→`base→done`；收齊才顯示整圖／成員結果 |
| `/api/analytics/workload/heatmap/stream` | 整期間搜尋、雙點數與缺值→`base→done`，無day掃描 |

SSE不是Jira變更推播，而是本次完整讀取結果。Burn Down不再發daily事件或逐日query，HTTP次數由資料分頁決定，不隨Sprint天數增加；任一分頁／日期投影失敗不發部分base或假done。EventSource讀不到非2xx body，開流前錯誤可能用**200＋error frame**呈現；JSON callers則取HTTP錯誤碼。判成功要看payload及done／error，不只HTTP200。

## 5. 跨功能數字與日期契約
| 功能 | 母體／完成 | 缺值與0 | 時間與窗口 |
| --- | --- | --- | --- |
| Dashboard Points | 狀態依賴Dev＋QA缺值union；非完成度 | EMPTY／0可missing；補填只能正值 | nonself created近Nd；self無此窗口 |
| Dashboard警示／看板 | 各base條件；看板排literalDone但其他狀態可能歸ToDo | count0只表示本query沒有匹配 | Jira due日界；Pending瀏覽器Updated日差；Bug完整24h；self看板local created-or-updated |
| Planning | Sprint母票下Dev＋QA，全狀態 | null／非法加總0，0保留但未估JQL含0 | 本機Sprint、app UTC今天；無近Nd |
| Burn Down | 已估Dev，完整載入現行resolutiondate按日分組；另有預設啟用的受阻覆寫 | nullSP排除，0有效；非法SP／非空非法Resolved報錯；空日期無fallback，覆寫仍可計完成 | 驗證Jira帳號具名時區（含DST）；UTC今天、min(today,end,start+59天)；區間後完成不夾末日 |
| 工作量 | 期間曾Done的Dev，再Resolved→Updated→末日投影 | SP／Actual獨立missing，0有效、不互補 | UTC+8分桶及截止；早於from排除、晚於to夾末日；週一起日>=from |
| Capacity | 全mock | filled=false不代表容量0 | 固定10天×2；本機Project state不是Sprint紀錄 |

三種百分比不相同：
- **Planning分派比例**：已分派SP／有票Assignee的固定容量，SUN20／TKK40／PRIDE20。
- **Burn Down完成度**：doneSP／全部已估SP，依現行Resolved與獨立受阻覆寫；取消覆寫後才是純Resolved結果。
- **工作量Output%**：所選metric Total／（顯示週數×10），不是Planning容量或實際出勤。

公式與明細限制以 [Planning](features/sprint-planning.md)、[Burn Down](features/sprint-burndown.md)、[工作量](features/analytics-workload.md) 的詳述為準。不能聲稱同一「已完成」在所有頁面得到相同答案。

## 6. 授權、完整性與快取
- Atlassian OAuth 3LO登入；read需要Jira read scopes，補填還需要`write:jira-work`及該票Jira編輯權限。user／group lookup需相應granular scopes及Jira瀏覽群組權限；新scope需重新授權，不會自動增加Jira permission。
- credentials只server使用，encrypted HttpOnly session cookie不供browserJS讀token。文件不含credentials；導覽allowlist不代替server驗證。
- Burn Down在母票非空時用相同credentials讀`/myself`，要求accountId等於server viewer、timeZone有效；Jira回profile時區或instance default。不接受client時區、不存進session、不靜默退UTC／UTC+8。現行OAuth scope定義包含`read:jira-user`，但未驗證真實grant。缺時區／身分不符為invalid_response，401要求重新授權，403為權限錯誤，transport／429／5xx可重試。公開規格：[Atlassian Myself REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-myself/)。
- **Dashboard／工作量server scope**完整解析、先逐group排除再union／去重、驗accountId／project、維持限制；無效／不完整範圍失敗，不退self或較廣範圍。**Sprint頁的Team是已取資料client filter**，載入尚未完成可維持全體，不能當server授權邊界。
- Dashboard補填保留原始self eligibility AND提交IDs；person／team讀取得到本人票也仍不可寫。非預期關閉只擴read。
- SP更新要expected original及正值、schema／set檢查；Defect／Impact只補empty並驗allowed option IDs。GET與PUT非原子，一位小數投影也不是raw全精度CAS。
- 共用完整search每頁最多100、每query最多5,000issues／100頁；重複issue、循環cursor、缺末頁訊息或超限不能當完整成功count。
- 缺失明細application batch50，token加密、15分鐘、綁viewer／cloud／kind／JQL／完整filter；scope或membership改變需要重新從首頁載入。每次補填最多50 changed issues。
- Dashboard filter URL最多16,384字元／1,100 entries，member上限1,000、JQL32,000字元；群組完整分頁與原始群規模也有限制，不能靠排除人數繞過。
- **已知顯示限制**：alerts／board client只接受8,000字元JQL，低於server上限；server-valid大query也可能client拒收。
- Browser成功成員名單存session記憶體供跨頁重用，至reload／logout／viewer change；不存token。server member cache hard TTL30分鐘只供group preload lookup與workload opt-in，Dashboard數量／明細／警示／看板仍重新解析scope。
- 多個query／卡片與read-then-write不是原子快照；錯誤、partialstream、缺metadata不能當0或完成。

## 7. 維護與查核來源
- [欄位定義](../lib/jira-fields.ts)、[完整JQL](../lib/jira-jql.ts)、[HTTP transport](../lib/jira-http.ts)、[scope解析](../lib/jira-dashboard-lookups.ts)
- [Dashboard service](../lib/jira-dashboard.ts)、[寫入輸入驗證](../lib/jira-missing-data.ts)、[pageToken](../lib/jira-page-token.ts)
- [Planning service](../lib/planning-data.ts)、[Burn Down service](../lib/jira-burndown.ts)、[Workload service](../lib/jira-workload.ts)
- [本機Sprint](../lib/jira-sprint-data.ts)、[日期快捷鍵](../lib/date-range.ts)、[工作量投影](../lib/workload-heatmap.ts)

修改query／field只改權威module，service保留授權／I/O，文件與測試expected同步。未接入的library、保留舊service與ToDo不列為已完成能力。本次只靜態對照及本機文件驗證，沒有liveJira搜尋／PUT。
