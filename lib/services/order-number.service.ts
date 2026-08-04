import { prisma } from "@/lib/prisma";

export async function generateOrderNumber() {
  const today = new Date();

  const year = String(today.getFullYear()).slice(2);
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  const prefix = `AS-${year}${month}${day}`;

  const count = await prisma.order.count({
    where: {
      number: {
        startsWith: prefix,
      },
    },
  });

  const sequence = String(count + 1).padStart(3, "0");

  return `${prefix}-${sequence}`;
}