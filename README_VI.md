# Flip

Một bảng điều khiển học tập yên tĩnh cho Windows: đồng hồ lật, bộ hẹn giờ không làm phiền bạn, thời khóa biểu có thể nhập từ Excel, và bảng công việc theo tuần cho những việc nằm giữa các tiết học.

Xây dựng bằng Rust và Tauri 2. Mọi thứ nằm trên máy của bạn: không tài khoản, không đồng bộ, và không theo dõi trừ khi bạn tự bật bộ đếm lượt dùng ẩn danh (tùy chọn).

![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4)
![Built with](https://img.shields.io/badge/built%20with-Rust%20%2B%20Tauri%202-000000)
![Languages](https://img.shields.io/badge/languages-English%20%7C%20Ti%E1%BA%BFng%20Vi%E1%BB%87t-2ea44f)
![Version](https://img.shields.io/badge/version-1.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

[English](README.md) | Tiếng Việt

> **VirusTotal báo 2/71.** Arctic Wolf và SecureAge gắn cờ bộ cài đặt; 69 engine còn lại, bao gồm Microsoft, Kaspersky, ESET, Bitdefender và Symantec, đều báo sạch. Hai kết quả này là đánh giá theo heuristic đối với một bộ cài đặt chưa ký số và mới build, không phải phát hiện thứ gì đó bên trong Flip. [Phần bên dưới](#về-cảnh-báo-của-windows) giải thích cảnh báo của Windows và cách kiểm tra bản tải về của bạn.

<!--
Thêm ảnh chụp màn hình vào đây khi đã có, ví dụ:

![Đồng hồ lật](docs/clock.png)
![Thời khóa biểu và bảng công việc](docs/timetable.png)
-->

---

## Mục lục

- [Flip làm được gì](#flip-làm-được-gì)
- [Cài đặt](#cài-đặt)
- [Về cảnh báo của Windows](#về-cảnh-báo-của-windows)
- [Lần chạy đầu tiên](#lần-chạy-đầu-tiên)
- [Phím tắt](#phím-tắt)
- [Dữ liệu của bạn](#dữ-liệu-của-bạn)
- [Cập nhật](#cập-nhật)
- [Tự build từ mã nguồn](#tự-build-từ-mã-nguồn)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [Kiểm thử](#kiểm-thử)
- [Hạn chế](#hạn-chế)
- [Ghi công](#ghi-công)

---

## Flip làm được gì

### Đồng hồ và bộ hẹn giờ

Một chiếc đồng hồ lật (split-flap) tạm dừng để lật từng chữ số, và bộ đếm ngược bắt đầu bằng cách gõ số. Gõ `25` sẽ thành 25 phút; gõ `1 30` sẽ thành 90 phút. Phím Space để bắt đầu, tạm dừng và tiếp tục.

Khi đặt hẹn giờ, Flip theo dõi toàn bộ phiên học: thời gian đã trôi qua, thời gian bạn thực sự tập trung so với thời gian tạm dừng, và môn học bạn đang làm. Khi kết thúc, bạn nghe một tiếng chuông và thấy một thẻ hỏi bạn đã hoàn thành được những gì.

Cả hai chế độ xem đều có định dạng 12 giờ và 24 giờ, cửa sổ có thể chuyển sang toàn màn hình để làm màn hình bàn học không xao nhãng, và các nút trên thanh tiêu đề phóng to/thu nhỏ toàn bộ giao diện từ 80% đến 160%.

### Thời khóa biểu

Một lưới tuần gồm các tiết và các ngày, tô màu theo từng môn, với tiết hiện tại và tiết kế tiếp được đánh dấu để bạn biết mình đang ở đâu trong ngày.

- Điền ô bằng cách nhấp chuột, hoặc **nhập cả thời khóa biểu từ tệp `.xlsx`**. Flip đọc bảng tính đầu tiên bằng bộ đọc ZIP + XML riêng, nên không cần Excel hay thư viện bổ sung nào.
- Xuất một bảng tính mẫu để điền sẵn
- Ẩn cuối tuần cho vừa tuần học năm ngày
- Nhân bản một môn học sang mọi ô có cùng tên

### Công việc

Một bảng tuần gồm các thẻ có thể kéo giữa các ngày, hoặc một danh sách phẳng khi bạn muốn xem tất cả cùng lúc.

- Hạn chót, mức ưu tiên, ghi chú và danh sách kiểm tra
- Các phiên tập trung được gắn vào công việc, nên thời gian bạn bỏ ra được ghi nhận đúng chỗ
- Kéo một thẻ lên tiêu đề cột để chuyển; cột sẽ phát sáng khi bạn rê qua

### Bảng điều khiển

Sáu widget trên một trang: tiết học kế tiếp, danh sách hôm nay, việc sắp đến hạn, các công việc đang làm, phiên tập trung hiện tại, và một thẻ thống kê nhỏ. Lời chào thay đổi theo đồng hồ: sáng, chiều hoặc tối. Kéo để sắp xếp lại các widget, và ẩn những cái bạn không muốn.

### Cài đặt (Settings)

| Mục | Nội dung |
| --- | --- |
| General | Ngôn ngữ, định dạng đồng hồ, hiệu ứng, chế độ cảm ứng, Discord presence, âm thanh, thiết lập, cập nhật |
| Appearance | Năm chủ đề, tám màu nhấn, nền chuyển sắc |
| Data | Sao lưu, khôi phục, xuất dữ liệu |

**Animations** có bốn chế độ (*Extra*, *Normal*, *Fast* và *Snappy*), để giao diện có thể sinh động, gần như đứng yên, hoặc bỏ hẳn chuyển động. `prefers-reduced-motion` luôn được ưu tiên.

**Language** chuyển toàn bộ giao diện giữa tiếng Anh và tiếng Việt, bao gồm ngày tháng, khoảng thời gian và dạng số nhiều (`14 Thg 11`, `1g 30p`).

---

## Cài đặt

1. Tải `Flip_1.1.0_x64-setup.exe` từ [Releases](https://github.com/itsnautill/flip/releases/latest)
2. Chạy tệp. Bộ cài đặt cài theo từng người dùng, không cần quyền quản trị.
3. Windows sẽ hiện *"Windows protected your PC"* vì bộ cài đặt chưa được ký số. Nhấn **Run anyway** (xem [phần tiếp theo](#về-cảnh-báo-của-windows) nếu bạn muốn biết lý do).

Yêu cầu Windows 10 hoặc 11 có WebView2. WebView2 đã có sẵn trên Windows hiện nay, và bộ cài đặt sẽ thêm nếu thiếu.

Gỡ cài đặt từ **Settings → Apps** sẽ không động đến dữ liệu của bạn.

---

## Về cảnh báo của Windows

Lần chạy đầu tiên sẽ hiện **"Windows protected your PC"** với dòng *Publisher: Unknown publisher*. Điều đó có nghĩa là SmartScreen chưa có thông tin gì về tệp này, chứ không phải nó phát hiện điều gì xấu. Bộ cài đặt chưa được ký số nên bắt đầu với độ tín nhiệm bằng không.

**Để cài đặt:** nhấn **Run anyway**. Một số phiên bản Windows ẩn nút đó sau **More info**.

**Để kiểm tra bản tải về đúng là bản được build ở đây:**

```powershell
Get-FileHash .\Flip_1.1.0_x64-setup.exe -Algorithm SHA256
```

Với bản 1.1.0, kết quả phải là:

```
27552e25295b888e44f9fa9a448bb8aafc2570dec554602f260335955c74b4dc
```

**Để tắt cảnh báo trên máy của riêng bạn:** nhấp chuột phải vào tệp `.exe`, mở **Properties**, tick **Unblock**, rồi nhấn **OK**.

Với những người khác, cảnh báo chỉ biến mất khi bộ cài đặt được ký số, và ngay cả khi đó một bản build mới vẫn có thể bị cảnh báo cho đến khi có đủ lượt tải. Có dịch vụ ký số miễn phí cho dự án mã nguồn mở ([SignPath Foundation](https://signpath.org/)). Hoặc bỏ qua bản nhị phân và [tự build từ mã nguồn](#tự-build-từ-mã-nguồn).

---

## Lần chạy đầu tiên

Một trình thiết lập bốn bước xuất hiện lần đầu bạn mở Flip:

1. **Chọn ngôn ngữ**: English hoặc Tiếng Việt, đổi ngay lập tức
2. **Chọn giao diện**: sáng hoặc tối, và một trong tám màu nhấn
3. **Thời khóa biểu của bạn**: các ngày hiển thị, số tiết mỗi ngày, bật hoặc tắt âm thanh
4. **Hoàn tất**: vào thẳng ứng dụng, hoặc vào thời khóa biểu để bắt đầu điền

Mọi bước đều có thể bỏ qua, và **Settings → General → Setup** chạy lại trình thiết lập bất cứ lúc nào.

---

## Phím tắt

| Phím | Hành động |
| --- | --- |
| `Space` / `Enter` | Bắt đầu, tạm dừng hoặc tiếp tục hẹn giờ |
| `Tab` | Chuyển giữa đồng hồ và bộ hẹn giờ |
| `0` – `9` | Gõ thời lượng khi bộ hẹn giờ đang nghỉ |
| `Backspace` | Xóa chữ số vừa gõ |
| `S` | Mở hộp thoại đặt hẹn giờ |
| `R` | Đặt lại bộ hẹn giờ |
| `T` | Chuyển đồng hồ 12/24 giờ |
| `F` / `F11` | Bật/tắt toàn màn hình |
| `Esc` | Thoát toàn màn hình |
| `?` | Hiện danh sách phím tắt |

`F`, `F11` và `?` hoạt động ở mọi mục; các phím còn lại chỉ áp dụng cho bộ hẹn giờ. Mọi thứ khác đều có thể làm chỉ bằng chuột.

---

## Dữ liệu của bạn

Mọi thứ nằm trong một thư mục:

```
%APPDATA%\FlipData\
├── settings.json
├── board.json
└── backups\
    └── flip-backup-2026-11-14-0930.json
```

Cả hai tệp đều là JSON thuần mà bạn có thể đọc và chỉnh sửa. Flip ghi chúng thông qua Rust, nên một sự cố giữa chừng khi ghi sẽ không để lại tệp ghi dở thay cho tệp tốt.

**Sao lưu** chỉ cần một lần nhấp trong **Settings → Data**. Các bản Flip cũ được tự động tiếp nhận ở lần khởi động đầu tiên thay vì bị ghi đè.

**Xuất dữ liệu** tạo CSV cho công việc và thời khóa biểu, cài đặt dạng JSON, hoặc một bản sao lưu đầy đủ mà bạn có thể chuyển sang máy khác.

Không có đám mây và không có tài khoản. Lưu lượng mạng duy nhất là việc kiểm tra cập nhật khi bạn yêu cầu, cộng với bộ đếm lượt dùng tùy chọn mô tả bên dưới.

### Discord presence

**Bật mặc định; một công tắc để tắt** tại **Settings → General → Discord Rich Presence**. Flip giao tiếp với ứng dụng Discord trên chính máy của bạn qua socket cục bộ, nên không có gì đi qua internet. Thẻ chỉ hiển thị:

- chế độ đang dùng: `Clock`, `Timer` hoặc `Focus session`
- bộ đếm ngược có đang chạy hay không, kèm bộ đếm thời gian đã trôi qua khi đang chạy
- một nút: **Download Flip** → <https://projectflip.site.je>

Nó không bao giờ hiển thị tiêu đề công việc, tên môn học, tổng thời gian học, ghi chú hay tên tệp, vì không có thứ nào trong số đó được đưa vào dữ liệu gửi đi. Khi Discord đóng, không có gì được gửi, và kết nối được thử lại lặng lẽ ở chế độ nền.

Discord chỉ chấp nhận presence từ một ứng dụng đã đăng ký, nên client id nằm trong [`flip/src-tauri/src/discord.rs`](flip/src-tauri/src/discord.rs) dưới tên `CLIENT_ID`. Để dùng id của riêng bạn, tạo một ứng dụng tại <https://discord.com/developers/applications> (chỉ cần một cái tên, không cần bot), dán Application ID vào đó rồi build lại. Nếu để trống, Flip sẽ không bao giờ mở socket.

### Chia sẻ dữ liệu sử dụng (tùy chọn)

**Tắt mặc định.** Không có gì được gửi đi trừ khi bạn bật tại **Settings → General → Share anonymous usage**, và công tắc có kèm đầy đủ phần công khai thông tin ngay bên cạnh. Xem thêm [PRIVACY.md](PRIVACY.md).

Khi bật, Flip gửi đúng một yêu cầu HTTPS mỗi ngày:

| Được gửi | Không bao giờ gửi |
| --- | --- |
| Một install id ngẫu nhiên gồm 32 ký tự, tạo ngay trên máy của bạn | Công việc, môn học, thời khóa biểu, ghi chú |
| Phiên bản ứng dụng | Lịch sử hẹn giờ, cài đặt, tên tệp |
| Ngôn ngữ giao diện (`en` hoặc `vi`) | Tên, tài khoản, mã phần cứng, vị trí của bạn |
| Ngày, do máy chủ thêm vào | Địa chỉ IP của bạn (không được lưu) |

Id này gắn với một lần cài đặt và không liên kết với bất cứ thứ gì khác, nên bảng điều khiển chỉ hiện số lượng, không hiện con người. Tắt tùy chọn đi là các yêu cầu dừng ngay lập tức.

Bảng điều khiển công khai nằm tại <https://site-8afa0bdbe0764332b38e33193a775c95.freebuff.page> và worker phía sau nằm trong [`stats/`](stats/).

---

## Cập nhật

**Settings → General → Updates** so sánh phiên bản của bạn với một manifest, rồi làm việc theo hai bước. **Download update** tải bộ cài đặt về `%TEMP%\FlipUpdates\` ở chế độ nền, và **Install and restart** chạy bộ cài đặt rồi đóng Flip, để bộ cài đặt thay thế bản cũ.

Manifest được đọc từ kho mã nguồn trước, với bản trong release làm phương án dự phòng:

```
https://raw.githubusercontent.com/itsnautill/flip/main/flip/update/latest.json
```

Chỉ chấp nhận tải xuống qua HTTPS từ các máy chủ release của GitHub, và tệp phải trông giống một bộ cài đặt Windows trước khi được chạy. Không có gì tự cài đặt nếu không có cú nhấp thứ hai đó.

### Phát hành một bản release

1. Tăng phiên bản trong `flip/src-tauri/Cargo.toml`, `flip/src-tauri/tauri.conf.json`, `flip/update/latest.json` và README này (huy hiệu, tên bộ cài đặt, SHA-256).
2. Build: `cd flip && cargo tauri build`.
3. Commit, gắn tag và push (thay `X.Y.Z` bằng phiên bản mới):
   ```bash
   git add -A && git commit -m "Release X.Y.Z" && git tag vX.Y.Z && git push && git push --tags
   ```
4. Trên GitHub, vào **Releases → Draft a new release**, chọn tag, và đính kèm `flip/src-tauri/target/release/bundle/nsis/Flip_X.Y.Z_x64-setup.exe`.

Manifest nằm ngay trong kho mã nguồn nên không cần tải lên. Xem [`flip/update/README.md`](flip/update/README.md) để biết chi tiết bên trong.

---

## Tự build từ mã nguồn

**Yêu cầu:** Rust (stable), Tauri CLI và WebView2 runtime.

```bash
cargo install tauri-cli --version "^2"
```

Không có bước npm. Phần giao diện là JavaScript thuần được phục vụ trực tiếp từ `flip/ui`.

```bash
git clone https://github.com/itsnautill/flip.git
cd flip/flip
cargo tauri dev      # cửa sổ phát triển tự tải lại
cargo tauri build    # build release + bộ cài đặt NSIS
```

Kết quả nằm trong `flip/src-tauri/target/release/`, với bộ cài đặt ở `bundle/nsis/`.

---

## Cấu trúc dự án

```
flip/
├── ui/                   giao diện, không cần bước build
│   ├── index.html        markup và thứ tự nạp script
│   ├── style.css         toàn bộ style, gồm cả các chế độ chuyển động
│   ├── app.js            tab, cài đặt, âm thanh, phím tắt
│   ├── flipcard.js       hiệu ứng lật chữ số split-flap
│   ├── board.js          hàm dùng chung, hộp thoại, kéo thả
│   ├── timetable.js      lưới tuần
│   ├── tasks.js          chế độ xem bảng và danh sách
│   ├── dashboard.js      lưới widget
│   ├── data.js           sao lưu, khôi phục, xuất
│   ├── xlsx.js           bộ đọc và ghi .xlsx tối giản
│   ├── i18n.js           lớp dịch English ↔ Vietnamese
│   ├── setup.js          trình thiết lập lần đầu
│   ├── about.js          thẻ About
│   └── update.js         kiểm tra phiên bản và đọc manifest
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs        khởi tạo ứng dụng, thư mục dữ liệu, đăng ký lệnh
│   │   ├── commands.rs   giao diện IPC
│   │   ├── state.rs      lõi dùng chung và snapshot
│   │   ├── board.rs      mô hình thời khóa biểu và công việc
│   │   ├── timer.rs      máy trạng thái đếm ngược
│   │   ├── clock.rs      12/24 giờ, ngày tháng, khoảng thời gian
│   │   ├── ticker.rs     nhịp một giây
│   │   ├── settings.rs   tùy chọn được lưu
│   │   └── backup.rs     mã hóa/giải mã sao lưu và xuất CSV
│   ├── icons/            biểu tượng cùng make_icons.py
│   └── tauri.conf.json   cấu hình cửa sổ, bundle và phiên bản
└── update/
    ├── latest.json       mẫu manifest release
    └── README.md         ghi chú release cho người phát hành
```

Hai quy tắc giữ cho mã nguồn trung thực: **Rust là thứ duy nhất ghi xuống đĩa**, và **giao diện không bao giờ giữ trạng thái quan trọng**. Nó chỉ hiển thị snapshot và nhờ Rust thay đổi mọi thứ.

---

## Kiểm thử

```bash
cd flip/src-tauri
cargo test                                  # 52 bài kiểm thử
cargo clippy --all-targets -- -D warnings   # sạch
cargo fmt --check
```

Bộ kiểm thử Rust bao phủ máy trạng thái hẹn giờ, quy tắc thời khóa biểu và công việc, vòng mã hóa/giải mã sao lưu, và các kiểm tra đường dẫn ngăn tên bản sao lưu thoát ra khỏi thư mục của nó.

Phần giao diện cố ý không có trình chạy kiểm thử; nó được xác minh bằng cách build và dùng thử ứng dụng.

---

## Hạn chế

- **Chỉ Windows.** Bản build nhắm tới x64 NSIS; macOS và Linux cần đóng gói riêng.
- **Bộ cài đặt chưa ký số**, nên SmartScreen cảnh báo ở lần chạy đầu.
- **Cập nhật chạy bộ cài đặt mới tại chỗ** nhưng chưa được ký, nên Windows sẽ hỏi trước khi chạy và một hai engine heuristic vẫn có thể gắn cờ bản build mới.
- **Chỉ có tiếng Anh và tiếng Việt**, và chỉ bảng tính đầu tiên của tệp `.xlsx` được nhập mới được đọc.

---

## Ghi công

Tạo bởi [@itsnautill](https://github.com/itsnautill). Xây dựng trên [Tauri](https://tauri.app), [Rust](https://www.rust-lang.org) và [Chrono](https://github.com/chronotope/chrono).

Ký số miễn phí do SignPath.io cung cấp, chứng chỉ bởi SignPath Foundation.

Hiệu ứng âm thanh được tổng hợp trực tiếp bằng Web Audio API khi chạy, nên không có tệp âm thanh nào trong kho mã nguồn.

Phát hành theo [Giấy phép MIT](LICENSE).
