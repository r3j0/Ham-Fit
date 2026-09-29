import { createRequire } from "node:module";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
/** Test-only fixture: copy a real recommendation to today in an explicitly opted-in temp DB.
 * Production API deliberately cannot generate today's routine. No trigger or runtime code is changed.
 */
export async function seedDueRoutine(
  routineId: string,
  userId: string,
  day: string,
) {
  if (process.env.E2E_ALLOW_TEST_SEED !== "1" || !process.env.E2E_BACKEND_ROOT)
    throw new Error(
      "Playback integration requires E2E_ALLOW_TEST_SEED=1 and an isolated E2E_BACKEND_ROOT under the system temporary directory.",
    );
  const root = await realpath(process.env.E2E_BACKEND_ROOT);
  const tempRoots = await Promise.all([realpath("/tmp"), realpath(tmpdir())]);
  if (!tempRoots.some((base) => root.startsWith(`${base}${path.sep}`)))
    throw new Error("Refusing to seed outside the isolated temporary backend.");
  const require = createRequire(path.join(root, "package.json"));
  const dotenv = require("dotenv") as {
    parse: (s: string) => Record<string, string>;
  };
  const env = dotenv.parse(await readFile(path.join(root, ".env"), "utf8"));
  const url = new URL(env.DATABASE_URL);
  if (
    env.NODE_ENV !== "development" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.pathname.endsWith("/project_health")
  )
    throw new Error(
      "Only the isolated local development database may be seeded.",
    );
  const { Client } = require("pg") as {
    Client: new (options: { connectionString: string }) => {
      connect: () => Promise<void>;
      end: () => Promise<void>;
      query: (
        sql: string,
        values?: unknown[],
      ) => Promise<{ rows: { id: string }[] }>;
    };
  };
  const client = new Client({ connectionString: url.href });
  await client.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query(
      `INSERT INTO workout_routines (user_id,assignment_date,reference_date,algorithm_version,data_version,estimated_minutes,input_snapshot,weight_adjustment)
      SELECT user_id,$1::date,$1::date-1,algorithm_version,data_version,estimated_minutes,input_snapshot,weight_adjustment FROM workout_routines
      WHERE id=$2 AND user_id=$3 AND EXISTS(SELECT 1 FROM users WHERE id=$3 AND email LIKE 'workout-e2e-%@example.test') RETURNING id`,
      [day, routineId, userId],
    );
    if (row.rows.length !== 1)
      throw new Error(
        "Only this test user's generated recommendation may be copied.",
      );
    const id = row.rows[0].id;
    await client.query(
      `INSERT INTO workout_routine_items (routine_id,"order",video_id,title,video_url,duration_seconds,slot,prescription)
      SELECT $1,"order",video_id,title,video_url,duration_seconds,slot,prescription FROM workout_routine_items WHERE routine_id=$2`,
      [id, routineId],
    );
    await client.query("COMMIT");
    return id;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}
