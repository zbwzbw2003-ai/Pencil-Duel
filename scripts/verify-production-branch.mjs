import { execFileSync } from "node:child_process";

const run = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (run("status", "--porcelain")) throw new Error("Production deployment requires a clean worktree.");
run("fetch", "--no-tags", "origin", "main");
if (run("rev-parse", "HEAD") !== run("rev-parse", "origin/main")) {
  throw new Error("Production deployment must use the exact origin/main commit.");
}
console.log("Production branch contract passed.");
