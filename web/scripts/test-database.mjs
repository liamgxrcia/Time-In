import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
const web = fileURLToPath(new URL("..", import.meta.url));
const root = resolve(web, "..");
const bin = process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
const directory = await mkdtemp(join(tmpdir(), "timein-db-test-"));
const port = String(56000 + Math.floor(Math.random() * 3000));
let started = false;
const run = (command, args) =>
  execFileSync(join(bin, command), args, { stdio: "pipe" });
try {
  run("initdb", ["-D", join(directory, "data"), "-A", "trust", "--no-locale"]);
  run("pg_ctl", [
    "-D",
    join(directory, "data"),
    "-l",
    join(directory, "server.log"),
    "-o",
    `-p ${port} -h 127.0.0.1`,
    "start",
  ]);
  started = true;
  run("createdb", ["-h", "127.0.0.1", "-p", port, "timein_test"]);
  const url = `postgresql://${process.env.USER}@127.0.0.1:${port}/timein_test`;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(
    await readFile(join(root, "tests/database/bootstrap.sql"), "utf8"),
  );
  const migrations = (await readdir(join(root, "supabase/migrations")))
    .filter((x) => x.endsWith(".sql"))
    .sort();
  for (const file of migrations)
    await client.query(
      await readFile(join(root, "supabase/migrations", file), "utf8"),
    );
  console.log(
    `Applied ${migrations.length} migrations to fresh PostgreSQL database.`,
  );
  await client.end();
  execFileSync(
    process.execPath,
    [
      join(web, "node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      "vitest.backend.config.mts",
    ],
    {
      cwd: web,
      stdio: "inherit",
      env: { ...process.env, TEST_DATABASE_URL: url },
    },
  );
  const seeded = new pg.Client({ connectionString: url });
  await seeded.connect();
  await seeded.query("set app.seed_ceo='11111111-1111-4111-8111-111111111111'");
  const seed = await readFile(join(root, "supabase/seed.sql"), "utf8");
  await seeded.query(seed);
  await seeded.query(seed);
  console.log("Fictional seed applied twice; idempotent seed verified.");
  await seeded.end();
  execFileSync(
    process.execPath,
    [join(web, "scripts/generate-database-types.mjs")],
    {
      cwd: web,
      stdio: "inherit",
      env: { ...process.env, TEST_DATABASE_URL: url },
    },
  );
} finally {
  if (started)
    run("pg_ctl", ["-D", join(directory, "data"), "-m", "immediate", "stop"]);
  await rm(directory, { recursive: true, force: true });
}
