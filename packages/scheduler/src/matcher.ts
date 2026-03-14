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
      d.setFullYear(d.getFullYear() + 1);
      break;

    default:
      // daily/weekly/monthly don't use next_due_date
      break;
  }

  return formatDate(d);
}
