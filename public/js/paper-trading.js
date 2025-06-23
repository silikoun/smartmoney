const portfolioBalanceEl = document.getElementById('portfolio-balance');
const openPositionsCountEl = document.getElementById('open-positions-count');
const totalPnlEl = document.getElementById('total-pnl');
const openPositionsTable = document.getElementById('open-positions-table');
const tradeHistoryTable = document.getElementById('trade-history-table');

async function fetchPortfolioData() {
    try {
        const response = await fetch('/api/paper-portfolio');
        const data = await response.json();
        renderPortfolio(data);
    } catch (error) {
        console.error('Error fetching portfolio data:', error);
    }
}

function renderPortfolio(portfolio) {
    const account = portfolio[0];
    portfolioBalanceEl.textContent = `$${parseFloat(account.available).toFixed(2)}`;
    openPositionsCountEl.textContent = 'N/A';
    totalPnlEl.textContent = 'N/A';
}


const placeOrderForm = document.getElementById('place-order-form');

placeOrderForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const symbol = document.getElementById('symbol').value;
    const side = document.getElementById('side').value;
    const price = document.getElementById('price').value;
    const size = document.getElementById('size').value;

    try {
        const response = await fetch('/api/place-order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ symbol, side, price, size })
        });
        const data = await response.json();
        console.log('Order placed:', data);
        fetchPortfolioData();
    } catch (error) {
        console.error('Error placing order:', error);
    }
});

fetchPortfolioData();
setInterval(fetchPortfolioData, 5000); // Refresh every 5 seconds
