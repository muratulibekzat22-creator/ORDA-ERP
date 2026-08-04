import MoneyCard from "./MoneyCard";

type Props = {
  amount: string;
  prepayment: string;
  balance: string;
};

export default function ProjectFinance({
  amount,
  prepayment,
  balance,
}: Props) {
  return (
    <div className="grid gap-5 md:grid-cols-3">

      <MoneyCard
        title="Стоимость проекта"
        value={`${amount} ₸`}
        color="text-blue-600"
      />

      <MoneyCard
        title="Предоплата"
        value={`${prepayment} ₸`}
        color="text-green-600"
      />

      <MoneyCard
        title="Остаток"
        value={`${balance} ₸`}
        color="text-red-600"
      />

    </div>
  );
}