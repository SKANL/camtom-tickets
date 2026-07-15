/**
 * Format a Date to a display time string (HH:MM:SS).
 */
export function formatTime(date: Date = new Date()): string {
  return date.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
