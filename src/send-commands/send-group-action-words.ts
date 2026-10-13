import { SendActionKind } from "../constants.js";

// Chữ riêng của từng việc «làm trên nhóm» từ tin riêng (nhắc hẹn / ghim) — dùng chung khâu kiểm quyền, phân giải nhóm, xác nhận.
// Gom một chỗ để nhắc hẹn và ghim dùng CHUNG khung mà không rải chuỗi ở nhiều tệp.

export interface GroupActionWords {
  /** «Lệnh … chỉ dành cho người nhận cảnh báo…» */
  commandName: string;
  /** Hỏi lại khi không nêu nhóm */
  askWhich: string;
  /** Nhắc cách viết khi tên nhóm không có trong tin người hỏi */
  nameHint: string;
  /** Lý do nhóm khách bị từ chối */
  guestRefusal: string;
  /** «… mới <làm> được» với nhóm Mật */
  secretDo: string;
  /** Tiền tố câu từ chối nhóm: «<tiền tố> «tên»: lý do.» */
  refusePrefix: string;
  /** Tên trỏ tới một người */
  notGroup: string;
  /** Động từ trong «Em không <…> lệnh G-n vì» */
  verb: string;
  /** Cụm trong «không xếp được việc <…> nào» */
  doing: string;
}

const WORDS: Record<number, GroupActionWords> = {
  [SendActionKind.Reminder]: {
    commandName: "Lệnh nhắc hẹn nhóm",
    askWhich: "Anh/chị cho em biết tạo nhắc hẹn ở nhóm nào: «tạo nhắc hẹn nhóm A lúc 8h sáng mai: <nội dung>».",
    nameHint: "Tên nhóm phải đúng như anh/chị viết — nhắn lại theo mẫu «tạo nhắc hẹn nhóm A lúc 8h sáng mai: <nội dung>».",
    guestRefusal: "là nhóm khách — nhắc hẹn từ tin riêng chỉ tạo cho nhóm nội bộ",
    secretDo: "tạo nhắc hẹn",
    refusePrefix: "Không tạo được nhắc hẹn cho",
    notGroup: "nhắc hẹn chỉ tạo cho nhóm",
    verb: "tạo",
    doing: "tạo nhắc hẹn",
  },
  [SendActionKind.Pin]: {
    commandName: "Lệnh ghim lên nhóm",
    askWhich: "Anh/chị cho em biết ghim lên nhóm nào: «ghim cuộc họp 15h của nhóm A» hoặc «ghim lên nhóm A: <nội dung>».",
    nameHint: "Tên nhóm phải đúng như anh/chị viết — nhắn lại theo mẫu «ghim cuộc họp 15h của nhóm A».",
    guestRefusal: "là nhóm khách — ghim từ tin riêng chỉ làm cho nhóm nội bộ",
    secretDo: "ghim",
    refusePrefix: "Không ghim được cho",
    notGroup: "ghim chỉ làm được cho nhóm",
    verb: "ghim",
    doing: "ghim",
  },
};

/** Chữ của việc nhóm; null với gửi tin (không thuộc khung này). */
export const groupActionWords = (action: SendActionKind): GroupActionWords | null => WORDS[action] ?? null;
