import { Prisma, Role } from "@prisma/client";

const prefixes: Record<Role, string> = {
  DIRECTOR: "DIR",
  MARKETER: "MKT",
  MANAGER: "MGR",
  ACCOUNTANT: "ACC",
  MEASURER: "MEA",
  DESIGNER: "DES",
  PARTNER: "PAR",
  PRODUCTION: "PRO",
  INSTALLER: "INS",
};

async function nextRoleNumber(tx: Prisma.TransactionClient, role: Role) {
  let rows: Array<{ value: bigint }>;
  switch (role) {
    case Role.DIRECTOR:
      rows = await tx.$queryRaw`SELECT nextval('employee_code_dir_seq')::bigint AS value`;
      break;
    case Role.MARKETER:
      rows = await tx.$queryRaw`SELECT nextval('employee_code_mkt_seq')::bigint AS value`;
      break;
    case Role.MANAGER:
      rows = await tx.$queryRaw`SELECT nextval('employee_code_mgr_seq')::bigint AS value`;
      break;
    case Role.ACCOUNTANT:
      rows = await tx.$queryRaw`SELECT nextval('employee_code_acc_seq')::bigint AS value`;
      break;
    case Role.MEASURER:
      rows = await tx.$queryRaw`SELECT nextval('employee_code_mea_seq')::bigint AS value`;
      break;
    case Role.DESIGNER:
      rows = await tx.$queryRaw`SELECT nextval('employee_code_des_seq')::bigint AS value`;
      break;
    case Role.PARTNER:
      rows = await tx.$queryRaw`SELECT nextval('employee_code_par_seq')::bigint AS value`;
      break;
    case Role.PRODUCTION:
      rows = await tx.$queryRaw`SELECT nextval('employee_code_pro_seq')::bigint AS value`;
      break;
    case Role.INSTALLER:
      rows = await tx.$queryRaw`SELECT nextval('employee_code_ins_seq')::bigint AS value`;
      break;
  }
  if (!rows[0]) throw new Error("EMPLOYEE_CODE_SEQUENCE_UNAVAILABLE");
  return Number(rows[0].value);
}

export async function allocateEmployeeCode(
  tx: Prisma.TransactionClient,
  role: Role,
) {
  const value = await nextRoleNumber(tx, role);
  return `${prefixes[role]}-${String(value).padStart(4, "0")}`;
}

export async function ensureEmployeeCode(
  tx: Prisma.TransactionClient,
  userId: number,
) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { employeeCode: true, role: true },
  });
  if (!user) throw new Error("USER_NOT_FOUND");
  if (user.employeeCode) return user.employeeCode;
  const candidate = await allocateEmployeeCode(tx, user.role);
  await tx.user.updateMany({
    where: { id: userId, employeeCode: null },
    data: { employeeCode: candidate },
  });
  const updated = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { employeeCode: true },
  });
  if (!updated.employeeCode) throw new Error("EMPLOYEE_CODE_UNAVAILABLE");
  return updated.employeeCode;
}
