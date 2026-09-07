# Ажилчдын цаг, цалин, касс

Жижиг бизнесийн ажилчдын ирц, цалин, кассын орлого зарлагыг нэг дор удирдах дотоод ажиллагааны веб апп.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API-ийн цорын ганц эх сурвалж; өөрчилсний дараа codegen ажиллуулна
- `lib/db/src/schema/index.ts` — ажилтан, ирц, кассын PostgreSQL хүснэгтүүд
- `artifacts/api-server/src/routes/operations.ts` — dashboard, ажилтан, ирц, payroll, кассын endpoint-ууд
- `artifacts/staff-ops/src/App.tsx` — Монгол хэл дээрх үндсэн веб интерфэйс
- `artifacts/staff-ops/src/index.css` — deep-teal / warm-gold үйл ажиллагааны өнгөний систем

## Architecture decisions

- Цалингийн сарын дүнг тусдаа хадгалах хүснэгтгүйгээр ирц ба ажилтны үндсэн цалингаас тухайн сарын байдлаар тооцно.
- Эхний хувилбар нь сарын болон цагийн цалингийн хоёр төрлийг дэмжиж, нийт дүнгийн 10%-ийг үндсэн суутгал гэж тооцно.
- API contract нь OpenAPI-оор эхэлж, frontend нь Orval-оор үүсгэсэн React Query hook-уудыг ашиглана.

## Product

- Өдрийн dashboard: ажилтны тоо, өнөөдрийн ирц, сарын цалин, кассын үлдэгдэл, сүүлийн хөдөлгөөн.
- Ажилтан нэмэх, засах, идэвхгүй болгох/устгах.
- Ирцийн огноо, цаг, статус бүртгэх; сарын ирцээр payroll тооцох.
- Сонгосон сарын 1-нээс сүүлийн өдөр хүртэлх ирцийн календарь дээр 8 цаг, 12 цаг, Чөлөө сонгон бүртгэх.
- Цагийн баланс дээр ажилтан бүрийн сарын нийт цаг, ээлж болон чөлөөний задаргааг харах.
- Кассын орлого, зарлага нэмэх; нийт болон өнөөдрийн дүнг харах.

## User preferences

Монгол хэл дээрх, жижиг бизнесийн өдөр тутмын хэрэглээнд ойлгомжтой интерфэйс.

## Gotchas

- `lib/api-spec/openapi.yaml` өөрчлөгдвөл `pnpm --filter @workspace/api-spec run codegen`-г заавал дахин ажиллуулна.
- Үйлчилгээний замуудыг гараар localhost гэж хатуу кодлохгүй; artifact workflow-ийн proxy замыг ашиглана.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
