"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
type Data = any;
const money=(n:number)=>`${n.toLocaleString("ru-RU")} ₸`;
export default function AnalyticsPage(){
 const [data,setData]=useState<Data|null>(null); const [f,setF]=useState({period:"all",manager:"",partnerId:"",city:"",status:""});
 useEffect(()=>{const p=new URLSearchParams(f); let active=true; void fetch(`/api/analytics?${p}`).then(r=>r.json()).then(x=>active&&setData(x)); return()=>{active=false};},[f]);
 const set=(key:keyof typeof f,value:string)=>setF(x=>({...x,[key]:value}));
 if(!data)return <section className="p-8 text-slate-400">Загрузка аналитики...</section>;
 const cards=[["Заявки",data.kpi.leads],["Замеры",data.kpi.measurements],["Договоры",data.kpi.contracts],["Сумма договоров",money(data.kpi.contractAmount)],["Получено оплат",money(data.kpi.received)],["Прибыль",money(data.kpi.profit)],["Средний чек",money(data.kpi.averageCheck)],["Конверсия",`${data.kpi.conversion}%`]];
 return <section className="space-y-8 p-8"><div><h1 className="text-3xl font-bold text-white">Аналитика директора</h1><p className="text-slate-400">ORDA ERP · реальные данные</p></div>
 <div className="grid gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-4 md:grid-cols-2 xl:grid-cols-5">{[["period","Период",["all","month","quarter","year"]],["manager","Менеджер",["",...data.filters.managers]],["partnerId","Партнёр",["",...data.filters.partners.map((x:any)=>String(x.id))]],["city","Город",["",...data.filters.cities]],["status","Статус",["",...data.filters.statuses]]].map(([key,label,values]:any)=><label key={key} className="text-sm text-slate-300">{label}<select value={(f as any)[key]} onChange={e=>set(key,e.target.value)} className="mt-1 w-full rounded-lg bg-slate-900 p-2 text-white">{values.map((v:string)=><option key={v} value={v}>{v||"Все"}</option>)}</select></label>)}</div>
 <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{cards.map(([t,v])=><Card key={t} t={t} v={v}/>)}</div>
 <Panel title="Воронка">{data.funnel.map((x:any)=><div key={x.stage} className="mb-3"><div className="flex justify-between text-sm text-white"><span>{x.stage}: {x.count}</span><span>{x.share}% · {money(x.amount)}</span></div><div className="mt-1 h-2 rounded bg-slate-800"><div className="h-2 rounded bg-blue-500" style={{width:`${x.share}%`}}/></div></div>)}</Panel>
 <Table title="Менеджеры" heads={["Менеджер","Заявки","Договоры","Сумма","Получено","Прибыль","Конверсия","Средний чек"]} rows={data.byManager.map((x:any)=>[x.manager,x.leads,x.contracts,money(x.amount),money(x.received),money(x.profit),`${x.conversion}%`,money(x.averageCheck)])}/>
 <Table title="Партнёры" heads={["Партнёр","Заказы","Сумма","Выплачено","Остаток","Прибыль"]} rows={data.byPartner.map((x:any)=>[x.partner,x.count,money(x.amount),money(x.paid),money(x.balance),money(x.profit)])}/>
 <Panel title="Динамика по месяцам"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[["Выручка","revenue"],["Прибыль","profit"],["Новые заявки","leads"],["Договоры","contracts"]].map(([title,key])=><div key={key}><p className="mb-2 text-slate-300">{title}</p>{data.months.map((x:any)=><div key={x.month} className="flex justify-between text-sm text-slate-400"><span>{x.month}</span><span>{key==="revenue"||key==="profit"?money(x[key]):x[key]}</span></div>)}</div>)}</div></Panel></section>;
}
function Card({t,v}:{t:string;v:string|number}){return <div className="rounded-2xl border border-slate-700 bg-[#101827] p-5"><p className="text-slate-400">{t}</p><p className="mt-2 text-2xl font-bold text-green-400">{v}</p></div>}
function Panel({title,children}:{title:string;children:React.ReactNode}){return <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6"><h2 className="mb-5 text-xl font-bold text-white">{title}</h2>{children}</div>}
function Table({title,heads,rows}:{title:string;heads:string[];rows:(string|number)[][]}){return <Panel title={title}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{heads.map(h=><th key={h} className="p-2 text-left text-slate-400">{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i} className="border-t border-slate-700">{r.map((v,j)=><td key={j} className="p-2 text-white">{v}</td>)}</tr>)}</tbody></table></div></Panel>}
