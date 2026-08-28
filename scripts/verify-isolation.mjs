import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));

if (config.name !== "pencil-duel-online") throw new Error(`Unexpected Worker target: ${config.name}`);
if (Object.hasOwn(config, "routes") || Object.hasOwn(config, "route")) {
  throw new Error("Pencil Duel must not own Cloudflare zone routes.");
}
if (config.workers_dev !== false || config.preview_urls !== false) {
  throw new Error("Pencil Duel must only be reachable through the platform router.");
}
const scripts = JSON.stringify(packageJson.scripts ?? {});
if (scripts.includes(["pages", "deploy"].join(" ")) || scripts.includes("--project-name=photonplanet")) {
  throw new Error("Pencil Duel must never deploy the Photon Planet Pages project.");
}

console.log("Pencil Duel deployment isolation contract passed.");
