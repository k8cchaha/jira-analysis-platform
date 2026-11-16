export type TrendPoint = { index: number; x: number; y: number }
export type StackSegment = { seriesIndex: number; value: number; y: number; height: number }
export type StackColumn = TrendPoint & { height: number; segments: StackSegment[] }

/** Stack known amounts only; the caller's exact-cohort total remains authoritative. */
export function buildStackGeometry(
  values: readonly (readonly (number | null)[])[],
  totals: readonly (number | null)[],
  maximum: number,
  width: number,
  height: number,
): StackColumn[] {
  const geometry = buildTrendGeometry(totals, maximum, width, height)
  for (const series of values) {
    if (series.length !== totals.length) throw new RangeError("Stack samples must match total samples")
    for (const value of series) if (value !== null) validateValue(value)
  }
  const points = new Map(geometry.points.map((point) => [point.index, point]))
  const columns: StackColumn[] = []
  for (let index = 0; index < totals.length; index++) {
    let sum = 0
    const amounts = values.map((series, seriesIndex) => ({ seriesIndex, value: series[index] }))
      .filter((entry): entry is { seriesIndex: number; value: number } => entry.value !== null && entry.value > 0)
    for (const { value } of amounts) sum += value
    const total = totals[index]
    if (!Number.isFinite(sum) || (total === null ? sum !== 0 : Math.abs(sum - total) > Math.max(sum, total, Number.MIN_VALUE) * 1e-10)) {
      throw new RangeError("Stack amounts must reconcile with the supplied total")
    }
    const point = points.get(index)
    if (!point) continue // null is not an observed zero, even when empty teams have zero samples.
    let cumulative = 0
    const segments = amounts.map(({ seriesIndex, value }, segmentIndex) => {
      const bottom = (1 - cumulative / maximum) * height
      cumulative += value
      // Only remove floating-point drift at the outer cap; never rescale segment values.
      const y = segmentIndex === amounts.length - 1 ? point.y : (1 - cumulative / maximum) * height
      return { seriesIndex, value, y, height: Math.max(0, bottom - y) }
    })
    columns.push({ ...point, height: height - point.y, segments })
  }
  return columns
}

function validateValue(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Trend values must be finite, non-negative numbers or null")
  }
}

/** Zero-based 1/2/5 axis ceiling; cap at the representable numeric limits. */
export function cleanAxisMaximum(values: readonly (number | null)[], integer = false): number {
  let largest = 0
  for (const value of values) {
    if (value === null) continue
    validateValue(value)
    largest = Math.max(largest, value)
  }
  if (largest === 0) return 1
  if (integer) largest = Math.max(1, largest)

  // 10^-324 underflows to zero. The first usable decimal step is subnormal.
  const magnitude = 10 ** Math.max(-323, Math.floor(Math.log10(largest)))
  for (const multiplier of [1, 2, 5, 10]) {
    const ceiling = magnitude * multiplier
    if (Number.isFinite(ceiling) && ceiling >= largest) {
      return integer ? Math.ceil(ceiling) : ceiling
    }
  }
  // No finite nice step exists above the largest representable values.
  return Number.MAX_VALUE
}

/** Harmonic-mean tangent for equally spaced, normalized samples (never pixel slopes). */
function monotoneTangent(before: number, after: number): number {
  if (before === 0 || after === 0 || Math.sign(before) !== Math.sign(after)) return 0
  const smaller = Math.min(Math.abs(before), Math.abs(after))
  const larger = Math.max(Math.abs(before), Math.abs(after))
  return Math.sign(before) * smaller * (2 / (1 + smaller / larger))
}

function boundedControl(value: number, start: number, end: number): number {
  return Math.max(Math.min(start, end), Math.min(Math.max(start, end), value))
}

/** Missing samples keep their original x slots and break the interpolated line. */
export function buildTrendGeometry(
  values: readonly (number | null)[],
  maximum: number,
  width: number,
  height: number,
): { points: TrendPoint[]; paths: string[] } {
  for (const [name, value] of [["maximum", maximum], ["width", width], ["height", height]] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`Trend ${name} must be a finite, positive number`)
    }
  }

  const points: TrendPoint[] = []
  const paths: string[] = []
  let run: { point: TrendPoint; ratio: number }[] = []
  const xAt = (index: number) => values.length === 1 ? width / 2 : (index / (values.length - 1)) * width

  const finishRun = () => {
    if (run.length >= 2) {
      const first = run[0].point
      let path = `M ${first.x} ${first.y}`
      if (run.length === 2) {
        const last = run[1].point
        path += ` L ${last.x} ${last.y}`
      } else {
        const deltas = run.slice(1).map((sample, index) => sample.ratio - run[index].ratio)
        const tangents = run.map((_, index) => {
          if (index === 0) return deltas[0]
          if (index === run.length - 1) return deltas[index - 1]
          return monotoneTangent(deltas[index - 1], deltas[index])
        })
        for (let index = 0; index < run.length - 1; index++) {
          const start = run[index]
          const end = run[index + 1]
          // Divide before scaling: legal MIN_VALUE/MAX_VALUE dimensions remain finite.
          const c1x = xAt(start.point.index + 1 / 3)
          const c2x = xAt(end.point.index - 1 / 3)
          const c1y = boundedControl(start.ratio + tangents[index] / 3, start.ratio, end.ratio) * height
          const c2y = boundedControl(end.ratio - tangents[index + 1] / 3, start.ratio, end.ratio) * height
          path += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${end.point.x} ${end.point.y}`
        }
      }
      paths.push(path)
    }
    run = []
  }

  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (value === null) {
      finishRun()
      continue
    }
    validateValue(value)
    if (value > maximum) throw new RangeError("Trend value exceeds the axis maximum")
    const ratio = 1 - value / maximum
    const point = { index, x: xAt(index), y: ratio * height }
    points.push(point)
    run.push({ point, ratio })
  }
  finishRun()
  return { points, paths }
}
