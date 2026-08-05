"use client";
import { useState } from "react";
import DocumentsTab from "./tabs/DocumentsTab";
import FilesTab from "./tabs/FilesTab";
import FinanceTab from "./tabs/FinanceTab";
import GeneralInfoTab from "./tabs/GeneralInfoTab";
import HistoryTab from "./tabs/HistoryTab";
import MaterialsTab from "./tabs/MaterialsTab";
import MeasurementsTab from "./tabs/MeasurementsTab";
import PartnerTab from "./tabs/PartnerTab";
import ProductionTab from "./tabs/ProductionTab";
import type { OrderTabData } from "./tabs/types";
const tabs=[ ["general","Общая информация"],["finance","Финансы"],["measurements","Замеры"],["materials","Материалы"],["production","Производство"],["partner","Цех"],["documents","Документы"],["history","История"],["files","Файлы"] ] as const;
type TabId=(typeof tabs)[number][0];
export default function OrderTabs({order}:{order:OrderTabData}){const [activeTab,setActiveTab]=useState<TabId>("general");return <div className="space-y-6"><div className="flex flex-wrap gap-2 rounded-2xl border border-slate-700 bg-[#101827] p-3">{tabs.map(([id,title])=><button key={id} type="button" onClick={()=>setActiveTab(id)} className={`rounded-xl px-4 py-2 text-sm font-medium transition ${activeTab===id?"bg-blue-600 text-white":"text-slate-300 hover:bg-slate-800"}`}>{title}</button>)}</div>{activeTab==="general"&&<GeneralInfoTab order={order}/>} {activeTab==="finance"&&<FinanceTab order={order}/>} {activeTab==="measurements"&&<MeasurementsTab order={order}/>} {activeTab==="materials"&&<MaterialsTab orderId={order.id}/>} {activeTab==="production"&&<ProductionTab order={order}/>} {activeTab==="partner"&&<PartnerTab order={order}/>} {activeTab==="documents"&&<DocumentsTab orderId={order.id}/>} {activeTab==="history"&&<HistoryTab order={order}/>} {activeTab==="files"&&<FilesTab orderId={order.id}/>}</div>}
