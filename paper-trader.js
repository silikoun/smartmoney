// This file has been intentionally left blank to disable paper trading in production.
module.exports = {
    loadPortfolio: () => {},
    checkTrades: () => {},
    openPosition: () => {},
    getPortfolio: () => ({
        balance: 0,
        openPositions: new Map(),
        tradeHistory: []
    })
};
