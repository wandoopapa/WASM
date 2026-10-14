/* WASM 게이트웨이 — 간이 채팅 UI (GitHub Pages 정적 호스팅, 비밀정보 없음) */
"use strict";
const BASE = "https://steamdeck.tail8cdc35.ts.net:8446";
const $ = (id) => document.getElementById(id);
const show = (id) => { document.querySelectorAll(".scr").forEach(e => e.classList.remove("on")); $(id).classList.add("on"); };
const stat = (id, t) => { $(id).textContent = t; };

let ipn = null, token = null, me = null, labels = {}, rooms = [], curRoom = null, timer = null, lastDay = null;
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
const apiPost = (p, obj) => gwFetch(p, "POST", JSON.stringify(obj));

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function dispName(uid) { return labels[uid] || uid || ""; }

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
function renderMessages(list) {
  const box = $("msgs"); box.innerHTML = "";
  for (const m of list) {
    const d = document.createElement("div");
    d.className = "m" + ((m.author === me) ? " mine" : "");
    const who = document.createElement("div");
    who.className = "who";
    const tm = fmtTime(m.created_at);
    who.textContent = dispName(m.author) + (tm ? " · " + tm : "");
    d.appendChild(who);
    const b = document.createElement("div");
    b.className = "b";
    const c = String(m.content || "");
    // 사진/동영상 마커 렌더 (서버 저장 형식: 📷 사진: <url> / 🎬 동영상: <url>)
    const lines = c.split("\n");
    for (const ln of lines) {
      const ph = ln.match(/^[📷🎬] (?:사진|동영상): (\S+)$/u);  // u 플래그 필수: 서로게이트 페어
      if (ph) {
        const isV = ln.startsWith("🎬");
        const el = document.createElement(isV ? "video" : "img");
        if (isV) { el.controls = true; el.preload = "metadata"; loadVideo(el, ph[1]); }
        else { el.alt = "사진"; el.onclick = () => mediaClick(el, ph[1]); loadMedia(el, ph[1]); }
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
  box.scrollTop = box.scrollHeight;
}

function appendDayNote() {
  const box = $("msgs");
  const d = document.createElement("div");
  d.className = "daynote";
  d.textContent = "새 날이 시작되었습니다.";
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

async function loadRoom(rid) {
  curRoom = rid;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("sel", b.dataset.rid === rid));
  stat("chatstat", "불러오는 중…");
  try {
    // 00시 초기화: 전체 조회(/api/messages)는 어제 대화를 되돌리므로 쓰지 않는다.
    // 오늘 전용 조회(/api/chat/history, 날짜 미지정=서버 오늘) — 가족앱과 동일 경로.
    // 15초 폴링이 이 조회를 쓰므로 자정을 넘기면 다음 폴링에서 새 날로 바뀐다.
    const d = await apiGet("/api/chat/history?room=" + encodeURIComponent(rid));
    const list = (d && d.messages) || [];
    const rolled = !!(lastDay && d && d.date && d.date !== lastDay);
    if (d && d.date) lastDay = d.date;
    renderMessages(list);
    if (rolled) appendDayNote();
    stat("chatstat", list.length + "건");
  } catch (e) { stat("chatstat", "오류: " + e.message); }
}

async function sendText() {
  const t = $("txt").value.trim();
  if (!t || !curRoom) return;
  $("btn-send").disabled = true;
  try {
    await apiPost("/api/chat/" + encodeURIComponent(curRoom), { text: t });
    $("txt").value = "";
    await loadRoom(curRoom);
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
    await loadRoom(curRoom);
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
    await loadRoom(curRoom);
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
    if (!rooms.length) throw new Error("접근 가능한 방이 없습니다");
    const tabs = $("tabs"); tabs.innerHTML = "";
    for (const r of rooms) {
      const b = document.createElement("button");
      b.className = "ghost"; b.dataset.rid = r.id; b.textContent = r.title;
      b.onclick = () => loadRoom(r.id);
      tabs.appendChild(b);
    }
    show("scr-chat");
    await loadRoom(rooms[0].id);
    clearInterval(timer);
    timer = setInterval(() => { if (curRoom) loadRoom(curRoom); }, 15000);
  } catch (e) { stat("chatstat", "오류: " + e.message); }
}

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
$("btn-send").onclick = sendText;
$("txt").addEventListener("keydown", (e) => { if (e.key === "Enter") sendText(); });
$("btn-reload").onclick = () => { if (curRoom) loadRoom(curRoom); };
$("btn-logout").onclick = () => { try { ipn.logout(); } catch (e) {} token = null; clearInterval(timer); show("scr-login"); stat("loginstat", "로그아웃됨"); };
$("btn-photo").onclick = () => $("file-photo").click();
$("file-photo").onchange = (e) => { sendPhotos(e.target.files); e.target.value = ""; };
$("btn-video").onclick = () => $("file-video").click();
$("file-video").onchange = (e) => { sendVideo(e.target.files[0]); e.target.value = ""; };

boot();
