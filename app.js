/* WASM 게이트웨이 — 간이 채팅 UI (GitHub Pages 정적 호스팅, 비밀정보 없음) */
"use strict";
const BASE = "https://steamdeck.tail8cdc35.ts.net:8446";
const $ = (id) => document.getElementById(id);
const show = (id) => { document.querySelectorAll(".scr").forEach(e => e.classList.remove("on")); $(id).classList.add("on"); };
const stat = (id, t) => { $(id).textContent = t; };

let ipn = null, token = null, me = null, labels = {}, rooms = [], curRoom = null, timer = null, lastDay = null;
let stickBottom = true, lastMaxId = 0, brainTimer = null, brainRoom = null, brainAfterId = 0, brainDeadline = 0;
let viewDate = null;  // null = 오늘(실시간) · 'YYYY-MM-DD' = 과거 날짜 읽기 전용 보기
// 탭 닫기/새로고침 시 ephemeral 노드가 테일넷에 남지 않도록 로그아웃 시도.
// (명시적 logout = 즉시 삭제, 그냥 끊기면 30~60분 후 정리)
window.addEventListener("pagehide", () => { try { if (ipn) ipn.logout(); } catch (e) {} });

async function gwFetch(path, method, body, contentType) {
  const opts = { method: method || "GET", headers: {} };
  if (token) opts.headers["X-Fa-Token"] = token;
  if (body !== undefined) {
    if (typeof body === "string") { opts.headers["Content-Type"] = contentType || "application/json"; opts.body = body; }
    else { opts.headers["Content-Type"] = contentType; opts.body = body; } // Uint8Array
  }
  const res = await ipn.fetch(BASE + path, opts);
  const txt = await res.text();
  let data = null;
  try { data = JSON.parse(txt); } catch (e) { data = { _raw: txt }; }
  if (!res.ok) throw new Error("HTTP " + res.status + " " + (data.error || data.err || txt.slice(0, 120)));
  return data;
}
const apiGet = (p) => gwFetch(p, "GET");
const apiPut = (p, obj) => gwFetch(p, "PUT", JSON.stringify(obj));
const apiDel = (p) => gwFetch(p, "DELETE");
const apiPost = (p, obj) => gwFetch(p, "POST", JSON.stringify(obj));

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function dispName(uid) { if (uid === "ai") return "🧠 브레인"; return labels[uid] || uid || ""; }

const mediaCache = {};  // url -> blob: URL (15초 자동 새로고침 시 재요청 방지)
function mimeGuess(url) {
  const u = url.toLowerCase();
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".gif")) return "image/gif";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".mp4") || u.endsWith(".m4v")) return "video/mp4";
  if (u.endsWith(".mov")) return "video/quicktime";
  if (u.endsWith(".webm")) return "video/webm";
  return "image/jpeg";
}
// 사진/동영상은 브라우저가 직접 못 받음(테일넷 주소) → WASM fetch 경유 → blob URL로 표시
// 사진 서빙 API는 헤더가 아닌 ?t=토큰 쿼리로만 인증함
async function loadMedia(el, url) {
  el.classList.add("loading");
  try {
    if (mediaCache[url]) { el.src = mediaCache[url]; el.classList.remove("loading"); return; }
    const sep = url.includes("?") ? "&" : "?";
    const full = (url.startsWith("/") ? BASE + url : url) + sep + "t=" + encodeURIComponent(token || "");
    const res = await ipn.fetch(full);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const buf = await res.arrayBuffer();
    const blobUrl = URL.createObjectURL(new Blob([buf], { type: mimeGuess(url) }));
    mediaCache[url] = blobUrl;
    el.src = blobUrl;
    el.classList.remove("loading");
  } catch (e) {
    el.classList.remove("loading");
    el.classList.add("media-err");
    el.alt = "불러오기 실패 — 탭하여 재시도";
    el.title = String(e.message || e);
  }
}
// 대용량 동영상: 4MB 청크 Range 요청으로 분할 수신 (WASM 메모리 부담↓ + 진행 표시)
async function loadVideo(el, url) {
  const CHUNK = 4 * 1024 * 1024;
  el.classList.add("loading");
  const wrap = el.parentElement;
  let prog = null;
  try {
    if (mediaCache[url]) { el.src = mediaCache[url]; el.classList.remove("loading"); return; }
    const sep = url.includes("?") ? "&" : "?";
    const base = (url.startsWith("/") ? BASE + url : url) + sep + "t=" + encodeURIComponent(token || "");
    prog = document.createElement("div");
    prog.className = "vprog";
    prog.textContent = "동영상 받는 중…";
    wrap.appendChild(prog);
    let offset = 0;
    const parts = [];
    for (;;) {
      const res = await ipn.fetch(base, { headers: { "Range": "bytes=" + offset + "-" + (offset + CHUNK - 1) } });
      if (res.status === 416) break;  // 범위 초과 = 끝
      if (!(res.ok || res.status === 206)) throw new Error("HTTP " + res.status);
      const buf = await res.arrayBuffer();
      if (!buf || buf.byteLength === 0) break;
      parts.push(buf);
      offset += buf.byteLength;
      prog.textContent = "동영상 받는 중 " + (offset / 1048576).toFixed(1) + " MB";
      if (buf.byteLength < CHUNK) break;
    }
    prog.remove(); prog = null;
    if (!parts.length) throw new Error("empty");
    const blobUrl = URL.createObjectURL(new Blob(parts, { type: mimeGuess(url) }));
    mediaCache[url] = blobUrl;
    el.src = blobUrl;
    el.classList.remove("loading");
  } catch (e) {
    el.classList.remove("loading");
    if (prog) prog.textContent = "불러오기 실패: " + (e.message || e);
    else { const p2 = document.createElement("div"); p2.className = "vprog"; p2.textContent = "불러오기 실패: " + (e.message || e); wrap.appendChild(p2); }
    el.title = String(e.message || e);
  }
}
function mediaClick(el, url) {
  if (el.classList.contains("media-err")) {
    delete mediaCache[url];
    el.classList.remove("media-err");
    loadMedia(el, url);
  } else if (el.src && el.src.startsWith("blob:")) {
    window.open(el.src, "_blank", "noopener");
  }
}
function fmtTime(ts) {
  const m = String(ts || "").match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? m[4] + ":" + m[5] : "";
}
function isPrivateRoom(rid) { return !!(rid && rid.startsWith("private_")); }
function scrollToBottom() {
  const box = $("msgs");
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; }); });
}
function renderMessages(list) {
  const box = $("msgs");
  const prevTop = box.scrollTop;
  const view = (list && list.length > 300) ? list.slice(-300) : (list || []);
  box.innerHTML = "";
  for (const m of view) {
    if (m && m.id && m.id > lastMaxId) lastMaxId = m.id;
    const c0 = String((m && m.content) || "");
    // 시스템성 메시지(prefill·decode·세션 초기화 등)는 작은 안내 줄로 표시
    if (m.role === "system" || m.author === "system" || /prefill|decode/.test(String(m.author || ""))) {
      const sn = document.createElement("div");
      sn.className = "sysnote";
      sn.textContent = c0;
      box.appendChild(sn);
      continue;
    }
    const isBrain = (m.author === "ai" || m.role === "assistant");
    const d = document.createElement("div");
    d.className = "m" + ((m.author === me) ? " mine" : "") + (isBrain ? " brain" : "");
    const who = document.createElement("div");
    who.className = "who";
    const tm = fmtTime(m.created_at);
    who.textContent = dispName(m.author) + (tm ? " · " + tm : "");
    d.appendChild(who);
    const b = document.createElement("div");
    b.className = "b";
    const c = c0;
    // 사진/동영상 마커 렌더 (서버 저장 형식: 📷 사진: <url> / 🎬 동영상: <url>)
    const lines = c.split("\n");
    for (const ln of lines) {
      const ph = ln.match(/^[📷🎬] (?:사진|동영상): (\S+)$/u);  // u 플래그 필수: 서로게이트 페어
      if (ph) {
        const isV = ln.startsWith("🎬");
        const el = document.createElement(isV ? "video" : "img");
        if (isV) { el.controls = true; el.preload = "metadata"; el.addEventListener("loadedmetadata", () => { if (stickBottom) scrollToBottom(); }); loadVideo(el, ph[1]); }
        else { el.alt = "사진"; el.onload = () => { if (stickBottom) scrollToBottom(); }; el.onclick = () => mediaClick(el, ph[1]); loadMedia(el, ph[1]); }
        b.appendChild(el);
      } else if (ln.trim()) {
        const sp = document.createElement("span");
        sp.textContent = ln;
        b.appendChild(sp);
        b.appendChild(document.createElement("br"));
      }
    }
    if (!b.hasChildNodes()) b.textContent = c;
    d.appendChild(b);
    box.appendChild(d);
  }
  if (stickBottom) scrollToBottom(); else box.scrollTop = prevTop;
}
function appendDayNote() {
  const box = $("msgs");
  const d = document.createElement("div");
  d.className = "daynote";
  d.textContent = "새 날이 시작되었습니다.";
  box.appendChild(d);
  scrollToBottom();
}

async function loadRoom(rid, opts) {
  opts = opts || {};
  const switched = (curRoom !== rid);
  curRoom = rid;
  if (switched) { viewDate = null; stopBrainWait(); }
  applyViewUI();
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("sel", b.dataset.rid === rid));
  $("btn-brain").style.display = (isPrivateRoom(rid) || viewDate) ? "none" : "";
  $("txt").placeholder = isPrivateRoom(rid) ? "AI 비서에게 메시지 — 보내면 바로 답변합니다" : "메시지 입력 (@브레인 호출 가능)";
  if (opts.forceBottom) stickBottom = true;
  stat("chatstat", "불러오는 중…");
  try {
    let list = [], rolled = false;
    if (viewDate) {
      // 과거 날짜 보기 — 채팅방·AI 비서방 공통으로 날짜 지정 조회(가족앱 📅와 동일 API)
      const d = await apiGet("/api/chat/history?room=" + encodeURIComponent(rid) + "&date=" + encodeURIComponent(viewDate));
      list = (d && d.messages) || [];
      renderMessages(list);
      stat("chatstat", "📜 " + viewDate + " 대화 " + list.length + "건 (읽기 전용)");
      return list;
    }
    if (isPrivateRoom(rid)) {
      // AI 비서방(private_<본인>) — 가족앱과 동일 경로 /api/messages/<room> (배열 반환, 전체 이력)
      const d = await apiGet("/api/messages/" + encodeURIComponent(rid));
      list = Array.isArray(d) ? d : ((d && d.messages) || []);
    } else {
      // 00시 초기화: 전체 조회(/api/messages)는 어제 대화를 되돌리므로 쓰지 않는다.
      // 오늘 전용 조회(/api/chat/history, 날짜 미지정=서버 오늘) — 가족앱과 동일 경로.
      // 15초 폴링이 이 조회를 쓰므로 자정을 넘기면 다음 폴링에서 새 날로 바뀐다.
      const d = await apiGet("/api/chat/history?room=" + encodeURIComponent(rid));
      list = (d && d.messages) || [];
      rolled = !!(lastDay && d && d.date && d.date !== lastDay);
      if (d && d.date) lastDay = d.date;
    }
    renderMessages(list);
    if (rolled) appendDayNote();
    // 브레인 답변 도착 판정 — 대기 중인 방에 assistant 메시지가 기준 id보다 뒤에 오면 완료
    if (brainTimer && brainRoom === rid) {
      const ans = list.some(m => m && m.id > brainAfterId && (m.author === "ai" || m.role === "assistant") && m.author !== "system");
      if (ans) { stopBrainWait(); stickBottom = true; scrollToBottom(); stat("chatstat", "🧠 브레인 답변 도착"); return list; }
      if (Date.now() > brainDeadline) { stopBrainWait(); stat("chatstat", "🧠 브레인이 아직 답변 중입니다 — 15초마다 자동으로 확인합니다"); return list; }
      stat("chatstat", "🧠 브레인 답변 생성 중…");
      return list;
    }
    stat("chatstat", list.length + "건");
    return list;
  } catch (e) { stat("chatstat", "오류: " + e.message); return null; }
}

function stopBrainWait() { if (brainTimer) { clearInterval(brainTimer); brainTimer = null; } brainRoom = null; }
function startBrainWait(room, afterId) {
  stopBrainWait();
  brainRoom = room; brainAfterId = afterId || lastMaxId;
  brainDeadline = Date.now() + 5 * 60 * 1000;
  stat("chatstat", "🧠 브레인 답변 생성 중… (답변이 오면 자동으로 표시됩니다)");
  brainTimer = setInterval(() => { if (curRoom === brainRoom) loadRoom(brainRoom); else stopBrainWait(); }, 3000);
}
async function sendText() {
  if (viewDate) return;  // 과거 날짜 보기는 읽기 전용
  const t = $("txt").value.trim();
  if (!t || !curRoom) return;
  const room = curRoom;
  const brainCall = isPrivateRoom(room) || /@브레인/.test(t) || /@brain/i.test(t);
  $("btn-send").disabled = true;
  try {
    await apiPost("/api/chat/" + encodeURIComponent(room), { text: t });
    $("txt").value = "";
    syncBrainBtn();
    stickBottom = true;
    const list = await loadRoom(room, { forceBottom: true });
    scrollToBottom();
    if (brainCall) startBrainWait(room, list ? lastMaxId : 0);
  } catch (e) { stat("chatstat", "전송 오류: " + e.message); }
  $("btn-send").disabled = false;
}
async function sendPhotos(files) {
  if (!files.length || !curRoom) return;
  const fl = Array.from(files).slice(0, 4);
  stat("chatstat", "사진 업로드 중… (" + fl.length + "장)");
  try {
    // 폰 앱과 동일 경로: POST /api/photo/<room> (multipart) → 서버가 파일 저장 + 📷 사진: <url> 메시지 자동 생성
    const bnd = "gw" + Math.random().toString(36).slice(2);
    const enc = new TextEncoder();
    const chunks = [];
    for (const f of fl) {
      chunks.push(enc.encode('--' + bnd + '\r\nContent-Disposition: form-data; name="file"; filename="' + f.name.replace(/"/g, "").slice(0, 60) + '"\r\nContent-Type: ' + (f.type || "image/jpeg") + "\r\n\r\n"));
      chunks.push(new Uint8Array(await f.arrayBuffer()));
      chunks.push(enc.encode("\r\n"));
    }
    chunks.push(enc.encode("--" + bnd + "--\r\n"));
    let len = 0;
    for (const c of chunks) len += c.length;
    const body = new Uint8Array(len);
    let off = 0;
    for (const c of chunks) { body.set(c, off); off += c.length; }
    await gwFetch("/api/photo/" + encodeURIComponent(curRoom), "POST", body, "multipart/form-data; boundary=" + bnd);
    stickBottom = true;
    await loadRoom(curRoom, { forceBottom: true });
    scrollToBottom();
    stat("chatstat", fl.length + "장 전송됨");
  } catch (e) { stat("chatstat", "사진 오류: " + e.message); }
}

async function sendVideo(file) {
  if (!file || !curRoom) return;
  stat("chatstat", "동영상 업로드 중… " + file.name);
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const bnd = "gw" + Math.random().toString(36).slice(2);
    const enc = new TextEncoder();
    const head = enc.encode('--' + bnd + '\r\nContent-Disposition: form-data; name="file"; filename="' + file.name.replace(/"/g, "") + '"\r\nContent-Type: ' + (file.type || "video/mp4") + '\r\n\r\n');
    const tail = enc.encode('\r\n--' + bnd + '--\r\n');
    const body = new Uint8Array(head.length + buf.length + tail.length);
    body.set(head, 0); body.set(buf, head.length); body.set(tail, head.length + buf.length);
    await gwFetch("/api/photo/" + encodeURIComponent(curRoom), "POST", body, "multipart/form-data; boundary=" + bnd);
    stickBottom = true;
    await loadRoom(curRoom, { forceBottom: true });
    scrollToBottom();
  } catch (e) { stat("chatstat", "동영상 오류: " + e.message); }
}

async function enterChat() {
  stat("chatstat", "인증 중…");
  try {
    const a = await apiPost("/api/device-auth", {});
    if (!a.ok || !a.token) throw new Error(a.err || "device-auth 실패");
    token = a.token; me = a.user;
    $("whoami").textContent = "👤 " + (a.label || a.name || me) + " (dev)";
    const lb = await apiGet("/api/identity/labels");
    labels = (lb && lb.labels) || {};
    const rc = await apiGet("/api/identity/my-chat-rooms");
    rooms = (rc && rc.rooms) || [];
    // AI 섹션의 AI 비서방(개인방 private_<본인>) 포함 — 서버 my-chat-rooms는 채팅방만 주므로 여기서 합성.
    // 조회·전송 경로는 가족앱과 동일(/api/messages/<room> 조회 · /api/chat/<room> 전송, 전송 즉시 브레인 답변).
    if (me && !rooms.some(r => r.id === "private_" + me)) rooms.push({ id: "private_" + me, title: "🔒 AI 비서" });
    if (!rooms.length) throw new Error("접근 가능한 방이 없습니다");
    const tabs = $("tabs"); tabs.innerHTML = "";
    for (const r of rooms) {
      const b = document.createElement("button");
      b.className = "ghost"; b.dataset.rid = r.id; b.textContent = r.title;
      b.onclick = () => { exitLedger(); loadRoom(r.id); };
      tabs.appendChild(b);
    }
    const lgb = document.createElement("button");
    lgb.className = "ghost"; lgb.dataset.rid = "__ledger"; lgb.textContent = "💰 가계부";
    lgb.onclick = () => enterLedger();
    tabs.appendChild(lgb);
    show("scr-chat");
    await loadRoom(rooms[0].id, { forceBottom: true });
    clearInterval(timer);
    timer = setInterval(() => { if (curRoom && !lgActive) loadRoom(curRoom); }, 15000);
  } catch (e) { stat("chatstat", "오류: " + e.message); }
}

/* ---- 💰 가계부 (가족앱 가계부방과 동일 API /api/ledger/* · 동일 5탭 구성) ---- */
let lgActive = false, lgTabName = "dash", lgYm = "", lgMeta = null, lgAccounts = [];
let lgTxPage = "나연", lgTxCache = null, lgEditId = 0, lgTxMode = "auto";
let lgFxPage = "나연", lgFxCache = null, lgFxEdit = null, lgImpTimer = null;
const LG_OWNERS = ["나연", "옥태", "공동"];
const lgWon = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";
function lgYmNow() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
function lgYmShift(ym, dd) { const p = (ym || lgYmNow()).split("-"); let y = +p[0], m = +p[1] + dd; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + "-" + String(m).padStart(2, "0"); }
function lgStat(t) { $("lg-stat").textContent = t || ""; }

function enterLedger() {
  lgActive = true;
  if (!lgYm) lgYm = lgYmNow();
  document.querySelector(".wrap").classList.add("lgw");
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("sel", b.dataset.rid === "__ledger"));
  $("msgs").style.display = "none";
  document.querySelector(".composer").style.display = "none";
  $("pastbar").hidden = true;
  $("btn-cal").style.display = "none";
  $("ledger").hidden = false;
  $("lg-ym").textContent = lgYm;
  lgLoadTab();
}
function exitLedger() {
  if (!lgActive) return;
  lgActive = false;
  if (lgImpTimer) { clearInterval(lgImpTimer); lgImpTimer = null; }
  document.querySelector(".wrap").classList.remove("lgw");
  $("ledger").hidden = true;
  $("msgs").style.display = "";
  document.querySelector(".composer").style.display = "";
  $("btn-cal").style.display = "";
  applyViewUI();
}
function lgSetTab(t) {
  lgTabName = t;
  document.querySelectorAll("#lg-tabs button").forEach(b => b.classList.toggle("sel", b.dataset.lgt === t));
  ["dash", "list", "form", "fixed", "report"].forEach(k => { $("lgp-" + k).hidden = (k !== t); });
  lgLoadTab();
}
function lgLoadTab() {
  if (!lgActive) return;
  $("lg-ym").textContent = lgYm;
  if (lgTabName === "dash") lgDashLoad();
  else if (lgTabName === "list") lgListLoad();
  else if (lgTabName === "form") { lgFormInit(); lgImportRefresh(); }
  else if (lgTabName === "fixed") lgFixedLoad();
  else if (lgTabName === "report") lgReportLoad();
}
function lgMonth(d) {
  lgYm = (d === 0) ? lgYmNow() : lgYmShift(lgYm || lgYmNow(), d);
  $("lg-ym").textContent = lgYm;
  if (lgTabName === "fixed") return;  // 고정비는 월과 무관 (가족앱과 동일)
  lgLoadTab();
}

/* 대시보드 — 가족앱 ledgerDashLoad와 같은 집계·표시 */
async function lgDashLoad() {
  const el = $("lg-kpis"); el.innerHTML = '<div class="lmut">불러오는 중…</div>';
  try {
    const j = await apiGet("/api/ledger/dashboard?ym=" + encodeURIComponent(lgYm));
    if (!j.ok) throw new Error(j.error || "조회 실패");
    const cards = [["💵 월 수입", j.income, "#35d07f"], ["📌 월 고정지출", j.fixed.total, "#7aa8ff"], ["💸 변동지출", j.variable, "#e5534b"], ["💰 순잔액", j.net, j.net < 0 ? "#e5534b" : "#35d07f"]];
    el.innerHTML = cards.map(c => '<div class="kpi"><div class="kl">' + esc(c[0]) + '</div><div class="kv" style="color:' + c[2] + '">' + lgWon(c[1]) + "</div></div>").join("");
    $("lg-fixed-note").textContent = "📌 고정지출 = 나연 " + lgWon(j.fixed["나연"]) + " + 옥태 " + lgWon(j.fixed["옥태"]) + " (" + (j.fixed.note || "자동 집계") + ")" + ((j.income_fixed && j.income_fixed.total) ? " · 💰 고정수입 " + lgWon(j.income_fixed.total) + " (월 수입에 포함)" : "");
    $("lg-owners").innerHTML = LG_OWNERS.map(o => {
      const v = (j.by_owner || {})[o] || { income: 0, expense: 0 };
      if (!v.income && !v.expense) return "";
      return '<div class="lcard" style="display:grid;grid-template-columns:36px minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:center"><span style="font-weight:800">' + esc(o) + '</span><span style="text-align:right;white-space:nowrap">수입 <b style="color:#35d07f">' + lgWon(v.income) + '</b></span><span style="text-align:right;white-space:nowrap">지출 <b style="color:#e5534b">' + lgWon(v.expense) + "</b></span></div>";
    }).join("") || '<div class="lmut">이 달 거래 없음</div>';
    const cats = j.by_cat || [];
    if (!cats.length) { $("lg-cats").innerHTML = '<div class="lmut">지출 내역 없음</div>'; return; }
    const mx = Math.max.apply(null, cats.map(c => c.amount).concat([1]));
    $("lg-cats").innerHTML = cats.map(c => '<div class="lcard"><div style="display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:8px"><span>' + esc(c.cat1) + '</span><b style="text-align:right;white-space:nowrap">' + lgWon(c.amount) + '</b></div><div class="bar"><div style="width:' + Math.round(c.amount / mx * 100) + '%"></div></div></div>').join("");
    lgStat(cats.length + "개 분류 · 거래 " + (j.tx_count || 0) + "건");
  } catch (e) { el.innerHTML = '<div class="lmut">조회 오류: ' + esc(e.message) + "</div>"; }
}

/* 메타·계좌 */
async function lgGetMeta() {
  if (lgMeta) return lgMeta;
  const j = await apiGet("/api/ledger/meta");
  if (!j.ok) throw new Error("meta 조회 실패");
  lgMeta = j; return j;
}
async function lgGetAccounts() {
  if (lgAccounts.length) return lgAccounts;
  const j = await apiGet("/api/ledger/accounts");
  lgAccounts = (j && j.accounts) || [];
  return lgAccounts;
}
function lgFillSel(id, items, sel0) {
  const s = $(id); s.innerHTML = "";
  items.forEach(v => { const o = document.createElement("option"); o.value = (v && v.v !== undefined) ? v.v : v; o.textContent = (v && v.t !== undefined) ? v.t : v; if (o.value === sel0) o.selected = true; s.appendChild(o); });
}
function lgSegRender(id, owners, cur, fn) {
  const el = $(id); if (!el) return;
  el.innerHTML = "";
  owners.forEach(o => { const b = document.createElement("button"); b.textContent = o; if (o === cur) b.className = "sel"; b.onclick = () => fn(o); el.appendChild(b); });
}

/* 거래 목록 — 가족앱과 같은 귀속 페이지·2줄 요약·고정 칼럼 */
async function lgListLoad() {
  lgSegRender("lg-tx-seg", LG_OWNERS, lgTxPage, (o) => { lgTxPage = o; lgListLoad(); });
  try {
    const j = await apiGet("/api/ledger/transactions?ym=" + encodeURIComponent(lgYm));
    lgTxCache = (j && j.transactions) || [];
    lgTxRender();
  } catch (e) { $("lg-tx-list").innerHTML = '<div class="lmut">조회 오류: ' + esc(e.message) + "</div>"; }
}
function lgTxRender() {
  const txs = lgTxCache || [];
  const mine = txs.filter(t => (t.owner || "미지정") === lgTxPage);
  const inc = mine.filter(t => t.kind === "수입"), exp = mine.filter(t => t.kind === "지출");
  const sum = (a) => a.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  $("lg-tx-summary").innerHTML =
    '<div class="sumline"><div class="sl">💰 수입 합계 · 이 달</div><div class="sv" style="color:#35d07f">' + inc.length + "건 · " + lgWon(sum(inc)) + "</div></div>" +
    '<div class="sumline"><div class="sl">💸 지출 합계 · 이 달</div><div class="sv" style="color:#e5534b">' + exp.length + "건 · " + lgWon(sum(exp)) + "</div></div>";
  const kc = { "수입": "#35d07f", "지출": "#e5534b", "이체": "#7aa8ff" };
  if (!mine.length) { $("lg-tx-list").innerHTML = '<div class="lmut">이 달에 ' + esc(lgTxPage) + " 거래가 없어요</div>"; return; }
  const box = $("lg-tx-list"); box.innerHTML = "";
  mine.forEach(t => {
    const sign = t.kind === "수입" ? "+" : (t.kind === "지출" ? "-" : "⇄");
    const d = document.createElement("div"); d.className = "txrow";
    d.innerHTML = '<div class="txgrid"><span class="txnote">' + esc(t.note || "") + '</span><span class="txamt" style="color:' + (kc[t.kind] || "") + '">' + sign + lgWon(t.amount) + "</span></div>" +
      '<div class="txmeta">' + esc(t.date || "") + " · " + esc(t.kind || "") + " · " + esc(t.cat1 || "") + (t.cat2 ? "/" + esc(t.cat2) : "") + " · " + esc(t.method || "-") + " · " + esc(t.owner || "") + (t.memo ? " · " + esc(t.memo) : "") + "</div>";
    const row = document.createElement("div"); row.style.cssText = "margin-top:6px;display:flex;gap:6px";
    const be = document.createElement("button"); be.className = "mini"; be.textContent = "✏️ 수정"; be.onclick = () => lgEditTx(t.id);
    const bd = document.createElement("button"); bd.className = "mini"; bd.textContent = "🗑️ 삭제"; bd.onclick = () => lgDelTx(t.id);
    row.appendChild(be); row.appendChild(bd); d.appendChild(row); box.appendChild(d);
  });
}
async function lgDelTx(id) {
  if (!confirm("이 거래를 삭제할까요?")) return;
  try { const j = await apiDel("/api/ledger/transactions/" + id); if (!j.ok) throw new Error(j.error || "삭제 실패"); lgListLoad(); }
  catch (e) { alert("삭제 실패 — " + e.message); }
}

/* 거래 입력 — 수기 폼 (가족앱과 같은 필드·귀속은 상단 세그먼트가 유일한 선택 지점) */
function lgSetMode(m) {
  lgTxMode = (m === "manual") ? "manual" : "auto";
  $("lg-mode-auto").classList.toggle("sel", lgTxMode === "auto");
  $("lg-mode-manual").classList.toggle("sel", lgTxMode === "manual");
  $("lg-pane-auto").hidden = lgTxMode !== "auto";
  $("lg-pane-manual").hidden = lgTxMode !== "manual";
}
function lgOwnerSegs() {
  const fn = (o) => { lgTxPage = o; lgOwnerSegs(); lgMethodFilter(); };
  lgSegRender("lg-owner-auto", LG_OWNERS, lgTxPage, fn);
  lgSegRender("lg-owner-manual", LG_OWNERS, lgTxPage, fn);
  $("lg-f-owner-shown").innerHTML = "<b>" + esc(lgEditId ? (window.__lgEditOwner || lgTxPage) : lgTxPage) + "</b> <span class='lmut'>상단에서 선택한 귀속으로 저장됩니다</span>";
}
function lgCat2Fill() {
  if (!lgMeta) return;
  const c1 = $("lg-f-cat1").value;
  const list = (lgMeta.cat2 || {})[c1] || [];
  lgFillSel("lg-f-cat2", list.length ? list : ["-"]);
}
function lgMethodFilter(keepOwner) {
  const own = lgEditId ? (window.__lgEditOwner || lgTxPage) : lgTxPage;
  const noBy = {}; lgAccounts.forEach(a => { noBy[a.alias] = a.acct_no || ""; });
  const opts = lgAccounts.map(a => {
    let lab = a.alias;
    if (a.kind === "카드" && a.link_acct) lab += " → " + a.link_acct + (noBy[a.link_acct] ? " (" + noBy[a.link_acct] + ")" : "");
    else if (a.acct_no) lab += " (" + a.acct_no + ")";
    return { v: a.alias, t: lab + (a.owner ? " · " + a.owner : ""), owner: a.owner || "" };
  });
  const cur = $("lg-f-method").value;
  const filt = opts.filter(m => m.owner === own || m.owner === "외부" || m.owner === "공동");
  const use = filt.length ? filt : opts;
  lgFillSel("lg-f-method", use.length ? use : [{ v: "-", t: "-" }], use.some(m => m.v === cur) ? cur : undefined);
}
async function lgFormInit() {
  lgSetMode(lgTxMode); lgOwnerSegs();
  try {
    const m = await lgGetMeta(); await lgGetAccounts();
    lgFillSel("lg-f-kind", m.kinds, "지출");
    lgFillSel("lg-f-cat1", m.cat1, "식비");
    lgCat2Fill(); lgMethodFilter();
    if (!lgEditId && !$("lg-f-date").value) $("lg-f-date").value = new Date().toISOString().slice(0, 10);
    const bc = $("lg-b-cat"); if (bc && !bc.options.length) lgFillSel("lg-b-cat", m.cat1, "식비");
  } catch (e) { lgStat("입력 폼 준비 실패 — " + e.message); }
}
async function lgSubmitTx() {
  const body = { date: $("lg-f-date").value, kind: $("lg-f-kind").value, cat1: $("lg-f-cat1").value, cat2: $("lg-f-cat2").value, note: $("lg-f-note").value.trim(), amount: parseInt($("lg-f-amount").value, 10), method: $("lg-f-method").value, owner: lgEditId ? (window.__lgEditOwner || lgTxPage) : lgTxPage, memo: $("lg-f-memo").value.trim() };
  if (!body.date) { alert("날짜를 입력해 주세요"); return; }
  if (!body.note) { alert("내용을 입력해 주세요"); return; }
  if (!(body.amount > 0)) { alert("금액을 입력해 주세요"); return; }
  const btn = $("lg-f-submit"); btn.disabled = true;
  try {
    const j = lgEditId ? await apiPut("/api/ledger/transactions/" + lgEditId, body) : await apiPost("/api/ledger/transactions", body);
    if (!j.ok) throw new Error(j.error || "저장 실패");
    lgFormReset(); lgYm = body.date.slice(0, 7); lgSetTab("dash");
  } catch (e) { alert("저장 실패 — " + e.message); }
  btn.disabled = false;
}
function lgFormReset() {
  lgEditId = 0; window.__lgEditOwner = null;
  $("lg-form-title").textContent = "✏️ 거래 입력";
  $("lg-f-submit").textContent = "💾 저장";
  $("lg-f-cancel").style.display = "none";
  $("lg-f-note").value = ""; $("lg-f-amount").value = ""; $("lg-f-memo").value = "";
  lgOwnerSegs();
}
async function lgEditTx(id) {
  try {
    const j = await apiGet("/api/ledger/transactions?ym=" + encodeURIComponent(lgYm));
    const t = ((j && j.transactions) || []).find(x => x.id === id);
    if (!t) { alert("거래를 찾을 수 없어요"); return; }
    lgEditId = id; window.__lgEditOwner = t.owner || "나연"; lgTxPage = t.owner || lgTxPage;
    await lgFormInit();
    $("lg-f-date").value = t.date || ""; $("lg-f-kind").value = t.kind || "지출";
    $("lg-f-cat1").value = t.cat1 || "기타"; lgCat2Fill(); if (t.cat2) $("lg-f-cat2").value = t.cat2;
    $("lg-f-note").value = t.note || ""; $("lg-f-amount").value = t.amount || "";
    lgMethodFilter(); if (t.method) $("lg-f-method").value = t.method;
    $("lg-f-memo").value = t.memo || "";
    $("lg-form-title").textContent = "✏️ 거래 수정 (#" + id + ")";
    $("lg-f-submit").textContent = "💾 수정 저장";
    $("lg-f-cancel").style.display = "";
    lgOwnerSegs(); lgSetTab("form"); lgSetMode("manual");
  } catch (e) { alert("불러오기 실패 — " + e.message); }
}

/* 이미지 자동입력 — 가족앱과 같은 흐름 (업로드→MAFS 판독→자동 기입, 결과는 건수 로그만) */
function lgImpShow(job) {
  const el = $("lg-imp-status"); if (!el || !job) return;
  const own = job.owner ? " · 귀속 " + job.owner : " · 귀속 미기록(공동 기본)";
  if (job.state === "pending") el.textContent = "⏳ 판독·입력 중… (작업 #" + job.id + own + ")";
  else if (job.state === "failed") el.textContent = "⚠️ 입력 실패 (작업 #" + job.id + own + ") — " + (job.error || "");
  else if (job.state === "done") {
    const r = job.result || {};
    const ins = (r.inserted || []).length;
    el.textContent = "✅ " + ins + "건 입력 완료" + (r.dup ? " · 중복 " + r.dup + "건 제외" : "") + (r.removed ? " · 삭제된 " + r.removed + "건 제외" : "") + " (작업 #" + job.id + own + ")";
  }
}
async function lgImportRefresh() {
  try { const j = await apiGet("/api/ledger/imports"); const jobs = (j && j.imports) || []; if (jobs.length) { lgImpShow(jobs[0]); if (jobs[0].state === "pending") lgImpPoll(jobs[0].id); } }
  catch (e) {}
}
function lgImpPoll(id) {
  if (lgImpTimer) clearInterval(lgImpTimer);
  lgImpTimer = setInterval(async () => {
    try {
      const j = await apiGet("/api/ledger/import/" + id);
      const job = j && j.import; if (!job) return;
      lgImpShow(job);
      if (job.state !== "pending") { clearInterval(lgImpTimer); lgImpTimer = null; }
    } catch (e) {}
  }, 3000);
}
async function lgImportPick(files) {
  const fl = Array.from(files || []).slice(0, 3);
  if (!fl.length) return;
  $("lg-imp-status").textContent = "업로드 중… (" + fl.length + "장)";
  try {
    const imgs = [];
    for (const f of fl) {
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      imgs.push({ name: f.name || "capture.png", mime: f.type || "image/png", data: String(dataUrl).split(",")[1] || "" });
    }
    const j = await apiPost("/api/ledger/import", { owner: lgTxPage, images: imgs });
    if (!j.ok) throw new Error(j.error || "접수 실패");
    $("lg-imp-status").textContent = "⏳ 판독·입력 중… (작업 #" + j.import_id + " · 귀속 " + lgTxPage + ")";
    lgImpPoll(j.import_id);
  } catch (e) { $("lg-imp-status").textContent = "⚠️ 업로드 실패 — " + e.message; }
}

/* 고정비 — 가족앱과 같은 귀속 페이지 분리 (나연/옥태), 4종(고정수입·월고정비·보험·대출) */
const LG_FX = [["income", "💰 고정 수입"], ["fixed", "📌 월고정비"], ["insurance", "🛡️ 보험"], ["loans", "🏦 대출"]];
async function lgFixedLoad() {
  lgSegRender("lg-fx-seg", ["나연", "옥태"], lgFxPage, (o) => { lgFxPage = o; lgFxEdit = null; lgFixedLoad(); });
  try {
    await lgGetAccounts();
    const out = {};
    for (const [k] of LG_FX) { const j = await apiGet("/api/ledger/" + k); out[k] = (j && (j[k] || j.fixed || j.insurance || j.loans || j.income)) || []; }
    lgFxCache = out; lgFxRender();
  } catch (e) { $("lg-fx-all").innerHTML = '<div class="lmut">조회 오류: ' + esc(e.message) + "</div>"; }
}
function lgFxRender() {
  const c = lgFxCache || {};
  const mine = (k) => (c[k] || []).filter(x => (x.owner || "") === lgFxPage);
  const act = (arr) => arr.filter(x => Number(x.active) === 1);
  const tot = (arr) => act(arr).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const incArr = mine("income");
  const expArr = mine("fixed").concat(mine("insurance"), mine("loans"));
  $("lg-fx-summary").innerHTML =
    '<div class="sumline"><div class="sl">💰 수입 합계 · 고정 수입 (사용 중)</div><div class="sv" style="color:#35d07f">' + act(incArr).length + "건 · " + lgWon(tot(incArr)) + "</div></div>" +
    '<div class="sumline"><div class="sl">💸 지출 합계 · 고정비 3종 (사용 중)</div><div class="sv" style="color:#e5534b">' + act(expArr).length + "건 · " + lgWon(tot(expArr)) + "</div></div>";
  const noBy = {}; lgAccounts.forEach(a => { noBy[a.alias] = a; });
  const meth = (m) => {
    if (!m) return "-";
    const a = noBy[m];
    if (a && a.kind === "카드" && a.link_acct) return m + " → " + a.link_acct + (noBy[a.link_acct] && noBy[a.link_acct].acct_no ? " (" + noBy[a.link_acct].acct_no + ")" : "");
    return m + (a && a.acct_no ? " (" + a.acct_no + ")" : "");
  };
  let h = "";
  for (const [k, label] of LG_FX) {
    const arr = mine(k);
    const sub = arr.filter(x => Number(x.active) === 1).reduce((s, x) => s + (Number(x.amount) || 0), 0);
    h += '<div class="lgh" style="display:flex;justify-content:space-between;align-items:center"><span>' + label + '</span><span style="display:flex;gap:8px;align-items:center"><b>' + lgWon(sub) + '</b><button class="mini" data-fxadd="' + k + '">+ 추가</button></span></div>';
    if (!arr.length) h += '<div class="lmut">항목 없음</div>';
    for (const x of arr) {
      const on = Number(x.active) === 1;
      h += '<div class="lcard"><div class="fxgrid"><span style="font-weight:800;font-size:15px;overflow-wrap:anywhere">' + esc(x.name || "") + '</span><span class="badge ' + (on ? "on" : "off") + '">' + (on ? "✅ 사용 중" : "⏸️ 사용 안 함") + '</span><b style="text-align:right;white-space:nowrap">' + lgWon(x.amount) + "</b></div>" +
        '<div class="txmeta">' + esc(meth(x.method)) + (x.pay_day ? " · " + esc(x.pay_day) : "") + (x.company ? " · " + esc(x.company) : "") + (x.insured ? " · 피보험자 " + esc(x.insured) : "") + (x.cat1 ? " · " + esc(x.cat1) : "") + (x.memo ? " · " + esc(x.memo) : "") + "</div>" +
        '<div style="margin-top:6px;display:flex;gap:6px"><button class="mini" data-fxtoggle="' + k + ":" + x.id + '">' + (on ? "⏸️ 끄기" : "✅ 켜기") + '</button><button class="mini" data-fxedit="' + k + ":" + x.id + '">✏️ 수정</button><button class="mini" data-fxdel="' + k + ":" + x.id + '">🗑️ 삭제</button></div></div>';
    }
  }
  $("lg-fx-all").innerHTML = h;
  $("lg-fx-all").querySelectorAll("[data-fxadd]").forEach(b => b.onclick = () => lgFxFormOpen(b.dataset.fxadd, null));
  $("lg-fx-all").querySelectorAll("[data-fxtoggle]").forEach(b => b.onclick = () => { const [k, id] = b.dataset.fxtoggle.split(":"); lgFxToggle(k, +id); });
  $("lg-fx-all").querySelectorAll("[data-fxedit]").forEach(b => b.onclick = () => { const [k, id] = b.dataset.fxedit.split(":"); lgFxFormOpen(k, +id); });
  $("lg-fx-all").querySelectorAll("[data-fxdel]").forEach(b => b.onclick = () => { const [k, id] = b.dataset.fxdel.split(":"); lgFxDelete(k, +id); });
  if (!lgFxEdit) $("lg-fx-form").innerHTML = "";
}
function lgFxFind(k, id) { return ((lgFxCache || {})[k] || []).find(x => x.id === id); }
async function lgFxToggle(k, id) {
  const x = lgFxFind(k, id); if (!x) return;
  const body = Object.assign({}, x, { active: Number(x.active) === 1 ? 0 : 1 });
  try { const j = await apiPut("/api/ledger/" + k + "/" + id, body); if (!j.ok) throw new Error(j.error || "변경 실패"); lgFixedLoad(); }
  catch (e) { alert("변경 실패 — " + e.message); }
}
async function lgFxDelete(k, id) {
  if (!confirm("이 항목을 삭제할까요?")) return;
  try { const j = await apiDel("/api/ledger/" + k + "/" + id); if (!j.ok) throw new Error(j.error || "삭제 실패"); lgFixedLoad(); }
  catch (e) { alert("삭제 실패 — " + e.message); }
}
async function lgFxFormOpen(k, id) {
  lgFxEdit = { kind: k, id: id || 0 };
  const x = id ? lgFxFind(k, id) : null;
  const label = (LG_FX.find(p => p[0] === k) || [])[1] || k;
  let h = '<div class="lcard"><div style="font-weight:800">' + label + (id ? " 수정" : " 추가") + ' — 귀속 <b>' + esc(id ? (x.owner || lgFxPage) : lgFxPage) + '</b> <span class="lmut">상단 페이지에서 선택한 귀속으로 저장됩니다</span></div>';
  h += '<label class="llab">항목명<input class="lin" id="lg-x-name" type="text" value="' + esc(x ? x.name || "" : "") + '"></label>';
  if (k === "insurance") {
    h += '<label class="llab">보험사<input class="lin" id="lg-x-company" type="text" value="' + esc(x ? x.company || "" : "") + '"></label>';
    h += '<label class="llab">피보험자<input class="lin" id="lg-x-insured" type="text" value="' + esc(x ? x.insured || "" : "") + '"></label>';
  }
  if (k === "fixed") h += '<label class="llab">대분류<select class="lin" id="lg-x-cat1"></select></label>';
  h += '<label class="llab">금액(원)<input class="lin" id="lg-x-amount" type="number" inputmode="numeric" value="' + (x ? x.amount : "") + '"></label>';
  h += '<label class="llab">수단(계좌/카드)<select class="lin" id="lg-x-method"></select></label>';
  h += '<label class="llab">결제/입금일<input class="lin" id="lg-x-payday" type="text" placeholder="예: 25" value="' + esc(x ? x.pay_day || "" : "") + '"></label>';
  if (k === "loans") h += '<label class="llab">메모<input class="lin" id="lg-x-memo" type="text" value="' + esc(x ? x.memo || "" : "") + '"></label>';
  h += '<label class="llab">사용 여부<select class="lin" id="lg-x-active"><option value="1">✅ 사용 중</option><option value="0">⏸️ 사용 안 함</option></select></label>';
  h += '<button class="lsubmit" id="lg-x-save">💾 저장</button><button class="hbtn" id="lg-x-cancel" style="width:100%;margin-top:8px;min-height:44px">취소</button></div>';
  $("lg-fx-form").innerHTML = h;
  $("lg-fx-form").scrollIntoView({ behavior: "smooth", block: "start" });
  try { const m = await lgGetMeta(); if (k === "fixed") lgFillSel("lg-x-cat1", m.cat1, x ? x.cat1 : "기타"); } catch (e) {}
  const owner = id ? (x.owner || lgFxPage) : lgFxPage;
  const opts = lgAccounts.filter(a => (a.owner === owner || a.owner === "외부" || a.owner === "공동"));
  lgFillSel("lg-x-method", [{ v: "", t: "- 없음 -" }].concat((opts.length ? opts : lgAccounts).map(a => ({ v: a.alias, t: a.alias + (a.owner ? " · " + a.owner : "") }))), x ? x.method || "" : "");
  if (x) $("lg-x-active").value = String(Number(x.active) === 1 ? 1 : 0);
  $("lg-x-cancel").onclick = () => { lgFxEdit = null; $("lg-fx-form").innerHTML = ""; };
  $("lg-x-save").onclick = () => lgFxSave(k, id || 0, owner);
}
async function lgFxSave(k, id, owner) {
  const body = { name: $("lg-x-name").value.trim(), amount: parseInt($("lg-x-amount").value, 10), method: $("lg-x-method").value, pay_day: $("lg-x-payday").value.trim(), owner: owner, active: parseInt($("lg-x-active").value, 10) };
  if (k === "fixed") body.cat1 = $("lg-x-cat1").value;
  if (k === "insurance") { body.company = $("lg-x-company").value.trim(); body.insured = $("lg-x-insured").value.trim(); }
  if (k === "loans") body.memo = $("lg-x-memo").value.trim();
  if (!body.name) { alert("항목명을 입력해 주세요"); return; }
  if (!(body.amount > 0)) { alert("금액을 입력해 주세요"); return; }
  try {
    const j = id ? await apiPut("/api/ledger/" + k + "/" + id, body) : await apiPost("/api/ledger/" + k, body);
    if (!j.ok) throw new Error(j.error || "저장 실패");
    lgFxEdit = null; lgFixedLoad();
  } catch (e) { alert("저장 실패 — " + e.message); }
}

/* 예산·리포트 — 가족앱과 같은 예산 진행률·6개월 추이·지출 분석 */
async function lgReportLoad() {
  try {
    const m = await lgGetMeta(); if (!$("lg-b-cat").options.length) lgFillSel("lg-b-cat", m.cat1, "식비");
    const b = await apiGet("/api/ledger/budget?ym=" + encodeURIComponent(lgYm));
    const rows = (b && b.rows) || [];
    $("lg-budget-sum").textContent = "예산 합계 " + lgWon(b.total_budget || 0) + " · 예산이 있는 분류 지출 " + lgWon(b.total_actual_on_budget || 0);
    if (!rows.length) $("lg-budget-list").innerHTML = '<div class="lmut">설정된 예산이 없어요 — 아래에서 분류별 예산을 정해 보세요</div>';
    else $("lg-budget-list").innerHTML = rows.map(r => {
      const pct = r.pct == null ? null : Math.min(100, r.pct);
      return '<div class="lcard"><div style="display:grid;grid-template-columns:minmax(0,1fr) 110px 110px;gap:8px;align-items:center"><span style="font-weight:800">' + esc(r.cat1) + '</span><span style="text-align:right;white-space:nowrap">예산 ' + (r.budget == null ? "-" : lgWon(r.budget)) + '</span><span style="text-align:right;white-space:nowrap">지출 ' + lgWon(r.actual) + "</span></div>" +
        (r.pct == null ? "" : '<div class="bar' + (r.pct >= 100 ? " warn" : "") + '"><div style="width:' + pct + '%"></div></div><div class="txmeta">' + r.pct + "%" + (r.pct >= 100 ? " ⚠️ 초과" : "") + "</div>") +
        (r.id ? '<div style="margin-top:6px"><button class="mini" data-bdel="' + r.id + '">🗑️ 예산 삭제</button></div>' : "") + "</div>";
    }).join("");
    $("lg-budget-list").querySelectorAll("[data-bdel]").forEach(btn => btn.onclick = async () => { if (!confirm("이 예산을 삭제할까요?")) return; try { await apiDel("/api/ledger/budget/" + btn.dataset.bdel); lgReportLoad(); } catch (e) { alert("삭제 실패 — " + e.message); } });
    const rp = await apiGet("/api/ledger/report?ym=" + encodeURIComponent(lgYm));
    const tr = (rp && rp.trend) || [];
    const mx = Math.max.apply(null, tr.map(t => t.income).concat([1]));
    $("lg-trend").innerHTML = tr.map(t => '<div class="lcard"><div style="display:grid;grid-template-columns:64px minmax(0,1fr);gap:8px;align-items:center"><b>' + esc(t.ym) + '</b><span class="txmeta" style="margin:0">수입 ' + lgWon(t.income) + " · 고정 " + lgWon(t.fixed) + " · 변동 " + lgWon(t.variable) + ' · 순잔액 <b style="color:' + (t.net < 0 ? "#e5534b" : "#35d07f") + '">' + lgWon(t.net) + '</b></span></div><div class="bar"><div style="width:' + Math.round(t.income / mx * 100) + '%"></div></div></div>').join("");
    const an = (rp && rp.analysis) || {};
    const cats = an.by_cat || [];
    let ah = '<div class="lmut">이번 달 변동지출 ' + lgWon(an.total || 0) + " · 전월(" + esc(an.prev_ym || "") + ") " + lgWon(an.prev_total || 0) + "</div>";
    ah += cats.map(c => '<div class="lcard" style="display:grid;grid-template-columns:minmax(0,1fr) 110px 110px;gap:8px;align-items:center"><span>' + esc(c.cat1) + ' <span class="lmut">' + c.share + '%</span></span><b style="text-align:right;white-space:nowrap">' + lgWon(c.amount) + '</b><span style="text-align:right;white-space:nowrap;color:' + (c.delta > 0 ? "#e5534b" : "#35d07f") + '">' + (c.delta > 0 ? "▲ +" : c.delta < 0 ? "▼ " : "") + lgWon(c.delta) + "</span></div>").join("");
    const bo = an.by_owner_expense || {};
    ah += '<div class="txmeta" style="margin-top:6px">귀속별 변동지출 — ' + LG_OWNERS.map(o => esc(o) + " " + lgWon(bo[o] || 0)).join(" · ") + "</div>";
    $("lg-analysis").innerHTML = ah;
  } catch (e) { $("lg-budget-list").innerHTML = '<div class="lmut">조회 오류: ' + esc(e.message) + "</div>"; }
}
async function lgBudgetSave() {
  const amt = parseInt($("lg-b-amount").value, 10);
  if (!(amt > 0)) { alert("예산 금액을 입력해 주세요"); return; }
  try { const j = await apiPost("/api/ledger/budget", { ym: lgYm, cat1: $("lg-b-cat").value, amount: amt }); if (!j.ok) throw new Error(j.error || "저장 실패"); $("lg-b-amount").value = ""; lgReportLoad(); }
  catch (e) { alert("저장 실패 — " + e.message); }
}

/* 가계부 이벤트 배선 */
document.querySelectorAll("#lg-tabs button").forEach(b => b.onclick = () => lgSetTab(b.dataset.lgt));
$("lg-prev").onclick = () => lgMonth(-1);
$("lg-next").onclick = () => lgMonth(1);
$("lg-this").onclick = () => lgMonth(0);
$("lg-mode-auto").onclick = () => lgSetMode("auto");
$("lg-mode-manual").onclick = () => lgSetMode("manual");
$("lg-f-cat1").addEventListener("change", lgCat2Fill);
$("lg-f-submit").onclick = lgSubmitTx;
$("lg-f-cancel").onclick = lgFormReset;
$("lg-imp-btn").onclick = () => $("lg-imp-file").click();
$("lg-imp-file").onchange = (e) => { lgImportPick(e.target.files); e.target.value = ""; };
$("lg-b-save").onclick = lgBudgetSave;


/* ---- WASM 부팅 ---- */
async function boot() {
  try {
    stat("loadstat", "WASM 모듈 로딩 중… (약 16MB)");
    const go = new Go();
    const resp = await fetch("gw.wasm");
    const wasm = await WebAssembly.instantiateStreaming(resp, go.importObject);
    go.run(wasm.instance);
    stat("loadstat", "Tailscale 노드 초기화 중…");
    ipn = newIPN({ hostname: "gw-ext-" + Math.random().toString(36).slice(2, 8) });
    ipn.run({
      notifyState(s) {
        stat("loginstat", "상태: " + s);
        if (s === "Running") enterChat();
      },
      notifyBrowseToURL(url) {
        window.open(url, "_blank", "noopener");
        $("loginlink").innerHTML = '새 탭이 안 열리면 <a class="login" href="' + esc(url) + '" target="_blank" rel="noopener">여기를 눌러 로그인</a>';
        stat("loginstat", "로그인 탭을 열었습니다. 테일스케일 계정으로 로그인하세요.");
      },
      notifyNetMap() {},
      notifyPanicRecover(e) { stat("loginstat", "WASM 오류: " + e); }
    });
    show("scr-login");
  } catch (e) { stat("loadstat", "부팅 오류: " + e.message); }
}

$("btn-login").onclick = () => { stat("loginstat", "로그인 URL 요청 중…"); ipn.login(); };
function syncBrainBtn() { $("btn-brain").classList.toggle("on", /@브레인/.test($("txt").value) || /@brain/i.test($("txt").value)); }
$("btn-brain").onclick = () => {
  const el = $("txt");
  if (/^\s*@브레인\s?/.test(el.value)) el.value = el.value.replace(/^\s*@브레인\s?/, "");
  else if (/^\s*@brain\s?/i.test(el.value)) el.value = el.value.replace(/^\s*@brain\s?/i, "");
  else el.value = "@브레인 " + el.value.replace(/^\s+/, "");
  syncBrainBtn();
  el.focus();
};
$("txt").addEventListener("input", syncBrainBtn);
function applyViewUI() {
  const past = !!viewDate;
  $("pastbar").hidden = !past;
  if (past) $("pasttxt").textContent = "📜 " + viewDate + " 대화 보기 중 (읽기 전용)";
  $("txt").disabled = past;
  $("btn-send").disabled = past;
  $("btn-photo").style.display = past ? "none" : "";
  $("btn-video").style.display = past ? "none" : "";
  if (past) $("btn-brain").style.display = "none";
  else if (curRoom) $("btn-brain").style.display = isPrivateRoom(curRoom) ? "none" : "";
}
function setViewDate(d) {
  viewDate = d;
  stopBrainWait();
  applyViewUI();
  if (curRoom) loadRoom(curRoom, { forceBottom: true });
}
async function openCal() {
  if (!curRoom) return;
  const list = $("callist");
  list.innerHTML = '<div class="calempty">날짜 불러오는 중…</div>';
  $("calsheet").hidden = false;
  try {
    const d = await apiGet("/api/chat/history/dates?room=" + encodeURIComponent(curRoom));
    const dates = (d && d.dates) || [], counts = (d && d.counts) || {};
    list.innerHTML = "";
    const todayBtn = document.createElement("button");
    todayBtn.className = "calitem" + (!viewDate ? " sel" : "");
    todayBtn.innerHTML = "<span>오늘 (실시간)</span>";
    todayBtn.onclick = () => { $("calsheet").hidden = true; setViewDate(null); };
    list.appendChild(todayBtn);
    for (const day of dates) {
      const b = document.createElement("button");
      b.className = "calitem" + (viewDate === day ? " sel" : "");
      const nm = document.createElement("span"); nm.textContent = day;
      const ct = document.createElement("span"); ct.className = "cnt"; ct.textContent = (counts[day] != null ? counts[day] + "건" : "");
      b.appendChild(nm); b.appendChild(ct);
      b.onclick = () => { $("calsheet").hidden = true; setViewDate(day === todayStr() ? null : day); };
      list.appendChild(b);
    }
    if (!dates.length) list.innerHTML = '<div class="calempty">저장된 대화 날짜가 없습니다</div>';
  } catch (e) { list.innerHTML = '<div class="calempty">오류: ' + esc(e.message) + "</div>"; }
}
function todayStr() { const n = new Date(); return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0"); }
$("btn-cal").onclick = openCal;
$("btn-cal-close").onclick = () => { $("calsheet").hidden = true; };
$("calsheet").addEventListener("click", (e) => { if (e.target === $("calsheet")) $("calsheet").hidden = true; });
$("btn-today").onclick = () => setViewDate(null);
$("msgs").addEventListener("scroll", () => { const box = $("msgs"); stickBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 120; });
$("btn-send").onclick = sendText;
$("txt").addEventListener("keydown", (e) => { if (e.key === "Enter") sendText(); });
$("btn-reload").onclick = () => { if (lgActive) lgLoadTab(); else if (curRoom) loadRoom(curRoom); };
$("btn-logout").onclick = () => { try { ipn.logout(); } catch (e) {} token = null; clearInterval(timer); show("scr-login"); stat("loginstat", "로그아웃됨"); };
$("btn-photo").onclick = () => $("file-photo").click();
$("file-photo").onchange = (e) => { sendPhotos(e.target.files); e.target.value = ""; };
$("btn-video").onclick = () => $("file-video").click();
$("file-video").onchange = (e) => { sendVideo(e.target.files[0]); e.target.value = ""; };

boot();
