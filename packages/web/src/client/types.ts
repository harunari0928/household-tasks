export const CATEGORIES = {
  water: '水回り',
  kitchen: 'キッチン',
  floor: 'フロア・室内',
  entrance: '玄関・ベランダ・その他',
  laundry: '洗濯・布もの',
  trash: 'ごみ関連',
  childcare: '育児タスク',
  cooking: '料理・食事タスク',
  lifestyle: '生活・その他',
} as const;

export type CategoryKey = keyof typeof CATEGORIES;

export const FREQUENCY_TYPES = {
  daily: '毎日',
  weekly: '毎週',
  n_days: 'N日ごと',
  n_weeks: 'N週ごと',
  monthly: '毎月',
  n_months: 'Nヶ月ごと',
  yearly: '1年ごと',
} as const;

export type FrequencyTypeKey = keyof typeof FREQUENCY_TYPES;

export const DAYS_OF_WEEK = {
  mon: '月',
  tue: '火',
  wed: '水',
  thu: '木',
  fri: '金',
  sat: '土',
  sun: '日',
} as const;

export type DayOfWeek = keyof typeof DAYS_OF_WEEK;

export const ASSIGNEES = {
  husband: '夫',
  wife: '妻',
  alternate: '交互',
} as const;

export type AssigneeKey = keyof typeof ASSIGNEES | null;

export interface TaskDefinition {
  id: number;
  name: string;
  category: CategoryKey;
  frequency_type: FrequencyTypeKey;
  frequency_interval: number | null;
  days_of_week: string | null;
  day_of_month: number | null;
  assignee: string | null;
  vikunja_project_id: number | null;
  next_due_date: string | null;
  is_active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskDefinitionInput {
  name: string;
  category: CategoryKey;
  frequency_type: FrequencyTypeKey;
  frequency_interval?: number;
  days_of_week?: string[];
  day_of_month?: number;
  assignee?: 'husband' | 'wife' | 'alternate' | null;
  vikunja_project_id?: number;
  notes?: string;
}

export interface ExecutionLog {
  id: number;
  task_definition_id: number;
  executed_at: string;
  vikunja_task_id: number | null;
  status: 'created' | 'failed' | 'skipped_duplicate';
  error_message: string | null;
}

export interface Attachment {
  id: string;
  task_id: number;
  filename: string;
  original_name: string;
  mime_type: string;
  size: number;
  created_at: string;
}

export const FIELD_VISIBILITY: Record<FrequencyTypeKey, string[]> = {
  daily: [],
  weekly: ['days_of_week'],
  n_days: ['frequency_interval'],
  n_weeks: ['frequency_interval', 'days_of_week'],
  monthly: ['day_of_month'],
  n_months: ['frequency_interval', 'day_of_month'],
  yearly: [],
};
