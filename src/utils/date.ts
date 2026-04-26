import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns';

export function formatArticleDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (isToday(date)) return formatDistanceToNow(date, { addSuffix: true });
  if (isYesterday(date)) return `Yesterday · ${format(date, 'h:mm a')}`;
  return format(date, 'MMM d, yyyy');
}
