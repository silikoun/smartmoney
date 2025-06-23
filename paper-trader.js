const fs = require('fs');
const path = require('path');

const paperTradesPath = path.join(__dirname, 'paper-trades.json');

let paperPortfolio = {
    balance: 600, // Starting with a $600 paper portfolio
    openPositions: new Map(),
    tradeHistory: []
};
const positionCooldowns = new Map();

function loadPortfolio() {
    if (fs.existsSync(paperTradesPath)) {
        const data = fs.readFileSync(paperTradesPath, 'utf8');
        paperPortfolio = JSON.parse(data);
        // Convert the openPositions array back to a Map
        paperPortfolio.openPositions = new Map(paperPortfolio.openPositions);
    } else {
        savePortfolio(); // Create the file if it doesn't exist
    }
}

function savePortfolio() {
    // Convert the openPositions Map to an array for JSON serialization
    const portfolioToSave = {
        ...paperPortfolio,
        openPositions: Array.from(paperPortfolio.openPositions.entries())
    };
    fs.writeFileSync(paperTradesPath, JSON.stringify(portfolioToSave, null, 2));
}

function checkTrades(symbol, price) {
    if (paperPortfolio.openPositions.has(symbol)) {
        const position = paperPortfolio.openPositions.get(symbol);
        const pnl = (price - position.entryPrice) / position.entryPrice * 100 * (position.side === 'long' ? 1 : -1);

        if (pnl >= 1) { // Take Profit
            closePosition(symbol, price, 'Take Profit');
        } else if (pnl <= -1) { // Stop Loss
            closePosition(symbol, price, 'Stop Loss');
        }
    }
}

function openPosition(symbol, side, price, signal) {
    if (paperPortfolio.openPositions.has(symbol)) {
        return; // Already have a position
    }

    const now = Date.now();
    if (positionCooldowns.has(symbol) && (now - positionCooldowns.get(symbol) < 3600 * 1000)) {
        return; // In cooldown
    }

    const positionSize = paperPortfolio.balance * 0.1; // Risk 10% of portfolio per trade
    const position = {
        symbol,
        side,
        entryPrice: price,
        size: positionSize,
        timestamp: Date.now(),
        signal
    };

    paperPortfolio.openPositions.set(symbol, position);
    console.log(`Opened ${side} position for ${symbol} at ${price}`);
    savePortfolio();
}

function closePosition(symbol, price, reason) {
    const position = paperPortfolio.openPositions.get(symbol);
    const pnl = (price - position.entryPrice) / position.entryPrice * (position.side === 'long' ? 1 : -1);
    const pnlAmount = position.size * pnl / 100;

    paperPortfolio.balance += pnlAmount;
    paperPortfolio.tradeHistory.push({
        ...position,
        exitPrice: price,
        exitTimestamp: Date.now(),
        pnl,
        pnlAmount,
        reason
    });
    paperPortfolio.openPositions.delete(symbol);
    positionCooldowns.set(symbol, Date.now());

    console.log(`Closed ${position.side} position for ${symbol} at ${price}. Reason: ${reason}. PnL: ${pnl.toFixed(2)}%`);
    savePortfolio();
}

function getPortfolio() {
    return paperPortfolio;
}

module.exports = {
    loadPortfolio,
    checkTrades,
    openPosition,
    getPortfolio
};
