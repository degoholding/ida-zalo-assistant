// Đổi «@Tên» trong câu trả lời của bot thành thẻ nhắc (mention) Zalo thật — người được giao việc nhận thông báo.
// Chỉ gắn tên KHỚP thành viên đang ở nhóm (mô hình được đưa danh sách tên); tên dài khớp trước («@Gia Bảo Nguyễn»
// trước «@Gia Bảo»), không gắn khi ngay sau tên còn chữ / số (tránh «@An» ăn vào «@Anh»).

export interface ZaloMention {
  pos: number;
  uid: string;
  len: number;
}

export interface MentionableMember {
  uid: string;
  name: string;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

export function buildMentions(text: string, members: MentionableMember[]): ZaloMention[] {
  const lower = text.toLowerCase();
  const candidates = members
    .filter((member) => member.uid && member.name.trim().length >= 2)
    .map((member) => ({ uid: member.uid, needle: `@${member.name.trim().toLowerCase()}` }))
    .sort((a, b) => b.needle.length - a.needle.length);
  const mentions: ZaloMention[] = [];
  const taken = (pos: number, len: number) => mentions.some((item) => pos < item.pos + item.len && item.pos < pos + len);
  for (const { uid, needle } of candidates) {
    let from = 0;
    for (let pos = lower.indexOf(needle, from); pos !== -1; pos = lower.indexOf(needle, from)) {
      from = pos + needle.length;
      const next = text.charAt(pos + needle.length);
      if (next && WORD_CHAR.test(next)) continue;
      if (!taken(pos, needle.length)) mentions.push({ pos, uid, len: needle.length });
    }
  }
  return mentions.sort((a, b) => a.pos - b.pos);
}
