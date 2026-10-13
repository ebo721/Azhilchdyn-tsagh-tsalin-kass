---
name: Meal planning scope
description: The user does not want a food-versus-break selector in meal planning.
---

Хоол төлөвлөх хэсэгт «Төрөл — Хоол / Завсарлага» сонголт хэрэггүй. Шинэ хуваарь шууд хоол сонгох урсгалтай байна.

**Why:** The user explicitly asked to remove this unnecessary choice, separately from the meal classifications (set, packed, therapeutic).

**How to apply:** Do not reintroduce the food-versus-break selector unless requested. Removing this UI is not permission to delete or convert historical break entries; preserve those records and existing API compatibility.

## Scheduled meal information

Хуваарьт орсон ч хоолны мэдээллийг засаж болдог байна. Menu edits update the linked meal, not the schedule's selected IDs or its original planned type.

**Why:** The user explicitly requested editing scheduled meals. Automatically rewriting whole schedule groups could change unrelated meals or historical classifications.

**How to apply:** Retain an entry's previously selected meals even if their current type or active status changes. The exception applies only to that entry while its planned type is unchanged; new selections and new entries still follow the chosen type. Do not broaden technologist permissions beyond existing approval flows.
