import { Client, InMemoryTransport, SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import type { DataAccessContext } from "../../data-access/data-access-context.js";
import { ALL_TOOLS } from "../../data-access/read-tool-catalog.js";
import type { AnyToolDefinition, AssistantFamily } from "../../data-access/tool-definition.js";
import { assistantFamilyInstructions, buildAssistantMcpServer, type AssistantMcpServerDeps, type AssistantSurface } from "../../mcp/assistant-mcp-server.js";
import { ERROR_META_KEY } from "../../mcp/mcp-meta-keys.js";
import { createLogger, describeError } from "../../logger.js";
import { ALERT_TOOLS_REMOVED_BY_FAMILY } from "../alert-tools.js";
import type { CallToolResultLike } from "./mcp-call-result-mapper.js";
import type { McpToolInfo } from "./mcp-declaration-adapter.js";

// Phiên MCP của MỘT lượt trợ lý: client SDK thật ⇄ cặp `InMemoryTransport` ⇄ `McpServer` dựng riêng cho lượt (mọi lời gọi là JSON-RPC thật,
// không đường tắt). Mở LƯỜI: chỉ khi lượt thực sự cần (họ bật + có công cụ), tối đa hai phiên (mô hình / lệnh), `close()` trong `finally`.
// Một lượt không bao giờ mở lại phiên đã hỏng: lỗi mở = «phiên không có công cụ nào» ⇒ lượt chạy đường cũ (không tự lùi giữa chừng — T2).

const log = createLogger("assistant");

/** Trần thực thi một công cụ phía client (chưa có trần phía máy chủ): lời gọi chờ tối đa «chờ cổng + trần này» rồi coi là quá hạn. */
const TOOL_EXECUTION_CAP_MS = 90_000;
/** Mã lỗi `_meta` của lời gọi GHI quá hạn phía client: kết quả chưa rõ (máy chủ có thể vẫn đang / đã ghi) — không ném, không thử lại. */
export const OUTCOME_UNKNOWN_CODE = "outcome_unknown";
const OUTCOME_UNKNOWN_MESSAGE = "Chưa rõ kết quả (quá thời gian chờ) — đừng thử lại ngay; hệ thống có thể đã ghi. Kiểm tra lại danh sách / trạng thái trước khi làm lại.";

/**
 * Công cụ mà họ đã bật «sở hữu» nhưng mặt mô hình không có đường tới (tên cũ chỉ đường cũ): mô hình gọi thì KHÔNG rơi về executor cũ.
 * `confirm_alert_change`: bản cũ của «đồng ý» đổi cấu hình cảnh báo — họ alerts bật thì chỉ lệnh gõ «đồng ý» của người dùng mới xác nhận.
 */
const LEGACY_ONLY_FAMILY_TOOLS: Readonly<Partial<Record<AssistantFamily, ReadonlySet<string>>>> = { alerts: ALERT_TOOLS_REMOVED_BY_FAMILY };

/** Lời nhắc của họ chỉ nói về một công cụ phía trợ lý (không nằm trên máy chủ MCP): chỉ nhắc khi công cụ đó có trong khai báo của lượt. */
const INSTRUCTION_ANCHOR_TOOL: Readonly<Partial<Record<AssistantFamily, string>>> = { files: "suggest_replies" };

export interface McpTurnOptions {
  /** Hạn chờ một `tools/call` (ms). Mặc định = chờ cổng tối đa + trần thực thi. */
  callTimeoutMs?: number;
}

export interface McpSession {
  tools: readonly McpToolInfo[];
  toolNames: ReadonlySet<string>;
  /** `instructions` của máy chủ = lời nhắc của các họ đã bật. */
  instructions: string;
}

interface OpenSession extends McpSession {
  client: Client;
  close: () => Promise<void>;
}

export class AssistantMcpTurn {
  private readonly sessions = new Map<AssistantSurface, Promise<OpenSession | null>>();
  /** Phiên đã mở xong (đồng bộ) — để `modelHasTool` không phải await trong đường định tuyến. */
  private readonly opens = new Map<AssistantSurface, OpenSession>();
  /** Tra theo tên CHỈ trong công cụ có mặt trợ lý — bản trùng tên của cổng `mcp_http` không ghi đè (M3). */
  private readonly byName: ReadonlyMap<string, AnyToolDefinition>;
  /** Tên mô hình có thể gọi qua MCP của các họ đang bật + tên cũ chỉ đường cũ của họ (M2). */
  private readonly owned: ReadonlySet<string>;
  private readonly callTimeoutMs: number;
  /** Số phiên đã mở trong lượt (test «họ tắt ⇒ không mở phiên nào»). */
  opened = 0;

  constructor(
    private readonly access: DataAccessContext,
    readonly families: ReadonlySet<AssistantFamily>,
    private readonly deps: AssistantMcpServerDeps,
    options: McpTurnOptions = {},
  ) {
    const surfaced = (deps.catalog ?? ALL_TOOLS).filter((tool) => (tool.surfaces ?? []).some((surface) => surface !== "mcp_http"));
    this.byName = new Map(surfaced.map((tool) => [tool.name, tool]));
    const owned = new Set(surfaced.filter((tool) => tool.surfaces?.includes("assistant_model") && tool.family && families.has(tool.family)).map((tool) => tool.name));
    for (const family of families) for (const name of LEGACY_ONLY_FAMILY_TOOLS[family] ?? []) owned.add(name);
    this.owned = owned;
    this.callTimeoutMs = options.callTimeoutMs ?? deps.gate.maxWaitMs + TOOL_EXECUTION_CAP_MS;
  }

  familyEnabled(family: AssistantFamily): boolean {
    return this.families.has(family);
  }

  /** Phiên của mô hình (lười). null = mở lỗi — nơi gọi dùng đường cũ cho cả lượt. */
  model(): Promise<McpSession | null> {
    return this.session("assistant_model");
  }

  /** Phiên của lệnh gõ (lười); mô hình không có đường tới phiên này. */
  command(): Promise<McpSession | null> {
    return this.session("assistant_command");
  }

  /** Mô hình gọi `name` đi qua MCP khi phiên mô hình ĐÃ mở và liệt kê `name` (họ của nó bật ⇒ máy chủ mới đăng ký). */
  modelHasTool(name: string): boolean {
    return this.opens.get("assistant_model")?.toolNames.has(name) === true;
  }

  /**
   * `name` thuộc một họ đang bật VÀ phiên mô hình đã mở: lượt này công cụ đó chỉ đi qua MCP — ẩn (người hỏi không đủ điều kiện) thì là «không có công cụ»,
   * không bao giờ rơi về executor cũ. Phiên chưa mở / mở lỗi (T2: lượt chạy đường cũ) → false.
   */
  ownsTool(name: string): boolean {
    return this.opens.has("assistant_model") && this.owned.has(name);
  }

  /** Mọi tên công cụ thuộc họ đang bật (khai báo cũ cùng tên bị gỡ khi phiên đã mở). */
  ownedToolNames(): ReadonlySet<string> {
    return this.owned;
  }

  /** Lời nhắc của các họ trong `families`, bỏ họ mà công cụ «neo» của lời nhắc không có trong `declared` (vd lời nhắc gợi ý trả lời mà không có suggest_replies). */
  instructionsFor(families: ReadonlySet<AssistantFamily>, declared: ReadonlySet<string>): string {
    const picked = new Set([...families].filter((family) => !INSTRUCTION_ANCHOR_TOOL[family] || declared.has(INSTRUCTION_ANCHOR_TOOL[family]!)));
    return assistantFamilyInstructions({ families: picked, familyCatalogs: this.deps.familyCatalogs });
  }

  familyOfTool(name: string): AssistantFamily | undefined {
    return this.byName.get(name)?.family;
  }

  /** Công cụ tạo nháp có câu dựng sẵn: lượt đã có `fixedReply` thì không gọi thêm. */
  blocksAfterFixedReply(name: string): boolean {
    return this.byName.get(name)?.blocksAfterFixedReply === true;
  }

  errorShapeOf(name: string): "string" | "object" {
    return this.byName.get(name)?.assistantErrorShape ?? "object";
  }

  /** `tools/call` thật qua phiên của mặt `surface`. Phiên chưa mở / hỏng → ném (nơi gọi chỉ gọi khi `modelHasTool`). */
  async callTool(surface: AssistantSurface, name: string, args: Record<string, unknown>): Promise<CallToolResultLike> {
    const session = await this.session(surface);
    if (!session) throw new Error("Phiên MCP của trợ lý không mở được");
    try {
      // Hạn chờ TƯỜNG MINH (mặc định SDK 60 giây không liên quan tới cổng 20 giây + công cụ chạy lâu)
      return await session.client.callTool({ name, arguments: args }, { timeout: this.callTimeoutMs }) as CallToolResultLike;
    } catch (error) {
      // Công cụ GHI quá hạn: máy chủ có thể vẫn chạy / đã ghi → kết quả «chưa rõ», KHÔNG ném (ném = việc nền / mô hình thử lại ⇒ ghi đôi)
      if (this.isWrite(name) && error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) {
        log.error(`công cụ ghi ${name} quá hạn chờ ${this.callTimeoutMs}ms — báo «chưa rõ kết quả»`);
        return { isError: true, content: [{ type: "text", text: OUTCOME_UNKNOWN_MESSAGE }], _meta: { [ERROR_META_KEY]: { code: OUTCOME_UNKNOWN_CODE, message: OUTCOME_UNKNOWN_MESSAGE } } };
      }
      throw error;
    }
  }

  /** Không khai là chỉ-đọc (hoặc không tra được) ⇒ coi là công cụ GHI (an toàn hơn: không bao giờ thử lại mù). */
  private isWrite(name: string): boolean {
    return this.byName.get(name)?.annotations.readOnlyHint !== true;
  }

  async close(): Promise<void> {
    const pending = [...this.sessions.values()];
    this.sessions.clear();
    this.opens.clear();
    await Promise.all(pending.map(async (promise) => {
      const session = await promise;
      await session?.close().catch((error) => log.error(`đóng phiên MCP của trợ lý: ${describeError(error)}`));
    }));
  }

  private session(surface: AssistantSurface): Promise<OpenSession | null> {
    let promise = this.sessions.get(surface);
    if (!promise) {
      promise = this.open(surface);
      this.sessions.set(surface, promise);
    }
    return promise;
  }

  private async open(surface: AssistantSurface): Promise<OpenSession | null> {
    const server = buildAssistantMcpServer(this.access, surface, this.deps);
    const client = new Client({ name: "bot-tro-ly-assistant-client", version: "1.0.0" });
    const close = async () => { await client.close().catch(() => undefined); await server.close().catch(() => undefined); };
    try {
      this.opened += 1;
      // Cùng MỘT bản InMemoryTransport (của gói client) cho cả hai đầu — hai gói SDK có hai lớp riêng
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide as never);
      await client.connect(clientSide);
      const listed = await client.listTools();
      const session: OpenSession = {
        client, close, tools: listed.tools, toolNames: new Set(listed.tools.map((tool) => tool.name)), instructions: client.getInstructions() ?? "",
      };
      this.opens.set(surface, session);
      return session;
    } catch (error) {
      log.error(`không mở được phiên MCP (${surface}) cho lượt trợ lý: ${describeError(error)}`);
      await close();
      return null;
    }
  }
}
