
const prizeWeights = {
    '杯套': 5,
    '吊飾 (骰子款)': 5, '吊飾 (棋子款)': 5,
    'L夾': 15,
    '貼紙 (骰子款)': 20, '貼紙 (棋子款)': 20,
    '再來一次': 10, '謝謝惠顧': 10
};

let currentInventory = {
    '杯套': 20, '吊飾 (骰子款)': 10, '吊飾 (棋子款)': 10,
    'L夾': 20, '貼紙 (骰子款)': 10, '貼紙 (棋子款)': 10
};

const prizePool = [
    '杯套',                      
    '吊飾 (骰子款)',              
    '吊飾 (棋子款)',              
    'L夾', 'L夾', 
    '貼紙 (骰子款)', '貼紙 (骰子款)', 
    '貼紙 (棋子款)', '貼紙 (棋子款)', 
    '再來一次',                  
    '謝謝惠顧'                   
];

const singleSlotItems = ['杯套', '吊飾 (骰子款)', '吊飾 (棋子款)', '再來一次', '謝謝惠顧'];

let currentBoardLayout = [];
let playerPosition = 0; 
let isMoving = false;
const gridSize = 85;

const cellCoordinates = [];
for (let x = 0; x <= 3; x++) cellCoordinates.push({ x: x * gridSize, y: 0 }); // 上
for (let y = 1; y <= 2; y++) cellCoordinates.push({ x: 3 * gridSize, y: y * gridSize }); // 右
for (let x = 3; x >= 0; x--) cellCoordinates.push({ x: x * gridSize, y: 3 * gridSize }); // 下
for (let y = 2; y >= 1; y--) cellCoordinates.push({ x: 0, y: y * gridSize }); // 左

const sceneEl = document.getElementById('scene-container');
const boardEl = document.getElementById('monopoly-board');
const flagEl = document.getElementById('player-flag');
const diceContainerEl = document.getElementById('dice-container');
const diceEls = document.querySelectorAll('.die');
const prizeModalEl = document.getElementById('prize-modal'); 
const inventoryToggleBtn = document.getElementById('inventory-toggle-btn');
const inventoryPanelEl = document.getElementById('inventory-modal-overlay');


function shuffleWithConstraints() {
    let result = new Array(12).fill(null);
    result[0] = "起點";

    let safeItems = prizePool.filter(item => !singleSlotItems.includes(item));
    let idx1 = Math.floor(Math.random() * safeItems.length);
    result[1] = safeItems.splice(idx1, 1)[0];

    let remainingPool = [...prizePool];
    remainingPool.splice(remainingPool.indexOf(result[1]), 1);

    for (let i = remainingPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remainingPool[i], remainingPool[j]] = [remainingPool[j], remainingPool[i]];
    }

    for (let i = 2; i < 12; i++) result[i] = remainingPool.pop();
    return result;
}

function renderBoard() {
    boardEl.querySelectorAll('.square').forEach(sq => sq.remove());
    currentBoardLayout.forEach((name, index) => {
        const sq = document.createElement('div');
        sq.className = `square ${index === 0 ? 'start-node' : ''}`;
        sq.style.left = `${cellCoordinates[index].x}px`;
        sq.style.top = `${cellCoordinates[index].y}px`;
        sq.textContent = name;
        boardEl.appendChild(sq);
    });
}

inventoryToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    inventoryPanelEl.classList.remove('hidden');
});


inventoryPanelEl.addEventListener('click', (e) => {
    if (e.target === inventoryPanelEl) {
        inventoryPanelEl.classList.add('hidden');
    }
});


function updateInventoryDisplay() {
    const inventoryListEl = document.getElementById('inventory-list');
    inventoryListEl.innerHTML = '';
    
    for (const [name, count] of Object.entries(currentInventory)) {
        const li = document.createElement('li');
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'item-name';
        nameSpan.textContent = name;

        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'item-controls';

        const minusBtn = document.createElement('button');
        minusBtn.className = 'ctrl-btn';
        minusBtn.textContent = '-';
        minusBtn.disabled = count <= 0;
        minusBtn.onclick = () => {
            if (currentInventory[name] > 0) {
                currentInventory[name]--;
                updateInventoryDisplay();
            }
        };

        const countSpan = document.createElement('span');
        countSpan.className = 'item-count';
        countSpan.textContent = count;

        const plusBtn = document.createElement('button');
        plusBtn.className = 'ctrl-btn';
        plusBtn.textContent = '+';
        plusBtn.onclick = () => {
            currentInventory[name]++;
            updateInventoryDisplay();
        };

        controlsDiv.appendChild(minusBtn);
        controlsDiv.appendChild(countSpan);
        controlsDiv.appendChild(plusBtn);
        li.appendChild(nameSpan);
        li.appendChild(controlsDiv);
        
        inventoryListEl.appendChild(li);
    }
}

function initGame() {
    currentBoardLayout = shuffleWithConstraints();
    renderBoard();
    updateInventoryDisplay();
    moveFlag(0, true);
}

function updateCameraFollow(targetX, targetY) {
    const viewW = document.getElementById('game-viewport').clientWidth;
    const viewH = document.getElementById('game-viewport').clientHeight;
    const padding = 60; 
    const boundX = (viewW / 2) - padding;
    const boundY = (viewH / 2) - padding;

    const flagX = targetX - (2 * gridSize) + (gridSize / 2);
    const flagY = targetY - (2 * gridSize) + (gridSize / 2);

    const scale = 1.2;
    const cos45 = 0.7071, cos60 = 0.5;
    const screenX = scale * (flagX * cos45 + flagY * cos45); 
    const screenY = scale * cos60 * (flagY * cos45 - flagX * cos45); 

    let shiftX = 0, shiftY = 0;
    if (screenX > boundX) shiftX = boundX - screenX;
    else if (screenX < -boundX) shiftX = -boundX - screenX;
    if (screenY > boundY) shiftY = boundY - screenY;
    else if (screenY < -boundY) shiftY = -boundY - screenY;

    let cx = 0, cy = 0;
    if (shiftX !== 0 || shiftY !== 0) {
        const u = shiftX / (scale * cos45); 
        const v = shiftY / (scale * cos60 * cos45); 
        cy = (u + v) / 2; cx = (u - v) / 2;
    }
    sceneEl.style.transform = `scale(${scale}) rotateX(60deg) rotateZ(-45deg) translate(${cx}px, ${cy}px)`;
}

function moveFlag(cellIndex, instant = false) {
    playerPosition = cellIndex % 12;
    const { x, y } = cellCoordinates[playerPosition];
    flagEl.style.transition = instant ? 'none' : 'left 0.4s ease-out, top 0.4s ease-out';
    flagEl.style.left = `${x}px`;
    flagEl.style.top = `${y}px`;
    updateCameraFollow(x, y);
}

function drawPrize() {
    let pool = [];
    for (const [p, w] of Object.entries(prizeWeights)) {
        if (currentInventory[p] === 0) continue;
        for (let i = 0; i < w; i++) pool.push(p);
    }
    if (pool.length === 0) return '謝謝惠顧';
    return pool[Math.floor(Math.random() * pool.length)];
}

function getValidTargetAndSteps() {
    let maxAttempts = 50; 
    while(maxAttempts-- > 0) {
        const prize = drawPrize();
        let possibleIndices = [];
        currentBoardLayout.forEach((p, i) => { if(p === prize) possibleIndices.push(i); });
        
        let targetIdx = possibleIndices[Math.floor(Math.random() * possibleIndices.length)];
        let s = (targetIdx - playerPosition + 12) % 12;
        if (s === 0) s = 12; 
        
        if (s > 1 && s <= 12) {
            return { finalPrize: prize, steps: s };
        }
    }
    for (let i = 0; i < 12; i++) {
        let s = (i - playerPosition + 12) % 12;
        if (s > 1 && s <= 12) return { finalPrize: currentBoardLayout[i], steps: s === 0 ? 12 : s };
    }
}

diceContainerEl.addEventListener('click', () => {
    if (isMoving) return;
    isMoving = true;
    
    diceEls.forEach(el => el.classList.add('rolling'));
    
    const { finalPrize, steps } = getValidTargetAndSteps();
    
    const d = [1, 1]; 
    let rem = steps - 2; 
    while(rem > 0) { 
        let r = Math.floor(Math.random() * 2); 
        if(d[r] < 6) { d[r]++; rem--; } 
    }

    setTimeout(() => {
        diceEls.forEach((el, i) => { el.classList.remove('rolling'); el.textContent = d[i]; });
        
        let cur = 0;
        let intv = setInterval(() => {
            moveFlag(playerPosition + 1); cur++;
            
            if(cur === steps) {
                clearInterval(intv);
                
                if(currentInventory[finalPrize] !== undefined && currentInventory[finalPrize] > 0) {
                    currentInventory[finalPrize]--;
                }
                updateInventoryDisplay(); 
                
                let modalTitle = "恭喜中獎！";
                let modalMsg = `獲得 ${finalPrize}`;
                
                if (finalPrize === '再來一次') {
                    modalTitle = "運氣真好！"; modalMsg = "再來一次";
                } else if (finalPrize === '謝謝惠顧') {
                    modalTitle = "再接再厲！"; modalMsg = "謝謝惠顧";
                }
                
                document.getElementById('modal-title').textContent = modalTitle;
                document.getElementById('modal-message').innerHTML = modalMsg;
                
                setTimeout(() => {
                    prizeModalEl.classList.remove('hidden');
                    isMoving = false;
                }, 400); 
            }
        }, 400);
    }, 800);
});

const restartBtn = document.getElementById('modal-restart-btn');
if (restartBtn) {
    restartBtn.addEventListener('click', () => {
        prizeModalEl.classList.add('hidden');
        initGame();
        diceEls.forEach(el => el.textContent = '1');
    });
}

window.addEventListener('resize', () => moveFlag(playerPosition, true));

initGame();

document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        
        if (!prizeModalEl.classList.contains('hidden')) {
            const restartBtn = document.getElementById('modal-restart-btn');
            if (restartBtn) restartBtn.click();
        } else {
            if (!isMoving) {
                diceContainerEl.click();
            }
        }
    }
});
