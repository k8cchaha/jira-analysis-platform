/** Simulate ICU 78's missing ISO era without changing Gregorian data or other Intl fields. */
export function mockIsoCalendarWithoutEra(t) {
  const original = Intl.DateTimeFormat.prototype.formatToParts
  t.mock.method(Intl.DateTimeFormat.prototype, "formatToParts", function (...args) {
    const parts = Reflect.apply(original, this, args)
    return this.resolvedOptions().calendar === "iso8601"
      ? parts.filter((part) => part.type !== "era")
      : parts
  })
}
