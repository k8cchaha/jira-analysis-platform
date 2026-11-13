import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { describe, it } from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const sourceUrl = new URL("../app/(app)/analytics/projects/projects-trend-geometry.ts", import.meta.url)
const { outputText, diagnostics } = ts.transpileModule(readFileSync(sourceUrl, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true },
  fileName: sourceUrl.pathname,
  reportDiagnostics: true,
})
assert.equal(diagnostics.length, 0)
const exports = {}
vm.runInNewContext(outputText, { exports }, { filename: sourceUrl.pathname })
const { cleanAxisMaximum, buildTrendGeometry, buildStackGeometry } = exports
const plain = (value) => JSON.parse(JSON.stringify(value))

function commands(path) {
  return [...path.matchAll(/([MLC]) ([^MLC]+)/g)].map((match) => ({
    kind: match[1],
    coordinates: match[2].trim().split(/\s+/).map(Number),
  }))
}

function assertFiniteGeometry(geometry, width, height) {
  for (const point of geometry.points) {
    assert.ok(Number.isInteger(point.index) && point.index >= 0)
    assert.ok(Number.isFinite(point.x) && point.x >= 0 && point.x <= width)
    assert.ok(Number.isFinite(point.y) && point.y >= 0 && point.y <= height)
  }
  for (const path of geometry.paths) {
    assert.doesNotMatch(path, /NaN|Infinity/)
    for (const command of commands(path)) {
      assert.equal(command.coordinates.length, command.kind === "C" ? 6 : 2)
      command.coordinates.forEach((coordinate, index) => {
        assert.ok(Number.isFinite(coordinate))
        assert.ok(coordinate >= 0 && coordinate <= (index % 2 === 0 ? width : height))
      })
    }
  }
}

function assertRun(path, points) {
  const parts = commands(path)
  assert.equal(parts.length, points.length)
  assert.equal(parts[0].kind, "M")
  assert.deepEqual(parts[0].coordinates, [points[0].x, points[0].y])
  for (let index = 1; index < parts.length; index++) {
    const start = points[index - 1]
    const end = points[index]
    const part = parts[index]
    assert.equal(part.kind, points.length === 2 ? "L" : "C")
    assert.deepEqual(part.coordinates.slice(-2), [end.x, end.y])
    if (part.kind === "C") {
      const [c1x, c1y, c2x, c2y] = part.coordinates
      assert.ok(start.x <= c1x && c1x <= c2x && c2x <= end.x)
      for (const controlY of [c1y, c2y]) {
        assert.ok(controlY >= Math.min(start.y, end.y) && controlY <= Math.max(start.y, end.y))
      }
    }
  }
}

function assertMonotoneSegments(path, points) {
  const parts = commands(path)
  for (let index = 1; index < parts.length; index++) {
    const start = points[index - 1].y
    const end = points[index].y
    const [, c1, , c2] = parts[index].coordinates
    let previous = start
    for (let step = 1; step <= 100; step++) {
      const t = step / 100
      const inverse = 1 - t
      const y = inverse ** 3 * start + 3 * inverse ** 2 * t * c1 + 3 * inverse * t ** 2 * c2 + t ** 3 * end
      assert.ok(y >= Math.min(start, end) - 1e-10 && y <= Math.max(start, end) + 1e-10)
      assert.ok(end >= start ? y >= previous - 1e-10 : y <= previous + 1e-10)
      previous = y
    }
  }
}

describe("cleanAxisMaximum", () => {
  it("uses a positive 1/2/5 ceiling without changing source values", () => {
    for (const [value, expected] of [[1, 1], [1.01, 2], [3, 5], [6, 10], [14, 20], [24, 50], [.04, .05], [.2, .2]]) {
      const values = Object.freeze([null, value, 0])
      assert.equal(cleanAxisMaximum(values), expected)
      assert.deepEqual(values, [null, value, 0])
    }
  })

  it("ignores null and supplies a one-unit domain for empty/all-null/all-zero data", () => {
    for (const values of [[], [null], [null, null], [0], [0, null, 0]]) {
      assert.equal(cleanAxisMaximum(values), 1)
      assert.equal(cleanAxisMaximum(values, true), 1)
    }
  })

  it("keeps count domains integral and at least one", () => {
    for (const value of [Number.MIN_VALUE, .04, .5, 1, 1.2, 2, 3, 14, 99, Number.MAX_VALUE]) {
      const maximum = cleanAxisMaximum([null, value], true)
      assert.ok(Number.isFinite(maximum) && Number.isInteger(maximum))
      assert.ok(maximum >= 1 && maximum >= value)
    }
  })

  it("handles subnormal and near-overflow values without zero or infinite ceilings", () => {
    for (const value of [Number.MIN_VALUE, Number.MIN_VALUE * 2, 1e-323, 5e-323, 1e-320, 1e-308, 1e307, 1e308, 1.1e308, Number.MAX_VALUE]) {
      const maximum = cleanAxisMaximum([0, value, null])
      assert.ok(Number.isFinite(maximum) && maximum > 0 && maximum >= value)
      assertFiniteGeometry(buildTrendGeometry([0, value, null], maximum, 600, 240), 600, 240)
    }
    assert.equal(cleanAxisMaximum([Number.MAX_VALUE]), Number.MAX_VALUE)
  })

  it("rejects invalid statistics instead of treating them as missing or zero", () => {
    for (const value of [-1, -Number.MIN_VALUE, NaN, Infinity, -Infinity, undefined, "3"]) {
      assert.throws(() => cleanAxisMaximum([null, value]), /finite, non-negative/)
    }
  })
})

describe("buildStackGeometry", () => {
  it("retains fixed series order and matches the supplied total curve at every Sprint", () => {
    const values = [[2, 3, 1], [6, 0, 2], [4, null, 3]], totals = [12, 3, 6]
    const columns = buildStackGeometry(values, totals, 20, 400, 200)
    const curve = buildTrendGeometry(totals, 20, 400, 200)
    assert.equal(curve.paths.length, 1)
    assert.match(curve.paths[0], / C /)
    columns.forEach((column, index) => {
      assert.deepEqual(plain({ index: column.index, x: column.x, y: column.y }), plain(curve.points[index]))
      assert.equal(column.segments.at(-1).y, curve.points[index].y)
      assert.equal(column.segments.reduce((sum, segment) => sum + segment.value, 0), totals[index])
      assert.equal(column.segments[0].y + column.segments[0].height, 200)
    })
    assert.deepEqual(plain(columns[0].segments.map((s) => s.seriesIndex)), [0, 1, 2])
    assert.deepEqual(plain(columns[1].segments.map((s) => s.seriesIndex)), [0])
  })
  it("skips null totals without compressing Sprint slots and retains genuine zero observations", () => {
    const totals = [2, null, 0, null, 5]
    const columns = buildStackGeometry([[2, null, 0, null, 5], [0, 0, 0, 0, 0]], totals, 5, 400, 100)
    assert.deepEqual(plain(columns.map((c) => [c.index, c.x])), [[0, 0], [2, 200], [4, 400]])
    assert.equal(columns[1].height, 0)
    assert.deepEqual(plain(columns[1].segments), [])
    assert.equal(buildTrendGeometry(totals, 5, 400, 100).paths.length, 0)
    assert.deepEqual(plain(buildStackGeometry([[null], [0]], [null], 1, 300, 100)), [])
  })
  it("preserves tiny/decimal amounts rather than adding minimum pixel heights or fabricated residuals", () => {
    const columns = buildStackGeometry([[.1], [.2], [1e-8]], [.30000001], 1, 20, 200)
    const column = columns[0]
    assert.equal(column.x, 10)
    assert.equal(column.segments.length, 3)
    assert.deepEqual(plain(column.segments.map((s) => s.value)), [.1, .2, 1e-8])
    assert.ok(column.segments[2].height > 0 && column.segments[2].height < .001)
    assert.equal(column.segments[2].y, (1 - .30000001) * 200)
    assert.ok(Math.abs(column.segments.reduce((sum, s) => sum + s.height, 0) - column.height) < 1e-10)
  })
  it("centers one stack and accepts legal tiny and huge domains with finite coordinates", () => {
    for (const total of [Number.MIN_VALUE, 1e-300, 1, 1e300, Number.MAX_VALUE]) {
      const columns = buildStackGeometry([[total]], [total], total, 300, 100)
      assert.deepEqual(plain(columns), [{ index: 0, x: 150, y: 0, height: 100, segments: [{ seriesIndex: 0, value: total, y: 0, height: 100 }] }])
    }
  })
  it("fails mismatches, malformed inputs and overflow instead of normalizing or inventing totals", () => {
    assert.throws(() => buildStackGeometry([[1]], [1, 2], 5, 300, 100), /samples must match/)
    for (const value of [-1, NaN, Infinity, undefined, "2"]) assert.throws(() => buildStackGeometry([[value]], [1], 5, 300, 100), /finite, non-negative/)
    assert.throws(() => buildStackGeometry([[2]], [null], 5, 300, 100), /reconcile/)
    assert.throws(() => buildStackGeometry([[2]], [3], 5, 300, 100), /reconcile/)
    assert.throws(() => buildStackGeometry([[Number.MAX_VALUE], [Number.MAX_VALUE]], [Number.MAX_VALUE], Number.MAX_VALUE, 300, 100), /reconcile/)
    assert.throws(() => buildStackGeometry([], [], 0, 300, 100), /maximum/)
  })
})

describe("buildTrendGeometry", () => {
  it("returns no points or paths for empty/all-null input", () => {
    for (const values of [[], [null], [null, null, null]]) {
      assert.deepEqual(plain(buildTrendGeometry(values, 1, 300, 100)), { points: [], paths: [] })
    }
  })

  it("centers a singleton marker and never fabricates a path", () => {
    assert.deepEqual(plain(buildTrendGeometry([5], 10, 300, 100)), {
      points: [{ index: 0, x: 150, y: 50 }], paths: [],
    })
    assert.deepEqual(plain(buildTrendGeometry([0], 1, 300, 100)), {
      points: [{ index: 0, x: 150, y: 100 }], paths: [],
    })
  })

  it("keeps isolated markers at their original slots rather than compressing gaps", () => {
    assert.deepEqual(plain(buildTrendGeometry([null, 2, null, 0, null], 4, 400, 100)), {
      points: [{ index: 1, x: 100, y: 50 }, { index: 3, x: 300, y: 100 }], paths: [],
    })
  })

  it("uses an exact M/L path for two contiguous samples", () => {
    const geometry = buildTrendGeometry([0, 5], 10, 300, 100)
    assert.deepEqual(plain(geometry.points), [{ index: 0, x: 0, y: 100 }, { index: 1, x: 300, y: 50 }])
    assert.deepEqual(plain(geometry.paths), ["M 0 100 L 300 50"])
    assertRun(geometry.paths[0], geometry.points)
  })

  it("uses endpoint-exact, bounded monotone cubic segments for three or more samples", () => {
    for (const values of [[0, 4, 10], [10, 4, 0], [0, .01, 9.99, 10], [10, 9.99, .01, 0]]) {
      const geometry = buildTrendGeometry(values, 10, 600, 200)
      assert.equal(geometry.paths.length, 1)
      assertFiniteGeometry(geometry, 600, 200)
      assertRun(geometry.paths[0], geometry.points)
      assertMonotoneSegments(geometry.paths[0], geometry.points)
    }
  })

  it("splits leading/interior/trailing null gaps without bridging separate runs", () => {
    const geometry = buildTrendGeometry([null, 0, 2, 4, null, 4, 2, null, 1, null], 4, 900, 100)
    assert.deepEqual(plain(geometry.points.map((point) => point.index)), [1, 2, 3, 5, 6, 8])
    assert.deepEqual(plain(geometry.points.map((point) => point.x)), [100, 200, 300, 500, 600, 800])
    assert.equal(geometry.paths.length, 2)
    assertRun(geometry.paths[0], geometry.points.slice(0, 3))
    assertRun(geometry.paths[1], geometry.points.slice(3, 5))
    assertFiniteGeometry(geometry, 900, 100)
  })

  it("preserves flat plateaus and horizontal tangents at their boundaries", () => {
    const geometry = buildTrendGeometry([0, 4, 4, 4, 0], 4, 400, 100)
    assertRun(geometry.paths[0], geometry.points)
    assertMonotoneSegments(geometry.paths[0], geometry.points)
    const parts = commands(geometry.paths[0])
    for (const part of parts.slice(2, 4)) {
      assert.deepEqual(part.coordinates.filter((_, index) => index % 2 === 1), [0, 0, 0])
    }
    assert.equal(parts[1].coordinates[3], 0)
    assert.equal(parts[4].coordinates[1], 0)
  })

  it("preserves alternating local extrema without spline overshoot", () => {
    const geometry = buildTrendGeometry([0, 10, 0, 10, 0], 10, 400, 100)
    assertRun(geometry.paths[0], geometry.points)
    assertMonotoneSegments(geometry.paths[0], geometry.points)
    const parts = commands(geometry.paths[0])
    for (let index = 1; index < geometry.points.length - 1; index++) {
      assert.equal(parts[index].coordinates[3], geometry.points[index].y)
      assert.equal(parts[index + 1].coordinates[1], geometry.points[index].y)
    }
  })

  it("renders genuine zeros as a complete baseline, not missing samples", () => {
    const geometry = buildTrendGeometry([0, 0, 0], cleanAxisMaximum([0, 0, 0]), 300, 100)
    assert.equal(geometry.points.length, 3)
    assertRun(geometry.paths[0], geometry.points)
    for (const part of commands(geometry.paths[0])) {
      assert.ok(part.coordinates.filter((_, index) => index % 2 === 1).every((y) => y === 100))
    }
  })

  it("divides before multiplying and keeps legal extreme values/dimensions finite", () => {
    const dimensions = [[600, 240], [Number.MIN_VALUE, Number.MIN_VALUE], [Number.MAX_VALUE, Number.MAX_VALUE], [Number.MIN_VALUE, Number.MAX_VALUE], [Number.MAX_VALUE, Number.MIN_VALUE]]
    for (const maximum of [Number.MIN_VALUE, 1e-320, 1, 1e308, Number.MAX_VALUE]) {
      for (const [width, height] of dimensions) {
        const geometry = buildTrendGeometry([0, maximum, 0, maximum], maximum, width, height)
        assertFiniteGeometry(geometry, width, height)
        assertRun(geometry.paths[0], geometry.points)
        assert.equal(geometry.points[0].y, height)
        assert.equal(geometry.points[1].y, 0)
        assert.equal(geometry.points.at(-1).x, width)
        const singleton = buildTrendGeometry([maximum], maximum, width, height)
        assert.equal(singleton.points[0].x, width / 2)
        assertFiniteGeometry(singleton, width, height)
      }
    }
  })

  it("retains scale-invariant geometry for tiny and huge magnitudes", () => {
    const expected = plain(buildTrendGeometry([0, .2, .8, 1], 1, 300, 100))
    for (const scale of [1e-300, 1e300]) {
      const geometry = buildTrendGeometry([0, .2 * scale, .8 * scale, scale], scale, 300, 100)
      assert.deepEqual(plain(geometry), expected)
    }
  })

  it("rejects zero, negative and nonfinite dimensions/domain even for empty input", () => {
    for (const invalid of [0, -1, NaN, Infinity, -Infinity, undefined, "300"]) {
      for (const values of [[], [null], [0]]) {
        assert.throws(() => buildTrendGeometry(values, invalid, 300, 100), /maximum.*finite, positive/)
        assert.throws(() => buildTrendGeometry(values, 1, invalid, 100), /width.*finite, positive/)
        assert.throws(() => buildTrendGeometry(values, 1, 300, invalid), /height.*finite, positive/)
      }
    }
  })

  it("rejects malformed/out-of-domain values rather than clamping the statistics", () => {
    for (const value of [-1, NaN, Infinity, -Infinity, undefined, "1"]) {
      assert.throws(() => buildTrendGeometry([0, null, value], 1, 300, 100), /finite, non-negative/)
    }
    assert.throws(() => buildTrendGeometry([0, 2], 1, 300, 100), /exceeds the axis maximum/)
    assert.throws(() => buildTrendGeometry([Number.MIN_VALUE], Number.MIN_VALUE, 0, 100), /width/)
  })
})
