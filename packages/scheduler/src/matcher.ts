import { formatLocalDate, addMonths } from '@household-tasks/shared';
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

function getTodayDayOfWeek(today: string): string {
  const d = parseDate(today);
  return DAY_REVERSE[d.getDay()];
}

export function shouldCreateToday(task: TaskDefinitionRow, today: string): boolean {
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

    default:
      return false;
  }
}

export function shouldCreateThisHour(task: TaskDefinitionRow, currentHour: number): boolean {
  return currentHour >= task.scheduled_hour;
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
      // day_of_month 指定があれば必ずその日に揃える（未指定なら元の日を維持）
      return formatLocalDate(addMonths(d, interval, task.day_of_month));

    case 'yearly':
      if (task.month_of_year && task.day_of_month) {
        const nextYear = d.getFullYear() + 1;
        return formatLocalDate(new Date(nextYear, task.month_of_year - 1, task.day_of_month));
      }
      d.setFullYear(d.getFullYear() + 1);
      break;

    default:
      // daily/weekly/monthly don't use next_due_date
      break;
  }

  return formatLocalDate(d);
}
