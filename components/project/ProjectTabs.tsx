const tabs = [
    "Информация",
    "Замер",
    "КП",
    "Договор",
    "Финансы",
    "Производство",
    "Монтаж",
    "Документы",
    "История",
  ];
  
  type Props = {
    active?: string;
  };
  
  export default function ProjectTabs({
    active = "Информация",
  }: Props) {
    return (
      <div className="rounded-2xl border bg-white p-4 shadow">
        <div className="flex flex-wrap gap-3">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={`rounded-lg px-5 py-2 transition ${
                tab === active
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>
    );
  }