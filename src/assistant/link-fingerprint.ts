// Phần nhận dạng của link để so với tin nhắn (công cụ read_link): id tệp Google, hoặc máy + đường dẫn. Hàm thuần — dùng chung cho
// lõi (`link_shared_check`) và phía trợ lý (link có ngay trong câu hỏi thì khỏi tra tin).

export function linkFingerprint(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    const googleId = /\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname)?.[1];
    if (googleId && url.hostname.endsWith("google.com")) return googleId;
    return `${url.hostname}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}
