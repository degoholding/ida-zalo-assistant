// Nhận ra câu hỏi KỸ THUẬT thuốc bảo vệ thực vật (IDA câu 13): liều lượng, pha trộn, cách phun, chẩn đoán sâu bệnh.
// Câu loại này bot không được tìm trên mạng rồi tự khuyến cáo — nội dung sai có thể hại cây trồng và sai nhãn đăng ký.
// So khớp trên chữ đã bỏ dấu, theo CỤM từ (không theo từ đơn «pha», «phun» — «pha cà phê», «phun sương» không tính).

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Cụm từ (đã bỏ dấu, viết thường) cho thấy câu hỏi là kỹ thuật BVTV. */
const AGRO_PHRASES = [
  "lieu luong", "lieu dung", "nong do", "pha chung", "pha voi", "pha bao nhieu", "pha may", "tron chung", "tron voi",
  "hon hop thuoc", "phun thuoc", "phun xit", "xit thuoc", "thoi gian cach ly", "cach ly bao lau", "thuoc tru", "tru sau",
  "tru benh", "tru co", "tru nam", "tru oc", "tru chuot", "thuoc bvtv", "bvtv", "bao ve thuc vat", "hoat chat", "sau benh",
  "dich hai", "nam benh", "benh dao on", "dao on", "ray nau", "ray xanh", "bo tri", "nhen do", "sau cuon la", "sau duc than",
  "vang la", "chay la", "thoi re", "thoi trai", "kich thich ra hoa", "dieu hoa sinh truong", "phan bon la", "khang thuoc",
  "bi chet cay", "chet cay", "ngo doc thuoc", "nhan thuoc", "dang ky thuoc",
];

const PADDED = AGRO_PHRASES.map((phrase) => ` ${phrase} `);

/** Câu hỏi có chạm chủ đề kỹ thuật thuốc BVTV không. Hàm thuần. */
export function isAgroTechnicalQuestion(question: string): boolean {
  const text = ` ${fold(question).replace(/[^a-z0-9]+/g, " ")} `;
  return PADDED.some((phrase) => text.includes(phrase));
}

/** Luật thêm vào hướng dẫn hệ thống cho lượt hỏi kỹ thuật BVTV. */
export const AGRO_TECHNICAL_PROMPT = `

CÂU HỎI NÀY LÀ KỸ THUẬT THUỐC BẢO VỆ THỰC VẬT (liều lượng, pha trộn, cách phun, sâu bệnh…):
- KHÔNG tự đưa khuyến cáo, KHÔNG suy luận liều / cách pha từ hiểu biết chung, không tìm trên mạng (công cụ tìm web đã tắt cho câu này).
- Chỉ trích nguyên văn từ tài liệu / nhãn sản phẩm đã có trong nhóm hoặc trong tệp (đọc bằng read_file / read_link), ghi rõ tên tài liệu.
- Không có tài liệu thì nói thẳng là chưa có tài liệu kỹ thuật được duyệt cho câu này.
- LUÔN kết thúc bằng câu: «Nội dung kỹ thuật này cần phòng kỹ thuật xác nhận trước khi áp dụng.»`;
