/* Vietnamese support.

   The UI is written in English at the call site; this file swaps the rendered
   text for Vietnamese so nothing else has to know about languages. It walks
   text nodes and accessible labels, then keeps watching for re-rendered parts
   of the app. Unknown strings fall back to English, so a missed label is never
   a blank control. */
(function () {
  "use strict";

  var LANG = "en";

  var VI = {
    /* ---- navigation ---- */
    "Dashboard": "Tổng quan",
    "Timer": "Hẹn giờ",
    "Timetable": "Thời khóa biểu",
    "Tasks": "Công việc",
    "Sections": "Các mục",
    "Display": "Hiển thị",
    "Settings": "Cài đặt",
    "Keyboard shortcuts": "Phím tắt",
    "Keyboard shortcuts (?)": "Phím tắt (?)",
    "Switch colour theme": "Đổi giao diện màu",
    "Switch to the dark theme": "Chuyển sang giao diện tối",
    "Switch to the beige theme": "Chuyển sang giao diện sáng",
    "Set timer duration": "Đặt thời lượng hẹn giờ",
    "Switch to landscape": "Chuyển sang chế độ ngang",
    "Switch to portrait": "Chuyển sang chế độ dọc",
    "The clock needs landscape": "Đồng hồ cần chế độ ngang",
    "Turn the phone sideways to see the flip clock.":
      "Xoay ngang điện thoại để xem đồng hồ lật.",
    "Turn to landscape": "Xoay ngang",
    "Set timer (S)": "Đặt hẹn giờ (S)",
    "Reset timer": "Đặt lại hẹn giờ",
    "Reset timer (R)": "Đặt lại hẹn giờ (R)",

    /* ---- about card ---- */
    "About Flip": "Về Flip",
    "A small study dashboard for your desktop.": "Bảng điều khiển học tập nhỏ gọn cho máy tính.",
    "Made with": "Xây dựng bằng",
    "Rust, Tauri and vanilla JavaScript": "Rust, Tauri và JavaScript thuần",
    "Icons": "Biểu tượng",
    "Generated locally with Pillow": "Tạo cục bộ bằng Pillow",
    "Data": "Dữ liệu",
    "Kept on this computer, always": "Luôn nằm trên máy của bạn",

    /* ---- dashboard ---- */
    "Arrange": "Sắp xếp",
    "Done": "Xong",
    "Reset layout": "Đặt lại bố cục",
    "New task": "Việc mới",
    "Good morning": "Chào buổi sáng",
    "Good afternoon": "Chào buổi chiều",
    "Good evening": "Chào buổi tối",
    "Next up": "Tiết tiếp theo",
    "Today's schedule": "Lịch hôm nay",
    "Upcoming deadlines": "Sắp đến hạn",
    "Today's tasks": "Việc hôm nay",
    "Focus session": "Phiên tập trung",
    "This week": "Tuần này",
    "Your timetable appears here once you add a class.": "Thời khóa biểu sẽ hiện ở đây khi bạn thêm tiết học.",
    "Nothing scheduled": "Chưa có lịch",
    "No classes today": "Hôm nay không có tiết",
    "Enjoy the quiet - or get ahead on a task.": "Không có tiết nào - nghỉ ngơi hoặc làm trước một việc.",
    "Open timetable": "Mở thời khóa biểu",
    "All done": "Đã hoàn tất",
    "No more classes today": "Hôm nay đã hết tiết",
    "See the timetable": "Xem thời khóa biểu",
    "In progress": "Đang diễn ra",
    "Tomorrow": "Ngày mai",
    "Next class": "Tiết kế tiếp",
    "No classes on the timetable today.": "Hôm nay thời khóa biểu trống.",
    "Add a subject": "Thêm môn",
    "Nothing due in the next two weeks.": "Hai tuần tới không có việc nào đến hạn.",
    "Open tasks": "Mở công việc",
    "Nothing planned yet": "Chưa có kế hoạch",
    "Focus running": "Đang tập trung",
    "Session in progress": "Phiên đang chạy",
    "Stop": "Dừng",
    "Open timer": "Mở hẹn giờ",
    "Focus session cancelled": "Đã huỷ phiên tập trung",
    "Focus stopped": "Đã dừng tập trung",
    "saved": "đã lưu",
    "Stop focus session": "Dừng phiên tập trung",
    "Every theme below follows this mode.": "Mọi giao diện bên dưới đều dùng nền này.",
    "Pick a length, then start. Finished sessions are added to your study time.": "Chọn thời lượng rồi bắt đầu. Phiên đã xong sẽ được cộng vào thời gian học.",
    "Start focus": "Bắt đầu tập trung",
    "Today": "Hôm nay",
    "focused": "đã tập trung",
    "day streak": "ngày liên tiếp",
    "Plan it for tonight?": "Lên kế hoạch cho tối nay?",
    "overdue": "quá hạn",
    "now": "bây giờ",
    "break": "nghỉ",
    "Break": "Nghỉ",
    "Lunch": "Nghỉ trưa",
    "Morning break": "Ra chơi",
    "high": "cao",
    "tasks done": "việc đã xong",
    "open tasks": "việc còn mở",
    "sessions": "phiên",
    "session": "phiên",
    "Add a task for today…": "Thêm việc cho hôm nay…",
    "Add a task for today": "Thêm việc cho hôm nay",

    /* ---- timetable ---- */
    "Click a slot to add a subject. Click a filled slot to open its tasks. :)": "Bấm vào ô trống để thêm môn. Bấm vào ô đã có để mở việc của môn đó. :)",
    "Weekend": "Cuối tuần",
    "Import": "Nhập",
    "Add row": "Thêm hàng",
    "Reset": "Đặt lại",
    "Import an .xlsx timetable - hold Shift to save a template": "Nhập thời khóa biểu .xlsx - giữ Shift để lưu mẫu",
    "This clears every subject, all period times and the weekend setting. Your tasks are kept.": "Thao tác này xoá mọi môn, mọi khung giờ và thiết lập cuối tuần. Công việc của bạn vẫn được giữ.",
    "Now": "Bây giờ",
    "Next": "Tiếp",
    "Has pending tasks": "Có việc chưa xong",
    "Subject name": "Tên môn",
    "Colour": "Màu",
    "Room or teacher (optional)": "Phòng hoặc giáo viên (không bắt buộc)",
    "Apply to all cells with this subject name": "Áp dụng cho mọi ô cùng tên môn",
    "Edit subject": "Sửa môn",
    "Add subject": "Thêm môn",
    "Save": "Lưu",
    "Subject name is required.": "Cần nhập tên môn.",
    "Could not save that subject.": "Không lưu được môn này.",
    "Cell cleared": "Đã xoá ô",
    "Clear cell": "Xoá ô",
    "Label": "Tên hàng",
    "Edit row": "Sửa hàng",
    "Remove row": "Xoá hàng",
    "That time was not saved - check the message at the bottom.": "Chưa lưu được giờ - xem thông báo ở dưới.",
    "No subjects yet - click a slot to add one.": "Chưa có môn nào - bấm vào một ô để thêm.",
    "The template could not be built.": "Không tạo được tệp mẫu.",
    "Template saved to Downloads": "Đã lưu mẫu vào thư mục Downloads",
    "That sheet has no lessons in it.": "Trang tính đó không có tiết học nào.",
    "That file could not be imported.": "Không nhập được tệp đó.",

    /* ---- tasks ---- */
    "Drag a card to another day, or use ⋯ to reschedule it without dragging.": "Kéo thẻ sang ngày khác, hoặc dùng ⋯ để đổi ngày.",
    "Subject": "Môn",
    "All subjects": "Tất cả môn",
    "Hide done": "Ẩn việc đã xong",
    "Week starts Sunday": "Tuần bắt đầu Chủ nhật",
    "Week": "Tuần",
    "List": "Danh sách",
    "Task layout": "Kiểu hiển thị việc",
    "Previous week": "Tuần trước",
    "Next week": "Tuần sau",
    "No tasks yet - add one with New task, or click a subject on the timetable.": "Chưa có việc nào - thêm bằng Việc mới, hoặc bấm một môn trong thời khóa biểu.",
    "Add task…": "Thêm việc…",
    "Nothing planned": "Chưa có gì",
    "(no class)": "(không có tiết)",
    "Unscheduled": "Chưa xếp ngày",
    "No unscheduled tasks": "Không có việc chưa xếp",
    "Schedule for": "Xếp vào",
    "Choose another date…": "Chọn ngày khác…",
    "Remove from the week": "Bỏ khỏi tuần",
    "Actions": "Thao tác",
    "Start a focus session": "Bắt đầu phiên tập trung",
    "Edit task details": "Sửa chi tiết việc",
    "Close": "Đóng",
    "Removed from the week": "Đã bỏ khỏi tuần",
    "Day": "Ngày",
    "Schedule task": "Xếp việc",
    "Schedule": "Xếp lịch",
    "That day was not saved.": "Chưa lưu được ngày đó.",
    "Task deleted": "Đã xoá việc",
    "Undo": "Hoàn tác",
    "Task": "Việc",
    "None": "Không",
    "Low": "Thấp",
    "Medium": "Trung bình",
    "High": "Cao",
    "Due date": "Hạn",
    "Time": "Giờ",
    "Priority": "Ưu tiên",
    "Notes (optional)": "Ghi chú (không bắt buộc)",
    "Edit task": "Sửa việc",
    "Save task": "Lưu việc",
    "Add task": "Thêm việc",
    "Give the task a title first.": "Hãy nhập tên việc trước.",
    "That task was not saved.": "Chưa lưu được việc đó.",
    "This subject is no longer on the timetable. Its tasks are kept.": "Môn này không còn trong thời khóa biểu. Công việc của môn vẫn được giữ.",
    "What needs doing?": "Tên công việc",
    "Day (optional)": "Ngày (không bắt buộc)",
    "Due date (optional)": "Hạn (không bắt buộc)",
    "No tasks yet. Add the first thing to learn above.": "Chưa có việc nào. Thêm việc đầu tiên ở trên.",
    "Schedule selected": "Xếp các việc đã chọn",
    "Not now": "Để sau",
    "Never for this task": "Không gợi ý việc này nữa",
    "Pick at least one task first.": "Hãy chọn ít nhất một việc.",
    "Hidden until tomorrow": "Ẩn đến mai",
    "No more suggestions for that task": "Không gợi ý thêm cho việc đó",
    "Chapter 5: quadratic equations": "Chương 5: phương trình bậc hai",
    "Mark complete: ": "Đánh dấu xong: ",
    "Mark incomplete: ": "Bỏ đánh dấu xong: ",
    "More actions for ": "Thao tác khác cho ",
    "Edit ": "Sửa ",
    "Delete ": "Xoá ",

    /* ---- settings ---- */
    "General": "Chung",
    "Language": "Ngôn ngữ",
    "Clock": "Đồng hồ",
    "Clock format": "Định dạng giờ",
    "Sound effects": "Hiệu ứng âm thanh",
    "Updates": "Cập nhật",
    "Setup": "Thiết lập",
    "Run setup": "Chạy thiết lập",
    "Walk through the basics again": "Xem lại các bước cơ bản",
    "Welcome to Flip": "Chào mừng đến với Flip",
    "Choose your language": "Chọn ngôn ngữ",
    "Share anonymous usage": "Chia sẻ thống kê ẩn danh",
    "Off unless you turn it on. One ping a day, and nothing personal.":
      "Mặc định tắt. Mỗi ngày một tín hiệu, không có gì cá nhân.",
    "Sends: a random install id made on this computer, the app version, your interface language, and the date.":
      "Gửi: một mã cài đặt ngẫu nhiên tạo trên máy này, phiên bản ứng dụng, ngôn ngữ giao diện và ngày.",
    "Never sends: tasks, subjects, timetable, notes, timers, settings, file names, your name, or anything that identifies your PC.":
      "Không bao giờ gửi: công việc, môn học, thời khóa biểu, ghi chú, hẹn giờ, cài đặt, tên tệp, tên bạn hay bất cứ gì nhận dạng được máy bạn.",
    "Your IP address is not stored, and nothing is linked to an account. Leave it off and Flip sends nothing at all.":
      "Địa chỉ IP không được lưu và không liên kết với tài khoản nào. Để tắt thì Flip không gửi gì cả.",
    "Animations": "Chuyển động",
    "Extra is livelier, Fast is quieter": "Nhiều thì sinh động hơn, Nhanh thì nhẹ nhàng hơn",
    "Extra": "Nhiều",
    "Normal": "Vừa",
    "Fast": "Nhanh",
    "You can switch any time in Settings.": "Có thể đổi bất cứ lúc nào trong Cài đặt.",
    "A quiet place to study": "Một góc yên tĩnh để học",
    "Your timetable, tasks and focus time, in one window that stays out of the way. Four short steps and you're in.":
      "Thời khóa biểu, công việc và thời gian tập trung trong một cửa sổ gọn gàng. Bốn bước ngắn là xong.",
    "Get started": "Bắt đầu",
    "Continue": "Tiếp tục",
    "Step 2": "Bước 2",
    "Step 3": "Bước 3",
    "Last one": "Bước cuối",
    "Change it later in Settings - nothing here is permanent.":
      "Có thể đổi sau trong Cài đặt - không có gì là cố định.",
    "Theme": "Giao diện",
    "Mode": "Chế độ",
    "Theme mode": "Chế độ giao diện",
    "System": "Theo hệ thống",
    "Custom themes": "Giao diện tuỳ chọn",
    "View more themes": "Xem thêm giao diện",
    "Show fewer themes": "Thu gọn giao diện",
    "Blossom": "Hoa nở",
    "Paper": "Giấy",
    "Mint": "Bạc hà",
    "Slate": "Đá xám",
    "Midnight": "Nửa đêm",
    "Follows your computer's light or dark setting.":
      "Theo thiết lập sáng hoặc tối của máy.",
    "The custom palette uses this base.": "Giao diện tuỳ chọn dùng nền này.",
    "Rose petals on warm paper.": "Cánh hồng trên nền giấy ấm.",
    "Parchment, ink and quiet margins.": "Giấy ngà, mực và lề yên tĩnh.",
    "Cool green, clear and calm.": "Xanh mát, trong và tĩnh.",
    "Cool grey with a blue edge.": "Xám lạnh pha sắc xanh.",
    "Navy depths and moonlight.": "Xanh đêm sâu thẳm và ánh trăng.",
    "Light": "Sáng",
    "Dark": "Tối",
    "Click any empty slot to add a subject, or import an .xlsx file if your school already gives you one.":
      "Bấm vào ô trống để thêm môn, hoặc nhập tệp .xlsx nếu trường đã cung cấp.",
    "Open the timetable": "Mở thời khóa biểu",
    "Skip for now": "Bỏ qua",
    "All set": "Xong rồi",
    "Press ? for shortcuts. Click Flip in the top corner for the version. Run this again any time from Settings.":
      "Nhấn ? để xem phím tắt. Bấm Flip ở góc trên để xem phiên bản. Có thể chạy lại phần này trong Cài đặt.",
    "Start using Flip": "Bắt đầu dùng Flip",
    "Back": "Quay lại",
    "Toggle fullscreen": "Bật/tắt toàn màn hình",
    "Keep Flip on top": "Luôn nổi trên cùng",
    "Stop keeping Flip on top": "Tắt luôn nổi trên cùng",
    "Jump to a section": "Chuyển nhanh giữa các mục",
    "Ctrl + 1 – 4": "Ctrl + 1 – 4",
    "Check for updates": "Kiểm tra cập nhật",
    "Checking…": "Đang kiểm tra…",
    "You're up to date": "Bạn đang dùng bản mới nhất",
    "Could not check for updates": "Không kiểm tra được cập nhật",
    "Download update": "Tải bản cập nhật",
    "Downloading…": "Đang tải…",
    "Ready to install": "Sẵn sàng cài đặt",
    "Install and restart": "Cài đặt và khởi động lại",
    "Installing…": "Đang cài đặt…",
    "Could not download the update": "Không tải được bản cập nhật",
    "Could not start the installer": "Không chạy được bộ cài",
    "On": "Bật",
    "Off": "Tắt",
    "24-hour": "24 giờ",
    "12-hour": "12 giờ",
    "Accent": "Màu nhấn",
    "Appearance": "Hiển thị",
    "Gradient background": "Nền chuyển sắc",
    "Discord Rich Presence": "Hiển thị trên Discord",
    "Download Flip for another PC": "Tải Flip cho máy khác",
    "Shows Flip is open, and whether a timer is running. Never your tasks, subjects or study time.":
      "Cho thấy Flip đang mở và có hẹn giờ đang chạy hay không. Không bao giờ hiện công việc, môn học hay thời gian học của bạn.",
    "Paints the older accent wash behind the app. Off gives the plain theme backdrop.":
      "Vẽ lại lớp nền chuyển sắc theo màu nhấn. Tắt để dùng nền phẳng của giao diện.",
    "Zoom out": "Thu nhỏ",
    "Zoom in": "Phóng to",
    "Settings sections": "Các mục cài đặt",
    "Light High Contrast": "Sáng tương phản cao",
    "Dark High Contrast": "Tối tương phản cao",
    "Flat": "Phẳng",
    "Soft off-white with warm accents.": "Trắng ngà dịu với điểm nhấn ấm.",
    "Black text on white, stronger borders.": "Chữ đen trên nền trắng, viền đậm hơn.",
    "Grey panels rather than pure black.": "Bảng xám thay vì đen tuyền.",
    "White on black with brighter accents.": "Chữ trắng trên nền đen, điểm nhấn sáng hơn.",
    "Square corners, thin borders, no shadows.": "Góc vuông, viền mảnh, không đổ bóng.",
    "Touch mode": "Chế độ cảm ứng",
    "Bigger buttons, rows and spacing for touch screens.": "Nút, hàng và khoảng cách lớn hơn cho màn hình cảm ứng.",
    "Snappy": "Tức thì",
    "Clock and sound": "Đồng hồ và âm thanh",
    "Language and motion": "Ngôn ngữ và chuyển động",
    "Privacy": "Quyền riêng tư",
    "This copy": "Bản ứng dụng này",
    "Download Template": "Tải mẫu",
    "Pick a look": "Chọn giao diện",
    "Change it later in Settings.": "Có thể đổi sau trong Cài đặt.",
    "Your timetable": "Thời khóa biểu của bạn",
    "You're all set": "Đã xong",
    "Everything stays on this computer.": "Mọi thứ lưu trên máy này.",
    "Timetable is ready. Click any slot to add a subject.": "Thời khóa biểu đã sẵn sàng. Bấm vào ô trống để thêm môn.",
    "Filter by subject": "Lọc theo môn",
    "Drop .xlsx to import": "Thả tệp .xlsx để nhập",
    "Day, start, end, subject and room: one lesson per row.":
      "Ngày, bắt đầu, kết thúc, môn và phòng: mỗi dòng một tiết.",
    "No timetable yet": "Chưa có thời khóa biểu",
    "Import an .xlsx file, or build the grid by hand and add your classes in it.":
      "Nhập tệp .xlsx, hoặc tự dựng lưới rồi thêm tiết học vào.",
    "Start timer": "Bắt đầu hẹn giờ",
    "Pause timer": "Tạm dừng hẹn giờ",
    "Import a timetable from an .xlsx file": "Nhập thời khóa biểu từ tệp .xlsx",
    "Save an empty timetable you can fill in": "Lưu thời khóa biểu trống để điền dần",
    "Accent colour": "Màu nhấn",
    "Pick any colour": "Chọn màu bất kỳ",
    "Custom accent colour": "Màu nhấn tuỳ chọn",
    "Backups are unavailable in this build.": "Bản dựng này không có sao lưu.",
    "Backups": "Sao lưu",
    "A backup holds your timetable, tasks, subjects and settings in one file, so Flip can be put back exactly as it was. :D": "Một bản sao lưu chứa thời khóa biểu, công việc, môn học và cài đặt trong một tệp, để Flip có thể trở về đúng như trước. :D",
    "Back up now": "Sao lưu ngay",
    "Show backups folder": "Mở thư mục sao lưu",
    "No backups yet. The first one takes a second.": "Chưa có bản sao lưu nào. Bản đầu tiên chỉ mất một giây.",
    "Restore": "Khôi phục",
    "Delete this backup?": "Xoá bản sao lưu này?",
    "The file is removed from the backups folder. Your live data is untouched.": "Tệp sẽ bị xoá khỏi thư mục sao lưu. Dữ liệu đang dùng không bị ảnh hưởng.",
    "Delete backup": "Xoá bản sao lưu",
    "Backup deleted": "Đã xoá bản sao lưu",
    "Backups could not be listed right now.": "Hiện không liệt kê được các bản sao lưu.",
    "Restore this backup?": "Khôi phục bản sao lưu này?",
    "Your timetable, tasks and settings are replaced with the ones in this backup. Flip saves a safety copy of the current data first, so this can be undone.": "Thời khóa biểu, công việc và cài đặt sẽ được thay bằng bản trong tệp này. Flip lưu một bản an toàn của dữ liệu hiện tại trước, nên có thể hoàn tác.",
    "Restore backup": "Khôi phục bản sao lưu",
    "Backup restored": "Đã khôi phục bản sao lưu",
    "Backup saved": "Đã sao lưu",
    "Export": "Xuất",
    "Spreadsheets open in Excel, Numbers or Google Sheets. Exports are written to your Downloads folder. :3": "Bảng tính mở được bằng Excel, Numbers hoặc Google Sheets. Tệp xuất được lưu vào thư mục Downloads. :3",
    "Tasks as CSV": "Công việc dạng CSV",
    "Timetable as CSV": "Thời khóa biểu dạng CSV",
    "Settings as JSON": "Cài đặt dạng JSON",
    "Data folder": "Thư mục dữ liệu",
    "Flip keeps settings.json and board.json here. Nothing leaves your computer. :)": "Flip lưu settings.json và board.json ở đây. Không có gì rời khỏi máy của bạn. :)",
    "Show data folder": "Mở thư mục dữ liệu",

    /* ---- empty timetable and the quick setup ---- */
    "Cancel": "Hủy",
    "Build your timetable": "Dựng thời khóa biểu",
    "One small form, then the whole week is ready. No subjects are added for you.":
      "Một biểu mẫu nhỏ là cả tuần xong. Không môn nào được điền sẵn.",
    "Days": "Các ngày",
    "Mon–Fri": "Thứ 2 – Thứ 6",
    "Mon–Sat": "Thứ 2 – Thứ 7",
    "Mon–Sun": "Thứ 2 – Chủ nhật",
    "Custom": "Tự chọn",
    "First period starts at": "Tiết đầu bắt đầu lúc",
    "Period length (minutes)": "Độ dài mỗi tiết (phút)",
    "Break between periods (minutes)": "Nghỉ giữa các tiết (phút)",
    "Number of periods": "Số tiết",
    "A longer break in the day": "Có giờ nghỉ dài trong ngày",
    "After period": "Sau tiết",
    "Long break (minutes)": "Nghỉ dài (phút)",
    "Create grid": "Tạo lưới",
    "I'll do it myself": "Tôi tự làm",
    "Grid ready - tap a cell to add a subject": "Lưới đã xong - chạm vào ô để thêm môn",
    "Pick at least one day.": "Hãy chọn ít nhất một ngày.",
    "day": "ngày",
    "days": "ngày",
    "period": "tiết",
    "periods": "tiết",
    "subject": "môn",
    "subjects": "môn",
    "Paint": "Tô màu",
    "Subjects": "Môn học",
    "Nothing to undo.": "Không có gì để hoàn tác.",
    "Nothing to redo.": "Không có gì để làm lại.",

    /* ---- adding and editing subjects ---- */
    "Also add to": "Thêm vào ngày",
    "Same period, every day": "Cùng tiết, mọi ngày",
    "More (room, colour)": "Thêm (phòng, màu)",
    "Copy placed": "Đã dán bản sao",
    "Tap a cell to place a copy": "Chạm vào ô để đặt bản sao",
    "Duplicate": "Nhân bản",
    "Clear": "Xoá",
    "Delete subject everywhere": "Xoá môn ở mọi nơi",
    "More for": "Thêm cho",
    "Undo (Ctrl+Z)": "Hoàn tác (Ctrl+Z)",
    "Redo (Ctrl+Y)": "Làm lại (Ctrl+Y)",
    "Redo": "Làm lại",

    /* ---- rows and days ---- */
    "Add days": "Thêm ngày",
    "Pick the days this timetable runs on. You can change them later.":
      "Chọn những ngày có tiết. Có thể đổi lại sau.",
    "Days of the week": "Các ngày trong tuần",
    "Already on the timetable": "Đã có trong thời khóa biểu",
    "Every day is already on the timetable.": "Mọi ngày đều đã có trong thời khóa biểu.",
    "Add a day": "Thêm một ngày",
    "Add a time slot": "Thêm một tiết",
    "+ Add row": "+ Thêm tiết",
    "Starts": "Bắt đầu",
    "Ends": "Kết thúc",
    "Break row (no subjects)": "Hàng nghỉ (không có môn)",
    "Move the rows after this one too": "Dời cả các tiết phía sau",
    "Lock timetable": "Khoá thời khoá biểu",
    "Unlock timetable": "Mở khoá thời khoá biểu",
    "Unlock the timetable to change the days": "Mở khoá thời khoá biểu để đổi ngày",
    "Timetable is locked": "Thời khoá biểu đang khoá",
    "Unlock": "Mở khoá",
    "Rename day": "Đổi tên ngày",
    "Move left": "Dời sang trái",
    "Move right": "Dời sang phải",
    "Remove day": "Xoá ngày",
    "Day name": "Tên ngày",
    "Save name": "Lưu tên",
    "The weekday stays the same; only the heading changes.":
      "Ngày trong tuần giữ nguyên, chỉ đổi tiêu đề cột.",
    "That name was not saved - check the message at the bottom.":
      "Chưa lưu được tên - xem thông báo ở dưới.",
    "Move up": "Lên trên",
    "Move down": "Xuống dưới",
    "Row removed": "Đã xoá tiết",
    "Reset timetable": "Đặt lại thời khóa biểu",
    "Reset timetable?": "Đặt lại thời khóa biểu?",
    "This clears every day, every row and every subject. Your tasks are kept.":
      "Thao tác này xoá mọi ngày, mọi hàng và mọi môn. Công việc của bạn vẫn được giữ.",
    "Timetable reset": "Đã đặt lại thời khóa biểu",

    /* ---- import ---- */
    "Import a timetable": "Nhập thời khóa biểu",
    "Excel file (.xlsx)": "Tệp Excel (.xlsx)",
    "Paste from a spreadsheet": "Dán từ bảng tính",
    "Paste a timetable": "Dán thời khóa biểu",
    "Pasted timetable": "Thời khóa biểu đã dán",
    "Copy cells from Excel, Google Sheets or a web table and paste them here. The first row should be days and the first column times, or use Day, Start, End, Subject columns.":
      "Sao chép các ô từ Excel, Google Sheets hoặc bảng trên web rồi dán vào đây. Hàng đầu là các ngày, cột đầu là giờ; hoặc dùng các cột Day, Start, End, Subject.",
    "Read table": "Đọc bảng",
    "Paste a table first.": "Hãy dán bảng trước.",
    "Use this timetable?": "Dùng thời khóa biểu này?",
    "Merge into the current timetable": "Gộp vào thời khóa biểu hiện tại",
    "Replace timetable": "Thay thời khóa biểu",
    "Add to timetable": "Thêm vào thời khóa biểu",
    "Timetable imported": "Đã nhập thời khóa biểu",
    "Timetable merged": "Đã gộp thời khóa biểu",
    "Nothing has changed yet.": "Chưa có gì thay đổi.",
    "Pick an .xlsx file.": "Hãy chọn tệp .xlsx.",
    "Pick a cell to place a copy": "Chạm vào ô để đặt bản sao",

    /* ---- exports ---- */
    "Timetable to Excel (.xlsx)": "Xuất thời khóa biểu ra Excel (.xlsx)",
    "Timetable as CSV (for other apps)": "Thời khóa biểu dạng CSV (cho ứng dụng khác)",
    "CSV separator": "Dấu phân cách CSV",
    "Comma": "Dấu phẩy",
    "Semicolon": "Dấu chấm phẩy",
    "Excel with Vietnamese regional settings usually wants Semicolon; most other apps want Comma. The .xlsx export never has this problem.":
      "Excel cài vùng Việt Nam thường cần dấu chấm phẩy; phần lớn ứng dụng khác cần dấu phẩy. Xuất .xlsx thì không gặp vấn đề này.",
    "The spreadsheet could not be built.": "Chưa tạo được bảng tính.",
    "The timetable is not loaded yet.": "Thời khóa biểu chưa tải xong.",
    "Add a lesson first - there is nothing to export yet.":
      "Hãy thêm một tiết trước - chưa có gì để xuất.",

    "Custom accent hue": "Sắc màu nhấn tuỳ chọn",
    "Hue": "Sắc màu",
    "Red": "Đỏ",
    "Orange": "Cam",
    "Yellow": "Vàng",
    "Green": "Lục",
    "Blue": "Lam",
    "Purple": "Tím",
    "Pink": "Hồng",
    "Your IP address is not stored, and nothing is linked to an account.":
      "Địa chỉ IP không được lưu và không liên kết với tài khoản nào.",
    "Widget hidden - Reset layout brings it back": "Đã ẩn tiện ích - Đặt lại bố cục sẽ hiện lại",
    "Dashboard reset to its default layout": "Đã đặt lại bố cục mặc định của Tổng quan",
    "Drag widgets to reorder, or use the arrows": "Kéo tiện ích để đổi thứ tự, hoặc dùng nút mũi tên",
    "Saved": "Đã lưu",
    "Parse": "Phân tích",
    "Edit": "Sửa",
    "Version": "Phiên bản",
    "Weekly timetable": "Thời khóa biểu tuần",

    /* ---- timer + shortcuts ---- */
    "Set timer": "Đặt hẹn giờ",
    "Hours": "Giờ",
    "Minutes": "Phút",
    "Seconds": "Giây",
    "Choose at least one second": "Chọn ít nhất một giây",
    "Choose a duration of at least one second.": "Chọn thời lượng ít nhất một giây.",
    "Time's up": "Hết giờ",
    "Start, pause or resume the timer": "Bắt đầu, tạm dừng hoặc chạy tiếp",
    "Switch between the clock and the timer": "Chuyển giữa đồng hồ và hẹn giờ",
    "Type a duration while the timer is idle": "Nhập thời lượng khi hẹn giờ đang trống",
    "Delete the last typed digit": "Xoá chữ số vừa nhập",
    "Open the set-timer dialog": "Mở hộp đặt hẹn giờ",
    "Reset the timer": "Đặt lại hẹn giờ",
    "Switch 12/24-hour clock": "Đổi đồng hồ 12/24 giờ",
    "Leave fullscreen": "Thoát toàn màn hình",
    "Show this list": "Hiện danh sách này",
    "F, F11, ?, N and Ctrl+1–4 work everywhere. The rest apply to the Timer.": "F, F11, ?, N và Ctrl+1–4 dùng được ở mọi mục. Các phím còn lại dành cho Hẹn giờ.",
    "Space / Enter": "Space / Enter",
    "Tab": "Tab",
    "0 – 9": "0 – 9",
    "Backspace": "Backspace",
    "S": "S",
    "R": "R",
    "T": "T",
    "F or F11": "F hoặc F11",
    "Esc": "Esc",
    "?": "?",

    /* ---- weekdays, months, misc ---- */
    "Sunday": "Chủ nhật",
    "Monday": "Thứ Hai",
    "Tuesday": "Thứ Ba",
    "Wednesday": "Thứ Tư",
    "Thursday": "Thứ Năm",
    "Friday": "Thứ Sáu",
    "Saturday": "Thứ Bảy",
    "Sun": "CN",
    "Mon": "T2",
    "Tue": "T3",
    "Wed": "T4",
    "Thu": "T5",
    "Fri": "T6",
    "Sat": "T7",
    "January": "Tháng 1",
    "February": "Tháng 2",
    "March": "Tháng 3",
    "April": "Tháng 4",
    "May": "Tháng 5",
    "June": "Tháng 6",
    "July": "Tháng 7",
    "August": "Tháng 8",
    "September": "Tháng 9",
    "October": "Tháng 10",
    "November": "Tháng 11",
    "December": "Tháng 12",
    "Jan": "Thg 1",
    "Feb": "Thg 2",
    "Mar": "Thg 3",
    "Apr": "Thg 4",
    "Jun": "Thg 6",
    "Jul": "Thg 7",
    "Aug": "Thg 8",
    "Sep": "Thg 9",
    "Oct": "Thg 10",
    "Nov": "Thg 11",
    "Dec": "Thg 12",

    /* ---- wi-fi sync ---- */
    "Wi-Fi sync": "Đồng bộ Wi-Fi",
    "Keeps your timetable and tasks level with your other device. No account, no internet.":
      "Giữ thời khóa biểu và công việc khớp với thiết bị kia. Không tài khoản, không cần internet.",
    "Your code": "Mã của bạn",
    "Type it on your other device, with both apps open.":
      "Nhập mã này vào thiết bị kia, khi cả hai ứng dụng đang mở.",
    "Other device's code": "Mã của thiết bị kia",
    "Sync now": "Đồng bộ ngay",
    "Sync automatically": "Tự động đồng bộ",
    "Checks every few seconds while both apps are open.":
      "Kiểm tra vài giây một lần khi cả hai ứng dụng đang mở.",
    "Type the code from your other device.": "Hãy nhập mã từ thiết bị kia.",
    "Looking for your other device…": "Đang tìm thiết bị kia…",
    "Synced with": "Đã đồng bộ với",
    "Already up to date.": "Đã là bản mới nhất.",
    "Synced from your other device.": "Đã đồng bộ từ thiết bị kia.",
    "Wrong pairing code.": "Mã ghép nối không đúng.",
    "No device answered. Check both are on the same Wi-Fi.":
      "Không thiết bị nào trả lời. Hãy kiểm tra cả hai đang ở cùng một mạng Wi-Fi.",
    "Could not reach the other device.": "Không kết nối được với thiết bị kia.",
    "Connect to the same Wi-Fi": "Kết nối cùng một Wi-Fi",
    "Both devices need the same Wi-Fi. No internet, no account.":
      "Cả hai thiết bị cần chung một mạng Wi-Fi. Không cần internet, không cần tài khoản.",
    "I have the other code": "Tôi đã có mã của thiết bị kia",
    "Enter their code": "Nhập mã của thiết bị kia",
    "Type the six digits shown on your other device.":
      "Nhập sáu chữ số hiện trên thiết bị kia.",
    "Pairing code": "Mã ghép nối",
    "Type all six digits.": "Hãy nhập đủ sáu chữ số.",
    "Verifying code": "Đang xác minh mã",
    "Talking to your other device…": "Đang liên lạc với thiết bị kia…",
    "Connected": "Đã kết nối",
    "Your other device": "Thiết bị kia",
    "Syncing": "Đang đồng bộ",
    "Moving your timetable and tasks…": "Đang chuyển thời khóa biểu và công việc…",
    "Couldn't connect": "Không kết nối được",
    "Try again": "Thử lại",
    "Connect": "Kết nối",
  };

  /* Counts and durations are assembled at runtime, so they need rules. */
  var RULES = [
    [/^Version (.+) is available$/, "Đã có bản $1"],
    [/^Version ([\d.]+)$/, "Phiên bản $1"],
    [/^(\d+) of (\d+) done$/, "$1/$2 đã xong"],
    [/^(\d+) of (\d+) done this week$/, "$1/$2 việc đã xong tuần này"],
    [/^(?:Period|Tiết) (\d+)$/, "Tiết $1"],
    [
      /^(\d+) tasks? left today · (\d+) of (\d+) done this week$/,
      "$1 việc còn lại hôm nay · $2/$3 việc đã xong tuần này"
    ],
    [/^(\d+) classes? done$/, "$1 tiết đã xong"],
    [/^(\d+) done$/, "$1 xong"],
    [/^done$/, "xong"],
    [/^(\d+) tasks? waiting for this subject$/, "$1 việc đang chờ môn này"],
    [/^(\d+) more in Tasks$/, "thêm $1 việc trong mục Công việc"],
    [/^\+(\d+) more in Tasks$/, "+$1 việc nữa trong Công việc"],
    [/^\+(\d+) more, also scheduled$/, "+$1 việc nữa, cũng đã xếp lịch"],
    [/^\+(\d+) more$/, "+$1 việc nữa"],
    [/^in (.*)$/, "sau $1"],
    [/^(\d+)m left$/, "còn $1 phút"],
    [/^(.*) left$/, "còn $1"],
    [/^(\d+) hours? (\d+) minutes?$/, "$1 giờ $2 phút"],
    [/^(\d+) minutes? (\d+) seconds?$/, "$1 phút $2 giây"],
    [/^(\d+) minutes?$/, "$1 phút"],
    [/^(\d+) hours?$/, "$1 giờ"],
    [/^(\d+) seconds?$/, "$1 giây"],
    [/^(\d+)m$/, "$1 phút"],
    [/^(\d+)h (\d+)m$/, "$1g $2p"],
    [/^Focus session started · (\d+) minutes$/, "Đã bắt đầu phiên tập trung · $1 phút"],
    [/^Focus session saved · (\d+) minutes$/, "Đã lưu phiên tập trung · $1 phút"],
    [/^Moved to (.*)$/, "Đã chuyển sang $1"],
    [/^Scheduled for (.*)$/, "Đã xếp vào $1"],
    [/^Saved (.*) to Downloads$/, "Đã lưu $1 vào thư mục Downloads"],
    [/^Delete backup from (.*)$/, "Xoá bản sao lưu lúc $1"],
    [/^Room (.*)$/, "Phòng $1"],
    [/^(\d+) of 3 done$/, "Đã xong $1/3"],
    [/^(\d+) days · (\d+) rows · (\d+) subjects$/, "$1 ngày · $2 hàng · $3 môn"],
    [/^Day options for (.*)$/, "Tuỳ chọn cho $1"],
    [/^Days: (.*)$/, "Ngày: $1"],
    [/^Rows: (.*)$/, "Hàng: $1"],
    [/^Subjects: (.*)$/, "Môn: $1"]
  ];

  /* Parts of a composed sentence (dashboard subtitle, week ranges). */
  var SUBS = [
    ["no classes today", "hôm nay không có tiết"],
    ["classes today", "tiết hôm nay"],
    ["class today", "tiết hôm nay"],
    ["tasks for today", "việc cần làm hôm nay"],
    ["task for today", "việc cần làm hôm nay"]
  ];

  /* Day and month names turn up inside composed sentences. */
  [
    "January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December", "Sunday", "Monday", "Tuesday",
    "Wednesday", "Thursday", "Friday", "Saturday"
  ]
    .sort(function (a, b) { return b.length - a.length; })
    .forEach(function (name) {
      SUBS.push([name, VI[name]]);
    });

  var ATTRS = ["title", "aria-label", "placeholder", "alt"];

  function translate(text) {
    if (LANG !== "vi" || !text) return text;
    var trimmed = text.trim();
    if (!trimmed) return text;

    if (Object.prototype.hasOwnProperty.call(VI, trimmed)) {
      return text.replace(trimmed, VI[trimmed]);
    }

    /* A date with a word in front of it ("due Nov 24") needs both halves. */
    var prefixed = trimmed.match(/^(due|overdue) ([A-Z][a-z]{2} \d+)$/);
    if (prefixed) {
      var stamp = translate(prefixed[2]);
      return text.replace(
        trimmed,
        (prefixed[1] === "due" ? "hạn " : "quá hạn ") + stamp
      );
    }

    /* "Title · due Nov 24": translate the tail, keep the title as it is. */
    var tail = trimmed.match(/^(.*) · (due|overdue) ([A-Z][a-z]{2} \d+)$/);
    if (tail) {
      return text.replace(
        trimmed,
        tail[1] + " · " + (tail[2] === "due" ? "hạn " : "quá hạn ") + translate(tail[3])
      );
    }

    var suggestion = trimmed.match(/^(.*) has work with no day planned$/);
    if (suggestion) {
      return text.replace(trimmed, suggestion[1] + " có việc chưa xếp ngày");
    }

    /* Dates are built from parts, so handle them directly. */
    var short = trimmed.match(/^([A-Z][a-z]{2}) (\d+)$/);
    if (short && VI[short[1]]) {
      return text.replace(trimmed, short[2] + " " + VI[short[1]]);
    }
    var range = trimmed.match(/^([A-Z][a-z]{2}) (\d+) to ([A-Z][a-z]{2}) (\d+), (\d{4})$/);
    if (range && VI[range[1]] && VI[range[3]]) {
      return text.replace(
        trimmed,
        range[2] + " " + VI[range[1]] + " đến " + range[4] + " " + VI[range[3]] + ", " + range[5]
      );
    }

    for (var i = 0; i < RULES.length; i++) {
      var rule = RULES[i];
      if (rule[0].test(trimmed)) {
        var out = trimmed.replace(rule[0], rule[1]);
        return text.replace(trimmed, out);
      }
    }

    var result = trimmed;
    for (var s = 0; s < SUBS.length; s++) {
      result = result.split(SUBS[s][0]).join(SUBS[s][1]);
    }
    return result === trimmed ? text : text.replace(trimmed, result);
  }

  var SKIP = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1 };

  function translateTextNode(node) {
    var parent = node.parentElement;
    if (!parent || SKIP[parent.tagName]) return;
    var next = translate(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  function translateAttributes(element) {
    for (var i = 0; i < ATTRS.length; i++) {
      var attr = ATTRS[i];
      if (!element.hasAttribute || !element.hasAttribute(attr)) continue;
      var value = element.getAttribute(attr);
      var next = translate(value);
      if (next !== value) element.setAttribute(attr, next);
    }
  }

  var applying = false;

  function apply(root) {
    if (LANG === "en" || !root) return;
    applying = true;
    try {
      if (root.nodeType === 3) {
        translateTextNode(root);
      } else if (root.nodeType === 1) {
        translateAttributes(root);
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(translateTextNode);
        var all = root.querySelectorAll("[title],[aria-label],[placeholder],[alt]");
        Array.prototype.forEach.call(all, translateAttributes);
      }
    } finally {
      applying = false;
    }
  }

  function startObserving() {
    var observer = new MutationObserver(function (records) {
      if (applying) return;
      records.forEach(function (record) {
        if (record.type === "attributes") {
          translateAttributes(record.target);
          return;
        }
        Array.prototype.forEach.call(record.addedNodes, function (node) {
          apply(node);
        });
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ATTRS
    });
  }

  function setLanguage(lang) {
    LANG = lang === "vi" ? "vi" : "en";
    document.documentElement.setAttribute("lang", LANG);
  }

  function boot() {
    var invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
    if (!invoke) {
      apply(document.body);
      startObserving();
      return;
    }
    invoke("get_snapshot")
      .then(function (snap) {
        setLanguage((snap && snap.language) || "en");
        apply(document.body);
        startObserving();
      })
      .catch(function () {
        startObserving();
      });
  }

  /** "3 days" / "3 ngày", using the table for the noun. */
  function count(value, one, many) {
    var number = Number(value) || 0;
    return number + " " + translate(number === 1 ? one : many);
  }

  window.I18n = {
    get language() {
      return LANG;
    },
    setLanguage: setLanguage,
    t: translate,
    count: count,
    apply: apply,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
