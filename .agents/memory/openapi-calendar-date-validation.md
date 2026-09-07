---
name: OpenAPI calendar-date validation
description: How to validate real calendar dates without generating invalid Zod code.
---

Use an OpenAPI string pattern for the `YYYY-MM-DD` shape, then validate the real calendar date at the API route boundary with a UTC round-trip.

**Why:** The current Orval Zod generator turns a string field with both `format: date` and `pattern` into `zod.coerce.date().regex(...)`, which does not compile. `format: date` alone also does not enforce every real calendar date as needed by the API.

**How to apply:** For API inputs that must reject nonexistent dates while accepting leap days, keep format/shape constraints generator-safe and perform year/month/day equality checks after constructing the UTC date.