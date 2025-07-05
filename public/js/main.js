const tableBody = document.getElementById('data-table-body');
const socket = new WebSocket(
  window.location.origin
    .replace('http://', 'ws://')
    .replace('https://', 'wss://') 
    + '/ws'
);
const customizeBtn = document.getElementById('customize-btn');
const customizePanel = document.getElementById('customize-panel');
const customizeCheckboxes = document.getElementById('customize-checkboxes');
const tableHeaders = document.getElementById('table-headers');
const exportBtn = document.getElementById('export-btn');
const searchCoinBtn = document.getElementById('search-coin-btn');
const searchCoinInput = document.getElementById('search-coin-input');
const exchangeDropdownBtn = document.getElementById('exchange-dropdown-btn');
const exchangeDropdownPanel = document.getElementById('exchange-dropdown-panel');
const selectedExchange = document.getElementById('selected-exchange');
const moreActionsBtn = document.getElementById('more-actions-btn');
const moreActionsPanel = document.getElementById('more-actions-panel');
const marketTypeFuturesBtn = document.getElementById('market-type-futures');
const marketTypeSpotBtn = document.getElementById('market-type-spot');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileMenuPanel = document.getElementById('mobile-menu-panel');
const mobileCustomizeCheckboxes = document.getElementById('mobile-customize-checkboxes');
const mobileExportBtn = document.getElementById('mobile-export-btn');

let currentMarketType = 'futures';
let tableData = [];
let allData = [];
let sortColumn = 'oi';
let sortDirection = 'asc';
let config = {
    divergence_ui_threshold_bullish: 0.05,
    divergence_ui_threshold_bearish: -0.05
};
let visibleColumns = {};

// --- Initialization ---

function initialize() {
    sessionStorage.removeItem('mainTableData');
    if (moreActionsBtn) {
        moreActionsBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            moreActionsPanel.classList.toggle('hidden');
        });
    }

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            mobileMenuPanel.classList.toggle('hidden');
        });
    }

    exchangeDropdownBtn.addEventListener('click', () => {
        exchangeDropdownPanel.classList.toggle('hidden');
    });

    exchangeDropdownPanel.addEventListener('click', (event) => {
        if (event.target.tagName === 'A') {
            const exchange = event.target.dataset.exchange;
            selectedExchange.textContent = event.target.textContent;
            exchangeDropdownPanel.classList.add('hidden');
            // TODO: Implement exchange switching logic
        }
    });

    fetch('/api/config')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.text();
        })
        .then(text => {
            try {
                config = JSON.parse(text);
            } catch (error) {
                console.error('Error parsing config JSON:', error);
                console.error('Received text:', text);
            }
        })
        .catch(error => console.error('Error fetching config:', error));

    const cachedData = sessionStorage.getItem('mainTableData');
    if (cachedData) {
        allData = JSON.parse(cachedData);
        tableData = [...allData];
    }

    setupColumnCustomization();
    setupTabSwitching();
    setupMarketTypeSwitching();
    renderTable(); // Initial render

    document.addEventListener('click', (event) => {
        if (moreActionsPanel && !moreActionsPanel.classList.contains('hidden') && !moreActionsBtn.contains(event.target)) {
            moreActionsPanel.classList.add('hidden');
        }
        if (exchangeDropdownPanel && !exchangeDropdownPanel.classList.contains('hidden') && !exchangeDropdownBtn.contains(event.target)) {
            exchangeDropdownPanel.classList.add('hidden');
        }
        if (customizePanel && !customizePanel.classList.contains('hidden') && !customizeBtn.contains(event.target) && !customizePanel.contains(event.target)) {
            customizePanel.classList.add('hidden');
        }
        if (mobileMenuPanel && !mobileMenuPanel.classList.contains('hidden') && !mobileMenuBtn.contains(event.target) && !mobileMenuPanel.contains(event.target)) {
            mobileMenuPanel.classList.add('hidden');
        }
    });
}

// --- Tab Switching ---

function setupTabSwitching() {
    const tabs = document.querySelectorAll('[data-tabs-target]');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tabs-target').replace('#', '');
            showTab(target);
        });
    });
    showTab('overview'); // Show overview tab by default
}

function setupMarketTypeSwitching() {
    marketTypeFuturesBtn.addEventListener('click', () => switchMarketType('futures'));
    marketTypeSpotBtn.addEventListener('click', () => switchMarketType('spot'));
}

function switchMarketType(marketType) {
    currentMarketType = marketType;
    console.log(`Switched to ${marketType} market`);

    if (marketType === 'futures') {
        marketTypeFuturesBtn.classList.add('bg-gray-200', 'text-gray-800', 'font-semibold');
        marketTypeFuturesBtn.classList.remove('bg-white', 'text-gray-500');
        marketTypeSpotBtn.classList.add('bg-white', 'text-gray-500');
        marketTypeSpotBtn.classList.remove('bg-gray-200', 'text-gray-800', 'font-semibold');
    } else {
        marketTypeSpotBtn.classList.add('bg-gray-200', 'text-gray-800', 'font-semibold');
        marketTypeSpotBtn.classList.remove('bg-white', 'text-gray-500');
        marketTypeFuturesBtn.classList.add('bg-white', 'text-gray-500');
        marketTypeFuturesBtn.classList.remove('bg-gray-200', 'text-gray-800', 'font-semibold');
    }
    // Here you would typically trigger a data refresh
    // e.g., fetchDataForMarket(currentMarketType);
}

function showTab(tabId) {
    const tabs = document.querySelectorAll('[data-tabs-target]');
    const openInterestTable = document.getElementById('open-interest-table-body').parentElement.parentElement;
    const mainTable = document.getElementById('data-table-body').parentElement;

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

    if (tabId === 'open-interest') {
        mainTable.classList.add('hidden');
        openInterestTable.classList.remove('hidden');
    } else {
        mainTable.classList.remove('hidden');
        openInterestTable.classList.add('hidden');
    }
    
    populateCustomizeCheckboxes();
    renderTable();
}

// --- WebSocket Handling ---

socket.onopen = () => {
    console.log('Connected to WebSocket server');
};

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (Array.isArray(data)) {
        data.forEach(item => {
            const existingIndex = allData.findIndex(d => d.symbol === item.symbol);
            if (existingIndex > -1) {
                Object.assign(allData[existingIndex], item);
            } else {
                allData.push(item);
            }
        });
    } else {
        if (data.error) {
            console.error('Server error:', data.error);
            return;
        }

        if (data.symbol === 'alpha7Signal') {
            updateMarketSentiment('alpha7', data.alpha7Signal);
        }

        const existingIndex = allData.findIndex(item => item.symbol === data.symbol);
        if (existingIndex > -1) {
            // Merge new data into the existing object to preserve calculated fields
            Object.assign(allData[existingIndex], data);
        } else {
            allData.push(data);
        }
    }

    sessionStorage.setItem('mainTableData', JSON.stringify(allData));

    // Preserve search filter if active
    const searchTerm = searchCoinInput.value.trim().toUpperCase();
    if (searchTerm) {
        tableData = allData.filter(item => item.symbol.toUpperCase().includes(searchTerm));
    } else {
        tableData = [...allData];
    }

    if (data.symbol === 'BTCUSDT' || data.symbol === 'ETHUSDT') {
        updateMarketSentiment(data.symbol, data.alpha7Signal);
    }
    
    // Ensure OI-Weighted FR and Contribution are calculated for all data updates
    calculateAndDisplayOIWeightedFR();
    renderTable();
};

socket.onclose = () => {
    console.log('Disconnected from WebSocket server');
};

// --- Column Customization ---
function populateCustomizeCheckboxes() {
    const activeTab = document.querySelector('[data-tabs-target][aria-selected="true"]').getAttribute('data-tabs-target').replace('#', '');
    const savedColumns = JSON.parse(localStorage.getItem(`visibleColumns_${activeTab}`));
    const headers = Array.from(tableHeaders.children);

    const defaultVisible = ['price', 'oi', 'oi24hNotional', 'volume24h', 'aiScore', 'symbol'];
    
    // Clear existing checkboxes
    document.getElementById('overview-columns').innerHTML = '';
    document.getElementById('divergence-columns').innerHTML = '';
    document.getElementById('notional-columns').innerHTML = '';
    document.getElementById('volume-columns').innerHTML = '';
    document.getElementById('position-columns').innerHTML = '';
    document.getElementById('long-short-accounts-columns').innerHTML = '';
    document.getElementById('funding-rate-columns').innerHTML = '';
    // Clear the new container for oi-weighted-funding-rate
    const oiWeightedFrContainer = document.getElementById('oi-weighted-funding-rate-columns');
    if (oiWeightedFrContainer) {
        oiWeightedFrContainer.innerHTML = '';
    }
    if (mobileCustomizeCheckboxes) {
        mobileCustomizeCheckboxes.innerHTML = '';
    }


    headers.forEach(header => {
        const columnKey = header.dataset.sort;
        const columnTab = header.dataset.tab;
        if (columnKey) {
            // Default to visible if no setting is saved
            if (savedColumns) {
                visibleColumns[columnKey] = savedColumns[columnKey] !== false;
            } else {
                if (activeTab === 'overview') {
                    visibleColumns[columnKey] = defaultVisible.includes(columnKey);
                } else {
                    visibleColumns[columnKey] = true; // Default to visible for other tabs
                }
            }

            const label = document.createElement('label');
            label.className = 'flex items-center space-x-2 text-sm';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = visibleColumns[columnKey];
            checkbox.dataset.column = columnKey;
            checkbox.className = 'form-checkbox h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500';
            
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(header.textContent.replace('↕', '').trim()));
            
            const container = document.getElementById(`${columnTab}-columns`);
            if(container) {
                container.appendChild(label.cloneNode(true));
            }
            if (mobileCustomizeCheckboxes) {
                const mobileLabel = document.createElement('label');
                mobileLabel.className = 'flex items-center space-x-2 text-sm';
                const mobileCheckbox = document.createElement('input');
                mobileCheckbox.type = 'checkbox';
                mobileCheckbox.checked = visibleColumns[columnKey];
                mobileCheckbox.dataset.column = columnKey;
                mobileCheckbox.className = 'form-checkbox h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500';
                mobileLabel.appendChild(mobileCheckbox);
                mobileLabel.appendChild(document.createTextNode(header.textContent.replace('↕', '').trim()));
                mobileCustomizeCheckboxes.appendChild(mobileLabel);
            }
        }
    });
}

function setupColumnCustomization() {
    populateCustomizeCheckboxes();

    customizeCheckboxes.addEventListener('change', (event) => {
        const checkbox = event.target;
        const columnKey = checkbox.dataset.column;
        visibleColumns[columnKey] = checkbox.checked;
        const activeTab = document.querySelector('[data-tabs-target][aria-selected="true"]').getAttribute('data-tabs-target').replace('#', '');
        localStorage.setItem(`visibleColumns_${activeTab}`, JSON.stringify(visibleColumns));
        renderTable();
    });

    customizeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        customizePanel.classList.toggle('hidden');
    });
}

// --- Rendering ---

function renderTable() {
    const activeTab = document.querySelector('[data-tabs-target][aria-selected="true"]').getAttribute('data-tabs-target').replace('#', '');
    updateHeaderVisibility(activeTab);
    sortData();
    
    const fragment = document.createDocumentFragment();
    tableData.forEach(data => {
        const row = document.createElement('tr');
        row.id = data.symbol;
        row.innerHTML = buildRowHTML(data, activeTab);
        fragment.appendChild(row);
    });

    if (activeTab === 'open-interest') {
        const openInterestTableBody = document.getElementById('open-interest-table-body');
        openInterestTableBody.innerHTML = '';
        openInterestTableBody.appendChild(fragment);
    } else {
        tableBody.innerHTML = '';
        tableBody.appendChild(fragment);
    }

    $("span.sparkline").peity("line");
}

function updateHeaderVisibility(activeTab) {
    const headers = Array.from(tableHeaders.children);
    const openInterestTable = document.getElementById('open-interest-table-body').parentElement.parentElement;
    const mainTable = document.getElementById('data-table-body').parentElement;

    if (activeTab === 'open-interest') {
        mainTable.classList.add('hidden');
        openInterestTable.classList.remove('hidden');
    } else {
        mainTable.classList.remove('hidden');
        openInterestTable.classList.add('hidden');
    }

    headers.forEach(header => {
        const columnKey = header.dataset.sort;
        const headerTab = header.dataset.tab;

        if (columnKey === 'symbol') {
            header.style.display = '';
            return;
        }

        if (columnKey) {
            const isVisible = visibleColumns[columnKey];
            
            if (activeTab === 'overview') {
                header.style.display = isVisible ? '' : 'none';
            } else {
                if (isVisible && headerTab === activeTab) {
                    header.style.display = '';
                } else {
                    header.style.display = 'none';
                }
            }
        }
    });
}

function buildRowHTML(data, activeTab) {
    const cellClasses = 'px-4 py-3 text-xs whitespace-nowrap';
    const cells = {
        price: () => `<td class="${cellClasses}">${data.price}</td>`,
        oi: () => `<td class="${cellClasses}">${(data.oi / 1000000).toFixed(2)}M</td>`,
        oi24hNotional: () => `<td class="${cellClasses}">${data.oi24hNotional}</td>`,
        volume24h: () => `<td class="${cellClasses}">${data.volume24h}</td>`,
        marketCap: () => `<td class="${cellClasses}">${data.marketCap}</td>`,
        divergenceVector24h: () => `<td class="${cellClasses}">${formatDivergenceVectorCell(data.divergenceVector24h)}</td>`,
        aiScore: () => `<td class="${cellClasses} font-bold text-center">${data.aiScore || 'N/A'}</td>`,
        alphaDivergenceScore15m: () => `<td class="${cellClasses} font-bold">${formatDivergenceCell(data.alphaDivergenceScore15m)}</td>`,
        divergenceVector4h: () => `<td class="${cellClasses}">${formatDivergenceVectorCell(data.divergenceVector4h)}</td>`,
        divergenceVector1h: () => `<td class="${cellClasses}">${formatDivergenceVectorCell(data.divergenceVector1h)}</td>`,
        divergenceVector15m: () => `<td class="${cellClasses}">${formatDivergenceVectorCell(data.divergenceVector15m)}</td>`,
        divergenceVector5m: () => `<td class="${cellClasses}">${formatDivergenceVectorCell(data.divergenceVector5m)}</td>`,
        oiConvictionScore: () => `<td class="${cellClasses} font-bold text-center">${formatConvictionCell(data.oiConvictionScore)}</td>`,
        lsConvictionScore: () => `<td class="${cellClasses} font-bold text-center">${formatConvictionCell(data.lsConvictionScore)}</td>`,
        divVectorConvictionScore: () => `<td class="${cellClasses} font-bold text-center">${formatConvictionCell(data.divVectorConvictionScore)}</td>`,
        vwapDeviation15m: () => `<td class="px-4 py-3 text-xs whitespace-nowrap font-bold">${formatVwapDeviationCell(data.vwapDeviation15m)}</td>`,
        vwapDeviation4h: () => `<td class="${cellClasses} font-bold">${formatVwapDeviationCell(data.vwapDeviation4h)}</td>`,
        vwapDeviation1d: () => `<td class="${cellClasses} font-bold">${formatVwapDeviationCell(data.vwapDeviation1d)}</td>`,
        symbol: () => `<td class="px-4 py-3 text-xs whitespace-nowrap font-bold text-blue-600">${data.symbol}</td>`,
        lsTopPositionRatio: () => `<td class="${cellClasses} text-gray-500">${data.lsTopPositionRatio}</td>`,
        lsTopPositionRatioChange5m: () => `<td class="${cellClasses}">${formatChangeCell(data.lsTopPositionRatioChange5m)}</td>`,
        lsTopPositionRatioChange15m: () => `<td class="${cellClasses}">${formatChangeCell(data.lsTopPositionRatioChange15m)}</td>`,
        lsTopPositionRatioChange30m: () => `<td class="${cellClasses}">${formatChangeCell(data.lsTopPositionRatioChange30m)}</td>`,
        lsTopPositionRatioChange1h: () => `<td class="${cellClasses}">${formatChangeCell(data.lsTopPositionRatioChange1h)}</td>`,
        lsTopPositionRatioChange4h: () => `<td class="${cellClasses}">${formatChangeCell(data.lsTopPositionRatioChange4h)}</td>`,
        lsGlobalAccountRatio: () => `<td class="${cellClasses} text-gray-500">${data.lsGlobalAccountRatio}</td>`,
        lsGlobalAccountRatioChange5m: () => `<td class="${cellClasses}">${formatChangeCell(data.lsGlobalAccountRatioChange5m)}</td>`,
        lsGlobalAccountRatioChange15m: () => `<td class="${cellClasses}">${formatChangeCell(data.lsGlobalAccountRatioChange15m)}</td>`,
        lsGlobalAccountRatioChange30m: () => `<td class="${cellClasses}">${formatChangeCell(data.lsGlobalAccountRatioChange30m)}</td>`,
        lsGlobalAccountRatioChange1h: () => `<td class="${cellClasses}">${formatChangeCell(data.lsGlobalAccountRatioChange1h)}</td>`,
        lsGlobalAccountRatioChange4h: () => `<td class="${cellClasses}">${formatChangeCell(data.lsGlobalAccountRatioChange4h)}</td>`,
        openInterestChange1m: () => `<td class="${cellClasses}">${formatChangeCell(String(data.openInterestChange1m).replace('M', ''), 'm$')}</td>`,
        openInterestChange5m: () => `<td class="${cellClasses}">${formatChangeCell(String(data.openInterestChange5m).replace('M', ''), 'm$')}</td>`,
        openInterestChange15m: () => `<td class="${cellClasses}">${formatChangeCell(String(data.openInterestChange15m).replace('M', ''), 'm$')}</td>`,
        openInterestChange1h: () => `<td class="${cellClasses}">${formatChangeCell(String(data.openInterestChange1h).replace('M', ''), 'm$')}</td>`,
        openInterestChange4h: () => `<td class="${cellClasses}">${formatChangeCell(String(data.openInterestChange4h).replace('M', ''), 'm$')}</td>`,
        openInterestChange12h: () => `<td class="${cellClasses}">${formatChangeCell(String(data.openInterestChange12h).replace('M', ''), 'm$')}</td>`,
        openInterestChange24h: () => `<td class="${cellClasses}">${formatChangeCell(String(data.openInterestChange24h).replace('M', ''), 'm$')}</td>`,
        openInterestChange48h: () => `<td class="${cellClasses}">${formatChangeCell(String(data.openInterestChange48h).replace('M', ''), 'm$')}</td>`,
        openInterestPercent1m: () => `<td class="${cellClasses}">${formatChangeCell(data.openInterestPercent1m)}</td>`,
        openInterestPercent5m: () => `<td class="${cellClasses}">${formatChangeCell(data.openInterestPercent5m)}</td>`,
        openInterestPercent15m: () => `<td class="${cellClasses}">${formatChangeCell(data.openInterestPercent15m)}</td>`,
        openInterestPercent1h: () => `<td class="${cellClasses}">${formatChangeCell(data.openInterestPercent1h)}</td>`,
        openInterestPercent4h: () => `<td class="${cellClasses}">${formatChangeCell(data.openInterestPercent4h)}</td>`,
        openInterestPercent12h: () => `<td class="${cellClasses}">${formatChangeCell(data.openInterestPercent12h)}</td>`,
        openInterestPercent24h: () => `<td class="${cellClasses}">${formatChangeCell(data.openInterestPercent24h)}</td>`,
        openInterestPercent48h: () => `<td class="${cellClasses}">${formatChangeCell(data.openInterestPercent48h)}</td>`,
        volumeChange5m: () => `<td class="${cellClasses}">${formatChangeCell(data.volumeChange5m)}</td>`,
        volumeChange15m: () => `<td class="${cellClasses}">${formatChangeCell(data.volumeChange15m)}</td>`,
        volumeChange1h: () => `<td class="${cellClasses}">${formatChangeCell(data.volumeChange1h)}</td>`,
        volumeChange4h: () => `<td class="${cellClasses}">${formatChangeCell(data.volumeChange4h)}</td>`,
        volumeChange12h: () => `<td class="${cellClasses}">${formatChangeCell(data.volumeChange12h)}</td>`,
        volumeChange24h: () => `<td class="${cellClasses}">${formatChangeCell(data.volumeChange24h)}</td>`,
        relativeStrength24h: () => `<td class="${cellClasses} text-gray-500">${data.relativeStrength24h}</td>`,
        relativeStrength4h: () => `<td class="${cellClasses} text-gray-500">${data.relativeStrength4h}</td>`,
        relativeStrength1h: () => `<td class="${cellClasses} text-gray-500">${data.relativeStrength1h}</td>`,
        timestamp: () => `<td class="${cellClasses} text-gray-400">${data.timestamp}</td>`,
        fundingRate: () => `<td class="${cellClasses}">${formatChangeCell(data.fundingRate, '%')}</td>`,
        fundingRateChange1h: () => `<td class="${cellClasses}">${formatChangeCell(data.fundingRateChange1h, '%')}</td>`,
        fundingRateChange4h: () => `<td class="${cellClasses}">${formatChangeCell(data.fundingRateChange4h, '%')}</td>`,
        fundingRateChange24h: () => `<td class="${cellClasses}">${formatChangeCell(data.fundingRateChange24h, '%')}</td>`,
        fundingRateSuggestion: () => `<td class="${cellClasses}"><div class="text-center px-2 py-0.5 text-xs font-bold rounded ${getSignalClass(data.fundingRateSuggestion)}">${data.fundingRateSuggestion}</div></td>`,
        oiWeightedFundingRate: () => `<td class="${cellClasses}">${formatChangeCell(data.oiWeightedFundingRate || data.fundingRate, '%')}</td>`,
        oiWeightedContribution: () => `<td class="${cellClasses}">${data.oiWeightedContribution ? data.oiWeightedContribution.toFixed(4) + '%' : 'N/A'}</td>`
    };

    let html = '';
    const mainHeaders = Array.from(document.getElementById('table-headers').children);
    
    // Always render the symbol first
    html += cells['symbol'](data);

    if (activeTab === 'open-interest') {
        const openInterestHeaders = Array.from(document.querySelectorAll('#open-interest th'));
        openInterestHeaders.forEach(header => {
            const key = header.dataset.sort;
            if (cells[key] && key !== 'symbol') { // key !== 'symbol' is redundant now but safe
                html += cells[key](data);
            }
        });
    } else {
        mainHeaders.forEach(header => {
            const key = header.dataset.sort;
            if (key === 'symbol') return; // Skip symbol as it's already added

            const tab = header.dataset.tab;
            const isVisible = visibleColumns[key];
            const belongsToTab = activeTab === 'overview' || tab === activeTab;

            if (isVisible && belongsToTab && cells[key]) {
                html += cells[key](data);
            }
        });
    }
    return html;
}

// --- Cell Formatting ---

const formatChangeCell = (change, unit = '') => {
    if (change === 'N/A') return `<span class="text-gray-400">${change}</span>`;
    const changeValue = parseFloat(change);
    const colorClass = changeValue > 0 ? 'text-green-600' : 'text-red-600';
    return `<span class="${colorClass}">${change}${unit}</span>`;
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

const formatVwapDeviationCell = (deviation) => {
    const deviationValue = parseFloat(deviation);
    let colorClass = 'text-gray-800';
    if (deviationValue > 5) {
        colorClass = 'text-red-600'; // Overbought
    } else if (deviationValue < -5) {
        colorClass = 'text-green-600'; // Oversold
    }
    return `<span class="${colorClass}">${deviation}</span>`;
};

function updateMarketSentiment(symbol, score) {
    const sentimentId = symbol === 'BTCUSDT' ? 'sentiment-btc' : (symbol === 'ETHUSDT' ? 'sentiment-eth' : 'sentiment-alpha7');
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

        if (sortColumn.startsWith('openInterestPercent')) {
            aValue = parseFloat(aValue);
            bValue = parseFloat(bValue);
        } else if (sortColumn === 'signalStrength') {
            aValue = signalStrengthMap[aValue] || 0;
            bValue = signalStrengthMap[bValue] || 0;
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

document.getElementById('table-headers').addEventListener('click', handleHeaderClick);
document.getElementById('open-interest-table-headers').addEventListener('click', handleHeaderClick);

function handleHeaderClick(event) {
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
}

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
if (mobileExportBtn) {
    mobileExportBtn.addEventListener('click', exportTableToCSV);
}

function filterByCoin() {
    const searchTerm = searchCoinInput.value.trim().toUpperCase();
    if (searchTerm) {
        tableData = allData.filter(item => item.symbol.toUpperCase().includes(searchTerm));
    } else {
        tableData = [...allData];
    }
    renderTable();
}

searchCoinBtn.addEventListener('click', filterByCoin);
searchCoinInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
        filterByCoin();
    }
});


// --- Filter Dropdown ---
const filterDropdown = document.createElement('div');
filterDropdown.id = 'filter-dropdown';
filterDropdown.className = 'hidden absolute bg-white border border-gray-200 rounded shadow-lg z-20 p-4';
document.body.appendChild(filterDropdown);

document.addEventListener('click', (event) => {
    if (event.target.classList.contains('filter-btn')) {
        const column = event.target.dataset.column;
        const values = [...new Set(allData.map(item => item[column]))];
        let content = `<input type="text" id="filter-input" placeholder="Filter..." class="px-3 py-1.5 text-xs border border-gray-300 rounded w-full mb-2">`;
        content += '<div id="filter-values" class="max-h-48 overflow-y-auto">';
        values.forEach(value => {
            content += `<label class="flex items-center space-x-2 text-sm"><input type="checkbox" class="filter-checkbox" value="${value}"> ${value}</label>`;
        });
        content += '</div>';
        content += '<button id="apply-filter-btn" class="px-3 py-1.5 text-xs bg-blue-600 text-white rounded mt-2">Apply</button>';
        filterDropdown.innerHTML = content;
        const rect = event.target.getBoundingClientRect();
        filterDropdown.style.left = `${rect.left}px`;
        filterDropdown.style.top = `${rect.bottom}px`;
        filterDropdown.classList.remove('hidden');

        document.getElementById('apply-filter-btn').addEventListener('click', () => {
            const checkedValues = [...document.querySelectorAll('.filter-checkbox:checked')].map(cb => cb.value);
            applyFilter(column, checkedValues);
            filterDropdown.classList.add('hidden');
        });
    } else if (!filterDropdown.contains(event.target)) {
        filterDropdown.classList.add('hidden');
    }
});

function applyFilter(column, values) {
    if (values.length === 0) {
        tableData = [...allData];
    } else {
        tableData = allData.filter(item => values.includes(String(item[column])));
    }
    renderTable();
}

function calculateAndDisplayOIWeightedFR() {
    let totalOI = 0;
    let weightedSum = 0;

    allData.forEach(item => {
        const fundingRate = parseFloat(item.fundingRate);
        const openInterest = parseFloat(item.oi);

        if (!isNaN(fundingRate) && !isNaN(openInterest)) {
            totalOI += openInterest;
            weightedSum += fundingRate * openInterest;
        }
    });

    // Calculate individual contributions
    allData.forEach(item => {
        const fundingRate = parseFloat(item.fundingRate);
        const openInterest = parseFloat(item.oi);
        if (!isNaN(fundingRate) && !isNaN(openInterest) && totalOI > 0) {
            item.oiWeightedContribution = (fundingRate * openInterest / totalOI) * 100;
        } else {
            item.oiWeightedContribution = 0;
        }
    });
}

// --- Initial Load ---
initialize();
