import { FREQUENCY_TYPES, DAYS_OF_WEEK, FIELD_VISIBILITY, type FrequencyTypeKey, type DayOfWeek } from '../types.js';

interface FrequencyValue {
  frequency_type: FrequencyTypeKey;
  frequency_interval?: number;
  days_of_week?: string[];
  day_of_month?: number;
  scheduled_hour: number;
}

interface Props {
  value: FrequencyValue;
  onChange: (value: FrequencyValue) => void;
  error?: string;
}

export default function FrequencySelector({ value, onChange, error }: Props) {
  const visibleFields = FIELD_VISIBILITY[value.frequency_type] || [];

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="frequency-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">頻度</label>
        <select
          id="frequency-type"
          value={value.frequency_type}
          onChange={(e) =>
            onChange({
              ...value,
              frequency_type: e.target.value as FrequencyTypeKey,
              frequency_interval: undefined,
              days_of_week: undefined,
              day_of_month: undefined,
            })
          }
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"

        >
          {(Object.entries(FREQUENCY_TYPES) as [FrequencyTypeKey, string][]).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {visibleFields.includes('frequency_interval') && (
        <div>
          <label htmlFor="frequency-interval" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">間隔</label>
          <div className="flex items-center gap-2">
            <input
              id="frequency-interval"
              type="number"
              min="2"
              value={value.frequency_interval || ''}
              onChange={(e) => onChange({ ...value, frequency_interval: parseInt(e.target.value) || undefined })}
              className="w-20 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"

            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {value.frequency_type === 'n_days' ? '日ごと' : value.frequency_type === 'n_weeks' ? '週ごと' : 'ヶ月ごと'}
            </span>
          </div>
        </div>
      )}

      {visibleFields.includes('days_of_week') && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">曜日</label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="曜日">
            {(Object.entries(DAYS_OF_WEEK) as [DayOfWeek, string][]).map(([key, label]) => {
              const checked = value.days_of_week?.includes(key) || false;
              return (
                <label
                  key={key}
                  className={`flex items-center justify-center w-10 h-10 rounded-lg border cursor-pointer select-none transition-colors min-w-[44px] min-h-[44px] ${
                    checked ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const current = value.days_of_week || [];
                      const next = checked ? current.filter((d) => d !== key) : [...current, key];
                      onChange({ ...value, days_of_week: next });
                    }}
                    className="sr-only"

                  />
                  {label}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {visibleFields.includes('day_of_month') && (
        <div>
          <label htmlFor="day-of-month" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">日指定（任意、1〜28）</label>
          <input
            id="day-of-month"
            type="number"
            min="1"
            max="28"
            value={value.day_of_month || ''}
            onChange={(e) => onChange({ ...value, day_of_month: parseInt(e.target.value) || undefined })}
            className="w-20 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"

            placeholder="1"
          />
        </div>
      )}

      <div>
        <label htmlFor="scheduled-hour" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">起票時刻（0〜23時）</label>
        <div className="flex items-center gap-2">
          <input
            id="scheduled-hour"
            type="number"
            min="0"
            max="23"
            value={value.scheduled_hour}
            onChange={(e) => onChange({ ...value, scheduled_hour: parseInt(e.target.value) || 0 })}
            className="w-20 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
          <span className="text-sm text-gray-600 dark:text-gray-400">時</span>
        </div>
      </div>

      {error && <p className="text-red-500 dark:text-red-400 text-sm" role="alert">{error}</p>}
    </div>
  );
}
