import { Prisma } from '../generated/prisma/client.js';

// Callers supply the WHOLE transaction, never an individual failed statement.
export async function retryTransaction<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      const adapter =
        error instanceof Prisma.PrismaClientKnownRequestError
          ? (error.meta?.driverAdapterError as
              { cause?: { originalCode?: string } } | undefined)
          : undefined;
      const sqlState =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        typeof error.meta?.code === 'string'
          ? error.meta.code
          : adapter?.cause?.originalCode;
      if (
        attempt < 4 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' ||
          (error.code === 'P2010' &&
            ['40P01', '40001'].includes(sqlState ?? '')))
      )
        continue;
      throw error;
    }
  }
}
