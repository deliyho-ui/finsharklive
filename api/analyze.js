async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    if (!token) return null;
    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch (e) { return null; }
}

async function fetchYahooData(ticker, range = "2y", interval = "1wk", p50 = 10, p200 = 40) {
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
        })).filter(p => !isNaN(p.close) && p.close !== null);

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
        return data.chart.result[0].meta.regularMarketPrice;
    } catch (e) { return null; }
}

async function fetchYahooScreener(scrId) {
    try {
        const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&lang=en-US&region=US&scrIds=${scrId}&count=5`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const data = await res.json();
        if(data?.finance?.result?.[0]) {
            return data.finance.result[0].quotes.map(q => ({
                symbol: q.symbol,
                name: q.shortName || q.longName || q.symbol,
                price: q.regularMarketPrice,
                changesPercentage: q.regularMarketChangePercent
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

// 💡 שדרוג אמיתי: אלגוריתם נקי לזיהוי תמיכות והתנגדויות "כמו של מקצוענים"
function extractKeyLevels(points) {
    if (points.length < 30) return [];
    let levels = [];
    const currentPrice = points[points.length - 1].close;
    
    // חלון בדיקה רחב יותר כדי למצוא רק שיאים ושפלים משמעותיים
    const window = 4; 
    
    for (let i = window; i < points.length - window; i++) {
        const p = points[i];
        let isHigh = true, isLow = true;
        
        for (let j = 1; j <= window; j++) {
            if (p.high <= points[i-j].high || p.high <= points[i+j].high) isHigh = false;
            if (p.low >= points[i-j].low || p.low >= points[i+j].low) isLow = false;
        }
        
        if (isHigh) levels.push({ price: p.high, type: 'התנגדות קריטית' });
        if (isLow) levels.push({ price: p.low, type: 'תמיכה קריטית' });
    }
    
    // מסננים החוצה רמות שרחוקות יותר מ-15% מהמחיר כדי לא "ללכלך" את הגרף
    let filteredByDistance = levels.filter(l => Math.abs(l.price - currentPrice) / currentPrice <= 0.15);
    
    // מאגדים רמות שקרובות אחת לשנייה (עד 3% מרחק) כדי להשאיר קו אחד חזק
    let finalLevels = [];
    filteredByDistance.reverse(); // הופכים כדי לשמור קודם רמות עדכניות מהזמן האחרון
    filteredByDistance.forEach(l => {
        if (!finalLevels.some(f => Math.abs(f.price - l.price) / l.price < 0.03)) {
            finalLevels.push(l);
        }
    });
    
    return finalLevels.slice(0, 4); // מחזיר גג 4 קווים הכי מדויקים ורלוונטיים
}

function detectAllPatterns(chartPoints) {
    if (!chartPoints || chartPoints.length < 50) return "אין מספיק נתונים לזיהוי תבניות";
    const last40 = chartPoints.slice(-40);
    const currentPrice = chartPoints[chartPoints.length - 1].close;
    let patterns = [];
    const curr = chartPoints[chartPoints.length - 1];
    const prev = chartPoints[chartPoints.length - 2];
    
    if (curr.ma50 && curr.ma200 && prev.ma50 && prev.ma200) {
        if (prev.ma50 <= prev.ma200 && curr.ma50 > curr.ma200) patterns.push("חיתוך זהב (Golden Cross) 📈");
        if (prev.ma50 >= prev.ma200 && curr.ma50 < curr.ma200) patterns.push("חיתוך מוות (Death Cross) 📉");
    }
    
    const highs = last40.map(p => p.high), lows = last40.map(p => p.low), closes = last40.map(p => p.close);
    const h1 = Math.max(...highs.slice(0, 15)), h2 = Math.max(...highs.slice(25));
    const l1 = Math.min(...lows.slice(0, 15)), l2 = Math.min(...lows.slice(25));
    
    if (Math.abs(h1 - h2) / h1 < 0.02 && currentPrice < h1 * 0.96) patterns.push("פסגה כפולה (Double Top) ⛰️⛰️");
    if (Math.abs(l1 - l2) / l1 < 0.02 && currentPrice > l1 * 1.04) patterns.push("תחתית כפולה (Double Bottom) 🕳️🕳️");
    
    const h_recent = highs.slice(-15), l_recent = lows.slice(-15);
    const isRising = h_recent[0] < h_recent[h_recent.length-1] && l_recent[0] < l_recent[l_recent.length-1];
    const isFalling = h_recent[0] > h_recent[h_recent.length-1] && l_recent[0] > l_recent[l_recent.length-1];
    
    if (isRising && (h_recent[h_recent.length-1] - l_recent[l_recent.length-1]) < (h_recent[0] - l_recent[0])) patterns.push("יתד עולה (Rising Wedge) 📐⬇️");
    if (isFalling && (h_recent[h_recent.length-1] - l_recent[l_recent.length-1]) < (h_recent[0] - l_recent[0])) patterns.push("יתד יורד (Falling Wedge) 📐⬆️");
    
    return patterns.length === 0 ? "דשדוש במבנה מחיר (Neutral Consolidation) ↔️" : [...new Set(patterns)].join(" | ");
}

function sanitizeValue(val) {
    if (val === null || val === undefined || isNaN(val) || val === '' || val === 0) return null;
    return Number(val);
}

module.exports = async function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const ticker = (req.query.ticker || req.query.symbol || "").toUpperCase().trim();
        const action = req.query.action;
        
        // 💡 הגדרת הטווחים. ברירת מחדל: ארוך טווח (שבועי לשנתיים). אם ביקשו קצר: יומי לשנה.
        const timeframe = req.query.timeframe === 'short' ? 'short' : 'long';
        const interval = timeframe === 'short' ? '1d' : '1wk';
        const range = timeframe === 'short' ? '1y' : '2y';
        const p50 = timeframe === 'short' ? 50 : 10;   // 50 days vs 10 weeks
        const p200 = timeframe === 'short' ? 200 : 40; // 200 days vs 40 weeks

        const apiKey = process.env.GEMINI_API_KEY;
        const finnhubKey = process.env.FINNHUB_API_KEY;
        
        if (!apiKey || !finnhubKey) return res.status(500).json({ success: false, message: "Missing API Keys" });

        // --- 1. LIVE DATA (עדכון קאש מהיר) ---
        if (action === 'live_data' && ticker) {
            const [quote, chartPoints, metrics] = await Promise.all([
                fetchFinnhub('quote', `symbol=${ticker}`),
                fetchYahooData(ticker, range, interval, p50, p200),
                fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`)
            ]);
            const lastChartPoint = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : {};
            return res.status(200).json({
                success: true, ticker, timeframe, price: Number(quote?.c || 0), changePercentage: Number(quote?.dp || 0),
                ma50: lastChartPoint.ma50, ma200: lastChartPoint.ma200, volume: Number(quote?.v || 0),
                peRatio: sanitizeValue(metrics?.metric?.peBasicExclExtraTTM),
                chartData: chartPoints, pattern: detectAllPatterns(chartPoints), rsi: calculateRSI(chartPoints.map(p=>p.close))
            });
        }

        // --- 2. MARKET DATA ---
        if (action === 'market') {
            const [spy, qqq, dia, newsData, gainers, losers] = await Promise.all([
                fetchFinnhub('quote', 'symbol=SPY'), fetchFinnhub('quote', 'symbol=QQQ'), fetchFinnhub('quote', 'symbol=DIA'),
                fetchFinnhub('news', 'category=business'), fetchYahooScreener('day_gainers'), fetchYahooScreener('day_losers')
            ]);
            return res.status(200).json({
                success: true, marketData: {
                    indexes: [
                        { symbol: 'S&P 500', price: Number(spy?.c || 0), changesPercentage: Number(spy?.dp || 0) },
                        { symbol: 'NASDAQ', price: Number(qqq?.c || 0), changesPercentage: Number(qqq?.dp || 0) },
                        { symbol: 'DOW 30', price: Number(dia?.c || 0), changesPercentage: Number(dia?.dp || 0) }
                    ], gainers, losers,
                    news: (newsData || []).slice(0, 5).map(n => ({ title: n.headline, url: n.url, source: n.source, date: n.datetime * 1000 }))
                }
            });
        }

        // --- 3. FULL ANALYZE ---
        const today = new Date().toISOString().split('T')[0];
        const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const [quote, profile, chartPoints, metricsData, tickerNews, insiderData, vix, tnx] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchYahooData(ticker, range, interval, p50, p200), 
            fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`),
            fetchFinnhub('company-news', `symbol=${ticker}&from=${new Date(Date.now()-2592000000).toISOString().split('T')[0]}&to=${new Date().toISOString().split('T')[0]}`),
            fetchFinnhub('insider-transactions', `symbol=${ticker}`),
            fetchYahooQuote('^VIX'), fetchYahooQuote('^TNX')
        ]);

        const m = metricsData?.metric || {};
        const fundamentals = {
            marketCap: sanitizeValue(profile?.marketCapitalization || m.marketCapitalization),
            peRatio: sanitizeValue(m.peBasicExclExtraTTM || m.peExclExtraAnnual),
            psRatio: sanitizeValue(m.psTTM), pbRatio: sanitizeValue(m.pbAnnual),
            revenueGrowth: sanitizeValue(m.revenueGrowthTTMYoy),
            netMargin: sanitizeValue(m.netProfitMarginTTM), roe: sanitizeValue(m.roeTTM),
            eps: sanitizeValue(m.epsTTM), debtToEquity: sanitizeValue(m.totalDebtToEquityAnnual)
        };

        const insiders = Array.isArray(insiderData?.data) ? insiderData.data : [];
        let netInsiderShares = 0;
        insiders.slice(0, 15).forEach(t => netInsiderShares += (t.change || 0));
        const insiderSentiment = netInsiderShares > 0 ? 'חיובי (קניות)' : netInsiderShares < 0 ? 'שלילי (מכירות)' : 'ניטרלי';

        const isETF = profile?.finnhubIndustry === "" || (!fundamentals.marketCap && !fundamentals.peRatio);
        const isDataComplete = isETF || (fundamentals.marketCap !== null && fundamentals.peRatio !== null && fundamentals.revenueGrowth !== null);

        const lastPoint = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : {};
        const keyLevels = extractKeyLevels(chartPoints);
        const levelsPrompt = keyLevels.map(l => `${l.type}: $${l.price.toFixed(2)}`).join(', ');
        const patternsDetected = detectAllPatterns(chartPoints);

        const timeframeContext = timeframe === 'short' 
            ? "ניתוח לטווח קצר (מבוסס גרף יומי של שנה, מתאים למסחר סווינג)"
            : "ניתוח לטווח ארוך (מבוסס גרף שבועי של שנתיים, מתאים להשקעות ערך)";

        const prompt = `אתה "הכריש" - אנליסט מניות בכיר. נתח את ${ticker}.
        סוג ניתוח: ${timeframeContext}.
        נתונים: P/E: ${fundamentals.peRatio || 'N/A'}, צמיחה: ${fundamentals.revenueGrowth || 'N/A'}%. סנטימנט פנימי: ${insiderSentiment}.
        תבניות שזוהו בגרף: ${patternsDetected}. רמות חשובות: ${levelsPrompt}.
        חשוב: אם נתון מופיע כ-N/A, אל תסיק שהחברה כושלת! ציין שחסרים נתונים והתבסס על הטכני.
        החזר JSON בלבד בעברית: { "identity": "...", "technical": "...", "news_analysis": "...", "summary": "...", "pros": [], "cons": [], "price_target": "מחיר יעד ארוך טווח בדולרים", "target_price": "יעד קרוב לפריצה טכנית (מספר נקי)", "stop_loss": "מחיר קריטי לסטופ לוס (מספר נקי)", "intrinsic_value": "...", "accumulation_zone": "...", "risk_level": "...", "scores": {"overall": 80, "growth":80, "value":80, "momentum":80, "quality":80}, "rating": "קנייה" }`;

        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3 } })
        });

        let aiVerdict = { summary: "ניתוח חלקי.", scores: { overall: 50 }, rating: "החזקה" };
        if (aiRes.ok) {
            const aiData = await aiRes.json();
            try {
                const text = aiData.candidates[0].content.parts[0].text;
                aiVerdict = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
            } catch (e) {}
        }

        return res.status(200).json({
            success: true, isDataComplete, timeframe, ticker, name: profile?.name || ticker, 
            price: Number(quote?.c || 0), changePercentage: Number(quote?.dp || 0),
            ma50: lastPoint.ma50, ma200: lastPoint.ma200,
            volume: Number(quote?.v || 0), sector: profile?.finnhubIndustry || "N/A",
            ...fundamentals, analysis: aiVerdict, chartData: chartPoints, keyLevels, 
            insiderTransactions: insiders.slice(0, 6), insiderSentiment,
            tickerNews: (tickerNews || []).slice(0, 5)
        });
    } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
};
