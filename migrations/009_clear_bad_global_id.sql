-- 01/10/2026: globalId lấy từ getGroupMembersInfo là SAI — đo thật: cả 89 thành viên một nhóm trả CÙNG một
-- giá trị (trùng mã của chính tài khoản bot). Xóa hết; lấy lại bằng getUserInfo (hỏi theo từng người).
UPDATE contact SET global_id = NULL;
