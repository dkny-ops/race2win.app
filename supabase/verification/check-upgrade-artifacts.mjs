import fs from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(fs.readFileSync(new URL("./upgrade-manifest.json", import.meta.url)));
for (const item of manifest.migrations) {
  const sql = fs.readFileSync(root + "/migrations/" + item.file, "utf8").replace(/\r/g, "").trim();
  const actual = createHash("sha256").update(sql).digest("hex");
  if (actual !== item.sha256NormalizedSql) throw new Error("STOP: migration content changed: " + item.file);
}
console.log("PASS pinned SQL contents; target TEST " + manifest.projectRef);

