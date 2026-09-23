---
name: Internal Express dispatch
description: Correct boundary for executing approved operations through an in-process HTTP server.
---

When an approved action is re-entered through a temporary in-process HTTP server, mount the target router on an Express application and serve that application. Do not invoke a bare Express Router directly with raw Node request and response objects.

**Why:** A raw Node response does not have Express response methods such as `status()` and `json()`. Calling the router directly can turn a valid approved action into an opaque HTTP 500.

**How to apply:** Build a small Express app, mount the same authentication middleware and domain router used by normal requests, then pass the app to `createServer`. Keep the approval cookie and request identifier on the internal request.