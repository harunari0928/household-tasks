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
  nth_weekday_of_month: '第N曜日(毎月)',
  days_after_completion: '完了後N日',
  on_demand: '即時（都度）',
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

export const SICK_DAY_BEHAVIORS = {
  normal_only: '通常時のみ表示',
  always: '常に表示',
  sick_only: '風邪の日のみ表示',
} as const;

export type SickDayBehaviorKey = keyof typeof SICK_DAY_BEHAVIORS;

/** 帰省・旅行などで家を空ける日の扱い */
export const ABSENCE_BEHAVIORS = {
  normal: '不在でも表示',
  hidden: '不在中は非表示',
} as const;

export type AbsenceBehaviorKey = keyof typeof ABSENCE_BEHAVIORS;

export interface TaskDefinition {
  id: number;
  name: string;
  category: CategoryKey;
  frequency_type: FrequencyTypeKey;
  frequency_interval: number | null;
  days_of_week: string | null;
  day_of_month: number | null;
  month_of_year: number | null;
  nth_weekday_position: number | null;
  period_start_mm: number | null;
  period_start_dd: number | null;
  period_end_mm: number | null;
  period_end_dd: number | null;
  next_due_date: string | null;
  is_active: number;
  notes: string | null;
  points: number;
  scheduled_hour: number;
  sick_day_behavior: SickDayBehaviorKey;
  /** アプリ機能と紐付く特別なタスクの識別子（'garbage' 等）。付いていると削除できない */
  special_kind: string | null;
  absence_behavior: AbsenceBehaviorKey;
  exclude_holiday: number;
  exclude_day_before_holiday: number;
  /** 優先タスク（今日必ずやる）。カンバンの未着手列で先頭にまとまり、カードに目印が付く */
  is_priority: number;
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
  month_of_year?: number;
  nth_weekday_position?: number;
  period_start_mm?: number | null;
  period_start_dd?: number | null;
  period_end_mm?: number | null;
  period_end_dd?: number | null;
  notes?: string;
  points?: number;
  scheduled_hour: number;
  sick_day_behavior?: SickDayBehaviorKey;
  absence_behavior?: AbsenceBehaviorKey;
  exclude_holiday?: boolean;
  exclude_day_before_holiday?: boolean;
  is_priority?: boolean;
}

export interface ExecutionLog {
  id: number;
  task_definition_id: number;
  executed_at: string;
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

export type TaskInstanceStatus = 'todo' | 'done';

export const KANBAN_COLUMNS = {
  todo: '未着手',
  done: '完了',
} as const;

export interface TaskInstance {
  id: number;
  /** 個人タスクはスケジュール定義を持たない */
  task_definition_id: number | null;
  title: string;
  status: TaskInstanceStatus;
  assignee: string | null;
  points: number;
  created_at: string;
  completed_at: string | null;
  category: CategoryKey | null;
  sort_order: number;
  /** 定義側の値をカンバン取得時に join したもの（category と同様、インスタンスには保存しない） */
  is_priority: number;
  /** 個人タスクなら 1。points は常に 0 で、ポイント集計には含まれない */
  is_personal: number;
  /** 個人タスクを表示・操作できるユーザー名 */
  personal_owner: string | null;
}

export const FIELD_VISIBILITY: Record<FrequencyTypeKey, string[]> = {
  daily: [],
  weekly: ['days_of_week'],
  n_days: ['frequency_interval'],
  n_weeks: ['frequency_interval', 'days_of_week'],
  monthly: ['day_of_month'],
  n_months: ['frequency_interval', 'day_of_month'],
  yearly: ['month_of_year', 'day_of_month'],
  nth_weekday_of_month: ['nth_weekday_position', 'days_of_week'],
  days_after_completion: ['frequency_interval'],
  on_demand: [],
};
