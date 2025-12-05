const canvas = document.getElementById("field");
const ctx = canvas.getContext("2d");

const cols = 15;
const rows = 19;
const spacing = 32;
const margin = 36;
const goalColumns = [6, 7, 8];
const cpuEnabled = true;
const cpuPlayer = 1;

const players = [
  { name: "Czerwony", color: getComputedStyle(document.documentElement).getPropertyValue("--player-a") || "#e54848" },
  { name: "Niebieski", color: getComputedStyle(document.documentElement).getPropertyValue("--player-b") || "#2c6be2" },
];

const statusEls = {
  player: document.getElementById("currentPlayer"),
  ball: document.getElementById("ballPosition"),
  hint: document.getElementById("hint"),
  score: document.getElementById("score"),
};

const controls = {
  reset: document.getElementById("reset"),
  undo: document.getElementById("undo"),
};

let boardSize = {
  width: margin * 2 + (cols - 1) * spacing,
  height: margin * 2 + (rows - 1) * spacing,
};
canvas.width = boardSize.width;
canvas.height = boardSize.height;

let currentPlayer = 0;
let score = [0, 0];
let ball = { x: Math.floor(cols / 2), y: Math.floor(rows / 2) };
let segments = [];
let usedLines = new Set();
let nodeDegree = new Map();
let history = [];

function nodeKey(pt) {
  return `${pt.x},${pt.y}`;
}

function segmentKey(a, b) {
  const first = a.y === b.y ? (a.x < b.x ? a : b) : a.y < b.y ? a : b;
  const second = first === a ? b : a;
  return `${first.x},${first.y}-${second.x},${second.y}`;
}

function cloneState() {
  return {
    currentPlayer,
    score: [...score],
    ball: { ...ball },
    segments: segments.map((s) => ({ a: { ...s.a }, b: { ...s.b }, color: s.color })),
    usedLines: new Set([...usedLines]),
    nodeDegree: new Map(nodeDegree),
  };
}

function restoreState(snapshot) {
  currentPlayer = snapshot.currentPlayer;
  score = [...snapshot.score];
  ball = { ...snapshot.ball };
  segments = snapshot.segments.map((s) => ({ a: { ...s.a }, b: { ...s.b }, color: s.color }));
  usedLines = new Set([...snapshot.usedLines]);
  nodeDegree = new Map(snapshot.nodeDegree);
  updateUi();
  draw();
}

function pushHistory() {
  history.push(cloneState());
}

function resetBoard(startingPlayer = 0) {
  currentPlayer = startingPlayer;
  ball = { x: Math.floor(cols / 2), y: Math.floor(rows / 2) };
  segments = [];
  usedLines = new Set();
  nodeDegree = new Map();
  history = [];
  pushHistory();
  announce(`Nowa runda – rusza ${players[currentPlayer].name}`);
  updateUi();
  draw();
}

function announce(message) {
  statusEls.hint.textContent = message || "";
}

function togglePlayer() {
  currentPlayer = (currentPlayer + 1) % players.length;
}

function isInsideBoard(x, y) {
  return x >= 0 && x < cols && y >= 0 && y < rows;
}

function isGoal(position) {
  if (goalColumns.includes(position.x) && position.y === 0) {
    return 1; // niebieski strzela w gore
  }
  if (goalColumns.includes(position.x) && position.y === rows - 1) {
    return 0; // czerwony strzela w dol
  }
  return null;
}

function isEdge(position) {
  if (isGoal(position)) return false;
  return (
    position.x === 0 ||
    position.x === cols - 1 ||
    position.y === 0 ||
    position.y === rows - 1
  );
}

function addSegment(start, end, color) {
  const key = segmentKey(start, end);
  usedLines.add(key);
  segments.push({ a: { ...start }, b: { ...end }, color });

  const aKey = nodeKey(start);
  const bKey = nodeKey(end);
  nodeDegree.set(aKey, (nodeDegree.get(aKey) || 0) + 1);
  nodeDegree.set(bKey, (nodeDegree.get(bKey) || 0) + 1);
}

function lineExists(start, end) {
  return usedLines.has(segmentKey(start, end));
}

function availableMoves(from) {
  const moves = [];
  const directions = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: 1 },
    { dx: -1, dy: -1 },
  ];

  directions.forEach(({ dx, dy }) => {
    const nx = from.x + dx;
    const ny = from.y + dy;
    if (!isInsideBoard(nx, ny)) return;
    const target = { x: nx, y: ny };
    if (isEdge(from)) {
      const inwardFromEdge =
        (from.x === 0 && dx === 1 && dy === 0) ||
        (from.x === cols - 1 && dx === -1 && dy === 0) ||
        (from.y === 0 && dy === 1 && dx === 0) ||
        (from.y === rows - 1 && dy === -1 && dx === 0);
      if (!inwardFromEdge && (dx === 0 || dy === 0)) return;
    }
    if (lineExists(from, target)) return;
    moves.push(target);
  });

  return moves;
}

function maybeFinishRound(target) {
  const goalOwner = isGoal(target);
  if (goalOwner === null) return false;
  score[goalOwner] += 1;
  announce(`${players[goalOwner].name} zdobywa bramkę!`);
  updateUi();
  setTimeout(() => resetBoard(goalOwner), 500);
  return true;
}

function willBounce(target, existingDegree = nodeDegree.get(nodeKey(target)) || 0) {
  return isEdge(target) || existingDegree > 0;
}

function handleBounce(target, bounced = willBounce(target)) {
  if (bounced) {
    announce("Odbicie – grasz ponownie");
    return true;
  }
  togglePlayer();
  return false;
}

function checkForBlock() {
  const moves = availableMoves(ball);
  if (moves.length > 0) return;
  const loser = currentPlayer;
  const winner = (currentPlayer + 1) % players.length;
  score[winner] += 1;
  announce(`${players[loser].name} utknął. Punkt dla ${players[winner].name}.`);
  updateUi();
  setTimeout(() => resetBoard(winner), 500);
}

function resolveTargetFromClick(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;

  const moves = availableMoves(ball);
  const withDistance = moves.map((m) => {
    const canvasPos = toCanvas(m);
    const dx = canvasPos.x - x;
    const dy = canvasPos.y - y;
    return { move: m, distance: Math.sqrt(dx * dx + dy * dy) };
  });

  const nearest = withDistance.reduce(
    (best, item) => (item.distance < best.distance ? item : best),
    { distance: Infinity, move: null }
  );

  if (!nearest.move) return null;
  const clickTolerance = spacing / 3;
  if (nearest.distance > clickTolerance) return null;
  return nearest.move;
}

function playMove(target) {
  const bounced = willBounce(target);
  pushHistory();
  addSegment(ball, target, players[currentPlayer].color);
  ball = target;
  updateUi();
  if (maybeFinishRound(target)) {
    draw();
    return true;
  }
  handleBounce(target, bounced);
  draw();
  checkForBlock();
  return false;
}

function handleClick(event) {
  const target = resolveTargetFromClick(event);
  if (!target) return;
  const finished = playMove(target);
  if (!finished) {
    maybePlayCpuTurn();
  }
}

function evaluateCpuMove(target) {
  const goalY = currentPlayer === 0 ? rows - 1 : 0;
  const goalCenterX = goalColumns[Math.floor(goalColumns.length / 2)];
  const distanceY = Math.abs(goalY - target.y);
  const distanceX = Math.abs(goalCenterX - target.x);
  const bounceBonus = willBounce(target) ? -0.5 : 0;
  return distanceY + distanceX * 0.2 + bounceBonus;
}

function chooseCpuMove() {
  const moves = availableMoves(ball);
  if (moves.length === 0) return null;
  return moves.reduce((best, move) => {
    const score = evaluateCpuMove(move);
    if (!best || score < best.score) {
      return { move, score };
    }
    return best;
  }, null).move;
}

function maybePlayCpuTurn() {
  if (!cpuEnabled || currentPlayer !== cpuPlayer) return;

  let guard = 0;
  while (cpuEnabled && currentPlayer === cpuPlayer && guard < 50) {
    guard += 1;
    const move = chooseCpuMove();
    if (!move) {
      checkForBlock();
      return;
    }
    const finished = playMove(move);
    if (finished) return;
  }
}

function drawGrid() {
  ctx.save();
  ctx.fillStyle = "var(--field-bg)";
  ctx.fillRect(0, 0, boardSize.width, boardSize.height);

  // cele
  const goalWidth = spacing * goalColumns.length;
  const goalStartX = margin + goalColumns[0] * spacing - spacing / 2;
  ctx.fillStyle = "var(--goal-top)";
  ctx.fillRect(goalStartX, margin - spacing, goalWidth, spacing);
  ctx.fillStyle = "var(--goal-bottom)";
  ctx.fillRect(goalStartX, boardSize.height - margin, goalWidth, spacing);

  // podkreślenie bramek od strony ramki w kolorach graczy
  const goalEndX = goalStartX + goalWidth;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";

  // górna bramka (Niebieski)
  ctx.strokeStyle = players[1].color;
  ctx.beginPath();
  ctx.moveTo(goalStartX, margin - spacing + ctx.lineWidth / 2);
  ctx.lineTo(goalEndX, margin - spacing + ctx.lineWidth / 2);
  ctx.stroke();

  // dolna bramka (Czerwony)
  ctx.strokeStyle = players[0].color;
  ctx.beginPath();
  ctx.moveTo(goalStartX, boardSize.height - margin + spacing - ctx.lineWidth / 2);
  ctx.lineTo(goalEndX, boardSize.height - margin + spacing - ctx.lineWidth / 2);
  ctx.stroke();

  ctx.strokeStyle = "var(--grid-line)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 6]);
  for (let x = 0; x < cols; x++) {
    const cx = margin + x * spacing;
    ctx.beginPath();
    ctx.moveTo(cx, margin);
    ctx.lineTo(cx, boardSize.height - margin);
    ctx.stroke();
  }
  for (let y = 0; y < rows; y++) {
    const cy = margin + y * spacing;
    ctx.beginPath();
    ctx.moveTo(margin, cy);
    ctx.lineTo(boardSize.width - margin, cy);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawSegments() {
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  segments.forEach((seg) => {
    ctx.strokeStyle = seg.color;
    ctx.beginPath();
    const a = toCanvas(seg.a);
    const b = toCanvas(seg.b);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });
}

function drawNodes() {
  ctx.fillStyle = "#1b2b34";
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const p = toCanvas({ x, y });
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBall() {
  const pos = toCanvas(ball);
  ctx.save();
  const gradient = ctx.createRadialGradient(pos.x - 5, pos.y - 5, 4, pos.x, pos.y, 14);
  gradient.addColorStop(0, "#fff");
  gradient.addColorStop(1, "#d9d9d9");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#333";
  ctx.stroke();

  ctx.fillStyle = players[currentPlayer].color;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAvailableMoves() {
  const moves = availableMoves(ball);
  ctx.save();
  ctx.fillStyle = "#ffb703";
  moves.forEach((m) => {
    const p = toCanvas(m);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function toCanvas(point) {
  return {
    x: margin + point.x * spacing,
    y: margin + point.y * spacing,
  };
}

function draw() {
  drawGrid();
  drawSegments();
  drawAvailableMoves();
  drawNodes();
  drawBall();
}

function updateUi() {
  statusEls.player.textContent = players[currentPlayer].name;
  statusEls.player.style.color = players[currentPlayer].color;
  statusEls.ball.textContent = `${ball.x}, ${ball.y}`;
  statusEls.score.textContent = `${score[0]} : ${score[1]}`;
}

controls.reset.addEventListener("click", () => resetBoard(0));
controls.undo.addEventListener("click", () => {
  if (history.length <= 1) return;
  history.pop();
  const last = history[history.length - 1];
  restoreState(last);
  announce("Cofnięto ruch");
});

canvas.addEventListener("click", handleClick);

resetBoard(0);
