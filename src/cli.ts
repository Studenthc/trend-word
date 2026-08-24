import { runRadar } from "./index.js";

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const result = await runRadar({ date });
process.stdout.write(result.report);
