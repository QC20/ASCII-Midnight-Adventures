(() => {
  'use strict';

  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d', { alpha: false });
  const mini = document.getElementById('mini-map');
  const mctx = mini.getContext('2d');
  const game = document.getElementById('game');

  const W = 28;
  const H = 24;
  const TILE_H_RATIO = 0.52;
  const MONO_FONT = '"DM Mono", monospace';
  const COLORS = {
    sand: ['#18201a', '#1d211b', '#20231d', '#1a211b', '#23231d'],
    scrub: ['#17271e', '#1a2a20', '#1c2c22', '#15241d'],
    road: ['#24251f', '#29271f', '#20231e'],
    water: ['#091514', '#0a1918', '#0b1c1b'],
    glyph: ['#4d634b', '#6a7652', '#8b8055', '#647d69'],
    waterGlyph: ['#28584e', '#387466', '#548675', '#42615a'],
  };
  const GLYPHS = ['.', ':', ',', '\'', '`', ';', '+', '/', '\\', '_', '·', 'o', 'x', '^', '|'];
  const WATER_GLYPHS = ['~', '~', '~', '=', '(', ')', '-', '.', '≈', '∿'];

  let width = 0;
  let height = 0;
  let dpr = 1;
  let tileW = 34;
  let tileH = 17.7;
  let originX = 0;
  let originY = 0;
  let lastFrame = 0;
  let moveAt = 0;
  let enemyAt = 0;
  let toastTimer = 0;
  let startedAt = performance.now();
  let gamePaused = false;
  let mapOpen = false;
  let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let runState = 'playing';
  let hitFlash = 0;
  let attackReadyAt = 0;
  let lastDamageAt = 0;
  let ticks = 0;
  let dust = [];

  const input = { keys: new Set(), last: null };
  const player = { x: 5, y: 17, fromX: 5, fromY: 17, moveStarted: 0, dx: 0, dy: -1, health: 3, ammo: 12, scrap: 0, capacitors: 0, invulnerable: false };

  const caches = [
    { x: 8, y: 13, found: false, name: 'CULVERT CACHE', text: 'Half-buried under the old road. One capacitor and a handful of pulse cells.' },
    { x: 14, y: 10, found: false, name: 'SIGNAL CACHE', text: 'A faded militia pack. The capacitor inside still holds a little warmth.' },
    { x: 21, y: 7, found: false, name: 'TOWER CACHE', text: 'The last capacitor. It hums in time with the relay.' },
  ];
  const relay = { x: 25, y: 4, active: false };
  const hostiles = [
    { x: 12, y: 10, alive: true, lastMove: 0, type: 'scout', name: 'RUST SCOUT' },
    { x: 18, y: 8, alive: true, lastMove: 0, type: 'raider', name: 'DUST RAIDER' },
  ];
  const props = [
    { x: 3, y: 14, type: 'wreck' }, { x: 10, y: 17, type: 'pump' },
    { x: 17, y: 5, type: 'bones' }, { x: 23, y: 11, type: 'deadTree' },
    { x: 5, y: 8, type: 'deadTree' }, { x: 19, y: 15, type: 'wreck' },
    { x: 2, y: 20, type: 'bones' }, { x: 26, y: 14, type: 'pump' },
    { x: 11, y: 5, type: 'deadTree' }, { x: 7, y: 20, type: 'deadTree' },
    { x: 15, y: 17, type: 'wreck' }, { x: 25, y: 19, type: 'bones' },
  ];
  const blocked = new Set(['3,14', '10,17', '17,5', '23,11', '5,8', '19,15', '2,20', '26,14', '11,5', '7,20', '15,17', '25,19']);
  const waterTiles = new Set();
  const roadTiles = new Set();
  const grassTiles = new Set();

  const keyMap = {
    w: [0, -1], ArrowUp: [0, -1],
    s: [0, 1], ArrowDown: [0, 1],
    a: [-1, 0], ArrowLeft: [-1, 0],
    d: [1, 0], ArrowRight: [1, 0],
  };

  function hash(x, y, salt = 0) {
    let n = (x * 374761393 + y * 668265263 + salt * 1442695041) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function buildWorld() {
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const mainPool = ((x - 8) ** 2) / 39 + ((y - 20.5) ** 2) / 12.4 < 1;
        const farPool = ((x - 23) ** 2) / 10 + ((y - 20) ** 2) / 7 < 1;
        if (mainPool || farPool) waterTiles.add(`${x},${y}`);
        const pathY = Math.round(16 - (x - 4) * 0.46);
        if (Math.abs(y - pathY) <= 1 && x >= 3 && x <= 25 && !waterTiles.has(`${x},${y}`)) roadTiles.add(`${x},${y}`);
        if (hash(x, y, 27) > 0.68 && !waterTiles.has(`${x},${y}`)) grassTiles.add(`${x},${y}`);
      }
    }
  }

  function inBounds(x, y) { return x >= 0 && x < W && y >= 0 && y < H; }
  function cellKey(x, y) { return `${x},${y}`; }
  function isWater(x, y) { return waterTiles.has(cellKey(x, y)); }
  function isBlocked(x, y) { return !inBounds(x, y) || isWater(x, y) || blocked.has(cellKey(x, y)); }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mobile = width <= 680;
    tileW = mobile ? 35 : Math.min(37, Math.max(28, width / 30));
    tileH = tileW * TILE_H_RATIO;
    const mapCenterX = ((W - 1) - (H - 1)) * tileW / 4;
    const mapCenterY = ((W - 1) + (H - 1)) * tileH / 4;
    if (mobile || width < 1030) {
      const p = projectRaw(player.x, player.y);
      originX = width * 0.5 - p.x;
      originY = height * 0.47 - p.y;
    } else {
      originX = width * 0.5 - mapCenterX;
      originY = height * 0.49 - mapCenterY;
    }
    createDust();
  }

  function projectRaw(x, y) { return { x: (x - y) * tileW / 2, y: (x + y) * tileH / 2 }; }
  function project(x, y) { const p = projectRaw(x, y); return { x: p.x + originX, y: p.y + originY }; }

  function createDust() {
    const count = reducedMotion ? 8 : Math.min(45, Math.floor(width * height / 26000));
    dust = Array.from({ length: count }, (_, i) => ({
      x: hash(i, 2, 11) * width,
      y: hash(i, 9, 19) * height,
      speed: 0.025 + hash(i, 4, 22) * 0.09,
      phase: hash(i, 5, 8) * Math.PI * 2,
      size: hash(i, 1, 4) > 0.82 ? 1.5 : 1,
    }));
  }

  function choosePalette(x, y, palette, salt = 2) {
    return palette[Math.floor(hash(x, y, salt) * palette.length)];
  }

  function drawBackground(time) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#090e0b');
    sky.addColorStop(.45, '#111811');
    sky.addColorStop(1, '#080d0c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(width * .51, height * .44, 8, width * .51, height * .44, Math.max(width, height) * .58);
    glow.addColorStop(0, 'rgba(112,137,91,.1)');
    glow.addColorStop(.43, 'rgba(79,111,85,.045)');
    glow.addColorStop(1, 'rgba(8,11,9,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = .22;
    ctx.font = `10px ${MONO_FONT}`;
    for (let i = 0; i < 55; i += 1) {
      const x = hash(i, 13, 3) * width;
      const y = hash(i, 29, 7) * height;
      if ((i + Math.floor(time / 1800)) % 5 === 0) continue;
      ctx.fillStyle = i % 3 === 0 ? '#8b8959' : '#718b6f';
      ctx.fillText(i % 4 === 0 ? '.' : '·', x, y);
    }
    ctx.restore();

    if (!reducedMotion) {
      ctx.save();
      for (let i = 0; i < dust.length; i += 1) {
        const mote = dust[i];
        const drift = Math.sin(time * .00016 + mote.phase) * 6;
        const rise = (time * mote.speed * .012) % 32;
        ctx.globalAlpha = .08 + .1 * (0.5 + 0.5 * Math.sin(time * .001 + mote.phase));
        ctx.fillStyle = i % 4 === 0 ? '#b69c63' : '#a8b293';
        ctx.fillRect((mote.x + drift + width) % width, (mote.y - rise + height) % height, mote.size, mote.size);
      }
      ctx.restore();
    }
  }

  function tileGround(x, y, time) {
    const key = cellKey(x, y);
    const p = project(x, y);
    const halfW = tileW / 2;
    const halfH = tileH / 2;
    const water = isWater(x, y);
    const road = roadTiles.has(key);
    const grass = grassTiles.has(key);
    const color = choosePalette(x, y, water ? COLORS.water : road ? COLORS.road : grass ? COLORS.scrub : COLORS.sand);

    ctx.beginPath();
    ctx.moveTo(p.x, p.y - halfH);
    ctx.lineTo(p.x + halfW, p.y);
    ctx.lineTo(p.x, p.y + halfH);
    ctx.lineTo(p.x - halfW, p.y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (!water && hash(x, y, 51) > .94) {
      ctx.strokeStyle = 'rgba(121,129,91,.07)';
      ctx.lineWidth = .7;
      ctx.stroke();
    }

    if (water) {
      drawWater(x, y, p, time);
    } else {
      drawTerrainGlyphs(x, y, p, time, road, grass);
    }
  }

  function drawTerrainGlyphs(x, y, p, time, road, grass) {
    const count = width < 680 ? 4 : 6 + Math.floor(hash(x, y, 6) * 5);
    const size = Math.max(7, tileW * .27);
    ctx.font = `${size}px ${MONO_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < count; i += 1) {
      const seed = hash(x * 17 + i, y * 13 - i, 31);
      const localX = (seed - .5) * tileW * .75;
      const localY = (hash(x + i * 3, y - i, 37) - .5) * tileH * .62;
      const glyphIndex = Math.floor(hash(x + i, y * 2, 3) * GLYPHS.length);
      let char = GLYPHS[glyphIndex];
      if (road && i % 3 === 0) char = ['_', '=', '/', '-'][i % 4];
      if (grass && i % 2 === 0) char = ['|', '/', '\\', 'i'][i % 4];
      const greens = road ? ['#596052', '#736c50', '#485548'] : COLORS.glyph;
      ctx.fillStyle = choosePalette(x + i, y - i, greens, 11);
      ctx.globalAlpha = .25 + hash(i, x + y, 12) * (grass ? .65 : .4);
      const sway = grass && !reducedMotion ? Math.sin(time * .0011 + x * .62 + i) * 1.2 : 0;
      ctx.fillText(char, p.x + localX + sway, p.y + localY);
    }
    ctx.globalAlpha = 1;
    if (grass && hash(x, y, 91) > .72) {
      ctx.fillStyle = 'rgba(175,167,100,.7)';
      ctx.fillText('·', p.x + (hash(x, y, 8) - .5) * 8, p.y - tileH * .22);
    }
  }

  function drawWater(x, y, p, time) {
    const count = width < 680 ? 3 : 5 + Math.floor(hash(x, y, 53) * 4);
    const size = Math.max(7, tileW * .25);
    ctx.font = `${size}px ${MONO_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < count; i += 1) {
      const seed = hash(x + i * 5, y - i * 2, 24);
      const localX = (seed - .5) * tileW * .78;
      const localY = (hash(x - i * 3, y + i, 74) - .5) * tileH * .6;
      const shift = reducedMotion ? 0 : Math.sin(time * .001 + x * .7 + i * .8) * 2.1;
      const glyph = WATER_GLYPHS[Math.floor(hash(i + x, y * 3, 16) * WATER_GLYPHS.length)];
      ctx.globalAlpha = .16 + hash(i, x + y, 44) * .45;
      ctx.fillStyle = choosePalette(x + i, y + i, COLORS.waterGlyph, 44);
      ctx.fillText(glyph, p.x + localX + shift, p.y + localY);
    }

    const echoX = player.x + 3;
    const echoY = player.y + 3;
    if (x === echoX && y === echoY && isWater(x, y)) {
      const weight = .2;
      ctx.globalAlpha = weight;
      ctx.fillStyle = '#78a18a';
      ctx.font = `bold ${Math.max(8, tileW * .31)}px ${MONO_FONT}`;
      ctx.fillText('(@)', p.x, p.y - 2);
      ctx.fillText('/|\\', p.x, p.y + 5);
      ctx.globalAlpha = .45;
      ctx.fillStyle = '#365b51';
      ctx.fillText(reducedMotion ? '~~~' : (Math.floor(time / 130) % 2 ? '≈~=' : '=~≈'), p.x, p.y + tileH * .2);
    }
    ctx.globalAlpha = 1;
  }

  function drawProp(prop, time) {
    const p = project(prop.x, prop.y);
    const bob = reducedMotion ? 0 : Math.sin(time * .001 + prop.x) * 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.max(10, tileW * .34)}px ${MONO_FONT}`;
    ctx.shadowBlur = 8;
    if (prop.type === 'wreck') {
      ctx.shadowColor = 'rgba(155,101,58,.23)';
      ctx.fillStyle = '#887151';
      ctx.fillText('/_[]_\\', p.x, p.y - 7 + bob);
      ctx.font = `${Math.max(8, tileW * .22)}px ${MONO_FONT}`;
      ctx.fillStyle = '#66715b';
      ctx.fillText('o---o', p.x, p.y + 1 + bob);
    } else if (prop.type === 'pump') {
      ctx.shadowColor = 'rgba(171,148,80,.22)';
      ctx.fillStyle = '#9c8b5a';
      ctx.fillText('  +', p.x, p.y - 12 + bob);
      ctx.fillStyle = '#777b5d';
      ctx.fillText(' [_]', p.x, p.y - 3 + bob);
      ctx.fillText('  | ', p.x, p.y + 5 + bob);
    } else if (prop.type === 'deadTree') {
      ctx.shadowColor = 'rgba(117,154,101,.19)';
      ctx.fillStyle = '#64795a';
      ctx.fillText('\\|/', p.x, p.y - 9 + bob);
      ctx.fillStyle = '#78694b';
      ctx.fillText(' /|\\ ', p.x, p.y - 2 + bob);
      ctx.fillText('  |  ', p.x, p.y + 5 + bob);
    } else {
      ctx.shadowColor = 'rgba(170,154,111,.18)';
      ctx.fillStyle = '#80785c';
      ctx.fillText(' .-. ', p.x, p.y - 4);
      ctx.fillText(' / \\ ', p.x, p.y + 3);
    }
    ctx.shadowBlur = 0;
  }

  function drawCache(cache, time) {
    if (cache.found) return;
    const p = project(cache.x, cache.y);
    const pulse = reducedMotion ? .7 : .55 + .22 * Math.sin(time * .004 + cache.x);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(119,192,156,.48)';
    ctx.shadowBlur = 8 + pulse * 8;
    ctx.fillStyle = `rgba(153,207,169,${pulse})`;
    ctx.font = `bold ${Math.max(10, tileW * .35)}px ${MONO_FONT}`;
    ctx.fillText('[+]', p.x, p.y - 8);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#687964';
    ctx.font = `${Math.max(8, tileW * .21)}px ${MONO_FONT}`;
    ctx.fillText('/___\\', p.x, p.y - 1);
    ctx.restore();
  }

  function drawRelay(time) {
    const p = project(relay.x, relay.y);
    const shimmer = reducedMotion ? .7 : .48 + .32 * Math.sin(time * .0034);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.max(12, tileW * .42)}px ${MONO_FONT}`;
    ctx.shadowColor = relay.active ? 'rgba(213,181,109,.7)' : 'rgba(104,163,143,.5)';
    ctx.shadowBlur = 10 + shimmer * 15;
    ctx.fillStyle = relay.active ? `rgba(233,203,126,${shimmer})` : `rgba(126,176,154,${shimmer})`;
    ctx.fillText(relay.active ? '✳' : '╫', p.x, p.y - 23);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#a69565';
    ctx.font = `bold ${Math.max(10, tileW * .3)}px ${MONO_FONT}`;
    ctx.fillText('/|\\', p.x, p.y - 12);
    ctx.fillStyle = '#8b8b6a';
    ctx.fillText(' | ', p.x, p.y - 3);
    ctx.fillStyle = '#5f6e5c';
    ctx.font = `${Math.max(8, tileW * .22)}px ${MONO_FONT}`;
    ctx.fillText('_|_|_', p.x, p.y + 4);
    if (relay.active && !reducedMotion) {
      ctx.strokeStyle = `rgba(213,181,109,${.2 + shimmer * .15})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 22, 15 + shimmer * 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function interpolatePlayer(now) {
    const duration = reducedMotion ? 1 : 125;
    const amount = Math.min(1, (now - player.moveStarted) / duration);
    const eased = amount * amount * (3 - 2 * amount);
    return {
      x: player.fromX + (player.x - player.fromX) * eased,
      y: player.fromY + (player.y - player.fromY) * eased,
    };
  }

  function drawPlayer(now, time) {
    const pos = interpolatePlayer(now);
    const p = project(pos.x, pos.y);
    const pulse = reducedMotion ? .1 : .1 + .04 * Math.sin(time * .002);
    ctx.save();
    ctx.globalAlpha = .7;
    ctx.fillStyle = '#050906';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 5, tileW * .22, tileH * .23, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = .2 + pulse;
    ctx.fillStyle = '#be9a56';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - 2, tileW * .38, tileW * .38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.max(10, tileW * .38)}px ${MONO_FONT}`;
    ctx.shadowColor = 'rgba(220,184,102,.78)';
    ctx.shadowBlur = 13;
    ctx.fillStyle = '#f0d38a';
    ctx.fillText('@', p.x, p.y - 15);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#d0bd81';
    ctx.font = `bold ${Math.max(10, tileW * .32)}px ${MONO_FONT}`;
    ctx.fillText('/|\\', p.x, p.y - 6);
    ctx.fillStyle = '#869078';
    ctx.font = `${Math.max(9, tileW * .25)}px ${MONO_FONT}`;
    ctx.fillText('/ \\', p.x, p.y + 2);
    if (hitFlash > now) {
      ctx.globalAlpha = .72;
      ctx.fillStyle = '#e19370';
      ctx.font = `bold ${Math.max(12, tileW * .42)}px ${MONO_FONT}`;
      ctx.fillText('@', p.x, p.y - 15);
    }
    ctx.restore();
  }

  function drawHostile(hostile, time) {
    if (!hostile.alive) return;
    const p = project(hostile.x, hostile.y);
    const warning = Math.hypot(player.x - hostile.x, player.y - hostile.y) < 5;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#080b08';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 4, tileW * .2, tileH * .18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = warning ? 'rgba(190,93,66,.72)' : 'rgba(169,108,69,.35)';
    ctx.shadowBlur = warning ? 9 : 5;
    ctx.fillStyle = warning ? '#ce7857' : '#a87050';
    ctx.font = `bold ${Math.max(10, tileW * .34)}px ${MONO_FONT}`;
    const flicker = reducedMotion ? 0 : Math.sin(time * .008 + hostile.x) > .72 ? 1 : 0;
    ctx.fillText(hostile.type === 'scout' ? 'r' : 'm', p.x + flicker, p.y - 11);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#82775e';
    ctx.font = `${Math.max(9, tileW * .26)}px ${MONO_FONT}`;
    ctx.fillText(hostile.type === 'scout' ? '<|>' : '/#\\', p.x, p.y - 3);
    ctx.fillStyle = '#5e6255';
    ctx.fillText('/ \\', p.x, p.y + 3);
    if (warning && !reducedMotion) {
      ctx.globalAlpha = .55;
      ctx.fillStyle = '#d77b59';
      ctx.font = `${Math.max(7, tileW * .18)}px ${MONO_FONT}`;
      ctx.fillText('!', p.x, p.y - 24);
    }
    ctx.restore();
  }

  function drawShot() {
    if (!shot || performance.now() > shot.until) return;
    const from = project(shot.x, shot.y);
    const to = project(shot.targetX, shot.targetY);
    ctx.save();
    ctx.globalAlpha = .72;
    ctx.strokeStyle = '#d9c06f';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#d9c06f';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y - 9);
    ctx.lineTo(to.x, to.y - 9);
    ctx.stroke();
    ctx.fillStyle = '#e9d28b';
    ctx.font = `bold 13px ${MONO_FONT}`;
    ctx.fillText('*', to.x, to.y - 9);
    ctx.restore();
  }
  let shot = null;

  function drawWorld(now) {
    const time = reducedMotion ? 0 : now;
    drawBackground(time);
    const visibleCells = [];
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) visibleCells.push({ x, y, depth: x + y });
    }
    visibleCells.sort((a, b) => a.depth - b.depth || a.x - b.x);
    const propMap = new Map(props.map((prop) => [cellKey(prop.x, prop.y), prop]));
    const cacheMap = new Map(caches.filter((cache) => !cache.found).map((cache) => [cellKey(cache.x, cache.y), cache]));
    for (const cell of visibleCells) {
      tileGround(cell.x, cell.y, time);
      const key = cellKey(cell.x, cell.y);
      const prop = propMap.get(key);
      const cache = cacheMap.get(key);
      if (prop) drawProp(prop, time);
      if (cache) drawCache(cache, time);
      if (relay.x === cell.x && relay.y === cell.y) drawRelay(time);
      for (const hostile of hostiles) {
        if (hostile.x === cell.x && hostile.y === cell.y) drawHostile(hostile, time);
      }
      if (Math.round(player.x) === cell.x && Math.round(player.y) === cell.y) drawPlayer(now, time);
    }
    drawShot();
    drawRadarSweep(time);
  }

  function drawRadarSweep(time) {
    const p = project(relay.x, relay.y);
    ctx.save();
    ctx.globalAlpha = relay.active ? .12 : .055;
    ctx.strokeStyle = relay.active ? '#e3c36d' : '#83b19a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const phase = reducedMotion ? 1.8 : (time * .0006) % (Math.PI * 2);
    ctx.arc(p.x, p.y - 17, 52, phase, phase + .55);
    ctx.stroke();
    ctx.restore();
  }

  function movePlayer(dx, dy, now = performance.now()) {
    if (runState !== 'playing' || gamePaused || mapOpen || now - moveAt < 118) return;
    const nx = player.x + dx;
    const ny = player.y + dy;
    player.dx = dx;
    player.dy = dy;
    if (isBlocked(nx, ny)) {
      moveAt = now - 65;
      return;
    }
    player.fromX = player.x;
    player.fromY = player.y;
    player.x = nx;
    player.y = ny;
    player.moveStarted = now;
    moveAt = now;
    updateLocation();
  }

  function handleMovement(now) {
    if (now - moveAt < 132) return;
    const order = input.last ? [input.last, ...input.keys] : [...input.keys];
    const used = new Set();
    for (const key of order) {
      if (used.has(key)) continue;
      used.add(key);
      const vector = keyMap[key];
      if (vector) {
        movePlayer(vector[0], vector[1], now);
        break;
      }
    }
  }

  function closestCache() {
    return caches.filter((cache) => !cache.found)
      .map((cache) => ({ cache, distance: Math.hypot(cache.x - player.x, cache.y - player.y) }))
      .sort((a, b) => a.distance - b.distance)[0];
  }

  function nearbyAction() {
    const candidate = closestCache();
    if (candidate && candidate.distance < 1.55) return { type: 'cache', item: candidate.cache, distance: candidate.distance };
    const relayDistance = Math.hypot(relay.x - player.x, relay.y - player.y);
    if (relayDistance < 1.8) return { type: 'relay', distance: relayDistance };
    const hostile = hostiles.find((enemy) => enemy.alive && Math.hypot(enemy.x - player.x, enemy.y - player.y) < 1.65);
    if (hostile) return { type: 'hostile', item: hostile };
    return null;
  }

  function updatePrompt() {
    const prompt = document.getElementById('interaction-prompt');
    const label = document.getElementById('interaction-text');
    const action = nearbyAction();
    if (!action || gamePaused || mapOpen || runState !== 'playing') {
      prompt.hidden = true;
      return;
    }
    prompt.hidden = false;
    if (action.type === 'cache') label.textContent = 'SEARCH ' + action.item.name;
    else if (action.type === 'relay') label.textContent = player.capacitors >= 3 ? 'RESTART THE RELAY' : `RELAY NEEDS ${3 - player.capacitors} MORE CAPACITOR${player.capacitors === 2 ? '' : 'S'}`;
    else label.textContent = 'TOO CLOSE — PULSE ' + action.item.name;
    const pos = project(player.x, player.y);
    prompt.style.left = `${Math.max(70, Math.min(width - 70, pos.x))}px`;
    prompt.style.top = `${Math.max(100, Math.min(height - 180, pos.y - 45))}px`;
  }

  function interact() {
    if (runState !== 'playing' || gamePaused || mapOpen) return;
    const action = nearbyAction();
    if (!action) {
      showToast('Nothing close enough to search. Keep moving.');
      return;
    }
    if (action.type === 'cache') {
      const cache = action.item;
      cache.found = true;
      player.capacitors += 1;
      player.scrap += 7 + Math.floor(hash(cache.x, cache.y, 9) * 9);
      player.ammo = Math.min(12, player.ammo + 2);
      showToast(cache.text);
      document.getElementById('field-note').textContent = `${cache.name}: ${cache.text.split('.')[0]}.`;
      if (player.capacitors === 3) showToast('Three capacitors. The relay is waiting up at the tower.');
      updateUI();
      return;
    }
    if (action.type === 'relay') {
      if (player.capacitors < 3) {
        showToast(`The coupler is cold. ${3 - player.capacitors} capacitor${player.capacitors === 2 ? 's are' : ' is'} still missing.`);
        return;
      }
      relay.active = true;
      runState = 'won';
      showModal('SIGNAL RESTORED', 'The tower catches the dawn and throws it back across the flats. Somewhere, a receiver answers.', 'RUN COMPLETE', 'START A NEW RUN');
      document.getElementById('field-note').textContent = 'The relay is broadcasting again. For a moment, the whole dead world answers.';
      document.querySelector('[data-objective="relay"]').classList.add('done');
      updateUI();
      return;
    }
    showToast('Too close to talk. Give the pulse caster a little room.');
  }

  function fire() {
    const now = performance.now();
    if (runState !== 'playing' || gamePaused || mapOpen || now < attackReadyAt) return;
    if (player.ammo <= 0) {
      showToast('No pulse cells. Search a cache.');
      return;
    }
    attackReadyAt = now + 380;
    player.ammo -= 1;
    const facingLength = Math.max(.01, Math.hypot(player.dx, player.dy));
    const nearest = hostiles.filter((enemy) => enemy.alive)
      .map((enemy) => {
        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        const distance = Math.hypot(dx, dy);
        const dot = (dx * player.dx + dy * player.dy) / (Math.max(.01, distance) * facingLength);
        return { enemy, distance, dot };
      })
      .filter((entry) => entry.distance <= 5.4 && entry.dot > -.35)
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest) {
      nearest.enemy.alive = false;
      shot = { x: player.x, y: player.y, targetX: nearest.enemy.x, targetY: nearest.enemy.y, until: now + 150 };
      player.scrap += 4;
      document.getElementById('field-note').textContent = `${nearest.enemy.name} is down. The quiet returns, briefly.`;
      showToast(`${nearest.enemy.name} neutralized. Four pieces of salvage recovered.`);
    } else {
      const targetX = player.x + player.dx * 3;
      const targetY = player.y + player.dy * 3;
      shot = { x: player.x, y: player.y, targetX, targetY, until: now + 120 };
      showToast('Pulse fired into the dust. Stay sharp.');
    }
    updateUI();
  }

  function updateHostiles(now) {
    if (now - enemyAt < 460) return;
    enemyAt = now;
    for (const enemy of hostiles) {
      if (!enemy.alive) continue;
      const distance = Math.hypot(player.x - enemy.x, player.y - enemy.y);
      if (distance < 1.35 && now - lastDamageAt > 1300) {
        player.health -= 1;
        lastDamageAt = now;
        hitFlash = now + 190;
        showToast('A raider got through. Watch your flank.');
        updateUI();
        if (player.health <= 0) {
          runState = 'lost';
          showModal('RUN ENDED', 'The flats go quiet again. Your signal fades into the dust.', 'FIELD LOST', 'TRY AGAIN');
          break;
        }
      } else if (distance < 7 && distance > 1.35 && now - enemy.lastMove > 1100) {
        const options = [
          { x: Math.sign(player.x - enemy.x), y: 0 },
          { x: 0, y: Math.sign(player.y - enemy.y) },
        ].sort((a, b) => Math.hypot(player.x - (enemy.x + a.x), player.y - (enemy.y + a.y)) - Math.hypot(player.x - (enemy.x + b.x), player.y - (enemy.y + b.y)));
        for (const step of options) {
          const nx = enemy.x + step.x;
          const ny = enemy.y + step.y;
          if ((!isBlocked(nx, ny)) && !(nx === player.x && ny === player.y) && !hostiles.some((other) => other !== enemy && other.alive && other.x === nx && other.y === ny)) {
            enemy.x = nx;
            enemy.y = ny;
            enemy.lastMove = now;
            break;
          }
        }
      }
    }
  }

  function updateLocation() {
    let name = 'SALT FLATS';
    if (player.x < 10 && player.y > 12) name = 'OLD CULVERT';
    else if (player.x > 21 && player.y < 10) name = 'RELAY TOWER';
    else if (player.y < 9) name = 'STATIC RIDGE';
    else if (player.x > 14 && player.y > 14) name = 'GLASS MARSH';
    else if (player.x > 10 && player.x < 21) name = 'BROKEN CAUSEWAY';
    document.getElementById('location-name').textContent = name;
    document.getElementById('location-coords').textContent = `X ${String(player.x + 1).padStart(2, '0')} · Y ${String(player.y + 1).padStart(2, '0')}`;
  }

  function updateUI() {
    const pips = document.getElementById('health-pips');
    pips.replaceChildren();
    for (let i = 0; i < 3; i += 1) {
      const pip = document.createElement('span');
      pip.className = `health-pip${i >= player.health ? ' empty' : ''}`;
      pips.append(pip);
    }
    pips.setAttribute('aria-label', `${player.health} health`);
    document.getElementById('ammo-count').textContent = String(player.ammo).padStart(2, '0');
    document.getElementById('scrap-count').textContent = String(player.scrap).padStart(2, '0');
    document.getElementById('capacitor-count').textContent = `${player.capacitors} / 3`;
    document.getElementById('inventory-count').textContent = String(1 + player.capacitors).padStart(2, '0');
    document.getElementById('weapon-state').textContent = player.ammo ? 'READY' : 'EMPTY';
    for (let i = 0; i < 3; i += 1) {
      const objective = document.querySelector(`[data-objective="${i}"]`);
      objective.classList.toggle('done', i < player.capacitors);
      objective.classList.toggle('current', i === player.capacitors && player.capacitors < 3);
    }
    const relayObjective = document.querySelector('[data-objective="relay"]');
    relayObjective.classList.toggle('ready', player.capacitors === 3);
    relayObjective.classList.toggle('done', relay.active);
    drawMiniMap();
  }

  function drawMiniMap() {
    const mw = mini.width;
    const mh = mini.height;
    mctx.clearRect(0, 0, mw, mh);
    mctx.fillStyle = '#080d0b';
    mctx.fillRect(0, 0, mw, mh);
    const cell = Math.min((mw - 24) / W, (mh - 24) / H);
    const left = (mw - W * cell) / 2;
    const top = (mh - H * cell) / 2;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        mctx.fillStyle = isWater(x, y) ? '#163a35' : roadTiles.has(cellKey(x, y)) ? '#45412e' : hash(x, y, 27) > .68 ? '#1c3023' : '#171f1b';
        mctx.fillRect(left + x * cell, top + y * cell, cell - 1, cell - 1);
      }
    }
    for (const cache of caches) {
      if (cache.found) continue;
      mctx.fillStyle = '#90bd9e';
      mctx.fillRect(left + cache.x * cell + cell * .2, top + cache.y * cell + cell * .2, cell * .62, cell * .62);
    }
    for (const hostile of hostiles) {
      if (!hostile.alive) continue;
      mctx.fillStyle = '#c87153';
      mctx.fillRect(left + hostile.x * cell + cell * .18, top + hostile.y * cell + cell * .18, cell * .64, cell * .64);
    }
    mctx.strokeStyle = relay.active ? '#f0d47e' : '#a69b62';
    mctx.lineWidth = 2;
    mctx.strokeRect(left + relay.x * cell + cell * .12, top + relay.y * cell + cell * .12, cell * .76, cell * .76);
    mctx.fillStyle = '#e8c778';
    mctx.beginPath();
    mctx.arc(left + player.x * cell + cell / 2, top + player.y * cell + cell / 2, Math.max(3, cell * .65), 0, Math.PI * 2);
    mctx.fill();
    mctx.shadowColor = '#e8c778';
    mctx.shadowBlur = 7;
    mctx.fill();
    mctx.shadowBlur = 0;
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-text').textContent = message;
    toast.classList.add('visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2800);
  }

  function showModal(stamp, message, buttonText, restartText) {
    gamePaused = true;
    document.getElementById('modal-stamp').textContent = stamp;
    document.getElementById('modal-title').textContent = message.split('.')[0] + (message.includes('.') ? '.' : '');
    document.getElementById('modal-copy').textContent = message;
    document.getElementById('modal-action').innerHTML = `${buttonText} <span>→</span>`;
    document.getElementById('restart-action').textContent = restartText;
    document.getElementById('modal-overlay').hidden = false;
    game.classList.add('paused');
  }

  function hideModal() {
    document.getElementById('modal-overlay').hidden = true;
    gamePaused = false;
    game.classList.remove('paused');
  }

  function restart() {
    player.x = 5; player.y = 17; player.fromX = 5; player.fromY = 17;
    player.health = 3; player.ammo = 12; player.scrap = 0; player.capacitors = 0;
    player.dx = 0; player.dy = -1; player.moveStarted = performance.now();
    caches.forEach((cache) => { cache.found = false; });
    hostiles[0].x = 12; hostiles[0].y = 10; hostiles[0].alive = true; hostiles[0].lastMove = 0;
    hostiles[1].x = 18; hostiles[1].y = 8; hostiles[1].alive = true; hostiles[1].lastMove = 0;
    relay.active = false;
    runState = 'playing';
    gamePaused = false;
    startedAt = performance.now();
    hideModal();
    updateLocation();
    updateUI();
    showToast('Run reset. The tower is still out there.');
    resize();
  }

  function toggleMap(force) {
    mapOpen = typeof force === 'boolean' ? force : !mapOpen;
    document.getElementById('map-overlay').hidden = !mapOpen;
    document.getElementById('map-toggle').classList.toggle('active', mapOpen);
    updatePrompt();
  }

  function togglePause() {
    if (runState !== 'playing' || mapOpen) return;
    if (gamePaused) {
      hideModal();
    } else {
      showModal('FIELD PAUSED', 'The dust settles for a moment.', 'BACK TO THE FLATS', 'RESTART THE RUN');
    }
  }

  function updateClock(now) {
    const minutes = Math.floor((now - startedAt) / 9000);
    const hour = 2 + Math.floor((14 + minutes) / 60);
    const minute = (14 + minutes) % 60;
    document.getElementById('clock').textContent = `${String(hour % 12 || 12).padStart(2, '0')}:${String(minute).padStart(2, '0')} AM`;
  }

  function frame(now) {
    const elapsed = now - lastFrame;
    if (elapsed < 27) {
      requestAnimationFrame(frame);
      return;
    }
    lastFrame = now;
    ticks += 1;
    if (width < 1030) {
      const pos = interpolatePlayer(now);
      const playerScreen = projectRaw(pos.x, pos.y);
      const targetX = width * .5 - playerScreen.x;
      const targetY = height * .47 - playerScreen.y;
      originX += (targetX - originX) * .14;
      originY += (targetY - originY) * .14;
    }
    if (!gamePaused && runState === 'playing') {
      handleMovement(now);
      updateHostiles(now);
      updatePrompt();
      if (ticks % 7 === 0) updateClock(now);
    }
    drawWorld(now);
    requestAnimationFrame(frame);
  }

  function onKeyDown(event) {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const isMove = Object.hasOwn(keyMap, key);
    if (isMove || key === ' ' || key === 'Escape' || key === 'm' || key === 'e' || key === 'Tab') event.preventDefault();
    if (isMove) {
      input.keys.add(key);
      input.last = key;
    }
    if (event.repeat) return;
    if (key === ' ') fire();
    else if (key === 'e' || key === 'Enter') interact();
    else if (key === 'Escape') {
      if (mapOpen) toggleMap(false);
      else togglePause();
    } else if (key === 'm' || key === 'Tab') toggleMap();
  }

  function onKeyUp(event) {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    input.keys.delete(key);
    if (input.last === key) input.last = null;
  }

  function bindTouch() {
    const vectorByDir = { up: 'w', left: 'a', down: 's', right: 'd' };
    document.querySelectorAll('[data-dir]').forEach((button) => {
      const key = vectorByDir[button.dataset.dir];
      const start = (event) => { event.preventDefault(); input.keys.add(key); input.last = key; button.setPointerCapture?.(event.pointerId); };
      const stop = (event) => { event.preventDefault(); input.keys.delete(key); if (input.last === key) input.last = null; };
      button.addEventListener('pointerdown', start);
      button.addEventListener('pointerup', stop);
      button.addEventListener('pointercancel', stop);
      button.addEventListener('lostpointercapture', stop);
    });
    document.getElementById('touch-interact').addEventListener('pointerdown', (event) => { event.preventDefault(); interact(); });
    document.getElementById('touch-pulse').addEventListener('pointerdown', (event) => { event.preventDefault(); fire(); });
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => { input.keys.clear(); input.last = null; });
  window.addEventListener('resize', resize);
  document.getElementById('map-toggle').addEventListener('click', () => toggleMap());
  document.getElementById('map-link').addEventListener('click', () => toggleMap(true));
  document.getElementById('map-close').addEventListener('click', () => toggleMap(false));
  document.getElementById('pause-toggle').addEventListener('click', togglePause);
  document.getElementById('motion-toggle').addEventListener('click', () => {
    reducedMotion = !reducedMotion;
    game.classList.toggle('reduced-motion', reducedMotion);
    document.getElementById('motion-toggle').classList.toggle('active', reducedMotion);
    createDust();
    showToast(reducedMotion ? 'Low-motion mode enabled.' : 'Ambient movement restored.');
  });
  document.getElementById('modal-action').addEventListener('click', () => {
    if (runState === 'playing') hideModal();
    else restart();
  });
  document.getElementById('restart-action').addEventListener('click', restart);
  document.getElementById('map-overlay').addEventListener('click', (event) => {
    if (event.target.id === 'map-overlay') toggleMap(false);
  });
  document.getElementById('modal-overlay').addEventListener('click', (event) => {
    if (event.target.id === 'modal-overlay' && runState === 'playing') hideModal();
  });

  buildWorld();
  bindTouch();
  updateUI();
  updateLocation();
  game.classList.toggle('reduced-motion', reducedMotion);
  document.getElementById('motion-toggle').classList.toggle('active', reducedMotion);
  resize();
  showToast('Signal’s weak. Find the three capacitors.');
  requestAnimationFrame(frame);
})();
