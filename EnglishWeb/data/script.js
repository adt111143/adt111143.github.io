const GAS_URL = 'https://script.google.com/a/macros/gm.ntcu.edu.tw/s/AKfycbxJoy_qSjMY5e1I26ZbJmkSY_Fz42Jdq4k54GURWX7-25cGdTmFlh9r9hU895M_j1zM/exec';

async function gasFetch(action, payload = {}, signal = null) {
    const options = {
        method: 'POST',
        body: JSON.stringify({ action: action, ...payload })
    };
    if (signal) options.signal = signal;
    
    const response = await fetch(GAS_URL, options);
    return await response.json();
}

let activePreloadPromise = null;
let historyData = [];
let filteredData = []; 
let currentViewedWord = null; 
let currentFilterValue = 'all';

let lockedPrevWord = null;
let lockedNextWord = null;
let lockedDisplayIndex = 0;
let lockedDisplayTotal = 0;

let wordDetailsCache = {};
let cacheQueue = [];           
const MAX_CACHE_SIZE = 60;     
const ITEM_HEIGHT = 54;   
const VISIBLE_COUNT = 15; 

const pendingRequests = {
    sentences: new Set(),
    forms: new Set()
};

let currentSortMode = 'alpha'; 
const statusWeight = { 'new': 1, 'learning': 2, 'mastered': 3 };

let currentAudioSession = 0;
let currentDetailFetchController = null;

const delay = ms => new Promise(res => setTimeout(res, ms));

function playAudioAsync(text, isFromLoop = false, forcedVoice = null) { 
    return new Promise(resolve => {
        playAudio(text, resolve, isFromLoop, forcedVoice); 
    });
}

let confirmCallback = null; 
let timerInterval = null;

async function initLocksFromServer() {
    try {
        const data = await gasFetch('getLocks');
        if (data && Array.isArray(data.locks)) {
            appSettings.lockedLevels = data.locks;
            localStorage.setItem('appSettings', JSON.stringify(appSettings));
        }
    } catch (e) {
        console.error("Fetch locks failed", e);
    }
}

function saveLocksToDB() {
    gasFetch('saveLocks', { locks: appSettings.lockedLevels || [] }).catch(e => console.error("Save locks failed", e));
}

window.onload = () => {
    goToDashboard();
    renderDashboard();

    const topStats = ['countTotal', 'countNew', 'countLearning', 'countMastered'];
    topStats.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = '...';
    });

    document.querySelectorAll('.lvl-total').forEach(el => {
        el.innerText = '...';
    });

    document.querySelectorAll('.lvl-det-item').forEach(el => {
        const dot = el.querySelector('.dot-sm');
        el.innerHTML = ''; 
        if (dot) el.appendChild(dot); 
        el.appendChild(document.createTextNode('...')); 
    });

    Promise.all([
        initLocksFromServer(), 
        gasFetch('getSummary')
    ]).then(([_, rawSummary]) => {
        if (rawSummary && rawSummary.error) {
            console.error("後端 API 回傳錯誤:", rawSummary.error);
            return;
        }
        if (Array.isArray(rawSummary)) {
            historyData = rawSummary; 
            applySort();       
            filterHistory();
            renderDashboard(); 
        }
    }).catch(err => console.error("初始化資料失敗:", err));

    initCustomSelect();
    updateSelectLockUI();
    initAccentSelect();
    initPersonSelect();
    syncTimer();
    initGlobalFocus();
    initKeyboardShortcuts();
    renderPinnedActions();
    initSearchSuggestions();

    document.getElementById('historySearch').addEventListener('input', () => {
        filterHistory();
    });
    document.getElementById('wordInput').addEventListener('keypress', handleEnter);

    document.addEventListener('click', (e) => {
        if (window.innerWidth > 900) return;
        const sidebar = document.getElementById('sidebar');
        const toggleBtn = document.querySelector('.toggle-btn');
        if (sidebar && !sidebar.classList.contains('closed')) {
            if (!sidebar.contains(e.target) && !toggleBtn.contains(e.target)) {
                sidebar.classList.add('closed');
            }
        }
    });

    const alertModal = document.getElementById('alertModal');
    if (alertModal) {
        alertModal.addEventListener('click', (e) => {
            if (e.target.id === 'alertModal') closeAlertModal();
        });
    }
};

function initGlobalFocus() {
    document.addEventListener('keydown', (e) => {
        if (document.querySelector('.modal-overlay.active')) return;
        const active = document.activeElement;
        if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable) {
            return;
        }

        if (e.ctrlKey || e.altKey || e.metaKey) return;

        if (e.key.length === 1) {
            const mainInput = document.getElementById('wordInput');
            if (mainInput) {
                mainInput.focus();
            }
        }
    });
}

function initCustomSelect() {
    const wrapper = document.querySelector('.custom-select-wrapper');
    const trigger = wrapper.querySelector('.custom-select-trigger');
    const options = wrapper.querySelectorAll('.custom-option');
    const currentText = document.getElementById('currentSelectText');

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        wrapper.classList.toggle('open');
    });

    options.forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            options.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            
            const value = option.getAttribute('data-value');
            const text = option.textContent;
            
            currentText.textContent = text;
            currentFilterValue = value; 
            wrapper.classList.remove('open');
            
            updateSortButtonsVisibility(value);
            updateSelectLockUI();
            filterHistory();
            
            const cardArea = document.getElementById('cardArea');
            const isCardViewActive = cardArea && cardArea.style.display !== 'none';

            if (filteredData.length > 0) {
                const stillExists = currentViewedWord && filteredData.some(item => item.word === currentViewedWord);

                if (isCardViewActive && stillExists) {
                    recalculateNavigationLock();
                    updateCurrentIndexDisplay(currentViewedWord);
                    if (typeof updateCardNavigation === 'function') updateCardNavigation(currentViewedWord);
                    scrollToActiveItem();
                } else {
                    clickHistoryItem(filteredData[0].word);
                }
            } else {
                goToDashboard();
            }
        });
    });

    window.addEventListener('click', () => {
        if (wrapper.classList.contains('open')) wrapper.classList.remove('open');
    });
}

function updateSortButtonsVisibility(filterValue) {
    const btnAlpha = document.querySelector('.sort-btn[data-sort="alpha"]');
    const btnStatus = document.querySelector('.sort-btn[data-sort="status"]');
    const btnLevel = document.querySelector('.sort-btn[data-sort="level"]');

    btnAlpha.classList.remove('hidden');
    btnStatus.classList.remove('hidden');
    btnLevel.classList.remove('hidden');

    let modeChanged = false;

    if (filterValue === 'all') {
    } 
    else if (filterValue.startsWith('lvl-')) {
        btnLevel.classList.add('hidden');
        if (currentSortMode === 'level') {
            changeSort('alpha'); 
            modeChanged = true;
        }
    } 
    else if (filterValue.startsWith('exam-')) {
    }
    else {
        btnStatus.classList.add('hidden');
        if (currentSortMode === 'status') {
            changeSort('alpha');
            modeChanged = true;
        }
    }

    if (!modeChanged) {
        applySort();
    }
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('closed');
}

function handleEnter(e) { if(e.key === 'Enter') startLookup(); }

function goToDashboard() {
    const dashboard = document.getElementById('dashboard');
    const cardArea = document.getElementById('cardArea');
    const loader = document.getElementById('loader');
    const input = document.getElementById('wordInput');

    if(dashboard) dashboard.style.display = 'block'; 
    if(cardArea) cardArea.style.display = 'none';    
    if(loader) loader.style.display = 'none';

    if(input) input.value = '';

    currentViewedWord = null;
    const activeItems = document.querySelectorAll('.history-item.current-active');
    activeItems.forEach(el => el.classList.remove('current-active'));

    if(window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if(sidebar) sidebar.classList.add('closed');
    }
    
    renderDashboard();
}

function toggleLoading(isLoading, autoFocus = false) {
    const loader = document.getElementById('loader');
    const mask = document.getElementById('pageMask');
    const sidebar = document.getElementById('sidebar');
    const input = document.getElementById('wordInput'); 

    if (isLoading) {
        if (mask) mask.classList.add('active');
        if (loader) loader.style.display = 'flex'; 
        if (sidebar && window.innerWidth <= 900) sidebar.classList.add('closed');
        
        if (input) {
            input.disabled = true; 
            input.blur(); 
        }
    } else {
        if (mask) mask.classList.remove('active');
        if (loader) loader.style.display = 'none';
        
        if (input) {
            input.disabled = false;
            if (autoFocus) {
                input.focus(); 
            }
        }
    }
}

// 查詢單字
async function startLookup(wordToSearch = null, checkHistory = true) {
    const input = document.getElementById('wordInput');
    const word = wordToSearch || input.value.trim();
    if (!word) return;

    const isReadonly = document.body.classList.contains('hide-card-actions');
    const existsInHistory = historyData.some(item => (item.word || '').toLowerCase() === word.toLowerCase());

    if (isReadonly && !existsInHistory) {
        showConfirmModal(
            'This word has not been recorded.', 
            `No history records found for the word.<br>Please enable the "Show Card Actions" button.`, 
            () => {
                input.focus();
                input.select();
            }, 
            false, 
            false
        );
        if (!wordToSearch) input.value = ''; 
        input.blur();                      
        return;                            
    }

    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('cardArea').style.display = 'none';
    
    toggleLoading(true);

    try {
        const data = await gasFetch('lookup', { word: word, checkHistory: checkHistory });
        
        // 🚨 終極攔截：只要後端回報錯誤，絕對不放行給 renderCard
        if (data.error) {
            goToDashboard();
            if (data.error === 'not_found') {
                showConfirmModal(
                    'No such word found.', 
                    `The word could not be found.<br>Please check if the spelling is correct!`, 
                    () => {
                        input.focus();
                        input.select();
                    },
                    false, false
                );
            } else {
                showConfirmModal(
                    '系統處理錯誤', 
                    `伺服器或 AI 發生錯誤：<br>${data.error}`, 
                    () => {
                        input.focus();
                        input.select();
                    },
                    true, false
                );
            }
            return; 
        }

        await loadHistory(); 
        
        wordDetailsCache[data.word] = data;
        manageCacheLRU(data.word);

        renderCard(data);
        if (!wordToSearch) input.value = '';

        setTimeout(() => preloadAdjacentWords(data.word), 500);

        if (!data.tense_sentences || data.tense_sentences.length === 0) {
            regenerateSentences(data.word);
        }

    } catch (err) {
        console.error(err);
        goToDashboard();
        showConfirmModal('系統錯誤', `發生預期外的錯誤：<br>${err.message}`, () => {}, true, false);
    } finally {
        toggleLoading(false, false);
    }
}

function regenerate(word) {
    showConfirmModal(
        'Regenerate Content', 
        `Are you sure you want to regenerate "<strong>${word}</strong>"?<br>The current content will be overwritten.`,
        () => {
            startLookup(word, false);
        },
        false 
    );
}

function showConfirmModal(title, message, onConfirm, isDanger = false, showCancel = true) {
    const modal = document.getElementById('customModal');
    const titleEl = document.getElementById('modalTitle');
    const msgEl = document.getElementById('modalMessage');
    const confirmBtn = document.getElementById('modalConfirmBtn');
    const cancelBtn = modal.querySelector('.cancel');

    titleEl.innerText = title;
    msgEl.innerHTML = message;

    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

    if (isDanger) {
        newBtn.classList.add('danger');
        newBtn.innerText = 'Delete';
    } else {
        newBtn.classList.remove('danger');
        newBtn.innerText = 'Confirm';
    }

    if (cancelBtn) {
        cancelBtn.style.display = showCancel ? 'inline-block' : 'none';
    }

    newBtn.onclick = () => {
        onConfirm();
        closeModal();
    };

    modal.classList.add('active');
}

function showAlertModal(title, message) {
    const modal = document.getElementById('customModal');
    const titleEl = document.getElementById('modalTitle');
    const msgEl = document.getElementById('modalMessage');
    const confirmBtn = document.getElementById('modalConfirmBtn');
    const cancelBtn = modal.querySelector('.modal-btn.cancel');

    titleEl.textContent = title;
    msgEl.innerHTML = message;
    if (cancelBtn) cancelBtn.style.display = 'none';

    confirmBtn.textContent = 'OK';
    confirmBtn.classList.remove('danger'); 
    confirmBtn.onclick = closeModal;
    modal.classList.add('active');
}

function closeModal() {
    const modal = document.getElementById('customModal');
    modal.classList.remove('active');
    confirmCallback = null; 

    const cancelBtn = modal.querySelector('.modal-btn.cancel');
    if (cancelBtn) cancelBtn.style.display = ''; 
}

document.getElementById('customModal').addEventListener('click', (e) => {
    if (e.target.id === 'customModal') closeModal();
});

async function deleteWord(word) {
    showConfirmModal(
        'Delete Word',
        `Are you sure you want to delete "<strong>${word}</strong>"?<br>This action cannot be undone.`,
        async () => {
            try {
                const data = await gasFetch('deleteWord', { word: word });

                if (data.success) {
                    historyData = historyData.filter(item => item.word !== word);
                    delete wordDetailsCache[word]; 
                    
                    filterHistory(); 
                    goToDashboard();
                } else {
                    alert("Delete failed: " + (data.error || "Unknown error"));
                }
            } catch (err) { 
                console.error(err); 
                alert("Error deleting word."); 
            }
        },
        true 
    );
}

function changeSort(mode) {
    currentSortMode = mode;
    
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === mode);
    });

    applySort();
    filterHistory(); 
    
    if (currentViewedWord) {
        recalculateNavigationLock();
        updateCurrentIndexDisplay(currentViewedWord);
        updateCardNavigation(currentViewedWord); 
        setTimeout(() => scrollToActiveItem(), 50);
    }
}

function applySort() {
    historyData.sort((a, b) => {
        const wordA = (a.word || '').toLowerCase();
        const wordB = (b.word || '').toLowerCase();
        
        const statA = (a.stats && a.stats.status) ? statusWeight[a.stats.status] : 0;
        const statB = (b.stats && b.stats.status) ? statusWeight[b.stats.status] : 0;
        
        const lvlA = (a.stats && typeof a.stats.level === 'number') ? a.stats.level : -1;
        const lvlB = (b.stats && typeof b.stats.level === 'number') ? b.stats.level : -1;

        if (currentSortMode === 'level') {
            const getLevelRank = (item, lvl) => {
                const tag = item.exam_tag || 'Level';
                if (tag === 'Level' && lvl >= 0) return lvl; 
                
                const tagRankMap = {
                    'TOEIC': 10, 'IELTS': 11, 'GMAT': 12, 'TOEFL': 13, 'Extra': 14, 'Phrase': 15
                };
                if (tag !== 'Level' && tagRankMap[tag]) return tagRankMap[tag];
                return 99; 
            };

            const rankA = getLevelRank(a, lvlA);
            const rankB = getLevelRank(b, lvlB);

            if (rankA !== rankB) return rankA - rankB; 
            if (statA !== statB) return statA - statB; 
            return wordA.localeCompare(wordB);         
        } 
        else if (currentSortMode === 'status') {
            if (statA !== statB) return statA - statB;
            if (lvlA !== lvlB) return lvlA - lvlB;
            return wordA.localeCompare(wordB);
        } 
        else { 
            const wordCompare = wordA.localeCompare(wordB);
            if (wordCompare !== 0) return wordCompare;
            if (statA !== statB) return statA - statB;
            return lvlA - lvlB;
        }
    });
}

async function loadHistory() {
    try {
        const raw = await gasFetch('getSummary');

        if (raw && raw.error) {
            console.error("後端 API 回傳錯誤:", raw.error);
            return;
        }

        if (Array.isArray(raw)) {
            historyData = raw; 
            applySort();       
            filterHistory();
            renderDashboard();
        }
    } catch (err) { 
        console.error("取得歷史紀錄失敗", err); 
    }
}

function navigateHistory(offset) {
    const targetWord = offset === 1 ? lockedNextWord : lockedPrevWord;
    if (targetWord) {
        clickHistoryItem(targetWord);
    }
}

function manageCacheLRU(word) {
    cacheQueue = cacheQueue.filter(w => w !== word);
    cacheQueue.push(word);
    
    while (cacheQueue.length > MAX_CACHE_SIZE) {
        const oldestWord = cacheQueue.shift(); 
        delete wordDetailsCache[oldestWord];   
    }
}

async function preloadAdjacentWords(currentWord) {
    const currentIndex = filteredData.findIndex(item => item.word === currentWord);
    if (currentIndex === -1) return;

    const wordsToPreload = [];
    for (let i = 1; i <= 10; i++) {
        if (currentIndex + i < filteredData.length) wordsToPreload.push(filteredData[currentIndex + i].word);
        if (currentIndex - i >= 0) wordsToPreload.push(filteredData[currentIndex - i].word);
    }

    const neededWords = wordsToPreload.filter(w => !wordDetailsCache[w]);
    
    if (neededWords.length === 0) return; 

    activePreloadPromise = gasFetch('getBatchDetails', { words: neededWords })
        .then(data => {
            if (data.success && data.results) {
                data.results.forEach(fullData => {
                    wordDetailsCache[fullData.word] = fullData;
                    manageCacheLRU(fullData.word); 
                });
            }
        })
        .catch(e => console.error("預載發生錯誤:", e))
        .finally(() => activePreloadPromise = null);
}

async function clickHistoryItem(word) {
    const summaryItem = historyData.find(i => i.word === word);
    if (!summaryItem) return;

    if (currentDetailFetchController) {
        currentDetailFetchController.abort(); 
    }

    if (!wordDetailsCache[word] && activePreloadPromise) {
        toggleLoading(true, false);
        await activePreloadPromise;
        toggleLoading(false, false);
    }

    if (!wordDetailsCache[word]) {
        const loaderTimer = setTimeout(() => { toggleLoading(true, false); }, 500);

        currentDetailFetchController = new AbortController();
        const signal = currentDetailFetchController.signal;

        try {
            const fullData = await gasFetch('getDetails', { word: word }, signal);
            if (fullData.error && fullData.error !== 'not_found') throw new Error(fullData.error);
            if (fullData.error === 'not_found') {
                clearTimeout(loaderTimer); toggleLoading(false, false); return;
            }
            wordDetailsCache[word] = fullData;
        } catch (e) { 
            if (e.name === 'AbortError') { clearTimeout(loaderTimer); return; }
            clearTimeout(loaderTimer); toggleLoading(false, false); return; 
        }
        clearTimeout(loaderTimer);
        toggleLoading(false, false); 
    }

    currentDetailFetchController = null;
    manageCacheLRU(word);
    const fullItem = wordDetailsCache[word];
    
    const searchInput = document.getElementById('historySearch');
    if (searchInput && searchInput.value !== '') {
        searchInput.value = ''; 
        filterHistory();        
    }
    
    renderCard(fullItem); 

    if (typeof preloadAdjacentWords === 'function') {
        setTimeout(() => preloadAdjacentWords(word), 500);
    }
    
    if (!fullItem.tense_sentences || fullItem.tense_sentences.length === 0) {
        regenerateSentences(fullItem.word);
    }
    
    setTimeout(() => scrollToActiveItem(), 50); 
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.add('closed');
    }

    try {
        const data = await gasFetch('updateView', { word: word });
        if(data.success) {
            if(summaryItem.stats) summaryItem.stats.views = data.views;
            else summaryItem.stats = { views: data.views, status: 'new' };
            if(wordDetailsCache[word].stats) wordDetailsCache[word].stats.views = data.views;
            
            const viewDisplay = document.getElementById('viewDisplay');
            if(viewDisplay) viewDisplay.innerText = `${data.views} vw`;
        }
    } catch(e) { console.error(e); }
}

function filterByStat(status) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('closed');

    currentFilterValue = status;
    updateSortButtonsVisibility(status);
    updateSelectLockUI();

    const currentText = document.getElementById('currentSelectText');
    const options = document.querySelectorAll('.custom-option');

    options.forEach(opt => opt.classList.remove('selected'));
    const targetOption = Array.from(options).find(opt => opt.getAttribute('data-value') === status);
    if (targetOption) {
        targetOption.classList.add('selected');
        currentText.textContent = targetOption.textContent;
    }

    filterHistory();

    const cardArea = document.getElementById('cardArea');
    const isCardViewActive = cardArea && cardArea.style.display !== 'none';

    if (filteredData.length > 0) {
        const stillExists = currentViewedWord && filteredData.some(item => item.word === currentViewedWord);
        if (isCardViewActive && stillExists) {
            recalculateNavigationLock();
            updateCurrentIndexDisplay(currentViewedWord);
            if (typeof updateCardNavigation === 'function') updateCardNavigation(currentViewedWord);
            scrollToActiveItem();
        } else {
            clickHistoryItem(filteredData[0].word);
        }
    } else {
        goToDashboard();
    }
}

function filterByLevel(level) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('closed');

    const filterVal = `lvl-${level}`;
    currentFilterValue = filterVal;

    updateSortButtonsVisibility(filterVal);
    updateSelectLockUI();

    const currentText = document.getElementById('currentSelectText');
    const options = document.querySelectorAll('.custom-option');
    
    options.forEach(opt => opt.classList.remove('selected'));
    const targetOption = Array.from(options).find(opt => opt.getAttribute('data-value') === filterVal);
    
    if (targetOption) {
        targetOption.classList.add('selected');
        currentText.textContent = targetOption.textContent;
    } else {
        currentText.textContent = `Level ${level}`;
    }

    filterHistory();

    const cardArea = document.getElementById('cardArea');
    const isCardViewActive = cardArea && cardArea.style.display !== 'none';

    if (filteredData.length > 0) {
        const stillExists = currentViewedWord && filteredData.some(item => item.word === currentViewedWord);
        if (isCardViewActive && stillExists) {
            recalculateNavigationLock();
            updateCurrentIndexDisplay(currentViewedWord);
            if (typeof updateCardNavigation === 'function') updateCardNavigation(currentViewedWord);
            scrollToActiveItem();
        } else {
            clickHistoryItem(filteredData[0].word);
        }
    } else {
        goToDashboard();
    }
}

async function updateStatus(word, newStatus) {
    const item = historyData.find(i => i.word === word);
    const cacheItem = wordDetailsCache[word];

    if (item && !item.stats) item.stats = { views: 1, status: 'new', level: null, isBookmarked: false };
    if (cacheItem && !cacheItem.stats) cacheItem.stats = { views: 1, status: 'new', level: null, isBookmarked: false };
    
    if (item) item.stats.status = newStatus;
    if (cacheItem) cacheItem.stats.status = newStatus;
    
    document.querySelectorAll('.status-btn').forEach(btn => btn.classList.remove('active'));
    const targetBtn = document.querySelector(`.status-btn.${newStatus}`);
    if (targetBtn) targetBtn.classList.add('active');

    applySort();
    filterHistory(); 
    updateCurrentIndexDisplay(word);
    updateCardNavigation(word);
    setTimeout(() => scrollToActiveItem(), 50);
    renderDashboard();

    try {
        const data = await gasFetch('updateStatus', { word: word, status: newStatus });
        if (data.success && data.stats) {
            if (item) item.stats = data.stats;
            if (cacheItem) cacheItem.stats = data.stats;
        }
    } catch(e) { console.error("Update status failed"); }
}

async function updateLevel(word, newLevel) {
    const item = historyData.find(i => i.word === word);
    const cacheItem = wordDetailsCache[word];

    const currentLvl = (item && item.stats && item.stats.level !== undefined) ? item.stats.level : null;
    const currentTag = (item && item.exam_tag) ? item.exam_tag : 'Level'; 
    const lockedList = appSettings.lockedLevels || [];
    
    if (currentLvl !== null && lockedList.includes(currentLvl)) return; 
    if (newLevel !== 'none' && lockedList.includes(newLevel)) return;
    if (lockedList.includes(currentTag)) return;
    
    if (item && !item.stats) item.stats = { views: 1, status: 'new', level: null, isBookmarked: false };
    if (cacheItem && !cacheItem.stats) cacheItem.stats = { views: 1, status: 'new', level: null, isBookmarked: false };

    if (item && item.stats.level === newLevel) {
        newLevel = 'none'; 
    }
    
    if (item) item.stats.level = (newLevel === 'none' ? null : newLevel);
    if (cacheItem) cacheItem.stats.level = (newLevel === 'none' ? null : newLevel);
    
    document.querySelectorAll('.level-btn').forEach(btn => btn.classList.remove('active'));
    if (newLevel !== 'none') {
        const targetBtn = document.querySelector(`.level-btn[data-lvl="${newLevel}"]`);
        if (targetBtn) targetBtn.classList.add('active');
    }
    
    applySort();
    filterHistory();
    
    recalculateNavigationLock(); 
    updateCurrentIndexDisplay(word);
    updateCardNavigation(word);
    setTimeout(() => scrollToActiveItem(), 50);
    renderDashboard(); 

    try {
        const data = await gasFetch('updateLevel', { word: word, level: newLevel });
        if (data.success && data.stats) {
            if (item) item.stats = data.stats;
            if (cacheItem) cacheItem.stats = data.stats;
        }
    } catch(e) { console.error("Update level failed"); }
}

let isSecondaryDashboardView = false;

function toggleDashboardView() {
    isSecondaryDashboardView = !isSecondaryDashboardView;
    document.getElementById('levelView').style.display = isSecondaryDashboardView ? 'none' : 'block';
    document.getElementById('tagsView').style.display = isSecondaryDashboardView ? 'block' : 'none';
}

function renderDashboard() {
    const total = historyData.length;
    let sNew = 0, sLearning = 0, sMastered = 0;

    const levelStats = {};
    for(let i=1; i<=6; i++) {
        levelStats[i] = { total: 0, new: 0, learning: 0, mastered: 0 };
    }

    const tagStats = {
        'TOEIC': { total: 0, new: 0, learning: 0, mastered: 0, filter: 'exam-TOEIC' },
        'IELTS': { total: 0, new: 0, learning: 0, mastered: 0, filter: 'exam-IELTS' },
        'GMAT': { total: 0, new: 0, learning: 0, mastered: 0, filter: 'exam-GMAT' },
        'TOEFL': { total: 0, new: 0, learning: 0, mastered: 0, filter: 'exam-TOEFL' },
        'Extra': { total: 0, new: 0, learning: 0, mastered: 0, filter: 'exam-Extra' },
        'Phrase': { total: 0, new: 0, learning: 0, mastered: 0, filter: 'exam-Phrase' }
    };

    historyData.forEach(item => {
        const st = (item.stats && item.stats.status) ? item.stats.status : 'new';
        if(st === 'new') sNew++;
        else if(st === 'learning') sLearning++;
        else if(st === 'mastered') sMastered++;

        const lvl = (item.stats && item.stats.level !== undefined && item.stats.level !== null) ? item.stats.level : null;
        const tag = item.exam_tag || 'Level';
        
        if (lvl !== null && lvl >= 1 && lvl <= 6) {
            levelStats[lvl].total++;
            levelStats[lvl][st]++;
        }

        if (tag !== 'Level' && tagStats[tag]) {
            tagStats[tag].total++;
            tagStats[tag][st]++;
        }
    });

    document.getElementById('countTotal').innerText = total;
    document.getElementById('countNew').innerText = sNew;
    document.getElementById('countLearning').innerText = sLearning;
    document.getElementById('countMastered').innerText = sMastered;

    const generateCardHtml = (key, ls, lockTarget, isMainLevel) => {
        const pNew = ls.total > 0 ? (ls.new / ls.total) * 100 : 0;
        const pLearning = ls.total > 0 ? (ls.learning / ls.total) * 100 : 0;
        const pMastered = ls.total > 0 ? (ls.mastered / ls.total) * 100 : 0;

        const lockedList = appSettings.lockedLevels || [];
        const isLocked = lockTarget !== null && lockedList.includes(lockTarget);
        
        const lockBtnHtml = lockTarget !== null ? `
            <button class="level-lock-btn ${isLocked ? 'locked' : ''}" onclick="toggleLevelLock(event, ${typeof lockTarget === 'number' ? lockTarget : `'${lockTarget}'`})" title="${isLocked ? 'Unlock' : 'Lock'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 ${isLocked ? '10 0v4' : '9.9-1'}"></path></svg>
            </button>` : '';

        const clickAction = isMainLevel ? `filterByLevel(${lockTarget})` : `applyDashboardFilter('${ls.filter}')`;

        return `
        <div class="level-card" onclick="${clickAction}">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 5px;">
                <div class="lvl-title" style="margin-bottom: 0;">${key.toUpperCase()}</div>
                ${lockBtnHtml}
            </div>
            <div class="lvl-total">${ls.total}</div>
            <div class="lvl-details">
                <div class="lvl-det-item"><div class="dot-sm bg-new"></div>${ls.new}</div>
                <div class="lvl-det-item"><div class="dot-sm bg-learning"></div>${ls.learning}</div>
                <div class="lvl-det-item"><div class="dot-sm bg-mastered"></div>${ls.mastered}</div>
            </div>
            <div class="lvl-bars">
                <div class="lvl-bar-segment bg-mastered" style="width: ${pMastered}%"></div>
                <div class="lvl-bar-segment bg-learning" style="width: ${pLearning}%"></div>
                <div class="lvl-bar-segment bg-new" style="width: ${pNew}%"></div>
            </div>
        </div>`;
    };

    const levelArea = document.getElementById('levelStatsArea');
    if (levelArea) {
        let html = '';
        for(let i=1; i<=6; i++) {
            html += generateCardHtml(`LEVEL ${i}`, levelStats[i], i, true);
        }
        levelArea.innerHTML = html;
    }

    const tagsArea = document.getElementById('tagsStatsArea');
    if (tagsArea) {
        let secHtml = '';
        for (const [key, ls] of Object.entries(tagStats)) {
            secHtml += generateCardHtml(key, ls, key, false); 
        }
        tagsArea.innerHTML = secHtml;
    }
}

function applyDashboardFilter(filterValue) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('closed');

    currentFilterValue = filterValue;
    updateSortButtonsVisibility(filterValue);
    updateSelectLockUI();

    const currentText = document.getElementById('currentSelectText');
    const options = document.querySelectorAll('.custom-option');
    
    options.forEach(opt => opt.classList.remove('selected'));
    const targetOption = Array.from(options).find(opt => opt.getAttribute('data-value') === filterValue);
    
    if (targetOption) {
        targetOption.classList.add('selected');
        currentText.textContent = targetOption.textContent;
    }

    filterHistory();

    const cardArea = document.getElementById('cardArea');
    const isCardViewActive = cardArea && cardArea.style.display !== 'none';

    if (filteredData.length > 0) {
        const stillExists = currentViewedWord && filteredData.some(item => item.word === currentViewedWord);
        if (isCardViewActive && stillExists) {
            recalculateNavigationLock();
            updateCurrentIndexDisplay(currentViewedWord);
            if (typeof updateCardNavigation === 'function') updateCardNavigation(currentViewedWord);
            scrollToActiveItem();
        } else {
            clickHistoryItem(filteredData[0].word);
        }
    } else {
        goToDashboard();
    }
}

function filterHistory() {
    const searchText = document.getElementById('historySearch').value.toLowerCase();
    const filterValue = currentFilterValue;
    const container = document.getElementById('historyList');

    const result = historyData.filter(item => {
        // 🚨 防護
        const wordNoSpace = (item.word || '').toLowerCase().replace(/\s+/g, '');
        const matchText = wordNoSpace.includes(searchText);
        let matchFilter = true;
        const status = (item.stats && item.stats.status) ? item.stats.status : 'new';
        let level = (item.stats && item.stats.level !== undefined) ? item.stats.level : null;
        const examTag = item.exam_tag || 'Level';

        if (filterValue === 'all') matchFilter = true;
        else if (filterValue === 'bookmarked') matchFilter = (item.stats && item.stats.isBookmarked === true);
        else if (filterValue === 'lvl-unset') matchFilter = (level === null && examTag === 'Level');
        else if (filterValue.startsWith('lvl-')) matchFilter = (level === parseInt(filterValue.split('-')[1]));
        else if (filterValue.startsWith('exam-')) matchFilter = (examTag === filterValue.split('-')[1]);
        else matchFilter = (status === filterValue);

        return matchText && matchFilter;
    });

    filteredData = result;

    if (filteredData.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:#444; font-size:0.8rem; margin-top:20px;">No Match</div>';
        return;
    }

    container.innerHTML = `
        <div id="vs-spacer" style="height: ${filteredData.length * ITEM_HEIGHT}px; position: relative; width: 100%;">
            <div id="vs-content" style="position: absolute; top: 0; left: 0; width: 100%;"></div>
        </div>
    `;
    
    container.onscroll = () => renderVirtualList();
    renderVirtualList(); 
}

function renderVirtualList() {
    const container = document.getElementById('historyList');
    const content = document.getElementById('vs-content');
    if (!content) return;

    const scrollTop = container.scrollTop;
    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - 3);
    const endIndex = Math.min(filteredData.length, startIndex + VISIBLE_COUNT + 6);

    content.style.transform = `translateY(${startIndex * ITEM_HEIGHT}px)`;

    content.innerHTML = filteredData.slice(startIndex, endIndex).map(item => {
            const stats = item.stats || {};
            const status = stats.status || 'new';
            const isActive = (item.word === currentViewedWord) ? 'current-active' : '';
            
            const hasLevel = stats.level !== undefined && stats.level !== null;
            const hasTag = item.exam_tag && item.exam_tag !== 'Level';
            let levelHtml = '';
            
            if (hasLevel) {
                levelHtml = `<span class="sidebar-level-tag" data-lvl="${stats.level}">LV.${stats.level}</span>`;
            } else if (hasTag) {
                levelHtml = `<span class="sidebar-level-tag" data-tag="${item.exam_tag}">${item.exam_tag}</span>`;
            }

            const isBookmarked = !!stats.isBookmarked;
            const bookmarkRibbon = isBookmarked ? `<div class="bookmark-ribbon"></div>` : '';

        // 🚨 防護
        const safeWord = (item.word || '').replace(/'/g, "\\'");

        const audioBtnHtml = `
            <button class="h-audio-btn" onmousedown="event.stopPropagation();" onclick="event.stopPropagation(); playAudio('${safeWord}')" title="Listen">
                <svg height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                    <path d="M560-131v-82q90-26 145-100t55-168q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 127-78 224.5T560-131ZM120-360v-240h160l200-200v640L280-360H120Zm440 40v-322q47 22 73.5 66t26.5 96q0 51-26.5 94.5T560-320ZM400-606l-86 86H200v80h114l86 86v-252ZM300-480Z"/>
                </svg>
            </button>
        `;

        return `
        <div id="history-item-${item.word}" class="history-item status-${status} ${isActive}" onclick="clickHistoryItem('${safeWord}')">
            <span class="h-word">${item.word}</span>
            ${levelHtml}
            ${audioBtnHtml}
            ${bookmarkRibbon} 
        </div>`;
    }).join('');
}

function scrollToActiveItem() {
    if (!currentViewedWord) return;
    const index = filteredData.findIndex(i => i.word === currentViewedWord);
    
    if (index !== -1) {
        const container = document.getElementById('historyList');
        const targetTop = Math.max(0, (index * ITEM_HEIGHT) - (ITEM_HEIGHT * 2));
        const currentTop = container.scrollTop;
        
        if (Math.abs(currentTop - targetTop) > 1) {
            container.scrollTo({ top: targetTop, behavior: 'smooth' });
        }
    }
}

function renderCard(data, preventAudio = false) {
    const cardArea = document.getElementById('cardArea');
    const dashboard = document.getElementById('dashboard');
    const loader = document.getElementById('loader');

    if(dashboard) dashboard.style.display = 'none';
    if(loader) loader.style.display = 'none';
    if(cardArea) cardArea.style.display = 'flex';

    // 🚨 終極防護：確保 data.word 是字串
    currentViewedWord = data.word || 'Unknown';
    const safeWord = (data.word || '').replace(/'/g, "\\'");

    document.querySelectorAll('.history-item').forEach(el => el.classList.remove('current-active'));
    const activeNode = document.getElementById(`history-item-${data.word}`);
    if (activeNode) activeNode.classList.add('current-active');

    scrollToActiveItem();

    const stats = data.stats || { views: 1, status: 'new', level: null, isBookmarked: false };
    const isBookmarked = !!stats.isBookmarked;
    const bookmarkClass = isBookmarked ? 'bookmarked' : '';

    const forms = data.forms || {};
    
    const currentIndex = filteredData.findIndex(item => item.word === data.word);
    
    lockedPrevWord = currentIndex > 0 ? filteredData[currentIndex - 1].word : null;
    lockedNextWord = currentIndex < filteredData.length - 1 ? filteredData[currentIndex + 1].word : null;

    let displayIdx = currentIndex;
    let displayTotal = filteredData.length;
    
    if (displayIdx === -1) {
        displayIdx = historyData.findIndex(item => item.word === data.word);
        displayTotal = historyData.length;
    }
    
    lockedDisplayIndex = displayIdx + 1;
    lockedDisplayTotal = displayTotal;

    const indexDisplayHtml = `<span class="index-count">${lockedDisplayIndex} / ${lockedDisplayTotal}</span>`;

    const currentLevel = stats.level;
    const currentTag = data.exam_tag || 'Level';
    
    const isCurrentLevelLocked = currentLevel !== null && (appSettings.lockedLevels || []).includes(currentLevel);
    const isCurrentTagLocked = (appSettings.lockedLevels || []).includes(currentTag);
    const isCardLocked = isCurrentLevelLocked || isCurrentTagLocked;
    
    const levelsToRender = isCurrentLevelLocked ? [currentLevel] : [1, 2, 3, 4, 5, 6, 0];
    
    const levelBtnsHtml = levelsToRender.map(lvl => {
        const activeClass = (currentLevel === lvl) ? 'active' : '';
        const isThisLevelLocked = (appSettings.lockedLevels || []).includes(lvl);
        
        let isDisabled = false;
        if (isCardLocked) isDisabled = true; 
        if (isThisLevelLocked) isDisabled = true;    

        const disabledAttr = isDisabled ? 'disabled' : '';
        const lockIconHtml = isThisLevelLocked 
            ? `<svg class="btn-lock-icon" viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>` 
            : '';

        return `<button class="level-btn ${activeClass}" data-lvl="${lvl}" onclick="updateLevel('${safeWord}', ${lvl})" title="Level ${lvl}" ${disabledAttr}>${lvl}${lockIconHtml}</button>`;
    }).join('');

    const examTagLockIconHtml = isCurrentTagLocked 
        ? `<svg class="btn-lock-icon" viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2" fill="none" style="position: absolute; top: -2px; right: -10px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>` 
        : '';

    const btnStyle = `position: relative; ${isCardLocked ? 'cursor:not-allowed;' : ''}`;
    const examTagHtml = `
        <button id="exam-tag-btn-${data.word}" 
                class="exam-tag-btn" 
                data-tag="${currentTag}"
                style="${btnStyle}"
                ${isCardLocked ? 'disabled' : `onclick="cycleExamTag('${safeWord}')"`}
                title="Click to change category">
            ${currentTag}
            ${examTagLockIconHtml}
        </button>
    `;

    const formsHtml = generateFormsHtml(data.forms);

    const isFormsPending = typeof pendingRequests !== 'undefined' && pendingRequests.forms.has(data.word);
    const formsSpinIcon = `<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;
    const formsNormalIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>`;

    const formsHeaderHtml = `
        <div class="section-header">
            <span class="section-title">Verb Forms</span>
            <button id="btn-regen-forms-${data.word}" class="def-edit-btn verb-form-re" onclick="regenerateVerbForms('${safeWord}')" title="Regenerate Forms" ${isFormsPending ? 'disabled' : ''}>
                ${isFormsPending ? formsSpinIcon : formsNormalIcon}
            </button>
            <button class="def-edit-btn" onclick="openEditFormsModal('${safeWord}')" title="Edit Forms" style="margin-left: auto;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
        </div>
    `;
    
    const sentencesHtml = (data.tense_sentences && data.tense_sentences.length > 0) 
        ? data.tense_sentences.map(s => {
            // 🚨 終極防護：確保 s.en 是字串
            const safeText = (s.en || '').replace(/'/g, "\\'"); 
            return `
            <div class="sentence-item" onclick="playSentenceAudio('${safeText}', this)" title="Click to listen">
                <div class="st-en-wrapper">
                    <div class="st-en">${s.en || ''}</div>
                    <button class="audio-btn-sm" onclick="playSentenceAudio('${safeText}')" title="Listen">
                        <svg height="24px" viewBox="0 -960 960 960" width="24px">
                            <path d="M560-131v-82q90-26 145-100t55-168q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 127-78 224.5T560-131ZM120-360v-240h160l200-200v640L280-360H120Zm440 40v-322q47 22 73.5 66t26.5 96q0 51-26.5 94.5T560-320ZM400-606l-86 86H200v80h114l86 86v-252ZM300-480Z"/>
                        </svg>
                    </button>
                </div>
                <div class="zh-row">
                    <button class="zh-eye-btn" onclick="event.stopPropagation(); toggleZhVisibility(this)" title="Toggle Translation">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M10 9.17a3 3 0 1 0 0 5.66"/><path d="M17 9.17a3 3 0 1 0 0 5.66"/><rect x="2" y="5" width="20" height="14" rx="2"/>
                        </svg>
                    </button>
                    <div class="st-zh">${s.zh || ''} (${s.type || ''}${s.tense ? '/' + s.tense : ''})</div>
                </div>
            </div>`;
        }).join('') 
        : `
        <div class="no-data" style="display: flex; flex-direction: column; align-items: center; gap: 15px; margin-top: 40px; opacity: 0.6;">
            <svg class="spin" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"></path>
            </svg>
            <span style="font-size: 0.9rem; letter-spacing: 1px;">Loading...</span>
        </div>`;

    const rawTrans = data.translation || '';
    const rawPos = data.part_of_speech || '';
    const transParts = rawTrans.split('/');
    const posParts = rawPos.split('/');
    const maxLen = Math.max(transParts.length, posParts.length);
    
    let segmentsHtml = '';
    for (let i = 0; i < maxLen; i++) {
        const t = (transParts[i] || '').trim();
        const p = (posParts[i] || '').trim();
        if (t || p) {
            const displayPos = POS_ABBR_MAP[p.toLowerCase()] || p;
            const posHtml = displayPos ? `<span class="pos-tag">${displayPos}</span>` : '';
            const transHtml = t ? `<span class="trans-text">${t}</span>` : '';
            segmentsHtml += `<span class="trans-segment">${transHtml}${posHtml}</span>`;
        }
    }

    const translationHtml = `
        <div class="translation-container">
            <div class="translation-view" id="trans-view-${data.word}">
                <div id="trans-wrapper-${data.word}" class="trans-content-wrapper">
                    ${segmentsHtml}
                </div>
                <button class="edit-btn-sm translation-edit-btn" onclick="enableEditMode('${safeWord}')" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
            </div>
            
            <div class="translation-edit" id="trans-edit-${data.word}" style="display: none;" onmousedown="event.stopPropagation();" onclick="event.stopPropagation();">
                <div class="edit-row">
                    <input type="text" id="input-trans-${data.word}" class="edit-input-trans" value="${data.translation}" placeholder="Translation">
                    
                    <input type="text" 
                           id="input-pos-${data.word}" 
                           class="edit-input-pos" 
                           value="${data.part_of_speech}" 
                           placeholder="POS" 
                           list="fixed-pos-list" 
                           autocomplete="off"
                           oninput="handlePosInput(this)" 
                           onfocus="handlePosInput(this)">
                    
                    <datalist id="fixed-pos-list"></datalist>
                </div>
                <div class="edit-actions">
                    <button class="cancel-btn-mini" onclick="cancelEditMode('${safeWord}')">Cancel</button>
                    <button class="save-btn-mini" onclick="saveTranslation('${safeWord}')">Save</button>
                </div>
            </div>
        </div>
    `;

    const definitionHtml = `
        <div class="definition-wrapper" style="flex-wrap: wrap;">
            <span class="def-text" id="disp-def-${data.word}">${data.definition || ''}</span>
            <button id="btn-edit-def-${data.word}" class="def-edit-btn explain-text-edit" onclick="enableEditDef('${safeWord}')" title="Edit Definition">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>

            <div id="def-edit-mode-${data.word}" style="display: none; width: 100%; margin: 0;">
                <textarea id="input-def-${data.word}" 
                          oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'"
                          style="width: 100%; padding: 0; border: none; background: transparent; color: var(--text-muted); font-family: inherit; font-size: 0.95rem; resize: none; overflow: hidden; line-height: 1.6; outline: none; box-sizing: border-box;">${data.definition || ''}</textarea>
                <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; padding-right:10px">
                    <button class="cancel-btn-mini" onclick="cancelEditDef('${safeWord}')">Cancel</button>
                    <button class="save-btn-mini" onclick="saveDefinition('${safeWord}')">Save</button>
                </div>
            </div>
        </div>
    `;

    const isSentencesPending = typeof pendingRequests !== 'undefined' && pendingRequests.sentences.has(data.word);
    const sentencesSpinIcon = `<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;
    const sentencesNormalIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`;

    const sentencesHeaderHtml = `
        <div class="section-header">
            <span class="section-title">Context Examples</span>
            <button class="def-edit-btn" id="REsentencesbtn" onclick="regenerateSentences('${safeWord}')" title="Regenerate Sentences" ${isSentencesPending ? 'disabled' : ''}>
                ${isSentencesPending ? sentencesSpinIcon : sentencesNormalIcon}
            </button>
            <button class="audio-btn" id="playAllSentencesBtn" onclick="playAllSentencesRandomVoices('${safeWord}')" title="Play All Sentences (Random Voices)">
                <svg height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                    <path d="M560-131v-82q90-26 145-100t55-168q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 127-78 224.5T560-131ZM120-360v-240h160l200-200v640L280-360H120Zm440 40v-322q47 22 73.5 66t26.5 96q0 51-26.5 94.5T560-320ZM400-606l-86 86H200v80h114l86 86v-252ZM300-480Z"/>
                </svg>
            </button>
        </div>
    `;

    let isInitialized = document.querySelector('.card-box') !== null;
    
    if (!isInitialized) {
        cardArea.innerHTML = `
            <button class="nav-side-btn prev" id="nav-btn-prev" onclick="navigateHistory(-1)" title="Prev">
                <div class="tooltip" id="tooltip-prev"></div>
            </button>

            <div class="card-box">
                <div class="card-meta" id="card-meta-container"></div>
                <div class="card-body-grid">
                    <div class="card-left" id="card-left-container"></div>
                    <div class="card-right" id="card-right-container"></div>
                </div>
                <div class="mobile-nav" id="mobile-nav-container" style="display:none;"></div>
            </div>

            <button class="nav-side-btn next" id="nav-btn-next" onclick="navigateHistory(1)" title="Next">
                <div class="tooltip" id="tooltip-next"></div>
            </button>
        `;
    }

    const btnPrev = document.getElementById('nav-btn-prev');
    const btnNext = document.getElementById('nav-btn-next');
    if (btnPrev) {
        btnPrev.disabled = !lockedPrevWord;
        document.getElementById('tooltip-prev').innerText = lockedPrevWord ? lockedPrevWord : 'Start';
    }
    if (btnNext) {
        btnNext.disabled = !lockedNextWord;
        document.getElementById('tooltip-next').innerText = lockedNextWord ? lockedNextWord : 'End';
    }

    const levelTogglesStyle = currentTag === 'Level' ? '' : 'style="display: none;"';

    document.getElementById('card-meta-container').innerHTML = `
        <div class="meta-left">
            <div class="status-toggles">
                <button class="status-btn new ${stats.status === 'new' ? 'active' : ''}" onclick="updateStatus('${safeWord}', 'new')">N</button>
                <button class="status-btn learning ${stats.status === 'learning' ? 'active' : ''}" onclick="updateStatus('${safeWord}', 'learning')">L</button>
                <button class="status-btn mastered ${stats.status === 'mastered' ? 'active' : ''}" onclick="updateStatus('${safeWord}', 'mastered')">M</button>
            </div>
            <div class="meta-divider"></div>
            ${examTagHtml}
            <div class="level-toggles" id="level-toggles-${data.word}" ${levelTogglesStyle}>${levelBtnsHtml}</div>
            <div class="meta-divider"></div>
            <button class="btn-index-count">${indexDisplayHtml}</button>
        </div>
        
        <div class="meta-right">
            <span class="views-count" id="viewDisplay">${stats.views} vw</span>
            <button class="action-btn bookmark-btn ${bookmarkClass}" 
                    onclick="toggleBookmark('${safeWord}')" 
                    id="btn-bookmark-card"
                    title="Bookmark">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
            </button>
            <button class="action-btn delete-btn" onclick="deleteWord('${safeWord}')" title="Delete Word">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
            <button class="action-btn refresh-btn" onclick="regenerate('${safeWord}')" title="Regenerate Card">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            </button>
        </div>
    `;

    const currentPos = data.part_of_speech || '';
    const isHideCardActions = document.body.classList.contains('hide-card-actions');
    const isAuxVerb = /\bauxiliary verb\b/i.test(currentPos);
    const isRegularVerb = /\bverb\b/i.test(currentPos);
    const showForms = isRegularVerb && !(isHideCardActions && isAuxVerb);

    document.getElementById('card-left-container').innerHTML = `
        <div class="vocabulary-container" onclick="handleHeaderClick(event)">
            <div class="word-header-container">
                <h2 class="word-title">${data.word || ''}</h2>
                <button class="audio-btn" id="vocabulary-audio-btn" onclick="playAudio('${safeWord}')" title="Listen">
                    <svg height="24px" viewBox="0 -960 960 960" width="24px"><path d="M560-131v-82q90-26 145-100t55-168q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 127-78 224.5T560-131ZM120-360v-240h160l200-200v640L280-360H120Zm440 40v-322q47 22 73.5 66t26.5 96q0 51-26.5 94.5T560-320ZM400-606l-86 86H200v80h114l86 86v-252ZM300-480Z"/></svg>
                </button>
            </div>
            ${translationHtml}
            ${definitionHtml}
        </div>
        <div style="margin-top: 10px;" id="forms-container-${data.word}" class="${showForms ? 'is-verb' : 'not-verb'}">
            ${formsHeaderHtml} ${formsHtml}
        </div>
    `;

    document.getElementById('card-right-container').innerHTML = `
        ${sentencesHeaderHtml} 
        <div id="sentences-container" style="margin-top:10px;">${sentencesHtml}</div>
    `;

    document.getElementById('mobile-nav-container').innerHTML = `
         <button class="mobile-nav-btn" onclick="navigateHistory(-1)" ${!lockedPrevWord ? 'disabled' : ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
            Prev
         </button>
         <button class="mobile-nav-btn" onclick="navigateHistory(1)" ${!lockedNextWord ? 'disabled' : ''}>
            Next
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
         </button>
    `;

    document.getElementById('card-right-container').scrollTop = 0;

    const hasNext = (filteredData.findIndex(item => item.word === data.word) < filteredData.length - 1);
    
    if (!preventAudio) window.speechSynthesis.cancel();
    
    (async () => {
        if (preventAudio) return;
        
        currentAudioSession = Date.now();
        const thisSession = currentAudioSession;

        let playTimes = appSettings.autoVoice ? (appSettings.pronounceCount || 1) : 0;
        for (let i = 0; i < playTimes; i++) {
            if (currentViewedWord !== data.word || thisSession !== currentAudioSession) return; 
            
            await playAudioAsync(data.word || '', true);
            if (i < playTimes - 1) {
                await delay(100); 
                if (thisSession !== currentAudioSession) return;
            }
        }

        if (appSettings.autoPlay && appSettings.readSentences && data.tense_sentences && data.tense_sentences.length > 0) {
            if (playTimes > 0) await delay(800); 
            
            const sentenceNodes = document.querySelectorAll('#sentences-container .sentence-item');

            try {
                for (let i = 0; i < data.tense_sentences.length; i++) {
                    if (currentViewedWord !== data.word || thisSession !== currentAudioSession) return;
                    
                    // 🚨 防護
                    let safeText = (data.tense_sentences[i].en || '').replace(/'/g, ""); 
                    let autoVoice = appSettings.randomVoiceAuto ? getRandomVoiceForCurrentAccent() : null;
                    
                    if (sentenceNodes[i]) sentenceNodes[i].classList.add('playing-sentence');
                    
                    await playAudioAsync(safeText, true, autoVoice); 
                    
                    if (sentenceNodes[i]) sentenceNodes[i].classList.remove('playing-sentence');
                    
                    if (i < data.tense_sentences.length - 1) {
                        await delay(800); 
                        if (thisSession !== currentAudioSession) return;
                    }
                }
            } finally {
                sentenceNodes.forEach(n => n.classList.remove('playing-sentence'));
            }
        }

        const isWaitingForSentences = (!data.tense_sentences || data.tense_sentences.length === 0);
        
        if (appSettings.autoPlay && hasNext && !isWaitingForSentences) {
            if (currentViewedWord !== data.word || thisSession !== currentAudioSession) return;
            await delay(1500); 
            if (currentViewedWord === data.word && thisSession === currentAudioSession) {
                navigateHistory(1);
            }
        }
    })();
}

async function toggleBookmark(word) {
    const btn = document.getElementById('btn-bookmark-card');
    if (btn) btn.classList.toggle('bookmarked');

    try {
        const data = await gasFetch('toggleBookmark', { word: word });
        
        if (data.success) {
            const item = historyData.find(i => i.word === word);
            if (item) {
                if (!item.stats) item.stats = {};
                item.stats.isBookmarked = data.isBookmarked;
            }

            if (wordDetailsCache[word] && wordDetailsCache[word].stats) {
                wordDetailsCache[word].stats.isBookmarked = data.isBookmarked;
            }

            if (btn) {
                if (data.isBookmarked) btn.classList.add('bookmarked');
                else btn.classList.remove('bookmarked');
            }
            filterHistory();
        }
    } catch (e) {
        console.error("Toggle bookmark failed", e);
        if (btn) btn.classList.toggle('bookmarked');
        alert("操作失敗，請檢查網路連線");
    }
}

const EXAM_TAGS = ['Level', 'Extra', 'TOEIC', 'IELTS', 'GMAT', 'TOEFL', 'Phrase'];
async function cycleExamTag(word) {
    const item = historyData.find(i => i.word === word);
    if (!item) return;

    const currentLvl = (item.stats && item.stats.level !== undefined) ? item.stats.level : null;
    const currentTag = item.exam_tag || 'Level'; 
    const lockedList = appSettings.lockedLevels || [];

    if ((currentLvl !== null && lockedList.includes(currentLvl)) || lockedList.includes(currentTag)) {
        console.warn("This word is locked in its current category. Cannot change tag.");
        return; 
    }

    const currentIndex = EXAM_TAGS.indexOf(currentTag);
    const nextIndex = (currentIndex === -1) ? 0 : (currentIndex + 1) % EXAM_TAGS.length;
    const nextTag = EXAM_TAGS[nextIndex];

    if (nextTag !== 'Level') {
        if (item.stats) item.stats.level = null;
        if (wordDetailsCache[word] && wordDetailsCache[word].stats) {
            wordDetailsCache[word].stats.level = null;
        }
        
        document.querySelectorAll('.level-btn').forEach(btn => btn.classList.remove('active'));
        
        gasFetch('updateLevel', { word: word, level: 'none' }).catch(e => console.error("Auto clear level failed", e));

        renderDashboard();
    }

    try {
        const data = await gasFetch('updateDetails', { word: word, exam_tag: nextTag });

        if (data.success) {
            item.exam_tag = nextTag; 
            
            if (wordDetailsCache[word]) {
                wordDetailsCache[word].exam_tag = nextTag;
            }
            
            const btn = document.getElementById(`exam-tag-btn-${word}`);
            if (btn) {
                btn.innerText = nextTag;
                btn.setAttribute('data-tag', nextTag);
            }

            const levelToggles = document.getElementById(`level-toggles-${word}`);
            if (levelToggles) {
                levelToggles.style.display = (nextTag === 'Level') ? '' : 'none';
            }

            applySort();
            filterHistory();
            
            recalculateNavigationLock(); 
            
            updateCurrentIndexDisplay(word);
            updateCardNavigation(word);
            setTimeout(() => scrollToActiveItem(), 50);
        }
    } catch (e) {
        console.error("Update tag failed", e);
    }
}

async function syncTimer() {
    try {
        const data = await gasFetch('getTimer');
        
        if (data.targetTime) {
            const now = Date.now();
            
            if (now >= data.targetTime) {
                document.getElementById('timerDisplay').innerText = "00:00:00:00";
                
                if (timerInterval) clearInterval(timerInterval);
                timerInterval = null; 

                setTimeout(() => {
                    handleTimeUp();
                }, 500);
            } else {
                startCountdownLoop(data.targetTime);
            }
        } else {
            document.getElementById('timerDisplay').innerText = "00:00:00:00";
            if(timerInterval) clearInterval(timerInterval);
            timerInterval = null; 
        }
    } catch (e) { console.error("Timer sync failed", e); }
}

function startCountdownLoop(targetTime) {
    if (timerInterval) clearInterval(timerInterval);

    const display = document.getElementById('timerDisplay');
    update(); 

    timerInterval = setInterval(update, 1000);

    function update() {
        const now = Date.now();
        const diff = targetTime - now;

        if (diff <= 0) {
            display.innerText = "00:00:00:00";
            
            clearInterval(timerInterval);
            timerInterval = null; 
            
            handleTimeUp(); 
            return;
        }

        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const m = Math.floor((diff / 1000 / 60) % 60);
        const s = Math.floor((diff / 1000) % 60);

        display.innerText = 
            String(d).padStart(2, '0') + ':' + 
            String(h).padStart(2, '0') + ':' + 
            String(m).padStart(2, '0') + ':' + 
            String(s).padStart(2, '0');
    }
}

function openTimerModal() {
    const modal = document.getElementById('timerModal');
    modal.classList.add('active');

    const isRunning = (timerInterval !== null);

    const inputs = ['tDays', 'tHours', 'tMins'];
    const startBtn = modal.querySelector('.modal-btn.confirm:not(.danger)'); 

    if (!isRunning) {
        document.getElementById('tDays').value = '';
        document.getElementById('tHours').value = '';
        document.getElementById('tMins').value = '';
        setTimeout(() => document.getElementById('tMins').focus(), 50);
    }

    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = isRunning; 
            el.style.opacity = isRunning ? '0.5' : '1';
            el.style.cursor = isRunning ? 'not-allowed' : 'text';
            
            if (!isRunning) {
                el.style.backgroundColor = ''; 
                el.style.color = '';          
            }
        }
    });

    if (startBtn) {
        startBtn.style.display = isRunning ? 'none' : 'inline-block';
    }
}

function closeTimerModal() {
    document.getElementById('timerModal').classList.remove('active');
}

async function confirmSetTimer() {
    const d = parseInt(document.getElementById('tDays').value) || 0;
    const h = parseInt(document.getElementById('tHours').value) || 0;
    const m = parseInt(document.getElementById('tMins').value) || 0;

    if (d === 0 && h === 0 && m === 0) {
        alert("Please set a duration.");
        return;
    }

    await setTimer({ days: d, hours: h, minutes: m });
}

async function setTimer(payload) {
    if (payload === 0) payload = { days: 0, hours: 0, minutes: 0 };

    try {
        const data = await gasFetch('setTimer', payload);
        
        closeTimerModal();
        
        if (data.targetTime) {
            startCountdownLoop(data.targetTime);
        } else {
            document.getElementById('timerDisplay').innerText = "00:00:00:00";
            
            if(timerInterval) clearInterval(timerInterval);
            timerInterval = null; 
        }
    } catch (e) { console.error("Set timer failed", e); }
}

document.getElementById('timerModal').addEventListener('click', (e) => {
    if (e.target.id === 'timerModal') closeTimerModal();
});

function confirmResetTimer() {
    closeTimerModal();
    showConfirmModal(
        'Reset Timer', 
        'Are you sure you want to stop the timer?<br>The countdown will be reset to 00:00:00:00.', 
        () => {
            setTimer(0);
        },
        true 
    );
}

function handleTimeUp() {
    showConfirmModal(
        "Time's Up!", 
        "The countdown has finished.", 
        () => {
            setTimer(0);
        },
        false 
    );
}

// 文字轉語音 (TTS)
let currentUtterance = null;
let pendingAudioResolve = null;

function playAudio(text, onEndCallback, isFromLoop = false, forcedVoice = null) { 
    if (!text) {
        if (onEndCallback) onEndCallback(); 
        return;
    }

    if (!isFromLoop) {
        currentAudioSession = Date.now(); 
        const allPlayBtn = document.getElementById('playAllSentencesBtn');
        if (allPlayBtn) allPlayBtn.classList.remove('playing');
    }

    if (pendingAudioResolve) {
        pendingAudioResolve();
        pendingAudioResolve = null;
    }

    if (currentUtterance) {
        currentUtterance.onend = null;
        currentUtterance.onerror = null;
    }
    
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    
    pendingAudioResolve = onEndCallback;
    
    let targetLang = 'en-US';
    let isEnglish = true;     

    const hasChinese = /[\u4e00-\u9fa5]/.test(text); 
    const hasJapanese = /[\u3040-\u30ff\u31f0-\u31ff]/.test(text); 

    if (hasChinese) {
        targetLang = 'zh-TW'; 
        isEnglish = false;
    } else if (hasJapanese) {
        targetLang = 'ja-JP'; 
        isEnglish = false;
    } else {
        const accentMap = { 'US': 'en-US', 'UK': 'en-GB', 'CA': 'en-CA', 'AU': 'en-AU' };
        targetLang = accentMap[appSettings.accent] || 'en-US';
    }
    
    utterance.lang = targetLang;
    
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
        let selectedVoice = null;
        
        if (forcedVoice) {
            selectedVoice = forcedVoice;
        } else if (isEnglish && appSettings.voiceName && appSettings.voiceName[appSettings.accent]) {
            const savedVoice = appSettings.voiceName[appSettings.accent];
            selectedVoice = voices.find(v => v.name === savedVoice);
        }
        
        if (!selectedVoice) {
            selectedVoice = voices.find(v => v.lang.replace('_', '-').includes(targetLang));
        }
        
        if (selectedVoice) {
            utterance.voice = selectedVoice; 
        }
    }
    
    currentUtterance = utterance;

    utterance.onend = () => {
        currentUtterance = null; 
        pendingAudioResolve = null; 
        if (onEndCallback) onEndCallback(); 
    };
    
    utterance.onerror = (e) => {
        if (e.error !== 'canceled' && e.error !== 'interrupted') {
            console.warn("Speech error:", e.error);
        }
        currentUtterance = null;
        pendingAudioResolve = null; 
        if (onEndCallback) onEndCallback(); 
    };

    window.speechSynthesis.speak(utterance);
}

async function playAllSentencesRandomVoices(word) {
    const cacheItem = wordDetailsCache[word];
    if (!cacheItem || !cacheItem.tense_sentences || cacheItem.tense_sentences.length === 0) return;

    window.speechSynthesis.cancel();
    
    currentAudioSession = Date.now();
    const thisSession = currentAudioSession;

    const voices = window.speechSynthesis.getVoices();
    const accentMap = { 'US': 'en-US', 'UK': 'en-GB', 'CA': 'en-CA', 'AU': 'en-AU' };
    const targetLang = accentMap[appSettings.accent] || 'en-US';
    const filteredVoices = voices.filter(v => v.lang.replace('_', '-').includes(targetLang));

    const btn = document.getElementById('playAllSentencesBtn');
    if (btn) btn.classList.add('playing');

    const sentenceNodes = document.querySelectorAll('#sentences-container .sentence-item');

    try {
        for (let i = 0; i < cacheItem.tense_sentences.length; i++) {
            if (currentViewedWord !== word || thisSession !== currentAudioSession) break;
            
            // 🚨 防護
            let safeText = (cacheItem.tense_sentences[i].en || '').replace(/'/g, "");
            
            let randomVoice = null;
            
            if (appSettings.randomVoiceAuto && filteredVoices.length > 0) {
                const randomIndex = Math.floor(Math.random() * filteredVoices.length);
                randomVoice = filteredVoices[randomIndex];
            }

            if (sentenceNodes[i]) sentenceNodes[i].classList.add('playing-sentence');

            await playAudioAsync(safeText, true, randomVoice);
            
            if (sentenceNodes[i]) sentenceNodes[i].classList.remove('playing-sentence');

            if (currentViewedWord !== word || thisSession !== currentAudioSession) break;
            
            if (i < cacheItem.tense_sentences.length - 1) {
                await delay(800); 
                if (thisSession !== currentAudioSession) break;
            }
        }
    } finally {
        const currentBtn = document.getElementById('playAllSentencesBtn');
        if (currentBtn) {
            currentBtn.classList.remove('playing');
        }
        
        sentenceNodes.forEach(node => node.classList.remove('playing-sentence'));
    }
}

function getRandomVoiceForCurrentAccent() {
    const voices = window.speechSynthesis.getVoices();
    const accentMap = { 'US': 'en-US', 'UK': 'en-GB', 'CA': 'en-CA', 'AU': 'en-AU' };
    const targetLang = accentMap[appSettings.accent] || 'en-US';
    const filteredVoices = voices.filter(v => v.lang.replace('_', '-').includes(targetLang));
    
    if (filteredVoices.length > 0) {
        const randomIndex = Math.floor(Math.random() * filteredVoices.length);
        return filteredVoices[randomIndex];
    }
    return null;
}

function playSentenceAudio(text, element = null) {
    let randomVoice = null;
    if (appSettings.randomVoiceManual) {
        randomVoice = getRandomVoiceForCurrentAccent();
    }
    
    document.querySelectorAll('.sentence-item.playing-sentence').forEach(n => n.classList.remove('playing-sentence'));
    
    if (element) {
        element.classList.add('playing-sentence');
    }

    playAudio(text, () => {
        if (element) element.classList.remove('playing-sentence');
    }, false, randomVoice);
}

function updateSearchPlaceholder() {
    const input = document.getElementById('wordInput');
    if (!input) return;

    if (window.innerWidth <= 600) {
        input.placeholder = "Search...";      
    } else {
        input.placeholder = "Search for a word..."; 
    }
}

window.addEventListener('load', updateSearchPlaceholder);
window.addEventListener('resize', updateSearchPlaceholder);

// --- 全域變數 ---
let appSettings = JSON.parse(localStorage.getItem('appSettings')) || {
    autoVoice: false,
    autoPlay: false,
    readSentences: true,
    interval: 1.5,
    showCardActions: true,
    pronounceCount: 1,
    accent: 'US',
    pinnedItems: [],
    voiceName: {},
    randomVoiceManual: false,
    randomVoiceAuto: false,
    hideSentenceZh: false
};
if (!Array.isArray(appSettings.lockedLevels)) appSettings.lockedLevels = [];
if (appSettings.pronounceCount === undefined) appSettings.pronounceCount = 1;
if (appSettings.accent === undefined) appSettings.accent = 'US';
if (appSettings.readSentences === undefined) appSettings.readSentences = true;
if (appSettings.randomVoiceManual === undefined) appSettings.randomVoiceManual = false; 
if (appSettings.randomVoiceAuto === undefined) appSettings.randomVoiceAuto = false;     
if (appSettings.hideSentenceZh === undefined) appSettings.hideSentenceZh = false;

if (appSettings.hideSentenceZh) {
    document.body.classList.add('hide-sentence-zh');
} else {
    document.body.classList.remove('hide-sentence-zh');
}

if (typeof appSettings.voiceName === 'string') {
    appSettings.voiceName = { [appSettings.accent]: appSettings.voiceName };
} else if (!appSettings.voiceName) {
    appSettings.voiceName = {};
}

if (!Array.isArray(appSettings.pinnedItems)) appSettings.pinnedItems = [];

function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    
    document.getElementById('set-auto-voice').checked = appSettings.autoVoice;
    const countInput = document.getElementById('set-pronounce-count');
    if (countInput) countInput.value = appSettings.pronounceCount;
    const countSetting = document.getElementById('pronounce-count-setting');
    if (countSetting) countSetting.classList.toggle('active', appSettings.autoVoice);
    document.getElementById('set-auto-play').checked = appSettings.autoPlay;

    const rsCheckbox = document.getElementById('set-read-sentences');
    if (rsCheckbox) rsCheckbox.checked = appSettings.readSentences;

    const randomManualCheckbox = document.getElementById('set-random-manual');
    if (randomManualCheckbox) randomManualCheckbox.checked = appSettings.randomVoiceManual;

    const randomAutoCheckbox = document.getElementById('set-random-auto');
    if (randomAutoCheckbox) randomAutoCheckbox.checked = appSettings.randomVoiceAuto;

    const accentWrapper = document.getElementById('accentSelectWrapper');
    if (accentWrapper) {
        accentWrapper.setAttribute('data-value', appSettings.accent);
        document.getElementById('currentAccentText').textContent = appSettings.accent;
        
        const options = accentWrapper.querySelectorAll('.accent-option');
        options.forEach(opt => {
            if (opt.getAttribute('data-value') === appSettings.accent) {
                opt.classList.add('selected');
            } else {
                opt.classList.remove('selected');
            }
        });
    }
    
    const rsSetting = document.getElementById('read-sentences-setting');
    if (rsSetting) rsSetting.classList.toggle('active', appSettings.autoPlay);

    const hideZhCheckbox = document.getElementById('set-hide-sentence-zh');
    if (hideZhCheckbox) hideZhCheckbox.checked = appSettings.hideSentenceZh;

    updatePinUI();
    populateVoiceList();
    modal.classList.add('active');
}

function closeSettingsModal() {
    document.getElementById('settingsModal').classList.remove('active');
}

document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target.id === 'settingsModal') closeSettingsModal();
});

function updateSetting(key) {
    if (key === 'autoVoice') {
        appSettings.autoVoice = document.getElementById('set-auto-voice').checked;
        const countSetting = document.getElementById('pronounce-count-setting');
        if (countSetting) countSetting.classList.toggle('active', appSettings.autoVoice);
    }
    else if (key === 'accent') {
        const wrapper = document.getElementById('accentSelectWrapper');
        if (wrapper) {
            appSettings.accent = wrapper.getAttribute('data-value');
            populateVoiceList();
        }
    }
    else if (key === 'pronounceCount') {
        const val = parseInt(document.getElementById('set-pronounce-count').value);
        appSettings.pronounceCount = (val > 0) ? val : 1;
    }
    else if (key === 'voicePerson') {
        const wrapper = document.getElementById('personSelectWrapper');
        if (wrapper) {
            if (!appSettings.voiceName) appSettings.voiceName = {};
            appSettings.voiceName[appSettings.accent] = wrapper.getAttribute('data-value') || '';
        }
    }
    else if (key === 'autoPlay') {
        appSettings.autoPlay = document.getElementById('set-auto-play').checked;
        const rsEl = document.getElementById('read-sentences-setting');
        if (rsEl) rsEl.classList.toggle('active', appSettings.autoPlay);
    } 
    else if (key === 'readSentences') {
        appSettings.readSentences = document.getElementById('set-read-sentences').checked;
    }
    else if (key === 'randomVoiceManual') {
        appSettings.randomVoiceManual = document.getElementById('set-random-manual').checked;
    }
    else if (key === 'randomVoiceAuto') {
        appSettings.randomVoiceAuto = document.getElementById('set-random-auto').checked;
    }
    else if (key === 'showCardActions') {
        appSettings.showCardActions = document.getElementById('toggle-card-actions').checked;
        
        if (appSettings.showCardActions) {
            document.body.classList.remove('hide-card-actions');
        } else {
            document.body.classList.add('hide-card-actions');
        }
        if (currentViewedWord && wordDetailsCache[currentViewedWord]) {
            const cardArea = document.getElementById('cardArea');
            if (cardArea && cardArea.style.display !== 'none') {
                renderCard(wordDetailsCache[currentViewedWord], true);
            }
        }
    }
    else if (key === 'hideSentenceZh') {
        appSettings.hideSentenceZh = document.getElementById('set-hide-sentence-zh').checked;
        
        if (appSettings.hideSentenceZh) {
            document.body.classList.add('hide-sentence-zh');
        } else {
            document.body.classList.remove('hide-sentence-zh');
        }
    }
    localStorage.setItem('appSettings', JSON.stringify(appSettings));
    if (typeof renderPinnedActions === 'function') {
        renderPinnedActions();
    }
}

const toggleCardActionsBtn = document.getElementById('toggle-card-actions');
if (toggleCardActionsBtn) {
    if (appSettings.showCardActions === undefined) {
        appSettings.showCardActions = true;
    }
    toggleCardActionsBtn.checked = appSettings.showCardActions;
    if (appSettings.showCardActions) {
        document.body.classList.remove('hide-card-actions');
    } else {
        document.body.classList.add('hide-card-actions');
    }
}

function enableEditMode(word) {
    document.getElementById(`trans-view-${word}`).style.display = 'none';
    document.getElementById(`trans-edit-${word}`).style.display = 'block';
    
    const cacheItem = wordDetailsCache[word] || historyData.find(i => i.word === word) || {};
    const transInput = document.getElementById(`input-trans-${word}`);
    const posInput = document.getElementById(`input-pos-${word}`);
    
    if (transInput) transInput.value = cacheItem.translation || '';
    if (posInput) posInput.value = cacheItem.part_of_speech || '';
    
    if (transInput) transInput.focus();
}

function cancelEditMode(word) {
    document.getElementById(`trans-view-${word}`).style.display = 'flex';
    document.getElementById(`trans-edit-${word}`).style.display = 'none';
}

async function saveTranslation(word) {
    const transInput = document.getElementById(`input-trans-${word}`);
    const posInput = document.getElementById(`input-pos-${word}`);
    
    if (!transInput) return;

    const newTrans = transInput.value.trim();
    const newPos = posInput ? posInput.value.trim() : '';

    const transParts = newTrans.split('/');
    const posParts = newPos.split('/');
    const maxLen = Math.max(transParts.length, posParts.length);
    
    let segmentsHtml = '';
    for (let i = 0; i < maxLen; i++) {
        const t = (transParts[i] || '').trim();
        const p = (posParts[i] || '').trim();
        if (t || p) {
            const displayPos = POS_ABBR_MAP[p.toLowerCase()] || p;
            const posHtml = displayPos ? `<span class="pos-tag">${displayPos}</span>` : '';
            const transHtml = t ? `<span class="trans-text">${t}</span>` : '';
            segmentsHtml += 
                `<span class="trans-segment">
                    ${transHtml}
                    ${posHtml}
                </span>`;
        }
    }
    
    const wrapper = document.getElementById(`trans-wrapper-${word}`);
    if (wrapper) wrapper.innerHTML = segmentsHtml;
    cancelEditMode(word);

    if (!wordDetailsCache[word]) {
        wordDetailsCache[word] = historyData.find(i => i.word === word) || { word: word };
    }
    const oldTrans = wordDetailsCache[word].translation;
    const oldPos = wordDetailsCache[word].part_of_speech;
    
    wordDetailsCache[word].translation = newTrans;
    wordDetailsCache[word].part_of_speech = newPos;

    const historyItem = historyData.find(i => i.word === word);
    if (historyItem) {
        historyItem.translation = newTrans;
        historyItem.part_of_speech = newPos;
    }

    const currentForms = wordDetailsCache[word].forms || {};
    const isVerb = /\bverb\b/i.test(newPos);
    const isFormsEmpty = !currentForms.past && !currentForms.continuous && !currentForms.future && !currentForms.perfect;
    
    if (isVerb && isFormsEmpty) {
        if (typeof pendingRequests !== 'undefined') pendingRequests.forms.add(word);
        const regenBtn = document.getElementById(`btn-regen-forms-${word}`);
        if (regenBtn) {
            regenBtn.innerHTML = `
                <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
            `;
            regenBtn.disabled = true;
            regenBtn.style.cursor = 'default';
        }
    }

    try {
        const data = await gasFetch('updateDetails', { word: word, translation: newTrans, part_of_speech: newPos });

        if (data.success && data.entry) {
            wordDetailsCache[word] = data.entry;
            
            if (typeof pendingRequests !== 'undefined') pendingRequests.forms.delete(word);

            if (currentViewedWord === word) {
                const container = document.getElementById(`forms-container-${word}`);
                if (container) {
                    container.classList.remove('not-verb');
                    container.classList.add('is-verb');
                    
                    const oldGrid = container.querySelector('.forms-grid');
                    if (oldGrid) oldGrid.remove();
                    
                    const newGridHtml = generateFormsHtml(data.entry.forms);
                    container.insertAdjacentHTML('beforeend', newGridHtml);
                    
                    const newGrid = container.querySelector('.forms-grid');
                    if (newGrid) newGrid.style.animation = 'fadeIn 0.5s ease';
                }

                const currentRegenBtn = document.getElementById(`btn-regen-forms-${word}`);
                if (currentRegenBtn) {
                    currentRegenBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>`;
                    currentRegenBtn.disabled = false;
                    currentRegenBtn.style.cursor = 'pointer';
                }
            }
        }
    } catch (e) {
        console.error("Save error:", e);
        wordDetailsCache[word].translation = oldTrans;
        wordDetailsCache[word].part_of_speech = oldPos;
        if (historyItem) {
            historyItem.translation = oldTrans;
            historyItem.part_of_speech = oldPos;
        }

        const currentRegenBtn = document.getElementById(`btn-regen-forms-${word}`);
        if (currentRegenBtn) {
            currentRegenBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>`;
            currentRegenBtn.disabled = false;
            currentRegenBtn.style.cursor = 'pointer';
        }
    } finally {
        if (typeof pendingRequests !== 'undefined') pendingRequests.forms.delete(word);
    }
}

const POS_OPTIONS = ["noun", "pronoun", "verb", "adjective", "adverb", "preposition", "conjunction", "interjection", "phrase", "auxiliary verb", "prefix", "exclamation"];
const POS_ABBR_MAP = {
    "noun": "n.",
    "pronoun": "pron.",
    "verb": "v.",
    "adjective": "adj.",
    "adverb": "adv.",
    "preposition": "prep.",
    "conjunction": "conj.",
    "interjection": "int.",
    "phrase": "phr.",
    "auxiliary verb": "aux.",
    "prefix": "pref.",
    "exclamation": "excl."
};

function handlePosInput(input) {
    const dataList = document.getElementById('fixed-pos-list');
    if (!dataList) return;

    const val = input.value;
    const lastSlashIndex = val.lastIndexOf('/');
    
    if (lastSlashIndex === -1) {
        if (dataList.dataset.currentPrefix !== 'base') {
            dataList.innerHTML = POS_OPTIONS.map(opt => `<option value="${opt}">`).join('');
            dataList.dataset.currentPrefix = 'base';
        }
        return;
    }

    const prefix = val.substring(0, lastSlashIndex + 1);

    const isCompleteOption = POS_OPTIONS.some(opt => val === prefix + opt);
    if (isCompleteOption) return;

    if (dataList.dataset.currentPrefix === prefix) return;

    dataList.innerHTML = POS_OPTIONS.map(opt => `<option value="${prefix}${opt}">`).join('');
    dataList.dataset.currentPrefix = prefix;
}

function enableEditDef(word) {
    document.getElementById(`disp-def-${word}`).style.display = 'none';
    document.getElementById(`btn-edit-def-${word}`).style.display = 'none';
    
    document.getElementById(`def-edit-mode-${word}`).style.display = 'block';
    
    const input = document.getElementById(`input-def-${word}`);
    const cacheItem = wordDetailsCache[word] || historyData.find(i => i.word === word) || {};
    
    if (input) {
        input.value = cacheItem.definition || '';
        
        input.focus();
        input.selectionStart = input.selectionEnd = input.value.length;
        input.style.height = 'auto'; 
        input.style.height = input.scrollHeight + 'px';
    }
}

function cancelEditDef(word) {
    document.getElementById(`disp-def-${word}`).style.display = '';
    document.getElementById(`btn-edit-def-${word}`).style.display = '';
    
    document.getElementById(`def-edit-mode-${word}`).style.display = 'none';
    
    const cacheItem = wordDetailsCache[word] || historyData.find(i => i.word === word) || {};
    const input = document.getElementById(`input-def-${word}`);
    if (input) {
        input.value = cacheItem.definition || '';
    }
}

async function saveDefinition(word) {
    const input = document.getElementById(`input-def-${word}`);
    if (!input) return;

    const newDef = input.value.trim();
    const cacheItem = wordDetailsCache[word] || historyData.find(i => i.word === word) || {};
    
    const oldDef = cacheItem.definition || ''; 
    
    cacheItem.definition = newDef;
    
    const displayEl = document.getElementById(`disp-def-${word}`);
    if (displayEl) {
        displayEl.innerText = newDef;
    }
    
    cancelEditDef(word);

    try {
        const data = await gasFetch('updateDetails', { word: word, definition: newDef });

        if (!data.success) {
            cacheItem.definition = oldDef;
            if (displayEl) displayEl.innerText = oldDef;
            openAlertModal(data.error || "Failed to save definition.");
        }
    } catch (e) {
        console.error(e);
        cacheItem.definition = oldDef;
        if (displayEl) displayEl.innerText = oldDef;
        openAlertModal("Error connecting to server.");
    }
}

let currentEditingFormsWord = null;

function openEditFormsModal(word) {
    currentEditingFormsWord = word;
    
    const item = wordDetailsCache[word] || historyData.find(i => i.word === word) || {}; 
    const f = item.forms || {};

    document.getElementById('editFormPast').value = f.past || '';
    document.getElementById('editFormCont').value = f.continuous || '';
    document.getElementById('editFormFut').value = f.future || '';
    document.getElementById('editFormPerf').value = f.perfect || '';

    const modal = document.getElementById('editFormsModal');
    if (modal) modal.classList.add('active');
}

function closeEditFormsModal() {
    document.getElementById('editFormsModal').classList.remove('active');
    currentEditingFormsWord = null;
}

document.getElementById('editFormsModal').addEventListener('click', (e) => {
    if (e.target.id === 'editFormsModal') closeEditFormsModal();
});

async function saveForms() {
    if (!currentEditingFormsWord) return;
    
    const targetWord = currentEditingFormsWord;

    const newForms = {
        past: document.getElementById('editFormPast').value.trim(),
        continuous: document.getElementById('editFormCont').value.trim(),
        future: document.getElementById('editFormFut').value.trim(),
        perfect: document.getElementById('editFormPerf').value.trim()
    };

    try {
        const data = await gasFetch('updateDetails', { word: targetWord, forms: newForms });

        if (data.success) {
            const updatedEntry = data.entry;
            
            if (updatedEntry) {
                wordDetailsCache[targetWord] = updatedEntry;
                renderCard(updatedEntry, true); 
            } else {
                if (!wordDetailsCache[targetWord]) {
                    wordDetailsCache[targetWord] = historyData.find(i => i.word === targetWord) || { word: targetWord };
                }
                wordDetailsCache[targetWord].forms = newForms;
                renderCard(wordDetailsCache[targetWord], true);
            }

            closeEditFormsModal();
        } else {
            alert("Update failed.");
        }
    } catch (e) {
        console.error(e);
        alert("Error updating forms.");
    }
}

function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {

        if (e.repeat) return;

        const cardArea = document.getElementById('cardArea');
        if (!cardArea || cardArea.style.display === 'none') return;

        if (e.altKey && document.body.classList.contains('hide-card-actions')) {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
                return; 
            }
        }

        if (e.altKey) {
            const key = e.key.toLowerCase(); 

            const levelKeys = ['0', '1', '2', '3', '4', '5', '6'];
            if (levelKeys.includes(key)) {
                e.preventDefault();
                const targetBtn = document.querySelector(`.level-btn[data-lvl="${key}"]`);
                if (targetBtn && !targetBtn.disabled) { 
                    targetBtn.click();
                    targetBtn.focus();
                    setTimeout(() => targetBtn.blur(), 200);
                }
                return;
            }

            const statusMap = {
                'n': 'new',
                'l': 'learning',
                'm': 'mastered'
            };

            if (statusMap[key]) {
                e.preventDefault();
                const targetBtn = document.querySelector(`.status-btn.${statusMap[key]}`);
                if (targetBtn) {
                    targetBtn.click();
                    targetBtn.focus();
                    setTimeout(() => targetBtn.blur(), 200);
                }
                return;
            }
        }

        if (e.altKey && e.key.toLowerCase() === 's') {
            const saveBtns = document.querySelectorAll('.save-btn-mini');
            for (let btn of saveBtns) {
                if (btn.offsetParent !== null) {
                    e.preventDefault();
                    btn.click();
                    return;
                }
            }
        }

        if (e.altKey && e.key.toLowerCase() === 'e') {
            const tranBtn = document.querySelector('.translation-edit-btn');
            if (tranBtn) {
                e.preventDefault();
                tranBtn.click();
                return;
            }
        }

        if (e.altKey && e.key.toLowerCase() === 't') {
            const explainBtn = document.querySelector('.explain-text-edit');
            if (explainBtn) {
                e.preventDefault();
                explainBtn.click();
                return;
            }
        }

        if (e.altKey && e.key.toLowerCase() === 'v') {
            const verbform = document.querySelector('.verb-form-re');
            if (verbform) {
                e.preventDefault();
                verbform.click();
                return;
            }
        }

        if (e.altKey && e.key.toLowerCase() === 'd') {
            const resentences = document.getElementById('REsentencesbtn');
            if (resentences) {
                e.preventDefault();
                resentences.click();
                return;
            }
        }

        if (e.altKey && e.key.toLowerCase() === 'z') {
            const resentences = document.getElementById('playAllSentencesBtn');
            if (resentences) {
                e.preventDefault();
                resentences.click();
                return;
            }
        }
        
        const active = document.activeElement;
        if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable) {
            return;
        }

        if (e.key === 'ArrowLeft') {
            navigateHistory(-1); 
        } else if (e.key === 'ArrowRight') {
            navigateHistory(1);  
        }
        
    });
}

async function regenerateSentences(word) {
    if (typeof pendingRequests !== 'undefined') pendingRequests.sentences.add(word);

    const btn = document.getElementById('REsentencesbtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;
    }

    try {
        const data = await gasFetch('generateSentences', { word: word });

        if (data.success) {
            if (!wordDetailsCache[word]) {
                wordDetailsCache[word] = historyData.find(i => i.word === word) || { word: word };
            }
            wordDetailsCache[word].tense_sentences = data.sentences;

            if (currentViewedWord === word) {
                const container = document.getElementById('sentences-container');
                if (container) {
                    const sentencesHtml = (data.sentences && data.sentences.length > 0) 
                        ? data.sentences.map(s => {
                            // 🚨 防護
                            const safeText = (s.en || '').replace(/'/g, "\\'"); 
                            return `
                            <div class="sentence-item" onclick="playSentenceAudio('${safeText}', this)" title="Click to listen">
                                <div class="st-en-wrapper">
                                    <div class="st-en">${s.en || ''}</div>
                                    <button class="audio-btn-sm" onclick="playSentenceAudio('${safeText}')" title="Listen">
                                        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px">
                                            <path d="M560-131v-82q90-26 145-100t55-168q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 127-78 224.5T560-131ZM120-360v-240h160l200-200v640L280-360H120Zm440 40v-322q47 22 73.5 66t26.5 96q0 51-26.5 94.5T560-320ZM400-606l-86 86H200v80h114l86 86v-252ZM300-480Z"/>
                                        </svg>
                                    </button>
                                </div>
                                
                                <div class="zh-row">
                                    <button class="zh-eye-btn" onclick="event.stopPropagation(); toggleZhVisibility(this)" title="Toggle Translation">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M10 9.17a3 3 0 1 0 0 5.66"/><path d="M17 9.17a3 3 0 1 0 0 5.66"/><rect x="2" y="5" width="20" height="14" rx="2"/>
                                        </svg>
                                    </button>
                                    <div class="st-zh">${s.zh || ''} (${s.type || ''}${s.tense ? '/' + s.tense : ''})</div>
                                </div>
                            </div>`;
                        }).join('') 
                        : '<div class="no-data">No context sentences available.</div>';
                    
                    container.innerHTML = sentencesHtml;
                    container.style.animation = 'none';
                    container.offsetHeight; 
                    container.style.animation = 'fadeIn 0.5s ease';

                    if (appSettings.autoPlay && appSettings.readSentences) {
                        (async () => {
                            currentAudioSession = Date.now();
                            const thisSession = currentAudioSession;
                            await delay(500); 
                            
                            const sentenceNodes = document.querySelectorAll('#sentences-container .sentence-item');
                            
                            try {
                                for (let i = 0; i < data.sentences.length; i++) {
                                    if (currentViewedWord !== word || thisSession !== currentAudioSession) return; 
                                    // 🚨 防護
                                    let safeText = (data.sentences[i].en || '').replace(/'/g, ""); 
                                    let autoVoice = appSettings.randomVoiceAuto ? getRandomVoiceForCurrentAccent() : null;
                                    
                                    if (sentenceNodes[i]) sentenceNodes[i].classList.add('playing-sentence');
                                    
                                    await playAudioAsync(safeText, true, autoVoice); 
                                    
                                    if (sentenceNodes[i]) sentenceNodes[i].classList.remove('playing-sentence');
                                    
                                    if (i < data.sentences.length - 1) {
                                        await delay(800);
                                        if (thisSession !== currentAudioSession) return;
                                    }
                                }
                            } finally {
                                sentenceNodes.forEach(n => n.classList.remove('playing-sentence'));
                            }
                            
                            const currentIndex = filteredData.findIndex(item => item.word === word);
                            const hasNext = (currentIndex !== -1 && currentIndex < filteredData.length - 1);
                            if (hasNext && currentViewedWord === word && thisSession === currentAudioSession) {
                                await delay(1500);
                                if (currentViewedWord === word && thisSession === currentAudioSession) navigateHistory(1);
                            }
                        })();
                    }
                }
            }
        } else {
            alert("Generation failed.");
        }
    } catch (e) {
        console.error(e);
        alert("Error regenerating sentences.");
    } finally {
        if (typeof pendingRequests !== 'undefined') pendingRequests.sentences.delete(word);
        
        const currentBtn = document.getElementById('REsentencesbtn');
        if (currentBtn && currentViewedWord === word) {
            currentBtn.disabled = false;
            currentBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`;
        }
    }
}

function updateCurrentIndexDisplay(word) {
    const el = document.querySelector('.index-count');
    if (!el) return;

    el.innerText = `${lockedDisplayIndex} / ${lockedDisplayTotal}`;
}

function generateFormsHtml(forms) {
    const f = forms || {};
    const getClickAttr = (val) => {
        return (val && val !== '-') ? `onclick="playAudio('${val.replace(/'/g, "\\'")}')"` : '';
    };
    return `
        <div class="forms-grid">
            <div class="form-cell" ${getClickAttr(f.past)}>
                <span class="form-label">Past</span>
                <span class="form-val">${f.past || '-'}</span>
            </div>
            <div class="form-cell" ${getClickAttr(f.continuous)}>
                <span class="form-label">Continuous</span>
                <span class="form-val">${f.continuous || '-'}</span>
            </div>
            <div class="form-cell" ${getClickAttr(f.future)}>
                <span class="form-label">Future</span>
                <span class="form-val">${f.future || '-'}</span>
            </div>
            <div class="form-cell" ${getClickAttr(f.perfect)}>
                <span class="form-label">Perfect</span>
                <span class="form-val">${f.perfect || '-'}</span>
            </div>
        </div>
    `;
}

function clearModalInputs() {
    const past = document.getElementById('editFormPast');
    const cont = document.getElementById('editFormCont');
    const fut = document.getElementById('editFormFut');
    const perf = document.getElementById('editFormPerf');

    if(past) past.value = '';
    if(cont) cont.value = '';
    if(fut) fut.value = '';
    if(perf) perf.value = '';
    
    if(past) past.focus();
}

async function regenerateVerbForms(word) {
    if (typeof pendingRequests !== 'undefined') pendingRequests.forms.add(word);

    const btn = document.getElementById(`btn-regen-forms-${word}`);
    const container = document.getElementById(`forms-container-${word}`);
    
    if (btn) {
        btn.innerHTML = `
            <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
        `;
        btn.disabled = true;
        btn.style.cursor = 'default';
    }

    try {
        const data = await gasFetch('generateForms', { word: word });

        if (data.success && data.forms) {
            if (!wordDetailsCache[word]) {
                wordDetailsCache[word] = historyData.find(i => i.word === word) || { word: word };
            }
            wordDetailsCache[word].forms = data.forms;
            
            if (currentViewedWord === word && container) {
                const oldGrid = container.querySelector('.forms-grid');
                if (oldGrid) oldGrid.remove();
                
                const newGridHtml = generateFormsHtml(data.forms);
                container.insertAdjacentHTML('beforeend', newGridHtml);
                
                const newGrid = container.querySelector('.forms-grid');
                if (newGrid) newGrid.style.animation = 'fadeIn 0.5s ease';
            }
        } else {
            openAlertModal(data.error || "Word is not a verb.");
        }
    } catch (e) {
        console.error(e);
        openAlertModal("Error connecting to server.");
    } finally {
        if (typeof pendingRequests !== 'undefined') pendingRequests.forms.delete(word);
        
        const currentBtn = document.getElementById(`btn-regen-forms-${word}`);
        if (currentBtn && currentViewedWord === word) {
            currentBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>`;
            currentBtn.disabled = false;         
            currentBtn.style.cursor = 'pointer'; 
        }
    }
}

function openAlertModal(message) {
    const modal = document.getElementById('alertModal');
    const msgEl = document.getElementById('alertMessage');
    
    if (modal && msgEl) {
        msgEl.textContent = message;
        
        modal.style.display = 'flex';
        
        setTimeout(() => {
            modal.style.opacity = '1';
            modal.style.visibility = 'visible'; 
        }, 10);
    }
}

function closeAlertModal() {
    const modal = document.getElementById('alertModal');
    if (modal) {
        modal.style.opacity = '0';
        
        setTimeout(() => {
            modal.style.display = 'none';
            modal.style.visibility = 'hidden';
        }, 300); 
    }
}

function handleHeaderClick(event) {
    const clickedInteractive = event.target.closest('button, input, textarea');
    
    const isAudioBtn = event.target.closest('.audio-btn') || event.target.closest('#vocabulary-audio-btn');
    if (clickedInteractive && !isAudioBtn) {
        return;
    }
    if (!clickedInteractive) {
        let audioBtn = event.currentTarget.querySelector('.audio-btn');
        
        if (!audioBtn) {
            audioBtn = document.getElementById('vocabulary-audio-btn');
        }
        
        if (audioBtn) {
            audioBtn.click();
        }
    }
}

function initAccentSelect() {
    const wrapper = document.getElementById('accentSelectWrapper');
    if (!wrapper) return;
    const trigger = wrapper.querySelector('.custom-select-trigger');
    const options = wrapper.querySelectorAll('.accent-option');
    const currentText = document.getElementById('currentAccentText');

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        wrapper.classList.toggle('open');
    });

    options.forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            options.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            
            const value = option.getAttribute('data-value');
            currentText.textContent = value;
            wrapper.setAttribute('data-value', value);
            wrapper.classList.remove('open');
            
            updateSetting('accent');
        });
    });

    window.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            wrapper.classList.remove('open');
        }
    });
}

function togglePin(key) {
    const idx = appSettings.pinnedItems.indexOf(key);
    if (idx === -1) {
        appSettings.pinnedItems.push(key); 
    } else {
        appSettings.pinnedItems.splice(idx, 1); 
    }
    localStorage.setItem('appSettings', JSON.stringify(appSettings));
    
    updatePinUI();
    renderPinnedActions();
}

function updatePinUI() {
    document.querySelectorAll('.pin-btn').forEach(btn => {
        const key = btn.dataset.key; 
        if (appSettings.pinnedItems.includes(key)) {
            btn.classList.add('pinned');
        } else {
            btn.classList.remove('pinned');
        }
    });
}

function renderPinnedActions() {
    let container = document.getElementById('pinnedActionsContainer');
    if (!container) return;
    
    container.innerHTML = '';
    appSettings.pinnedItems.forEach(key => {
        const btn = document.createElement('button');
        btn.className = 'quick-action-btn';
        btn.onclick = () => handleQuickAction(key);
        
        if (key === 'autoVoice') {
            btn.title = 'Toggle Auto Pronounce';
            btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.236 22a3 3 0 0 0-2.2-5"/><path d="M16 20a3 3 0 0 1 3-3h1a2 2 0 0 0 2-2v-2a4 4 0 0 0-4-4V4"/><path d="M18 13h.01"/><path d="M18 6a4 4 0 0 0-4 4 7 7 0 0 0-7 7c0-5 4-5 4-10.5a4.5 4.5 0 1 0-9 0 2.5 2.5 0 0 0 5 0C7 10 3 11 3 17c0 2.8 2.2 5 5 5h10"/></svg>`;
            if (appSettings.autoVoice) btn.classList.add('active');
            
        } else if (key === 'autoPlay') {
            btn.title = 'Toggle Auto Play';
            btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/></svg>`;
            if (appSettings.autoPlay) btn.classList.add('active');
            
        } else if (key === 'randomVoiceManual') {
            btn.title = 'Toggle Random Voice (Click)';
            btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6h.01"/><path d="M18 6h.01"/><path d="M6.5 13.1h.01"/><path d="M22 5c0 9-4 12-6 12s-6-3-6-12c0-2 2-3 6-3s6 1 6 3"/><path d="M17.4 9.9c-.8.8-2 .8-2.8 0"/><path d="M10.1 7.1C9 7.2 7.7 7.7 6 8.6c-3.5 2-4.7 3.9-3.7 5.6 4.5 7.8 9.5 8.4 11.2 7.4.9-.5 1.9-2.1 1.9-4.7"/><path d="M9.1 16.5c.3-1.1 1.4-1.7 2.4-1.4"/></svg>`;
            if (appSettings.randomVoiceManual) btn.classList.add('active');
            
        } else if (key === 'randomVoiceAuto') {
            btn.title = 'Toggle Random Voice (Auto)';
            btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z"/><path d="M12 12v.01"/></svg>`;
            if (appSettings.randomVoiceAuto) btn.classList.add('active');

        } else if (key === 'showCardActions') {
            btn.title = 'Toggle Action Buttons';
            btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 12h.01"/><path d="M13 22c.5-.5 1.12-1 2.5-1-1.38 0-2-.5-2.5-1"/><path d="M14 2a3.28 3.28 0 0 1-3.227 1.798l-6.17-.561A2.387 2.387 0 1 0 4.387 8H15.5a1 1 0 0 1 0 13 1 1 0 0 0 0-5H12a7 7 0 0 1-7-7V8"/><path d="M14 8a8.5 8.5 0 0 1 0 8"/><path d="M16 16c2 0 4.5-4 4-6"/></svg>`;
            if (appSettings.showCardActions) btn.classList.add('active');

        } else if (key === 'resetViews') {
            btn.title = 'Reset All Views';
            btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 22-1-4"/><path d="M19 14a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v1a1 1 0 0 0 1 1"/><path d="M19 14H5l-1.973 6.767A1 1 0 0 0 4 22h16a1 1 0 0 0 .973-1.233z"/><path d="m8 22 1-4"/></svg>`;
            
        } else if (key === 'accent') {
            btn.title = 'Switch Voice Accent';
            btn.innerText = appSettings.accent; 
            btn.classList.add('active'); 
        }
        else if (key === 'hideSentenceZh') {
            btn.title = 'Toggle Sentence Translation';
            btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;
            if (appSettings.hideSentenceZh) btn.classList.add('active');
        }
        
        container.appendChild(btn);
    });
}

function handleQuickAction(key) {

    if (key === 'resetViews') {
        confirmResetViews();
        return; 
    }

    if (key === 'accent') {
        const accents = ['US', 'UK', 'CA', 'AU'];
        let idx = accents.indexOf(appSettings.accent);
        appSettings.accent = accents[(idx + 1) % accents.length];
        
        const accentWrapper = document.getElementById('accentSelectWrapper');
        if (accentWrapper) {
            accentWrapper.setAttribute('data-value', appSettings.accent);
            const txt = document.getElementById('currentAccentText');
            if (txt) txt.textContent = appSettings.accent;
            accentWrapper.querySelectorAll('.accent-option').forEach(opt => {
                if (opt.getAttribute('data-value') === appSettings.accent) {
                    opt.classList.add('selected');
                } else {
                    opt.classList.remove('selected');
                }
            });
        }
        populateVoiceList();
        localStorage.setItem('appSettings', JSON.stringify(appSettings));
    } 
    else {
        let cbId = '';
        if (key === 'autoVoice') cbId = 'set-auto-voice';
        if (key === 'autoPlay') cbId = 'set-auto-play';
        if (key === 'showCardActions') cbId = 'toggle-card-actions';
        if (key === 'randomVoiceManual') cbId = 'set-random-manual';
        if (key === 'randomVoiceAuto') cbId = 'set-random-auto';
        if (key === 'hideSentenceZh') cbId = 'set-hide-sentence-zh';

        const cb = document.getElementById(cbId);
        if (cb) { 
            cb.checked = !cb.checked; 
            updateSetting(key); 
        }
    }
    
    renderPinnedActions();
}

function populateVoiceList() {
    const wrapper = document.getElementById('personSelectWrapper');
    const optionsContainer = document.getElementById('personOptionsContainer');
    const currentText = document.getElementById('currentPersonText');
    
    if (!wrapper || !optionsContainer) return;

    const voices = window.speechSynthesis.getVoices();
    const accentMap = { 'US': 'en-US', 'UK': 'en-GB', 'CA': 'en-CA', 'AU': 'en-AU' };
    const targetLang = accentMap[appSettings.accent] || 'en-US';

    const filteredVoices = voices.filter(v => v.lang.replace('_', '-').includes(targetLang));
    optionsContainer.innerHTML = '';

    const savedVoice = appSettings.voiceName[appSettings.accent] || '';

    const createOption = (actualName, displayName) => {
        const opt = document.createElement('div');
        opt.className = 'custom-option person-option';
        opt.setAttribute('data-value', actualName);
        opt.textContent = displayName;

        if (actualName === savedVoice) {
            opt.classList.add('selected');
            currentText.textContent = displayName || 'Default';
            wrapper.setAttribute('data-value', actualName);
        }

        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            optionsContainer.querySelectorAll('.person-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            
            currentText.textContent = displayName || 'Default';
            wrapper.setAttribute('data-value', actualName);
            wrapper.classList.remove('open');
            
            updateSetting('voicePerson');
        });

        optionsContainer.appendChild(opt);
    };

    let isMatched = false;

    createOption('', 'Default');
    if (savedVoice === '') isMatched = true;

    filteredVoices.forEach(v => {
        const cleanName = v.name.replace(/(Microsoft|Google|English|Online|\(Natural\))/gi, '').trim() || v.name;
        createOption(v.name, cleanName);
        if (v.name === savedVoice) isMatched = true;
    });

    if (!isMatched) {
        appSettings.voiceName[appSettings.accent] = '';
        currentText.textContent = 'Default';
        wrapper.setAttribute('data-value', '');
        const defOpt = optionsContainer.querySelector('[data-value=""]');
        if (defOpt) defOpt.classList.add('selected');
    }
}
window.speechSynthesis.onvoiceschanged = populateVoiceList;

function initPersonSelect() {
    const wrapper = document.getElementById('personSelectWrapper');
    if (!wrapper) return;
    const trigger = wrapper.querySelector('.custom-select-trigger');

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        wrapper.classList.toggle('open');
    });

    window.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            wrapper.classList.remove('open');
        }
    });
}

function updateCardNavigation(word) {
    if (!word) return;

    const btnPrev = document.getElementById('nav-btn-prev');
    const btnNext = document.getElementById('nav-btn-next');
    
    if (btnPrev) {
        btnPrev.disabled = !lockedPrevWord;
        const tooltipPrev = document.getElementById('tooltip-prev');
        if(tooltipPrev) tooltipPrev.innerText = lockedPrevWord ? lockedPrevWord : 'Start';
    }
    if (btnNext) {
        btnNext.disabled = !lockedNextWord;
        const tooltipNext = document.getElementById('tooltip-next');
        if(tooltipNext) tooltipNext.innerText = lockedNextWord ? lockedNextWord : 'End';
    }

    const mobileNavContainer = document.getElementById('mobile-nav-container');
    if (mobileNavContainer) {
        mobileNavContainer.innerHTML = `
             <button class="mobile-nav-btn" onclick="navigateHistory(-1)" ${!lockedPrevWord ? 'disabled' : ''}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
                Prev
             </button>
             <button class="mobile-nav-btn" onclick="navigateHistory(1)" ${!lockedNextWord ? 'disabled' : ''}>
                Next
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
             </button>
        `;
    }

    if (typeof preloadAdjacentWords === 'function') {
        setTimeout(() => preloadAdjacentWords(word), 500);
    }
}

function initSearchSuggestions() {
    const input = document.getElementById('wordInput');
    if (!input) return;

    input.parentElement.style.position = 'relative';

    let suggestionBox = document.createElement('div');
    suggestionBox.id = 'search-suggestions';
    suggestionBox.className = 'search-suggestions';
    input.parentElement.appendChild(suggestionBox);

    let currentFocus = -1;

    input.addEventListener('input', function() {
        const rawVal = this.value.trim().toLowerCase();
        suggestionBox.innerHTML = '';
        currentFocus = -1;

        if (!rawVal) {
            suggestionBox.style.display = 'none';
            return;
        }

        const isSuffixSearch = rawVal.startsWith('-');
        const val = isSuffixSearch ? rawVal.substring(1) : rawVal;
        const valNoSpace = val.replace(/\s+/g, '');

        if (isSuffixSearch && !valNoSpace) {
            suggestionBox.style.display = 'none';
            return;
        }

        const matches = historyData.filter(item => {
            const wNoSpace = (item.word || '').toLowerCase().replace(/\s+/g, '');
            return isSuffixSearch ? wNoSpace.endsWith(valNoSpace) : wNoSpace.startsWith(valNoSpace);
        });

        matches.sort((a, b) => (a.word || '').localeCompare(b.word || ''));

        if (matches.length === 0) {
            suggestionBox.style.display = 'none';
            return;
        }

        suggestionBox.style.display = 'block';

        matches.forEach(match => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            
            let splitIndex = 0;
            let nonSpaceCount = 0;
            const wordStr = match.word || '';
            
            if (isSuffixSearch) {
                splitIndex = wordStr.length;
                for (let i = wordStr.length - 1; i >= 0; i--) {
                    if (wordStr[i] !== ' ') nonSpaceCount++;
                    if (nonSpaceCount === valNoSpace.length) {
                        splitIndex = i;
                        break;
                    }
                }
            } else {
                for (let i = 0; i < wordStr.length; i++) {
                    if (wordStr[i] !== ' ') nonSpaceCount++;
                    if (nonSpaceCount === valNoSpace.length) {
                        splitIndex = i + 1;
                        break;
                    }
                }
            }

            let wordHtml = '';
            if (isSuffixSearch) {
                const restPart = wordStr.substring(0, splitIndex);
                const matchPart = wordStr.substring(splitIndex);
                wordHtml = `${restPart}<span class="suggestion-match">${matchPart}</span>`;
            } else {
                const matchPart = wordStr.substring(0, splitIndex);
                const restPart = wordStr.substring(splitIndex);
                wordHtml = `<span class="suggestion-match">${matchPart}</span>${restPart}`;
            }
            
            const rawTrans = match.translation || '';
            const rawPos = match.part_of_speech || '';
            const transParts = rawTrans.split('/');
            const posParts = rawPos.split('/');
            const maxLen = Math.max(transParts.length, posParts.length);
            
            let translationsHtml = '';

            for (let i = 0; i < maxLen; i++) {
                const t = (transParts[i] || '').trim();
                const p = (posParts[i] || '').trim();
                if (t || p) {
                    const displayPos = POS_ABBR_MAP[p.toLowerCase()] || p;
                    
                    const posHtml = displayPos ? `<span class="pos-tag" style="font-size: 0.65rem; margin-right: 0;">${displayPos}</span>` : '';
                    const transHtml = t ? `<span class="trans-text" style="font-size: 0.85rem; color: var(--text-muted);">${t}</span>` : '';
                    
                    let levelHtml = '';
                    if (i === 0) {
                        const hasLevel = match.stats && match.stats.level !== undefined && match.stats.level !== null;
                        const hasTag = match.exam_tag && match.exam_tag !== 'Level';

                        if (hasLevel) {
                            levelHtml = `<span class="sidebar-level-tag" data-lvl="${match.stats.level}" style="font-size: 0.6rem; padding: 3px 4px; margin-right: 8px; border-radius: 3px; display: inline-flex; align-items: center; justify-content: center; vertical-align: middle; line-height: 1; transform: translateY(-2px);">LV.${match.stats.level}</span>`;
                        } else if (hasTag) {
                            levelHtml = `<span class="sidebar-level-tag" data-tag="${match.exam_tag}" style="font-size: 0.6rem; padding: 3px 4px; margin-right: 8px; border-radius: 3px; display: inline-flex; align-items: center; justify-content: center; vertical-align: middle; line-height: 1; transform: translateY(-2px);">${match.exam_tag}</span>`;
                        }
                    }

                    translationsHtml += `
                        ${levelHtml}
                        <span class="trans-segment" style="margin-bottom: 0; margin-right: 3px; display: inline-flex; align-items: center; gap: 0;">
                            ${transHtml}${posHtml}
                        </span>`;
                }
            }

            const status = (match.stats && match.stats.status) ? match.stats.status : 'new';
            
            let segmentsHtml = `
                <div style="display: flex; align-items: center; justify-content: flex-end; width: 100%;">
                    
                    <div style="text-align: right;">
                        ${translationsHtml}
                    </div>

                    <div style="flex-shrink: 0; margin-left: 4px; display: flex; align-items: center;">
                        <span class="bg-${status}" style="width: 10px; height: 10px; border-radius: 50%; display: inline-block;"></span>
                    </div>

                </div>
            `;

            const safeWord = wordStr.replace(/'/g, "\\'");

            div.innerHTML = `
                <div class="sugg-word" style="display: flex; align-items: center;">
                    <span style="white-space: pre-wrap;">${wordHtml}</span>
                    <button class="audio-btn-sm" 
                            onmousedown="event.preventDefault(); event.stopPropagation();" 
                            onclick="event.stopPropagation(); playAudio('${safeWord}')" 
                            title="Listen" 
                            style="margin-top: 0; margin-left: 8px; padding: 2px;">
                        <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px">
                            <path d="M560-131v-82q90-26 145-100t55-168q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 127-78 224.5T560-131ZM120-360v-240h160l200-200v640L280-360H120Zm440 40v-322q47 22 73.5 66t26.5 96q0 51-26.5 94.5T560-320ZM400-606l-86 86H200v80h114l86 86v-252ZM300-480Z"/>
                        </svg>
                    </button>
                </div>
                <div class="sugg-trans-container">${segmentsHtml}</div>
            `;

            div.addEventListener('click', function() {
                suggestionBox.style.display = 'none';   
                input.value = '';                       
                input.blur();                           
                startLookup(match.word);                
            });

            suggestionBox.appendChild(div);
        });
    });

    input.addEventListener('keydown', function(e) {
        let items = suggestionBox.getElementsByClassName('suggestion-item');
        if (suggestionBox.style.display === 'none' || items.length === 0) return;

        if (e.key === 'ArrowDown') {
            currentFocus++;
            addActive(items);
        } else if (e.key === 'ArrowUp') {
            currentFocus--;
            addActive(items);
        } else if (e.key === 'Enter') {
            if (currentFocus > -1) {
                e.preventDefault(); 
                items[currentFocus].click();
            }
        }
    });

    function addActive(items) {
        if (!items) return;
        removeActive(items);
        if (currentFocus >= items.length) currentFocus = 0;
        if (currentFocus < 0) currentFocus = (items.length - 1);
        items[currentFocus].classList.add('active');
        
        items[currentFocus].scrollIntoView({ block: 'nearest' }); 
    }

    function removeActive(items) {
        for (let i = 0; i < items.length; i++) {
            items[i].classList.remove('active');
        }
    }

    suggestionBox.addEventListener('mousedown', (e) => {
        e.preventDefault(); 
    });

    const searchBtn = document.querySelector('.search-btn');
    if (searchBtn) {
        searchBtn.addEventListener('mousedown', (e) => {
            e.preventDefault(); 
        });
    }

    input.addEventListener('blur', function() {
        input.value = '';                     
        suggestionBox.innerHTML = '';         
        suggestionBox.style.display = 'none'; 
    });
    
    input.addEventListener('focus', function() {
        if (this.value.trim() !== '' && suggestionBox.innerHTML !== '') {
            suggestionBox.style.display = 'block';
        }
    });
}

function toggleLevelLock(event, level) {
    event.stopPropagation(); 
    
    if (!appSettings.lockedLevels) appSettings.lockedLevels = [];
    
    const idx = appSettings.lockedLevels.indexOf(level);

    const executeLockUpdate = () => {
        localStorage.setItem('appSettings', JSON.stringify(appSettings));
        saveLocksToDB();
        
        renderDashboard(); 
        
        if (currentViewedWord) {
            const item = wordDetailsCache[currentViewedWord] || historyData.find(i => i.word === currentViewedWord);
            if (item) renderCard(item, true); 
        }
        if (typeof updateSelectLockUI === 'function') updateSelectLockUI();
    };

    if (idx > -1) {
        const levelName = typeof level === 'number' ? `Level ${level}` : level;
        
        showConfirmModal(
            'Unlock Category', 
            `Are you sure you want to unlock "<strong>${levelName}</strong>"?`, 
            () => {
                appSettings.lockedLevels.splice(idx, 1); 
                executeLockUpdate();
            }, 
            false 
        );
    } else {
        appSettings.lockedLevels.push(level);    
        executeLockUpdate();
    }
}

function updateSelectLockUI() {
    const lockBtn = document.getElementById('currentSelectLockBtn');
    if (!lockBtn) return;

    const excludeFilters = ['all', 'new', 'learning', 'mastered', 'lvl-unset'];
    if (excludeFilters.includes(currentFilterValue)) {
        lockBtn.style.display = 'none';
        return;
    }

    lockBtn.style.display = 'flex';
    let lockTarget = null;
    
    if (currentFilterValue.startsWith('lvl-')) {
        lockTarget = parseInt(currentFilterValue.replace('lvl-', ''));
    } else if (currentFilterValue.startsWith('exam-')) {
        lockTarget = currentFilterValue.replace('exam-', '');
    }

    const lockedList = appSettings.lockedLevels || [];
    const isLocked = lockedList.includes(lockTarget);

    if (isLocked) {
        lockBtn.classList.add('locked');
        lockBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
    } else {
        lockBtn.classList.remove('locked');
        lockBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;
    }
}

function toggleCurrentFilterLock(event) {
    event.stopPropagation(); 
    
    let lockTarget = null;
    if (currentFilterValue.startsWith('lvl-')) {
        lockTarget = parseInt(currentFilterValue.replace('lvl-', ''));
    } else if (currentFilterValue.startsWith('exam-')) {
        lockTarget = currentFilterValue.replace('exam-', '');
    }
    
    if (lockTarget !== null) {
        toggleLevelLock(event, lockTarget); 
    }
}

function confirmResetViews() {
    closeSettingsModal(); 
    
    showConfirmModal(
        'Clear All Views',
        'Are you sure you want to reset the view counts (vw) for all words to 0?<br>This action cannot be undone.',
        async () => {
            historyData.forEach(item => {
                if (item.stats) item.stats.views = 0;
            });
            
            for (let word in wordDetailsCache) {
                if (wordDetailsCache[word].stats) {
                    wordDetailsCache[word].stats.views = 0;
                }
            }

            if (currentViewedWord) {
                const viewDisplay = document.getElementById('viewDisplay');
                if (viewDisplay) viewDisplay.innerText = '0 vw';
            }

            try {
                await gasFetch('resetViews');
            } catch (e) {
                console.error("Reset views failed", e);
            }
        },
        true 
    );
}

function toggleZhVisibility(btnElement) {
    const row = btnElement.closest('.zh-row');
    if (row) {
        row.classList.toggle('show-zh');
    }
}

function recalculateNavigationLock() {
    if (!currentViewedWord) return;
    const currentIndex = filteredData.findIndex(item => item.word === currentViewedWord);
    
    if (currentIndex !== -1) {
        lockedPrevWord = currentIndex > 0 ? filteredData[currentIndex - 1].word : null;
        lockedNextWord = currentIndex < filteredData.length - 1 ? filteredData[currentIndex + 1].word : null;
        
        let displayIdx = currentIndex;
        let displayTotal = filteredData.length;
        if (displayIdx === -1) {
            displayIdx = historyData.findIndex(item => item.word === currentViewedWord);
            displayTotal = historyData.length;
        }
        
        lockedDisplayIndex = displayIdx + 1;
        lockedDisplayTotal = displayTotal;
    }
}
