const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const axios = require('axios');
const logger = require('./logger');

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

const getBinanceData = async (symbol, endpoint, params = {}) => {
    try {
        const res = await axios.get(endpoint, { params: { ...params, symbol } });
        return res.data;
    } catch (error) {
        console.error(`Error fetching data for ${symbol} from ${endpoint}:`, error.message);
        return null;
    }
};

let previousData = {};
const alertCooldowns = {};
const alphaDivergenceCooldowns = {};
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

async function sendMomentumAlert(symbol, momentumIndex) {
    let momentumSignal = '';
    if (momentumIndex > 79) {
        momentumSignal = 'High Momentum';
    } else if (momentumIndex < 21) {
        momentumSignal = 'Low Momentum';
    }

    if (momentumSignal) {
        const message = `*${momentumSignal} Alert*\n\n*Coin:* ${symbol}\n*Momentum Index:* ${momentumIndex}`;
        await sendTelegramMessage(message);
    }
}

async function sendAlphaDivergenceAlert(symbol, score) {
    let signal = '';
    if (score > config.divergence_alert_threshold_bullish) {
        signal = 'Strong Bullish Divergence';
    } else if (score < config.divergence_alert_threshold_bearish) {
        signal = 'Strong Bearish Divergence';
    }

    if (signal) {
        const now = Date.now();
        const cooldown = 3600 * 1000; // 1 hour cooldown
        if (!alphaDivergenceCooldowns[symbol] || (now - alphaDivergenceCooldowns[symbol] > cooldown)) {
            const message = `*${signal}*\n\n*Coin:* ${symbol}\n*Divergence Score:* ${score.toFixed(4)}`;
            await sendTelegramMessage(message);
            alphaDivergenceCooldowns[symbol] = now;
        }
    }
}

wss.on('connection', (ws) => {
    console.log('Client connected');

    const sendData = async () => {
        const symbols = await getSymbols();
        if (!symbols) {
            ws.send(JSON.stringify({ error: 'Could not fetch symbols' }));
            return;
        }

        for (const symbol of symbols) {
            const data = await fetchAllDataForSymbol(symbol);
            if (data) {
                ws.send(JSON.stringify(data));
            }
        }
    };

    sendData();
    const interval = setInterval(sendData, 60000); // Refresh every 60 seconds

    ws.on('close', () => {
        console.log('Client disconnected');
        clearInterval(interval);
    });
});

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

    const [
        open_interest_data,
        price_data,
        ls_top_position_data_15m,
        ls_global_position_data_15m,
        ls_top_position_data_24h,
        ls_global_position_data_24h,
        ls_top_position_data_4h,
        ls_global_position_data_4h,
        ls_top_position_data_5m,
        ls_global_position_data_5m
    ] = await Promise.all([
        getBinanceData(symbol, open_interest_endpoint),
        getBinanceData(symbol, price_endpoint),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '5m', limit: 3 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '5m', limit: 3 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '15m', limit: 96 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '15m', limit: 96 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '5m', limit: 48 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '5m', limit: 48 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '5m', limit: 2 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '5m', limit: 2 })
    ]);

    const price = price_data ? parseFloat(price_data.price) : 0;
    const openInterestInUSD = open_interest_data && price ? (parseFloat(open_interest_data.openInterest) * price) : 0;

    if (openInterestInUSD < config.minimum_open_interest_usd) {
        return null;
    }

    const prev = previousData[symbol] || {
        openInterest: null,
        openInterestHistory: [],
        topRatioHistory: []
    };

    // --- Multi-Timeframe Divergence Calculation ---
    const divergenceVector24h = calculateDivergenceVector(ls_top_position_data_24h, ls_global_position_data_24h);
    const divergenceVector4h = calculateDivergenceVector(ls_top_position_data_4h, ls_global_position_data_4h);
    const divergenceVector5m = calculateDivergenceVector(ls_top_position_data_5m, ls_global_position_data_5m);
    const topTraderTrend24h = calculate24hTrend(ls_top_position_data_24h);

    // --- OI Change Calculation ---
    const openInterestHistory = prev.openInterestHistory || [];
    openInterestHistory.push(openInterestInUSD);
    if (openInterestHistory.length > 15) openInterestHistory.shift();
    
    const openInterestChange1m = prev.openInterest ? (openInterestInUSD - prev.openInterest) : 0;
    const openInterestChange5m = openInterestHistory.length >= 5 ? (openInterestInUSD - openInterestHistory[openInterestHistory.length - 5]) : 0;
    const openInterestChange15m = openInterestHistory.length >= 15 ? (openInterestInUSD - openInterestHistory[0]) : 0;

    // --- 15m Conviction and Divergence Calculation ---
    const oiConvictionScore = calculateOiConvictionScore(openInterestChange1m, openInterestChange5m, openInterestChange15m);
    const alphaDivergenceScore15m = calculateAlphaDivergence(ls_top_position_data_15m, ls_global_position_data_15m, oiConvictionScore);
    if (alphaDivergenceScore15m !== null) {
        sendAlphaDivergenceAlert(symbol, alphaDivergenceScore15m);
    }

    // --- Momentum Index Calculation ---
    const currentLsTopPositionRatio = ls_top_position_data_15m && ls_top_position_data_15m[0] ? parseFloat(ls_top_position_data_15m[0].longShortRatio) : null;
    const lsTopPositionRatioChange1m = prev.lsTopPositionRatio !== null && currentLsTopPositionRatio !== null ? (currentLsTopPositionRatio - prev.lsTopPositionRatio).toFixed(4) : 'N/A';
    
    const topRatioHistory = prev.topRatioHistory || [];
    if (ls_top_position_data_15m && ls_top_position_data_15m.length > 0) {
        topRatioHistory.push(parseFloat(ls_top_position_data_15m[0].longShortRatio));
        if (topRatioHistory.length > 3) topRatioHistory.shift();
    }
    const lsTopPositionRatioChange15mFrom5m = topRatioHistory.length === 3 ? (topRatioHistory[2] - topRatioHistory[0]).toFixed(4) : 'N/A';

    const momentumIndex = calculateMomentumIndex(lsTopPositionRatioChange1m, lsTopPositionRatioChange15mFrom5m, openInterestChange1m, openInterestChange5m);
    sendMomentumAlert(symbol, momentumIndex);

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
        divergenceVector5m: divergenceVector5m ? divergenceVector5m.toFixed(4) : 'N/A',
        topTraderTrend24h,
        timestamp: new Date().toLocaleTimeString(),
        lsTopPositionRatio: currentLsTopPositionRatio !== null ? currentLsTopPositionRatio.toFixed(4) : 'N/A',
        lsTopPositionRatioChange1m,
        lsTopPositionRatioChange15m: lsTopPositionRatioChange15mFrom5m,
        openInterestChange1m: (openInterestChange1m / 1000000).toFixed(2) + 'M',
        openInterestChange5m: (openInterestChange5m / 1000000).toFixed(2) + 'M',
        openInterestChange15m: (openInterestChange15m / 1000000).toFixed(2) + 'M'
    };

    previousData[symbol] = {
        lsTopPositionRatio: currentLsTopPositionRatio,
        openInterest: openInterestInUSD,
        openInterestHistory: openInterestHistory,
        topRatioHistory: topRatioHistory
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

function calculateOiConvictionScore(oiChange1m, oiChange5m, oiChange15m) {
    let score = 0;
    if (oiChange1m > 0) score += 3;
    else if (oiChange1m < 0) score -= 3;

    if (oiChange5m > 0) score += 4;
    else if (oiChange5m < 0) score -= 4;

    if (oiChange15m > 0) score += 3;
    else if (oiChange15m < 0) score -= 3;
    
    return score;
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

function calculateMomentumIndex(change1m, change15m, oiChange1m, oiChange5m) {
    let score = 50;
    const c1m = parseFloat(change1m);
    const c15m = parseFloat(change15m);

    if (!isNaN(c1m)) {
        if (c1m > 0.01) score += 20;
        else if (c1m > 0.005) score += 10;
        else if (c1m < -0.01) score -= 20;
        else if (c1m < -0.005) score -= 10;
    }

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
});
