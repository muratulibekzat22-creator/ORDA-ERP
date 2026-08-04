import InfoCard from "./InfoCard";

type Props = {
  client: {
    name: string;
    phone: string;
    city: string;
  };

  address: string;
  material: string;
  staircase: string;
  manager: string;
  created: string;
};

export default function ProjectInfo({
  client,
  address,
  material,
  staircase,
  manager,
  created,
}: Props) {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">

      <InfoCard
        title="Клиент"
        value={client.name}
      />

      <InfoCard
        title="Телефон"
        value={client.phone}
      />

      <InfoCard
        title="Город"
        value={client.city}
      />

      <InfoCard
        title="Адрес"
        value={address}
      />

      <InfoCard
        title="Материал"
        value={material}
      />

      <InfoCard
        title="Тип лестницы"
        value={staircase}
      />

      <InfoCard
        title="Менеджер"
        value={manager}
      />

      <InfoCard
        title="Дата создания"
        value={created}
      />

    </div>
  );
}