import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildChartBandLayout } from "../lib/chart-band-layout.ts"
import { buildTrendGeometry } from "../app/(app)/analytics/projects/projects-trend-geometry.ts"

describe("Cartesian chart band layout", () => {
  it("centers equal buckets with symmetric first/last padding at every chart density", () => {
    for (const count of [1, 2, 5, 100]) for (const width of [1, 84, 244, 430, 900]) {
      const layout = buildChartBandLayout(count, width)
      const centers = Array.from({ length: count }, (_, index) => layout.center(index))
      assert.ok(Math.abs(centers[0] - (width - centers.at(-1))) < 1e-10)
      assert.ok(Math.abs(centers[0] - layout.bucketWidth / 2) < 1e-10)
      const geometry = buildTrendGeometry(Array(count).fill(1), 1, layout.geometryWidth, 100)
      geometry.points.forEach((point, index) => {
        assert.ok(Math.abs(point.x + layout.geometryLeft - centers[index]) < 1e-10)
        const bucket = layout.bucket(index)
        assert.ok(Math.abs(bucket.left + bucket.width / 2 - centers[index]) < 1e-10)
        const span = layout.span(index, 160)
        assert.ok(span.width <= layout.bucketWidth)
        assert.ok(Math.abs(span.left + span.width / 2 - centers[index]) < 1e-10)
        assert.ok(span.left >= bucket.left - 1e-10 && span.left + span.width <= bucket.left + bucket.width + 1e-10)
        if (index) assert.ok(Math.abs(bucket.left - (layout.bucket(index - 1).left + layout.bucket(index - 1).width)) < 1e-10)
      })
      assert.ok(Math.abs(layout.bucket(count - 1).left + layout.bucketWidth - width) < 1e-10)
    }
  })
  it("uses the same bucket boundaries for pointer selection, including outer whitespace", () => {
    for (const count of [1, 2, 5, 100]) {
      const layout = buildChartBandLayout(count, 430)
      assert.equal(layout.indexAt(-100), 0)
      assert.equal(layout.indexAt(430), count - 1)
      assert.equal(layout.indexAt(530), count - 1)
      for (let index = 0; index < count; index++) {
        const bucket = layout.bucket(index)
        assert.equal(layout.indexAt(bucket.left + bucket.width * .01), index)
        assert.equal(layout.indexAt(bucket.left + bucket.width * .99), index)
        assert.equal(layout.indexAt(layout.center(index)), index)
      }
    }
  })
  it("rejects invalid layout dimensions rather than creating overlapping or nonfinite buckets", () => {
    for (const count of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => buildChartBandLayout(count, 430), /count/)
    for (const width of [0, -1, NaN, Infinity]) assert.throws(() => buildChartBandLayout(5, width), /width/)
  })
})
