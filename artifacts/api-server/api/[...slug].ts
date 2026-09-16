import type { VercelRequest, VercelResponse } from "@vercel/node";
import app from "../src/app.js";
import { bootstrapCanonicalUsers } from "../src/routes/auth.js";

// Runs once per cold start (module stays warm across invocations on the same instance).
const ready = bootstrapCanonicalUsers();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ready;
  // Express apps are plain (req, res) => void handlers, so we can hand Vercel's
  // request/response straight to it. The catch-all filename ([...slug].ts under
  // /api) makes Vercel route every /api/* path to this one function, matching
  // the app's internal `app.use("/api", router)` mount point.
  return app(req as never, res as never);
}
