"use client";

export default function DocumentPrintButton() {
  return <button type="button" onClick={() => window.print()} className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700">Печать</button>;
}
