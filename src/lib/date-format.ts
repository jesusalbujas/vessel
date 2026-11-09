export function formatLocalDateTime(value: string | null | undefined, language: "es" | "en") {
  if (!value) return language === "es" ? "Fecha no disponible" : "Date unavailable";

  // SQLite CURRENT_TIMESTAMP is UTC but does not include a timezone suffix.
  const normalized = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value)
    ? value
    : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(language === "es" ? "es-VE" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
