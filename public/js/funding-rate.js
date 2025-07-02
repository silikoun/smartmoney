const tableBody = document.getElementById('funding-rate-table-body');
const socket = new WebSocket('ws://localhost:5018');

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

    let row = document.getElementById(data.symbol);
    if (!row) {
        row = document.createElement('tr');
        row.id = data.symbol;
        tableBody.appendChild(row);
    }

    row.innerHTML = `
        <td>${data.symbol}</td>
        <td>${data.fundingRate}</td>
        <td>${data.fundingRate1h}</td>
        <td>${data.fundingRate4h}</td>
        <td>${data.fundingRate24h}</td>
        <td>${data.fundingRateSuggestion}</td>
    `;
};

socket.onclose = () => {
    console.log('Disconnected from WebSocket server');
};
