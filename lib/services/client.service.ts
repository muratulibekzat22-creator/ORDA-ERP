import { prisma } from "@/lib/prisma";

export async function getClients() {
  return prisma.client.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function getClient(id: number) {
  return prisma.client.findUnique({
    where: {
      id,
    },
    include: {
      orders: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });
}

export async function createClient(data: {
  name: string;
  phone: string;
  city: string;
  manager: string;
  amount: string;
  status: string;
}) {
  return prisma.client.create({
    data,
  });
}

export async function updateClient(
  id: number,
  data: {
    name: string;
    phone: string;
    city: string;
    manager: string;
    amount: string;
    status: string;
  }
) {
  return prisma.client.update({
    where: {
      id,
    },
    data,
  });
}

export async function deleteClient(id: number) {
  return prisma.client.delete({
    where: {
      id,
    },
  });
}