const indicatorsTableBody = document.getElementById('indicators-table-body');
const socket = new WebSocket('ws://localhost:5018');
const searchCoinBtn = document.getElementById('search-coin-btn');
const searchCoinInput = document.getElementById('search-coin-input');

let allData = [];
let indicatorData = [];

socket.onopen = () => {
    console.log('Connected to WebSocket server');
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

    // Preserve search filter if active
    const searchTerm = searchCoinInput.value.trim().toUpperCase();
    if (searchTerm) {
        indicatorData = allData.filter(item => item.symbol.toUpperCase().includes(searchTerm));
    } else {
        indicatorData = [...allData];
    }

    renderIndicators();
};

socket.onclose = () => {
    console.log('Disconnected from WebSocket server');
};

function renderIndicators() {
    indicatorsTableBody.innerHTML = '';
    const fragment = document.createDocumentFragment();
    indicatorData.forEach(data => {
        const row = document.createElement('tr');
        row.className = 'text-xs';
        row.innerHTML = `
            <td class="px-4 py-3 font-bold text-blue-600">${data.symbol}</td>
            <td class="px-4 py-3 font-mono text-gray-500">${data.ma15m}</td>
            <td class="px-4 py-3 font-mono text-gray-500">${data.ma1h}</td>
            <td class="px-4 py-3 font-mono text-gray-500">${data.ma4h}</td>
        `;
        fragment.appendChild(row);
    });
    indicatorsTableBody.appendChild(fragment);
}

function filterByCoin() {
    const searchTerm = searchCoinInput.value.trim().toUpperCase();
    if (searchTerm) {
        indicatorData = allData.filter(item => item.symbol.toUpperCase().includes(searchTerm));
    } else {
        indicatorData = [...allData];
    }
    renderIndicators();
}

searchCoinBtn.addEventListener('click', filterByCoin);
searchCoinInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
        filterByCoin();
    }
});
