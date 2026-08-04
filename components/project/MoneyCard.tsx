type Props = {
    title: string;
    value: string;
    color: string;
  };
  
  export default function MoneyCard({
    title,
    value,
    color,
  }: Props) {
    return (
      <div className="rounded-2xl border bg-white p-6 shadow">
  
        <p className="text-gray-500">
          {title}
        </p>
  
        <h2 className={`mt-3 text-3xl font-bold ${color}`}>
          {value}
        </h2>
  
      </div>
    );
  }