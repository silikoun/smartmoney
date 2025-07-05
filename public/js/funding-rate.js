const tableBody = document.getElementById('funding-rate-table-body');
const socket = new WebSocket('ws://localhost:5019');

socket.onopen = () => {
    console.log('Connected to WebSocket server');
};

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.error) {
        console.error('Server error:', data.error);
        return;
    }

    if (data.symbol === 'alpha7Signal') {
        return;
    }

    // Only update if fundingRate is available
    if (data.fundingRate === undefined || data.fundingRate === 'N/A') {
        return;
    }
    
    let row = document.getElementById(data.symbol);
    if (!row) {
        row = document.createElement('tr');
        row.id = data.symbol;
        tableBody.appendChild(row);
    }

    row.innerHTML = `
        <td>${data.symbol}</td>
        <td>${data.fundingRate}</td>
        <td>${data.fundingRateChange15m || 'N/A'}</td>
        <td>${data.fundingRateChange1h || 'N/A'}</td>
        <td>${data.fundingRateChange4h || 'N/A'}</td>
        <td>${data.fundingRateChange24h || 'N/A'}</td>
        <td>${data.fundingRateChange48h || 'N/A'}</td>
        <td>${data.fundingRateSuggestion}</td>
    `;
};

socket.onclose = () => {
    console.log('Disconnected from WebSocket server');
};
