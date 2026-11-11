import "dotenv/config";
import { applyMigrations } from "../server/migrate";

const db = process.env.APERTURE_DB || "data.db";
const result = applyMigrations(db);
console.log(`migrations applied to ${db} (${result.applied.join(", ") || "none"})`);
