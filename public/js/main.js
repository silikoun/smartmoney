const tableBody = document.getElementById('data-table-body');
const socket = new WebSocket('ws://localhost:5017');
const customizeBtn = document.getElementById('customize-btn');
const customizePanel = document.getElementById('customize-panel');
const tableHeaders = document.getElementById('table-headers');

let tableData = [];
let sortColumn = 'momentumIndex';
let sortDirection = 'desc';
let config = {
    divergence_ui_threshold_bullish: 0.05,
    divergence_ui_threshold_bearish: -0.05
};
let visibleColumns = {};

// --- Initialization ---

function initialize() {
    fetch('/api/config')
        .then(response => response.json())
        .then(data => {
            config = data;
        })
        .catch(error => console.error('Error fetching config:', error));

    setupColumnCustomization();
    renderTable(); // Initial render
}

// --- WebSocket Handling ---

socket.onopen = () => {
    console.log('Connected to WebSocket server');
};

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.error) {
        console.error('Server error:', data.error);
        return;
    }
    const existingIndex = tableData.findIndex(item => item.symbol === data.symbol);
    if (existingIndex > -1) {
        tableData[existingIndex] = data;
    } else {
        tableData.push(data);
    }
    renderTable();
};

socket.onclose = () => {
    console.log('Disconnected from WebSocket server');
};

// --- Column Customization ---

function setupColumnCustomization() {
    const savedColumns = JSON.parse(localStorage.getItem('visibleColumns'));
    const headers = Array.from(tableHeaders.children);
    
    headers.forEach(header => {
        const columnKey = header.dataset.sort;
        if (columnKey) {
            // Default to visible if no setting is saved
            visibleColumns[columnKey] = savedColumns ? savedColumns[columnKey] : true;

            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = visibleColumns[columnKey];
            checkbox.dataset.column = columnKey;
            
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(header.textContent.replace('↕', '').trim()));
            customizePanel.appendChild(label);
        }
    });

    customizePanel.addEventListener('change', (event) => {
        const checkbox = event.target;
        const columnKey = checkbox.dataset.column;
        visibleColumns[columnKey] = checkbox.checked;
        localStorage.setItem('visibleColumns', JSON.stringify(visibleColumns));
        renderTable();
    });

    customizeBtn.addEventListener('click', () => {
        customizePanel.classList.toggle('hidden');
    });
}

// --- Rendering ---

function renderTable() {
    updateHeaderVisibility();
    sortData();
    
    const fragment = document.createDocumentFragment();
    tableData.forEach(data => {
        const row = document.createElement('tr');
        row.id = data.symbol;
        row.innerHTML = buildRowHTML(data);
        fragment.appendChild(row);
    });

    tableBody.innerHTML = '';
    tableBody.appendChild(fragment);
}

function updateHeaderVisibility() {
    const headers = Array.from(tableHeaders.children);
    headers.forEach(header => {
        const columnKey = header.dataset.sort;
        if (columnKey) {
            header.style.display = visibleColumns[columnKey] ? '' : 'none';
        }
    });
}

function buildRowHTML(data) {
    const cells = {
        divergenceVector24h: () => formatDivergenceVectorCell(data.divergenceVector24h),
        topTraderTrend24h: () => formatTrendCell(data.topTraderTrend24h),
        momentumIndex: () => `<td><div class="momentum-index" style="background-color: ${getMomentumColor(data.momentumIndex)};">${data.momentumIndex}</div></td>`,
        alphaDivergenceScore15m: () => formatDivergenceCell(data.alphaDivergenceScore15m),
        divergenceVector4h: () => formatDivergenceVectorCell(data.divergenceVector4h),
        divergenceVector5m: () => formatDivergenceVectorCell(data.divergenceVector5m),
        oiConvictionScore: () => formatConvictionCell(data.oiConvictionScore),
        signalStrength: () => `<td><div class="signal-strength ${getSignalClass(data.signalStrength)}">${data.signalStrength}</div></td>`,
        symbol: () => `<td class="symbol">${data.symbol}</td>`,
        lsTopPositionRatio: () => `<td>${data.lsTopPositionRatio}</td>`,
        lsTopPositionRatioChange1m: () => formatChangeCell(data.lsTopPositionRatioChange1m),
        lsTopPositionRatioChange15m: () => formatChangeCell(data.lsTopPositionRatioChange15m),
        openInterestChange1m: () => formatChangeCell(data.openInterestChange1m),
        openInterestChange5m: () => formatChangeCell(data.openInterestChange5m),
        openInterestChange15m: () => formatChangeCell(data.openInterestChange15m),
        timestamp: () => `<td>${data.timestamp}</td>`
    };

    let html = '';
    Object.keys(visibleColumns).forEach(key => {
        if (visibleColumns[key] && cells[key]) {
            html += cells[key]();
        }
    });
    return html;
}

// --- Cell Formatting ---

const formatChangeCell = (change) => {
    if (change === 'N/A') return `<td>${change}</td>`;
    const changeValue = parseFloat(change);
    const changeClass = changeValue > 0 ? 'positive' : 'negative';
    return `<td class="${changeClass}">${change}</td>`;
};

const getMomentumColor = (score) => {
    const hue = (score / 100) * 120;
    return `hsl(${hue}, 100%, 45%)`;
};

const getSignalClass = (signal) => {
    if (typeof signal !== 'string') return 'neutral';
    return signal.toLowerCase().replace(' ', '-');
};

const formatDivergenceCell = (score) => {
    if (score === 'N/A') return `<td>${score}</td>`;
    const scoreValue = parseFloat(score);
    let color = 'white';
    if (scoreValue > config.divergence_ui_threshold_bullish) color = '#26a69a';
    else if (scoreValue < config.divergence_ui_threshold_bearish) color = '#ef5350';
    return `<td style="color: ${color}; font-weight: bold;">${score}</td>`;
};

const formatConvictionCell = (score) => {
    if (score === undefined || score === null) return `<td>N/A</td>`;
    const scoreValue = parseInt(score, 10);
    const red = scoreValue < 0 ? Math.round(Math.abs(scoreValue) / 10 * 200) : 0;
    const green = scoreValue > 0 ? Math.round(scoreValue / 10 * 200) : 0;
    return `<td style="color: rgb(${red}, ${green}, 0); font-weight: bold;">${scoreValue}</td>`;
};

const formatDivergenceVectorCell = (score) => {
    if (score === 'N/A') return `<td>${score}</td>`;
    const scoreValue = parseFloat(score);
    const color = scoreValue > 0 ? '#26a69a' : '#ef5350';
    return `<td style="color: ${color};">${score}</td>`;
};

const formatTrendCell = (trend) => {
    if (trend === 'Uptrend') return `<td><span class="positive" style="font-size: 1.5em;">&#x2197;</span></td>`;
    if (trend === 'Downtrend') return `<td><span class="negative" style="font-size: 1.5em;">&#x2198;</span></td>`;
    return `<td>&ndash;</td>`;
};

// --- Sorting ---

function sortData() {
    const signalStrengthMap = { 'Strong Buy': 5, 'Weak Buy': 4, 'Neutral': 3, 'Weak Sell': 2, 'Strong Sell': 1 };
    const trendMap = { 'Uptrend': 3, 'Sideways': 2, 'Downtrend': 1 };

    tableData.sort((a, b) => {
        let aValue = a[sortColumn];
        let bValue = b[sortColumn];

        if (sortColumn === 'signalStrength') {
            aValue = signalStrengthMap[aValue] || 0;
            bValue = signalStrengthMap[bValue] || 0;
        } else if (sortColumn === 'topTraderTrend24h') {
            aValue = trendMap[aValue] || 0;
            bValue = trendMap[bValue] || 0;
        } else {
            if (aValue === 'N/A') aValue = sortDirection === 'asc' ? Infinity : -Infinity;
            if (bValue === 'N/A') bValue = sortDirection === 'asc' ? Infinity : -Infinity;
            if (typeof aValue === 'string') aValue = parseFloat(aValue.replace('$', '').replace('%', '').replace('M', ''));
            if (typeof bValue === 'string') bValue = parseFloat(bValue.replace('$', '').replace('%', '').replace('M', ''));
        }

        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
    });
}

document.getElementById('table-headers').addEventListener('click', (event) => {
    const header = event.target.closest('th');
    if (header && header.dataset.sort) {
        const newSortColumn = header.dataset.sort;
        if (sortColumn === newSortColumn) {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            sortColumn = newSortColumn;
            sortDirection = 'desc';
        }
        renderTable();
    }
});

// --- Initial Load ---
initialize();
