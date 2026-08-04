"use client";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export default function OrderSearch({
  value,
  onChange,
}: Props) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Поиск по номеру заказа, клиенту, телефону..."
        className="w-full rounded-xl border border-slate-700 bg-slate-900 p-4 text-white outline-none focus:border-blue-500"
      />

    </div>
  );
}