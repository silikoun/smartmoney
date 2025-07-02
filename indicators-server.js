const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/indicators', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'indicators.html'));
});

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const { bitget_api_key, bitget_secret_key, bitget_passphrase, telegram_bot_token, telegram_chat_id } = config;

const sendTelegramMessage = async (message) => {
    const url = `https://api.telegram.org/bot${telegram_bot_token}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: telegram_chat_id,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Error sending Telegram message:', error.message);
    }
};

const getBitgetData = async (endpoint, params = {}) => {
    const timestamp = Date.now().toString();
    const method = 'GET';
    const requestPath = `/api/v2/spot/market/${endpoint}`;
    
    let queryString = '';
    if (Object.keys(params).length > 0) {
        queryString = '?' + new URLSearchParams(params).toString();
    }

    const prehash = timestamp + method + requestPath + queryString;
    const signature = crypto.createHmac('sha256', bitget_secret_key).update(prehash).digest('base64');

    const headers = {
        'ACCESS-KEY': bitget_api_key,
        'ACCESS-SIGN': signature,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': bitget_passphrase,
        'Content-Type': 'application/json'
    };

    try {
        const res = await axios.get(`https://api.bitget.com${requestPath}${queryString}`, { headers });
        return res.data;
    } catch (error) {
        console.error(`Error fetching from Bitget for ${params.symbol}: ${error.message}`);
        if (error.response) {
            console.error('Bitget API Error:', error.response.data);
        }
        return null;
    }
};

const calculateMA = (klines, period) => {
    if (!klines || klines.length < period) {
        return null;
    }
    const closes = klines.map(k => parseFloat(k[4]));
    const sum = closes.slice(0, period).reduce((a, b) => a + b, 0);
    return sum / period;
};

const calculateRelativeStrength = (symbolKlines, btcKlines) => {
    if (!symbolKlines || symbolKlines.length < 2 || !btcKlines || btcKlines.length < 2) {
        return null;
    }
    const symbolOpen = parseFloat(symbolKlines[0][1]);
    const symbolClose = parseFloat(symbolKlines[symbolKlines.length - 1][4]);
    const btcOpen = parseFloat(btcKlines[0][1]);
    const btcClose = parseFloat(btcKlines[btcKlines.length - 1][4]);

    if (symbolOpen === 0 || btcOpen === 0) return null;

    const symbolChange = ((symbolClose - symbolOpen) / symbolOpen) * 100;
    const btcChange = ((btcClose - btcOpen) / btcOpen) * 100;

    if (btcChange === 0) return symbolChange > 0 ? 100 : 0;

    return (symbolChange / btcChange);
};

const getSymbols = async () => {
    const data = await getBitgetData('tickers');
    if (data && data.data) {
        return data.data.filter(s => s.symbol.endsWith('USDT')).map(s => s.symbol);
    }
    return [];
};

const fetchAllDataForSymbol = async (symbol) => {
    const [
        klines_data_1h,
        klines_data_4h,
        klines_data_1d,
        btc_klines_1h,
        btc_klines_4h,
        btc_klines_1d
    ] = await Promise.all([
        getBitgetData('candles', { symbol: symbol, granularity: '1h', limit: 200 }),
        getBitgetData('candles', { symbol: symbol, granularity: '4h', limit: 200 }),
        getBitgetData('candles', { symbol: symbol, granularity: '1d', limit: 200 }),
        getBitgetData('candles', { symbol: 'BTCUSDT', granularity: '1h', limit: 2 }),
        getBitgetData('candles', { symbol: 'BTCUSDT', granularity: '4h', limit: 2 }),
        getBitgetData('candles', { symbol: 'BTCUSDT', granularity: '1d', limit: 2 })
    ]);

    const sma20_1h = calculateMA(klines_data_1h ? klines_data_1h.data : null, 20);
    const sma50_1h = calculateMA(klines_data_1h ? klines_data_1h.data : null, 50);
    const sma200_1h = calculateMA(klines_data_1h ? klines_data_1h.data : null, 200);
    const sma20_4h = calculateMA(klines_data_4h ? klines_data_4h.data : null, 20);
    const sma50_4h = calculateMA(klines_data_4h ? klines_data_4h.data : null, 50);
    const sma200_4h = calculateMA(klines_data_4h ? klines_data_4h.data : null, 200);
    const sma20_1d = calculateMA(klines_data_1d ? klines_data_1d.data : null, 20);
    const sma50_1d = calculateMA(klines_data_1d ? klines_data_1d.data : null, 50);
    const sma200_1d = calculateMA(klines_data_1d ? klines_data_1d.data : null, 200);

    const relativeStrength1h = calculateRelativeStrength(klines_data_1h ? klines_data_1h.data : null, btc_klines_1h ? btc_klines_1h.data : null);
    const relativeStrength4h = calculateRelativeStrength(klines_data_4h ? klines_data_4h.data : null, btc_klines_4h ? btc_klines_4h.data : null);
    const relativeStrength24h = calculateRelativeStrength(klines_data_1d ? klines_data_1d.data : null, btc_klines_1d ? btc_klines_1d.data : null);

    return {
        symbol,
        sma20_1h: sma20_1h ? sma20_1h.toFixed(4) : 'N/A',
        sma50_1h: sma50_1h ? sma50_1h.toFixed(4) : 'N/A',
        sma200_1h: sma200_1h ? sma200_1h.toFixed(4) : 'N/A',
        sma20_4h: sma20_4h ? sma20_4h.toFixed(4) : 'N/A',
        sma50_4h: sma50_4h ? sma50_4h.toFixed(4) : 'N/A',
        sma200_4h: sma200_4h ? sma200_4h.toFixed(4) : 'N/A',
        sma20_1d: sma20_1d ? sma20_1d.toFixed(4) : 'N/A',
        sma50_1d: sma50_1d ? sma50_1d.toFixed(4) : 'N/A',
        sma200_1d: sma200_1d ? sma200_1d.toFixed(4) : 'N/A',
        relativeStrength1h: relativeStrength1h ? relativeStrength1h.toFixed(2) : 'N/A',
        relativeStrength4h: relativeStrength4h ? relativeStrength4h.toFixed(2) : 'N/A',
        relativeStrength24h: relativeStrength24h ? relativeStrength24h.toFixed(2) : 'N/A',
        timestamp: new Date().toLocaleTimeString()
    };
};

wss.on('connection', (ws) => {
    console.log('Indicator client connected');
    let isProcessing = false;
    let timeoutId;

    const processSymbols = async () => {
        if (isProcessing) {
            return;
        }
        isProcessing = true;

        try {
            const symbols = await getSymbols();
            const delay = 60000 / symbols.length;

            for (const symbol of symbols) {
                try {
                    const data = await fetchAllDataForSymbol(symbol);
                    if (data && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(data));
                    }
                } catch (error) {
                    console.error(`Failed to process symbol ${symbol} for indicators:`, error);
                }
                await new Promise(res => setTimeout(res, delay));
            }
        } finally {
            isProcessing = false;
            if (ws.readyState === WebSocket.OPEN) {
                timeoutId = setTimeout(processSymbols, 1000);
            }
        }
    };

    processSymbols();

    ws.on('close', () => {
        console.log('Indicator client disconnected');
        clearTimeout(timeoutId);
    });
});

const PORT = process.env.INDICATOR_PORT || 5018;
server.listen(PORT, () => {
    console.log(`Indicator server is listening on port ${PORT}`);
});
