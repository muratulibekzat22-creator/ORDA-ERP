"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle, X } from "lucide-react";

export type ClientDraft = { name: string; phone: string; city: string; managerUserId: string };
type CreatedClient = { id: number; name: string; phone: string; city: string };
type Manager = { id: number; name: string };
type Tariff = { code: string; uiName: string; kind: string; salePrice: number; defaultQuantity: number; unit: string };
type DeliveryOption = "NONE" | "OPTION_1" | "OPTION_2";
type Option = { id: number; material: string; clientPrice: string | number };
type PreviewOption = { material: string; clientPrice: number; deliveryOption: DeliveryOption; deliveryCharge: number };
type Proposal = { id: number; clientId: number; number: string; options: Option[]; deliveryOption: DeliveryOption; deliveryCharge: number };
type Props = { open: boolean; onClose: () => void; onSave: (client: ClientDraft) => Promise<CreatedClient>; saving?: boolean };

const materials = ["Сосна", "Карагач", "Дуб ламель"];
const money = (value: string | number) => `${Math.round(Number(value) || 0).toLocaleString("ru-RU")} ₸`;

export default function ClientModal({ open, onClose, onSave, saving = false }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+7");
  const [cityMode, setCityMode] = useState<"ALMATY" | "OTHER">("ALMATY");
  const [otherCity, setOtherCity] = useState("");
  const [managerUserId, setManagerUserId] = useState("");
  const [managers, setManagers] = useState<Manager[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [deliveryPrices, setDeliveryPrices] = useState<Record<DeliveryOption, number>>({ NONE: 0, OPTION_1: 0, OPTION_2: 0 });
  const [steps, setSteps] = useState(15);
  const [platforms, setPlatforms] = useState(1);
  const [risers, setRisers] = useState(false);
  const [railingMeters, setRailingMeters] = useState(0);
  const [installation, setInstallation] = useState(true);
  const [almatyDelivery, setAlmatyDelivery] = useState(true);
  const [measurement, setMeasurement] = useState(true);
  const [deliveryOption, setDeliveryOption] = useState<DeliveryOption>("OPTION_1");
  const [advanced, setAdvanced] = useState(false);
  const [brassCount, setBrassCount] = useState(0);
  const [handrailMeters, setHandrailMeters] = useState(0);
  const [painting, setPainting] = useState(false);
  const [preview, setPreview] = useState<PreviewOption[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const lines = useMemo(() => {
    const result: Array<{ code: string; quantity: number; enabled: boolean }> = [];
    const add = (kind: string, quantity: number, enabled = true) => {
      const tariff = tariffs.find((item) => item.kind === kind);
      if (tariff && quantity > 0) result.push({ code: tariff.code, quantity, enabled });
    };
    if (risers) add("RISERS", steps);
    add("METAL_RAILING", railingMeters);
    if (installation) add("INSTALLATION", 1);
    if (measurement) add("MEASUREMENT", 1);
    if (cityMode === "ALMATY" && almatyDelivery) add("DELIVERY", 1);
    add("BRASS_BALUSTERS", brassCount);
    add("HANDRAIL", handrailMeters);
    if (painting) add("PAINTING", steps + platforms * 2);
    return result;
  }, [almatyDelivery, brassCount, cityMode, handrailMeters, installation, measurement, painting, platforms, railingMeters, risers, steps, tariffs]);

  const calculationInput = useMemo(() => ({
    regularSteps: steps,
    platformEquivalents: Array.from({ length: platforms }, () => 2),
    installationRequired: installation,
    deliveryRequired: cityMode === "OTHER" ? deliveryOption !== "NONE" : almatyDelivery,
    measurementRequired: measurement,
    otherCity: cityMode === "OTHER",
    pickup: cityMode === "OTHER" ? deliveryOption === "NONE" : !almatyDelivery,
    deliveryOption: cityMode === "OTHER" ? deliveryOption : "NONE",
    lines,
  }), [almatyDelivery, cityMode, deliveryOption, installation, lines, measurement, platforms, steps]);

  useEffect(() => {
    if (!open) return;
    void Promise.all([
      fetch("/api/client-managers", { cache: "no-store" }).then(async (response) => {
        const payload = await response.json() as { users?: Manager[]; currentUserId?: number; error?: string };
        if (!response.ok) throw new Error(payload.error);
        setManagers(payload.users ?? []);
        setManagerUserId((value) => value || String(payload.currentUserId ?? ""));
      }),
      fetch("/api/calculator-pricing", { cache: "no-store" }).then(async (response) => {
        const payload = await response.json() as { items?: Tariff[]; deliveryOptions?: Record<DeliveryOption, number>; error?: string };
        if (!response.ok) throw new Error(payload.error);
        setTariffs(payload.items ?? []);
        if (payload.deliveryOptions) setDeliveryPrices(payload.deliveryOptions);
      }),
    ]).catch(() => setError("Не удалось загрузить менеджеров или тарифы калькулятора"));
  }, [open]);

  useEffect(() => {
    if (!open || !tariffs.length) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewing(true);
      try {
        const response = await fetch("/api/calculator-pricing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(calculationInput), signal: controller.signal });
        const payload = await response.json() as { variants?: PreviewOption[]; deliveryOptions?: Record<DeliveryOption, number>; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Не удалось пересчитать варианты");
        setPreview(payload.variants ?? []);
        if (payload.deliveryOptions) setDeliveryPrices(payload.deliveryOptions);
        setError("");
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось пересчитать варианты");
      } finally {
        if (!controller.signal.aborted) setPreviewing(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [calculationInput, open, tariffs.length]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && !working && onClose();
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose, open, working]);

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (phone.replace(/\D/g, "").length < 10) return setError("Укажите корректный номер WhatsApp");
    if (!managerUserId) return setError("Выберите ответственного менеджера");
    const city = cityMode === "OTHER" ? otherCity.trim() : "Алматы";
    if (!city) return setError("Укажите город");
    if (preview.length !== 3) return setError("Дождитесь расчёта трёх вариантов");
    setWorking(true);
    try {
      const client = await onSave({ name, phone, city, managerUserId });
      const options = await Promise.all(materials.map(async (material) => {
        const response = await fetch(`/api/clients/${client.id}/calculations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...calculationInput, material }) });
        const payload = await response.json() as Option & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `Не удалось рассчитать вариант «${material}»`);
        return payload;
      }));
      const response = await fetch(`/api/clients/${client.id}/proposals`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ calculationIds: options.map((option) => option.id) }) });
      const created = await response.json() as { id?: number; number?: string; error?: string };
      if (!response.ok || !created.id || !created.number) throw new Error(created.error ?? "Не удалось сформировать КП");
      setProposal({ id: created.id, clientId: client.id, number: created.number, options, deliveryOption: calculationInput.deliveryOption as DeliveryOption, deliveryCharge: deliveryPrices[calculationInput.deliveryOption as DeliveryOption] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось создать заявку и КП");
    } finally {
      setWorking(false);
    }
  }

  const input = "mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-blue-500";
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="new-lead-title">
    <div className="max-h-[96dvh] w-full overflow-y-auto rounded-t-2xl border border-slate-700 bg-[#101827] p-4 sm:max-w-3xl sm:rounded-2xl sm:p-7">
      <div className="flex items-start justify-between gap-3"><div><h2 id="new-lead-title" className="text-2xl font-bold text-white">Новая заявка</h2><p className="mt-1 text-sm text-slate-400">Клиент, расчёт трёх вариантов и КП — в одном окне</p></div><button type="button" onClick={onClose} disabled={working} className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-300" aria-label="Закрыть"><X /></button></div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}
      {proposal ? <Success proposal={proposal} onClose={onClose} /> : <form onSubmit={submit}>
        <section className="mt-5 grid gap-3 sm:grid-cols-2"><Field label="Имя клиента (необязательно)"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} className={input} /></Field><Field label="WhatsApp / телефон"><input required type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className={input} /></Field><Field label="Город"><select required value={cityMode} onChange={(event) => setCityMode(event.target.value as "ALMATY" | "OTHER")} className={input}><option value="ALMATY">Алматы</option><option value="OTHER">Другой город</option></select></Field>{cityMode === "OTHER" && <Field label="Название города"><input required value={otherCity} onChange={(event) => setOtherCity(event.target.value)} className={input} /></Field>}<Field label="Ответственный менеджер"><select required value={managerUserId} onChange={(event) => setManagerUserId(event.target.value)} className={input}><option value="">Выберите менеджера</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></Field></section>

        <section className="mt-6 rounded-xl border border-slate-700 p-4"><h3 className="font-semibold text-white">Калькулятор лестницы</h3><div className="mt-4 grid gap-3 sm:grid-cols-2"><Counter label="Количество ступеней" value={steps} min={0} onChange={setSteps} /><Counter label="Количество площадок" value={platforms} min={0} onChange={setPlatforms} /><NumberField label="Ограждение, м" value={railingMeters} onChange={setRailingMeters} /><Toggle label="Подступенки" value={risers} onChange={setRisers} /></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><Toggle label="Монтаж" value={installation} onChange={setInstallation} /><Toggle label="Замер" value={measurement} onChange={setMeasurement} />{cityMode === "ALMATY" && <Toggle label="Доставка по Алматы" value={almatyDelivery} onChange={setAlmatyDelivery} />}</div>

          {cityMode === "OTHER" && <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"><h4 className="font-semibold text-white">Доставка</h4><div className="mt-3 grid gap-2">{(["OPTION_1", "OPTION_2", "NONE"] as DeliveryOption[]).map((option) => <label key={option} className="flex min-h-11 items-center gap-3 rounded-lg bg-slate-900 px-3 text-sm text-slate-200"><input type="radio" name="deliveryOption" checked={deliveryOption === option} onChange={() => setDeliveryOption(option)} className="size-5" /><span>{option === "NONE" ? "Без доставки" : `${option === "OPTION_1" ? "Вариант 1" : "Вариант 2"} — ${money(deliveryPrices[option])}`}</span></label>)}</div></div>}

          <button type="button" onClick={() => setAdvanced((value) => !value)} className="mt-4 min-h-11 text-sm font-semibold text-blue-300">{advanced ? "Скрыть дополнительные параметры" : "Дополнительные параметры"}</button>{advanced && <div className="mt-3 grid gap-3 rounded-lg bg-slate-900 p-3 sm:grid-cols-2"><NumberField label="Латунные балясины, шт." value={brassCount} onChange={setBrassCount} /><NumberField label="Поручень, м" value={handrailMeters} onChange={setHandrailMeters} /><Toggle label="Покраска" value={painting} onChange={setPainting} /></div>}

          <div className="mt-5"><div className="flex items-center gap-2"><h4 className="font-semibold text-white">Три варианта</h4>{previewing && <LoaderCircle className="animate-spin text-blue-300" size={17} />}</div><div className="mt-3 grid gap-2 sm:grid-cols-3">{materials.map((material) => { const option = preview.find((item) => item.material === material); return <div key={material} className="rounded-lg bg-slate-900 p-3 text-center"><p className="text-sm text-slate-400">{material}</p><strong className="mt-1 block text-lg text-white">{option ? money(option.clientPrice) : "—"}</strong></div>; })}</div></div>
        </section>
        <button disabled={saving || working || previewing || preview.length !== 3} className="mt-6 min-h-12 w-full rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-60">{working ? "Создаём заявку, расчёты и КП…" : "Создать заявку и КП"}</button>
      </form>}
    </div>
  </div>;
}

function Success({ proposal, onClose }: { proposal: Proposal; onClose: () => void }) {
  const pdf = `/api/proposals/${proposal.id}/pdf`;
  const delivery = proposal.deliveryOption === "NONE" ? "Без доставки" : `${proposal.deliveryOption === "OPTION_1" ? "Вариант 1" : "Вариант 2"} — ${money(proposal.deliveryCharge)}`;
  return <section className="mt-6"><div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5"><CheckCircle2 className="text-emerald-300" /><h3 className="mt-3 text-2xl font-bold text-white">Заявка создана</h3><p className="mt-1 text-emerald-200">КП №{proposal.number}</p><p className="mt-2 text-sm text-emerald-100">Доставка: {delivery}</p></div><div className="mt-4 grid gap-3 sm:grid-cols-3">{proposal.options.map((option) => <article key={option.id} className="rounded-xl bg-slate-900 p-4"><p className="text-sm text-slate-400">{option.material}</p><strong className="mt-2 block text-xl text-white">{money(option.clientPrice)}</strong></article>)}</div><div className="mt-5 grid gap-2 sm:grid-cols-2"><a href={pdf} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white"><ExternalLink size={17} />Открыть PDF</a><a href={`${pdf}?download=1`} className="grid min-h-12 place-items-center rounded-xl bg-slate-700 font-semibold text-white">Скачать PDF</a><button onClick={async () => { const response = await fetch(`/api/proposals/${proposal.id}/send`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: "{}" }); const body = await response.json() as { error?: string }; window.alert(response.ok ? "КП отправлено в WhatsApp" : body.error ?? "WhatsApp API не подключён. Скачайте PDF и отправьте вручную."); }} className="min-h-12 rounded-xl bg-emerald-700 font-semibold text-white">Отправить в WhatsApp</button><a href={`/clients/${proposal.clientId}`} className="grid min-h-12 place-items-center rounded-xl border border-slate-700 font-semibold text-white">Открыть заявку</a><button onClick={onClose} className="min-h-12 rounded-xl border border-slate-700 font-semibold text-white sm:col-span-2">Закрыть</button></div></section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm text-slate-300">{label}{children}</label>; }
function Counter({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (value: number) => void }) { return <div><p className="text-sm text-slate-300">{label}</p><div className="mt-1 grid grid-cols-[44px_1fr_44px] gap-2"><button type="button" onClick={() => onChange(Math.max(min, value - 1))} className="min-h-11 rounded-lg bg-slate-800 text-white">−</button><output className="grid min-h-11 place-items-center rounded-lg bg-slate-950 font-semibold text-white">{value}</output><button type="button" onClick={() => onChange(value + 1)} className="min-h-11 rounded-lg bg-slate-800 text-white">+</button></div></div>; }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="text-sm text-slate-300">{label}<input type="number" inputMode="decimal" min={0} step="0.5" value={value} onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-white" /></label>; }
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) { return <label className="flex min-h-11 items-center justify-between rounded-lg bg-slate-900 px-3 text-sm text-slate-200"><span>{label}</span><input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} className="size-5" /></label>; }
