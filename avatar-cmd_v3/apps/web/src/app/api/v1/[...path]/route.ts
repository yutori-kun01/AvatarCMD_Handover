// 外部 AI 用 API v1（API キー認証・権限・レート制限・二重実行防止・監査ログは handleApiV1 が行う）。仕様: docs/API_V1.md
import { handleApiV1 } from "@avatar-cmd/integrations/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = (req: Request) => handleApiV1(req);
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
