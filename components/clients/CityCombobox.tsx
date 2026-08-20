"use client";

import { useId } from "react";

export const COMMON_KZ_CITIES = [
  "Алматы", "Астана", "Шымкент", "Караганда", "Тараз", "Талдыкорган", "Конаев",
  "Каскелен", "Актобе", "Атырау", "Актау", "Костанай", "Павлодар", "Петропавловск",
  "Семей", "Усть-Каменогорск", "Туркестан", "Кызылорда", "Уральск",
] as const;

export default function CityCombobox({ value, onChange, className, required = true }: {
  value: string;
  onChange: (value: string) => void;
  className: string;
  required?: boolean;
}) {
  const id = useId();
  return <>
    <input
      list={id}
      required={required}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Начните вводить город или населённый пункт"
      autoComplete="address-level2"
      className={className}
    />
    <datalist id={id}>{COMMON_KZ_CITIES.map((city) => <option key={city} value={city}/>)}</datalist>
  </>;
}
