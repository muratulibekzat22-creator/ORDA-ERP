type Props = {
    order: {
      number: string;
      status: string;
    };
  };
  
  export default function ProjectHeader({
    order,
  }: Props) {
    return (
      <div className="rounded-2xl border bg-white p-8 shadow">
  
        <div className="flex items-center justify-between">
  
          <div>
  
            <h1 className="text-3xl font-bold">
              {order.number}
            </h1>
  
            <p className="mt-2 text-gray-500">
              Карточка проекта ORDA ERP
            </p>
  
          </div>
  
          <div className="rounded-full bg-green-100 px-5 py-2 font-semibold text-green-700">
            {order.status}
          </div>
  
        </div>
  
      </div>
    );
  }