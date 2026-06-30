'use strict';

/**
 * OmniHub Super App — public/app.js (COMPLETE VERSION)
 * Dashboard · 5x5 Bingo (full board + live timer) · Slot · Keno · High/Low · How It Works
 * Navigation is bound BEFORE socket setup so the UI always responds,
 * even if the socket connection is briefly unavailable.
 */

var BACKEND_URL  = window.location.origin;
var COIN_TO_ETB  = 0.10; // 1 coin = 0.10 ETB

// ── Telegram WebApp SDK ───────────────────────────────────────
var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
var telegramUser = { id: 'guest-' + Math.floor(Math.random() * 999999), first_name: 'Guest' };
var initDataRaw  = '';

if (tg) {
  tg.ready();
  tg.expand();
  tg.enableClosingConfirmation();
  if (tg.initDataUnsafe && tg.initDataUnsafe.user) telegramUser = tg.initDataUnsafe.user;
  initDataRaw = tg.initData || '';
}

function haptic(s)  { try { if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred(s || 'light'); } catch(e) {} }
function hapticN(t) { try { if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(t || 'success'); } catch(e) {} }

function el(id) { return document.getElementById(id); }

// ── DOM refs — Dashboard ──────────────────────────────────────
var balanceAmountEl = el('balance-amount');
var balanceEtbEl    = el('balance-etb');
var userNameEl      = el('user-name');
var hWinsEl          = el('h-wins');
var hGamesEl         = el('h-games');

// ── DOM refs — Bingo ──────────────────────────────────────────
var backBingoBtn    = el('back-bingo');
var balanceBingoEl  = el('balance-bingo');
var bingoStatusEl   = el('bingo-status');
var hashBarEl        = el('bingo-hash');
var hashValEl        = el('hash-val');
var timerWrapEl      = el('timer-wrap');
var timerLabelEl     = timerWrapEl ? timerWrapEl.querySelector('.timer-label') : null;
var timerBarEl       = el('timer-bar');
var calledStripEl   = el('called-strip');
var numberBoardEl   = el('number-board');
var bingoGridEl     = el('bingo-grid');
var joinBtn          = el('join-btn');
var bingoBtn         = el('bingo-btn');

// ── DOM refs — Slot ───────────────────────────────────────────
var backSlotBtn     = el('back-slot');
var balanceSlotEl   = el('balance-slot');
var slotMsgEl        = el('slot-msg');
var spinBtn          = el('spin-btn');

// ── DOM refs — Keno ───────────────────────────────────────────
var backKenoBtn     = el('back-keno');
var balanceKenoEl   = el('balance-keno');
var kenoStatusEl    = el('keno-status');
var kenoCountEl      = el('keno-count');
var kenoGridEl       = el('keno-grid');
var kenoClearBtn     = el('keno-clear');
var kenoPlayBtn      = el('keno-play');

// ── DOM refs — Card (High/Low) ────────────────────────────────
var backCardBtn     = el('back-card');
var balanceCardEl   = el('balance-card');
var cardStatusEl    = el('card-status');
var cardValEl         = el('card-val');
var nextCardEl       = el('next-card');
var nextValEl         = el('next-val');
var cardPlaceholderEl= el('card-placeholder');
var cardResultMsgEl  = el('card-result-msg');
var cardBtnsEl       = el('card-btns');
var btnLow            = el('btn-low');
var btnHigh           = el('btn-high');
var btnDeal           = el('btn-deal');

// ── DOM refs — nav / howto ─────────────────────────────────────
var openBingoBtn  = el('open-bingo');
var openSlotBtn   = el('open-slot');
var openKenoBtn   = el('open-keno');
var openCardBtn   = el('open-card');
var openHowtoBtn  = el('open-howto');
var backHowtoBtn  = el('back-howto');

// ── State ─────────────────────────────────────────────────────
var currentCard      = null;   // bingo card
var calledNumbers    = [];
var roomStatus        = 'WAITING';
var myUserId           = String(telegramUser.id);
var callIntervalMsG    = 4000;
var clientTimerInterval= null;
var kenoSelected       = [];
var cardCurrent        = null; // high/low current value

// ── Generic helpers ───────────────────────────────────────────
function setStatusEl(node, text, type) {
  if (!node) return;
  node.textContent = text;
  node.className   = 'status-banner';
  if (type) node.classList.add(type);
}

function setBalance(n) {
  var num = Number(n) || 0;
  var v   = num.toLocaleString();
  if (balanceAmountEl) balanceAmountEl.textContent = v;
  if (balanceBingoEl)  balanceBingoEl.textContent  = v;
  if (balanceSlotEl)   balanceSlotEl.textContent   = v;
  if (balanceKenoEl)   balanceKenoEl.textContent   = v;
  if (balanceCardEl)   balanceCardEl.textContent   = v;
  if (balanceEtbEl)    balanceEtbEl.textContent    = (num * COIN_TO_ETB).toFixed(1) + ' ETB';
}

var VIEWS = ['dashboard', 'bingo', 'slot', 'keno', 'card', 'howto'];
function showView(name) {
  for (var i = 0; i < VIEWS.length; i++) {
    var node = el('view-' + VIEWS[i]);
    if (node) node.classList.toggle('active', VIEWS[i] === name);
  }
}

function refreshProfile() {
  if (socket) { try { socket.emit('get_profile'); } catch(e) {} }
}

// ═══════════════════════════════════════════════════════════
// NAVIGATION — bound first, works even if socket fails
// ═══════════════════════════════════════════════════════════

if (openBingoBtn) openBingoBtn.addEventListener('click', function() { haptic('light'); showView('bingo'); });
if (openSlotBtn)  openSlotBtn.addEventListener('click',  function() { haptic('light'); showView('slot');  });
if (openKenoBtn)  openKenoBtn.addEventListener('click',  function() { haptic('light'); showView('keno');  });
if (openHowtoBtn) openHowtoBtn.addEventListener('click', function() { haptic('light'); showView('howto'); });
if (openCardBtn)  openCardBtn.addEventListener('click',  function() {
  haptic('light');
  showView('card');
  if (cardCurrent === null) dealNewCard();
});

if (backBingoBtn) backBingoBtn.addEventListener('click', function() {
  haptic('light');
  if (socket) { try { socket.emit('leave_room'); } catch(e) {} }
  showView('dashboard');
  resetBingoView();
});
if (backSlotBtn)  backSlotBtn.addEventListener('click',  function() { haptic('light'); showView('dashboard'); });
if (backKenoBtn)  backKenoBtn.addEventListener('click',  function() { haptic('light'); showView('dashboard'); });
if (backCardBtn)  backCardBtn.addEventListener('click',  function() { haptic('light'); showView('dashboard'); });
if (backHowtoBtn) backHowtoBtn.addEventListener('click', function() { haptic('light'); showView('dashboard'); });

// ═══════════════════════════════════════════════════════════
// BINGO — timer, full board, called strip, card rendering
// ═══════════════════════════════════════════════════════════

function clearClientTimer() {
  if (clientTimerInterval) { clearInterval(clientTimerInterval); clientTimerInterval = null; }
}

function hideTimerBar() {
  clearClientTimer();
  if (timerWrapEl) timerWrapEl.classList.add('hidden');
}

function startClientCallTimer(durationMs) {
  if (!timerWrapEl) return;
  clearClientTimer();
  timerWrapEl.classList.remove('hidden');
  var endAt = Date.now() + durationMs;

  function tick() {
    var remainMs  = Math.max(0, endAt - Date.now());
    var remainSec = Math.ceil(remainMs / 1000);
    var pct       = Math.max(0, (remainMs / durationMs) * 100);
    if (timerLabelEl) timerLabelEl.innerHTML = 'Next number in <strong>' + remainSec + 's</strong>';
    if (timerBarEl)   timerBarEl.style.width = pct + '%';
    if (remainMs <= 0) clearClientTimer();
  }
  tick();
  clientTimerInterval = setInterval(tick, 200);
}

function showServerCountdown(secondsLeft) {
  if (!timerWrapEl) return;
  timerWrapEl.classList.remove('hidden');
  if (timerLabelEl) timerLabelEl.innerHTML = 'Round starts in <strong>' + secondsLeft + 's</strong>';
  if (timerBarEl)   timerBarEl.style.width = '100%';
}

function showHash(hash) {
  if (!hashBarEl || !hashValEl) return;
  if (hash) {
    hashValEl.textContent = hash.slice(0, 24) + '...';
    hashBarEl.classList.remove('hidden');
  } else {
    hashBarEl.classList.add('hidden');
  }
}

function buildNumberBoard() {
  if (!numberBoardEl) return;
  numberBoardEl.innerHTML = '';
  for (var row = 0; row < 15; row++) {
    var nums = [row + 1, 16 + row, 31 + row, 46 + row, 61 + row]; // B I N G O for this row
    for (var k = 0; k < nums.length; k++) {
      var cell = document.createElement('div');
      cell.className   = 'board-num';
      cell.id          = 'board-num-' + nums[k];
      cell.textContent = nums[k];
      numberBoardEl.appendChild(cell);
    }
  }
}

function markCalledOnBoard(arr) {
  if (!numberBoardEl) return;
  var all = numberBoardEl.querySelectorAll('.board-num');
  for (var i = 0; i < all.length; i++) all[i].classList.remove('called', 'recent');
  for (var j = 0; j < arr.length; j++) {
    var c = el('board-num-' + arr[j]);
    if (c) c.classList.add('called');
  }
  if (arr.length > 0) {
    var last = el('board-num-' + arr[arr.length - 1]);
    if (last) last.classList.add('recent');
  }
}

function renderCalledStrip() {
  if (!calledStripEl) return;
  calledStripEl.innerHTML = '';
  var recent = calledNumbers.slice(-12);
  for (var i = 0; i < recent.length; i++) {
    var chip = document.createElement('div');
    chip.className   = 'called-chip' + (i === recent.length - 1 ? ' recent' : '');
    chip.textContent = recent[i];
    calledStripEl.appendChild(chip);
  }
  if (calledStripEl.lastChild) {
    try { calledStripEl.lastChild.scrollIntoView({ behavior: 'smooth', inline: 'end' }); } catch(e) {}
  }
}

function renderBingoCard() {
  if (!bingoGridEl || !currentCard) return;
  bingoGridEl.innerHTML = '';
  var cols = ['B', 'I', 'N', 'G', 'O'];
  for (var row = 0; row < 5; row++) {
    for (var ci = 0; ci < cols.length; ci++) {
      var col   = cols[ci];
      var value = currentCard[col][row];
      var cell  = document.createElement('div');
      cell.className   = 'bc';
      cell.textContent = value;
      if (value === 'FREE') {
        cell.classList.add('free', 'marked');
      } else {
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
    setStatusEl(bingoStatusEl, '❌ Number ' + value + ' not called yet!', 'warning');
    setTimeout(function() { setStatusEl(bingoStatusEl, '🎯 Round live! Mark called numbers.', 'live'); }, 1400);
    return;
  }
  if (cellEl.classList.contains('marked')) return;
  cellEl.classList.add('marked');
  haptic('light');
  if (socket) { try { socket.emit('mark_cell', { col: col, value: value }); } catch(e) {} }
}

function resetBingoSkeleton() {
  if (!bingoGridEl) return;
  bingoGridEl.innerHTML = '';
  for (var s = 0; s < 25; s++) {
    var sk = document.createElement('div');
    sk.className = (s === 12) ? 'bc free marked' : 'bc opacity15';
    sk.textContent = (s === 12) ? 'FREE' : '?';
    bingoGridEl.appendChild(sk);
  }
}

function resetBingoView() {
  currentCard   = null;
  calledNumbers = [];
  resetBingoSkeleton();
  if (calledStripEl) calledStripEl.innerHTML = '';
  if (joinBtn)  joinBtn.classList.remove('hidden');
  if (bingoBtn) bingoBtn.classList.add('hidden');
  showHash(null);
  hideTimerBar();
  markCalledOnBoard([]);
  setStatusEl(bingoStatusEl, 'Tap Join to enter the next round');
}

if (joinBtn) joinBtn.addEventListener('click', function() {
  haptic('medium');
  if (socket) { try { socket.emit('join_room', { roomId: 'main' }); } catch(e) {} }
  else setStatusEl(bingoStatusEl, 'Connecting... try again shortly.', 'warning');
});

if (bingoBtn) bingoBtn.addEventListener('click', function() {
  haptic('heavy');
  if (socket) { try { socket.emit('claim_bingo'); } catch(e) {} }
});

// ═══════════════════════════════════════════════════════════
// SLOT GAME
// ═══════════════════════════════════════════════════════════

var SLOT_SYMS = ['🍋','🍊','🍇','🔔','💎','7️⃣','🍀'];
var slotSpinning = false;

function animateReels(finalReels, winAmount) {
  var ticks = 0, maxTicks = 12;
  var rInterval = setInterval(function() {
    ticks++;
    for (var i = 0; i < 3; i++) {
      var symEl = el('sym-' + i);
      if (symEl) symEl.textContent = SLOT_SYMS[Math.floor(Math.random() * SLOT_SYMS.length)];
    }
    if (ticks >= maxTicks) {
      clearInterval(rInterval);
      for (var j = 0; j < 3; j++) {
        var symEl2 = el('sym-' + j);
        if (symEl2) symEl2.textContent = finalReels[j];
      }
      slotSpinning = false;
      if (spinBtn) spinBtn.disabled = false;
      if (slotMsgEl) {
        if (winAmount > 0) { slotMsgEl.textContent = '🎉 You won ' + winAmount + ' coins!'; hapticN('success'); }
        else                { slotMsgEl.textContent = 'No match — spin again!'; }
      }
    }
  }, 70);
}

if (spinBtn) spinBtn.addEventListener('click', function() {
  if (slotSpinning) return;
  haptic('medium');
  slotSpinning = true;
  spinBtn.disabled = true;
  if (slotMsgEl) slotMsgEl.textContent = 'Spinning...';
  if (socket) { try { socket.emit('slot_spin', { wager: 30 }); } catch(e) { slotSpinning = false; spinBtn.disabled = false; } }
  else { slotSpinning = false; spinBtn.disabled = false; if (slotMsgEl) slotMsgEl.textContent = 'Connecting...'; }
});

// ═══════════════════════════════════════════════════════════
// KENO GAME
// ═══════════════════════════════════════════════════════════

function buildKenoGrid() {
  if (!kenoGridEl) return;
  kenoGridEl.innerHTML = '';
  for (var n = 1; n <= 80; n++) {
    var cell = document.createElement('div');
    cell.className   = 'keno-num';
    cell.textContent = n;
    cell.dataset.num = n;
    cell.addEventListener('click', function() {
      toggleKenoNum(parseInt(this.dataset.num, 10), this);
    });
    kenoGridEl.appendChild(cell);
  }
}

function updateKenoCount() { if (kenoCountEl) kenoCountEl.textContent = kenoSelected.length; }

function toggleKenoNum(num, cellEl) {
  var idx = kenoSelected.indexOf(num);
  if (idx >= 0) {
    kenoSelected.splice(idx, 1);
    cellEl.classList.remove('selected');
  } else {
    if (kenoSelected.length >= 10) { haptic('rigid'); return; }
    kenoSelected.push(num);
    cellEl.classList.add('selected');
  }
  haptic('light');
  updateKenoCount();
}

if (kenoClearBtn) kenoClearBtn.addEventListener('click', function() {
  haptic('light');
  kenoSelected = [];
  if (kenoGridEl) {
    var cells = kenoGridEl.querySelectorAll('.keno-num');
    for (var i = 0; i < cells.length; i++) cells[i].classList.remove('selected', 'hit', 'miss');
  }
  updateKenoCount();
  setStatusEl(kenoStatusEl, 'Pick 1–10 numbers then Play');
});

if (kenoPlayBtn) kenoPlayBtn.addEventListener('click', function() {
  if (kenoSelected.length < 1) {
    setStatusEl(kenoStatusEl, 'Pick at least 1 number!', 'warning');
    haptic('rigid');
    return;
  }
  haptic('medium');
  if (socket) { try { socket.emit('keno_play', { picks: kenoSelected }); } catch(e) {} }
});

// ═══════════════════════════════════════════════════════════
// HIGH / LOW CARD GAME
// ═══════════════════════════════════════════════════════════

function cardLabel(n) {
  if (n === 1)  return 'A';
  if (n === 11) return 'J';
  if (n === 12) return 'Q';
  if (n === 13) return 'K';
  return String(n);
}

function dealNewCard() {
  if (socket) { try { socket.emit('card_new_round'); } catch(e) {} }
}

if (btnDeal) btnDeal.addEventListener('click', function() { haptic('light'); dealNewCard(); });
if (btnHigh) btnHigh.addEventListener('click', function() { guessCard('high'); });
if (btnLow)  btnLow.addEventListener('click',  function() { guessCard('low');  });

function guessCard(guess) {
  if (cardCurrent === null) return;
  haptic('medium');
  if (socket) { try { socket.emit('card_guess', { guess: guess, currentCard: cardCurrent }); } catch(e) {} }
}

// ═══════════════════════════════════════════════════════════
// SOCKET.IO
// ═══════════════════════════════════════════════════════════

var socket = null;

try {
  socket = io(BACKEND_URL, {
    transports: ['websocket', 'polling'],
    auth: { initData: initDataRaw, telegramId: telegramUser.id, name: telegramUser.first_name },
    reconnection: true,
    reconnectionDelay: 1000,
    timeout: 10000,
  });

  socket.on('connect', function() { console.log('[OmniHub] Connected:', socket.id); });

  socket.on('connect_error', function(err) {
    console.warn('[OmniHub] Connection error:', err.message);
    setStatusEl(bingoStatusEl, 'Connecting to server...', 'warning');
  });

  socket.on('profile', function(data) {
    myUserId = String(data.id);
    setBalance(data.balance);
    if (userNameEl) userNameEl.textContent = ', ' + (data.name || 'Player');
    if (hWinsEl)  hWinsEl.textContent  = data.wins  || 0;
    if (hGamesEl) hGamesEl.textContent = data.games || 0;
  });

  socket.on('auth_error', function(data) { console.warn('[OmniHub] Auth error:', data.message); });

  // ── Bingo events ──────────────────────────────────────────
  socket.on('joined_room', function(data) {
    setBalance(data.balance);
    if (joinBtn) joinBtn.classList.add('hidden');
    setStatusEl(bingoStatusEl, '✅ Joined! Waiting for round to start...');
    refreshProfile();
  });

  socket.on('room_state', function(data) {
    roomStatus     = data.status;
    calledNumbers  = data.calledNumbers || [];
    if (data.callIntervalMs) callIntervalMsG = data.callIntervalMs;
    renderCalledStrip();
    markCalledOnBoard(calledNumbers);
    if (data.status === 'WAITING') {
      setStatusEl(bingoStatusEl, '⏳ Waiting for players — Pot: ' + data.pot + ' coins');
      if (joinBtn)  joinBtn.classList.remove('hidden');
      if (bingoBtn) bingoBtn.classList.add('hidden');
      hideTimerBar();
    }
  });

  socket.on('countdown', function(data) {
    showHash(data.serverSeedHash);
    showServerCountdown(data.secondsLeft);
    setStatusEl(bingoStatusEl, '🔐 Fairness committed — get ready!', 'live');
  });

  socket.on('card_assigned', function(data) {
    currentCard = data.card;
    renderBingoCard();
  });

  socket.on('game_started', function(data) {
    setStatusEl(bingoStatusEl, '🎯 Round live! Tap called numbers on your card.', 'live');
    if (bingoBtn) bingoBtn.classList.remove('hidden');
    if (joinBtn)  joinBtn.classList.add('hidden');
    if (data && data.serverSeedHash) showHash(data.serverSeedHash);
    if (data && data.callIntervalMs) callIntervalMsG = data.callIntervalMs;
    calledNumbers = [];
    markCalledOnBoard([]);
    startClientCallTimer(callIntervalMsG);
  });

  socket.on('number_called', function(data) {
    calledNumbers = data.calledNumbers;
    renderCalledStrip();
    markCalledOnBoard(calledNumbers);
    haptic('light');
    setStatusEl(bingoStatusEl, '📢 Called: ' + data.letter + '-' + data.number + '  (Total: ' + calledNumbers.length + ')', 'live');
    startClientCallTimer(callIntervalMsG);
  });

  socket.on('cell_marked', function() { /* server confirmation — UI already updated */ });

  socket.on('game_over', function(data) {
    if (bingoBtn) bingoBtn.classList.add('hidden');
    hideTimerBar();
    if (data.serverSeed && hashValEl) hashValEl.textContent = 'Revealed: ' + data.serverSeed.slice(0, 24) + '...';
    if (data.winnerId && String(data.winnerId) === myUserId) {
      setStatusEl(bingoStatusEl, '🏆 YOU WON ' + data.payout + ' coins! Congratulations!', 'live');
      hapticN('success');
    } else if (data.winnerId) {
      setStatusEl(bingoStatusEl, 'Round over — another player won this round.');
      hapticN('warning');
    } else {
      setStatusEl(bingoStatusEl, 'Round over — no winner. Try again!');
    }
    refreshProfile();
    setTimeout(function() { resetBingoView(); }, 5000);
  });

  socket.on('error_msg', function(data) {
    setStatusEl(bingoStatusEl, data.message || 'Error.', 'warning');
    hapticN('error');
  });

  // ── Slot events ───────────────────────────────────────────
  socket.on('slot_result', function(data) {
    setBalance(data.balance);
    animateReels(data.reels, data.winAmount);
    refreshProfile();
  });

  // ── Keno events ───────────────────────────────────────────
  socket.on('keno_result', function(data) {
    if (kenoGridEl) {
      var cells = kenoGridEl.querySelectorAll('.keno-num');
      for (var i = 0; i < cells.length; i++) {
        var n = parseInt(cells[i].dataset.num, 10);
        cells[i].classList.remove('hit', 'miss');
        if (data.drawn.includes(n)) {
          if (data.picks.includes(n)) cells[i].classList.add('hit');
          else cells[i].classList.add('miss');
        }
      }
    }
    setBalance(data.balance);
    if (data.winAmount > 0) {
      setStatusEl(kenoStatusEl, '🎉 ' + data.matches + ' matches! Won ' + data.winAmount + ' coins (×' + data.multiplier + ')', 'live');
      hapticN('success');
    } else {
      setStatusEl(kenoStatusEl, data.matches + ' matches — no win this time.', 'warning');
      hapticN('warning');
    }
    refreshProfile();
  });

  // ── Card events ───────────────────────────────────────────
  socket.on('card_dealt', function(data) {
    cardCurrent = data.card;
    if (cardValEl) cardValEl.textContent = cardLabel(data.card);
    if (nextCardEl) nextCardEl.classList.add('hidden');
    if (cardPlaceholderEl) cardPlaceholderEl.classList.remove('hidden');
    if (cardResultMsgEl) cardResultMsgEl.textContent = '';
    if (cardBtnsEl) cardBtnsEl.classList.remove('hidden');
    if (btnDeal) btnDeal.classList.add('hidden');
    setBalance(data.balance);
    setStatusEl(cardStatusEl, 'Guess if the next card is Higher or Lower');
  });

  socket.on('card_result', function(data) {
    if (nextValEl) nextValEl.textContent = cardLabel(data.nextCard);
    if (nextCardEl) nextCardEl.classList.remove('hidden');
    if (cardPlaceholderEl) cardPlaceholderEl.classList.add('hidden');
    if (cardBtnsEl) cardBtnsEl.classList.add('hidden');
    if (btnDeal) btnDeal.classList.remove('hidden');
    setBalance(data.balance);
    cardCurrent = null;
    if (cardResultMsgEl) {
      if (data.won) { cardResultMsgEl.textContent = '🎉 Correct! Won ' + data.winAmount + ' coins!'; hapticN('success'); }
      else           { cardResultMsgEl.textContent = '❌ Wrong — lost 20 coins.'; hapticN('error'); }
    }
    refreshProfile();
  });

} catch (socketError) {
  console.error('[OmniHub] Socket init failed:', socketError);
  setStatusEl(bingoStatusEl, 'Connecting...', 'warning');
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════

buildNumberBoard();
buildKenoGrid();
resetBingoSkeleton();
showView('dashboard');
