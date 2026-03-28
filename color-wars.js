/* color-wars.js */
let socket = null;
if (typeof io !== 'undefined') {
    socket = io(); // Ne se connecte que si le serveur est allumé
}
let gameMode = 'local'; // 'local' ou 'online'
let currentRoom = '';
let myPlayerId = 1; // Stocke notre numéro de joueur (1, 2, 3 ou 4)
let COLS = 10, ROWS = 8;
const THRESHOLD = 4;
const MAX_BOMBS = 2, MAX_SHIELDS = 3, MAX_ICE = 1;

// ─── Player config ────────────────────────────────────────────────────────────
let isHost = true; // Par défaut en Local
const P_COLOR = { 1:'#e63946', 2:'#2196f3', 3:'#2ecc71', 4:'#f4e04d', 5:'#ff4081', 6:'#18ffff' };
const P_LIGHT  = { 1:'#ff6b74', 2:'#64b5f6', 3:'#6ee7a0', 4:'#fff176', 5:'#ff80ab', 6:'#84ffff' };
const P_NAME   = { 1:'Player 1', 2:'Player 2', 3:'Player 3', 4:'Player 4', 5:'Player 5', 6:'Player 6' };

// ─── Game state ───────────────────────────────────────────────────────────────
let playerCount   = 3;
let currentGridSize = 'normal';
let currentBiome  = 'classic'; 
let grid          = [];
let currentPlayer = 1;
let gameOver      = false;
let animating     = false;
let turnCount     = 0;
let selectedPowerup = 'normal';
let playerHasPlaced = {};
let powerupStock    = {};
let gameCount       = 0;

// Nouveau : Compteur global de projectiles pour les animations asynchrones
let activeProjectiles = 0; 
window.explosionQueue = [];
window.explosionProcessing = false;

// ─── Global Toggles State ─────────────────────────────────────────────────────
let lightningEnabled       = true;
let overgrowthEnabled      = true;
let blackHolesEnabled      = true;
let wallsEnabled           = true;
let teleportersEnabled     = true;
let shieldsEnabled         = true;
let bombsEnabled           = true;
let iceEnabled             = true;
let sismicEnabled          = true;

// ─── Events & Modifiers states ────────────────────────────────────────────────
let lightningScheduledTurn = -1;
let lightningFired         = false;
let lightningRetries       = 0;

let tumorScheduledTurn = -1;
let tumorSpawnTurn     = -1;
let tumorActive        = false;
let tumorTrappedTurns  = {}; 

let currentBounds = { minR: 0, maxR: 0, minC: 0, maxC: 0 };

// ─── Map layout arrays ────────────────────────────────────────────────────────
let mapWalls = [], mapHoles = [], mapTeleporters = [];
let mapIce = [], mapConveyors = [], mapGeysers = [];

// ─── Player Helper ────────────────────────────────────────────────────────────
function isPlayerDead(p) {
  if (!playerHasPlaced[p]) return false;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c].owner === p) return false;
    }
  }
  return true;
}

function canPlayerPlay(p) {
  if (!playerHasPlaced[p]) return true; 
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c].owner === p && !grid[r][c].isFrozen && !grid[r][c].isDestroyed) return true;
    }
  }
  return false; 
}

function verifyCurrentPlayerAlive() {
  if (gameOver) return;
  let changed = false;
  let attempts = 0;
  while (!canPlayerPlay(currentPlayer) && attempts < playerCount) {
    currentPlayer = (currentPlayer % playerCount) + 1;
    attempts++;
    changed = true;
  }
  if (changed) {
    selectedPowerup = 'normal';
    updatePowerupUI();
    updatePanels();
    updateStatusForTurn();
  }
}

// ─── Pre-game menu ────────────────────────────────────────────────────────────
// ─── Synchronisation du Salon (Lobby) ─────────────────────────────────────────
function pushSettings() {
    if (gameMode === 'online' && isHost && socket) {
        const settings = {
            playerCount: playerCount, gridSize: currentGridSize, biome: currentBiome,
            toggles: { lightning: lightningEnabled, overgrowth: overgrowthEnabled, blackHoles: blackHolesEnabled, walls: wallsEnabled, teleporters: teleportersEnabled, shields: shieldsEnabled, bombs: bombsEnabled, ice: iceEnabled, sismic: sismicEnabled }
        };
        socket.emit('updateSettings', { roomCode: currentRoom, settings: settings });
    }
}

// ─── Pre-game menu ────────────────────────────────────────────────────────────
function selectPlayerCount(n) {
  playerCount = n;
  [2,3,4,5,6].forEach(i => {
      const btn = document.getElementById(`pc-${i}`);
      if(btn) btn.classList.toggle('selected', i === n);
  });
  [1,2,3,4,5,6].forEach(i => {
      const sw = document.getElementById(`sw${i}`);
      if(sw) sw.classList.toggle('on', i <= n);
  });
  pushSettings();
}

function selectGridSize(size) {
  currentGridSize = size;
  ['small', 'normal', 'big'].forEach(s => {
    const el = document.getElementById(`gs-${s}`);
    if (el) el.classList.toggle('selected', s === size);
  });
  if (size === 'small') { ROWS = 6; COLS = 6; } 
  else if (size === 'normal') { ROWS = 8; COLS = 10; } 
  else if (size === 'big') { ROWS = 11; COLS = 15; }
  pushSettings();
}

document.getElementById('biome-select').addEventListener('change', function() {
    currentBiome = this.value;
    pushSettings();
});

function togglePregameLightning() { lightningEnabled = !lightningEnabled; document.getElementById('pregame-lightning').classList.toggle('active', lightningEnabled); pushSettings(); }
function togglePregameOvergrowth() { overgrowthEnabled = !overgrowthEnabled; document.getElementById('pregame-overgrowth').classList.toggle('active', overgrowthEnabled); pushSettings(); }
function togglePregameSismic() { sismicEnabled = !sismicEnabled; document.getElementById('pregame-sismic').classList.toggle('active', sismicEnabled); pushSettings(); }
function togglePregameBlackHoles() { blackHolesEnabled = !blackHolesEnabled; document.getElementById('pregame-blackholes').classList.toggle('active', blackHolesEnabled); pushSettings(); }
function togglePregameWalls() { wallsEnabled = !wallsEnabled; document.getElementById('pregame-walls').classList.toggle('active', wallsEnabled); pushSettings(); }
function togglePregameTeleporters() { teleportersEnabled = !teleportersEnabled; document.getElementById('pregame-teleporters').classList.toggle('active', teleportersEnabled); pushSettings(); }
function togglePregameShields() { shieldsEnabled = !shieldsEnabled; document.getElementById('pregame-shields').classList.toggle('active', shieldsEnabled); pushSettings(); }
function togglePregameBombs() { bombsEnabled = !bombsEnabled; document.getElementById('pregame-bombs').classList.toggle('active', bombsEnabled); pushSettings(); }
function togglePregameIce() { iceEnabled = !iceEnabled; document.getElementById('pregame-ice').classList.toggle('active', iceEnabled); pushSettings(); }

function selectMode(mode) {
  gameMode = mode;
  document.getElementById('main-menu-overlay').style.display = 'none';
  document.getElementById('pregame-overlay').classList.remove('hidden');
  
  // NETTOYAGE SYSTÉMATIQUE À L'OUVERTURE
  currentRoom = '';
  isHost = (mode === 'local'); // Host en local, pas encore en ligne
  document.getElementById('room-input').value = '';
  document.getElementById('lobby-code-display').style.display = 'none';
  document.getElementById('host-settings-area').classList.remove('disabled-for-client');
  document.getElementById('start-game-btn').style.display = 'inline-block';

  if (mode === 'online') {
    if (!socket) {
        alert("⚠️ Serveur introuvable !");
        goToMainMenu(); return;
    }
    document.getElementById('online-inputs').style.display = 'block';
    document.getElementById('start-game-btn').innerText = "Créer / Rejoindre";
  } else {
    document.getElementById('online-inputs').style.display = 'none';
    document.getElementById('start-game-btn').innerText = "Start Game";
  }
}

function startGame() {
  if (gameMode === 'online') {
      if (currentRoom === '') {
          let roomInput = document.getElementById('room-input').value.trim();
          
          if (roomInput === '') {
              // 1. Si le champ est vide, on GÉNÈRE un code unique (ex: KX29)
              currentRoom = Math.random().toString(36).substring(2, 6).toUpperCase();
          } else {
              // 2. Si le champ est rempli, on utilise le code tapé pour REJOINDRE
              currentRoom = roomInput.toUpperCase();
          }
          
          socket.emit('joinRoom', currentRoom); 
      } else if (isHost) {
          // Si on est déjà dans le salon et qu'on est l'hôte, on lance !
          socket.emit('requestStartGame', { roomCode: currentRoom });
      }
  } else {
      // Mode Local (inchangé)
      document.getElementById('pregame-overlay').classList.add('hidden');
      document.getElementById('game-title').style.display   = '';
      document.getElementById('game-subtitle').style.display = '';
      document.getElementById('game-subtitle').innerHTML = `MODE LOCAL - MULTIJOUEUR SUR LE MÊME ÉCRAN`;
      document.getElementById('game-container').style.display = '';
      buildGameUI();
      resetGame();
  }
}

function goToMainMenu() {
  document.getElementById('pregame-overlay').classList.add('hidden');
  document.getElementById('main-menu-overlay').style.display = 'flex';

  if (gameMode === 'online' && socket) {
      socket.disconnect();
      setTimeout(() => { socket.connect(); }, 150);
      currentRoom = '';
      isHost = false; // Sera mis à jour par le serveur lors du prochain join
      document.getElementById('lobby-code-display').style.display = 'none';
      document.getElementById('room-input').value = '';
  }
}

function returnToLobby() {
    if (gameMode === 'local') {
        selectMode('local'); // Si local, revient à l'écran de config
    } else if (isHost) {
        socket.emit('requestReturnToLobby', currentRoom);
    }
}

function openRulebook() { document.getElementById('rulebook-overlay').classList.remove('hidden'); }
function closeRulebook() { document.getElementById('rulebook-overlay').classList.add('hidden'); }
function openHostTutorial() { document.getElementById('host-tutorial-overlay').classList.remove('hidden'); }
function closeHostTutorial() { document.getElementById('host-tutorial-overlay').classList.add('hidden'); }

// ─── Dynamic UI builder ───────────────────────────────────────────────────────
function buildGameUI() {
  const gc = document.getElementById('game-container');
  gc.innerHTML = '';

  function playerCardHTML(p) {
    let html = `<div class="player-card p${p}" id="p${p}-card">
      <div class="player-name">${P_NAME[p]}</div>
      <div class="player-stat"><span>Cells</span><span id="p${p}-cells">0</span></div>
      <div class="player-stat"><span>Dots</span><span id="p${p}-dots">0</span></div>
      <div class="turn-indicator" id="p${p}-turn">◆ Your turn</div>
      <div class="first-badge" id="p${p}-badge">✦ Place 3 dots to start</div>
      <div class="card-powerups">
        <div class="card-pu-btn selected" id="p${p}-btn-normal" onclick="selectPowerup('normal')">
          <div class="pu-pip-normal"></div><div class="card-pu-label">Normal</div><div class="card-pu-stock">∞</div>
        </div>`;

    if (shieldsEnabled) {
      html += `<div class="card-pu-btn" id="p${p}-btn-shield" onclick="selectPowerup('shield')"><div class="pu-pip-shield"></div><div class="card-pu-label">Shield</div><div class="card-pu-stock" id="p${p}-stock-shield">×${MAX_SHIELDS}</div></div>`;
    }
    if (bombsEnabled) {
      html += `<div class="card-pu-btn" id="p${p}-btn-bomb" onclick="selectPowerup('bomb')"><svg viewBox="0 0 11 11" xmlns="http://www.w3.org/2000/svg" style="width:9px;height:9px;display:block;flex-shrink:0"><line x1="7" y1="2.5" x2="9" y2="0.5" stroke="#aaa" stroke-width="0.9" stroke-linecap="round"/><circle cx="9.2" cy="0.4" r="0.9" fill="#ffe84d"/><circle cx="5.2" cy="6.5" r="4" fill="#f77f00" stroke="#c05800" stroke-width="0.5"/><circle cx="3.8" cy="5.2" r="1.1" fill="rgba(255,255,255,0.3)"/></svg><div class="card-pu-label">Bomb</div><div class="card-pu-stock" id="p${p}-stock-bomb">×${MAX_BOMBS}</div></div>`;
    }
    if (iceEnabled) {
      html += `<div class="card-pu-btn" id="p${p}-btn-ice" onclick="selectPowerup('ice')"><svg viewBox="0 0 11 11" xmlns="http://www.w3.org/2000/svg" style="width:10px;height:10px;display:block;flex-shrink:0"><rect x="1.5" y="1.5" width="8" height="8" rx="2" fill="rgba(140, 210, 255, 0.6)" stroke="#8cd2ff" stroke-width="1"/><line x1="3" y1="3" x2="8" y2="8" stroke="#8cd2ff" stroke-width="1" stroke-linecap="round"/><line x1="8" y1="3" x2="3" y2="8" stroke="#8cd2ff" stroke-width="1" stroke-linecap="round"/></svg><div class="card-pu-label">Ice</div><div class="card-pu-stock" id="p${p}-stock-ice">×${MAX_ICE}</div></div>`;
    }
    html += `</div><div class="card-actions"><button class="action-btn" id="p${p}-btn-fusion" onclick="openFusionModal(${p})">Fusion</button><button class="action-btn quit-btn" id="p${p}-btn-quit" onclick="quitGame(${p})">Quitter</button></div></div>`;
    return html;
  }

  // Rangée du haut (Joueurs 1 à 3 max)
  const topRow = document.createElement('div'); topRow.className = 'players-row';
  let topCount = Math.min(3, playerCount);
  for(let i = 1; i <= topCount; i++) {
    const wrap = document.createElement('div'); wrap.className = 'player-card-wrap'; 
    wrap.innerHTML = playerCardHTML(i); topRow.appendChild(wrap);
  }
  gc.appendChild(topRow);

  // Le plateau au centre
  const boardWrap = document.createElement('div'); boardWrap.className = 'board-wrap';
  boardWrap.innerHTML = `<div id="board"></div><div class="status-bar" id="status"></div><div class="map-info" id="map-info"></div>`;
  gc.appendChild(boardWrap);

  // Rangée du bas (Joueurs 4 à 6 max)
  if (playerCount > 3) {
    const botRow = document.createElement('div'); botRow.className = 'players-row';
    for(let i = 4; i <= playerCount; i++) {
      const wrap = document.createElement('div'); wrap.className = 'player-card-wrap'; 
      wrap.innerHTML = playerCardHTML(i); botRow.appendChild(wrap);
    }
    gc.appendChild(botRow);
  }

  const ctrlRow = document.createElement('div'); ctrlRow.className = 'controls-row';
  const ctrlBlock = document.createElement('div'); ctrlBlock.className = 'controls-block';
  
  // SEUL L'HÔTE voit le bouton "New Game"
  if (isHost) {
      ctrlBlock.innerHTML = `
        <button class="primary" onclick="resetGame()">New Game</button>
        <button id="return-lobby-btn" onclick="returnToLobby()">← Salon</button>
        <button onclick="openRulebook()">📖 Manuel</button>`;
  } else {
      // Les invités voient uniquement "Salon" et "Manuel"
      ctrlBlock.innerHTML = `
        <button id="return-lobby-btn" onclick="returnToLobby()">← Salon</button>
        <button onclick="openRulebook()">📖 Manuel</button>`;
  }
  ctrlRow.appendChild(ctrlBlock);

  const legendBlock = document.createElement('div'); 
  legendBlock.className = 'legend-card';
  legendBlock.innerHTML = `<div class="legend-title">Legend</div><div class="legend-item"><span class="pip shield"></span>Shield: 1 hit</div><div class="legend-item"><span class="legend-dot" style="background:var(--bomb)"></span>Bomb: 3 turns</div><div class="legend-item"><span class="legend-wall"></span>Wall</div><div class="legend-item"><span class="legend-wall" style="background:#8c3d1a;border-color:#c8644a;opacity:0.75"></span>Breakable</div><div class="legend-item"><span class="legend-dot" style="background:#000;border:2px solid #333"></span>Black hole</div><div class="legend-item"><span class="legend-dot" style="background:rgba(100,60,180,0.6)"></span>Teleporter</div>`;
  ctrlRow.appendChild(legendBlock);
  gc.appendChild(ctrlRow);
}

// ─── Map generation (Biome Logic) ─────────────────────────────────────────────
function rnd(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function generateMap() {
  mapWalls = []; mapHoles = []; mapTeleporters = [];
  mapIce = []; mapConveyors = []; mapGeysers = [];
  
  const totalCells = ROWS * COLS;
  const used = new Set();
  const k    = (r, c) => r + ',' + c;
  const isFree = (r, c) => !used.has(k(r, c));
  const mark = (r, c) => { used.add(k(r, c)); return [r, c]; };
  
  const pickFree = () => {
    for (let i = 0; i < 500; i++) {
      const r = rnd(0, ROWS-1), c = rnd(0, COLS-1);
      if (isFree(r, c)) return mark(r, c);
    }
    return null;
  };

  const centerR = Math.floor(ROWS / 2); const centerC = Math.floor(COLS / 2);
  if (currentBiome === 'wasteland') mark(centerR, centerC); 

  switch (currentBiome) {
   case 'classic':
      let hMin=2, hMax=3, tMin=2, tMax=3, wMin=3, wMax=5;
      if (currentGridSize === 'small') { hMin=1; hMax=2; tMin=1; tMax=2; wMin=2; wMax=3; } 
      else if (currentGridSize === 'big') { hMin=3; hMax=5; tMin=3; tMax=5; wMin=5; wMax=8; }

      if (blackHolesEnabled) { const bhCount = rnd(hMin, hMax); for (let i = 0; i < bhCount; i++) { let p = pickFree(); if (p) mapHoles.push(p); } }
      if (teleportersEnabled) { const teleCount = rnd(tMin, tMax); for (let i = 0; i < teleCount; i++) { let p = pickFree(); if (p) mapTeleporters.push(p); } }
      if (wallsEnabled) { const wallCount = rnd(wMin, wMax); for (let i = 0; i < wallCount; i++) { let p = pickFree(); if (p) mapWalls.push(p); } }
      break;

    case 'labyrinth':
      if (wallsEnabled) {
        let wallCount = Math.floor(totalCells * 0.30);
        for(let i=0; i < wallCount; i++) { let p = pickFree(); if(p) mapWalls.push(p); }
      }
      break;

    case 'archipelago':
      if (blackHolesEnabled) {
        let targetBH = Math.floor(totalCells * 0.25);
        let currentPos = [rnd(0, ROWS-1), rnd(0, COLS-1)];
        for (let i = 0; i < targetBH; i++) {
          if (isFree(currentPos[0], currentPos[1])) mapHoles.push(mark(currentPos[0], currentPos[1]));
          else i--; 
          
          let neighbors = [[-1,0], [1,0], [0,-1], [0,1]];
          let validMoves = neighbors.map(n => [currentPos[0]+n[0], currentPos[1]+n[1]]).filter(pos => pos[0] >= 0 && pos[0] < ROWS && pos[1] >= 0 && pos[1] < COLS);
          if (validMoves.length > 0 && Math.random() < 0.8) currentPos = validMoves[Math.floor(Math.random() * validMoves.length)];
          else currentPos = [rnd(0, ROWS-1), rnd(0, COLS-1)];
        }
      }
      if (wallsEnabled) {
        let wallCount = Math.floor(totalCells * 0.05);
        for(let i=0; i < wallCount; i++) { let p = pickFree(); if(p) mapWalls.push(p); }
      }
      break;

    case 'quantum':
      if (teleportersEnabled) {
        for (let i = 0; i < 8; i++) { let p = pickFree(); if(p) mapTeleporters.push(p); }
      }
      break;

    case 'wasteland':
      if (wallsEnabled) {
        let wallCount = Math.floor(totalCells * 0.10);
        for(let i=0; i < wallCount; i++) { let p = pickFree(); if(p) mapWalls.push(p); }
      }
      if (blackHolesEnabled) {
        let bhCount = Math.floor(totalCells * 0.05);
        for(let i=0; i < bhCount; i++) { let p = pickFree(); if(p) mapHoles.push(p); }
      }
      break;

    case 'glacier':
      let iceCount = Math.floor(totalCells * 0.20);
      for(let i=0; i < iceCount; i++) { let p = pickFree(); if(p) mapIce.push(p); }
      if (wallsEnabled) {
        let wCount = Math.floor(totalCells * 0.05);
        for(let i=0; i < wCount; i++) { let p = pickFree(); if(p) mapWalls.push(p); }
      }
      break;

    case 'foundry':
      let convCount = Math.floor(totalCells * 0.15);
      const dirs = ['conveyor-up', 'conveyor-down', 'conveyor-left', 'conveyor-right'];
      for(let i=0; i < convCount; i++) { 
        let p = pickFree(); 
        if(p) mapConveyors.push({r: p[0], c: p[1], dir: dirs[Math.floor(Math.random()*dirs.length)]}); 
      }
      if (wallsEnabled) {
        let wCount = Math.floor(totalCells * 0.10);
        for(let i=0; i < wCount; i++) { let p = pickFree(); if(p) mapWalls.push(p); }
      }
      break;

    case 'cavern':
      if (wallsEnabled) {
        let wCount = Math.floor(totalCells * 0.20); // 20% Murs miroirs
        for(let i=0; i < wCount; i++) { let p = pickFree(); if(p) mapWalls.push(p); }
      }
      break;

    case 'volcanic':
      let gCount = Math.floor(totalCells * 0.10);
      for(let i=0; i < gCount; i++) { let p = pickFree(); if(p) mapGeysers.push(p); }
      if (wallsEnabled) {
        let wCount = Math.floor(totalCells * 0.10);
        for(let i=0; i < wCount; i++) { let p = pickFree(); if(p) mapWalls.push(p); }
      }
      break;
  }
}

function cellType(r, c) {
  if (mapHoles.some(([a,b]) => a===r && b===c))       return 'blackhole';
  if (mapTeleporters.some(([a,b]) => a===r && b===c)) return 'teleporter';
  if (mapIce.some(([a,b]) => a===r && b===c))         return 'ice-floor';
  if (mapGeysers.some(([a,b]) => a===r && b===c))     return 'geyser';
  
  let conv = mapConveyors.find(m => m.r === r && m.c === c);
  if (conv) return conv.dir;

  if (mapWalls.some(([a,b]) => a===r && b===c)) {
      if (currentBiome === 'cavern') return 'wall-mirror'; // Murs réflecteurs
      return 'wall';
  }
  return 'normal';
}

// ─── Grid ─────────────────────────────────────────────────────────────────────
function initGrid() {
  grid = [];
  for (let r = 0; r < ROWS; r++) {
    grid[r] = [];
    for (let c = 0; c < COLS; c++) {
      const type = cellType(r, c);
      const cell = { 
        owner: 0, dots: [], type, isContaminated: false, isTumorCore: false, 
        isFrozen: false, freezeTurns: 0, isDestroyed: false
      };
      
      // Certains murs (dont les miroirs) peuvent être destructibles
      if ((type === 'wall' || type === 'wall-mirror') && Math.random() < 0.4) { 
          cell.type = 'wall-breakable'; 
          cell.wallHits = 5; 
      }
      grid[r][c] = cell;
    }
  }
}

function buildBoard() {
  const board = document.getElementById('board');
  board.style.setProperty('--cols', COLS);
  board.innerHTML = '';
  
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = document.createElement('div');
      el.className  = 'cell' + (r % 2 === 0 ? ' row-even' : '');
      el.id         = `cell-${r}-${c}`;
      el.dataset.r  = r;
      el.dataset.c  = c;
      el.onclick    = () => handleClick(r, c);
      board.appendChild(el);
    }
  }
}

function renderCell(r, c) {
  const el = document.getElementById(`cell-${r}-${c}`);
  const d  = grid[r][c];
  
  if (d.isDestroyed) { el.className = 'cell sismic-destroyed' + (r % 2 === 0 ? ' row-even' : ''); el.innerHTML = ''; return; }
  el.className = 'cell' + (r % 2 === 0 ? ' row-even' : '');
  
  if (d.isContaminated) el.classList.add('contaminated');
  if (d.type === 'ice-floor') el.classList.add('ice-floor');
  if (d.type === 'geyser') el.classList.add('geyser');
  if (d.type && d.type.startsWith('conveyor')) {
      el.classList.add('conveyor');
      if (d.type === 'conveyor-up') el.classList.add('dir-up');
      if (d.type === 'conveyor-down') el.classList.add('dir-down');
      if (d.type === 'conveyor-left') el.classList.add('dir-left');
      if (d.type === 'conveyor-right') el.classList.add('dir-right');
  }

  el.innerHTML = '';

  if (d.isTumorCore) {
    const core = document.createElement('div'); core.className = 'tumor-core'; el.appendChild(core);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('tumor-core-roots'); svg.setAttribute('viewBox', '0 0 54 54');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;overflow:visible;';
    const numRoots = 6 + Math.floor(Math.random() * 3);
    const cx = 27, cy = 27;
    for (let i = 0; i < numRoots; i++) {
      const baseAngle = (i / numRoots) * Math.PI * 2 + (Math.random() - 0.5) * 0.5; const len = 12 + Math.random() * 10;
      const midAngle = baseAngle + (Math.random() - 0.5) * 1.5;
      const mx = cx + Math.cos(midAngle) * len * 0.5, my = cy + Math.sin(midAngle) * len * 0.5;
      const ex = cx + Math.cos(baseAngle) * len, ey = cy + Math.sin(baseAngle) * len;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${cx},${cy} L${mx},${my} L${ex},${ey}`);
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', `rgba(${40 + Math.random()*20|0},${50 + Math.random()*20|0},${10 + Math.random()*10|0},${0.7 + Math.random()*0.3})`);
      path.setAttribute('stroke-width', (1.5 + Math.random() * 1.5).toFixed(1)); path.setAttribute('stroke-linejoin', 'miter');
      svg.appendChild(path);
    }
    el.appendChild(svg);
  }

  if (d.type === 'wall' || d.type === 'wall-mirror') {
    el.classList.add('wall');
    const inner = document.createElement('div'); inner.className = 'wall-inner';
    ['top:5px;left:5px', 'top:5px;right:5px', 'bottom:5px;left:5px', 'bottom:5px;right:5px'].forEach(pos => {
      const rv = document.createElement('div');
      rv.style.cssText = `position:absolute;${pos};width:5px;height:5px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#f0b090,#7a3010);box-shadow:0 1px 2px rgba(0,0,0,0.5)`;
      inner.appendChild(rv);
    });
    el.appendChild(inner);
    return;
  }

  if (d.type === 'wall-breakable') {
    el.classList.add('wall-breakable'); el.setAttribute('data-hp', d.wallHits);
    const hp = document.createElement('div'); hp.className  = 'wall-hp'; hp.textContent = d.wallHits; el.appendChild(hp);
    ['top:5px;left:5px', 'bottom:5px;right:5px'].forEach(pos => {
      const rv = document.createElement('div');
      rv.style.cssText = `position:absolute;${pos};width:4px;height:4px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#d0906a,#5a2008);box-shadow:0 1px 2px rgba(0,0,0,0.5)`;
      el.appendChild(rv);
    });
    return;
  }

  if (d.type === 'blackhole') {
    el.classList.add('blackhole');
    const inner = document.createElement('div'); inner.className = 'bh-inner'; el.appendChild(inner);
    return;
  }

  if (d.type === 'teleporter' || d.type === 'teleporter-a' || d.type === 'teleporter-b') {
    el.classList.add('teleporter-a');
    const lbl = document.createElement('span'); lbl.className  = 'tele-label'; lbl.textContent = '⟡'; el.appendChild(lbl);
    return;
  }

  if (!gameOver && !animating) {
    const isFree = !playerHasPlaced[currentPlayer];
    if (isFree) {
      if (d.owner === 0 && d.dots.length === 0 && d.type !== 'geyser') el.classList.add('free-hint');
      else el.classList.add('no-play');
    } else {
      if (d.isFrozen) {
        el.classList.add('no-play');
      } else if (selectedPowerup === 'ice') {
        let unfrozenDotCells = 0;
        for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
            if (grid[rr][cc].dots.length > 0 && !grid[rr][cc].isFrozen && !grid[rr][cc].isDestroyed) unfrozenDotCells++;
        }
        if (d.dots.length > 0 && unfrozenDotCells > 1) el.classList.add('can-play');
        else el.classList.add('no-play');
      } else {
        if (d.owner === currentPlayer) el.classList.add('can-play');
        else el.classList.add('no-play');
      }
    }
  }

  if (d.dots.length > 0) {
    const cont = document.createElement('div'); cont.className = 'dots-container';
    d.dots.forEach(dot => {
      const span = document.createElement('div');
      if (dot.type === 'bomb') {
        span.className   = 'dot bomb'; span.style.position = 'relative';
        const turns = dot.bombTurns > 0 ? dot.bombTurns : '!';
        const animStyle = d.isFrozen ? '' : 'style="animation:bombFuse 0.4s infinite alternate"';
        span.innerHTML = `<svg viewBox="0 0 11 11" xmlns="http://www.w3.org/2000/svg"><line x1="7" y1="2.5" x2="9" y2="0.5" stroke="#aaa" stroke-width="0.9" stroke-linecap="round"/><circle cx="9.2" cy="0.4" r="0.9" fill="#ffe84d" ${animStyle}/><circle cx="5.2" cy="6.5" r="4" fill="#f77f00" stroke="#c05800" stroke-width="0.5"/><circle cx="3.8" cy="5.2" r="1.1" fill="rgba(255,255,255,0.3)"/></svg>`;
        const cd = document.createElement('div');
        cd.style.cssText = 'position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);font-size:6px;font-weight:700;color:#f77f00;font-family:monospace;pointer-events:none;line-height:1;white-space:nowrap';
        cd.textContent = turns; span.appendChild(cd);
      } else if (dot.type === 'shield') {
        span.className = `dot shield-p${d.owner}`;
      } else {
        span.className = `dot p${d.owner}`;
      }
      // Points neutres (Geysers, Foudre)
      if (d.owner === 0 && dot.type !== 'bomb') {
          span.style.background = '#aaaaaa'; 
          span.style.boxShadow = '0 0 5px #aaaaaa';
      }
      cont.appendChild(span);
    });
    el.appendChild(cont);
    if (d.dots.length > 1) {
      const badge = document.createElement('div'); badge.className  = `count-badge p${d.owner}`;
      if (d.owner === 0) badge.style.color = '#fff';
      badge.textContent = d.dots.length; el.appendChild(badge);
    }
  }

  if (d.isFrozen) {
    const ice = document.createElement('div'); ice.className = 'ice-overlay'; el.appendChild(ice);
    const iceCounter = document.createElement('div'); iceCounter.className = 'ice-turn-counter';
    iceCounter.textContent = d.freezeTurns; el.appendChild(iceCounter);
  }
}

function renderAll() {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) renderCell(r, c);
  updatePanels();
}

function quitGame(p) {
  if (currentPlayer !== p || animating || gameOver) return;
  if (!confirm("Voulez-vous vraiment quitter la partie ? Toutes vos cases disparaitront.")) return;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[r][c].owner === p && !grid[r][c].isDestroyed) { grid[r][c].dots = []; grid[r][c].owner = 0; }
  }
  playerHasPlaced[p] = true; setStatus(`${P_NAME[p]} a quitté la partie.`, 'warn');
  renderAll(); checkWin(); if (!gameOver) advanceTurn();
}

function openFusionModal(p) {
  if (currentPlayer !== p || animating || gameOver) return;
  if (!playerHasPlaced[p]) { setStatus("Vous ne pouvez pas fusionner dès le premier tour !", "warn"); return; }
  const alive = []; for (let i = 1; i <= playerCount; i++) if (i !== p && !isPlayerDead(i)) alive.push(i);
  if (alive.length === 0) { setStatus("Personne avec qui fusionner !", "warn"); return; }
  const container = document.getElementById('fusion-players'); container.innerHTML = '';
  alive.forEach(targetP => {
    const btn = document.createElement('button'); btn.className = `fusion-target-btn`;
    btn.textContent = P_NAME[targetP]; btn.style.backgroundColor = P_COLOR[targetP];
    btn.onclick = () => executeFusion(p, targetP); container.appendChild(btn);
  });
  document.getElementById('fusion-overlay').classList.remove('hidden');
}

function closeFusionModal() { document.getElementById('fusion-overlay').classList.add('hidden'); }

function executeFusion(fromP, toP) {
  closeFusionModal();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const d = grid[r][c];
      if (d.owner === fromP && !d.isDestroyed) {
        d.owner = toP; d.dots.pop(); 
        d.dots.forEach(dot => { if (dot.type === 'bomb' && dot.bombPrevOwner === fromP) dot.bombPrevOwner = toP; });
        if (d.dots.length === 0) d.owner = 0;
      }
  }
  playerHasPlaced[fromP] = true; setStatus(`${P_NAME[fromP]} a fusionné avec ${P_NAME[toP]} !`, 'info');
  renderAll(); checkWin(); if (!gameOver) advanceTurn();
}

function handleClick(r, c) {
  if (animating || gameOver || myPlayerId === 'spectator') return; // Bloque les spectateurs
  if (gameMode === 'online' && currentPlayer !== myPlayerId) { 
      setStatus("Ce n'est pas votre tour !", "warn"); return; 
  }

  const d = grid[r][c];
  if (d.isDestroyed) return;
  if (d.type !== 'normal' && d.type !== 'ice-floor' && !d.type.startsWith('conveyor')) return;
  
  const isFree = !playerHasPlaced[currentPlayer];

  if (isFree) {
    if (selectedPowerup === 'ice') { setStatus('Cannot place an Ice Bloc on your first turn!', 'warn'); return; }
    if (d.owner !== 0 || d.dots.length > 0) { setStatus('First turn: choose an empty cell!', 'warn'); return; }
  } else {
    if (d.isFrozen) { setStatus('This cell is frozen and paralyzed!', 'warn'); return; }
    if (selectedPowerup === 'ice') {
      if (d.dots.length === 0) { setStatus('Ice Bloc must be placed on a cell with dots!', 'warn'); return; }
      let unfrozenDotCells = 0;
      for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
          if (grid[rr][cc].dots.length > 0 && !grid[rr][cc].isFrozen && !grid[rr][cc].isDestroyed) unfrozenDotCells++;
      }
      if (unfrozenDotCells <= 1 && !d.isFrozen) { setStatus('Cannot freeze the last active cell!', 'warn'); return; }
    } else {
      if (d.owner !== currentPlayer) { setStatus('Play on your own cells!', 'warn'); return; }
    }
  }

  if (gameMode === 'online') {
      socket.emit('playTurn', { room: currentRoom, r: r, c: c, powerup: selectedPowerup, player: currentPlayer });
  } else {
      executeTurn(r, c, currentPlayer, selectedPowerup);
  }
}

function executeTurn(r, c, player, powerup) {
    let oldPowerup = selectedPowerup;
    selectedPowerup = powerup; 
    const d = grid[r][c];

    if (!playerHasPlaced[player]) {
        placeDot(r, c, player, powerup); placeDot(r, c, player, powerup); placeDot(r, c, player, powerup);
        playerHasPlaced[player] = true;
    } else if (powerup === 'ice') {
        powerupStock[player].ice--;
        d.isFrozen = true; d.freezeTurns = 20;
        if (d.isTumorCore) destroyTumor();
        else if (d.isContaminated) d.isContaminated = false;
        renderCell(r, c);
    } else {
        placeDot(r, c, player, powerup);
    }

    selectedPowerup = oldPowerup; 
    advanceTurn();
}

function placeDot(r, c, player, type) {
  const d = grid[r][c]; if (d.isDestroyed) return;
  const prevOwner = d.owner; d.owner = player;
  d.dots.push({ type, shieldHits: type === 'shield' ? 1 : 0, bombTurns: type === 'bomb' ? 3 : 0, bombPrevOwner: type === 'bomb' ? prevOwner : 0 });
  if (type === 'bomb' || type === 'shield') {
    powerupStock[player][type]--;
    if (powerupStock[player][type] <= 0 && selectedPowerup === type) selectedPowerup = 'normal';
    updatePowerupUI();
  }
  renderCell(r, c);
  if (d.dots.length >= THRESHOLD) { animating = true; setTimeout(() => processExplosionQueue([[r, c]]), 130); }
}

// ─── CORE EXPLOSION LOGIC ─────────────────────────────────────────────────────

function getExplosionTargets(r, c) {
  const targets = [];
  const dirs = [[-1,0], [1,0], [0,-1], [0,1]];

  dirs.forEach(([dr, dc]) => {
    let nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return;

    // Glissade sur le Glacier
    if (currentBiome === 'glacier') {
        while (true) {
            let cell = grid[nr][nc];
            if (cell.type === 'wall' || cell.type === 'wall-breakable' || cell.type === 'wall-mirror' || cell.isDestroyed || cell.isFrozen || cell.dots.length > 0) break;
            if (cell.type !== 'ice-floor') break;
            let nextR = nr + dr, nextC = nc + dc;
            if (nextR < 0 || nextR >= ROWS || nextC < 0 || nextC >= COLS) break;
            nr = nextR; nc = nextC;
        }
    }

    const fCell = grid[nr][nc];
    // IMPORTANT : On autorise le ciblage des wall-mirror pour qu'ils puissent déclencher le rebond dans landDot
    if (fCell.type !== 'wall' && !fCell.isFrozen && !fCell.isDestroyed) {
        targets.push({ r: nr, c: nc, dr, dc });
    }
  });
  return targets;
}

function processExplosionQueue(initialQueue) {
  if (!window.explosionQueue) window.explosionQueue = [];
  if (initialQueue) window.explosionQueue.push(...initialQueue);

  if (window.explosionProcessing) return;
  window.explosionProcessing = true;
  animating = true;

  function next() {
      while (window.explosionQueue.length && (grid[window.explosionQueue[0][0]][window.explosionQueue[0][1]].dots.length < THRESHOLD || grid[window.explosionQueue[0][0]][window.explosionQueue[0][1]].isDestroyed)) {
          window.explosionQueue.shift();
      }

      if (!window.explosionQueue.length) {
          if (activeProjectiles > 0) {
              setTimeout(next, 50); return; // On attend que tous les vols asynchrones (rebonds, glissades) atterrissent
          }
          window.explosionProcessing = false;
          animating = false;
          renderAll();
          checkWin();
          return;
      }

      const [r, c] = window.explosionQueue.shift();
      const d = grid[r][c];
      if (d.dots.length < THRESHOLD) { setTimeout(next, 0); return; }

      const el = document.getElementById(`cell-${r}-${c}`);
      if (el) { el.classList.add('exploding'); setTimeout(() => el.classList.remove('exploding'), 400); }

      const owner = d.owner;
      const toSend = d.dots.slice();
      d.dots = []; d.owner = 0;
      renderCell(r, c);

      const targets = getExplosionTargets(r, c);
      const count = Math.min(toSend.length, targets.length);

      if (!count) { setTimeout(next, 0); return; }

      targets.forEach((t, i) => {
          if (i >= count) return;
          const dtype = toSend[i] ? toSend[i].type : 'normal';
          activeProjectiles++;
          animateFlyingDot(r, c, t.r, t.c, owner, dtype, () => {
              activeProjectiles--;
              landDot(t.r, t.c, owner, dtype, window.explosionQueue, t.dr, t.dc);
          });
      });

      setTimeout(next, 190);
  }
  next();
}

function landDot(r, c, owner, dtype, queue, dr = 0, dc = 0) {
  const d = grid[r][c];
  if (d.isDestroyed || d.isFrozen) return;

  if (d.type === 'wall-breakable') {
    d.wallHits--;
    if (d.wallHits <= 0) {
      d.type = 'normal'; d.wallHits = 0;
      const el = document.getElementById(`cell-${r}-${c}`);
      if (el) { el.classList.add('exploding'); setTimeout(() => el.classList.remove('exploding'), 400); }
    }
    renderCell(r, c);
    return;
  }

  // Murs miroirs (Caverne)
  if (d.type === 'wall' || d.type === 'wall-mirror') {
      if (d.type === 'wall-mirror' && (dr !== 0 || dc !== 0)) {
          const el = document.getElementById(`cell-${r}-${c}`);
          if (el) { el.classList.add('tele-flash'); setTimeout(() => el.classList.remove('tele-flash'), 200); }
          let backR = r - dr, backC = c - dc;
          activeProjectiles++;
          animateFlyingDot(r, c, backR, backC, owner, dtype, () => {
              activeProjectiles--;
              if (!window.explosionQueue) window.explosionQueue = [];
              landDot(backR, backC, owner, dtype, window.explosionQueue, -dr, -dc);
              if (!window.explosionProcessing && window.explosionQueue.length > 0) processExplosionQueue();
          });
      }
      return;
  }

  if (d.type === 'blackhole') {
    const el = document.getElementById(`cell-${r}-${c}`);
    if (el) { const rect = el.getBoundingClientRect(); animateSuckIn(rect.left + rect.width / 2, rect.top + rect.height / 2, owner, dtype, () => {}); }
    return;
  }

  if (d.type === 'teleporter' || d.type === 'teleporter-a' || d.type === 'teleporter-b') {
    const el = document.getElementById(`cell-${r}-${c}`);
    if (el) { el.classList.add('tele-flash'); setTimeout(() => el.classList.remove('tele-flash'), 500); }
    const dest = randomTeleportDest();
    if (!dest) return;
    landDot(dest[0], dest[1], owner, dtype, queue, dr, dc);
    return;
  }

  if (d.owner !== 0 && d.owner !== owner) {
    const sh = d.dots.find(x => x.type === 'shield');
    if (sh) {
      d.dots = d.dots.filter(x => x !== sh);
      if (!d.dots.length) d.owner = 0;
      renderCell(r, c); return;
    }
  }

  const prevOwner = d.owner;
  // Les points neutres atterrissant sur une case vide gardent la case neutre
  if (owner !== 0 || d.dots.length > 0) {
      // Sauf si la case est occupée, le point neutre rejoint l'occupant (comme la foudre)
      d.owner = owner === 0 && d.owner !== 0 ? d.owner : owner;
  }
  
  d.dots.push({ type: dtype === 'bomb' ? 'bomb' : 'normal', shieldHits: 0, bombTurns: dtype === 'bomb' ? 3 : 0, bombPrevOwner: dtype === 'bomb' ? prevOwner : 0 });
  renderCell(r, c);

  if (d.dots.length >= THRESHOLD) {
    if (!queue.some(([a,b]) => a===r && b===c)) queue.push([r, c]);
    if (!window.explosionProcessing) processExplosionQueue(); // Reprise si l'explosion vient d'un événement retardé
  }
}

function animateFlyingDot(fr, fc, tr, tc, player, type, cb) {
  const fe = document.getElementById(`cell-${fr}-${fc}`);
  const te = document.getElementById(`cell-${tr}-${tc}`);
  if (!fe || !te || grid[fr][fc].isDestroyed || grid[tr][tc].isDestroyed) { cb(); return; }
  const fr2 = fe.getBoundingClientRect(), tr2 = te.getBoundingClientRect();
  const dot = document.createElement('div'); dot.className = `flying-dot p${player}`;
  if (player === 0) { dot.style.background = '#aaaaaa'; dot.style.boxShadow = '0 0 8px #aaaaaa'; } // Neutre
  if (type === 'bomb')   dot.style.background = 'var(--bomb)';
  if (type === 'shield') dot.style.background = 'var(--shield)';
  
  const sx = fr2.left + fr2.width/2  - 5.5, sy = fr2.top + fr2.height/2 - 5.5;
  const ex = tr2.left + tr2.width/2  - 5.5, ey = tr2.top + tr2.height/2 - 5.5;
  dot.style.left = sx + 'px'; dot.style.top = sy + 'px'; document.body.appendChild(dot);
  
  let t0 = null; const dur = 220;
  function step(ts) {
    if (!t0) t0 = ts;
    const t = Math.min((ts - t0) / dur, 1);
    const e = t < 0.5 ? 2*t*t : -1 + (4-2*t)*t;
    dot.style.left = (sx + (ex-sx)*e) + 'px'; dot.style.top = (sy + (ey-sy)*e) + 'px';
    dot.style.transform = `scale(${1 + 0.3*Math.sin(Math.PI*t)})`;
    if (t < 1) requestAnimationFrame(step);
    else { if (dot.parentNode) dot.parentNode.removeChild(dot); cb(); }
  }
  requestAnimationFrame(step);
}

function randomTeleportDest() {
  const candidates = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = grid[r][c].type;
    if (t !== 'wall' && t !== 'wall-mirror' && t !== 'teleporter' && t !== 'teleporter-a' && t !== 'teleporter-b' && !grid[r][c].isFrozen && !grid[r][c].isDestroyed) {
        candidates.push([r, c]);
    }
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function animateSuckIn(cx, cy, player, dtype, cb) {
  const dot = document.createElement('div'); dot.className = `flying-dot p${player}`;
  if (player === 0) dot.style.background = '#aaaaaa';
  if (dtype === 'bomb') dot.style.background = 'var(--bomb)';
  dot.style.left = (cx - 5.5) + 'px'; dot.style.top  = (cy - 5.5) + 'px';
  document.body.appendChild(dot);
  requestAnimationFrame(() => {
    dot.classList.add('sucked');
    setTimeout(() => { if (dot.parentNode) dot.parentNode.removeChild(dot); cb(); }, 580);
  });
}

// ─── End Turn Mechanics ───────────────────────────────────────────────────────
function advanceTurn() {
  turnCount++;
  tickIce(); 
  tickBombs();
  checkLightningStrike();
  handleTumorLogic(); 
  tickGeysers();
  tickConveyors();

  if (sismicEnabled && turnCount >= 100 && ((turnCount - 100) % 20 === 0)) {
    triggerSismicCollapse();
    return;
  }

  finalizeTurn();
}

function tickGeysers() {
  if (currentBiome !== 'volcanic' || turnCount % 5 !== 0) return;
  let exploded = [];
  for(let r=0; r<ROWS; r++) for(let c=0; c<COLS; c++) {
      let d = grid[r][c];
      if(d.type === 'geyser' && !d.isFrozen && !d.isDestroyed) {
          d.dots.push({type:'normal', shieldHits:0, bombTurns:0, bombPrevOwner:0});
          if (d.dots.length === 1) d.owner = 0; // Sécurise la neutralité si c'est le 1er point
          renderCell(r, c);
          if (d.dots.length >= THRESHOLD) exploded.push([r, c]);
      }
  }
  if (exploded.length > 0) setTimeout(() => processExplosionQueue(exploded), 200);
}

function tickConveyors() {
  if (currentBiome !== 'foundry' || turnCount % playerCount !== 0) return;
  let moves = [];
  for(let r=0; r<ROWS; r++) for(let c=0; c<COLS; c++) {
      let d = grid[r][c];
      if (d.type && d.type.startsWith('conveyor') && d.dots.length > 0 && !d.isFrozen && !d.isDestroyed) {
          let dr = 0, dc = 0;
          if (d.type === 'conveyor-up') dr = -1;
          if (d.type === 'conveyor-down') dr = 1;
          if (d.type === 'conveyor-left') dc = -1;
          if (d.type === 'conveyor-right') dc = 1;
          let nr = r + dr, nc = c + dc;
          if (nr>=0 && nr<ROWS && nc>=0 && nc<COLS) {
              let t = grid[nr][nc];
              if (t.type !== 'wall' && t.type !== 'wall-mirror' && !t.isFrozen && !t.isDestroyed) {
                  moves.push({ fr: r, fc: c, tr: nr, tc: nc, dr, dc, owner: d.owner, dots: d.dots.slice() });
                  d.dots = []; d.owner = 0;
                  renderCell(r, c);
              }
          }
      }
  }
  if (moves.length > 0) {
      animating = true;
      moves.forEach(m => {
          activeProjectiles++;
          animateFlyingDot(m.fr, m.fc, m.tr, m.tc, m.owner, 'normal', () => {
              activeProjectiles--;
              if (!window.explosionQueue) window.explosionQueue = [];
              m.dots.forEach(dot => landDot(m.tr, m.tc, m.owner, dot.type, window.explosionQueue, m.dr, m.dc));
              if (!window.explosionProcessing && window.explosionQueue.length > 0) processExplosionQueue();
              else if (activeProjectiles === 0 && window.explosionQueue.length === 0) { animating = false; checkWin(); }
          });
      });
  }
}

function finalizeTurn() {
  if (playerHasPlaced[currentPlayer] && !isPlayerDead(currentPlayer)) {
    let ownsCells = false; let allContaminated = true;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (grid[r][c].owner === currentPlayer && !grid[r][c].isDestroyed) {
          ownsCells = true;
          if (!grid[r][c].isContaminated) allContaminated = false;
        }
    }
    if (ownsCells && allContaminated) {
      tumorTrappedTurns[currentPlayer] = (tumorTrappedTurns[currentPlayer] || 0) + 1;
      if (tumorTrappedTurns[currentPlayer] >= 3) {
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
            if (grid[r][c].owner === currentPlayer) { grid[r][c].owner = 0; grid[r][c].dots = []; }
        }
        setStatus(`${P_NAME[currentPlayer]} a été dévoré par la tumeur !`, 'warn');
        tumorTrappedTurns[currentPlayer] = 0; renderAll();
      }
    } else tumorTrappedTurns[currentPlayer] = 0;
  }
  
  let attempts = 0;
  do { currentPlayer = (currentPlayer % playerCount) + 1; attempts++; } while (!canPlayerPlay(currentPlayer) && attempts < playerCount);
  
  selectedPowerup = 'normal'; updatePowerupUI(); updatePanels(); updateStatusForTurn(); checkWin();
}

function tickIce() {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const d = grid[r][c];
      if (d.isFrozen && !d.isDestroyed) {
        d.freezeTurns--;
        if (d.freezeTurns <= 0) {
          d.isFrozen = false; renderCell(r, c);
          const el = document.getElementById(`cell-${r}-${c}`);
          if (el) { const melt = document.createElement('div'); melt.className = 'ice-melt-anim'; el.appendChild(melt); setTimeout(() => { if (melt.parentNode) melt.parentNode.removeChild(melt); }, 600); }
        } else renderCell(r, c);
      }
  }
}

function tickBombs() {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const d = grid[r][c];
    if (d.isFrozen || d.isDestroyed) continue; 
    d.dots.forEach(x => { if (x.type === 'bomb') x.bombTurns--; });
    const bomb = d.dots.find(x => x.type === 'bomb' && x.bombTurns <= 0);
    if (!bomb) continue;
    
    const explodeAs = bomb.bombPrevOwner || d.owner;
    d.dots = []; d.owner = 0; renderCell(r, c);
    
    const targets = getExplosionTargets(r, c);
    if (!targets.length) { checkWin(); continue; }
    
    animating = true;
    const el = document.getElementById(`cell-${r}-${c}`);
    if (el) { el.classList.add('exploding'); setTimeout(() => el.classList.remove('exploding'), 400); }
    
    if (!window.explosionQueue) window.explosionQueue = [];
    targets.forEach(t => {
      activeProjectiles++;
      animateFlyingDot(r, c, t.r, t.c, explodeAs, 'normal', () => {
        activeProjectiles--;
        landDot(t.r, t.c, explodeAs, 'normal', window.explosionQueue, t.dr, t.dc);
        if (!window.explosionProcessing && window.explosionQueue.length > 0) processExplosionQueue();
        else if (activeProjectiles === 0 && window.explosionQueue.length === 0) { animating = false; checkWin(); }
      });
    });
  }
}

// ─── Tumor & Events ───────────────────────────────────────────────────────────
function handleTumorLogic() {
  if (!overgrowthEnabled) return;
  if (!tumorActive && turnCount === tumorScheduledTurn) spawnTumor();
  if (tumorActive) {
    const turnsSinceSpawn = turnCount - tumorSpawnTurn;
    if (turnsSinceSpawn > 0 && turnsSinceSpawn % 10 === 0) drainTumorCells();
    if (turnsSinceSpawn > 0 && turnsSinceSpawn % 25 === 0) expandTumor();
  }
}

function destroyTumor() {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[r][c].isContaminated && !grid[r][c].isDestroyed) { grid[r][c].isContaminated = false; grid[r][c].isTumorCore = false; renderCell(r, c); }
  }
  tumorActive = false; tumorScheduledTurn = -1; setStatus('The Vegetal Tumor has been eradicated!', 'info');
}

function spawnTumor() {
  let r, c;
  if (currentBiome === 'wasteland') { r = Math.floor(ROWS / 2); c = Math.floor(COLS / 2); grid[r][c].type = 'normal'; grid[r][c].dots = []; grid[r][c].owner = 0; } 
  else {
    const empties = [];
    for (let ir = 0; ir < ROWS; ir++) for (let ic = 0; ic < COLS; ic++) {
        const d = grid[ir][ic]; if (d.type === 'normal' && d.dots.length === 0 && d.owner === 0 && !d.isContaminated && !d.isFrozen && !d.isDestroyed) empties.push([ir, ic]);
    }
    if (empties.length === 0) return;
    const pick = empties[Math.floor(Math.random() * empties.length)]; r = pick[0]; c = pick[1];
  }
  const cell = grid[r][c]; cell.isContaminated = true; cell.isTumorCore = true; tumorActive = true; tumorSpawnTurn = turnCount;
  setStatus('A Vegetal Tumor has taken root...', 'warn'); renderCell(r, c);
}

function expandTumor() {
  const newInfections = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[r][c].isContaminated && !grid[r][c].isDestroyed) {
        [[r-1,c], [r+1,c], [r,c-1], [r,c+1]].forEach(([nr, nc]) => {
          if (nr>=0 && nr<ROWS && nc>=0 && nc<COLS) {
            const nd = grid[nr][nc];
            if (nd.type === 'normal' && !nd.isContaminated && !nd.isFrozen && !nd.isDestroyed && !newInfections.some(i => i.tr === nr && i.tc === nc)) newInfections.push({ fr: r, fc: c, tr: nr, tc: nc });
          }
        });
      }
  }
  newInfections.forEach(inf => {
    grid[inf.tr][inf.tc].isContaminated = true;
    setTimeout(() => { renderCell(inf.tr, inf.tc); const el = document.getElementById(`cell-${inf.tr}-${inf.tc}`); if (el) { el.classList.add('just-infected'); setTimeout(() => el.classList.remove('just-infected'), 900); } }, 600);
  });
}

function drainTumorCells() {
  let drained = false;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const d = grid[r][c];
      if (d.isContaminated && d.dots.length > 0 && !d.isFrozen && !d.isDestroyed) { d.dots.pop(); if (d.dots.length === 0) d.owner = 0; drained = true; renderCell(r, c); }
  }
  if (drained) setStatus('The thorny brambles drain resources...', 'warn');
}

function checkLightningStrike() {
  if (!lightningEnabled || lightningFired || gameOver || turnCount < lightningScheduledTurn) return;
  const targets = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const d = grid[r][c]; if (d.type === 'normal' && d.dots.length === 3 && !d.isFrozen && !d.isDestroyed) targets.push([r, c]); }
  if (!targets.length) { lightningRetries++; if (lightningRetries <= 10) lightningScheduledTurn = turnCount + 1; else lightningFired = true; return; }

  const [tr, tc] = targets[Math.floor(Math.random() * targets.length)];
  lightningFired  = true; lightningRetries = 0; animating = true;

  const banner = document.createElement('div'); banner.className  = 'lightning-announce'; banner.textContent = '⚡ Lightning Strike!';
  document.body.appendChild(banner); setTimeout(() => { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 2000);

  animateLightningBolt(tr, tc, () => {
    const el = document.getElementById(`cell-${tr}-${tc}`);
    if (el) { el.classList.add('lightning-hit'); setTimeout(() => el.classList.remove('lightning-hit'), 500); }
    const d = grid[tr][tc]; d.dots.push({ type: 'normal', shieldHits: 0, bombTurns: 0, bombPrevOwner: 0 }); renderCell(tr, tc);
    setTimeout(() => processExplosionQueue([[tr, tc]]), 120);
  });
}

function animateLightningBolt(r, c, cb) {
  const el = document.getElementById(`cell-${r}-${c}`); if (!el) { cb(); return; }
  const canvas = document.createElement('canvas'); const W = el.offsetWidth, H = el.offsetHeight;
  canvas.width = W; canvas.height = H; canvas.className = 'lightning-cell-canvas'; el.appendChild(canvas);
  const ctx = canvas.getContext('2d'); const duration = 1200; let start = null;

  function arc(x1, y1, x2, y2, rough, depth) {
    if (depth === 0) return [[x1,y1],[x2,y2]];
    const mx = (x1+x2)/2 + (Math.random()-0.5)*rough, my = (y1+y2)/2 + (Math.random()-0.5)*rough;
    return [...arc(x1,y1,mx,my,rough*0.55,depth-1), ...arc(mx,my,x2,y2,rough*0.55,depth-1)];
  }
  function drawArc(pts, alpha, width, color) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = '#ffe84d'; ctx.shadowBlur = 6; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke(); ctx.restore();
  }

  function frame(ts) {
    if (!start) start = ts; const t = Math.min((ts - start) / duration, 1); ctx.clearRect(0, 0, W, H);
    const alpha = t < 0.08 ? t/0.08 : t < 0.75 ? 1 : 1 - (t-0.75)/0.25; const arcCount = t < 0.5 ? Math.ceil(t/0.5*4)+1 : Math.max(1, Math.ceil((1-t)/0.5*4));
    for (let i = 0; i < arcCount; i++) {
      const angle = (i/arcCount) * Math.PI*2 + ts*0.003;
      const x1 = W/2 + Math.cos(angle) * (W/2-4), y1 = H/2 + Math.sin(angle) * (H/2-4);
      const x2 = W/2 + Math.cos(angle + Math.PI + (Math.random()-0.5)*0.8) * (W/2-4), y2 = H/2 + Math.sin(angle + Math.PI + (Math.random()-0.5)*0.8) * (H/2-4);
      const pts = arc(x1, y1, x2, y2, 14+Math.random()*8, 5);
      drawArc(pts, alpha*0.3, 4, '#fff8a0'); drawArc(pts, alpha*0.85, 1.2, '#ffe84d'); drawArc(pts, alpha*0.6, 0.5, '#ffffff');
    }
    const sparkR = 3 + Math.sin(ts*0.025)*2; ctx.save(); ctx.globalAlpha = alpha * (0.6 + Math.sin(ts*0.04)*0.4); ctx.shadowColor = '#ffe84d'; ctx.shadowBlur = 10; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(W/2, H/2, sparkR, 0, Math.PI*2); ctx.fill(); ctx.restore();
    if (t < 1) requestAnimationFrame(frame); else { canvas.remove(); cb(); }
  }
  requestAnimationFrame(frame);
}

function triggerSismicCollapse() {
  animating = true; setStatus('🌋 ALERT SISMIC ZONE: THE BORDERS ARE COLLAPSING!', 'sismic-alert');
  const targets = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!grid[r][c].isDestroyed && (r === currentBounds.minR || r === currentBounds.maxR || c === currentBounds.minC || c === currentBounds.maxC)) targets.push([r, c]);
  }
  currentBounds.minR++; currentBounds.maxR--; currentBounds.minC++; currentBounds.maxC--;
  targets.forEach(([r, c]) => { const el = document.getElementById(`cell-${r}-${c}`); if (el) el.classList.add('sismic-trembling'); });

  setTimeout(() => {
    let tumorDestroyedBySismic = false;
    targets.forEach(([r, c]) => {
      const el = document.getElementById(`cell-${r}-${c}`); if (el) { el.classList.remove('sismic-trembling'); el.classList.add('sismic-falling'); }
      const d = grid[r][c]; d.isDestroyed = true; d.owner = 0; d.dots = []; d.isContaminated = false; d.isFrozen = false;
      if (d.isTumorCore) tumorDestroyedBySismic = true;
    });
    if (tumorDestroyedBySismic) { destroyTumor(); setStatus('The Vegetal Tumor fell into the abyss!', 'info'); }
    setTimeout(() => {
       targets.forEach(([r, c]) => { const el = document.getElementById(`cell-${r}-${c}`); if (el) { el.classList.remove('sismic-falling'); el.classList.add('sismic-destroyed'); } });
       animating = false; renderAll(); finalizeTurn();
    }, 700);
  }, 2000);
}

// ─── Win & Status ─────────────────────────────────────────────────────────────
function checkWin() {
  // On vérifie uniquement que tous les joueurs ont bien posé leurs 3 premiers points
  const allPlaced = Array.from({length: playerCount}, (_, i) => i+1).every(p => playerHasPlaced[p]);
  if (!allPlaced) { verifyCurrentPlayerAlive(); return; }
  
  // On compte les cases de chaque joueur
  const counts = {}; for (let p = 1; p <= playerCount; p++) counts[p] = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { 
      const d = grid[r][c]; const o = d.owner; 
      if (o > 0 && o <= playerCount && !d.isDestroyed) counts[o]++; 
  }
  
  // On dresse la liste des survivants
  const alive = Array.from({length: playerCount}, (_, i) => i+1).filter(p => counts[p] > 0);
  
  // S'il ne reste qu'un joueur (ou 0 en cas d'égalité kamikaze), on affiche l'écran de fin instantanément !
  if (alive.length === 1) showWinner(alive[0]); 
  else if (alive.length === 0) showWinner(0);  
  else verifyCurrentPlayerAlive();
}

function showWinner(p) {
  gameOver = true; const ov = document.getElementById('winner-overlay');
  document.body.classList.remove('turn-p1', 'turn-p2', 'turn-p3', 'turn-p4');
  if (p !== 0) document.body.classList.add(`turn-p${p}`);
  
  if (p === 0) { ov.className = `show`; document.getElementById('winner-text').textContent = `IT'S A DRAW!`; } 
  else { ov.className = `show p${p}-wins`; document.getElementById('winner-text').textContent = `${P_NAME[p]} wins!`; }
}

function updatePanels() {
  const counts = {}; for (let p = 1; p <= playerCount; p++) counts[p] = { c: 0, d: 0 };
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const d = grid[r][c]; if (d.owner >= 1 && d.owner <= playerCount && !d.isDestroyed) { counts[d.owner].c++; counts[d.owner].d += d.dots.length; } }
  for (let p = 1; p <= playerCount; p++) {
    const ce = document.getElementById(`p${p}-cells`), de = document.getElementById(`p${p}-dots`);
    if (ce) ce.textContent = counts[p].c; if (de) de.textContent = counts[p].d;
    
    const isDead = isPlayerDead(p), isFrozenSolid = !isDead && !canPlayerPlay(p);
    const card = document.getElementById(`p${p}-card`);
    if (card) { card.classList.toggle('active', currentPlayer === p && !isDead); card.classList.toggle('dead', isDead); card.classList.toggle('frozen-solid', isFrozenSolid); }
    
    const quitBtn = document.getElementById(`p${p}-btn-quit`), fusionBtn = document.getElementById(`p${p}-btn-fusion`);
    if (quitBtn) quitBtn.disabled = (currentPlayer !== p || isDead || !playerHasPlaced[p] || animating || gameOver);
    if (fusionBtn) fusionBtn.disabled = (currentPlayer !== p || isDead || !playerHasPlaced[p] || animating || gameOver);
    
    const ti = document.getElementById(`p${p}-turn`);
    if (ti) {
      if (isDead) { ti.textContent = "GAME OVER"; ti.style.opacity = '1'; ti.style.color = ''; } 
      else if (isFrozenSolid) { ti.textContent = "FROZEN"; ti.style.opacity = '1'; ti.style.color = ''; } 
      else if (tumorTrappedTurns[p] > 0) { ti.textContent = `INFECTION : ${3 - tumorTrappedTurns[p]} TOURS`; ti.style.opacity = '1'; ti.style.color = '#ff6b74'; } 
      else { ti.textContent = "◆ Your turn"; ti.style.opacity = currentPlayer === p ? '1' : '0'; ti.style.color = ''; }
    }
    const badge = document.getElementById(`p${p}-badge`); if (badge) badge.classList.toggle('show', currentPlayer === p && !playerHasPlaced[p] && !isDead);
  }
  document.body.classList.remove('turn-p1', 'turn-p2', 'turn-p3', 'turn-p4');
  if (!gameOver) document.body.classList.add(`turn-p${currentPlayer}`);
}

function updateStatusForTurn() {
  if (gameOver) return;
  const name = P_NAME[currentPlayer], isFree = !playerHasPlaced[currentPlayer];
  setStatus(isFree ? `${name} — click any empty cell to place 3 dots` : `${name}'s turn`, isFree ? 'info' : '');
}

function setStatus(msg, cls = '') {
  const el = document.getElementById('status'); if (!el) return;
  el.textContent = msg; el.className   = 'status-bar' + (cls ? ' ' + cls : '');
  if (cls === 'warn') setTimeout(() => { el.className = 'status-bar'; updateStatusForTurn(); }, 1800);
}

function selectPowerup(t) {
  if (animating || gameOver) return;
  if (t !== 'normal' && (!powerupStock[currentPlayer] || !powerupStock[currentPlayer][t] || powerupStock[currentPlayer][t] <= 0)) { setStatus(`No ${t}s left!`, 'warn'); return; }
  selectedPowerup = t; updatePowerupUI();
}

function updatePowerupUI() {
  for (let p = 1; p <= playerCount; p++) {
    const stock = powerupStock[p]; if (!stock) continue;
    const isActive = p === currentPlayer;
    ['normal', 'shield', 'bomb', 'ice'].forEach(t => {
      const btn = document.getElementById(`p${p}-btn-${t}`); if (!btn) return;
      btn.classList.toggle('selected', isActive && t === selectedPowerup);
      if (t !== 'normal') btn.classList.toggle('depleted', !stock[t] || stock[t] <= 0);
    });
    ['shield', 'bomb', 'ice'].forEach(t => {
      const badge = document.getElementById(`p${p}-stock-${t}`); if (!badge) return;
      const count = stock[t] || 0; badge.textContent = `×${count}`; badge.style.color = count === 0 ? '#e63946' : count === 1 ? '#ff9f43' : 'var(--muted)';
    });
  }
  if (selectedPowerup !== 'normal' && powerupStock[currentPlayer] && (!powerupStock[currentPlayer][selectedPowerup] || powerupStock[currentPlayer][selectedPowerup] <= 0)) { selectedPowerup = 'normal'; updatePowerupUI(); }
}

function resetGame() {
  // SÉCURITÉ : Bloque les resquilleurs en ligne
  if (gameMode === 'online' && !isHost) return;

  // 1. Reset des variables globales
  gameCount++; gameOver = false; animating = false; turnCount = 0; selectedPowerup = 'normal';
  playerHasPlaced = {}; powerupStock = {}; tumorTrappedTurns = {};
  window.explosionProcessing = false; window.explosionQueue = []; activeProjectiles = 0;
  currentBounds = { minR: 0, maxR: ROWS - 1, minC: 0, maxC: COLS - 1 };

  // 2. Choix du Biome
  const biomeSelect = document.getElementById('biome-select');
  if (biomeSelect) currentBiome = biomeSelect.value;
  
  // 3. Reset des Joueurs (Version complète)
  for (let p = 1; p <= playerCount; p++) {
    playerHasPlaced[p] = false; tumorTrappedTurns[p] = 0;
    powerupStock[p] = {};
    if (bombsEnabled) powerupStock[p].bomb = MAX_BOMBS;
    if (shieldsEnabled) powerupStock[p].shield = MAX_SHIELDS;
    if (iceEnabled) powerupStock[p].ice = MAX_ICE;
  }
  
  // 4. Événements (Tumeur & Foudre)
  if (overgrowthEnabled) { 
      tumorScheduledTurn = (currentBiome === 'wasteland') ? 1 : rnd(15, 100); 
  } else tumorScheduledTurn = -1;
  
  tumorSpawnTurn = -1; tumorActive = false;
  lightningFired = false; lightningScheduledTurn = rnd(1, 100);
  
  // 5. Ordre de jeu
  currentPlayer = ((gameCount - 1) % playerCount) + 1;
  document.getElementById('winner-overlay').className = '';
  
  // 6. Reconstruction physique
  generateMap(); initGrid(); buildBoard();
  document.getElementById('board').className = currentBiome; 
  renderAll();
  
  // 7. SYNCHRONISATION (Crucial pour le mode online)
  if (gameMode === 'online' && isHost) {
      socket.emit('saveMap', { room: currentRoom, grid: grid });
  }

  // 8. UI et Status
  const mi = document.getElementById('map-info');
  if (mi) mi.textContent = `Biome: ${currentBiome.toUpperCase()} · Map ${gameCount} · ${COLS}x${ROWS}`;
  updateStatusForTurn(); updatePowerupUI();
}

// ─── ÉCOUTES DU SERVEUR (MULTIJOUEUR) ─────────────────────────────────────────

if (socket) {
    socket.on('lobbyJoined', (data) => {
        isHost = data.isHost;
        currentRoom = data.roomCode;
        
        document.getElementById('pregame-overlay').classList.remove('hidden');
        document.getElementById('main-menu-overlay').style.display = 'none';
        
        const codeDisplay = document.getElementById('lobby-code-display');
        codeDisplay.style.display = 'block';
        
        if (!isHost) {
            document.getElementById('host-settings-area').classList.add('disabled-for-client');
            document.getElementById('start-game-btn').style.display = 'none';
            codeDisplay.innerHTML = `SALON : <strong>${currentRoom}</strong> <span class="spectator-badge">En attente de l'hôte...</span>`;
            // Appliquer les settings reçus
            selectPlayerCount(data.settings.playerCount);
            selectGridSize(data.settings.gridSize);
        } else {
            document.getElementById('host-settings-area').classList.remove('disabled-for-client');
            document.getElementById('start-game-btn').style.display = 'inline-block';
            codeDisplay.innerHTML = `SALON : <strong>${currentRoom}</strong> <span class="spectator-badge" style="background:var(--gold);color:#000;">Vous êtes l'Hôte</span>`;
        }
    });

    socket.on('settingsChanged', (settings) => {
        // Applique les paramètres modifiés par l'hôte sans déclencher pushSettings
        if(!isHost) {
            document.getElementById(`pc-${settings.playerCount}`).click();
            document.getElementById(`gs-${settings.gridSize}`).click();
            document.getElementById('biome-select').value = settings.biome;
            currentBiome = settings.biome;
        }
    });

    socket.on('gameStarted', (data) => {
        myPlayerId = data.playerNum; // 'spectator' ou 1 à 6
        
        document.getElementById('pregame-overlay').classList.add('hidden');
        document.getElementById('game-title').style.display = '';
        document.getElementById('game-subtitle').style.display = '';
        document.getElementById('game-container').style.display = '';
        
        let roleText = myPlayerId === 'spectator' 
            ? `<strong style="color:#aaa">SPECTATEUR</strong>` 
            : `Vous êtes le <strong style="color:${P_LIGHT[myPlayerId]}">Joueur ${myPlayerId}</strong>`;
            
        document.getElementById('game-subtitle').innerHTML = `SALLE : <strong style="color:var(--gold)">${currentRoom}</strong> - ${roleText}`;
        
        buildGameUI();
        resetGame();

        if (isHost) {
            socket.emit('saveMap', { room: currentRoom, grid: grid });
        }
        
        if (myPlayerId === 'spectator') {
            document.getElementById('return-lobby-btn').style.display = 'none';
        } else if (!isHost) {
            document.getElementById('return-lobby-btn').innerHTML = 'En attente de l\'Hôte...';
            document.getElementById('return-lobby-btn').disabled = true;
        }
    });

    socket.on('loadMap', (sharedGrid) => {
        if(!isHost) { grid = sharedGrid; buildBoard(); renderAll(); }
    });

    socket.on('updateBoard', (data) => {
        executeTurn(data.r, data.c, data.player, data.powerup);
    });

    socket.on('returnToLobby', () => {
        selectMode('online'); // Réaffiche le salon
        document.getElementById('lobby-code-display').style.display = 'block';
    });

    socket.on('hostMigrated', () => {
        isHost = true;
        document.getElementById('host-settings-area').classList.remove('disabled-for-client');
        document.getElementById('start-game-btn').style.display = 'inline-block';
        document.getElementById('lobby-code-display').innerHTML = `SALON : <strong>${currentRoom}</strong> <span class="spectator-badge" style="background:var(--gold);color:#000;">Vous êtes le nouvel Hôte</span>`;
    });
}