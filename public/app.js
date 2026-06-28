// Same-origin: server.js serves the static files, so the backend
// and frontend share one URL — no CORS or URL mismatch issues.
var BACKEND_URL = window.location.origin;

// ── Telegram WebApp SDK ───────────────────────────────────────
var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;

var telegramUser = {
  id:         'guest-' + Math.floor(Math.random() * 999999),
  first_name: 'Guest',
};
var initDataRaw = '';

if (tg) {
  tg.ready();
  tg.expand();
  tg.enableClosingConfirmation();
  if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
    telegramUser = tg.initDataUnsafe.user;
  }
  initDataRaw = tg.initData || '';
}

function haptic(style) {
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred(style || 'light');
}
function hapticNotify(type) {
  if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(type || 'success');
}

// ── DOM references ────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

var viewDashboard   = el('view-dashboard');
var viewBingo       = el('view-bingo');
var balanceEl       = el('balance-amount');
var balanceGameEl   = el('balance-amount-game');
var userNameEl      = el('user-name');
var openBingoBtn    = el('open-bingo');
var backBtn         = el('back-to-dashboard');
var statusBannerEl  = el('status-banner');
var calledStripEl   = el('called-strip');
var bingoGridEl     = el('bingo-grid');
var joinBtn         = el('join-btn');
var bingoBtn        = el('bingo-btn');

// ── State ─────────────────────────────────────────────────────
var currentCard   = null;
var calledNumbers = [];
var roomStatus    = 'WAITING';
var myUserId      = String(telegramUser.id);

// ── Helpers ──────────────────────────────────────────────────
function setBalance(n) {
  var v = Number(n).toLocaleString();
  if (balanceEl)     balanceEl.textContent     = v;
  if (balanceGameEl) balanceGameEl.textContent = v;
}

function setBanner(text, live) {
  statusBannerEl.textContent = text;
  if (live) statusBannerEl.classList.add('live');
  else      statusBannerEl.classList.remove('live');
}

function showView(name) {
  viewDashboard.classList.toggle('active', name === 'dashboard');
  viewBingo.classList.toggle('active',     name === 'bingo');
}

function resetBingoView() {
  currentCard   = null;
  calledNumbers = [];
  bingoGridEl.innerHTML   = '';
  calledStripEl.innerHTML = '';
  joinBtn.classList.remove('hidden');
  bingoBtn.classList.add('hidden');
  setBanner('Tap Join to enter the next round');
}

// ── Socket.IO connection ──────────────────────────────────────
var socket = io(BACKEND_URL, {
  transports: ['websocket', 'polling'],
  auth: {
    initData:   initDataRaw,
    telegramId: telegramUser.id,
    name:       telegramUser.first_name,
  },
});

socket.on('connect', function() {
  console.log('[OmniHub] Socket connected:', socket.id);
});

socket.on('profile', function(data) {
  myUserId = String(data.id);
  setBalance(data.balance);
  if (userNameEl) userNameEl.textContent = ', ' + (data.name || 'Player');
});

socket.on('auth_error', function(data) {
  setBanner(data.message || 'Authentication failed.');
});

socket.on('joined_room', function(data) {
  setBalance(data.balance);
  joinBtn.classList.add('hidden');
  setBanner('You joined! Waiting for round to start...');
});

socket.on('room_state', function(data) {
  roomStatus    = data.status;
  calledNumbers = data.calledNumbers || [];
  renderCalledStrip();
  if (data.status === 'WAITING') {
    setBanner('Waiting for players — Pot: ' + data.pot + ' coins');
    joinBtn.classList.remove('hidden');
    bingoBtn.classList.add('hidden');
  }
});

socket.on('countdown', function(data) {
  setBanner(
    'Starting in ' + data.secondsLeft + 's' +
    '  |  Hash: ' + data.serverSeedHash.slice(0, 14) + '...',
    true
  );
});

socket.on('card_assigned', function(data) {
  currentCard = data.card;
  renderCard();
});

socket.on('game_started', function() {
  setBanner('Round live! Mark your called numbers.', true);
  bingoBtn.classList.remove('hidden');
  joinBtn.classList.add('hidden');
});

socket.on('number_called', function(data) {
  calledNumbers = data.calledNumbers;
  renderCalledStrip();
  haptic('light');
});

// cell_marked is server confirmation — UI already updated on click (no extra action)
socket.on('cell_marked', function() {});

socket.on('game_over', function(data) {
  bingoBtn.classList.add('hidden');
  if (data.winnerId && String(data.winnerId) === myUserId) {
    setBanner('You won ' + data.payout + ' coins!', true);
    hapticNotify('success');
    // Update balance (server already credited)
    socket.emit('get_profile');
  } else if (data.winnerId) {
    setBanner('Round over — another player won this round.');
    hapticNotify('warning');
  } else {
    setBanner('Round over — no winner this time.');
  }
  // Reset board after 5 seconds
  setTimeout(function() { resetBingoView(); }, 5000);
});

socket.on('error_msg', function(data) {
  setBanner(data.message || 'Something went wrong.');
  hapticNotify('error');
});

// ── Rendering ─────────────────────────────────────────────────
function renderCalledStrip() {
  calledStripEl.innerHTML = '';
  var recent = calledNumbers.slice(-14);
  for (var idx = 0; idx < recent.length; idx++) {
    var chip = document.createElement('div');
    chip.className  = 'called-chip' + (idx === recent.length - 1 ? ' recent' : '');
    chip.textContent = recent[idx];
    calledStripEl.appendChild(chip);
  }
  if (calledStripEl.lastChild) {
    calledStripEl.lastChild.scrollIntoView({ behavior: 'smooth', inline: 'end' });
  }
}

function renderCard() {
  bingoGridEl.innerHTML = '';
  if (!currentCard) return;
  var cols = ['B','I','N','G','O'];
  for (var row = 0; row < 5; row++) {
    for (var ci = 0; ci < cols.length; ci++) {
      var col   = cols[ci];
      var value = currentCard[col][row];
      var cell  = document.createElement('div');
      cell.className   = 'bingo-cell';
      cell.textContent = value;
      if (value === 'FREE') {
        cell.classList.add('free', 'marked');
      } else {
        // Closure: capture col and value with IIFE
        (function(c, v, cellEl) {
          cellEl.addEventListener('click', function() { onCellClick(c, v, cellEl); });
        })(col, value, cell);
      }
      bingoGridEl.appendChild(cell);
    }
  }
}

function onCellClick(col, value, cellEl) {
  if (roomStatus !== 'IN_PROGRESS') return;
  if (!calledNumbers.includes(value)) {
    haptic('rigid');
    setBanner('That number (' + value + ') has not been called yet!');
    return;
  }
  if (cellEl.classList.contains('marked')) return; // already marked, ignore
  cellEl.classList.add('marked');
  haptic('light');
  socket.emit('mark_cell', { col: col, value: value });
}

// ── Button handlers ───────────────────────────────────────────
openBingoBtn.addEventListener('click', function() {
  haptic('light');
  showView('bingo');
});

backBtn.addEventListener('click', function() {
  haptic('light');
  socket.emit('leave_room');
  showView('dashboard');
  resetBingoView();
});

joinBtn.addEventListener('click', function() {
  haptic('medium');
  socket.emit('join_room', { roomId: 'main' });
});

bingoBtn.addEventListener('click', function() {
  haptic('heavy');
  socket.emit('claim_bingo');
});

// ── Initialise ────────────────────────────────────────────────
showView('dashboard');`;

// ─────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────
const FILES = [
  { id:"server", emoji:"🖥",  label:"server.js",    filename:"server.js",        place:"/ root",   code:SERVER_JS },
  { id:"pkg",    emoji:"📦",  label:"package.json",  filename:"package.json",     place:"/ root",   code:PKG_JSON  },
  { id:"html",   emoji:"🌐",  label:"index.html",    filename:"public/index.html",place:"public/",  code:INDEX_HTML},
  { id:"css",    emoji:"🎨",  label:"style.css",     filename:"public/style.css", place:"public/",  code:STYLE_CSS },
  { id:"appjs",  emoji:"📱",  label:"app.js",        filename:"public/app.js",    place:"public/",  code:APP_JS    },
];

// ─── Render settings reference ────────────────────────────────
const RENDER_SETTINGS = [
  { field:"Name",           value:"omnihub-bingo",    note:"Render URL-ህ ይሆናል: omnihub-bingo.onrender.com" },
  { field:"Region",         value:"Frankfurt (EU Central)", note:"ለኢትዮጵያ ቅርብ ያለው region ነው" },
  { field:"Branch",         value:"main",             note:"እንዳለ ተወው — ካልቀየርከው main ነው" },
  { field:"Build Command",  value:"npm install",      note:"ትክክለኛ spelling: npm install (npm run install አይደለም)" },
  { field:"Start Command",  value:"node server.js",   note:"ትክክለኛ spelling: node server.js (Node server.js አይደለም — capital N አይሰራም)" },
  { field:"Instance Type",  value:"Free ($0/month)",  note:"ወደ ታች scroll አድርግ ➜ Free ምረጥ" },
];

const BUILD_LOGS = [
  { ok:true,  log:"==> Cloning repository...",                    note:"GitHub repo ተወስዷል" },
  { ok:true,  log:"==> Running build command: npm install",       note:"packages እየተጫኑ ነው" },
  { ok:true,  log:"added 89 packages in 12s",                     note:"express, socket.io, cors ተጫኑ" },
  { ok:true,  log:"==> Build successful 🎉",                      note:"ኮዱ ተዘጋጅቷል" },
  { ok:true,  log:"==> Starting service with: node server.js",    note:"server እየጀመረ ነው" },
  { ok:true,  log:"OmniHub running on port 10000",                note:"✅ LIVE ነው! URL ጠቅ አድርግ" },
  { ok:false, log:"Error: Cannot find module 'express'",          note:"❌ package.json ትክክለኛ ስም ካልሆነ — ደግሞ upload አድርግ" },
  { ok:false, log:"Error: ENOENT: no such file 'server.js'",      note:"❌ server.js root ላይ ካልሆነ — public/ ፎልደር ውስጥ አይደለም" },
  { ok:false, log:"Build failed",                                 note:"❌ Start Command spelling ተመልከት" },
];

const CHECKS = [
  "HMAC-SHA256 Fisher-Yates (col + index + pool) ✓",
  "Closure-in-loop bug fixed (IIFE in renderCard) ✓",
  "Telegram initData verification ✓",
  "Win detection: Row / Col / 2× Diagonal / Full House ✓",
  "Haptic feedback — click, notify, rigid ✓",
  "Auto-mark FREE cell (N[2]) ✓",
  "Back button resets board + leaves room ✓",
  "Socket.IO transports: websocket + polling fallback ✓",
  "Express serves public/ static files ✓",
  "Health check /health endpoint ✓",
];

export default function App() {
  const [tab,    setTab]    = useState("server");
  const [copied, setCopied] = useState(null);
  const [mainTab,setMainTab]= useState("files"); // "files" | "render" | "verify"

  const file = FILES.find(function(f){ return f.id === tab; });

  function copy(code, id) {
    if (navigator.clipboard) navigator.clipboard.writeText(code);
    setCopied(id);
    setTimeout(function(){ setCopied(null); }, 2200);
  }

  return (
    <div style={{minHeight:"100vh",background:BG,fontFamily:"sans-serif"}}>

      {/* Header */}
      <div style={{background:"linear-gradient(160deg,#050505,#060900)",borderBottom:"1px solid "+BRD,padding:"20px 18px 16px",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-50,right:-50,width:200,height:200,background:"radial-gradient(circle,rgba(201,168,76,.07),transparent 70%)",pointerEvents:"none"}}/>
        <div style={{fontFamily:"monospace",fontSize:".52rem",letterSpacing:4,color:G,marginBottom:4}}>// OMNIHUB — ሁሉም 5 ፋይሎች ፍጹም ተዘጋጅተዋል</div>
        <div style={{fontFamily:"monospace",fontWeight:900,fontSize:"clamp(.9rem,2.5vw,1.4rem)",background:"linear-gradient(135deg,#fff 20%,"+GL+" 60%,"+G+")",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginBottom:4}}>
          Bug-Free · Copy-Ready · Deploy Now
        </div>
        <div style={{fontFamily:"monospace",fontSize:".65rem",color:"rgba(255,255,255,.3)"}}>
          server.js &nbsp;·&nbsp; package.json &nbsp;·&nbsp; index.html &nbsp;·&nbsp; style.css &nbsp;·&nbsp; app.js
        </div>
      </div>

      {/* Checklist strip */}
      <div style={{background:BGC,borderBottom:"1px solid rgba(255,255,255,.05)",padding:"12px 18px",display:"flex",gap:6,flexWrap:"wrap"}}>
        {CHECKS.map(function(c,i){
          return (
            <div key={i} style={{display:"flex",alignItems:"center",gap:5,background:"rgba(76,175,130,.07)",border:"1px solid rgba(76,175,130,.15)",borderRadius:6,padding:"3px 8px"}}>
              <span style={{color:GRN,fontSize:".45rem"}}>◆</span>
              <span style={{fontFamily:"monospace",fontSize:".58rem",color:"rgba(255,255,255,.5)"}}>{c}</span>
            </div>
          );
        })}
      </div>

      {/* Main navigation tabs */}
      <div style={{display:"flex",gap:0,background:BGS,borderBottom:"1px solid rgba(255,255,255,.07)"}}>
        {[["files","📁  ፋይሎች (5)"],["render","⚡  Render Settings"],["verify","✅  Live ማረጋገጫ"]].map(function(t){
          const a = mainTab===t[0];
          return (
            <button key={t[0]} onClick={function(){setMainTab(t[0]);}}
              style={{flex:1,padding:"11px 4px",fontFamily:"monospace",fontSize:".62rem",letterSpacing:.5,
                background:a?"rgba(201,168,76,.09)":BGS,
                borderBottom: a?"2px solid "+G:"2px solid transparent",
                border:"none",borderBottom:a?"2px solid "+G:"2px solid transparent",
                color:a?GL:"rgba(255,255,255,.3)",cursor:"pointer"}}>
              {t[1]}
            </button>
          );
        })}
      </div>

      {/* ── TAB: FILES ─────────────────────────────────── */}
      {mainTab==="files" && (<>
        {/* File tabs */}
        <div style={{display:"flex",gap:2,padding:"8px 14px",borderBottom:"1px solid rgba(255,255,255,.05)",flexWrap:"wrap",background:BGC}}>
          {FILES.map(function(f){
            const active = tab === f.id;
            return (
              <button key={f.id} onClick={function(){setTab(f.id);}}
                style={{fontFamily:"monospace",fontSize:".6rem",letterSpacing:1,padding:"6px 12px",
                  background:active?"rgba(201,168,76,.1)":"transparent",
                  border:"1px solid "+(active?BRD:"transparent"),
                  color:active?GL:"rgba(255,255,255,.35)",cursor:"pointer",borderRadius:6,
                  display:"flex",alignItems:"center",gap:5}}>
                <span>{f.emoji}</span><span>{f.label}</span>
              </button>
            );
          })}
        </div>

        {/* File info bar */}
        {file && (
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:BGC,padding:"8px 18px",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
            <div>
              <span style={{fontFamily:"monospace",fontSize:".65rem",color:GL}}>{file.filename}</span>
              <span style={{fontFamily:"monospace",fontSize:".58rem",color:"rgba(255,255,255,.25)",marginLeft:10}}>
                → <strong style={{color:"rgba(255,255,255,.4)"}}>omnihub-bingo/{file.filename}</strong>
              </span>
            </div>
            <button onClick={function(){copy(file.code, file.id);}}
              style={{fontFamily:"monospace",fontSize:".6rem",letterSpacing:1.5,padding:"5px 14px",
                background:copied===file.id?"rgba(76,175,130,.12)":"rgba(201,168,76,.08)",
                border:"1px solid "+(copied===file.id?"rgba(76,175,130,.4)":BRD),
                color:copied===file.id?GRN:G,cursor:"pointer",borderRadius:6}}>
              {copied===file.id?"✓ COPIED!":"COPY ALL"}
            </button>
          </div>
        )}

        {/* Code */}
        {file && (
          <pre style={{fontFamily:"'Courier New',monospace",fontSize:".67rem",color:"rgba(201,168,76,.82)",
            background:"rgba(0,0,0,.75)",margin:0,padding:"18px 20px",
            overflow:"auto",lineHeight:1.75,minHeight:"55vh",whiteSpace:"pre",
            borderBottom:"1px solid rgba(255,255,255,.05)"}}>
            {file.code}
          </pre>
        )}

        {/* Footer upload order */}
        <div style={{padding:"14px 18px 40px",background:BGC,borderTop:"1px solid rgba(255,255,255,.04)"}}>
          <div style={{fontFamily:"monospace",fontSize:".55rem",letterSpacing:3,color:G,marginBottom:10}}>// GitHub upload ቅደም ተከተል</div>
          {[
            ["1","server.js","Root — COPY ➜ GitHub ➜ Add file ➜ Create new file ➜ ስም: server.js"],
            ["2","package.json","Root — COPY ➜ Create new file ➜ ስም: package.json"],
            ["3","public/index.html","COPY ➜ Create new file ➜ ስም: public/index.html  (/ ፎልደሩን ይፈጥራል)"],
            ["4","public/style.css","COPY ➜ Create new file ➜ ስም: public/style.css"],
            ["5","public/app.js","COPY ➜ Create new file ➜ ስም: public/app.js"],
          ].map(function(r){
            return (
              <div key={r[0]} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,.04)",alignItems:"flex-start"}}>
                <div style={{flexShrink:0,width:22,height:22,borderRadius:7,background:"rgba(201,168,76,.1)",border:"1px solid "+BRD,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"monospace",fontSize:".6rem",color:G}}>{r[0]}</div>
                <div>
                  <div style={{fontFamily:"monospace",fontSize:".7rem",color:GL,marginBottom:2}}>{r[1]}</div>
                  <div style={{fontSize:".72rem",color:"rgba(255,255,255,.35)",lineHeight:1.5}}>{r[2]}</div>
                </div>
              </div>
            );
          })}
        </div>
      </>)}

      {/* ── TAB: RENDER ────────────────────────────────── */}
      {mainTab==="render" && (
        <div style={{padding:"16px 18px 48px"}}>

          <div style={{fontFamily:"monospace",fontSize:".55rem",letterSpacing:3,color:G,marginBottom:12}}>// Render Web Service — ትክክለኛ Settings</div>

          {/* Settings table */}
          <div style={{marginBottom:20}}>
            {RENDER_SETTINGS.map(function(s,i){
              return (
                <div key={i} style={{display:"grid",gridTemplateColumns:"130px 1fr",gap:12,padding:"12px 0",borderBottom:"1px solid rgba(255,255,255,.05)",alignItems:"start"}}>
                  <div style={{fontFamily:"monospace",fontSize:".65rem",color:"rgba(255,255,255,.3)",paddingTop:2}}>{s.field}</div>
                  <div>
                    <div style={{fontFamily:"monospace",fontSize:".78rem",color:GL,background:"rgba(201,168,76,.08)",border:"1px solid "+BRD,borderRadius:6,padding:"5px 10px",marginBottom:5,display:"inline-block"}}>{s.value}</div>
                    <div style={{fontSize:".7rem",color:"rgba(255,255,255,.3)",lineHeight:1.5}}>{s.note}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Env variable */}
          <div style={{background:"rgba(91,155,213,.07)",border:"1px solid rgba(91,155,213,.2)",borderRadius:10,padding:"14px 16px",marginBottom:20}}>
            <div style={{fontFamily:"monospace",fontSize:".6rem",letterSpacing:2,color:BLU,marginBottom:10}}>ENVIRONMENT VARIABLE</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div>
                <div style={{fontFamily:"monospace",fontSize:".58rem",color:"rgba(255,255,255,.3)",marginBottom:4}}>KEY</div>
                <div style={{fontFamily:"monospace",fontSize:".75rem",color:GL,background:"rgba(0,0,0,.4)",padding:"6px 10px",borderRadius:6}}>TELEGRAM_BOT_TOKEN</div>
              </div>
              <div>
                <div style={{fontFamily:"monospace",fontSize:".58rem",color:"rgba(255,255,255,.3)",marginBottom:4}}>VALUE</div>
                <div style={{fontFamily:"monospace",fontSize:".72rem",color:"rgba(255,255,255,.4)",background:"rgba(0,0,0,.4)",padding:"6px 10px",borderRadius:6,wordBreak:"break-all"}}>ከ @BotFather የተቀበልከውን ቶከን ለጥፍ</div>
              </div>
            </div>
            <div style={{marginTop:10,fontSize:".7rem",color:"rgba(255,255,255,.3)",lineHeight:1.6}}>
              💡 ቶከን ምሳሌ ቅርጽ: <span style={{color:"rgba(255,255,255,.5)",fontFamily:"monospace"}}>7123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw</span>
            </div>
          </div>

          {/* Build logs guide */}
          <div style={{fontFamily:"monospace",fontSize:".55rem",letterSpacing:3,color:G,marginBottom:10}}>// Build Logs — ምን ትጠብቃለህ?</div>
          {BUILD_LOGS.map(function(l,i){
            return (
              <div key={i} style={{display:"flex",gap:10,padding:"8px 10px",marginBottom:4,borderRadius:8,
                background:l.ok?"rgba(76,175,130,.05)":"rgba(213,111,111,.05)",
                border:"1px solid "+(l.ok?"rgba(76,175,130,.12)":"rgba(213,111,111,.15)")}}>
                <span style={{flexShrink:0,fontSize:".75rem"}}>{l.ok?"✅":"❌"}</span>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"monospace",fontSize:".64rem",color:l.ok?"rgba(76,175,130,.8)":"rgba(213,111,111,.8)",marginBottom:2}}>{l.log}</div>
                  <div style={{fontSize:".68rem",color:"rgba(255,255,255,.3)"}}>{l.note}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── TAB: VERIFY (Live ማረጋገጫ) ─────────────────── */}
      {mainTab==="verify" && (
        <div style={{padding:"16px 18px 48px"}}>
          <div style={{fontFamily:"monospace",fontSize:".55rem",letterSpacing:3,color:G,marginBottom:14}}>// Deploy ከጨረስክ በኋላ — ሁሉ ትክክል መሆኑን ለማረጋገጥ</div>

          {[
            {
              n:"1", emoji:"🌐", title:"Browser ውስጥ URL ክፈት",
              steps:[
                "Render dashboard → ገጹ አናት ላይ ያለውን link ጠቅ አድርግ",
                "https://omnihub-bingo.onrender.com (ወይም ያገኘኸው URL)",
                "OmniHub dashboard — dark gold theme — ይታያሃል",
                "Balance ➜ 1000 coins, ስም ➜ Guest ካሳየ ✅ server ይሰራል",
              ],
              ok:"OmniHub dashboard ሲታይ", fail:"Blank page ወይም error ➜ Render Logs tab ክፈት"
            },
            {
              n:"2", emoji:"🔌", title:"/health endpoint ፈትሸው",
              steps:[
                "URL-ህ ጋር /health ጨምር",
                "ለምሳሌ: https://omnihub-bingo.onrender.com/health",
                "Browser ይህን JSON ያሳይሃል:",
                '{"status":"ok","time":"2025-..."}',
              ],
              ok:'{"status":"ok"} ሲታይ', fail:"Cannot GET /health ➜ server.js upload ተመልከት"
            },
            {
              n:"3", emoji:"✈️", title:"Telegram Bot ውስጥ ፈትሸው",
              steps:[
                "@BotFather → /mybots → ቦትህ → Bot Settings → Menu Button → Configure",
                "URL: https://omnihub-bingo.onrender.com ለጥፍ → Save",
                "ቦትህን ክፈት → ታቹ menu button ጠቅ አድርግ",
                "OmniHub dashboard ቴሌግራም ውስጥ ይከፈታል",
              ],
              ok:"Dashboard ቴሌግራም ውስጥ ሲከፈት", fail:"WebApp failed to load ➜ URL https:// ሆኖ መሆኑን ተመልከት"
            },
            {
              n:"4", emoji:"🎱", title:"Bingo Game ሙሉ Flow ፈትሸው",
              steps:[
                "Dashboard → 5×5 Bingo ጠቅ አድርግ",
                "Join Round — 50 coins ጠቅ አድርግ → Balance 950 ይሆናል",
                "Countdown ➜ Card ይሰጥሃል",
                "ቁጥሮች ሲጠሩ cells ጠቅ አድርግ → haptic feedback ይሰማሃል",
                "Marked cells ወርቃማ ሲሆኑ ✅ ሁሉ ትክክል ነው",
              ],
              ok:"Cells ሲጠሩ haptic + gold color", fail:"Cells አይጠሩም ➜ Socket.IO connection ችግር አለ"
            },
          ].map(function(step){
            return (
              <div key={step.n} style={{background:BGC,border:"1px solid rgba(255,255,255,.06)",borderRadius:12,padding:"16px",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                  <div style={{width:28,height:28,borderRadius:8,background:"rgba(201,168,76,.1)",border:"1px solid "+BRD,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"monospace",fontSize:".7rem",color:G,flexShrink:0}}>{step.n}</div>
                  <div style={{fontSize:".85rem",fontWeight:700,color:"rgba(255,255,255,.8)"}}>{step.emoji} {step.title}</div>
                </div>
                {step.steps.map(function(s,i){
                  const isCode = s.startsWith("{") || s.startsWith("https://");
                  return (
                    <div key={i} style={{display:"flex",gap:8,marginBottom:6,alignItems:"flex-start"}}>
                      <span style={{color:G,fontSize:".4rem",marginTop:6,flexShrink:0}}>◆</span>
                      <span style={{fontSize:isCode?".68rem":".76rem",color:isCode?"rgba(76,175,130,.8)":"rgba(255,255,255,.5)",fontFamily:isCode?"monospace":"inherit",lineHeight:1.6,background:isCode?"rgba(0,0,0,.3)":undefined,padding:isCode?"2px 6px":undefined,borderRadius:isCode?4:undefined}}>{s}</span>
                    </div>
                  );
                })}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12}}>
                  <div style={{background:"rgba(76,175,130,.07)",border:"1px solid rgba(76,175,130,.2)",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontFamily:"monospace",fontSize:".5rem",color:GRN,marginBottom:3}}>✅ ትክክል ከሆነ</div>
                    <div style={{fontSize:".7rem",color:"rgba(255,255,255,.45)"}}>{step.ok}</div>
                  </div>
                  <div style={{background:"rgba(213,111,111,.07)",border:"1px solid rgba(213,111,111,.2)",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontFamily:"monospace",fontSize:".5rem",color:RED,marginBottom:3}}>❌ ችግር ካለ</div>
                    <div style={{fontSize:".7rem",color:"rgba(255,255,255,.45)"}}>{step.fail}</div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Final success card */}
          <div style={{background:"rgba(76,175,130,.07)",border:"1px solid rgba(76,175,130,.25)",borderRadius:14,padding:"20px",textAlign:"center",marginTop:8}}>
            <div style={{fontSize:"2rem",marginBottom:8}}>🎉</div>
            <div style={{fontFamily:"monospace",fontWeight:900,fontSize:"1rem",color:GRN,marginBottom:6}}>ሁሉ አለፈ? OmniHub LIVE ነው!</div>
            <div style={{fontSize:".78rem",color:"rgba(255,255,255,.4)",lineHeight:1.8}}>
              URL-ህን ለጓደኞችህ ላክ ➜ ቴሌግራም ውስጥ ይጫወቱ<br/>
              ቀጣዩ ደረጃ → UptimeRobot (ነፃ anti-sleep) + Persistent DB
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
