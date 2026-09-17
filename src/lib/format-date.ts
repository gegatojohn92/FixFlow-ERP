const DATE_FORMATTER = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

export function formatDate(value: string | null | undefined): string {
  return value ? DATE_FORMATTER.format(new Date(value)) : '-'
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? DATE_TIME_FORMATTER.format(new Date(value)) : '-'
}

export function formatToday(): string {
  return DATE_FORMATTER.format(new Date())
}
