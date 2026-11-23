# 專案回顧與趨勢

[回功能總覽](../README.md) · 唯一入口：`/analytics/projects` · 狀態：**已實作（唯讀 Sprint 回顧與比較；未做 live Jira／部署驗證）**

## 目的與 Insight
在相同 Project／Team 範圍比較已結束 Sprint 的產出、工作構成、負載率／完成率與目前未完成工作。數字與本地工作單明細使用同一份完整資料，可先核對缺值、母體與日期，再追查差異。

本版不是歷史快照重建，也沒有 Capacity 比較、績效排行、Velocity 預測、移動平均或因果判定。日曆日期區間分析入口仍是 [團隊分析](analytics-team.md)，不要與本頁 Sprint 口徑混用。

## 使用方式
- 導覽使用單純 History（時鐘＋回轉箭頭）。
- **Sprint-only**：單選必填 Project、複選必填 Sprints、選填整組 Team、查詢；沒有日期 radio、日期欄位或快捷日期。
- Project、Sprints、Team、查詢依序在同一列；查詢靠右，窄容器換行且夾到可用寬度。重用中央寬度：Project 160px、Sprint／Team 224px、SearchButton 96px，loading 不變寬。
- 未選 Project 時 Sprints、Team、查詢不可操作。Sprints 清單來自本機設定，只顯示 `endDate < 瀏覽器本地今天`，最新在前；今天結束、進行中、未來 Sprint 不顯示。SSR 等待瀏覽器日期，不猜伺服器時區；未補零設定日期先正規化比較。
- 每個 Sprint 名稱下方以灰色顯示起迄日，不加大原本間距；日期可截斷並用 title 查看完整值。每次開啟下拉只在已結束選項定位最近今天的 Sprint，同距離依較早開始、較小 ID；只捲面板、不捲頁、不勾選。選取與 URL 更新不重置手動捲動。
- 每次分析 **1–6 個 Sprint**，全部 ID 必須符合所選 Project 與已結束規則。URL 結構仍容許最多 128 個值；>6 明確要求縮小，不截取或偷偷改 URL。
- Project／Sprint 選擇立即更新 URL，例如 `/analytics/projects?project=SUN&sprint=6823&sprint=7518`。更換 Project 清空舊 Sprint，保留 Team。Team 僅保存在本頁，不寫入 URL、沒有逐成員排除；重新整理後可由 [預設值設定](../filter-defaults.md) 再初始化。
- **只有按「查詢」才分析。** 入頁、預設值、URL 還原、Project／Sprint／Team 變更、重新整理、上一頁／下一頁均不自動查詢。團隊成員 metadata 不完整時等待或在團隊選單重試，不以部分名單分析。
- 無 Team = 明確 Project／Sprint 母體內全部可讀工作單（含未指派），不是本人。選 Team = server 完整解析群組後，以工作單當前 assignee 過濾；browser 成員 IDs 不作授權。
- 若查詢時未選團隊（全範圍），之後只勾選團隊而**專案與 Sprints 未變更**時，直接以該份全範圍結果重新聚焦這些團隊（團隊歸屬沿用同一份資料），不重新查詢 Jira；按「查詢」也同樣只重新聚焦。變更專案、Sprint 或原本就是特定團隊範圍時才重新查詢。
- 條件變動、history、新提交與離頁會使舊請求失效；不同範圍不展示舊數字。相同條件重查可保留淡化的前次結果；成功前不顯示新的部分數字。可重試同條件，錯誤不擴大範圍。
- 結果以五個本地主題頁籤切換：總產出、負載率／完成率、估點偏差率、完成任務類型、目前未完成，預設總產出；一次顯示一個完整寬度主題。切換不改 URL、不查詢，保留各主題單位、圖例、Sprint 讀值與數據表展開狀態；切到不同主題收合舊本站明細。新查詢成功仍重設呈現狀態。頁籤支援左右循環與 Home／End，手機只在頁籤列內水平捲動。
- 總產出、負載率／完成率、估點偏差率、完成任務類型、目前未完成五個主題在新查詢結果中都預設選取**最新的 Sprint**（按開始日，同日依 ID）：總產出顯示該 Sprint 的團隊拆分明細，負載率／完成率顯示該 Sprint 的各團隊／各成員明細，任務類型顯示該 Sprint 自己的類型佔比甜甜圈。預選不是點擊，第一次點同一 Sprint 只是確認、第二次才清除；清除後不會因重繪又被選回。完成率圖下的各團隊明細每列為「團隊｜計畫／完成與 Capacity 兩條長條｜負載率｜完成率」：**負載率 = 計畫 SP ÷ Capacity**（Capacity 以佔位人數 × 每人點數計算，未設 Capacity 時顯示「—」），**完成率 = 完成 SP ÷ 計畫 SP**。長條不再畫滿整列寬度，右側固定留給這兩個比率欄位，較窄畫面時長條區自行縮減。圖上選項為三個：**全團隊負載率／完成率**（預設，兩條彙總曲線）、**各團隊負載率**、**各團隊完成率**；單一團隊範圍時相同三選項改為各成員。負載率圖上以「計畫 SP ÷ Capacity」計算，Capacity 只取已載入名單的人數，沒有名單時該點為不適用，不補 0。完成率的各團隊曲線與明細只列在所選 Sprint 期間有 Dev-Task／QA-Task 母體的團隊（含未指派「其他」），不因沒有完成工作而排除；團隊歸屬無法取得時不畫各團隊曲線、也不開明細。完成率的團隊圖例擁有自己的顯示清單，與總產出互不相干：點擊任一團隊只隱藏該團隊曲線並保留其按鈕（標示「已隱藏」），再次點擊即恢復；圖例固定列出所有有母體的團隊，被排除的團隊不會連按鈕一起消失。
- **趨勢圖優先，表格核對**：多 Sprint 按開始日升序（同日依 ID）等距排列，僅包含已選 Sprint，不補其他 Sprint。總產出每個候選團隊一線，在圖右上方切換 Story Points／Actual Story Points（預設 SP）；每種 Dev Type 一線；負載率與完成率、Bug／Dev 為百分比線；TKK／SUN SP 兩線（合計保留在讀值／表格）；目前未完成合併為一圖，以 SP／張數按鈕切換（預設 SP），單 Sprint 僅顯示一個觀測點、不補造曲線。每圖一種量綱，不混用點數與張數軸；一般指標零起點，估點偏差率以零為中線顯示正負點數差。
- 總產出右上方的「顯示總量」預設不勾；勾選改為每 Sprint 一根依團隊顏色分段的堆疊長條，只有「顯示團隊合計」曲線連接頂點、不畫團隊曲線；取消勾選恢復各團隊曲線。長條與總量隨可見團隊同步更新，總量按完整工作單聯集聚合，不直接相加 nullable 團隊數字。堆疊只含已填量，保留 SP／Actual 缺值與完整率；null 不画長條／總量標記，保留團隊的真正 0 觀測值仍使用 baseline 標記，partial 總量使用空心標記。團隊圖例可獨立加入／移除，按鈕 `aria-pressed` 表示顯示；色／形狀／線型不變，目前單位下所有已選 Sprint 都完整為 0 的團隊自動從圖表／圖例排除（包括沒有完成工作的空團隊）；有任一非零觀測值、未填或部分缺值的團隊保留，不用未知值推論全零。其餘圖例始終保留供手動恢復；SP／Actual SP 切換重算自動排除，保留各團隊手動顯示偏好。圖形、讀值及圖下明細只顯示可見團隊與啟用合計；全部隱藏顯示提示，不畫假零線。切換不查詢／改 URL，不重掛圖表，保留選取 Sprint；團隊／合計或點數單位改變收合舊團隊明細。自動排除後無團隊時顯示全零提示，不生成合計／觀測點；不誤導為手動隱藏，切換單位可恢復有量或缺值的團隊。合計與精確 Issue ID 連結只包含當前合格且手動可見的團隊。團隊 SP／Actual SP／張數核對表保留所有候選團隊，全範圍總產出與既有未完成欄位不受圖例影響。單 Sprint 未勾總量時用團隊觀測點，勾選時為一根堆疊長條與總量標記、沒有連線；全範圍摘要只隨點數單位切換，不隨可見團隊縮減。
- 任務類型預設 SP，可切 Actual SP／張數；品質預設張數比，可切 SP 比／Actual SP 比。Dev Type 圖例可聚焦一類，再點恢復；所有七類（含未分類）及原色始終保留，不提供任意隱藏。單位／聚焦只是本地呈現，不發 request、不改 URL／scope。
- 連續三個以上有效值以有界曲線連接；兩值直線、一值標記；缺值斷線、0 有效。曲線不是每日數值或 Sprint 內插估計；部分缺估以空心標記及已填／未填資訊揭露。單 Sprint 的摘要各放在對應主題頁籤內，任務類型用可切單位的橫條分布，不製造平坦趨勢。
- 圖中最近 Sprint 讀值支援 pointer、鍵盤 focus（優先於 hover）、左右鍵與觸控點選；同一個有名稱的互動讀值區列出所有可見系列、完整起迄日與缺值／分子分母，不使用唯讀 tooltip 角色。移出圖形或 Tab 進入數字連結時保留同一 Sprint；讀值內有 focus 時 hover 不搶走內容。觀測點採單一 roving tab stop，左右鍵換 Sprint、Tab 進讀值、Escape 或「收合讀值」關閉。Sprint 選取使用淡色直向底帶、細直線與 X 軸名稱膠囊，不再框住整個互動區；純 hover 只顯示細線，點擊／觸控與鍵盤選取才顯示底帶＋膠囊。手機也顯示所選中間 Sprint 名稱，長名稱省略但讀值保留全文；Escape 後鍵盤 focus 留在 target 時仍有小型軸底線提示。底帶不改資料高度／顏色；列印恢復普通軸名稱、不印互動裝飾。每區「查看數據表」可展開核對；手機讀值完整顯示、表格僅局部捲動。
- 有底線的 SP／Actual SP／張數、比率與已填／未填張數可另開 Jira，使用**本次結果相同 metric selector 選出的完整 Issue IDs**，不重查更寬的 Project／Sprint／Team 範圍。負載率／完成率 百分比連全部 Dev-Task；品質百分比連 Bug＋Dev 比較母體（公式仍是 Bug／Dev）；分子與分母各有連結。已填／未填按各自 point field 分集合，完整率連該指標母體。
- 有效 0 且集合非空可連；空集合、缺值占位或沒有 Jira origin 不連。來源總數含未完整保留的母票、軸刻度與日期不是可對帳指標，不製造連結。清單超過集中 raw JQL 32,000 字元時顯示說明並保留完整本站明細，不截取或放寬；不另設 encoded-URL 上限或批次選單。Jira 自行依目前權限顯示現值，可能與本次分析不同。
- 所有 X／Y 軸趨勢圖（產出、負載率／完成率、品質及任務類型曲線，包含 SP／Actual SP 堆疊長條）以等寬 Sprint 區間置中，首尾各保留半格。曲線與標記、長條組、Sprint 名稱、選取底帶／膠囊、十字線與點擊區域共用 `lib/chart-band-layout.ts` 座標，不在首尾各自偏移或裁切；系列端點名稱跟隨最後資料點。窄圖的長條與名稱隨區間縮寬／省略，完整 Sprint 名稱保留在互動名稱及膠囊 title；無座標軸的任務分布及甜甜圈不受影響。
- 圖例、線鍵與 marker 形狀／線型固定，堆疊模式團隊圖例增加 fill key、總量保留 line key，長條沿固定團隊順序排列；桌面不碰撞時顯示端點名稱，堆疊模式只標總量端點。堆疊段以 surface gap 分隔，不放大微小量；列印／forced-colors 以固定方向／間距紋理、圖例與完整數據表補足辨識，一般模式不開紋理。列印／forced-colors 不只靠色彩識別，列印顯示全部五個主題、摘要與核對表（包含未選取主題）；forced-colors 螢幕仍只顯示目前主題。Light／dark 各有七色 token；light 部分色對表面 contrast 有警告，以形狀、線型、文字與表格補充，不能僅凭顏色區分。
- **目前未完成清單**：新結果預選最新 Sprint，直接在圖下方列出其未完成工作單；點擊（或 Enter／Space）可改選其他 Sprint。SP 預設，含 QA-Task 預設勾選，隱藏受阻母票預設不勾。取消含 QA-Task 排除 QA 工作單；隱藏受阻母票只精確排除母票狀態為 `Request Info`，不連帶排除 Pending／Reproduce／未知狀態，也不看子票狀態。兩條件僅影響此主題，圖表、清單、單 Sprint 摘要及數字連結共用同一 filtered cohort，不改 server summary 或查詢範圍。切換單位／篩選保留所選 Sprint；手動清除後不因重繪而重選。欄位固定依序為母票 Type Icon、母票狀態、Ticket、Summary、工作單狀態、Assignee、SP；窄畫面於清單內橫向捲動，Summary 可換行。判定仍是母票 Sprint membership＋現行 Resolved 空白，不依母票或工作單狀態；0 與未填 SP 都保留，切成張數不改清單的 SP 欄。取消 Sprint 選取後顯示全部已選 Sprint 的未完成工作單合併清單，依 Issue ID 去重、不直接相加各 Sprint 的重複票；仍套用 QA／Request Info 篩選並保留排序。圖表保留各 Sprint 曲線，不重新選取。空 Sprint／空合併清單顯示無未完成票提示。母票類型來自既有母票查詢的已驗證資料，舊 DTO 缺欄只顯示未知圖示，不猜票種、不另查 Jira。
- **估點偏差率**位於負載率／完成率右側，沿用最新 Sprint 預選與同一 X 軸置中規則；圖下提供每 Sprint 的符合條件張數、SP、Actual SP、差值核對及本站明細。圖表／數字／Jira 連結／明細共用 paired Dev-Task selector，不受其他主題的 QA／受阻／未完成篩選影響。圖表改以偏差率（百分比）繪製，仍使用對稱正負範圍與零基線（負值＝低估）。圖上方有 **全團隊總覽／各團隊偏差率** 切換（單一團隊範圍時為全成員總覽／各成員偏差率，與總產出同一規則）。全團隊總覽繪製全範圍加總曲線；各團隊偏差率每團隊一線、各成員偏差率每成員一線（**0 張的團隊／成員不列入表格與圖表**），圖例可逐一隱藏／恢復（獨立於其他主題的團隊清單）。下方的核對表跟隨圖上的 Sprint 選擇：**已選 Sprint 時只列該 Sprint**，**未選 Sprint 時列出每個 Sprint 並附「全部 Sprint 加總」列**；各團隊／各成員模式則每一列即為該團隊／成員在該範圍（已選 Sprint 或全部 Sprint 加總）的合計。團隊歸屬無法取得時切換停用，只顯示全團隊加總。表格為純數據，不提供明細連結。全團隊總覽與全成員總覽在表格下方再繪製一張**各 Dev Type 偏差率**趨勢圖（同一公式、同一 Sprint 範圍；只用 Dev-Task，沒有符合工作單的類型不列），圖例可逐一隱藏；各團隊／各成員偏差率不顯示此圖。
- 母票狀態顏色直接使用 `lib/status-color.ts` 的全站規範：In Progress／In Review 藍、Done 綠，其餘中性。母票狀態欄可依序切換原序→名稱升冪→降冪→原序；未知固定末尾，同狀態以 Ticket／ID 決勝。排序只作用於顯示副本，切單位／篩選保留排序方向，不改圖表數字、原工作單資料或 Sprint 選取。
- 「本站明細」為數字連結旁的獨立次要操作：Issue／母票、Project、Dev／QA type、Dev Type、雙點數、完整 Resolved 日與負責人。不另查 Jira、不改 URL、不提供編輯；手機使用工作單卡片。明細標題張數連該完整集合，單票點數連該票的 Jira 頁面。

### URL 與舊入口
- 未知／重複單值參數、無效 Project／Sprint、外專案 Sprint、舊日期條件均 fail closed，不退到預設或本人。URL 包含隱藏 Sprint（含有效＋無效混選）會停用查詢；只有明確重新選取才移除不可用舊 ID。
- 舊單一 `mode=sprints` 可還原，新 URL 不帶 mode。
- 舊日期 URL 不自動跳頁：錯誤＋手動移至團隊分析連結。完整合法 `mode=dates`＋Project／from／to 保留條件；無效、重複、未知或混合條件只連乾淨 `/analytics/story-points`，不搬部分範圍。抵達後仍不自動分析。
- 舊 `/analytics/trends`、`/analytics/comparison` 根及已知子頁別名仍單跳 **307** 到 Projects，保留全部 query 值後再由目的頁驗證；未知子路徑與 API 不變。

## 共同母體與指標公式
每個 Sprint 的母體 **P** 是所選 **Project＋Sprint** 的 Story／Task／Bug 母票下之 **Dev-Task＋QA-Task Sub-task**，Sprint membership 沿母票取得。母票點數不計；Team 條件作用於工作單現行 assignee。所有指標都不擴張 P。

| 指標 | 定義與單位 |
| --- | --- |
| 總產出 | P 中 Resolved 日在 Sprint 起日至迄日（含兩端）的工作單；SP 與 Actual SP 各自加總，並列張數。 |
| 任務類型 | 與總產出同批，按 Dev Type 分 Pre-Spike／Spike／Dev／Bug／OP-Task／OP-Bug，另列未分類；各列 SP、Actual SP、張數，不合併 OP。 |
| 完成率 | **Issue Type = Dev-Task**（所有 Dev Type）的區間內完成 SP／該 Sprint 全部 Dev-Task SP。分母無完成／日期限制，不是 Dev Type=Dev，不是起始承諾快照。顯示分子、分母與各自已填／缺估張數。 |
| 估點偏差率 | P 中 Resolved 日期在 Sprint 起迄日內、Issue Type=Dev-Task，且 SP／Actual SP 均非空的同一批工作單，逐張加總 **Σ(SP−Actual SP)**，並換算 **偏差率 = (ΣSP − ΣActual SP) ÷ ΣSP**。圖表以偏差率（百分比）繪製；表格同時保留 SP−Actual SP 點數差與偏差率。正值高估、負值低估。0 有效；ΣSP 為 0 或缺值、或無符合工作單時偏差率為「—／不適用」，不補 0。不因目前 Done 或受阻母票補成完成，不納入 QA-Task 或單欄缺值。 |
| 目前未完成 | P 中**現行 Resolved 空白**者的張數／SP，不考慮 Sprint 日期區間。迄日後才完成者不算目前未完成，也不算當期產出。 |

區間外完成另列張數與 SP 方便對帳；完成類型含未分類可回加到產出。各 Sprint 內同一 ID 只算一次；同票可屬多個 Sprint，**不提供跨 Sprint 相加的假想唯一總產出**。

## 總產出團隊歸屬
- 使用現行 assignee 與 server 完整群組資料，不重建歷史團隊。選 Team 只在選取群組分類；未選 Team 則使用全部 13 個設定群組分類，**不改成群組成員聯集母體**。重疊帳號依固定設定順序、後者優先，每票恰歸一隊；未指派／未屬候選隊者歸「其他」，不丟票。沒有當期工作的候選團隊仍在完整核對表顯示 0；圖表／圖例依目前點數單位排除所有已選 Sprint 都完整為 0 的團隊，不更改查詢母體或原始數值。
- 選取 Team 的篩選聯集與歸屬來自同一完整 lookup pass，原有空聯集／1,000-member scope 上限不變。未選 Team 的純顯示分類不套用 scope union 資格，但保留每組完整分頁／1,000 source 上限、四 worker、viewer/cloud/group cache 與原 120 秒期限；空 tasks 不增加 roster I/O。
- DTO 保留 `schemaVersion: 1`，增加 `teamAttribution`：available 僅含本次工作單出現的非 null 帳號及其唯一 teamId，不含完整名單／姓名／額外帳號；parser 驗證候選群組、account ID、重複及缺少／額外帳號，selected scope 禁止 Other／null-assignee。舊結果缺 extension 正規化為 unavailable/not_provided。
- 選 Team 的完整成員查詢失敗仍使分析失敗。未選 Team 的分類專用 membership 失敗則丟棄全部部分歸屬、標示 unavailable/lookup_failed，保留完整分析及其他指標；停用「顯示總量」，顯示必要提示與全範圍產出（仍可切點數），不假造 Other／團隊曲線。取消、總期限、身分／憑證／reauthorization／configuration 錯誤不會吞成分類不可用。
- 13 隊＋其他以七組固定 hue／shape 配合實線／長虛線區分，合計採中性色／另一虛線；不依可見排名換色。列印保留目前單位／可見曲線與完整團隊核對表。

## 日期、缺值與限制
- Resolved 使用 REST `resolutiondate` 嚴格 timestamp／offset 解析，依與 search 同身分的 `/myself` 所驗證 Jira 帳號時區分桶。缺少／錯誤身分或時區報錯，無 fallback。不用 `updated`、Done transition、60 日截點、末日夾值或受阻母票覆寫。
- Resolved 的共用日曆投影明確使用 Gregorian 公曆（`calendar: "gregory"`）及 `formatToParts()`，避免 ISO formatter 在不同 Node／ICU 版本省略年代欄位造成誤拒。最終帳號日期限定西元 0001–9999 年；越界報錯，UTC instant 暫時越界但帳號日期合法則仍可分析。
- API 只收 browser IANA timezone，不收 client today／起迄日；**server clock** 重算今天並從設定驗證已結束 Sprint。Browser eligibility timezone 與 Jira 完成 timezone 是兩個不同用途，均保留在 API 結果中，不在畫面另列說明。
- SP／Actual 分開 nullable；**0 是有效值**，不互補。空母體為 0；有票但全未填為「—／未填」；部分已填顯示已知總和、已填／未填數及完整率。未回傳必要欄位不是 null，會整筆失敗。
- 比率分母 0／全未填顯示「—／不適用」；部分缺值標示已填點數比。不產生 NaN／Infinity、不夾 100%；保留來源精度，先聚合再於呈現時四捨五入。
- 全查詢最多 **5,000 張唯一來源 Issue（母票＋工作單）**，跨 Sprint 重複母票只計一次。任何 metadata、scope、分頁、關係驗證或總量上限失敗皆不交付部分成功數字。
- Sub-task 通常與母票同 Project，TKK／SUN 壓力可能等於母體 SP；PRIDE 可能為 0。不為「補數字」查全站 TKK／SUN。
- 欄位、父子關係、Sprint membership、指派與 Resolved 是**查詢當下現值**；重查歷史 Sprint 可能變動。完整分頁也不是原子歷史快照；API 結果保留查詢起迄時間。畫面不再顯示已套用條件、查詢時間／來源數量、時區及現值／Jira 連結的整段說明，保留缺值、空母體與無法完整建立 Jira 查詢等必要提示。
- 不同角色、估點尺度、出勤與工作母體不能直接橫比。本版不接 Capacity、歷史 changelog 或匯出。

## Jira 資料流與安全
1. 本站唯讀 `POST /api/analytics/projects/query`，same-origin、實際 JSON body ≤16 KiB，請求僅 `{ project, sprintIds, groups, browserTimeZone }`；未知欄位、JQL、client account IDs／issue IDs／日期／覆寫均拒絕。
2. Route／service 驗證登入；共用完整群組 scope 與現有 cache，無效或空聯集 fail closed。以同份驗證 credentials 讀 metadata、`/myself` 與 search，不增加 OAuth scopes。
3. Runtime 以固定 ID 驗證三欄位的 schema、project scope，不要求顯示名稱完全一致。Dev／QA 票種 discovery 忽略名稱大小寫與首尾空白，驗證唯一適用的 Sub-task issue-type IDs；工作單以這些 IDs 判斷票種並輸出標準 Dev-Task／QA-Task 標籤，不再比對顯示名稱。Story／Task／Bug 母票名稱分類同樣忽略大小寫與首尾空白。malformed scoped 候選不能被丟掉後 fallback global。
4. `projectsAnalysisParentIssuesJql()` 完整組 Project＋Sprint 母票；`projectsAnalysisChildQueries()` 完整組分批 parent IDs＋Dev／QA type IDs＋選填 server assignee IDs，不加 Resolved 或 Dashboard near-N 條件。
5. 共用 `searchJiraIssues` 的 enhanced POST search，完整驗證 duplicate IDs、cursor、terminal evidence 與分頁限制；各 Sprint parents 完整取得，再讀 parent 聯集 children，嚴格驗父子鏈、Project／type／數字與必要欄位。
6. 成功回傳完整 DTO／摘要／去重工作單，不傳 raw Jira objects、token 或完整會員名單。成功／錯誤均 `Cache-Control: private, no-store`、`Vary: Cookie`。
7. Browser fetch 可 abort；server 在 lookup／page／batch 邊界檢查取消與期限，停止後續讀取。不承諾既有 shared transport 的在途 Jira request 立即中止。

所有本功能 Jira 操作為唯讀 GET／搜尋 POST，沒有 issue PUT／PATCH／DELETE。本地 mock 測試不代表已驗證 live Jira 資料或部署。

## 程式來源
- [頁面](../../app/(app)/analytics/projects/page.tsx)、[篩選](../../app/(app)/analytics/projects/projects-filter.tsx)、[query lifecycle](../../app/(app)/analytics/projects/projects-query-client.tsx)、[結果／明細](../../app/(app)/analytics/projects/projects-analysis-view.tsx)
- [SVG 趨勢／分布圖](../../app/(app)/analytics/projects/projects-trend-chart.tsx)、[純幾何／有界曲線](../../app/(app)/analytics/projects/projects-trend-geometry.ts)、[圖表樣式](../../app/(app)/analytics/projects/projects-analysis.css)
- [URL 解析／搬移](../../lib/projects-filter.ts)、[模型／統計／DTO](../../lib/projects-analysis.ts)、[Jira service](../../lib/jira-projects-analysis.ts)、[API](../../app/api/analytics/projects/query/route.ts)
- [集中 JQL](../../lib/jira-jql.ts)、[集中欄位](../../lib/jira-fields.ts)、[驗證帳號時區](../../lib/jira-account-timezone.ts)、[完整 Resolved 日期](../../lib/burndown-completion.ts)
