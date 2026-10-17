import type { ApiRoute } from "./api-route.js";

// Khóa MCP (17/10/2026): khung rỗng — phase 5 điền danh sách / tạo / thu hồi (`/api/mcp-keys`). Luật quyền đã khai sẵn
// ở route-permissions.ts; khai sẵn ở đây để phase 4 / 5 không sửa chung api-router.ts.
export const mcpKeyRoutes: ApiRoute[] = [];
