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
    "Settings": "Cài đặt",
    "Keyboard shortcuts": "Phím tắt",
    "Keyboard shortcuts (?)": "Phím tắt (?)",
    "Switch colour theme": "Đổi giao diện màu",
    "Switch to the dark theme": "Chuyển sang giao diện tối",
    "Switch to the beige theme": "Chuyển sang giao diện sáng",
    "Set timer duration": "Đặt thời lượng hẹn giờ",
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
    "Enjoy the quiet — or get ahead on a task.": "Không có tiết nào — nghỉ ngơi hoặc làm trước một việc.",
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
    "Pick a length, then start. Finished sessions are added to your study time.": "Chọn thời lượng rồi bắt đầu. Phiên đã xong sẽ được cộng vào thời gian học.",
    "Start focus": "Bắt đầu tập trung",
    "Today": "Hôm nay",
    "focused": "đã tập trung",
    "day streak": "ngày liên tiếp",
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
    "Import an .xlsx timetable — hold Shift to save a template": "Nhập thời khóa biểu .xlsx — giữ Shift để lưu mẫu",
    "Reset timetable?": "Đặt lại thời khóa biểu?",
    "This clears every subject, all period times and the weekend setting. Your tasks are kept.": "Thao tác này xoá mọi môn, mọi khung giờ và thiết lập cuối tuần. Công việc của bạn vẫn được giữ.",
    "Reset timetable": "Đặt lại thời khóa biểu",
    "Timetable reset": "Đã đặt lại thời khóa biểu",
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
    "Starts": "Bắt đầu",
    "Ends": "Kết thúc",
    "Break row (no subjects)": "Hàng nghỉ (không có môn)",
    "Edit row": "Sửa hàng",
    "Remove row": "Xoá hàng",
    "That time was not saved — check the message at the bottom.": "Chưa lưu được giờ — xem thông báo ở dưới.",
    "No subjects yet — click a slot to add one.": "Chưa có môn nào — bấm vào một ô để thêm.",
    "Pick an .xlsx file.": "Hãy chọn tệp .xlsx.",
    "Timetable imported": "Đã nhập thời khóa biểu",
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
    "No tasks yet — add one with New task, or click a subject on the timetable.": "Chưa có việc nào — thêm bằng Việc mới, hoặc bấm một môn trong thời khóa biểu.",
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
    "Data": "Dữ liệu",
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
    "Pick a look": "Chọn giao diện",
    "Change it later in Settings — nothing here is permanent.":
      "Có thể đổi sau trong Cài đặt — không có gì là cố định.",
    "Theme": "Giao diện",
    "Light": "Sáng",
    "Dark": "Tối",
    "Your timetable": "Thời khóa biểu của bạn",
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
    "Check for updates": "Kiểm tra cập nhật",
    "Checking…": "Đang kiểm tra…",
    "You're up to date": "Bạn đang dùng bản mới nhất",
    "Could not check for updates": "Không kiểm tra được cập nhật",
    "Download update": "Tải bản cập nhật",
    "On": "Bật",
    "Off": "Tắt",
    "24-hour": "24 giờ",
    "12-hour": "12 giờ",
    "Accent": "Màu nhấn",
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
    "Toggle fullscreen": "Bật/tắt toàn màn hình",
    "Leave fullscreen": "Thoát toàn màn hình",
    "Show this list": "Hiện danh sách này",
    "F, F11 and ? work in every section. The rest apply to the Timer. XD": "F, F11 và ? dùng được ở mọi mục. Các phím còn lại dành cho Hẹn giờ. XD",
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
    "Dec": "Thg 12"
  };

  /* Counts and durations are assembled at runtime, so they need rules. */
  var RULES = [
    [/^Version (.+) is available$/, "Đã có bản $1"],
    [/^Version ([\d.]+)$/, "Phiên bản $1"],
    [/^(\d+) of (\d+) done$/, "$1/$2 đã xong"],
    [/^(\d+) of (\d+) done this week$/, "$1/$2 việc đã xong tuần này"],
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
    [/^Room (.*)$/, "Phòng $1"]
  ];

  /* Parts of a composed sentence (dashboard subtitle, week ranges). */
  var SUBS = [
    ["no classes today", "hôm nay không có tiết"],
    ["classes today", "tiết hôm nay"],
    ["class today", "tiết hôm nay"],
    ["tasks for today", "việc cần làm hôm nay"],
    ["task for today", "việc cần làm hôm nay"],
    [" to ", " đến "]
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

  window.I18n = {
    get language() {
      return LANG;
    },
    setLanguage: setLanguage,
    t: translate,
    apply: apply,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
