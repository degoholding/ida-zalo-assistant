import { loadConfig } from "../config.js";
import { runMigrations } from "./migrate.js";

const applied = await runMigrations(loadConfig().databaseUrl);
console.log(applied.length ? `Đã chạy: ${applied.join(", ")}` : "Không có migration mới.");
