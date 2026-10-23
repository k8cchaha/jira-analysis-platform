"use client"

import { useState } from "react"
import type { SprintProjectKey } from "@/lib/jira-jql"

/** 每格 Capacity 彈窗下方 table 的一列：成員的請假與可用點數。 */
interface MemberRow {
  /** 成員名 */
  name: string
  /** 請假時數（小時） */
  leave: number
  /** 可用的點數 */
  points: number
}

interface TeamCapacity {
  /** 團隊名稱（Android / Backend / iOS / Web / QA / Design…）。 */
  team: string
  /** 該團隊此 Sprint 是否已填寫 Capacity（綠＝已填，紅＝未填）。 */
  filled: boolean
  /** 該團隊填寫的 Capacity 數值（顯示於團隊名稱下方）。 */
  capacity: number
  /** 團隊總請假天數（統計用，顯示於 Capacity 標題的「N天假期」）。 */
  leaveDays: number
  /** 成員明細（彈窗下方 table）。 */
  members: MemberRow[]
}

/** 每人滿額可用的點數：一個 Sprint 10 天 × 一天 2 點。 */
const FULL_CAPACITY_POINTS = 20

/** 依規則計算每人「可用的點數」＝ 20 − 請假時數 × 0.25（請假一天扣 2 點）。 */
function availablePoints(leaveHours: number): number {
  return Math.max(0, FULL_CAPACITY_POINTS - leaveHours * 0.25)
}

/**
 * 假資料的「登入者所屬團隊」：目前把登入使用者視為 Web、QA 兩隊成員，
 * 因此點擊這兩隊可編輯請假時數。未來改由真實的群組成員 API 提供。
 */
const VIEWER_MEMBER_TEAMS = new Set(["Web", "QA"])

/**
 * 假資料：未來會改由 API 依 project＋sprint 回傳每個團隊的 Capacity 填寫狀態
 * 與成員明細。各專案的團隊種類略有不同（例如 PRIDE 沒有 Design）。
 *
 * Capacity 計算規則：一個 Sprint 共 10 天，一天＝2 點 ⇒ 每人滿額可用的點數＝20；
 * 請假 1 天（8 小時）扣 2 點。故每人「可用的點數」＝ 20 − 請假時數 × 0.25；
 * 團隊的 `capacity`（已填時）＝ 成員可用點數總和，`leaveDays`＝團隊請假時數 ÷ 8。
 * 未填寫的團隊 `capacity` 與成員點數皆為 0。
 */
const MOCK_CAPACITY: Record<SprintProjectKey, readonly TeamCapacity[]> = {
  SUN: [
    {
      team: "Android", filled: true, capacity: 58, leaveDays: 1,
      members: [
        { name: "Alice", leave: 8, points: 18 },
        { name: "Bob", leave: 0, points: 20 },
        { name: "Cindy", leave: 0, points: 20 },
      ],
    },
    {
      team: "Backend", filled: false, capacity: 0, leaveDays: 0,
      members: [
        { name: "David", leave: 0, points: 0 },
        { name: "Eve", leave: 0, points: 0 },
      ],
    },
    {
      team: "iOS", filled: true, capacity: 38, leaveDays: 1,
      members: [
        { name: "Frank", leave: 8, points: 18 },
        { name: "Grace", leave: 0, points: 20 },
      ],
    },
    {
      team: "Web", filled: false, capacity: 0, leaveDays: 0,
      members: [
        { name: "Henry", leave: 0, points: 20 },
        { name: "Ivy", leave: 0, points: 20 },
      ],
    },
    {
      team: "QA", filled: true, capacity: 40, leaveDays: 0,
      members: [
        { name: "Jack", leave: 0, points: 20 },
        { name: "Ken", leave: 0, points: 20 },
      ],
    },
    {
      team: "Design", filled: false, capacity: 0, leaveDays: 0,
      members: [
        { name: "Lily", leave: 0, points: 0 },
      ],
    },
  ],
  TKK: [
    {
      team: "Android", filled: true, capacity: 38, leaveDays: 1,
      members: [
        { name: "Mina", leave: 8, points: 18 },
        { name: "Naomi", leave: 0, points: 20 },
      ],
    },
    {
      team: "Backend", filled: true, capacity: 40, leaveDays: 0,
      members: [
        { name: "Oscar", leave: 0, points: 20 },
        { name: "Peggy", leave: 0, points: 20 },
      ],
    },
    {
      team: "iOS", filled: false, capacity: 0, leaveDays: 0,
      members: [
        { name: "Quinn", leave: 0, points: 0 },
      ],
    },
    {
      team: "Web", filled: true, capacity: 38, leaveDays: 1,
      members: [
        { name: "Ray", leave: 8, points: 18 },
        { name: "Sara", leave: 0, points: 20 },
      ],
    },
    {
      team: "QA", filled: true, capacity: 40, leaveDays: 0,
      members: [
        { name: "Tom", leave: 0, points: 20 },
        { name: "Uma", leave: 0, points: 20 },
      ],
    },
    {
      team: "Design", filled: false, capacity: 0, leaveDays: 0,
      members: [
        { name: "Vera", leave: 0, points: 0 },
      ],
    },
  ],
  PRIDE: [
    {
      team: "Android", filled: true, capacity: 38, leaveDays: 1,
      members: [
        { name: "Wade", leave: 8, points: 18 },
        { name: "Xena", leave: 0, points: 20 },
      ],
    },
    {
      team: "Backend", filled: false, capacity: 0, leaveDays: 0,
      members: [
        { name: "Yuki", leave: 0, points: 0 },
      ],
    },
    {
      team: "iOS", filled: true, capacity: 40, leaveDays: 0,
      members: [
        { name: "Zoe", leave: 0, points: 20 },
        { name: "Aaron", leave: 0, points: 20 },
      ],
    },
    {
      team: "Web", filled: true, capacity: 38, leaveDays: 1,
      members: [
        { name: "Betty", leave: 8, points: 18 },
        { name: "Carl", leave: 0, points: 20 },
      ],
    },
    {
      team: "QA", filled: false, capacity: 0, leaveDays: 0,
      members: [
        { name: "Dana", leave: 0, points: 0 },
      ],
    },
    // Design 缺席：不同專案顯示的團隊略異。
  ],
}

/**
 * Planning Filter 下方的 Capacity 列：以按鈕形式顯示各團隊此 Sprint 的 Capacity
 * 填寫狀態（綠＝已填、紅＝未填）。目前用假資料，未來改接 API。點擊團隊按鈕彈出
 * 該團隊的 Capacity 明細彈窗；若點擊者是該團隊成員則可編輯請假時數（保存/取消）。
 * 右側另放一顆 Sprint Note 按鈕（同樣未來接 API），故團隊按鈕不延伸佔滿整排。
 */
export function CapacityPanel({
  project,
  viewerAccountId,
}: {
  project: SprintProjectKey
  viewerAccountId: string
}) {
  const [teams, setTeams] = useState<readonly TeamCapacity[]>(() => MOCK_CAPACITY[project] ?? [])
  const [openTeamName, setOpenTeamName] = useState<string | null>(null)
  const totalLeaveDays = teams.reduce((sum, t) => sum + t.leaveDays, 0)
  const openTeam = teams.find((t) => t.team === openTeamName) ?? null

  // 此登入者能否編輯該隊：假資料暫以 VIEWER_MEMBER_TEAMS 判斷是否為成員。
  const isViewerMember = (team: TeamCapacity): boolean =>
    VIEWER_MEMBER_TEAMS.has(team.team)

  /** 保存：依編輯後的成員重算 capacity／leaveDays（依 20 點規則），寫回 state。 */
  function handleSave(teamName: string, members: MemberRow[]) {
    const updated = members.map((m) => ({ ...m, points: availablePoints(m.leave) }))
    const capacity = updated.reduce((sum, m) => sum + m.points, 0)
    const leaveDays = updated.reduce((sum, m) => sum + m.leave, 0) / 8
    setTeams((prev) =>
      prev.map((t) =>
        t.team === teamName ? { ...t, members: updated, capacity, leaveDays } : t
      )
    )
    setOpenTeamName(null)
  }

  return (
    <section
      aria-label="Capacity"
      className="relative mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <h2 className="absolute left-4 top-0 -translate-y-1/2 bg-white px-1 text-lg font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-300">
        Capacity
        <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">（{totalLeaveDays} 天假期）</span>
      </h2>
      <div className="flex flex-wrap items-start justify-between gap-4 p-5 pt-6">
        <div className="flex flex-wrap gap-2">
          {teams.map((team) => (
            <button
              key={team.team}
              type="button"
              aria-label={`${team.team} ${team.filled ? "已填寫" : "尚未填寫"} Capacity（${team.capacity}）${isViewerMember(team) ? "，可編輯" : ""}`}
              onClick={() => setOpenTeamName(team.team)}
              className={`flex h-16 w-28 flex-col items-center justify-center gap-0.5 rounded-lg border text-sm font-medium ${
                team.filled
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-300"
                  : "border-red-500 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-600 dark:bg-red-950/30 dark:text-red-300"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${team.filled ? "bg-emerald-500 dark:bg-emerald-400" : "bg-red-500 dark:bg-red-400"}`}
                />
                {team.team}
                {isViewerMember(team) && (
                  <span className="text-[10px] font-normal text-slate-400 dark:text-slate-500">（測試編輯）</span>
                )}
              </span>
              <span className="text-xs leading-none text-inherit">
                {team.filled ? team.capacity : "—"}
              </span>
            </button>
          ))}
        </div>
        <SprintNoteButton />
      </div>
      {openTeam && (
        <CapacityDialog
          team={openTeam}
          editable={isViewerMember(openTeam) && viewerAccountId !== ""}
          onSave={(members) => handleSave(openTeam.team, members)}
          onClose={() => setOpenTeamName(null)}
        />
      )}
    </section>
  )
}

/** 團隊 Capacity 的明細彈窗：上方團隊名稱，下方 table 顯示成員明細。可編輯時欄位變數字輸入，底部有保存/取消。 */
function CapacityDialog({
  team,
  editable,
  onSave,
  onClose,
}: {
  team: TeamCapacity
  editable: boolean
  onSave: (members: MemberRow[]) => void
  onClose: () => void
}) {
  // 草稿：編輯中的請假時數（保留名稱、依規則即時重算點數）。
  const [draft, setDraft] = useState<MemberRow[]>(() =>
    team.members.map((m) => ({ ...m }))
  )

  // 是否曾改動（供「更新」按鈕啟用判定）：與原始成員的請假時數逐一比對。
  const dirty =
    draft.length === team.members.length &&
    draft.some((m, i) => m.leave !== team.members[i].leave)

  function setLeave(index: number, value: string) {
    const hours = Number(value)
    const leave = Number.isFinite(hours) && hours >= 0 ? hours : 0
    setDraft((prev) =>
      prev.map((m, i) =>
        i === index ? { ...m, leave, points: availablePoints(leave) } : m
      )
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${team.team} Capacity`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">
            {team.team}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!editable && !team.filled ? (
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            此團隊尚未填寫本 Sprint 的 Capacity。
          </div>
        ) : draft.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-500 dark:text-slate-400">此團隊尚無成員明細。</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
            <table className="w-full table-fixed text-left text-sm">
              <caption className="sr-only">{team.team} 的 Capacity 成員明細</caption>
              <thead className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th scope="col" className="w-[38%] py-2 font-medium">成員名單</th>
                  <th scope="col" className="w-[31%] py-2 text-right font-medium" title="請假時數">請假時數（小時）</th>
                  <th scope="col" className="w-[31%] py-2 text-right font-medium">可用的點數</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {draft.map((m, index) => (
                  <tr key={m.name} className="align-top">
                    <td className="break-words py-2.5 text-slate-700 dark:text-slate-200">{m.name}</td>
                    <td className="py-2.5 text-right">
                      {editable ? (
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={m.leave}
                          onChange={(e) => setLeave(index, e.target.value)}
                          aria-label={`${m.name} 的請假時數`}
                          className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-center tabular-nums text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                        />
                      ) : (
                        <span className="tabular-nums text-slate-600 dark:text-slate-300">{m.leave}</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{m.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(editable || !team.filled) && (
          <div className="flex items-center justify-between gap-4 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
            {!team.filled ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
                <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
                尚未提交
              </span>
            ) : (
              <span aria-hidden="true"></span>
            )}
            {editable && (
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={team.filled && !dirty}
                  onClick={() => onSave(draft)}
                  className="rounded-lg border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:border-slate-300 dark:border-blue-500 dark:bg-blue-500 dark:hover:bg-blue-600 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                >
                  {team.filled ? "更新" : "提交"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Sprint Note 按鈕：目前是假的（直接顯示一個唯讀 note 彈窗），未來改由 API
 * 依 project＋sprint 取得該 Sprint 的註記內容。
 */
function SprintNoteButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-16 w-28 flex-row items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium leading-tight text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
        <span className="flex flex-col items-start">
          <span>Sprint</span>
          <span>Note</span>
        </span>
      </button>
      {open && <SprintNoteDialog onClose={() => setOpen(false)} />}
    </>
  )
}

/** 假資料的 Sprint Note 彈窗：未來會改由 API 取得實際註記。 */
function SprintNoteDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sprint Note"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">Sprint Note</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          目前無此 Sprint 的註記。（假資料，未來由 API 提供）
        </p>
      </div>
    </div>
  )
}