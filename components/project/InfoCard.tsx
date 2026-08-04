type Props = {
    title: string;
    value: string;
  };
  
  export default function InfoCard({
    title,
    value,
  }: Props) {
    return (
      <div className="rounded-2xl border bg-white p-5 shadow">
  
        <p className="text-sm text-gray-500">
          {title}
        </p>
  
        <h2 className="mt-2 text-xl font-bold break-words">
          {value}
        </h2>
  
      </div>
    );
  }