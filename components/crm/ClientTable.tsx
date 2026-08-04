type Client = {
    id: number;
    name: string;
    phone: string;
    city: string;
    status: string;
  };
  
  interface ClientTableProps {
    clients: Client[];
  }
  
  export default function ClientTable({
    clients,
  }: ClientTableProps) {
    return (
      <div className="overflow-hidden rounded-2xl bg-white shadow">
  
        <table className="w-full">
  
          <thead className="bg-gray-100">
  
            <tr>
  
              <th className="p-4 text-left">Клиент</th>
              <th className="p-4 text-left">Телефон</th>
              <th className="p-4 text-left">Город</th>
              <th className="p-4 text-left">Статус</th>
              <th className="p-4 text-center">Действие</th>
  
            </tr>
  
          </thead>
  
          <tbody>
  
            {clients.map((client) => (
  
              <tr
                key={client.id}
                className="border-t hover:bg-gray-50"
              >
  
                <td className="p-4 font-medium">
                  {client.name}
                </td>
  
                <td className="p-4">
                  {client.phone}
                </td>
  
                <td className="p-4">
                  {client.city}
                </td>
  
                <td className="p-4">
                  {client.status}
                </td>
  
                <td className="p-4 text-center">
  
                  <button className="rounded-lg bg-black px-4 py-2 text-white hover:bg-gray-800">
                    Открыть
                  </button>
  
                </td>
  
              </tr>
  
            ))}
  
          </tbody>
  
        </table>
  
      </div>
    );
  }