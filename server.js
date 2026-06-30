'use strict';

const express    = require('express');
const http       = require('http');
const crypto     = require('crypto');
const cors       = require('cors');
const path       = require('path');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  transports: ['websocket','polling'],
});

const PORT               = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const STARTING_BALANCE   = 1000;
const ENTRY_FEE          = 50;
const CALL_INTERVAL_MS   = 4000;
const COUNTDOWN_SECONDS  = 10;
const MIN_PLAYERS        = 1;

const users = new Map();
const rooms = new Map();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req,res) => res.json({ status:'ok', time:new Date().toISOString() }));

// ── Helpers ───────────────────────────────────────────────────
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function randInt()  { return crypto.randomBytes(4).readUInt32BE(0); }
function letterFor(n){ return n<=15?'B':n<=30?'I':n<=45?'N':n<=60?'G':'O'; }

function getOrCreateUser(id, name) {
  const sid = String(id);
  if (!users.has(sid)) users.set(sid, { id:sid, name:name||'Player', balance:STARTING_BALANCE, wins:0, games:0 });
  else if (name) users.get(sid).name = name;
  return users.get(sid);
}

function verifyTelegram(initData, botToken) {
  if (!initData||!botToken) return null;
  const p = new URLSearchParams(initData);
  const h = p.get('hash'); if (!h) return null;
  p.delete('hash');
  const fields=[]; p.forEach((v,k) => fields.push(k+'='+v)); fields.sort();
  const secret = crypto.createHmac('sha256','WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256',secret).update(fields.join('\n')).digest('hex');
  if (computed!==h) return null;
  try { return JSON.parse(p.get('user')||'null'); } catch(e){ return null; }
}

// ── Provably Fair Bingo RNG ───────────────────────────────────
function generateCard(seed) {
  const ranges={B:[1,15],I:[16,30],N:[31,45],G:[46,60],O:[61,75]};
  const card={};
  for (const col of ['B','I','N','G','O']) {
    const pool=[]; for(let n=ranges[col][0];n<=ranges[col][1];n++) pool.push(n);
    for(let i=pool.length-1;i>0;i--){
      const h=crypto.createHmac('sha256',seed).update(col+':'+i+':'+pool.join(',')).digest('hex');
      const j=parseInt(h.slice(0,8),16)%(i+1);
      [pool[i],pool[j]]=[pool[j],pool[i]];
    }
    card[col]=pool.slice(0,5);
  }
  card.N[2]='FREE'; return card;
}

function generateCallSequence(seed) {
  const pool=[]; for(let n=1;n<=75;n++) pool.push(n);
  for(let i=pool.length-1;i>0;i--){
    const h=crypto.createHmac('sha256',seed).update('CALL:'+i+':'+pool.join(',')).digest('hex');
    const j=parseInt(h.slice(0,8),16)%(i+1);
    [pool[i],pool[j]]=[pool[j],pool[i]];
  }
  return pool;
}

function checkWin(card, marked) {
  const cols=['B','I','N','G','O'];
  const m=(c,r)=>{ const v=card[c][r]; return v==='FREE'||marked.has(c+':'+v); };
  if(cols.every(c=>[0,1,2,3,4].every(r=>m(c,r)))) return 'FULL_HOUSE';
  for(let r=0;r<5;r++) if(cols.every(c=>m(c,r))) return 'ROW';
  for(const col of cols) if([0,1,2,3,4].every(r=>m(col,r))) return 'COLUMN';
  if(cols.every((c,i)=>m(c,i))) return 'DIAGONAL';
  if(cols.every((c,i)=>m(c,4-i))) return 'DIAGONAL';
  return null;
}

// ── Bingo Room Lifecycle ──────────────────────────────────────
function createRoom(id) {
  const r={ id, status:'WAITING', players:new Map(), serverSeed:null, serverSeedHash:null,
            callSequence:[], calledNumbers:[], callTimer:null, countdownTimer:null, pot:0 };
  rooms.set(id,r); return r;
}
function getRoom(id) { return rooms.get(id)||createRoom(id); }
function broadcastRoom(room) {
  io.to(room.id).emit('room_state',{
    status:room.status, playerCount:room.players.size, pot:room.pot,
    calledNumbers:room.calledNumbers, callIntervalMs:CALL_INTERVAL_MS
  });
}
function startCountdown(room) {
  if(room.status!=='WAITING') return;
  room.status='COUNTDOWN';
  room.serverSeed=crypto.randomBytes(32).toString('hex');
  room.serverSeedHash=sha256(room.serverSeed);
  let s=COUNTDOWN_SECONDS;
  io.to(room.id).emit('countdown',{secondsLeft:s, serverSeedHash:room.serverSeedHash});
  room.countdownTimer=setInterval(()=>{
    s--;
    if(s<=0){ clearInterval(room.countdownTimer); startGame(room); }
    else io.to(room.id).emit('countdown',{secondsLeft:s, serverSeedHash:room.serverSeedHash});
  },1000);
}
function startGame(room) {
  room.status='IN_PROGRESS';
  room.callSequence=generateCallSequence(room.serverSeed);
  room.calledNumbers=[];
  room.players.forEach((player,sid)=>{
    player.card=generateCard(room.serverSeed+':'+sid);
    player.marked=new Set();
    io.to(sid).emit('card_assigned',{card:player.card});
  });
  broadcastRoom(room);
  io.to(room.id).emit('game_started',{serverSeedHash:room.serverSeedHash, callIntervalMs:CALL_INTERVAL_MS});
  let idx=0;
  room.callTimer=setInterval(()=>{
    if(room.status!=='IN_PROGRESS'){ clearInterval(room.callTimer); return; }
    if(idx>=room.callSequence.length){ clearInterval(room.callTimer); endGame(room,null); return; }
    const num=room.callSequence[idx++];
    room.calledNumbers.push(num);
    io.to(room.id).emit('number_called',{number:num, letter:letterFor(num), calledNumbers:room.calledNumbers});
  },CALL_INTERVAL_MS);
}
function endGame(room, winnerSid) {
  room.status='FINISHED';
  clearInterval(room.callTimer); clearInterval(room.countdownTimer);
  let payout=0, winnerId=null;
  if(winnerSid&&room.players.has(winnerSid)){
    const w=room.players.get(winnerSid);
    payout=room.pot; winnerId=w.userId;
    const u=users.get(w.userId);
    if(u){ u.balance+=payout; u.wins++; }
  }
  io.to(room.id).emit('game_over',{winnerId, payout, serverSeed:room.serverSeed,
    serverSeedHash:room.serverSeedHash, callSequenceUsed:room.calledNumbers});
  setTimeout(()=>{
    room.status='WAITING'; room.serverSeed=null; room.serverSeedHash=null;
    room.callSequence=[]; room.calledNumbers=[]; room.pot=0;
    room.players.forEach(p=>{ p.card=null; p.marked=new Set(); });
    broadcastRoom(room);
  },6000);
}

// ── Slot Helpers ──────────────────────────────────────────────
const SLOT_SYMBOLS  = ['🍋','🍊','🍇','🔔','💎','7️⃣','🍀'];
const SLOT_WEIGHTS  = [30,  25,   18,  12,   8,   4,   3 ];
const SLOT_MULTI_3  = [2,   3,    5,   10,  20,  50,  30 ];
const SLOT_MULTI_2  = [0,   0,    1,    2,   3,   5,   4 ];
function weightedSlot(){
  const total=SLOT_WEIGHTS.reduce((a,b)=>a+b,0);
  let r=randInt()%total, cum=0;
  for(let i=0;i<SLOT_WEIGHTS.length;i++){ cum+=SLOT_WEIGHTS[i]; if(r<cum) return i; }
  return 0;
}

// ── Socket.IO ─────────────────────────────────────────────────
io.on('connection', socket=>{
  const auth=socket.handshake.auth||{};
  let vUser=null;
  if(TELEGRAM_BOT_TOKEN){
    vUser=verifyTelegram(auth.initData,TELEGRAM_BOT_TOKEN);
    if(!vUser){ socket.emit('auth_error',{message:'Telegram auth failed.'}); socket.disconnect(true); return; }
  } else {
    vUser={ id:auth.telegramId||('guest-'+socket.id), first_name:auth.name||'Guest' };
  }
  const user=getOrCreateUser(vUser.id, vUser.first_name);
  let currentRoomId=null;

  const emitProfile=()=>socket.emit('profile',{id:user.id,name:user.name,balance:user.balance,wins:user.wins,games:user.games});
  emitProfile();

  // ── Bingo ─────────────────────────────────────────────────
  socket.on('join_room', payload=>{
    const roomId=(payload&&payload.roomId)||'main';
    const room=getRoom(roomId);
    if(room.status==='IN_PROGRESS'||room.status==='COUNTDOWN'){
      socket.emit('error_msg',{message:'Round in progress. Wait for next.'}); return;
    }
    if(user.balance<ENTRY_FEE){ socket.emit('error_msg',{message:'Need '+ENTRY_FEE+' coins.'}); return; }
    user.balance-=ENTRY_FEE; room.pot+=ENTRY_FEE; user.games++;
    socket.join(roomId); currentRoomId=roomId;
    room.players.set(socket.id,{userId:user.id,name:user.name,card:null,marked:new Set()});
    socket.emit('joined_room',{roomId,balance:user.balance,pot:room.pot});
    broadcastRoom(room);
    if(room.players.size>=MIN_PLAYERS&&room.status==='WAITING') startCountdown(room);
  });

  socket.on('mark_cell', payload=>{
    if(!currentRoomId) return;
    const room=rooms.get(currentRoomId);
    if(!room||room.status!=='IN_PROGRESS') return;
    const player=room.players.get(socket.id);
    if(!player||!player.card) return;
    const {col,value}=payload||{};
    if(value!=='FREE'&&!room.calledNumbers.includes(value)){
      socket.emit('error_msg',{message:'Not called yet.'}); return;
    }
    player.marked.add(col+':'+value);
    socket.emit('cell_marked',{col,value});
  });

  socket.on('claim_bingo', ()=>{
    if(!currentRoomId) return;
    const room=rooms.get(currentRoomId);
    if(!room||room.status!=='IN_PROGRESS') return;
    const player=room.players.get(socket.id);
    if(!player||!player.card) return;
    if(checkWin(player.card,player.marked)) endGame(room,socket.id);
    else socket.emit('error_msg',{message:'No valid pattern yet!'});
  });

  // ── Slot Game ─────────────────────────────────────────────
  socket.on('slot_spin', payload=>{
    const wager=(payload&&payload.wager)||30;
    if(user.balance<wager){ socket.emit('error_msg',{message:'Need '+wager+' coins to spin.'}); return; }
    user.balance-=wager; user.games++;
    const r=[weightedSlot(),weightedSlot(),weightedSlot()];
    let winAmount=0;
    if(r[0]===r[1]&&r[1]===r[2])      winAmount=wager*SLOT_MULTI_3[r[0]];
    else if(r[0]===r[1]||r[1]===r[2]) winAmount=wager*SLOT_MULTI_2[r[1]];
    else if(r[0]===r[2])               winAmount=wager*SLOT_MULTI_2[r[0]];
    user.balance+=winAmount;
    if(winAmount>0) user.wins++;
    socket.emit('slot_result',{
      reels:r.map(i=>SLOT_SYMBOLS[i]), winAmount, balance:user.balance,
      seed:crypto.randomBytes(8).toString('hex')
    });
  });

  // ── Keno Game ────────────────────────────────────────────
  socket.on('keno_play', payload=>{
    const picks=(payload&&payload.picks)||[];
    const wager=50;
    if(picks.length<1||picks.length>10){ socket.emit('error_msg',{message:'Pick 1-10 numbers.'}); return; }
    if(user.balance<wager){ socket.emit('error_msg',{message:'Need '+wager+' coins.'}); return; }
    user.balance-=wager; user.games++;
    const pool=[]; for(let i=1;i<=80;i++) pool.push(i);
    for(let i=pool.length-1;i>0;i--){
      const j=randInt()%(i+1); [pool[i],pool[j]]=[pool[j],pool[i]];
    }
    const drawn=pool.slice(0,20);
    const matches=picks.filter(p=>drawn.includes(p)).length;
    const PAY={
      1:[0,3], 2:[0,0,5], 3:[0,0,2,8], 4:[0,0,0,3,15],
      5:[0,0,0,2,8,30], 6:[0,0,0,0,3,12,60], 7:[0,0,0,0,2,6,25,100],
      8:[0,0,0,0,0,4,15,60,200], 9:[0,0,0,0,0,3,10,40,150,500],
      10:[0,0,0,0,0,2,8,30,100,400,1000]
    };
    const mult=(PAY[picks.length]&&PAY[picks.length][matches])||0;
    const winAmount=wager*mult;
    user.balance+=winAmount;
    if(winAmount>0) user.wins++;
    socket.emit('keno_result',{picks,drawn,matches,winAmount,balance:user.balance,multiplier:mult});
  });

  // ── Card High/Low Game ────────────────────────────────────
  socket.on('card_new_round', ()=>{
    const card=(randInt()%13)+1;
    socket.emit('card_dealt',{card, balance:user.balance});
  });

  socket.on('card_guess', payload=>{
    const wager=20;
    const guess=payload&&payload.guess;
    const currentCard=payload&&payload.currentCard;
    if(!guess||!['high','low'].includes(guess)){ socket.emit('error_msg',{message:'Guess high or low.'}); return; }
    if(user.balance<wager){ socket.emit('error_msg',{message:'Need '+wager+' coins.'}); return; }
    user.balance-=wager; user.games++;
    const nextCard=(randInt()%13)+1;
    let won=false;
    if(guess==='high'&&nextCard>currentCard)  won=true;
    if(guess==='low' &&nextCard<currentCard)  won=true;
    if(nextCard===currentCard) won=false;
    const winAmount=won?wager*2:0;
    user.balance+=winAmount;
    if(won) user.wins++;
    socket.emit('card_result',{currentCard,nextCard,guess,won,winAmount,balance:user.balance});
  });

  // ── General ──────────────────────────────────────────────
  socket.on('get_profile', ()=>emitProfile());

  const handleLeave=()=>{
    if(!currentRoomId) return;
    const room=rooms.get(currentRoomId);
    if(room){ room.players.delete(socket.id); broadcastRoom(room); }
    currentRoomId=null;
  };
  socket.on('leave_room', handleLeave);
  socket.on('disconnect', handleLeave);
});

server.listen(PORT, ()=>{
  console.log('\n  ╔══════════════════════════════════╗');
  console.log('  ║   OmniHub Super App — Running   ║');
  console.log('  ╚══════════════════════════════════╝');
  console.log('  Port  :', PORT);
  console.log('  Auth  :', TELEGRAM_BOT_TOKEN?'Telegram ENABLED':'Dev mode');
  console.log('  Games : Bingo · Slot · Keno · Card\n');
});
