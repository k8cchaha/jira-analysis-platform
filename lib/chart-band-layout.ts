/** Equal sample buckets align Cartesian chart data, axis labels, decorations and hit targets. */
export function buildChartBandLayout(count: number, width: number) {
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("Chart count must be a positive integer")
  if (!Number.isFinite(width) || width <= 0 || width / count === 0) throw new RangeError("Chart width must be a finite, positive number")
  const bucketWidth = width / count
  const center = (index: number) => (index + .5) / count * width
  return {
    bucketWidth,
    // Keep endpoint-based path geometry reusable, including its centered singleton.
    geometryLeft: count === 1 ? 0 : bucketWidth / 2,
    geometryWidth: count === 1 ? width : (count - 1) / count * width,
    center,
    bucket(index: number) { return { left: index / count * width, width: bucketWidth } },
    span(index: number, size: number) {
      const spanWidth = Math.min(size, bucketWidth)
      // Start from the bucket edge so a full-width first span cannot drift slightly below zero.
      return { left: index / count * width + (bucketWidth - spanWidth) / 2, width: spanWidth }
    },
    indexAt(position: number) { return Math.max(0, Math.min(count - 1, Math.floor(position / width * count))) },
  }
}
