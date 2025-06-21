const tableBody = document.getElementById('data-table-body');
const socket = new WebSocket('ws://localhost:5017');
const customizeBtn = document.getElementById('customize-btn');
const customizePanel = document.getElementById('customize-panel');
const customizeCheckboxes = document.getElementById('customize-checkboxes');
const tableHeaders = document.getElementById('table-headers');
const exportBtn = document.getElementById('export-btn');

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

    if (data.symbol === 'BTCUSDT' || data.symbol === 'ETHUSDT') {
        updateMarketSentiment(data.symbol, data.alpha7Signal);
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
            visibleColumns[columnKey] = savedColumns ? savedColumns[columnKey] !== false : true;

            const label = document.createElement('label');
            label.className = 'flex items-center space-x-2 text-sm';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = visibleColumns[columnKey];
            checkbox.dataset.column = columnKey;
            checkbox.className = 'form-checkbox h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500';
            
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(header.textContent.replace('↕', '').trim()));
            customizeCheckboxes.appendChild(label);
        }
    });

    customizeCheckboxes.addEventListener('change', (event) => {
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
    const cellClasses = 'px-4 py-3 text-xs whitespace-nowrap';
    const cells = {
        divergenceVector24h: () => `<td class="${cellClasses}">${formatDivergenceVectorCell(data.divergenceVector24h)}</td>`,
        topTraderTrend24h: () => `<td class="${cellClasses} text-center">${formatTrendCell(data.topTraderTrend24h)}</td>`,
        momentumIndex: () => `<td class="${cellClasses}"><div class="w-12 text-center px-2 py-0.5 text-xs font-bold text-white rounded" style="background-color: ${getMomentumColor(data.momentumIndex)};">${data.momentumIndex}</div></td>`,
        alphaDivergenceScore15m: () => `<td class="${cellClasses} font-bold">${formatDivergenceCell(data.alphaDivergenceScore15m)}</td>`,
        divergenceVector4h: () => `<td class="${cellClasses}">${formatDivergenceVectorCell(data.divergenceVector4h)}</td>`,
        divergenceVector1h: () => `<td class="${cellClasses}">${formatDivergenceVectorCell(data.divergenceVector1h)}</td>`,
        divergenceVector15m: () => `<td class="${cellClasses}">${formatDivergenceVectorCell(data.divergenceVector15m)}</td>`,
        divergenceVector5m: () => `<td class="${cellClasses}">${formatDivergenceVectorCell(data.divergenceVector5m)}</td>`,
        oiConvictionScore: () => `<td class="${cellClasses} font-bold text-center">${formatConvictionCell(data.oiConvictionScore)}</td>`,
        lsConvictionScore: () => `<td class="${cellClasses} font-bold text-center">${formatConvictionCell(data.lsConvictionScore)}</td>`,
        divVectorConvictionScore: () => `<td class="${cellClasses} font-bold text-center">${formatConvictionCell(data.divVectorConvictionScore)}</td>`,
        alpha7Signal: () => `<td class="${cellClasses} font-bold text-center">${formatAlpha7Signal(data.alpha7Signal)}</td>`,
        signalStrength: () => `<td class="${cellClasses}"><div class="text-center px-2 py-0.5 text-xs font-bold rounded ${getSignalClass(data.signalStrength)}">${data.signalStrength}</div></td>`,
        symbol: () => `<td class="${cellClasses} font-bold text-blue-600">${data.symbol}</td>`,
        lsTopPositionRatio: () => `<td class="${cellClasses} text-gray-500">${data.lsTopPositionRatio}</td>`,
        lsTopPositionRatioChange1m: () => `<td class="${cellClasses}">${formatChangeCell(data.lsTopPositionRatioChange1m)}</td>`,
        lsTopPositionRatioChange15m: () => `<td class="${cellClasses}">${formatChangeCell(data.lsTopPositionRatioChange15m)}</td>`,
        lsTopPositionRatioChange30m: () => `<td class="${cellClasses}">${formatChangeCell(data.lsTopPositionRatioChange30m)}</td>`,
        lsTopPositionRatioChange1h: () => `<td class="${cellClasses}">${formatChangeCell(data.lsTopPositionRatioChange1h)}</td>`,
        lsTopPositionRatioChange4h: () => `<td class="${cellClasses}">${formatChangeCell(data.lsTopPositionRatioChange4h)}</td>`,
        openInterestChange1m: () => `<td class="${cellClasses}">${formatChangeCell(data.openInterestChange1m)}</td>`,
        openInterestChange5m: () => `<td class="${cellClasses}">${formatChangeCell(data.openInterestChange5m)}</td>`,
        openInterestChange15m: () => `<td class="${cellClasses}">${formatChangeCell(data.openInterestChange15m)}</td>`,
        openInterestChange1h: () => `<td class="${cellClasses}">${formatChangeCell(data.openInterestChange1h)}</td>`,
        openInterestChange4h: () => `<td class="${cellClasses}">${formatChangeCell(data.openInterestChange4h)}</td>`,
        openInterestChange12h: () => `<td class="${cellClasses}">${formatChangeCell(data.openInterestChange12h)}</td>`,
        openInterestChange24h: () => `<td class="${cellClasses}">${formatChangeCell(data.openInterestChange24h)}</td>`,
        timestamp: () => `<td class="${cellClasses} text-gray-400">${data.timestamp}</td>`
    };

    let html = '';
    const headers = Array.from(tableHeaders.children);
    headers.forEach(header => {
        const key = header.dataset.sort;
        if (visibleColumns[key] && cells[key]) {
            html += cells[key]();
        }
    });
    return html;
}

// --- Cell Formatting ---

const formatChangeCell = (change) => {
    if (change === 'N/A') return `<span class="text-gray-400">${change}</span>`;
    const changeValue = parseFloat(change);
    const colorClass = changeValue > 0 ? 'text-green-600' : 'text-red-600';
    return `<span class="${colorClass}">${change}</span>`;
};

const getMomentumColor = (score) => {
    const hue = (score / 100) * 120;
    return `hsl(${hue}, 100%, 45%)`;
};

const getSignalClass = (signal) => {
    if (typeof signal !== 'string') return 'bg-gray-200 text-gray-800';
    switch (signal.toLowerCase()) {
        case 'strong buy': return 'bg-green-500 text-white';
        case 'weak buy': return 'bg-green-200 text-green-800';
        case 'strong sell': return 'bg-red-500 text-white';
        case 'weak sell': return 'bg-red-200 text-red-800';
        default: return 'bg-gray-200 text-gray-800';
    }
};

const formatDivergenceCell = (score) => {
    if (score === 'N/A') return `<span class="text-gray-400">${score}</span>`;
    const scoreValue = parseFloat(score);
    let colorClass = 'text-gray-800';
    if (scoreValue > config.divergence_ui_threshold_bullish) colorClass = 'text-green-600';
    else if (scoreValue < config.divergence_ui_threshold_bearish) colorClass = 'text-red-600';
    return `<span class="${colorClass}">${score}</span>`;
};

const formatConvictionCell = (score) => {
    if (score === undefined || score === null) return `<span class="text-gray-400">N/A</span>`;
    const scoreValue = parseInt(score, 10);
    let colorClass = 'text-gray-800';
    if (scoreValue > 0) {
        colorClass = `text-green-${Math.min(9, 4 + Math.floor(scoreValue / 20))}00`;
    } else if (scoreValue < 0) {
        colorClass = `text-red-${Math.min(9, 4 + Math.floor(Math.abs(scoreValue) / 20))}00`;
    }
    return `<span class="${colorClass}">${scoreValue}</span>`;
};

const formatDivergenceVectorCell = (score) => {
    if (score === 'N/A') return `<span class="text-gray-400">${score}</span>`;
    const scoreValue = parseFloat(score);
    const colorClass = scoreValue > 0 ? 'text-green-600' : 'text-red-600';
    return `<span class="${colorClass}">${score}</span>`;
};

const formatTrendCell = (trend) => {
    if (trend === 'Uptrend') return `<span class="text-green-600 text-xl">&#x2197;</span>`;
    if (trend === 'Downtrend') return `<span class="text-red-600 text-xl">&#x2198;</span>`;
    return `<span class="text-gray-400">&ndash;</span>`;
};

const formatAlpha7Signal = (score) => {
    if (score === undefined || score === null) return `<span class="text-gray-400">N/A</span>`;
    const scoreValue = parseInt(score, 10);
    let bgColor = 'bg-gray-200';
    let textColor = 'text-gray-800';
    if (scoreValue > 50) {
        bgColor = 'bg-green-500';
        textColor = 'text-white';
    } else if (scoreValue < -50) {
        bgColor = 'bg-red-500';
        textColor = 'text-white';
    }
    return `<div class="px-3 py-1 text-xs font-bold rounded ${bgColor} ${textColor}">${scoreValue}</div>`;
};

function updateMarketSentiment(symbol, score) {
    const sentimentId = symbol === 'BTCUSDT' ? 'sentiment-btc' : 'sentiment-eth';
    const sentimentElement = document.getElementById(sentimentId);
    if (!sentimentElement) return;

    const scoreValue = parseInt(score, 10);
    let sentimentText = 'Neutral';
    let sentimentColor = 'text-gray-500';

    if (scoreValue > 50) {
        sentimentText = 'Bullish';
        sentimentColor = 'text-green-500';
    } else if (scoreValue < -50) {
        sentimentText = 'Bearish';
        sentimentColor = 'text-red-500';
    }

    sentimentElement.querySelector('span:last-child').textContent = sentimentText;
    sentimentElement.querySelector('span:last-child').className = `font-bold ${sentimentColor}`;
}

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

// --- CSV Export ---

function exportTableToCSV() {
    const headers = Array.from(tableHeaders.children)
        .filter(header => visibleColumns[header.dataset.sort])
        .map(header => `"${header.textContent.replace('↕', '').trim()}"`)
        .join(',');

    const rows = tableData.map(data => {
        return Array.from(tableHeaders.children)
            .filter(header => visibleColumns[header.dataset.sort])
            .map(header => {
                const key = header.dataset.sort;
                return `"${data[key] || ''}"`;
            })
            .join(',');
    });

    const csvContent = [headers, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    link.setAttribute('download', `market_data_${timestamp}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

exportBtn.addEventListener('click', exportTableToCSV);


// --- Initial Load ---
initialize();
