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

const getSymbols = async () => {
    const data = await getBitgetData('tickers');
    if (data && data.data) {
        return data.data.filter(s => s.symbol.endsWith('USDT')).map(s => s.symbol);
    }
    return [];
};

const fetchAllDataForSymbol = async (symbol) => {
    const [
        klines_data_15m,
        klines_data_1h,
        klines_data_4h,
        ticker_data
    ] = await Promise.all([
        getBitgetData('candles', { symbol: symbol, granularity: '15min', limit: 50 }),
        getBitgetData('candles', { symbol: symbol, granularity: '1h', limit: 50 }),
        getBitgetData('candles', { symbol: symbol, granularity: '4h', limit: 50 }),
        getBitgetData('ticker', { symbol: symbol })
    ]);

    const ma15m = calculateMA(klines_data_15m ? klines_data_15m.data : null, 50);
    const ma1h = calculateMA(klines_data_1h ? klines_data_1h.data : null, 50);
    const ma4h = calculateMA(klines_data_4h ? klines_data_4h.data : null, 50);

    const price = ticker_data && ticker_data.data ? parseFloat(ticker_data.data.close) : null;

    if (price && ma15m && Math.abs(price - ma15m) / ma15m < 0.005) {
        sendTelegramMessage(`*${symbol}* is hitting the 15m MA50.`);
    }
    if (price && ma1h && Math.abs(price - ma1h) / ma1h < 0.005) {
        sendTelegramMessage(`*${symbol}* is hitting the 1h MA50.`);
    }
    if (price && ma4h && Math.abs(price - ma4h) / ma4h < 0.005) {
        sendTelegramMessage(`*${symbol}* is hitting the 4h MA50.`);
    }

    return {
        symbol,
        ma15m: ma15m ? ma15m.toFixed(4) : 'N/A',
        ma1h: ma1h ? ma1h.toFixed(4) : 'N/A',
        ma4h: ma4h ? ma4h.toFixed(4) : 'N/A'
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
