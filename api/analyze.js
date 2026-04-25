async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    if (!token) return null;
    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch (e) { return null; }
}

async function fetchYahooData(ticker, range = "2y", interval = "1d", p50 = 50, p200 = 200) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const data = await res.json();
        if (!data?.chart?.result?.[0]) return [];
        const result = data.chart.result[0];
        const timestamps = result.timestamp || [];
        const quotes = result.indicators.quote[0] || {};
        
        let points = timestamps.map((t, i) => ({
            date: new Date(t * 1000).toISOString().split('T')[0],
            open: Number(quotes.open[i]), high: Number(quotes.high[i]), low: Number(quotes.low[i]),
            close: Number(quotes.close[i]), value: Number(quotes.close[i]), volume: Number(quotes.volume[i]) 
        })).filter(p => !isNaN(p.close) && p.close !== null && p.close > 0);

        return points.map((point, i, arr) => {
            let ma50_val = null, ma200_val = null;
            if (i >= p50 - 1) {
                let sum = 0; for (let j = 0; j < p50; j++) sum += arr[i - j].close;
                ma50_val = Number((sum / p50).toFixed(2));
            }
            if (i >= p200 - 1) {
                let sum = 0; for (let j = 0; j < p200; j++) sum += arr[i - j].close;
                ma200_val = Number((sum / p200).toFixed(2));
            }
            return { ...point, ma50: ma50_val, ma200: ma200_val };
        });
    } catch (e) { return []; }
}

async function fetchYahooQuote(ticker) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const data = await res.json();
        if (!data?.chart?.result?.[0]) return null;
        const result = data.chart.result[0];
        const quotes = result.indicators.quote[0] || {};
        const meta = result.meta || {};
        const closePrice = quotes.close ? quotes.close[quotes.close.length - 1] : meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose;
        if (!closePrice) return null;
        return { c: closePrice, dp: prevClose ? ((closePrice - prevClose) / prevClose) * 100 : 0 };
    } catch (e) { return null; }
}

async function fetchYahooScreener(scrId) {
    try {
        const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&lang=en-US&region=US&scrIds=${scrId}&count=5`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const data = await res.json();
        if(data?.finance?.result?.[0]) {
            return data.finance.result[0].quotes.map(q => ({
                symbol: q.symbol, name: q.shortName || q.longName || q.symbol,
                price: q.regularMarketPrice, changesPercentage: q.regularMarketChangePercent
            }));
        }
        return [];
    } catch(e) { return []; }
}

function calculateRSI(prices, period = 14) {
    if (prices.length <= period) return 50; 
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        let change = prices[i] - prices[i - 1];
        if (change > 0) gains += change; else losses -= change;
    }
    let avgGain = gains / period, avgLoss = losses / period;
    for (let i = period + 1; i < prices.length; i++) {
        let change = prices[i] - prices[i - 1];
        let gain = change > 0 ? change : 0, loss = change < 0 ? -change : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    return avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
}

function extractKeyLevels(points) {
    if (points.length < 50) return [];
    let levels = [];
    const window = 15; 
    for (let i = window; i < points.length - window; i++) {
        const p = points[i];
        let isHigh = true, isLow = true;
        for (let j = 1; j <= window; j++) {
            if (p.high <= points[i-j].high || p.high <= points[i+j].high) isHigh = false;
            if (p.low >= points[i-j].low || p.low >= points[i+j].low) isLow = false;
        }
        if (isHigh) levels.push({ price: p.high, type: 'התנגדות קרובה' });
        if (isLow) levels.push({ price: p.low, type: 'תמיכה קרובה' });
    }
    const currentPrice = points[points.length - 1].close;
    let above = levels.filter(l => l.price > currentPrice * 1.01 && l.type.includes('התנגדות')).sort((a,b) => a.price - b.price);
    let below = levels.filter(l => l.price < currentPrice * 0.99 && l.type.includes('תמיכה')).sort((a,b) => b.price - a.price);
    
    let finalLevels = [];
    if (above.length > 0) finalLevels.push(above[0]); 
    if (below.length > 0) finalLevels.push(below[0]); 
    return finalLevels; 
}

function detectAllPatterns(chartPoints) {
    if (!chartPoints || chartPoints.length < 50) return { text: "אין מספיק נתונים", lines: [] };
    const last40 = chartPoints.slice(-40);
    const currentPrice = chartPoints[chartPoints.length - 1].close;
    let patterns = []; let lines = []; 

    const curr = chartPoints[chartPoints.length - 1];
    const prev = chartPoints[chartPoints.length - 2];
    if (curr.ma50 && curr.ma200 && prev.ma50 && prev.ma200) {
        if (prev.ma50 <= prev.ma200 && curr.ma50 > curr.ma200) patterns.push("חיתוך זהב (Golden Cross) 📈");
        if (prev.ma50 >= prev.ma200 && curr.ma50 < curr.ma200) patterns.push("חיתוך מוות (Death Cross) 📉");
    }

    let max1 = {val: 0, time: ''}, max2 = {val: 0, time: ''};
    let min1 = {val: 999999, time: ''}, min2 = {val: 999999, time: ''};

    for(let i=0; i<20; i++) {
        if(last40[i].high > max1.val) { max1.val = last40[i].high; max1.time = last40[i].date; }
        if(last40[i].low < min1.val) { min1.val = last40[i].low; min1.time = last40[i].date; }
    }
    for(let i=20; i<40; i++) {
        if(last40[i].high > max2.val) { max2.val = last40[i].high; max2.time = last40[i].date; }
        if(last40[i].low < min2.val) { min2.val = last40[i].low; min2.time = last40[i].date; }
    }

    const h1 = max1.val, h2 = max2.val, l1 = min1.val, l2 = min2.val;

    if (Math.abs(h1 - h2) / h1 < 0.02 && currentPrice < h1 * 0.96) {
        patterns.push("פסגה כפולה (Double Top) ⛰️⛰️");
    }
    if (Math.abs(l1 - l2) / l1 < 0.02 && currentPrice > l1 * 1.04) {
        patterns.push("תחתית כפולה (Double Bottom) 🕳️🕳️");
    }
    
    const isRising = h2 > h1 && l2 > l1, isFalling = h2 < h1 && l2 < l1, converge = (h1 - l1) > (h2 - l2) * 1.2; 

    if (isRising && converge) {
        patterns.push("יתד עולה (Rising Wedge) 📐⬇️");
    } else if (isFalling && converge) {
        patterns.push("יתד יורד (Falling Wedge) 📐⬆️");
    } else if (isRising && !converge) {
        patterns.push("תעלה עולה (Ascending Channel) ↗️");
    } else if (isFalling && !converge) {
        patterns.push("תעלה יורדת (Descending Channel) ↘️");
    }
    
    const text = patterns.length === 0 ? "דשדוש (Consolidation) ↔️" : [...new Set(patterns)].join(" | ");
    return { text, lines };
}

function sanitizeValue(val) {
    if (val === null || val === undefined || isNaN(val) || val === '') return null;
    return Number(val);
}

function getSectorETF(sectorName) {
    const map = {
        "Technology": "XLK", "Healthcare": "XLV", "Financials": "XLF", 
        "Consumer Cyclical": "XLY", "Industrials": "XLI", "Energy": "XLE", 
        "Consumer Defensive": "XLP", "Utilities": "XLU", "Real Estate": "XLRE", "Basic Materials": "XLB"
    };
    return map[sectorName] || "SPY"; 
}

function calculateRelativeStrength(stockPoints, spyPoints) {
    if (!stockPoints || !spyPoints || stockPoints.length < 21 || spyPoints.length < 21) return 0;
    const stockReturn = (stockPoints[stockPoints.length - 1].close - stockPoints[stockPoints.length - 21].close) / stockPoints[stockPoints.length - 21].close;
    const spyReturn = (spyPoints[spyPoints.length - 1].close - spyPoints[spyPoints.length - 21].close) / spyPoints[spyPoints.length - 21].close;
    return ((stockReturn - spyReturn) * 100).toFixed(2);
}

function cleanJSON(text) {
    try {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            return JSON.parse(text.substring(start, end + 1));
        }
        return JSON.parse(text);
    } catch (e) { 
        console.error("❌ שגיאת JSON מקלוד:", e.message);
        console.error("📝 הטקסט המלא שגרם לקריסה:\n", text); 
        return null; 
    }
}

module.exports = async function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const ticker = (req.query.ticker || req.query.symbol || "").toUpperCase().trim();
        const action = req.query.action;
        
        const geminiKey = process.env.GEMINI_API_KEY;
        const anthropicKey = process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.trim() : null; 
        const finnhubKey = process.env.FINNHUB_API_KEY;

        if (!geminiKey || !finnhubKey) return res.status(200).json({ success: false, message: "Missing API Keys" });

        // --- תיק מניות כריש ---
        if (action === 'shark_portfolio') {
            const prompt = `You are "FinShark", an elite Wall Street AI hedge fund manager. 
            Construct a 5-stock model portfolio for today's market environment. 
            Choose real, highly traded US stocks. Balance it between Growth, Value, and Momentum.
            
            Return ONLY a valid JSON array in Hebrew. Format exactly like this:
            [
              {"ticker": "NVDA", "weight": 30, "role": "מנוע צמיחה ומומנטום", "reason": "מובילת שוק השבבים העולמית"},
              {"ticker": "AAPL", "weight": 20, "role": "עוגן ערך ויציבות", "reason": "תזרים מזומנים אדיר"}
            ]`;

            try {
                const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, responseMimeType: "application/json" }})
                });
                const aiData = await aiRes.json();
                if (!aiData?.candidates?.length || !aiData.candidates[0]?.content?.parts?.[0]?.text) throw new Error("Gemini empty response");
                let text = aiData.candidates[0].content.parts[0].text;
                let s = text.indexOf('['); let e = text.lastIndexOf(']');
                if (s !== -1 && e !== -1) text = text.substring(s, e + 1);
                return res.status(200).json({ success: true, portfolio: JSON.parse(text) });
            } catch (e) {
                return res.status(200).json({ success: true, portfolio: [{"ticker": "NVDA", "weight": 30, "role": "מנוע צמיחה ומומנטום", "reason": "שליטה ב-AI"}, {"ticker": "MSFT", "weight": 20, "role": "עוגן ויציבות", "reason": "תזרים יציב"}]});
            }
        }

        // --- נתוני שוק ---
        if (action === 'market' || (!ticker && action !== 'analyze')) {
            const [spy, qqq, dia, iwm, xlk, xlv, xlf, xle, xly, xli, newsData, topGainers, topLosers] = await Promise.all([
                fetchFinnhub('quote', 'symbol=SPY'), fetchFinnhub('quote', 'symbol=QQQ'), fetchFinnhub('quote', 'symbol=DIA'), fetchFinnhub('quote', 'symbol=IWM'), 
                fetchFinnhub('quote', 'symbol=XLK'), fetchFinnhub('quote', 'symbol=XLV'), fetchFinnhub('quote', 'symbol=XLF'), fetchFinnhub('quote', 'symbol=XLE'), 
                fetchFinnhub('quote', 'symbol=XLY'), fetchFinnhub('quote', 'symbol=XLI'), fetchFinnhub('news', 'category=business'),
                fetchYahooScreener('day_gainers'), fetchYahooScreener('day_losers')
            ]);
            return res.status(200).json({
                success: true, marketData: {
                    indexes: [{ symbol: 'S&P 500', price: spy?.c, changesPercentage: spy?.dp }, { symbol: 'NASDAQ', price: qqq?.c, changesPercentage: qqq?.dp }, { symbol: 'DOW 30', price: dia?.c, changesPercentage: dia?.dp }, { symbol: 'RUSSELL 2000', price: iwm?.c, changesPercentage: iwm?.dp }],
                    sectors: [{ sector: "Technology", changesPercentage: String(xlk?.dp) }, { sector: "Healthcare", changesPercentage: String(xlv?.dp) }, { sector: "Financials", changesPercentage: String(xlf?.dp) }, { sector: "Industrials", changesPercentage: String(xli?.dp) }, { sector: "Consumer Cyclical", changesPercentage: String(xly?.dp) }, { sector: "Energy", changesPercentage: String(xle?.dp) }],
                    gainers: topGainers, losers: topLosers,
                    news: (Array.isArray(newsData) ? newsData : []).slice(0, 5).map(item => ({ title: item.headline, url: item.url, source: item.source, date: new Date(item.datetime * 1000).toISOString() }))
                }
            });
        }

        if (action === 'screener') {
            const type = req.query.type || 'day_gainers';
            const data = await fetchYahooScreener(type);
            return res.status(200).json({ success: true, data });
        }

        if (action === 'compare') {
            const t1 = (req.query.t1 || "").toUpperCase().trim();
            const t2 = (req.query.t2 || "").toUpperCase().trim();
            if (!t1 || !t2) return res.status(200).json({ success: false, message: "Missing tickers" });
            
            const promptText = `אתה סוחר מניות בכיר. משתמש מתלבט בין שתי מניות: ${t1} לבין ${t2}.
אנא החזר מבנה JSON תקין המסכם מי המנצחת (בטווח הקצר/בינוני) ומדוע, במבנה הבא ללא רווחים:
{"winner":"TICKER","reasoning":"משפט אחד קולע למה היא עדיפה"}`;

            try {
                const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" }})
                });
                const aiData = await aiRes.json();
                const text = aiData?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!text) throw new Error("Empty response");
                const parsed = cleanJSON(text);
                return res.status(200).json({ success: true, comparison: parsed });
            } catch (e) {
                return res.status(200).json({ success: false, message: "שגיאה בניתוח ההשוואה." });
            }
        }

        if (!ticker) return res.status(200).json({ success: false, message: "Missing ticker symbol" });

        // --- Cache / Live Data ---
        if (action === 'live_data') {
            const quote = await fetchYahooQuote(ticker);
            if (!quote) return res.status(200).json({ success: false, message: "לא ניתן למשוך מחיר למניה זו" });
            const chartPoints = await fetchYahooData(ticker, '2y', '1d');
            const lastChartPoint = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : {};
            const patternObj = detectAllPatterns(chartPoints);
            return res.status(200).json({
                success: true, ticker, price: Number(quote.c), changePercentage: Number(quote.dp),
                ma50: lastChartPoint.ma50 || null, ma200: lastChartPoint.ma200 || null, volume: Number(lastChartPoint.volume || 0), 
                pattern: patternObj.text, patternLines: patternObj.lines, rsi: calculateRSI(chartPoints.map(p=>p.close)), chartData: chartPoints 
            });
        }

        // --- התחלת תהליך ניתוח עומק (Analyze) ---
        const [quote, chartPointsDaily, chartPointsWeekly, spyPointsDaily, vixQuote, tnxQuote] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`), fetchYahooData(ticker, '2y', '1d'), fetchYahooData(ticker, '2y', '1wk', 50, 200), fetchYahooData('SPY', '2y', '1d'), fetchYahooQuote('^VIX'), fetchYahooQuote('^TNX')
        ]);

        if (!quote || quote.c === 0 || chartPointsDaily.length < 10) return res.status(200).json({ success: false, message: `הסימול לא נמצא או אין מספיק נתונים היסטוריים.` });

        const today = new Date().toISOString().split('T')[0];
        const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const [profile, metricsData, earningsData, tickerNews, insiderData, recommendationData, priceTargetData] = await Promise.all([
            fetchFinnhub('stock/profile2', `symbol=${ticker}`), fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`), fetchFinnhub('stock/earnings', `symbol=${ticker}`), fetchFinnhub('company-news', `symbol=${ticker}&from=${lastMonth}&to=${today}`), fetchFinnhub('insider-transactions', `symbol=${ticker}`), fetchFinnhub('stock/recommendation', `symbol=${ticker}`), fetchFinnhub('stock/price-target', `symbol=${ticker}`)
        ]);

        const m = metricsData?.metric || {};
        const rawMarketCap = sanitizeValue(profile?.marketCapitalization || m?.marketCapitalization);
        const fundamentals = {
            marketCap: rawMarketCap !== null ? rawMarketCap * 1000000 : null, peRatio: sanitizeValue(m?.peBasicExclExtraTTM || m?.peExclExtraAnnual), pbRatio: sanitizeValue(m?.pbAnnual || m?.pbQuarterly), psRatio: sanitizeValue(m?.psTTM || m?.psAnnual), eps: sanitizeValue(m?.epsTTM || m?.epsExclExtraItemsAnnual), epsGrowth5Y: sanitizeValue(m?.epsGrowth5Y), roe: sanitizeValue(m?.roeTTM), roa: sanitizeValue(m?.roaTTM), roic: sanitizeValue(m?.roicTTM), debtToEquity: sanitizeValue(m?.totalDebtToEquityAnnual || m?.totalDebtToEquityQuarterly), dividendYield: sanitizeValue(m?.dividendYieldIndicatedAnnual), revenueGrowth: sanitizeValue(m?.revenueGrowthTTMYoy || m?.revenueGrowth5Y), grossMargin: sanitizeValue(m?.grossMarginTTM || m?.grossMarginAnnual), operatingMargin: sanitizeValue(m?.operatingMarginTTM || m?.operatingMarginAnnual), netMargin: sanitizeValue(m?.netProfitMarginTTM || m?.netMarginTTM), currentRatio: sanitizeValue(m?.currentRatioQuarterly || m?.currentRatioAnnual), quickRatio: sanitizeValue(m?.quickRatioQuarterly || m?.quickRatioAnnual), beta: sanitizeValue(m?.beta), fiftyTwoWeekHigh: sanitizeValue(m?.['52WeekHigh']), fiftyTwoWeekLow: sanitizeValue(m?.['52WeekLow'])
        };

        const insiders = Array.isArray(insiderData?.data) ? insiderData.data : [];
        let netInsiderShares = 0; insiders.slice(0, 15).forEach(t => netInsiderShares += (t.change || 0));
        const insiderSentiment = netInsiderShares > 0 ? 'חיובי (קניות)' : netInsiderShares < 0 ? 'שלילי (מכירות)' : 'ניטרלי';

        const lastPointDaily = chartPointsDaily[chartPointsDaily.length - 1];
        const lastPointWeekly = chartPointsWeekly.length > 0 ? chartPointsWeekly[chartPointsWeekly.length - 1] : {};
        const keyLevels = extractKeyLevels(chartPointsDaily);
        const patternObj = detectAllPatterns(chartPointsDaily);
        const rsiVal = calculateRSI(chartPointsDaily.map(p=>p.close));
        const relativeStrength = calculateRelativeStrength(chartPointsDaily, spyPointsDaily);
        const currPrice = Number(quote.c);

        let earningsStreak = "אין מספיק נתונים על דוחות עבר.";
        if (Array.isArray(earningsData) && earningsData.length >= 3) {
            const recent = earningsData.slice(0,3).map(e => e.surprisePercent > 0 ? '✅' : '❌').join(' ');
            earningsStreak = `הפתעות ב-3 רבעונים אחרונים: ${recent}.`;
        }
        
        let analystConsensus = "אין נתוני אנליסטים.";
        if (Array.isArray(recommendationData) && recommendationData.length > 0) {
            const rec = recommendationData[0];
            analystConsensus = `${rec.buy + rec.strongBuy} המלצות קנייה, ${rec.hold} החזקה, ${rec.sell + rec.strongSell} מכירה.`;
        }
        if (priceTargetData?.targetMedian) analystConsensus += ` יעד חציוני: $${priceTargetData.targetMedian.toFixed(2)}.`;

        const marketContext = `אג"ח 10 שנים: ${tnxQuote?.c||'N/A'}%. VIX: ${vixQuote?.c||'N/A'}. עוצמה יחסית מול השוק בחודש האחרון: ${relativeStrength > 0 ? '+' : ''}${relativeStrength}%.`;
        const recentNews = (Array.isArray(tickerNews) ? tickerNews : []).slice(0, 3).map(n => n.headline).join(" | ");

        const promptText = `אתה "FinShark" - אנליסט מניות בוול סטריט.
המניה: ${ticker} ($${currPrice}). מאקרו: ${marketContext}. קונצנזוס: ${analystConsensus}. חדשות: ${recentNews || 'אין'}. 
טכני(סווינג): יומי $${currPrice}, MA50=$${lastPointDaily.ma50}, MA200=$${lastPointDaily.ma200}. מומנטום: RSI=${rsiVal.toFixed(1)}, תבנית: ${patternObj.text}. פונדמנטלס: P/E=${fundamentals.peRatio || 'N/A'}, צמיחה=${fundamentals.revenueGrowth || 'N/A'}%. ${earningsStreak}.
הנחיות: 1. למלא ai_scratchpad, 2. technical לגרף בלבד, 3. ללא מרכאות כפולות בטקסט, 4. ללא ירידת שורה בטקסט, 5. לסימולטור Paper Trading בלבד. החזר JSON תקין ומכווץ (ללא רווחים מיותרים) במבנה הבא:
{"ai_scratchpad":"מחשבות לוגיות...","confidence_score":85,"internal_logic":"משפט קצר על הדירוג","identity":"תיאור חברה קצר","technical":"ניתוח טכני טהור","long_term":{"summary":"מסקנה","intrinsic_value":"שווי הוגן","accumulation_zone":"טווח","price_target":"יעד 12M"},"short_term":{"summary":"תוכנית סווינג","entry_price":"${currPrice}","target_price":"יעד קרוב","stop_loss":"סטופ לוס"},"pros":["זכות1"],"cons":["סיכון1"],"news_sentiment_score":8,"scores":{"overall":80,"growth":80,"value":80,"momentum":80,"quality":80},"rating":"קנייה / החזקה / מכירה"}`;

        const geminiPromise = fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                contents: [{ parts: [{ text: promptText }] }], 
                generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
            })
        }).then(r => r.json());

        // --- קריאה לקלוד עם המודל החדש (Claude Haiku 4.5) ---
        const claudePromise = anthropicKey ? fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001', // <--- הקסם פה! המודל החדש.
                max_tokens: 1500,
                temperature: 0.1,
                system: "You are an elite AI financial analyst. Respond ONLY with valid JSON. No markdown, no preambles.",
                messages: [{ role: 'user', content: promptText }]
            })
        }).then(r => r.json()) : Promise.resolve(null);

        const [geminiRes, claudeRes] = await Promise.all([geminiPromise, claudePromise].map(p => p.catch(e => ({ error: { message: e.message } }))));

        let geminiData = null;
        let claudeData = null;
        let claudeDebugMsg = null; 

        if (geminiRes?.candidates?.length > 0 && geminiRes.candidates[0]?.content?.parts?.[0]?.text) {
            geminiData = cleanJSON(geminiRes.candidates[0].content.parts[0].text);
        }
        
        if (!anthropicKey) {
            claudeDebugMsg = "מפתח ANTHROPIC_API_KEY חסר ב-Vercel!";
        } else if (claudeRes && claudeRes.content && claudeRes.content[0].text) {
            claudeData = cleanJSON(claudeRes.content[0].text);
            if (!claudeData) claudeDebugMsg = "קלוד החזיר טקסט שאינו JSON תקין.";
        } else if (claudeRes && claudeRes.error) {
            claudeDebugMsg = `שגיאת הרשאות: ${claudeRes.error.message || JSON.stringify(claudeRes.error)}`;
        } else if (!claudeRes) {
            claudeDebugMsg = "אין תשובה מהשרת של קלוד.";
        }

        let finalVerdict = { isError: true, identity: "שגיאה בניתוח המניה.", technical: "לא התקבלו נתונים." };

        if (geminiData && claudeData) {
            const gScore = geminiData.scores?.overall || 50;
            const cScore = claudeData.scores?.overall || 50;
            const diff = Math.abs(gScore - cScore);
            let finalScore = Math.round((gScore + cScore) / 2);
            let finalRating = finalScore >= 80 ? "קנייה חזקה 🔥" : finalScore >= 60 ? "קנייה ✓" : finalScore <= 40 ? "מכירה ✗" : "החזקה —";
            
            let scratchpadCombined = `<span style="color:#0a84ff; font-weight:bold;">🔵 Gemini:</span> ${geminiData.ai_scratchpad}<br><br><span style="color:#e67e22; font-weight:bold;">🟠 Claude:</span> ${claudeData.ai_scratchpad}`;
            
            if (diff > 30) {
                finalScore = Math.min(finalScore, 50); 
                finalRating = "מעורב / סיכון גבוה ⚖️";
                scratchpadCombined = `<span style="color:var(--red); font-weight:800;">⚠️ מחלוקת חריפה במועצת ה-AI!</span><br><br><span style="color:#0a84ff; font-weight:bold;">🔵 Gemini (ציון ${gScore}):</span> ${geminiData.ai_scratchpad}<br><br><span style="color:#e67e22; font-weight:bold;">🟠 Claude (ציון ${cScore}):</span> ${claudeData.ai_scratchpad}`;
            }

            finalVerdict = {
                isError: false,
                ai_scratchpad: scratchpadCombined,
                internal_logic: `[Ensemble Match: ${diff <= 30 ? 'High' : 'Low'}]`,
                identity: geminiData.identity,
                technical: `<span style="color:#0a84ff; font-weight:bold;">מנוע Gemini:</span> ${geminiData.technical}<br><br><span style="color:#e67e22; font-weight:bold;">מנוע Claude:</span> ${claudeData.technical}`,
                long_term: {
                    summary: geminiData.long_term.summary,
                    intrinsic_value: geminiData.long_term.intrinsic_value,
                    accumulation_zone: geminiData.long_term.accumulation_zone,
                    price_target: Math.min(Number(String(geminiData.long_term.price_target).replace(/[^0-9.]/g, '')||0), Number(String(claudeData.long_term.price_target).replace(/[^0-9.]/g, '')||0)) || geminiData.long_term.price_target
                },
                short_term: {
                    summary: claudeData.short_term.summary,
                    entry_price: currPrice,
                    target_price: geminiData.short_term.target_price,
                    stop_loss: Math.max(Number(String(geminiData.short_term.stop_loss).replace(/[^0-9.]/g, '')||0), Number(String(claudeData.short_term.stop_loss).replace(/[^0-9.]/g, '')||0)) || geminiData.short_term.stop_loss
                },
                pros: [...new Set([...(geminiData.pros||[]), ...(claudeData.pros||[])])].slice(0, 4),
                cons: [...new Set([...(geminiData.cons||[]), ...(claudeData.cons||[])])].slice(0, 4),
                news_sentiment_score: Math.round(((geminiData.news_sentiment_score||5) + (claudeData.news_sentiment_score||5))/2),
                scores: {
                    overall: finalScore,
                    growth: Math.round(((geminiData.scores?.growth||50) + (claudeData.scores?.growth||50))/2),
                    value: Math.round(((geminiData.scores?.value||50) + (claudeData.scores?.value||50))/2),
                    momentum: Math.round(((geminiData.scores?.momentum||50) + (claudeData.scores?.momentum||50))/2),
                    quality: Math.round(((geminiData.scores?.quality||50) + (claudeData.scores?.quality||50))/2)
                },
                confidence_score: Math.round(((geminiData.confidence_score||80) + (claudeData.confidence_score||80))/2),
                rating: finalRating
            };
        } else if (geminiData) {
            let debugHtml = claudeDebugMsg ? `<br><br><span style="color:var(--red); font-size:0.85em; font-weight:bold;">🔍 שגיאת אבחון (קלוד נכשל): ${claudeDebugMsg}</span>` : "";
            finalVerdict = { ...geminiData, isError: false, ai_scratchpad: `<span style="color:#0a84ff; font-weight:bold;">🔵 Gemini:</span> ${geminiData.ai_scratchpad}${debugHtml}` };
        } else if (claudeData) {
            finalVerdict = { ...claudeData, isError: false, ai_scratchpad: `<span style="color:#e67e22; font-weight:bold;">🟠 Claude:</span> ${claudeData.ai_scratchpad}` };
        }

        return res.status(200).json({
            success: true, isDataComplete: true, ticker, name: profile?.name || ticker, industry: profile?.finnhubIndustry || "N/A", sector: profile?.finnhubIndustry || "N/A",
            price: currPrice, changePercentage: Number(quote.dp),
            ma50: lastPointDaily.ma50, ma200: lastPointDaily.ma200, volume: Number(quote.v || lastPointDaily.volume || 0),
            pattern: patternObj.text, patternLines: patternObj.lines, rsi: rsiVal, keyLevels, ...fundamentals,
            latestEarnings: (Array.isArray(earningsData) && earningsData.length > 0) ? earningsData[0] : null,
            tickerNews: (Array.isArray(tickerNews) ? tickerNews : []).slice(0, 5),
            insiderTransactions: insiders.slice(0, 6), insiderSentiment: insiderSentiment,
            analysis: finalVerdict, chartData: chartPointsDaily
        });
    } catch (error) {
        console.error("Global Catch Error:", error);
        return res.status(200).json({ success: false, message: error.message });
    }
};
