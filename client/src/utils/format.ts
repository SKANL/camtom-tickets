/**
 * Format a duration in milliseconds to a human-readable string (e.g., "4h 30m").
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return '0m';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

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

/**
 * Format a Date to a short date string for the Friday report.
 */
export function formatDate(date: Date = new Date()): string {
  return date.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}
