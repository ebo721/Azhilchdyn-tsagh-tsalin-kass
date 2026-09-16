import app from "./app.js";
import { bootstrapCanonicalUsers } from "./routes/auth.js";

await bootstrapCanonicalUsers();

export default app;
