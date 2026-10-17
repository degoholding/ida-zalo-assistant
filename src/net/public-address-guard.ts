import { lookup } from "node:dns/promises";
import net from "node:net";

// Chặn SSRF dùng chung (link-fetch của trợ lý, bộ tải tệp đính kèm): máy chủ bot nằm cùng mạng với MySQL và các
// container khác, nên mọi URL lấy từ dữ liệu bên ngoài đều phải trỏ tới địa chỉ CÔNG KHAI. Hạn chế còn lại: kiểm tra
// xong mới gọi `fetch` (hai lần phân giải DNS riêng) nên chưa chống được DNS rebinding tuyệt đối — Node fetch không cho
// ghim IP nếu không có dispatcher riêng.

export type UnsafeUrlReason = "protocol" | "not-found" | "private";

export class UnsafeUrlError extends Error {
  constructor(readonly reason: UnsafeUrlReason, message: string) {
    super(message);
  }
}

/** Phân giải tên máy → mọi địa chỉ IP (tiêm được để test không cần mạng). Lỗi DNS trả mảng rỗng. */
export type AddressLookup = (hostname: string) => Promise<string[]>;

export const defaultAddressLookup: AddressLookup = async (hostname) =>
  (await lookup(hostname, { all: true }).catch(() => [])).map((item) => item.address);

function isPrivateIPv4Octets([a, b, c]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

/** Tách IPv6 thành 8 nhóm 16-bit (hiểu «::» và đuôi IPv4 chấm); null nếu không phải IPv6 hợp lệ. */
function parseIPv6(address: string): number[] | null {
  if (!net.isIPv6(address)) return null;
  let text = address.toLowerCase().replace(/%.*$/, "");
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  if (dotted) {
    const [a, b, c, d] = dotted.split(".").map(Number);
    text = text.slice(0, -dotted.length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const [head, tail] = text.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail === undefined ? [] : tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array<string>(Math.max(fill, 0)).fill("0"), ...tailGroups].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g)) ? groups : null;
}

/** Địa chỉ nội bộ / dành riêng — không cho bot gọi tới. Địa chỉ không đọc được coi là nội bộ (an toàn trước). */
export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) return isPrivateIPv4Octets(address.split(".").map(Number));
  const g = parseIPv6(address);
  if (!g) return true;
  const embeddedV4 = [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255];
  // ::/96 (không xác định, loopback, IPv4-compatible cũ) — không có lý do hợp lệ để gọi
  if (g.slice(0, 6).every((x) => x === 0)) return true;
  // IPv4-mapped ::ffff:a.b.c.d — xét theo IPv4 bên trong
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateIPv4Octets(embeddedV4);
  // NAT64 64:ff9b::/96 — xét IPv4 nhúng (máy chỉ IPv6 + DNS64 vẫn tải được CDN công khai);
  // 64:ff9b:1::/48 là dải NAT64 dùng nội bộ → chặn
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    return g.slice(2, 6).every((x) => x === 0) ? isPrivateIPv4Octets(embeddedV4) : true;
  }
  if (g[0] === 0x2002) return true; // 6to4 2002::/16 — nhúng IPv4 tùy ý
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true; // Teredo, tài liệu
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard-only 100::/64
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00;
}

/**
 * URL phải là http(s) và MỌI địa chỉ phân giải ra đều công khai.
 * Ném `UnsafeUrlError` (kèm lý do) nếu không đạt.
 */
export async function assertPublicHttpUrl(
  url: URL, lookupAddresses: AddressLookup = defaultAddressLookup,
): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("protocol", `Giao thức ${url.protocol} không được phép.`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : await lookupAddresses(host);
  if (!addresses.length) throw new UnsafeUrlError("not-found", `Không tìm thấy máy chủ ${host}.`);
  if (addresses.some(isPrivateAddress)) throw new UnsafeUrlError("private", "Địa chỉ trỏ vào mạng nội bộ.");
}
