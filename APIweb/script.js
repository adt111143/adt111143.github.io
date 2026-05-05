let aqData = [];
let myChart = null;

async function fetchData() {
    const apiKey = document.getElementById('api-key-input').value.trim();
    
    if (!apiKey) {
        alert("請先輸入環境部 API KEY！");
        return;
    }

    const apiUrl = `https://data.moenv.gov.tw/api/v2/AQX_P_432?format=json&limit=1000&sort=ImportDate%20desc&api_key=${apiKey}`;
    
    try {
        document.getElementById('pub-time').innerText = "連線中...";
        const res = await fetch(apiUrl);
        
        if (!res.ok) throw new Error('API KEY 錯誤或服務暫不可用');

        const rawJson = await res.json();
        
        if (rawJson.records && Array.isArray(rawJson.records)) {
            aqData = rawJson.records;
        } else if (Array.isArray(rawJson)) {
            aqData = rawJson;
        } else {
            throw new Error('未預期的資料格式');
        }
        
        document.getElementById('status-dot').classList.add('online');
        document.getElementById('pub-time').innerText = `已連線 | 發布於 ${aqData[0].publishtime}`;
        
        updateCountySelect();
        
        ['search-in', 'county-sel', 'status-sel', 'chart-type-sel'].forEach(id => {
            document.getElementById(id).oninput = render;
        });

        render();
    } catch (e) {
        alert(e.message);
        document.getElementById('pub-time').innerText = "連線失敗";
        document.getElementById('status-dot').classList.remove('online');
    }
}

function updateCountySelect() {
    const counties = [...new Set(aqData.map(d => d.county))].filter(Boolean);
    const sel = document.getElementById('county-sel');
    sel.innerHTML = '<option value="all">所有縣市</option>';
    counties.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.innerText = c;
        sel.appendChild(opt);
    });
}

function getLevel(aqi) {
    if (!aqi || isNaN(aqi)) return 0;
    const v = parseInt(aqi);
    if (v <= 50) return 1;
    if (v <= 100) return 2;
    if (v <= 150) return 3;
    if (v <= 200) return 4;
    if (v <= 300) return 5;
    return 6;
}

const levelColors = ['#94a3b8', '#10b981', '#fbbf24', '#f97316', '#ef4444', '#8b5cf6', '#7f1d1d'];

function render() {
    const sVal = document.getElementById('search-in').value.toLowerCase();
    const cVal = document.getElementById('county-sel').value;
    const statVal = document.getElementById('status-sel').value;

    let filtered = aqData.filter(d => {
        const matchSearch = d.sitename.toLowerCase().includes(sVal);
        const matchCounty = (cVal === 'all' || d.county === cVal);
        const matchStatus = (statVal === 'all' || d.status === statVal);
        return matchSearch && matchCounty && matchStatus;
    });

    const list = document.getElementById('card-list');
    list.innerHTML = filtered.map(d => {
        const lv = getLevel(d.aqi);
        return `
            <div class="station-card">
                <div class="card-top">
                    <div class="station-info">
                        <h3>${d.sitename}</h3>
                        <p>${d.county}</p>
                    </div>
                    <div class="aqi-circle lv-${lv}">
                        <span>${d.aqi || '--'}</span>
                        <small>AQI</small>
                    </div>
                </div>
                <div class="status-pill bg-lv-${lv}">${d.status || '數據缺漏'}</div>
                <div class="data-grid">
                    <div class="data-item"><label>PM2.5</label><value>${d['pm2.5'] || '-'}</value></div>
                    <div class="data-item"><label>PM10</label><value>${d.pm10 || '-'}</value></div>
                    <div class="data-item"><label>O3</label><value>${d.o3 || '-'}</value></div>
                    <div class="data-item"><label>NO2</label><value>${d.no2 || '-'}</value></div>
                </div>
            </div>
        `;
    }).join('');

    updateChart(filtered);
}

function updateChart(data) {
    const ctx = document.getElementById('qualityChart').getContext('2d');
    const chartType = document.getElementById('chart-type-sel').value;
    if (myChart) myChart.destroy();

    if (chartType === 'doughnut' || chartType === 'bar') {
        const counts = { "良好": 0, "普通": 0, "對敏感族群不健康": 0, "對所有族群不健康": 0, "非常不健康": 0, "危害": 0 };
        data.forEach(d => { if(counts[d.status] !== undefined) counts[d.status]++; });

        myChart = new Chart(ctx, {
            type: chartType,
            data: {
                labels: Object.keys(counts),
                datasets: [{
                    data: Object.values(counts),
                    backgroundColor: levelColors.slice(1),
                    borderWidth: 0
                }]
            },
            options: { 
                responsive: true,
                plugins: { legend: { display: chartType === 'doughnut', labels: { color: '#94a3b8' } } }
            }
        });
    } else {
        const top10 = [...data].sort((a,b) => (parseInt(b.aqi)||0) - (parseInt(a.aqi)||0)).slice(0, 10);
        myChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: top10.map(d => d.sitename),
                datasets: [{
                    label: 'AQI 數值',
                    data: top10.map(d => parseInt(d.aqi)||0),
                    backgroundColor: top10.map(d => levelColors[getLevel(d.aqi)]),
                    borderRadius: 4
                }]
            },
            options: { 
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: { x: { grid: { color: 'rgba(255,255,255,0.1)' } }, y: { grid: { display: false } } }
            }
        });
    }
}

function downloadJSON() {
    if (!aqData.length) return alert("沒有資料可供下載");
    const blob = new Blob([JSON.stringify(aqData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `AQI_Live_Data.json`;
    a.click();
}