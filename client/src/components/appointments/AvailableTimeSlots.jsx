import { MAX_AVAILABLE_TIME_SLOTS } from "../../utils/availableTimeSlots";

export default function AvailableTimeSlots({ value, onChange, errors = [], disabled = false, idPrefix = "available-time" }) {
  const slots = Array.isArray(value) && value.length ? value : [{ startTime: "", endTime: "" }];
  const update = (index, key, next) => onChange(slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, [key]: next } : slot));
  const add = () => slots.length < MAX_AVAILABLE_TIME_SLOTS && onChange([...slots, { startTime: "", endTime: "" }]);
  const remove = index => slots.length > 1 && onChange(slots.filter((_, slotIndex) => slotIndex !== index));
  return <fieldset className="min-w-0 rounded-xl border border-maroon-100 bg-maroon-50/40 p-4" disabled={disabled}>
    <legend className="px-1 font-bold text-maroon-900">Available Time (Asia/Manila)</legend>
    <p className="mb-4 text-sm leading-5 text-slate-600">Enter the time range(s) when you are available for a consultation. You can add more time slots if needed.</p>
    <div className="space-y-3">
      {slots.map((slot, index) => <div key={index} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between gap-3"><h4 className="text-sm font-bold text-maroon-900">Time Slot {index + 1}</h4>
          {index > 0 && <button type="button" className="rounded-md px-2 py-1 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-maroon-700" onClick={() => remove(index)}>Remove</button>}
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <label htmlFor={`${idPrefix}-${index}-start`} className="min-w-0 text-sm font-semibold">From
            <input id={`${idPrefix}-${index}-start`} type="time" className="field mt-1 w-full" required value={slot.startTime} onChange={event => update(index, "startTime", event.target.value)} aria-invalid={Boolean(errors[index]?.startTime)} aria-describedby={errors[index]?.startTime ? `${idPrefix}-${index}-start-error` : undefined} />
            {errors[index]?.startTime && <span id={`${idPrefix}-${index}-start-error`} className="mt-1 block text-xs font-medium text-red-700">{errors[index].startTime}</span>}
          </label>
          <label htmlFor={`${idPrefix}-${index}-end`} className="min-w-0 text-sm font-semibold">To
            <input id={`${idPrefix}-${index}-end`} type="time" className="field mt-1 w-full" required value={slot.endTime} onChange={event => update(index, "endTime", event.target.value)} aria-invalid={Boolean(errors[index]?.endTime)} aria-describedby={errors[index]?.endTime ? `${idPrefix}-${index}-end-error` : undefined} />
            {errors[index]?.endTime && <span id={`${idPrefix}-${index}-end-error`} className="mt-1 block text-xs font-medium text-red-700">{errors[index].endTime}</span>}
          </label>
        </div>
      </div>)}
    </div>
    <button type="button" className="btn-secondary mt-3 w-full sm:w-auto" disabled={disabled || slots.length >= MAX_AVAILABLE_TIME_SLOTS} onClick={add}>+ Add Time Slot</button>
  </fieldset>;
}
