const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const axios = require('axios');
const logger = require('./logger');
const paperTrader = require('./paper-trader');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const fs = require('fs');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/logs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'logs.html'));
});

app.get('/indicators', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'indicators.html'));
});

app.get('/api/logs', (req, res) => {
    fs.readFile('signals.log', 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading log file:', err);
            return res.status(500).send('Error reading log file');
        }
        const logs = data.split('\n').filter(line => line).map(line => JSON.parse(line));
        res.json(logs.reverse());
    });
});

app.get('/api/config', (req, res) => {
    res.json({
        divergence_ui_threshold_bullish: config.divergence_ui_threshold_bullish,
        divergence_ui_threshold_bearish: config.divergence_ui_threshold_bearish
    });
});

app.get('/api/blacklist', (req, res) => {
    const now = Date.now();
    const cooldown = (config.blacklist_cooldown_hours || 1) * 3600 * 1000;
    const blacklistData = Array.from(symbolBlacklist.entries()).map(([symbol, timestamp]) => {
        const timeRemaining = Math.round((cooldown - (now - timestamp)) / 1000);
        return { symbol, timeRemaining };
    });
    res.json(blacklistData);
});

app.get('/api/paper-portfolio', (req, res) => {
    const portfolio = paperTrader.getPortfolio();
    const portfolioToSend = {
        ...portfolio,
        openPositions: Array.from(portfolio.openPositions.entries())
    };
    res.json(portfolioToSend);
});



const getBinanceData = async (symbol, endpoint, params = {}) => {
    try {
        const requestParams = { ...params };
        if (symbol) {
            requestParams.symbol = symbol;
        }
        const res = await axios.get(endpoint, { params: requestParams, timeout: 30000 });
        return res.data;
    } catch (error) {
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            console.warn(`Request for ${symbol} on ${endpoint} timed out. Will retry next cycle.`);
        } else if (error.code === 'ECONNRESET' || error.code === 'EAI_AGAIN') {
            console.warn(`Socket issue for ${symbol} on ${endpoint}. Will retry next cycle.`);
        } else {
            console.error(`Unhandled error for ${symbol} on ${endpoint}: ${error.message}`);
        }
        return null;
    }
};

let previousData = {};
const alertCooldowns = {};
const alphaDivergenceCooldowns = {};
const marketSentiment = {
    BTCUSDT: 'Neutral',
    ETHUSDT: 'Neutral'
};
const TELEGRAM_BOT_TOKEN = '7730946498:AAF5ZkwptplIgUmO1UwSHM2eQ-TXfo-lxQg';
const TELEGRAM_CHAT_ID = '1218558676';

async function sendTelegramMessage(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Error sending Telegram message:', error.message);
    }
}

async function sendAlpha7Alert(symbol, score) {
    const threshold = config.alpha7_alert_threshold || 75;
    let signal = '';

    if (score > threshold) {
        signal = 'Strong Bullish Alpha-7 Signal';
    } else if (score < -threshold) {
        signal = 'Strong Bearish Alpha-7 Signal';
    }

    if (signal) {
        const now = Date.now();
        const cooldown = 3600 * 1000; // 1 hour cooldown
        if (!alertCooldowns[symbol] || (now - alertCooldowns[symbol] > cooldown)) {
            const btcSentiment = `BTC: ${marketSentiment.BTCUSDT}`;
            const ethSentiment = `ETH: ${marketSentiment.ETHUSDT}`;
            const message = `*${signal}*\n\n*Coin:* ${symbol}\n*Alpha-7 Score:* ${score}\n\n*Market Context:*\n${btcSentiment}\n${ethSentiment}`;
            await sendTelegramMessage(message);
            alertCooldowns[symbol] = now;
        }
    }
}

wss.on('connection', (ws) => {
    console.log('Client connected');
    let isProcessing = false;
    let timeoutId;

    const processSymbols = async () => {
        if (isProcessing) {
            console.log('Already processing symbols. Skipping this cycle.');
            return;
        }
        isProcessing = true;

        try {
            let symbols = await getSymbolsWithRetry();
            if (!symbols) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ error: 'Could not fetch symbols after multiple retries. Please check server connection and restart.' }));
                }
                isProcessing = false;
                return;
            }

            const delay = 60000 / symbols.length; // Stagger requests over one minute

            for (const symbol of symbols) {
                try {
                    const data = await fetchAllDataForSymbol(symbol);
                    if (data && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(data));
                    }
                } catch (error) {
                    console.error(`Failed to process symbol ${symbol}:`, error);
                }
                await new Promise(res => setTimeout(res, delay));
            }
        } finally {
            isProcessing = false;
            console.log('Finished processing all symbols for this cycle.');
            // Schedule the next run
            if (ws.readyState === WebSocket.OPEN) {
                timeoutId = setTimeout(processSymbols, 1000); // Start next cycle 1s after the previous one finishes
            }
        }
    };

    processSymbols();

    ws.on('close', () => {
        console.log('Client disconnected');
        clearTimeout(timeoutId);
    });
});

const getSymbolsWithRetry = async (retries = 5, delay = 5000) => {
    for (let i = 0; i < retries; i++) {
        try {
            const endpoint = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
            const data = await getBinanceData(null, endpoint);
            if (data && data.symbols) {
                console.log('Successfully fetched symbols.');
                return data.symbols
                    .filter(s => s.status === 'TRADING' && s.symbol.endsWith('USDT'))
                    .map(s => s.symbol);
            }
        } catch (error) {
            console.error(`Attempt ${i + 1} to fetch symbols failed.`, error);
        }
        
        if (i < retries - 1) {
            console.log(`Retrying to fetch symbols in ${delay / 1000} seconds...`);
            await new Promise(res => setTimeout(res, delay));
            delay *= 2; // Exponential backoff
        }
    }
    return null;
};

const getSymbols = async () => {
    const endpoint = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
    const data = await getBinanceData(null, endpoint);
    if (data && data.symbols) {
        return data.symbols
            .filter(s => s.status === 'TRADING' && s.symbol.endsWith('USDT'))
            .map(s => s.symbol);
    }
    return null;
};

const fetchAllDataForSymbol = async (symbol) => {
    const open_interest_endpoint = 'https://fapi.binance.com/fapi/v1/openInterest';
    const price_endpoint = 'https://fapi.binance.com/fapi/v1/ticker/price';
    const ls_top_position_endpoint = 'https://fapi.binance.com/futures/data/topLongShortPositionRatio';
    const ls_global_position_endpoint = 'https://fapi.binance.com/futures/data/globalLongShortAccountRatio';
    const oi_hist_endpoint = 'https://fapi.binance.com/futures/data/openInterestHist';
    const klines_endpoint = 'https://fapi.binance.com/fapi/v1/klines';

    const [
        open_interest_data,
        price_data,
        oi_hist_data_1h,
        oi_hist_data_5m,
        ls_top_hist_data,
        ls_top_position_data_15m,
        ls_global_position_data_15m,
        ls_top_position_data_24h,
        ls_global_position_data_24h,
        ls_top_position_data_4h,
        ls_global_position_data_4h,
        ls_top_position_data_1h,
        ls_global_position_data_1h,
        ls_top_position_data_15m_for_divergence,
        ls_global_position_data_15m_for_divergence,
        klines_data_15m,
        klines_data_4h,
        klines_data_1d
    ] = await Promise.all([
        getBinanceData(symbol, open_interest_endpoint),
        getBinanceData(symbol, price_endpoint),
        getBinanceData(symbol, oi_hist_endpoint, { period: '1h', limit: 25 }),
        getBinanceData(symbol, oi_hist_endpoint, { period: '5m', limit: 4 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '5m', limit: 288 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '5m', limit: 3 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '5m', limit: 3 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '15m', limit: 96 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '15m', limit: 96 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '5m', limit: 48 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '5m', limit: 48 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '5m', limit: 12 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '5m', limit: 12 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '5m', limit: 3 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '5m', limit: 3 }),
        getBinanceData(symbol, klines_endpoint, { interval: '15m', limit: 96 }),
        getBinanceData(symbol, klines_endpoint, { interval: '4h', limit: 96 }),
        getBinanceData(symbol, klines_endpoint, { interval: '1d', limit: 96 })
    ]);

    const price = price_data ? parseFloat(price_data.price) : 0;
    const openInterestInUSD = open_interest_data && price ? (parseFloat(open_interest_data.openInterest) * price) : 0;

    if (openInterestInUSD < config.minimum_open_interest_usd) {
        return null;
    }

    const prev = previousData[symbol] || {
        openInterest: null
    };

    // --- Multi-Timeframe Divergence Calculation ---
    const divergenceVector24h = calculateDivergenceVector(ls_top_position_data_24h, ls_global_position_data_24h);
    const divergenceVector4h = calculateDivergenceVector(ls_top_position_data_4h, ls_global_position_data_4h);
    const divergenceVector1h = calculateDivergenceVector(ls_top_position_data_1h, ls_global_position_data_1h);
    const divergenceVector15m = calculateDivergenceVector(ls_top_position_data_15m_for_divergence, ls_global_position_data_15m_for_divergence);
    const topTraderTrend24h = calculate24hTrend(ls_top_position_data_24h);

    // --- OI Change Calculation ---
    const calculateOiChange = (data, candles) => {
        if (!data || data.length <= candles) return 0;
        const now = parseFloat(data[data.length - 1].sumOpenInterestValue);
        const then = parseFloat(data[data.length - 1 - candles].sumOpenInterestValue);
        return now - then;
    };

    const openInterestChange5m = calculateOiChange(oi_hist_data_5m, 1);
    const openInterestChange15m = calculateOiChange(oi_hist_data_5m, 3);
    const openInterestChange1h = calculateOiChange(oi_hist_data_1h, 1);
    const openInterestChange4h = calculateOiChange(oi_hist_data_1h, 4);
    const openInterestChange12h = calculateOiChange(oi_hist_data_1h, 12);
    const openInterestChange24h = calculateOiChange(oi_hist_data_1h, 24);
    
    const openInterestChange1m = prev.openInterest ? (openInterestInUSD - prev.openInterest) : 0;

    // --- 15m Conviction and Divergence Calculation ---
    const oiConvictionScore = calculateOiConvictionScore({
        openInterestChange1m,
        openInterestChange5m,
        openInterestChange15m,
        openInterestChange1h,
        openInterestChange4h,
        openInterestChange12h,
        openInterestChange24h
    });
    const alphaDivergenceScore15m = calculateAlphaDivergence(ls_top_position_data_15m, ls_global_position_data_15m, oiConvictionScore);

    // --- Momentum Index Calculation ---
    const currentLsTopPositionRatio = ls_top_position_data_15m && ls_top_position_data_15m[0] ? parseFloat(ls_top_position_data_15m[0].longShortRatio) : null;
    
    const calculateLsChange = (data, candles) => {
        if (!data || data.length <= candles) return 'N/A';
        const now = parseFloat(data[data.length - 1].longShortRatio);
        const then = parseFloat(data[data.length - 1 - candles].longShortRatio);
        if (isNaN(now) || isNaN(then)) return 'N/A';
        return (now - then).toFixed(4);
    };

    const lsTopPositionRatioChange5m = calculateLsChange(ls_top_hist_data, 1);
    const lsTopPositionRatioChange15mFrom5m = calculateLsChange(ls_top_hist_data, 3);
    const lsTopPositionRatioChange30m = calculateLsChange(ls_top_hist_data, 6);
    const lsTopPositionRatioChange1h = calculateLsChange(ls_top_hist_data, 12);
    const lsTopPositionRatioChange4h = calculateLsChange(ls_top_hist_data, 48);

    const momentumIndex = calculateMomentumIndex(lsTopPositionRatioChange15mFrom5m, openInterestChange1m, openInterestChange5m);

    // --- L/S Conviction Score Calculation ---
    const lsConvictionScore = calculateLsConvictionScore({
        lsTopPositionRatioChange15m: lsTopPositionRatioChange15mFrom5m,
        lsTopPositionRatioChange30m,
        lsTopPositionRatioChange1h,
        lsTopPositionRatioChange4h
    });

    // --- Divergence Vector Conviction Score Calculation ---
    const divVectorConvictionScore = calculateDivVectorConvictionScore({
        divergenceVector15m,
        divergenceVector1h,
        divergenceVector4h
    });

    // --- Alpha-7 Signal Calculation ---
    const alpha7Signal = calculateAlpha7Signal(lsConvictionScore, divVectorConvictionScore);

    // --- VWAP Calculation ---
    const vwap15m = calculateVwap(klines_data_15m);
    const vwap4h = calculateVwap(klines_data_4h);
    const vwap1d = calculateVwap(klines_data_1d);
    const vwapDeviation15m = vwap15m > 0 ? ((price - vwap15m) / vwap15m) * 100 : 0;
    const vwapDeviation4h = vwap4h > 0 ? ((price - vwap4h) / vwap4h) * 100 : 0;
    const vwapDeviation1d = vwap1d > 0 ? ((price - vwap1d) / vwap1d) * 100 : 0;

    // --- Paper Trading ---
    paperTrader.checkTrades(symbol, price);

    if (alpha7Signal > 80 && vwapDeviation15m > 0) {
        paperTrader.openPosition(symbol, 'long', price, alpha7Signal);
    } else if (alpha7Signal < -80 && vwapDeviation15m < 0) {
        paperTrader.openPosition(symbol, 'short', price, alpha7Signal);
    }

    if (symbol === 'BTCUSDT' || symbol === 'ETHUSDT') {
        let sentiment = 'Neutral';
        if (alpha7Signal > 50) sentiment = 'Bullish';
        else if (alpha7Signal < -50) sentiment = 'Bearish';
        marketSentiment[symbol] = sentiment;
    }

    sendAlpha7Alert(symbol, alpha7Signal);

    // --- Signal Strength Calculation ---
    const signalStrength = calculateSignalStrength(symbol, lsTopPositionRatioChange15mFrom5m, currentLsTopPositionRatio);


    const data = {
        symbol,
        momentumIndex,
        signalStrength,
        alphaDivergenceScore15m: alphaDivergenceScore15m ? alphaDivergenceScore15m.toFixed(4) : 'N/A',
        oiConvictionScore,
        divergenceVector24h: divergenceVector24h ? divergenceVector24h.toFixed(4) : 'N/A',
        divergenceVector4h: divergenceVector4h ? divergenceVector4h.toFixed(4) : 'N/A',
        divergenceVector1h: divergenceVector1h ? divergenceVector1h.toFixed(4) : 'N/A',
        divergenceVector15m: divergenceVector15m ? divergenceVector15m.toFixed(4) : 'N/A',
        topTraderTrend24h,
        timestamp: new Date().toLocaleTimeString(),
        lsTopPositionRatio: currentLsTopPositionRatio !== null ? currentLsTopPositionRatio.toFixed(4) : 'N/A',
        lsTopPositionRatioChange5m,
        lsTopPositionRatioChange15m: lsTopPositionRatioChange15mFrom5m,
        lsTopPositionRatioChange30m,
        lsTopPositionRatioChange1h,
        lsTopPositionRatioChange4h,
        lsConvictionScore,
        divVectorConvictionScore,
        alpha7Signal,
        vwapDeviation15m: vwapDeviation15m.toFixed(2) + '%',
        vwapDeviation4h: vwapDeviation4h.toFixed(2) + '%',
        vwapDeviation1d: vwapDeviation1d.toFixed(2) + '%',
        openInterestChange1m: (openInterestChange1m / 1000000).toFixed(2) + 'M',
        openInterestChange5m: (openInterestChange5m / 1000000).toFixed(2) + 'M',
        openInterestChange15m: (openInterestChange15m / 1000000).toFixed(2) + 'M',
        openInterestChange1h: (openInterestChange1h / 1000000).toFixed(2) + 'M',
        openInterestChange4h: (openInterestChange4h / 1000000).toFixed(2) + 'M',
        openInterestChange12h: (openInterestChange12h / 1000000).toFixed(2) + 'M',
        openInterestChange24h: (openInterestChange24h / 1000000).toFixed(2) + 'M'
    };

    previousData[symbol] = {
        openInterest: openInterestInUSD
    };

    return data;
};

function calculate24hTrend(data24h) {
    if (!data24h || data24h.length < 96) {
        return 'Sideways';
    }

    data24h.sort((a, b) => a.timestamp - b.timestamp);

    const slowMaData = data24h.map(d => parseFloat(d.longShortRatio));
    const fastMaData = slowMaData.slice(-12); // Last 3 hours (12 * 15m)

    const slowMa = slowMaData.reduce((a, b) => a + b, 0) / slowMaData.length;
    const fastMa = fastMaData.reduce((a, b) => a + b, 0) / fastMaData.length;

    if (fastMa > slowMa * 1.005) { // Add a 0.5% buffer to avoid noise
        return 'Uptrend';
    } else if (fastMa < slowMa * 0.995) { // Add a 0.5% buffer
        return 'Downtrend';
    } else {
        return 'Sideways';
    }
}

function calculateAlpha7Signal(lsConviction, divConviction) {
    if (lsConviction === undefined || divConviction === undefined) return 0;
    
    // 60% weight on Divergence Conviction, 40% on L/S Conviction
    const weightedScore = (divConviction * 0.6) + (lsConviction * 0.4);
    
    return Math.round(weightedScore);
}

function calculateVwap(klines) {
    if (!klines || klines.length === 0) {
        return 0;
    }

    let cumulativeTypicalPriceVolume = 0;
    let cumulativeVolume = 0;

    klines.forEach(kline => {
        const high = parseFloat(kline[2]);
        const low = parseFloat(kline[3]);
        const close = parseFloat(kline[4]);
        const volume = parseFloat(kline[5]);

        const typicalPrice = (high + low + close) / 3;
        cumulativeTypicalPriceVolume += typicalPrice * volume;
        cumulativeVolume += volume;
    });

    return cumulativeVolume > 0 ? cumulativeTypicalPriceVolume / cumulativeVolume : 0;
}

function calculateDivVectorConvictionScore(divVectors) {
    const weights = {
        divergenceVector15m: 1,
        divergenceVector1h: 2,
        divergenceVector4h: 3,
    };

    let score = 0;
    let maxScore = 0;
    for (const key in weights) {
        const value = parseFloat(divVectors[key]);
        if (isNaN(value)) continue;

        maxScore += weights[key];
        if (value > 0) {
            score += weights[key];
        } else if (value < 0) {
            score -= weights[key];
        }
    }
    
    if (maxScore === 0) return 0;
    return Math.round((score / maxScore) * 100);
}

function calculateLsConvictionScore(lsChanges) {
    const weights = {
        lsTopPositionRatioChange15m: 2,
        lsTopPositionRatioChange30m: 3,
        lsTopPositionRatioChange1h: 4,
        lsTopPositionRatioChange4h: 5,
    };

    const maxScore = Object.values(weights).reduce((a, b) => a + b, 0);
    let score = 0;

    for (const key in weights) {
        const value = parseFloat(lsChanges[key]);
        if (isNaN(value)) continue;

        if (value > 0) {
            score += weights[key];
        } else if (value < 0) {
            score -= weights[key];
        }
    }
    
    if (maxScore === 0) return 0;
    return Math.round((score / maxScore) * 100);
}

function calculateDivergenceVector(topData, globalData) {
    if (!topData || !globalData || topData.length < 2 || globalData.length < 2 || topData.length !== globalData.length) {
        return null;
    }

    topData.sort((a, b) => a.timestamp - b.timestamp);
    globalData.sort((a, b) => a.timestamp - b.timestamp);

    const whaleChange = parseFloat(topData[topData.length - 1].longShortRatio) - parseFloat(topData[0].longShortRatio);
    const crowdChange = parseFloat(globalData[globalData.length - 1].longShortRatio) - parseFloat(globalData[0].longShortRatio);

    return whaleChange - crowdChange;
}

function calculateOiConvictionScore(oiChanges) {
    const weights = {
        openInterestChange1m: 1,
        openInterestChange5m: 2,
        openInterestChange15m: 3,
        openInterestChange1h: 4,
        openInterestChange4h: 5,
        openInterestChange12h: 6,
        openInterestChange24h: 7,
    };

    const maxScore = Object.values(weights).reduce((a, b) => a + b, 0);
    let score = 0;

    for (const key in weights) {
        const value = parseFloat(oiChanges[key]);
        if (isNaN(value)) continue;
        
        if (value > 0) {
            score += weights[key];
        } else if (value < 0) {
            score -= weights[key];
        }
    }
    
    if (maxScore === 0) return 0;
    return Math.round((score / maxScore) * 100);
}

function calculateAlphaDivergence(topData, globalData, oiConvictionScore) {
    if (!topData || topData.length < 3 || !globalData || globalData.length < 3) {
        return null;
    }

    topData.sort((a, b) => a.timestamp - b.timestamp);
    globalData.sort((a, b) => a.timestamp - b.timestamp);

    const topRatioThen = parseFloat(topData[0].longShortRatio);
    const topRatioNow = parseFloat(topData[2].longShortRatio);
    const topRatioChange = topRatioNow - topRatioThen;

    const globalRatioThen = parseFloat(globalData[0].longShortRatio);
    const globalRatioNow = parseFloat(globalData[2].longShortRatio);
    const globalRatioChange = globalRatioNow - globalRatioThen;

    let divergence = topRatioChange - globalRatioChange;

    // Apply OI Conviction Score as a multiplier
    const multiplier = 1 + (oiConvictionScore / 10) * 0.5;
    divergence *= multiplier;

    return divergence;
}

function calculateMomentumIndex(change15m, oiChange1m, oiChange5m) {
    let score = 50;
    const c15m = parseFloat(change15m);

    if (!isNaN(c15m)) {
        if (c15m > 0.02) score += 10;
        else if (c15m < -0.02) score -= 10;
    }

    if (oiChange5m > 1000000) {
        score += 15;
    } else if (oiChange5m < -1000000) {
        score -= 15;
    }

    // Apply OI as a multiplier for conviction
    if (oiChange1m > 0) {
        const deviation = (score - 50) * 1.2; // Amplify the deviation from neutral
        score = 50 + deviation;
    } else if (oiChange1m < 0) {
        const deviation = (score - 50) * 0.8; // Dampen the deviation
        score = 50 + deviation;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateSignalStrength(symbol, lsTopRatioChange, currentRatio) {
    const change = parseFloat(lsTopRatioChange);
    let signal = 'Neutral';

    if (change > 0.05) {
        signal = 'Strong Buy';
    } else if (change > 0.02) {
        signal = 'Weak Buy';
    } else if (change < -0.05) {
        signal = 'Strong Sell';
    } else if (change < -0.02) {
        signal = 'Weak Sell';
    }

    if (signal !== 'Neutral') {
        const now = Date.now();
        const cooldown = 3600 * 1000; // 1 hour
        if (!alertCooldowns[symbol] || (now - alertCooldowns[symbol] > cooldown)) {
            const message = `*${signal} Signal (15m)*\n\n*Coin:* ${symbol}\n*L/S Change (15m):* ${change}\n*Current Ratio:* ${currentRatio}`;
            sendTelegramMessage(message);
            logger.info({
                timestamp: new Date().toISOString(),
                symbol: symbol,
                signal: signal,
                change: change,
                currentRatio: currentRatio
            });
            alertCooldowns[symbol] = now;
        }
    }

    return signal;
}


const PORT = process.env.PORT || 5017;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
    paperTrader.loadPortfolio();
});
