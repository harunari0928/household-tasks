import type { TaskDefinitionRow } from './db.js';

const DAY_MAP: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const DAY_REVERSE: Record<number, string> = {
  0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat',
};

function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getTodayDayOfWeek(today: string): string {
  const d = parseDate(today);
  return DAY_REVERSE[d.getDay()];
}

function addDays(dateStr: string, days: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

export function shouldCreateToday(
  task: TaskDefinitionRow,
  today: string,
  lastCompletedDate?: string | null,
): boolean {
  const ft = task.frequency_type;

  switch (ft) {
    case 'daily':
      return true;

    case 'weekly': {
      if (!task.days_of_week) return false;
      const days = task.days_of_week.split(',').map((d) => d.trim());
      return days.includes(getTodayDayOfWeek(today));
    }

    case 'monthly': {
      const targetDay = task.day_of_month || 1;
      const todayDate = parseDate(today);
      return todayDate.getDate() === targetDay;
    }

    case 'n_days':
    case 'n_months':
    case 'yearly': {
      if (!task.next_due_date) return true; // First run
      return task.next_due_date <= today;
    }

    case 'n_weeks': {
      if (!task.next_due_date) return true; // First run
      if (task.next_due_date > today) return false;
      if (!task.days_of_week) return false;
      const days = task.days_of_week.split(',').map((d) => d.trim());
      return days.includes(getTodayDayOfWeek(today));
    }

    case 'nth_weekday_of_month': {
      if (!task.days_of_week || !task.nth_weekday_position) return false;
      const targetDay = DAY_MAP[task.days_of_week.split(',')[0].trim()];
      if (targetDay === undefined) return false;
      const todayDate = parseDate(today);
      const targetDate = nthWeekdayOfMonth(
        todayDate.getFullYear(),
        todayDate.getMonth(),
        task.nth_weekday_position,
        targetDay,
      );
      if (!targetDate) return false; // Nth weekday doesn't exist this month
      return targetDate.getDate() === todayDate.getDate();
    }

    case 'days_after_completion': {
      // 完了日から interval 日経過したら起票。
      // 一度も完了していない場合は初回として起票（未完了インスタンスが残っている間は
      // hasRecentInstance が再起票を抑止する）。
      const interval = task.frequency_interval || 1;
      if (!lastCompletedDate) return true;
      return addDays(lastCompletedDate, interval) <= today;
    }

    default:
      return false;
  }
}

function nthWeekdayOfMonth(year: number, month: number, position: number, dayOfWeek: number): Date | null {
  const firstOfMonth = new Date(year, month, 1);
  const firstDow = firstOfMonth.getDay();
  const offset = (dayOfWeek - firstDow + 7) % 7;
  const day = 1 + offset + (position - 1) * 7;
  const lastDay = new Date(year, month + 1, 0).getDate();
  if (day > lastDay) return null;
  return new Date(year, month, day);
}

export function shouldCreateThisHour(task: TaskDefinitionRow, currentHour: number): boolean {
  return currentHour >= task.scheduled_hour;
}

export function isWithinActivePeriod(task: TaskDefinitionRow, today: string): boolean {
  const { period_start_mm, period_start_dd, period_end_mm, period_end_dd } = task;
  if (period_start_mm == null || period_start_dd == null || period_end_mm == null || period_end_dd == null) {
    return true;
  }
  const d = parseDate(today);
  const cur = (d.getMonth() + 1) * 100 + d.getDate();
  const start = period_start_mm * 100 + period_start_dd;
  const end = period_end_mm * 100 + period_end_dd;
  if (start <= end) {
    return cur >= start && cur <= end;
  }
  return cur >= start || cur <= end;
}

export function calculateNextDueDate(task: TaskDefinitionRow, currentDueDate: string): string {
  const ft = task.frequency_type;
  const d = parseDate(currentDueDate);
  const interval = task.frequency_interval || 1;

  switch (ft) {
    case 'n_days':
      d.setDate(d.getDate() + interval);
      break;

    case 'n_weeks':
      d.setDate(d.getDate() + interval * 7);
      break;

    case 'n_months':
      d.setMonth(d.getMonth() + interval);
      break;

    case 'yearly':
      if (task.month_of_year && task.day_of_month) {
        const nextYear = d.getFullYear() + 1;
        return formatDate(new Date(nextYear, task.month_of_year - 1, task.day_of_month));
      }
      d.setFullYear(d.getFullYear() + 1);
      break;

    default:
      // daily/weekly/monthly don't use next_due_date
      break;
  }

  return formatDate(d);
}
