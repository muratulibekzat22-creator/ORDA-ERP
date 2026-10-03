import { Prisma } from "@prisma/client";

type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
};

export function isPrismaTransactionWriteConflict(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  )
    return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    cause?: { kind?: unknown };
    message?: unknown;
  };
  return (
    candidate.code === "P2034" ||
    candidate.cause?.kind === "TransactionWriteConflict" ||
    (typeof candidate.message === "string" &&
      /write conflict|deadlock/i.test(candidate.message))
  );
}

export async function withPrismaTransactionRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
) {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 25);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !isPrismaTransactionWriteConflict(error) ||
        attempt === maxAttempts - 1
      )
        throw error;
      const delayMs = baseDelayMs * 2 ** attempt;
      if (delayMs > 0)
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error("TRANSACTION_RETRY_EXHAUSTED");
}
