const tableBody = document.getElementById('funding-rate-table-body');
const oiWeightedRateEl = document.getElementById('oi-weighted-rate');
const socket = new WebSocket('ws://localhost:5019');

let totalOI = 0;
let weightedSum = 0;
let symbolData = new Map();

socket.onopen = () => {
    console.log('Connected to WebSocket server');
    oiWeightedRateEl.textContent = 'Waiting for data...';
};

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.error) {
        console.error('Server error:', data.error);
        oiWeightedRateEl.textContent = `Error: ${data.error}`;
        return;
    }
    
    // Check if it's the end-of-cycle signal
    if (data.symbol === 'alpha7Signal') {
        // Final calculation for the cycle
        const oiWeightedRate = totalOI > 0 ? weightedSum / totalOI : 0;
        oiWeightedRateEl.textContent = `OI-Weighted Funding Rate: ${oiWeightedRate.toFixed(4)}%`;

        // Reset for the next cycle
        totalOI = 0;
        weightedSum = 0;
        tableBody.innerHTML = ''; // Clear table for the new cycle's data
        return;
    }

    // Process regular symbol data
    if (data.fundingRate === undefined || data.fundingRate === 'N/A' || data.oi === undefined) {
        return;
    }
    
    const fundingRate = parseFloat(data.fundingRate);
    const openInterest = parseFloat(data.oi);

    if (isNaN(fundingRate) || isNaN(openInterest)) {
        return;
    }

    // Accumulate for the current cycle
    totalOI += openInterest;
    weightedSum += fundingRate * openInterest;

    // Add or update the row in the table
    let row = document.getElementById(data.symbol);
    if (!row) {
        row = document.createElement('tr');
        row.id = data.symbol;
        tableBody.appendChild(row);
    }

    row.innerHTML = `
        <td>${data.symbol}</td>
        <td>${data.fundingRate}</td>
        <td>${Math.round(data.oi).toLocaleString()}</td>
    `;
};

socket.onclose = () => {
    console.log('Disconnected from WebSocket server');
    // Reset state on disconnect
    totalOI = 0;
    weightedSum = 0;
    oiWeightedRateEl.textContent = 'Disconnected. Please refresh.';
    tableBody.innerHTML = '';
};
