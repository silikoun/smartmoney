const tableBody = document.getElementById('data-table-body');
const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socketHost = window.location.hostname === 'localhost' ? 'localhost:5018' : window.location.host;
const socket = new WebSocket(`${socketProtocol}//${socketHost}/indicators`);
const tableHeaders = document.getElementById('table-headers');

let allData = [];
let tableData = [];
let sortColumn = 'symbol';
let sortDirection = 'asc';
let visibleColumns = {};

function initialize() {
    setupTabSwitching();
    renderTable(); 
}

function setupTabSwitching() {
    const tabs = document.querySelectorAll('[data-tabs-target]');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tabs-target').replace('#', '');
            showTab(target);
        });
    });
    showTab('ma'); // Show 'ma' tab by default
}

function showTab(tabId) {
    const tabs = document.querySelectorAll('[data-tabs-target]');
    tabs.forEach(tab => {
        const target = tab.getAttribute('data-tabs-target').replace('#', '');
        if (target === tabId) {
            tab.setAttribute('aria-selected', 'true');
            tab.classList.add('border-blue-600', 'text-blue-600');
            tab.classList.remove('hover:text-gray-600', 'hover:border-gray-300');
        } else {
            tab.setAttribute('aria-selected', 'false');
            tab.classList.remove('border-blue-600', 'text-blue-600');
            tab.classList.add('hover:text-gray-600', 'hover:border-gray-300');
        }
    });
    
    updateHeaderVisibility(tabId);
    renderTable();
}

socket.onopen = () => {
    console.log('Connected to WebSocket server for indicators');
};

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.error) {
        console.error('Server error:', data.error);
        return;
    }

    const existingIndex = allData.findIndex(item => item.symbol === data.symbol);
    if (existingIndex > -1) {
        allData[existingIndex] = data;
    } else {
        allData.push(data);
    }
    
    tableData = [...allData];
    renderTable();
};

socket.onclose = () => {
    console.log('Disconnected from WebSocket server for indicators');
};

function renderTable() {
    const activeTab = document.querySelector('[data-tabs-target][aria-selected="true"]').id.replace('-tab', '');
    updateHeaderVisibility(activeTab);
    sortData();
    
    const fragment = document.createDocumentFragment();
    tableData.forEach(data => {
        const row = document.createElement('tr');
        row.id = data.symbol;
        row.innerHTML = buildRowHTML(data, activeTab);
        fragment.appendChild(row);
    });

    tableBody.innerHTML = '';
    tableBody.appendChild(fragment);
}

function updateHeaderVisibility(activeTab) {
    const headers = Array.from(tableHeaders.children);
    headers.forEach(header => {
        const headerTabs = header.dataset.tab ? header.dataset.tab.split(' ') : [];
        if (header.dataset.sort === 'symbol' || headerTabs.includes(activeTab)) {
            header.style.display = '';
        } else {
            header.style.display = 'none';
        }
    });
}

function buildRowHTML(data, activeTab) {
    const cellClasses = 'px-4 py-3 text-xs whitespace-nowrap';
    const cells = {
        symbol: () => `<td class="px-4 py-3 text-xs whitespace-nowrap font-bold text-blue-600">${data.symbol}</td>`,
        sma20_1h: () => `<td class="${cellClasses}">${data.sma20_1h}</td>`,
        sma50_1h: () => `<td class="${cellClasses}">${data.sma50_1h}</td>`,
        sma200_1h: () => `<td class="${cellClasses}">${data.sma200_1h}</td>`,
        sma20_4h: () => `<td class="${cellClasses}">${data.sma20_4h}</td>`,
        sma50_4h: () => `<td class="${cellClasses}">${data.sma50_4h}</td>`,
        sma200_4h: () => `<td class="${cellClasses}">${data.sma200_4h}</td>`,
        sma20_1d: () => `<td class="${cellClasses}">${data.sma20_1d}</td>`,
        sma50_1d: () => `<td class="${cellClasses}">${data.sma50_1d}</td>`,
        sma200_1d: () => `<td class="${cellClasses}">${data.sma200_1d}</td>`,
        relativeStrength1h: () => `<td class="${cellClasses}">${formatChangeCell(data.relativeStrength1h)}</td>`,
        relativeStrength4h: () => `<td class="${cellClasses}">${formatChangeCell(data.relativeStrength4h)}</td>`,
        relativeStrength24h: () => `<td class="${cellClasses}">${formatChangeCell(data.relativeStrength24h)}</td>`,
        timestamp: () => `<td class="${cellClasses} text-gray-400">${data.timestamp}</td>`
    };

    let html = '';
    const headers = Array.from(document.getElementById('table-headers').children);
    
    headers.forEach(header => {
        const key = header.dataset.sort;
        const headerTabs = header.dataset.tab ? header.dataset.tab.split(' ') : [];
        if (header.style.display !== 'none' && cells[key]) {
            html += cells[key](data);
        }
    });
    return html;
}

const formatChangeCell = (change, unit = '') => {
    if (change === 'N/A' || change === null || change === undefined) return `<span class="text-gray-400">N/A</span>`;
    const changeValue = parseFloat(change);
    const colorClass = changeValue > 0 ? 'text-green-600' : 'text-red-600';
    return `<span class="${colorClass}">${changeValue.toFixed(2)}${unit}</span>`;
};

function sortData() {
    tableData.sort((a, b) => {
        let aValue = a[sortColumn];
        let bValue = b[sortColumn];

        if (aValue === 'N/A' || aValue === null) aValue = sortDirection === 'asc' ? Infinity : -Infinity;
        if (bValue === 'N/A' || bValue === null) bValue = sortDirection === 'asc' ? Infinity : -Infinity;
        
        aValue = parseFloat(aValue);
        bValue = parseFloat(bValue);

        if (isNaN(aValue)) aValue = sortDirection === 'asc' ? Infinity : -Infinity;
        if (isNaN(bValue)) bValue = sortDirection === 'asc' ? Infinity : -Infinity;

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

initialize();
