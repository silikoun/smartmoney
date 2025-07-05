// --- Imports ---
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const axios = require('axios');
const logger = require('./logger');
const fs = require('fs');

// --- Server Setup ---
const app = express();
// Create an HTTP server that can handle both Express and WebSocket traffic
const server = http.createServer((req, res) => {
  // Health check endpoint for cloud environments
  if (req.url === '/readiness') {
    res.writeHead(200);
    return res.end('OK');
  }
  // Pass other requests to the Express app
  app(req, res);
});
// Create a WebSocket server and attach it to the HTTP server
const wss = new WebSocket.Server({ server, path: '/ws' });

// --- WebSocket Connection Handling ---
wss.on('connection', ws => {
    console.log('Client connected');

    // This is a simple echo for testing purposes.
    ws.on('message', (message) => {
        console.log(`Received: ${message}`);
        ws.send(`Echo: ${message}`);
    });

    // When a new client connects, send them the currently cached data.
    const data = Object.values(cache).map(item => item.data);
    if (data.length > 0) {
        ws.send(JSON.stringify(data));
    }

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// --- WebSocket Broadcasting ---
// Function to send data to all connected clients.
wss.broadcast = function broadcast(data) {
    wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
};

// --- Configuration and Globals ---
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
let isPaused = false; // Flag to pause API requests if IP is blocked

const cache = {}; // In-memory cache for API data
const CACHE_DURATION_SECONDS = 60; // How long to cache data for

// --- Express Middleware and Routes ---
// Serve static files from the 'public' directory
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

app.get('/ma-indicators', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ma-indicators.html'));
});

app.get('/rs-indicators', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'rs-indicators.html'));
});

app.get('/funding-rate', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'funding-rate.html'));
});

app.get('/oi-weighted-funding-rate', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'oi-weighted-funding-rate.html'));
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

app.get('/api/bybit-leaderboard', async (req, res) => {
    try {
        const response = await axios.get('https://api.bybit.com/v5/ranking/leaderboard', {
            params: {
                category: 'linear',
                limit: 100
            }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch Bybit leaderboard data' });
    }
});

app.get('/api/data', (req, res) => {
    const data = Object.values(cache).map(item => item.data);
    res.json(data);
});

// --- Binance API Data Fetching ---
// Generic function to fetch data from Binance API with error handling.
const getBinanceData = async (symbol, endpoint, params = {}) => {
    if (isPaused) {
        return null; // Don't make requests if we're in a cooldown period
    }
    try {
        const requestParams = { ...params };
        if (symbol) {
            requestParams.symbol = symbol;
        }
        const res = await axios.get(endpoint, { params: requestParams, timeout: 30000 });
        return res.data;
    } catch (error) {
        // Handle common network errors gracefully
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            console.warn(`Request for ${symbol ? symbol : 'all symbols'} on ${endpoint} timed out. Will retry next cycle.`);
        } else if (error.code === 'ECONNRESET' || error.code === 'EAI_AGAIN') {
            console.warn(`Socket issue for ${symbol ? symbol : 'all symbols'} on ${endpoint}. Will retry next cycle.`);
        } else if (error.response && (error.response.status === 418 || error.response.status === 403)) {
            // Handle IP ban from Binance
            const cooldownMinutes = config.ip_blacklist_cooldown_minutes || 10;
            console.warn(`IP address has been blocked by Binance API. Pausing requests for ${cooldownMinutes} minutes.`);
            isPaused = true;
            setTimeout(() => {
                isPaused = false;
                console.log('Resuming API requests after cooldown.');
            }, cooldownMinutes * 60 * 1000);
        } else {
            console.error(`Unhandled error for ${symbol ? symbol : 'all symbols'} on ${endpoint}: ${error.message}`, error);
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
let whaleSentiment = 'Neutral';
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

function calculateAiScore(oiChange, divChange, lsChange) {
    const weights = {
        oi: 0.4,
        div: 0.35,
        ls: 0.25
    };

    let score = 0;

    if (oiChange > 4000000) {
        score += weights.oi;
    } else if (oiChange < -4000000) {
        score -= weights.oi;
    }

    if (divChange > 0) {
        score += weights.div;
    } else if (divChange < 0) {
        score -= weights.div;
    }

    if (lsChange > 0) {
        score += weights.ls;
    } else if (lsChange < 0) {
        score -= weights.ls;
    }

    return Math.round(score * 100);
}

const getSymbolsWithRetry = async (retries = 5, initialDelay = 5000) => {
    let delay = initialDelay;
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
            console.error(`Attempt ${i + 1} to fetch symbols failed:`, error.message);
        }
        
        if (i < retries - 1) {
            console.log(`Retrying to fetch symbols in ${delay / 1000} seconds...`);
            await new Promise(res => setTimeout(res, delay));
            delay *= 2; // Exponential backoff
        }
    }
    console.error('Could not fetch symbols after multiple retries.');
    return null;
};

// --- Main Data Fetching Loop ---
const startDataFetching = async () => {
    await preWarmCache(); // Pre-warm the cache before starting the main loop

    let isProcessing = false; // A lock to prevent multiple loops from running at once

    const processSymbols = async () => {
        if (isProcessing) {
            console.log('Already processing symbols. Skipping this cycle.');
            return;
        }
        isProcessing = true;

        try {
            // 1. Get all available symbols from Binance
            const allSymbols = await getSymbolsWithRetry();
            if (!allSymbols) {
                console.error('Could not fetch symbols after multiple retries. Please check server connection and restart.');
                isProcessing = false;
                return;
            }

            // 2. Stagger the API requests to avoid hitting rate limits
            const delay = 60000 / allSymbols.length; 

            // 3. Loop through each symbol and fetch all its data
            for (const symbol of allSymbols) {
                try {
                    await fetchAllDataForSymbol(symbol);
                } catch (error) {
                    console.error(`Failed to process symbol ${symbol}:`, error);
                }
                await new Promise(res => setTimeout(res, delay));
            }

            // 4. After processing all symbols, calculate the overall market sentiment
            calculateWhaleSentiment(allSymbols);

        } finally {
            isProcessing = false;
            console.log('Finished processing all symbols for this cycle.');
            // 5. Start the next cycle after a short delay
            setTimeout(processSymbols, 1000); 
        }
    };

    processSymbols();
};

startDataFetching();

async function preWarmCache() {
    console.log('Pre-warming cache with top 20 symbols by open interest...');
    try {
        const allSymbols = await getSymbolsWithRetry();
        if (!allSymbols) {
            console.error('Could not fetch symbols for pre-warming.');
            return;
        }

        const openInterestPromises = allSymbols.map(symbol => getBinanceData(symbol, 'https://fapi.binance.com/fapi/v1/openInterest'));
        const openInterestData = await Promise.all(openInterestPromises);

        const validOIData = openInterestData.filter(d => d && d.openInterest);

        const sortedByOI = validOIData.sort((a, b) => parseFloat(b.openInterest) - parseFloat(a.openInterest));
        const top20Symbols = sortedByOI.slice(0, 20).map(d => d.symbol);

        console.log('Top 20 symbols to pre-warm:', top20Symbols);

        for (const symbol of top20Symbols) {
            await fetchAllDataForSymbol(symbol);
        }

        console.log('Cache pre-warming complete.');
    } catch (error) {
        console.error('Error during cache pre-warming:', error);
    }
}

// --- Symbol-Specific Data Fetching and Processing ---
const fetchAllDataForSymbol = async (symbol) => {
    const now = Date.now();
    // 1. Check if we have fresh data in the cache
    if (cache[symbol] && (now - cache[symbol].timestamp) < CACHE_DURATION_SECONDS * 1000) {
        console.log(`[CACHE HIT] Serving ${symbol} from cache.`);
        return;
    }

    console.log(`[CACHE MISS] Fetching ${symbol} from API.`);
    
    // 2. Define all the Binance API endpoints we need
    const open_interest_endpoint = 'https://fapi.binance.com/fapi/v1/openInterest';
    const price_endpoint = 'https://fapi.binance.com/fapi/v1/ticker/price';
    const ls_top_position_endpoint = 'https://fapi.binance.com/futures/data/topLongShortPositionRatio';
    const ls_global_position_endpoint = 'https://fapi.binance.com/futures/data/globalLongShortAccountRatio';
    const oi_hist_endpoint = 'https://fapi.binance.com/futures/data/openInterestHist';
    const klines_endpoint = 'https://fapi.binance.com/fapi/v1/klines';
    const funding_rate_endpoint = 'https://fapi.binance.com/fapi/v1/premiumIndex';
    const funding_rate_hist_endpoint = 'https://fapi.binance.com/fapi/v1/fundingRate';

    // 3. Fetch all data in parallel for efficiency
    const [
        open_interest_data,
        price_data,
        oi_hist_data_1h,
        oi_hist_data_5m,
        ls_top_hist_data,
        ls_top_position_data_15m,
        ls_global_position_data_15m,
        ls_global_hist_data,
        ls_top_position_data_24h,
        ls_global_position_data_24h,
        ls_top_position_data_4h,
        ls_global_position_data_4h,
        ls_top_position_data_1h,
        ls_global_position_data_1h,
        ls_top_position_data_15m_for_divergence,
        ls_global_position_data_15m_for_divergence,
        ls_top_position_data_5m_for_divergence,
        ls_global_position_data_5m_for_divergence,
        klines_data_5m,
        klines_data_15m,
        klines_data_1h,
        klines_data_4h,
        klines_data_12h,
        klines_data_1d,
        funding_rate_data,
        funding_rate_hist_data,
        ls_global_account_ratio_data
    ] = await Promise.all([
        getBinanceData(symbol, open_interest_endpoint),
        getBinanceData(symbol, price_endpoint),
        getBinanceData(symbol, oi_hist_endpoint, { period: '1h', limit: 49 }),
        getBinanceData(symbol, oi_hist_endpoint, { period: '5m', limit: 4 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '5m', limit: 288 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '5m', limit: 3 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '5m', limit: 3 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '5m', limit: 288 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '15m', limit: 96 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '15m', limit: 96 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '5m', limit: 48 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '5m', limit: 48 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '5m', limit: 12 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '5m', limit: 12 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '5m', limit: 3 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '5m', limit: 3 }),
        getBinanceData(symbol, ls_top_position_endpoint, { period: '5m', limit: 2 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '5m', limit: 2 }),
        getBinanceData(symbol, klines_endpoint, { interval: '5m', limit: 2 }),
        getBinanceData(symbol, klines_endpoint, { interval: '15m', limit: 2 }),
        getBinanceData(symbol, klines_endpoint, { interval: '1h', limit: 2 }),
        getBinanceData(symbol, klines_endpoint, { interval: '4h', limit: 2 }),
        getBinanceData(symbol, klines_endpoint, { interval: '12h', limit: 2 }),
        getBinanceData(symbol, klines_endpoint, { interval: '1d', limit: 2 }),
        getBinanceData(symbol, funding_rate_endpoint),
        getBinanceData(symbol, funding_rate_hist_endpoint, { limit: 1000 }),
        getBinanceData(symbol, ls_global_position_endpoint, { period: '5m', limit: 1 })
    ]);

    // 4. Process the raw data into a structured format
    const price = price_data ? parseFloat(price_data.price) : 0;
    const openInterestInUSD = open_interest_data && price ? (parseFloat(open_interest_data.openInterest) * price) : 0;

    // 5. Filter out symbols with low open interest
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
    const divergenceVector5m = calculateDivergenceVector(ls_top_position_data_5m_for_divergence, ls_global_position_data_5m_for_divergence);
    const topTraderTrend24h = calculate24hTrend(ls_top_position_data_24h);

    // --- OI Change Calculation ---
    const openInterestChange5m = calculateOiChange(oi_hist_data_5m, 1);
    const openInterestChange15m = calculateOiChange(oi_hist_data_5m, 3);
    const openInterestChange1h = calculateOiChange(oi_hist_data_1h, 1);
    const openInterestChange4h = calculateOiChange(oi_hist_data_1h, 4);
    const openInterestChange12h = calculateOiChange(oi_hist_data_1h, 12);
    const openInterestChange24h = calculateOiChange(oi_hist_data_1h, 24);
    const openInterestChange48h = calculateOiChange(oi_hist_data_1h, 48);
    const openInterestPercent1h = calculateOiPercentChange(oi_hist_data_1h, 1);
    const openInterestPercent4h = calculateOiPercentChange(oi_hist_data_1h, 4);
    const openInterestPercent12h = calculateOiPercentChange(oi_hist_data_1h, 12);
    const openInterestPercent24h = calculateOiPercentChange(oi_hist_data_1h, 24);
    const openInterestPercent48h = calculateOiPercentChange(oi_hist_data_1h, 48);
    const openInterestPercent5m = calculateOiPercentChange(oi_hist_data_5m, 1);
    const openInterestPercent15m = calculateOiPercentChange(oi_hist_data_5m, 3);
    
    const openInterestChange1m = prev.openInterest ? (openInterestInUSD - prev.openInterest) : 0;
    const openInterestPercent1m = prev.openInterest ? (openInterestChange1m / prev.openInterest) * 100 : 0;

    // --- 15m Conviction and Divergence Calculation ---
    const oiConvictionScore = calculateOiConvictionScore({
        openInterestChange1m,
        openInterestChange5m,
        openInterestChange15m,
        openInterestChange1h,
        openInterestChange4h,
        openInterestChange12h,
        openInterestChange24h,
        openInterestChange48h
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

    const lsGlobalAccountRatioChange5m = calculateLsChange(ls_global_hist_data, 1);
    const lsGlobalAccountRatioChange15m = calculateLsChange(ls_global_hist_data, 3);
    const lsGlobalAccountRatioChange30m = calculateLsChange(ls_global_hist_data, 6);
    const lsGlobalAccountRatioChange1h = calculateLsChange(ls_global_hist_data, 12);
    const lsGlobalAccountRatioChange4h = calculateLsChange(ls_global_hist_data, 48);

    const aiScore = calculateAiScore(openInterestChange24h, divergenceVector24h, lsTopPositionRatioChange4h);

    // --- VWAP Calculation ---
    const vwap15m = calculateVwap(klines_data_15m);
    const vwap4h = calculateVwap(klines_data_4h);
    const vwap1d = calculateVwap(klines_data_1d);
    const vwapDeviation15m = vwap15m > 0 ? ((price - vwap15m) / vwap15m) * 100 : 0;
    const vwapDeviation4h = vwap4h > 0 ? ((price - vwap4h) / vwap4h) * 100 : 0;
    const vwapDeviation1d = vwap1d > 0 ? ((price - vwap1d) / vwap1d) * 100 : 0;

    if (symbol === 'BTCUSDT' || symbol === 'ETHUSDT') {
        let sentiment = 'Neutral';
        if (aiScore > 50) sentiment = 'Bullish';
        else if (aiScore < -50) sentiment = 'Bearish';
        marketSentiment[symbol] = sentiment;
    }

    // --- Volume Change Calculation ---
    const calculateVolumeChange = (data) => {
        if (!data || data.length < 2) return 0;
        const now = parseFloat(data[data.length - 1][7]);
        const then = parseFloat(data[data.length - 2][7]);
        return now - then;
    };

    const volumeChange5m = calculateVolumeChange(klines_data_5m);
    const volumeChange15m = calculateVolumeChange(klines_data_15m);
    const volumeChange1h = calculateVolumeChange(klines_data_1h);
    const volumeChange4h = calculateVolumeChange(klines_data_4h);
    const volumeChange12h = calculateVolumeChange(klines_data_12h);
    const volumeChange24h = calculateVolumeChange(klines_data_1d);

    const calculatePriceChange = (data) => {
        if (!data || data.length < 2) return 'N/A';
        const closeNow = parseFloat(data[1][4]);
        const closeThen = parseFloat(data[0][4]);
        if (isNaN(closeNow) || isNaN(closeThen) || closeThen === 0) return 'N/A';
        return (((closeNow - closeThen) / closeThen) * 100).toFixed(2) + '%';
    };

    const priceChange1h = calculatePriceChange(klines_data_1h);
    const priceChange24h = calculatePriceChange(klines_data_1d);

    const lsConvictionScore = calculateLsConvictionScore({
        lsTopPositionRatioChange15m: lsTopPositionRatioChange15mFrom5m,
        lsTopPositionRatioChange30m,
        lsTopPositionRatioChange1h,
        lsTopPositionRatioChange4h,
    });

    const divVectorConvictionScore = calculateDivVectorConvictionScore({
        divergenceVector15m,
        divergenceVector1h,
        divergenceVector4h,
    });

    // The premiumIndex endpoint returns an object, not an array, for a single symbol.
    const fundingRateObject = funding_rate_data;
    const fundingRateValue = fundingRateObject ? parseFloat(fundingRateObject.lastFundingRate) * 100 : null;

    const data = {
        price: price,
        oi: openInterestInUSD,
        oi24hNotional: (calculateOiChange(oi_hist_data_1h, 24) / 1000000).toFixed(2) + 'M',
        volume24h: (calculateVolumeChange(klines_data_1d) / 1000000).toFixed(2) + 'M',
        marketCap: 'N/A', // Market cap data is not available from this API
        symbol,
        aiScore,
        alphaDivergenceScore15m: alphaDivergenceScore15m ? alphaDivergenceScore15m.toFixed(4) : 'N/A',
        oiConvictionScore,
        divergenceVector24h: divergenceVector24h ? divergenceVector24h.toFixed(4) : 'N/A',
        divergenceVector4h: divergenceVector4h ? divergenceVector4h.toFixed(4) : 'N/A',
        divergenceVector1h: divergenceVector1h ? divergenceVector1h.toFixed(4) : 'N/A',
        divergenceVector15m: divergenceVector15m ? divergenceVector15m.toFixed(4) : 'N/A',
        divergenceVector5m: divergenceVector5m ? divergenceVector5m.toFixed(4) : 'N/A',
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
        vwapDeviation15m: vwapDeviation15m.toFixed(2) + '%',
        vwapDeviation4h: vwapDeviation4h.toFixed(2) + '%',
        vwapDeviation1d: vwapDeviation1d.toFixed(2) + '%',
        openInterestChange1m: (openInterestChange1m / 1000000).toFixed(2) + 'M',
        openInterestChange5m: (openInterestChange5m / 1000000).toFixed(2) + 'M',
        openInterestChange15m: (openInterestChange15m / 1000000).toFixed(2) + 'M',
        openInterestChange1h: (openInterestChange1h / 1000000).toFixed(2) + 'M',
        openInterestChange4h: (openInterestChange4h / 1000000).toFixed(2) + 'M',
        openInterestChange12h: (openInterestChange12h / 1000000).toFixed(2) + 'M',
        openInterestChange24h: (openInterestChange24h / 1000000).toFixed(2) + 'M',
        openInterestChange48h: (openInterestChange48h / 1000000).toFixed(2) + 'M',
        openInterestPercent1h: openInterestPercent1h ? openInterestPercent1h.toFixed(2) + '%' : 'N/A',
        openInterestPercent4h: openInterestPercent4h ? openInterestPercent4h.toFixed(2) + '%' : 'N/A',
        openInterestPercent12h: openInterestPercent12h ? openInterestPercent12h.toFixed(2) + '%' : 'N/A',
        openInterestPercent24h: openInterestPercent24h ? openInterestPercent24h.toFixed(2) + '%' : 'N/A',
        openInterestPercent48h: openInterestPercent48h ? openInterestPercent48h.toFixed(2) + '%' : 'N/A',
        openInterestPercent1m: openInterestPercent1m ? openInterestPercent1m.toFixed(2) + '%' : 'N/A',
        openInterestPercent5m: openInterestPercent5m ? openInterestPercent5m.toFixed(2) + '%' : 'N/A',
        openInterestPercent15m: openInterestPercent15m ? openInterestPercent15m.toFixed(2) + '%' : 'N/A',
        volumeChange5m: (volumeChange5m / 1000000).toFixed(2) + 'M',
        volumeChange15m: (volumeChange15m / 1000000).toFixed(2) + 'M',
        volumeChange1h: (volumeChange1h / 1000000).toFixed(2) + 'M',
        volumeChange4h: (volumeChange4h / 1000000).toFixed(2) + 'M',
        volumeChange12h: (volumeChange12h / 1000000).toFixed(2) + 'M',
        volumeChange24h: (volumeChange24h / 1000000).toFixed(2) + 'M',
        priceChange1h,
        priceChange24h,
        fundingRate: fundingRateValue ? fundingRateValue.toFixed(4) : 'N/A',
        fundingRateChange15m: calculateFundingRateVariation(funding_rate_hist_data, 0.25),
        fundingRateChange1h: calculateFundingRateVariation(funding_rate_hist_data, 1),
        fundingRateChange4h: calculateFundingRateVariation(funding_rate_hist_data, 4),
        fundingRateChange24h: calculateFundingRateVariation(funding_rate_hist_data, 24),
        fundingRateChange48h: calculateFundingRateVariation(funding_rate_hist_data, 48),
        fundingRateSuggestion: getFundingRateSuggestion(fundingRateObject),
        lsGlobalAccountRatio: ls_global_account_ratio_data && ls_global_account_ratio_data[0] ? parseFloat(ls_global_account_ratio_data[0].longShortRatio).toFixed(4) : 'N/A',
        lsGlobalAccountRatioChange5m,
        lsGlobalAccountRatioChange15m,
        lsGlobalAccountRatioChange30m,
        lsGlobalAccountRatioChange1h,
        lsGlobalAccountRatioChange4h
    };

    // 6. Store the processed data in the cache
    cache[symbol] = {
        timestamp: Date.now(),
        data: data
    };

    // 7. Broadcast the new data to all connected clients
    wss.broadcast(data);
};

const calculateOiChange = (data, candles) => {
    if (!data || data.length <= candles) return 0;
    data.sort((a, b) => a.timestamp - b.timestamp);
    const now = parseFloat(data[data.length - 1].sumOpenInterestValue);
    const then = parseFloat(data[data.length - 1 - candles].sumOpenInterestValue);
    if (isNaN(now) || isNaN(then)) {
        return 0;
    }
    return now - then;
};

const calculateOiPercentChange = (data, candles) => {
    if (!data || data.length <= candles) return 0;
    data.sort((a, b) => a.timestamp - b.timestamp);
    const now = parseFloat(data[data.length - 1].sumOpenInterest);
    const then = parseFloat(data[data.length - 1 - candles].sumOpenInterest);
    if (isNaN(now) || isNaN(then) || then === 0) {
        return 0;
    }
    return ((now - then) / then) * 100;
};

function calculateFundingRateVariation(data, hours) {
    if (!data || data.length < 2) return 'N/A';

    // Sort by funding time, descending (newest first)
    data.sort((a, b) => b.fundingTime - a.fundingTime);

    const latestRate = parseFloat(data[0].fundingRate);
    if (isNaN(latestRate)) return 'N/A';

    const now_ts = data[0].fundingTime;
    const target_ts = now_ts - (hours * 60 * 60 * 1000);

    let pastRateEntry = null;

    // Find the first entry with a timestamp at or before the target time
    for (let i = 1; i < data.length; i++) {
        if (data[i].fundingTime <= target_ts) {
            pastRateEntry = data[i];
            break;
        }
    }

    if (!pastRateEntry) return 'N/A'; // Not enough historical data

    const pastRate = parseFloat(pastRateEntry.fundingRate);
    if (isNaN(pastRate) || pastRate === 0) return 'N/A';

    return (((latestRate - pastRate) / pastRate) * 100).toFixed(2);
}

function getFundingRateSuggestion(data) {
    if (!data) return 'Neutral';
    const rate = parseFloat(data.lastFundingRate);
    if (isNaN(rate)) return 'Neutral';

    if (rate > (config.funding_rate_threshold_high || 0.001)) return 'High';
    if (rate < (config.funding_rate_threshold_low || -0.001)) return 'Low';
    return 'Neutral';
}

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
    if (!topData || !globalData || topData.length < 2 || topData.length < 2 || topData.length !== globalData.length) {
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
        openInterestChange48h: 8,
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


function calculateWhaleSentiment(symbols) {
    let bullishCount = 0;
    let bearishCount = 0;

    symbols.forEach(symbol => {
        if (marketSentiment[symbol] === 'Bullish') {
            bullishCount++;
        } else if (marketSentiment[symbol] === 'Bearish') {
            bearishCount++;
        }
    });

    if (bullishCount > bullishCount) {
        whaleSentiment = 'Bullish';
    } else if (bearishCount > bullishCount) {
        whaleSentiment = 'Bearish';
    } else {
        whaleSentiment = 'Neutral';
    }
    marketSentiment['alpha7'] = whaleSentiment;
}


// --- Server Initialization ---
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
