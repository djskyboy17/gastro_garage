"use client";
import { useState, type ChangeEvent } from "react";

const TIME_PATTERN = "([01][0-9]|2[0-3]):[0-5][0-9]";

/** „1330” → „13:30”, „9” → „9”; csak számjegy és egy kettőspont marad, legfeljebb ÓÓ:PP. */
function normalize(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? digits.slice(0, 2) + ":" + digits.slice(2) : digits;
}

type Props = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
};

/**
 * Mindig 24 órás időmező („ÓÓ:PP”), a böngésző és a Windows nyelvétől függetlenül.
 * Az érték formátuma ugyanaz, mint a `type="time"` mezőé, így a szerver változatlan.
 */
export function TimeInput24({ id, name, value, defaultValue, onChange, required, disabled, ...rest }: Props) {
  const [own, setOwn] = useState(defaultValue ?? "");
  const current = value ?? own;
  function change(e: ChangeEvent<HTMLInputElement>) {
    const next = normalize(e.target.value);
    if (value === undefined) setOwn(next);
    onChange?.(next);
  }
  return (
    <input
      id={id}
      name={name}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="00:00"
      maxLength={5}
      pattern={TIME_PATTERN}
      title="00:00 – 23:59"
      required={required}
      disabled={disabled}
      value={current}
      onChange={change}
      aria-label={rest["aria-label"]}
      className="time-input-24"
    />
  );
}

/** Dátum + 24 órás idő egy `YYYY-MM-DDTHH:MM` értékké (a `datetime-local` helyett). */
export function DateTime24({
  value,
  onChange,
  max,
  required,
  disabled,
  dateLabel,
  timeLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  dateLabel: string;
  timeLabel: string;
}) {
  const [date = "", time = ""] = value.split("T");
  return (
    <span className="datetime-24">
      <input
        type="date"
        aria-label={dateLabel}
        required={required}
        disabled={disabled}
        max={max?.slice(0, 10)}
        value={date}
        onChange={(e) => onChange(e.target.value + "T" + time)}
      />
      <TimeInput24
        aria-label={timeLabel}
        required={required}
        disabled={disabled}
        value={time}
        onChange={(t) => onChange(date + "T" + t)}
      />
    </span>
  );
}
