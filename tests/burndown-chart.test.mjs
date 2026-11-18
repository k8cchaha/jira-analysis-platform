import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { projectsHarness, BURNDOWN_CHART, nodes } from "./helpers/projects-analysis-harness.mjs"

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} vs ${expected}`)
const commands = (path) => [...path.matchAll(/([ML])([-\d.e+]+),([-\d.e+]+)/g)].map((match) => ({ kind: match[1], x: Number(match[2]), y: Number(match[3]) }))
function fixture(count = 7, missing = []) {
  const h = projectsHarness(), Component = h.load(BURNDOWN_CHART).BurndownChart, calls = []
  const days = Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(2026, 9, 12 + index)).toISOString().slice(0, 10),
    idealPoints: 100 * (1 - index / Math.max(1, count - 1)),
    remainingPoints: missing.includes(index) ? null : Math.max(0, 100 - index * 10),
    donePoints: index === 0 ? 10 : missing.includes(index) ? 0 : 2,
    blockedPoints: index === count - 1 && !missing.includes(index) ? 3 : 0,
  }))
  const props = { days, totalPoints: 100, showLine: true, showBar: true, onBarClick: (...args) => calls.push(args) }
  return { days, props, calls, draw: () => h.invoke(Component, props) }
}
const svgOf = (tree) => nodes(tree).find((node) => node.type === "svg")
const idealOf = (tree) => nodes(tree).find((node) => node.type === "path" && node.props.className === "text-slate-400 dark:text-slate-500")
const actualOf = (tree) => nodes(tree).find((node) => node.type === "path" && node.props.className === "text-rose-600 dark:text-rose-400")
const barsOf = (tree) => nodes(svgOf(tree)).filter((node) => node.type === "rect")

describe("Burndown chart band alignment", () => {
  it("centers ideal/actual lines, bars and dates inside equally spaced buckets, including the opening cell", () => {
    for (const count of [2, 7, 61]) {
      const { days, draw } = fixture(count), tree = draw(), bucketWidth = 660 / count
      const ideal = commands(idealOf(tree).props.d), actual = commands(actualOf(tree).props.d)
      assert.equal(ideal.length, count)
      assert.equal(actual.length, count)
      close(ideal[0].x - 44, 704 - ideal.at(-1).x)
      for (let index = 0; index < count; index++) {
        close(ideal[index].x, 44 + (index + .5) * bucketWidth)
        close(actual[index].x, ideal[index].x)
        const bars = barsOf(tree).filter((bar) => Math.abs(bar.props.x + bar.props.width / 2 - ideal[index].x) < 1e-8)
        assert.ok(bars.length > 0, "each nonempty day retains its bar at the line sample")
        for (const bar of bars) {
          assert.ok(bar.props.width > 0 && bar.props.width <= 24)
          assert.ok(bar.props.x >= 44 + index * bucketWidth - 1e-8)
          assert.ok(bar.props.x + bar.props.width <= 44 + (index + 1) * bucketWidth + 1e-8)
        }
      }
      const labels = nodes(tree).filter((node) => node.type === "text" && node.props.className === "fill-slate-500 text-[10px] dark:fill-slate-400")
      assert.ok(labels.length > 0)
      assert.ok(labels.every((label) => label.props.children !== days[0].date.slice(5)), "the start-minus-one opening cell still has no date label")
      for (const label of labels) {
        const index = days.findIndex((day) => day.date.slice(5) === label.props.children)
        close(label.props.x, ideal[index].x)
        assert.equal(label.props.textAnchor, "middle")
      }
      for (const viewport of [160, 320, 720]) {
        const scale = viewport / 720
        close((ideal[0].x - 44) * scale, (704 - ideal.at(-1).x) * scale)
        assert.ok(barsOf(tree).every((bar) => bar.props.x * scale >= 44 * scale && (bar.props.x + bar.props.width) * scale <= 704 * scale + 1e-8))
      }
    }
  })
  it("keeps missing/future samples in their original buckets and breaks actual paths without changing data", () => {
    const { days, draw } = fixture(7, [2, 3, 6]), before = JSON.stringify(days), tree = draw()
    const actual = commands(actualOf(tree).props.d), ideal = commands(idealOf(tree).props.d)
    assert.deepEqual(actual.map((point) => point.kind), ["M", "L", "M", "L"])
    assert.deepEqual(actual.map((point) => point.x), [0, 1, 4, 5].map((index) => ideal[index].x))
    close(actual[0].y, 16)
    assert.equal(JSON.stringify(days), before)
    for (const index of [2, 3, 6]) assert.ok(!barsOf(tree).some((bar) => Math.abs(bar.props.x + bar.props.width / 2 - ideal[index].x) < 1e-8))
  })
  it("preserves mouse/keyboard opening, done and blocked callbacks and immediate tooltip values", () => {
    const { days, calls, draw } = fixture(3), groups = nodes(draw()).filter((node) => node.props.role === "button")
    const opening = groups.find((group) => group.key === days[0].date)
    const done = groups.find((group) => group.key === `${days[1].date}-done`)
    const blocked = groups.find((group) => group.key === `${days[2].date}-blocked`)
    for (const group of [opening, done, blocked]) {
      group.props.onClick()
      group.props.onKeyDown({ key: "Enter", preventDefault() {} })
      group.props.onKeyDown({ key: " ", preventDefault() {} })
    }
    assert.deepEqual(calls, [
      ...Array(3).fill([days[0].date, true]),
      ...Array(3).fill([days[1].date]),
      ...Array(3).fill([days[2].date, undefined, true]),
    ])
    blocked.props.onMouseMove({ clientX: 100, clientY: 80 })
    const tooltip = nodes(draw()).find((node) => node.props.role === "tooltip")
    assert.match(renderToStaticMarkup(tooltip), /受阻 3 點/)
    blocked.props.onMouseLeave()
    assert.equal(nodes(draw()).find((node) => node.props.role === "tooltip"), undefined)
  })
  it("retains the showLine/showBar switches and the fewer-than-two-days empty state", () => {
    const { props, draw } = fixture(7)
    props.showLine = false; props.showBar = false
    assert.ok(idealOf(draw()))
    assert.equal(actualOf(draw()), undefined)
    assert.deepEqual(barsOf(draw()), [])
    for (const count of [0, 1]) {
      const tree = fixture(count).draw()
      assert.equal(svgOf(tree), undefined)
      assert.match(renderToStaticMarkup(tree), /Sprint 天數不足/)
    }
  })
})
