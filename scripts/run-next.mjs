import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
if (command !== "dev" && command !== "build") {
  console.error("Usage: node scripts/run-next.mjs <dev|build> [next options]");
  process.exit(1);
}

function formatTaiwanTimestamp(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );

  return `${parts.year}.${parts.month}.${parts.day}-${parts.hour}:${parts.minute}:${parts.second}`;
}

const configuredVersion = process.env.NEXT_PUBLIC_BUILD_VERSION?.trim();
process.env.NEXT_PUBLIC_BUILD_VERSION = configuredVersion || formatTaiwanTimestamp(new Date());

const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const result = spawnSync(process.execPath, [nextCli, command, ...process.argv.slice(3)], {
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`Unable to start Next.js: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
