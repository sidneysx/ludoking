/* ================= CONFIG / GEOMETRIA DO TABULEIRO ================= */
const CELL = 40;
const COLORS = ['red','green','yellow','blue'];
const COLOR_HEX = {red:'#ef4444',green:'#22c55e',yellow:'#eab308',blue:'#3b82f6'};
const COLOR_LIGHT = {red:'#fecaca',green:'#bbf7d0',yellow:'#fef08a',blue:'#bfdbfe'};
const COLOR_NAME = {red:'Vermelho',green:'Verde',yellow:'Amarelo',blue:'Azul'};

// caminho principal compartilhado (52 células), sentido horário
const PATH = [
  [6,1],[6,2],[6,3],[6,4],[6,5],
  [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],
  [0,7],
  [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],
  [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
  [7,14],
  [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],
  [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
  [14,7],
  [14,6],[13,6],[12,6],[11,6],[10,6],[9,6],
  [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
  [7,0],
  [6,0]
];
const START_INDEX = {red:0, green:13, yellow:26, blue:39};
const HOME_STRETCH = {
  red:    [[7,1],[7,2],[7,3],[7,4],[7,5]],
  green:  [[1,7],[2,7],[3,7],[4,7],[5,7]],
  yellow: [[7,13],[7,12],[7,11],[7,10],[7,9]],
  blue:   [[13,7],[12,7],[11,7],[10,7],[9,7]]
};
const SAFE_ABS = new Set();
COLORS.forEach(c=>{ SAFE_ABS.add(START_INDEX[c]); SAFE_ABS.add((START_INDEX[c]+8)%52); });

const BASE_RECT = {
  red:[0,0], green:[0,9], yellow:[9,9], blue:[9,0]
};
const BASE_SLOTS = [[1.5,1.5],[1.5,4.5],[4.5,1.5],[4.5,4.5]];
// pontos finais de cada cor dentro do SEU PRÓPRIO triângulo no centro
// (green entra por cima, yellow pela direita, blue por baixo, red pela esquerda)
const CENTER_PX = 7.5*CELL;
const CENTER_SLOTS_BY_COLOR = {
  green:  [[7,-14],[-7,-14],[7,-22],[-7,-22]],
  yellow: [[14,7],[14,-7],[22,7],[22,-7]],
  blue:   [[-7,14],[7,14],[-7,22],[7,22]],
  red:    [[-14,-7],[-14,7],[-22,-7],[-22,7]]
};

/* ================= ESTADO LOCAL ================= */
let roomCode = null;
let myName = '';
let myColor = null;
let lastRenderedAt = 0;
let pollTimer = null;

function genCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s=''; for(let i=0;i<5;i++) s+=chars[Math.floor(Math.random()*chars.length)];
  return s;
}
function defaultState(code){
  return {
    code,
    players:{red:null,green:null,yellow:null,blue:null},
    phase:'lobby', // lobby | playing | finished
    turnColor:null,
    dice:null,
    pawns:{red:[0,0,0,0],green:[0,0,0,0],yellow:[0,0,0,0],blue:[0,0,0,0]},
    winner:null,
    log:[],
    updatedAt:Date.now()
  };
}

/* ================= DADO VISUAL (pips) ================= */
const DICE_PIPS = {
  1:[4], 2:[0,8], 3:[0,4,8], 4:[0,2,6,8], 5:[0,2,4,6,8], 6:[0,2,3,5,6,8]
};
function renderDiceFace(el,value){
  if(!el) return;
  if(!value){
    el.classList.add('empty');
    el.innerHTML='';
    return;
  }
  el.classList.remove('empty');
  const on = DICE_PIPS[value]||[];
  el.innerHTML='';
  for(let idx=0; idx<9; idx++){
    const dot=document.createElement('span');
    dot.className='pip'+(on.includes(idx)?' on':'');
    el.appendChild(dot);
  }
}
function animateDiceRoll(onDone){
  const face = document.getElementById('miniDice-'+myColor);
  const btn = document.getElementById('rollBtn');
  btn.disabled = true;
  if(face) face.classList.add('rolling');
  let ticks=0;
  const iv = setInterval(()=>{
    renderDiceFace(face, 1+Math.floor(Math.random()*6));
    ticks++;
    if(ticks>=8){
      clearInterval(iv);
      if(face) face.classList.remove('rolling');
      onDone();
    }
  }, 80);
}

/* ================= ORIENTAÇÃO DO TABULEIRO POR JOGADOR ================= */
// gira o tabuleiro para que a base do jogador local sempre fique embaixo (canto inferior esquerdo)
const ROTATE_DEG = {blue:0, yellow:90, green:180, red:270};
function applyBoardRotation(){
  const el = document.getElementById('boardRotate');
  if(!el) return;
  const deg = myColor ? ROTATE_DEG[myColor] : 0;
  el.style.transform = 'rotate('+deg+'deg)';
}
function viewOrderColors(){
  if(!myColor) return COLORS.slice();
  const idx = COLORS.indexOf(myColor);
  const order=[];
  for(let i=1;i<=COLORS.length;i++) order.push(COLORS[(idx+i)%COLORS.length]);
  return order; // termina sempre com myColor (fica embaixo na lista)
}

function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>t.classList.remove('show'),2200);
}

/* ================= STORAGE HELPERS (API PHP) ================= */
async function readRoom(code){
  try{
    const res = await fetch(`api/room.php?code=${encodeURIComponent(code)}`);
    if(!res.ok) return null;
    return await res.json();
  }catch(e){ return null; }
}
async function writeRoom(state){
  try{
    const res = await fetch('api/room.php', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(state)
    });
    if(!res.ok) throw new Error('save failed');
    return true;
  }catch(e){ showToast('Erro de conexão, tente de novo'); return false; }
}
async function updateRoom(mutatorFn){
  const state = await readRoom(roomCode);
  if(!state){ showToast('Sala não encontrada'); return; }
  mutatorFn(state);
  state.updatedAt = Date.now();
  const ok = await writeRoom(state);
  if(ok){ lastRenderedAt = state.updatedAt; render(state); }
}

/* ================= LÓGICA DE JOGO ================= */
function colorFinished(state,color){ return state.pawns[color].every(s=>s===57); }
function activeColors(state){ return COLORS.filter(c=>state.players[c] && !colorFinished(state,c)); }
function nextTurnColor(state){
  const active = activeColors(state);
  if(active.length<=1) return active[0]||null;
  const idx = COLORS.indexOf(state.turnColor);
  for(let i=1;i<=COLORS.length;i++){
    const c = COLORS[(idx+i)%COLORS.length];
    if(active.includes(c)) return c;
  }
  return active[0];
}
function validMoves(state,color,dice){
  const moves=[];
  state.pawns[color].forEach((steps,i)=>{
    if(steps===0){ if(dice===6) moves.push(i); }
    else if(steps>0 && steps<57){ if(steps+dice<=57) moves.push(i); }
  });
  return moves;
}
function doMove(state,color,pawnIndex,dice){
  const steps = state.pawns[color][pawnIndex];
  const newSteps = steps===0 ? 1 : steps+dice;
  state.pawns[color][pawnIndex] = newSteps;
  let captured=false;

  if(newSteps>=1 && newSteps<=51){
    const abs = (START_INDEX[color]+newSteps-1)%52;
    if(!SAFE_ABS.has(abs)){
      COLORS.forEach(oc=>{
        if(oc===color) return;
        state.pawns[oc].forEach((os,oi)=>{
          if(os>=1 && os<=51){
            const oabs = (START_INDEX[oc]+os-1)%52;
            if(oabs===abs){ state.pawns[oc][oi]=0; captured=true;
              state.log.unshift(`${COLOR_NAME[color]} capturou um peão ${COLOR_NAME[oc]}!`);
            }
          }
        });
      });
    }
  }
  if(newSteps===57){
    state.log.unshift(`${COLOR_NAME[color]} levou um peão para casa!`);
    if(colorFinished(state,color)){
      state.winner=color; state.phase='finished';
      state.log.unshift(`🏆 ${COLOR_NAME[color]} venceu o jogo!`);
    }
  }
  return captured;
}

/* ================= AÇÕES DO JOGADOR ================= */
document.getElementById('createBtn').onclick = async ()=>{
  const name = document.getElementById('nameInput').value.trim();
  if(!name){ showToast('Digite seu nome'); return; }
  myName = name;
  const code = genCode();
  const state = defaultState(code);
  const ok = await writeRoom(state);
  if(ok){ roomCode = code; enterGameScreen(state); }
};

document.getElementById('joinBtn').onclick = async ()=>{
  const name = document.getElementById('nameInput').value.trim();
  const code = document.getElementById('codeInput').value.trim().toUpperCase();
  if(!name){ showToast('Digite seu nome'); return; }
  if(!code){ showToast('Digite o código da sala'); return; }
  const state = await readRoom(code);
  if(!state){ showToast('Sala não encontrada'); return; }
  myName = name; roomCode = code;
  enterGameScreen(state);
};

document.getElementById('startBtn').onclick = ()=>{
  updateRoom(state=>{
    const filled = COLORS.filter(c=>state.players[c]);
    if(filled.length<2) return;
    state.phase='playing';
    state.turnColor=filled[0];
    state.dice=null;
    state.log.unshift('Jogo iniciado! ' + COLOR_NAME[filled[0]] + ' começa.');
  });
};

function performMove(state,color,pawnIndex){
  const dice = state.dice;
  const captured = doMove(state,color,pawnIndex,dice);
  if(state.phase==='finished') return;
  const extra = dice===6 || captured;
  state.dice = null;
  if(!extra){ state.turnColor = nextTurnColor(state); }
}

document.getElementById('rollBtn').onclick = ()=>{
  if(!myColor) return;
  animateDiceRoll(()=>{
    updateRoom(state=>{
      if(state.phase!=='playing') return;
      if(state.turnColor!==myColor){ showToast('Não é sua vez'); return; }
      if(state.dice!==null) return;
      const d = 1+Math.floor(Math.random()*6);
      state.dice = d;
      state.log.unshift(`${COLOR_NAME[myColor]} tirou ${d}`);
      const vm = validMoves(state,myColor,d);
      if(vm.length===0){
        state.log.unshift('Sem jogada possível — passa a vez');
        state.turnColor = nextTurnColor(state);
        state.dice = null;
      } else if(vm.length===1){
        // única jogada possível: move automaticamente, sem precisar clicar no peão
        performMove(state,myColor,vm[0]);
      }
    });
  });
};

function clickPawn(color,pawnIndex){
  updateRoom(state=>{
    if(state.phase!=='playing') return;
    if(state.turnColor!==myColor || color!==myColor){ showToast('Não é sua vez'); return; }
    if(state.dice===null) return;
    const vm = validMoves(state,myColor,state.dice);
    if(!vm.includes(pawnIndex)) return;
    performMove(state,myColor,pawnIndex);
  });
}

document.getElementById('leaveBtn').onclick = ()=>{
  clearInterval(pollTimer);
  roomCode=null; myColor=null;
  resetPawnLayer();
  document.getElementById('gameScreen').style.display='none';
  document.getElementById('entryScreen').style.display='block';
};

/* ================= TELA / RENDER ================= */
function enterGameScreen(state){
  document.getElementById('entryScreen').style.display='none';
  document.getElementById('gameScreen').style.display='flex';
  document.getElementById('roomCodeLabel').textContent = state.code;
  resetPawnLayer();
  drawBoardStatic();
  render(state);
  pollTimer = setInterval(async ()=>{
    if(!roomCode) return;
    const state = await readRoom(roomCode);
    if(state && state.updatedAt!==lastRenderedAt){
      lastRenderedAt = state.updatedAt;
      render(state);
    }
  }, 1500);
}

function render(state){
  // --- lobby / seleção de cor ---
  const colorPick = document.getElementById('colorPick');
  colorPick.innerHTML='';
  COLORS.forEach(c=>{
    const taken = state.players[c];
    const btn = document.createElement('button');
    btn.className = 'color-btn cb-'+c;
    btn.disabled = !!taken && taken!==myName;
    btn.innerHTML = COLOR_NAME[c] + (taken? `<small>${taken}</small>` : '<small>livre</small>');
    btn.onclick = ()=>{
      if(myColor){ showToast('Você já escolheu uma cor'); return; }
      updateRoom(s=>{
        if(s.players[c]) return;
        s.players[c]=myName;
      });
      myColor=c;
    };
    colorPick.appendChild(btn);
  });
  if(state.players[myColor??'']!==myName){
    // recover local color if this client already claimed one
    COLORS.forEach(c=>{ if(state.players[c]===myName) myColor=c; });
  }
  applyBoardRotation();

  const filledCount = COLORS.filter(c=>state.players[c]).length;
  document.getElementById('startBtn').style.display = (state.phase==='lobby' && filledCount>=2) ? 'block':'none';
  document.getElementById('lobbyBox').style.display = state.phase==='lobby' ? 'block':'none';
  document.getElementById('playBox').style.display = state.phase==='lobby' ? 'none':'block';

  // --- lista de jogadores (minha cor sempre por último / embaixo) ---
  const list = document.getElementById('playersList');
  list.innerHTML='';
  viewOrderColors().forEach(c=>{
    if(!state.players[c]) return;
    const isMe = state.players[c]===myName;
    const row=document.createElement('div');
    row.className='player-row'+(state.turnColor===c?' active':'')+(isMe?' me':'');
    row.innerHTML = `<div class="player-row-top"><span class="dot dot-${c}"></span><span class="name">${state.players[c]}</span>` +
      (isMe?'<span class="tag">você</span>':'') + `</div>` +
      `<div class="mini-dice" id="miniDice-${c}"></div>`;
    list.appendChild(row);
    renderDiceFace(document.getElementById('miniDice-'+c), state.turnColor===c ? state.dice : null);
  });

  // --- turno ---
  const turnMsg = document.getElementById('turnMsg');
  const hint = document.getElementById('hintMsg');
  const rollBtn = document.getElementById('rollBtn');
  if(state.phase==='finished'){
    turnMsg.textContent = `🏆 ${COLOR_NAME[state.winner]} venceu!`;
    rollBtn.disabled=true; hint.textContent='';
  } else if(state.phase==='playing'){
    const isMyTurn = state.turnColor===myColor;
    turnMsg.textContent = isMyTurn ? 'Sua vez!' : `Vez de ${COLOR_NAME[state.turnColor]}`;
    turnMsg.style.color = isMyTurn ? '#16a34a' : 'var(--ink)';
    rollBtn.disabled = !isMyTurn || state.dice!==null;
    if(isMyTurn && state.dice!==null){
      hint.textContent = 'Clique em um peão destacado para mover.';
    } else { hint.textContent=''; }
  }

  // --- log ---
  const log = document.getElementById('log');
  log.innerHTML = state.log.slice(0,12).map(m=>`<div>${m}</div>`).join('');

  drawPawns(state);
}

/* ================= DESENHO DO TABULEIRO (canvas estático) ================= */
function drawBoardStatic(){
  const ctx = document.getElementById('board').getContext('2d');
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,600,600);

  function inBase(r,c){
    for(const key in BASE_RECT){
      const [r0,c0]=BASE_RECT[key];
      if(r>=r0&&r<r0+6&&c>=c0&&c<c0+6) return true;
    }
    return false;
  }
  function inCenter(r,c){ return r>=6&&r<=8&&c>=6&&c<=8; }

  // caminho principal
  const pathSet = {};
  PATH.forEach(([r,c],i)=>{ pathSet[r+'_'+c]=i; });
  const homeSet = {};
  COLORS.forEach(color=>{ HOME_STRETCH[color].forEach(([r,c])=>{ homeSet[r+'_'+c]=color; }); });

  for(let r=0;r<15;r++){
    for(let c=0;c<15;c++){
      if(inBase(r,c) || inCenter(r,c)) continue;
      const key=r+'_'+c;
      let fill='#f8fafc';
      if(homeSet[key]) fill = COLOR_LIGHT[homeSet[key]];
      else {
        COLORS.forEach(color=>{ if(START_INDEX[color]!==undefined && PATH[START_INDEX[color]][0]===r && PATH[START_INDEX[color]][1]===c) fill=COLOR_LIGHT[color]; });
      }
      ctx.fillStyle=fill;
      ctx.fillRect(c*CELL,r*CELL,CELL,CELL);
      ctx.strokeStyle='#e2e8f0';
      ctx.strokeRect(c*CELL,r*CELL,CELL,CELL);
      if(pathSet[key]!==undefined && SAFE_ABS.has(pathSet[key])){
        drawStar(ctx,(c+0.5)*CELL,(r+0.5)*CELL,9,'#fbbf24');
      }
    }
  }

  // bases
  Object.keys(BASE_RECT).forEach(color=>{
    const [r0,c0]=BASE_RECT[color];
    ctx.fillStyle=COLOR_LIGHT[color];
    ctx.fillRect(c0*CELL,r0*CELL,6*CELL,6*CELL);
    const pad=CELL*0.55;
    ctx.fillStyle='#fff';
    ctx.fillRect(c0*CELL+pad,r0*CELL+pad,6*CELL-2*pad,6*CELL-2*pad);
    BASE_SLOTS.forEach(([dr,dc])=>{
      ctx.beginPath();
      ctx.arc((c0+dc)*CELL,(r0+dr)*CELL,CELL*0.3,0,Math.PI*2);
      ctx.strokeStyle=COLOR_HEX[color]; ctx.lineWidth=2; ctx.stroke();
    });
  });

  // centro (casa final)
  const x0=6*CELL,y0=6*CELL,x1=9*CELL,y1=9*CELL;
  const cx=7.5*CELL, cy=7.5*CELL;
  const tl=[x0,y0], tr=[x1,y0], br=[x1,y1], bl=[x0,y1];
  function tri(p1,p2,p3,color){
    ctx.beginPath();
    ctx.moveTo(p1[0],p1[1]); ctx.lineTo(p2[0],p2[1]); ctx.lineTo(p3[0],p3[1]);
    ctx.closePath(); ctx.fillStyle=color; ctx.fill();
  }
  tri(tl,tr,[cx,cy],COLOR_HEX.green);
  tri(tr,br,[cx,cy],COLOR_HEX.yellow);
  tri(br,bl,[cx,cy],COLOR_HEX.blue);
  tri(bl,tl,[cx,cy],COLOR_HEX.red);
  ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeRect(x0,y0,x1-x0,y1-y0);

  // borda externa
  ctx.strokeStyle='#94a3b8'; ctx.lineWidth=2; ctx.strokeRect(1,1,598,598);
}
function drawStar(ctx,cx,cy,r,color){
  ctx.beginPath();
  for(let i=0;i<10;i++){
    const ang = Math.PI/5*i - Math.PI/2;
    const rad = i%2===0? r : r*0.45;
    const x=cx+rad*Math.cos(ang), y=cy+rad*Math.sin(ang);
    i===0? ctx.moveTo(x,y): ctx.lineTo(x,y);
  }
  ctx.closePath(); ctx.fillStyle=color; ctx.fill();
}

/* ================= DESENHO DOS PEÕES (divs sobre o canvas) ================= */
function cellPixel(row,col){ return [(col+0.5)*CELL, (row+0.5)*CELL]; }

function pawnStepsPixel(color,i,steps){
  if(steps>=57){
    // peão terminado: fica dentro do próprio triângulo da cor, sem jitter extra
    const [ox,oy] = CENTER_SLOTS_BY_COLOR[color][i];
    return [CENTER_PX+ox, CENTER_PX+oy];
  }
  let x,y;
  if(steps===0){
    const [r0,c0]=BASE_RECT[color];
    const [dr,dc]=BASE_SLOTS[i];
    [x,y]=[(c0+dc)*CELL,(r0+dr)*CELL];
  } else if(steps>=1 && steps<=51){
    const abs=(START_INDEX[color]+steps-1)%52;
    [x,y]=cellPixel(PATH[abs][0],PATH[abs][1]);
  } else {
    const [r,c]=HOME_STRETCH[color][steps-52];
    [x,y]=cellPixel(r,c);
  }
  // pequeno jitter para não sobrepor totalmente peões na mesma célula
  const jx = ((i%2)*8-4), jy=(Math.floor(i/2)*8-4);
  return [x+jx, y+jy];
}

let pawnEls = {};
let prevPawnsSnapshot = null;
function pawnKey(color,i){ return color+'_'+i; }
function resetPawnLayer(){
  document.getElementById('pawnLayer').innerHTML='';
  pawnEls = {};
  prevPawnsSnapshot = null;
}
function delay(ms){ return new Promise(res=>setTimeout(res,ms)); }

async function hopPawn(el,color,i,fromSteps,toSteps){
  const seq = fromSteps===0 ? [1] : [];
  if(fromSteps>0){ for(let s=fromSteps+1; s<=toSteps; s++) seq.push(s); }
  for(const s of seq){
    const [x,y] = pawnStepsPixel(color,i,s);
    el.classList.add('hopping');
    el.style.left = x+'px';
    el.style.top = y+'px';
    await delay(190);
    el.classList.remove('hopping');
  }
}

function drawPawns(state){
  const layer = document.getElementById('pawnLayer');
  const isMyTurn = state.phase==='playing' && state.turnColor===myColor && state.dice!==null;
  const vm = isMyTurn ? validMoves(state,myColor,state.dice) : [];
  const isFirst = prevPawnsSnapshot===null;

  COLORS.forEach(color=>{
    state.pawns[color].forEach((steps,i)=>{
      const key = pawnKey(color,i);
      let el = pawnEls[key];
      if(!el){
        el = document.createElement('div');
        el.className = 'pawn pawn-'+color;
        layer.appendChild(el);
        pawnEls[key] = el;
        const [x,y] = pawnStepsPixel(color,i,steps);
        el.style.left = x+'px';
        el.style.top = y+'px';
      }

      const movable = isMyTurn && color===myColor && vm.includes(i);
      el.classList.toggle('movable', movable);
      el.onclick = movable ? ()=>clickPawn(color,i) : null;

      const prevSteps = isFirst ? steps : prevPawnsSnapshot[color][i];
      if(!isFirst && prevSteps!==steps){
        if(steps>prevSteps){
          hopPawn(el,color,i,prevSteps,steps);
        } else {
          const [x,y] = pawnStepsPixel(color,i,steps);
          el.style.left = x+'px';
          el.style.top = y+'px';
        }
      }
    });
  });

  prevPawnsSnapshot = JSON.parse(JSON.stringify(state.pawns));
}
