import { FREQUENCY_TYPES, DAYS_OF_WEEK, FIELD_VISIBILITY, type FrequencyTypeKey, type DayOfWeek } from '../types.js';

interface FrequencyValue {
  frequency_type: FrequencyTypeKey;
  frequency_interval?: number;
  days_of_week?: string[];
  day_of_month?: number;
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
        <label className="block text-sm font-medium text-gray-700 mb-1">頻度</label>
        <select
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
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base min-h-[44px]"
          data-testid="frequency-type-select"
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
          <label className="block text-sm font-medium text-gray-700 mb-1">間隔</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="2"
              value={value.frequency_interval || ''}
              onChange={(e) => onChange({ ...value, frequency_interval: parseInt(e.target.value) || undefined })}
              className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-base min-h-[44px]"
              data-testid="frequency-interval-input"
            />
            <span className="text-sm text-gray-600">
              {value.frequency_type === 'n_days' ? '日ごと' : value.frequency_type === 'n_weeks' ? '週ごと' : 'ヶ月ごと'}
            </span>
          </div>
        </div>
      )}

      {visibleFields.includes('days_of_week') && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">曜日</label>
          <div className="flex flex-wrap gap-2" data-testid="days-of-week-checkboxes">
            {(Object.entries(DAYS_OF_WEEK) as [DayOfWeek, string][]).map(([key, label]) => {
              const checked = value.days_of_week?.includes(key) || false;
              return (
                <label
                  key={key}
                  className={`flex items-center justify-center w-10 h-10 rounded-lg border cursor-pointer select-none transition-colors min-w-[44px] min-h-[44px] ${
                    checked ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-300'
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
                    data-testid={`day-checkbox-${key}`}
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
          <label className="block text-sm font-medium text-gray-700 mb-1">日指定（任意、1〜28）</label>
          <input
            type="number"
            min="1"
            max="28"
            value={value.day_of_month || ''}
            onChange={(e) => onChange({ ...value, day_of_month: parseInt(e.target.value) || undefined })}
            className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-base min-h-[44px]"
            data-testid="day-of-month-input"
            placeholder="1"
          />
        </div>
      )}

      {error && <p className="text-red-500 text-sm" data-testid="frequency-error">{error}</p>}
    </div>
  );
}
