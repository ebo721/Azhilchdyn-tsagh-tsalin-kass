---
name: Notebook post-execution errors
description: Memory-limit errors can occur after tool callbacks already performed their writes.
---

If CodeExecution reports a notebook memory limit during capture after printing successful results, treat its side effects as potentially completed. Verify existing results before retrying GitHub branch/PR creation or other writes.

**Why:** A memory-capture failure occurred after local commit and GitHub PR creation had succeeded. Repeating the block would repeat completed operations despite the tool reporting failure.

**How to apply:** Use the printed confirmation or a read-only remote lookup; do not blindly repeat writes. Avoid retaining large generated files, repository trees, and raw callback results across notebook calls.
