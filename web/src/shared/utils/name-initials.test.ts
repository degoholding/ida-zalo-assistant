import { describe, expect, it } from 'vitest'

import { departmentInitials, nameInitials } from './name-initials'

describe('nameInitials', () => {
  it('lấy hai chữ CUỐI, không phải hai chữ đầu — họ Việt Nam đứng trước', () => {
    //  Đây là cả lý do hàm này tồn tại: "NV" trùng nhau ở nửa danh bạ công ty.
    expect(nameInitials('Nguyễn Văn An')).toBe('VA')
    expect(nameInitials('Nguyễn Văn Bình')).toBe('VB')
  })

  it('tên một chữ vẫn ra một chữ cái, không nổ', () => {
    expect(nameInitials('An')).toBe('A')
  })

  it('chuỗi rỗng và chuỗi toàn khoảng trắng ra dấu hỏi thay vì rỗng', () => {
    //  Ô rỗng trong vòng tròn avatar đọc như ảnh chưa tải xong.
    expect(nameInitials('')).toBe('?')
    expect(nameInitials('   ')).toBe('?')
  })

  it('bỏ khoảng trắng thừa giữa các từ', () => {
    expect(nameInitials('  Trần   Thị   Hoa  ')).toBe('TH')
  })

  it('viết hoa cả khi nguồn viết thường', () => {
    expect(nameInitials('lê minh đức')).toBe('MĐ')
  })

  it('bỏ đuôi chú thích trong ngoặc — «(Demo)» từng cho ra chữ tắt «M(»', () => {
    //  Lỗi thật thấy trên màn Chức vụ 10/09/2026: hồ sơ demo tên "Trưởng phòng
    //  Thu mua (Demo)" ra vòng tròn ghi «M(», đọc như ảnh hỏng.
    expect(nameInitials('Trưởng phòng Thu mua (Demo)')).toBe('TM')
    expect(nameInitials('Manager (Demo)')).toBe('M')
  })

  it('tên toàn ký tự không phải chữ vẫn ra dấu hỏi, không ra vòng tròn trắng', () => {
    expect(nameInitials('(Demo)')).toBe('?')
    expect(nameInitials('---')).toBe('?')
  })
})

describe('departmentInitials', () => {
  it('lấy hai từ ĐẦU, ngược với tên người — tên phòng đọc xuôi', () => {
    //  Lấy hai từ cuối thì "Công nghệ thông tin" ra "TT", trùng với "Truyền
    //  thông" và mọi phòng khác kết thúc bằng hai chữ đó.
    expect(departmentInitials('Phòng Công nghệ thông tin')).toBe('CN')
    expect(departmentInitials('Phòng Kinh doanh')).toBe('KD')
  })

  it('bỏ tiền tố loại đơn vị, không thì vòng tròn nào cũng bắt đầu bằng «P»', () => {
    expect(departmentInitials('Phòng Hành chính')).toBe('HC')
    expect(departmentInitials('Ban Kiểm soát')).toBe('KS')
    expect(departmentInitials('Bộ phận Kho vận')).toBe('KV')
    expect(departmentInitials('Trung tâm Đào tạo')).toBe('ĐT')
  })

  it('cắt cả ở dấu gạch nối, không dính hai từ thành một', () => {
    expect(departmentInitials('Phòng Nhân sự - Hành chính')).toBe('NS')
  })

  it('nhóm giả trong ngoặc ra dấu gạch, không viết tắt thành tên phòng có thật', () => {
    //  "(Chưa gắn phòng ban)" mà ra "CG" thì đọc như một phòng tên thật.
    expect(departmentInitials('(Chưa gắn phòng ban)')).toBe('—')
  })

  it('chuỗi rỗng và toàn khoảng trắng ra dấu hỏi', () => {
    expect(departmentInitials('')).toBe('?')
    expect(departmentInitials('   ')).toBe('?')
  })

  it('tên chỉ có mỗi tiền tố thì không ra chuỗi rỗng', () => {
    //  Bỏ tiền tố xong không còn chữ nào — không được để vòng tròn trắng trơn.
    expect(departmentInitials('Phòng')).toBe('P')
  })
})
