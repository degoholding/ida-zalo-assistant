import type { ExportTarget } from '../types/import'

/**
 * Mã chạy TRÊN chat.zalo.me (bookmarklet) để xuất tin ra tệp JSON.
 *
 * Đo 02/10/2026: kho IndexedDB `zdb_<uid>` (bảng `message`) có đủ mã tin, người gửi, giờ gửi, loại tin,
 * mentions, quote — nhưng NỘI DUNG (`message`) đã mã hóa, giải mã bằng JS riêng của Zalo (không qua
 * WebCrypto nên không móc được). Trong khi đó màn hình đã vẽ chữ thật, và mỗi khung tin mang
 * `data-qid="<msgId>@<cliMsgId>_<fromUid>_<toUid>"`. Nên: tự cuộn cuộc trò chuyện lên tới đầu, gom chữ /
 * ảnh / tệp từ DOM, ghép với siêu dữ liệu trong IndexedDB theo msgId, tải xuống tệp JSON.
 * Ảnh trên web là `blob:` — đọc blob ra data URL (tối đa 2 MB / ảnh) để máy chủ cất vào kho.
 *
 * Ba chế độ (đối số TARGETS):
 * - `null` → xuất cuộc ĐANG MỞ (nhóm hoặc chat riêng), một tệp.
 * - mảng nhóm (nút «nhóm của bot») → tự tìm từng nhóm trong cột trái (`#conversationList`, mỗi dòng mang
 *   `anim-data-id="<mã cuộc>"`, nhóm có tiền tố "g" — đọc từ mã Zalo Web), bấm mở, cuộn gom.
 * - `'ALL'` → cuộn hết cột trái lấy mọi cuộc (nhóm + chat riêng) rồi làm như trên.
 * Mỗi cuộc một tệp (ảnh nặng, gộp một tệp dễ vượt giới hạn nạp).
 *
 * Mã cuộc: nhóm = "g<mã nhóm>" (toUid của mọi tin). Chat riêng thì tin mình gửi có toUid = người kia, tin
 * người kia gửi có toUid = mình → mã cuộc = bên KHÔNG phải mình (uid lấy từ tên kho `zdb_<uid>`).
 *
 * Giữ ở dạng chuỗi (không phải hàm TypeScript) vì nó được nhét vào `javascript:` URL và chạy trong trang
 * của Zalo. Chỉ dùng cú pháp cũ, không template string, chữ không dấu, để khỏi vỡ khi bọc.
 */
const EXPORTER_BODY = `async function (TARGETS) {
  if (window.__zaloExportRunning) { alert('Dang xuat roi, cho xong lan truoc nhe.'); return; }
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var QID = /^(\\d+)@(\\d+)_(\\d+)_(g?\\d+)$/;
  var MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  var frames = function () { return Array.prototype.slice.call(document.querySelectorAll('[data-component=message-content-view]')); };
  if (!TARGETS && !frames().length) { alert('Hay mo mot cuoc tro chuyen truoc, roi bam lai.'); return; }
  window.__zaloExportRunning = true;

  // Bảng tiến độ nổi trên trang Zalo + nút Dừng
  var stopped = false;
  var panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#0b2a4a;color:#fff;padding:12px 14px;border-radius:8px;font:13px/1.5 sans-serif;max-width:380px;box-shadow:0 4px 16px rgba(0,0,0,.3)';
  var status = document.createElement('div');
  var stopButton = document.createElement('button');
  stopButton.textContent = 'Dung';
  stopButton.style.cssText = 'margin-top:8px;padding:2px 12px;cursor:pointer;color:#0b2a4a';
  stopButton.onclick = function () { stopped = true; stopButton.disabled = true; stopButton.textContent = 'Dang dung...'; };
  panel.appendChild(status); panel.appendChild(stopButton); document.body.appendChild(panel);
  var show = function (text) { status.textContent = text; };

  // 1. Siêu dữ liệu trong IndexedDB (nội dung mã hóa, nhưng giờ gửi / loại tin / mentions / quote dùng được)
  show('Dang doc kho cuc bo...');
  var meta = {};
  var uid = '';
  try {
    var dbs = await indexedDB.databases();
    var main = dbs.map(function (d) { return d.name; }).filter(function (n) { return n && n.indexOf('zdb_') === 0; })[0];
    if (main) {
      uid = main.slice(4);
      var db = await new Promise(function (res, rej) { var r = indexedDB.open(main); r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; });
      var all = await new Promise(function (res, rej) { var rq = db.transaction('message', 'readonly').objectStore('message').getAll(); rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); }; });
      db.close();
      all.forEach(function (m) { if (m && m.msgId) meta[String(m.msgId)] = { originMsgType: m.originMsgType, sendDttm: m.sendDttm, mentions: m.mentions, quote: m.quote, dName: m.dName }; });
    }
  } catch (e) { console.warn('IndexedDB', e); }

  // Mã cuộc của một tin: nhóm = toUid; chat riêng = bên không phải mình (tin mình gửi có fromUid = uid hoặc 0)
  var convOf = function (m) { return m[4].charAt(0) === 'g' ? m[4] : (m[3] === uid || m[3] === '0' ? m[4] : m[3]); };
  var hashText = function (text) { var h = 5381; for (var c = 0; c < text.length; c++) h = ((h * 33) ^ text.charCodeAt(c)) >>> 0; return h.toString(36) + text.length.toString(36); };
  // Giờ trong title của tin hệ thống, vd "10:04 26/09/2026" (thứ tự giờ / ngày không chắc — bắt từng phần)
  var parseTitleTime = function (title) {
    var hm = /(\\d{1,2}):(\\d{2})/.exec(title || '');
    var dmy = /(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?/.exec(title || '');
    if (!hm || !dmy) return null;
    var year = dmy[3] ? Number(dmy[3].length === 2 ? '20' + dmy[3] : dmy[3]) : new Date().getFullYear();
    var ms = new Date(year, Number(dmy[2]) - 1, Number(dmy[1]), Number(hm[1]), Number(hm[2])).getTime();
    return isFinite(ms) ? String(ms) : null;
  };
  var parseQid = function (node) { return QID.exec(node.getAttribute('data-qid') || ''); };
  var showing = function (convId) {
    var nodes = document.querySelectorAll('[data-qid]');
    for (var q = 0; q < nodes.length; q++) { var m = parseQid(nodes[q]); if (m && convOf(m) === convId) return true; }
    return false;
  };
  var scrollable = function (el) { return el && el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(el).overflowY); };
  var scrollerAbove = function (el) { while (el && !scrollable(el)) el = el.parentElement; return el; };
  var senderOf = function (frame) {
    var inside = frame.querySelector('.message-sender-name-content .truncate');
    if (inside) return inside.textContent.trim();
    // Khung ảnh / tệp: tên người gửi nằm ở phần tử anh em ngay trước
    var prev = frame.previousElementSibling;
    if (prev && /message-sender-name-wrapper/.test(prev.className)) { var t = prev.querySelector('.truncate'); return (t ? t.textContent : prev.textContent).trim(); }
    return '';
  };
  var toDataUrl = function (blob) { return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { res(''); }; fr.readAsDataURL(blob); }); };

  // 2. Một cuộc: tự cuộn lên đầu, gom tin ở mỗi bước (danh sách ảo hóa: tin ngoài màn hình bị gỡ khỏi DOM).
  // convId rỗng = cuộc đang mở; có convId thì bỏ tin của cuộc khác còn sót trên màn hình khi vừa chuyển cuộc.
  var exportConversation = async function (convId, label) {
    var found = {};
    var conv = convId;
    var scroller = frames().length ? scrollerAbove(frames()[0]) : null;
    // Đi theo thứ tự trên màn hình: tin thường mang data-qid; tin hệ thống («A đã thêm B vào nhóm») là khối
    // .event-message KHÔNG có mã tin — tự dựng mã từ câu chữ + giờ, giờ đọc ở thuộc tính title (Zalo gắn giờ
    // đầy đủ vào đó), không có thì mượn mốc của tin thường đứng trước / sau.
    var collect = function () {
      var root = scroller || document;
      var prevCli = '';
      var waitingForNext = [];
      Array.prototype.slice.call(root.querySelectorAll('[data-qid], .event-message')).forEach(function (node) {
        if (!node.getAttribute('data-qid')) {
          if (!conv) return;
          var eventText = (node.innerText || '').replace(/\\s+/g, ' ').trim();
          if (!eventText) return;
          var titled = node.querySelector('[title]');
          var title = titled ? titled.getAttribute('title') : '';
          var key = 'sys' + hashText(conv + '|' + eventText + '|' + (title || prevCli));
          if (found[key]) return;
          found[key] = { msgId: key, cliMsgId: prevCli ? String(Number(prevCli) + 1) : '', fromUid: '', toUid: conv, dName: '', text: eventText,
            sendAt: parseTitleTime(title), imgSrc: '', fileUrl: '', fileName: '', kind: 'system' };
          if (!found[key].sendAt && !prevCli) waitingForNext.push(found[key]);
          return;
        }
        var m = parseQid(node);
        if (!m) return;
        if (conv && convOf(m) !== conv) return;
        conv = convOf(m);
        prevCli = m[2];
        waitingForNext.forEach(function (event) { event.cliMsgId = String(Number(m[2]) - 1); });
        waitingForNext = [];
        var msgId = m[1];
        if (found[msgId]) return;
        var frame = node.closest('[data-component=message-content-view]') || node;
        var text = node.querySelector('[data-component=text-container]');
        var img = node.querySelector('img.zimg-el, img[data-z-element-type=image]');
        var link = node.querySelector('a[href^="http"]');
        var fileName = node.querySelector('.file-name, [data-component=file-name], .card-file__name');
        found[msgId] = { msgId: msgId, cliMsgId: m[2], fromUid: m[3], toUid: m[4], dName: senderOf(frame),
          text: text ? text.innerText.trim() : (fileName ? fileName.textContent.trim() : ''),
          imgSrc: img ? img.currentSrc || img.src : '', fileUrl: link && !img ? link.href : '', fileName: fileName ? fileName.textContent.trim() : (link ? link.textContent.trim() : ''),
          kind: text ? 'text' : (img ? 'image' : (link ? 'file' : 'other')) };
      });
    };
    collect();
    var stuck = 0;
    for (var i = 0; i < 1500 && scroller && !stopped; i++) {
      var before = Object.keys(found).length;
      scroller.scrollTop = 0;
      await wait(700);
      collect();
      show(label + ': da gom ' + Object.keys(found).length + ' tin, dang cuon len...');
      if (Object.keys(found).length === before && scroller.scrollTop === 0) { stuck++; if (stuck >= 3) break; } else { stuck = 0; }
    }

    // Ảnh blob: → data URL (web giữ ảnh trong bộ nhớ, máy chủ bot không tải được bằng link)
    var ids = Object.keys(found);
    for (var j = 0; j < ids.length; j++) {
      var d = found[ids[j]];
      d.media = [];
      if (d.imgSrc) {
        if (/^https?:/.test(d.imgSrc)) d.media.push({ kind: 'image', url: d.imgSrc, name: '' });
        else if (/^blob:/.test(d.imgSrc)) {
          show(label + ': dang lay anh ' + (j + 1) + '/' + ids.length);
          try { var blob = await fetch(d.imgSrc).then(function (r) { return r.blob(); }); if (blob.size <= MAX_IMAGE_BYTES) { var dataUrl = await toDataUrl(blob); if (dataUrl) d.media.push({ kind: 'image', url: dataUrl, name: '' }); } } catch (e) { console.warn('anh', e); }
        }
      }
      if (d.fileUrl) d.media.push({ kind: 'file', url: d.fileUrl, name: d.fileName });
    }
    var messages = ids.map(function (id) {
      var d = found[id]; var m = meta[id] || {};
      return { msgId: d.msgId, cliMsgId: d.cliMsgId, fromUid: d.fromUid, toUid: d.toUid, dName: d.dName || m.dName || '',
        sendDttm: m.sendDttm || d.sendAt || null,
        originMsgType: d.kind === 'system' ? 'system' : m.originMsgType || (d.kind === 'image' ? 'chat.photo' : d.kind === 'file' ? 'share.file' : 'webchat'),
        text: d.text, media: d.media, mentions: m.mentions || null, quote: m.quote || null };
    }).sort(function (a, b) { return Number(a.sendDttm || a.cliMsgId || 0) - Number(b.sendDttm || b.cliMsgId || 0); });
    return { convId: conv, messages: messages };
  };

  var download = function (result, name) {
    var payload = { source: 'zalo-web', version: 2, account_uid: uid, exported_at: new Date().toISOString(), conversation: { toUid: result.convId, name: name }, messages: result.messages };
    window.__zaloExport = payload;
    var file = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    var safeName = String(name || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/\\u0111/g, 'd').replace(/\\u0110/g, 'D').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    a.download = 'zalo-web-' + (safeName ? safeName + '-' : '') + (result.convId || 'cuoc') + '-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // 3. Cột trái (cũng là danh sách ảo hóa: chỉ vẽ dòng đang thấy, phải cuộn mới ra dòng khác)
  var list = document.getElementById('conversationList');
  var listScroller = null;
  if (list) {
    listScroller = scrollable(list) ? list : null;
    if (!listScroller) { var inner = list.querySelectorAll('*'); for (var k = 0; k < inner.length && !listScroller; k++) if (scrollable(inner[k])) listScroller = inner[k]; }
    if (!listScroller) listScroller = scrollerAbove(list);
  }
  var nameOfRow = function (row) {
    var named = row.querySelector('.conv-dbname, .truncate');
    return (named ? named.textContent : (row.innerText || '').split('\\n')[0]).trim();
  };
  // Cuộn từ đầu tới cuối cột trái; onRow trả true thì dừng sớm
  var walkList = async function (onRow) {
    var visit = function () {
      var rows = list.querySelectorAll('[anim-data-id]');
      for (var r = 0; r < rows.length; r++) if (onRow(rows[r])) return true;
      return false;
    };
    if (!listScroller) return visit();
    listScroller.scrollTop = 0;
    await wait(400);
    for (var s = 0; s < 500 && !stopped; s++) {
      if (visit()) return true;
      var prevTop = listScroller.scrollTop;
      listScroller.scrollTop = prevTop + Math.max(200, Math.floor(listScroller.clientHeight * 0.8));
      await wait(250);
      if (listScroller.scrollTop === prevTop) return visit();
    }
    return false;
  };
  var findItem = async function (convId) {
    var selector = '[anim-data-id="' + convId + '"]';
    var hit = list.querySelector(selector);
    if (hit) return hit;
    await walkList(function (row) { if (row.getAttribute('anim-data-id') === convId) { hit = row; return true; } return false; });
    return hit || list.querySelector(selector);
  };
  var openConversation = async function (item, convId) {
    item.scrollIntoView({ block: 'center' });
    await wait(200);
    (item.firstElementChild || item).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: 1 }));
    for (var t = 0; t < 40; t++) {
      await wait(250);
      if (showing(convId)) { await wait(800); return true; }
    }
    return false;
  };

  var report = [];
  try {
    if (!TARGETS) {
      var single = await exportConversation('', 'Cuoc dang mo');
      download(single, document.title.replace(/^Zalo - /, ''));
      var missing = single.messages.filter(function (x) { return !x.sendDttm; }).length;
      report.push('Da xuat ' + single.messages.length + ' tin cua cuoc nay' + (missing ? ' (' + missing + ' tin khong co gio gui trong kho, se lay gio xuat tep)' : '') + '.');
    } else if (!list) {
      report.push('Khong thay cot danh sach tro chuyen (#conversationList). Mo tab Tin nhan cua Zalo Web roi bam lai.');
    } else {
      var targets = TARGETS;
      if (TARGETS === 'ALL') {
        show('Dang lay danh sach cuoc tro chuyen...');
        targets = [];
        var seen = {};
        await walkList(function (row) {
          var id = row.getAttribute('anim-data-id') || '';
          if (/^g?\\d+$/.test(id) && !seen[id]) { seen[id] = true; targets.push({ id: id, name: nameOfRow(row) || id }); }
          return false;
        });
      } else {
        targets = TARGETS.map(function (t) { return { id: 'g' + t.id, name: t.name }; });
      }
      var files = 0;
      for (var i = 0; i < targets.length && !stopped; i++) {
        var target = targets[i];
        var label = (i + 1) + '/' + targets.length + ' ' + target.name;
        show(label + ': dang tim trong danh sach...');
        var item = await findItem(target.id);
        if (!item) { report.push(target.name + ': KHONG THAY trong danh sach (tai khoan nay khong o nhom, hoac dang loc tab Chua doc / Phan loai)'); continue; }
        if (!(await openConversation(item, target.id))) { report.push(target.name + ': web khong co tin nao'); continue; }
        var result = await exportConversation(target.id, label);
        if (result.messages.length) { download(result, target.name); files++; await wait(600); }
        report.push(target.name + ': ' + result.messages.length + ' tin');
      }
      report.unshift('Da xuat ' + files + ' tep (moi cuoc mot tep)' + (stopped ? ' - DA DUNG giua chung' : '') + ':');
      if (files > 1) report.push('', 'Neu trinh duyet hoi "Tai xuong nhieu tep" thi bam Cho phep.');
    }
  } finally {
    window.__zaloExportRunning = false;
    document.body.removeChild(panel);
  }
  alert(report.join('\\n') + '\\n\\nMo trang Nhap lich su cua bot de nap cac tep vua tai.');
}`

/** Chú thích (tiếng Việt có dấu) chỉ để người đọc mã — bỏ khỏi bản chạy cho bookmarklet gọn và thuần ASCII. */
const EXPORTER_RUNTIME = EXPORTER_BODY.replace(/^[ \t]*\/\/.*\n/gm, '')

/** Chế độ «mọi cuộc trong cột trái» (nhóm + chat riêng). */
export const EXPORT_ALL_CONVERSATIONS = 'ALL'

/**
 * Mã dán vào Console / bọc thành bookmarklet. `null` = cuộc đang mở; mảng nhóm = các nhóm đó;
 * `EXPORT_ALL_CONVERSATIONS` = mọi cuộc trong danh sách.
 */
export function buildZaloWebExporter(targets: ExportTarget[] | typeof EXPORT_ALL_CONVERSATIONS | null): string {
  const argument = targets === null ? 'null' : targets === EXPORT_ALL_CONVERSATIONS ? `'${EXPORT_ALL_CONVERSATIONS}'` : toAsciiJson(targets)
  return `(${EXPORTER_RUNTIME})(${argument});`
}

/** Thoát mọi ký tự ngoài ASCII thành \uXXXX — mã bookmarklet thuần ASCII, tên nhóm có dấu vẫn đúng. */
function toAsciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u0080-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

/** URL `javascript:` để kéo lên thanh dấu trang. */
export function toBookmarklet(source: string): string {
  return `javascript:${encodeURIComponent(source)}`
}
