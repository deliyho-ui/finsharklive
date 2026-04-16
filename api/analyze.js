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
    let patterns = [];
    let lines = []; 

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
        lines.push({ start: {time: max1.time, value: h1}, end: {time: max2.time, value: h2}, color: 'rgba(255, 69, 58, 0.8)' });
    }
    if (Math.abs(l1 - l2) / l1 < 0.02 && currentPrice > l1 * 1.04) {
        patterns.push("תחתית כפולה (Double Bottom) 🕳️🕳️");
        lines.push({ start: {time: min1.time, value: l1}, end: {time: min2.time, value: l2}, color: 'rgba(48, 209, 88, 0.8)' });
    }
    
    const isRising = h2 > h1 && l2 > l1, isFalling = h2 < h1 && l2 < l1, converge = (h1 - l1) > (h2 - l2) * 1.2; 

    if (isRising && converge) {
        patterns.push("יתד עולה (Rising Wedge) 📐⬇️");
        lines.push({ start: {time: max1.time, value: h1}, end: {time: max2.time, value: h2}, color: 'rgba(255, 69, 58, 0.6)' });
        lines.push({ start: {time: min1.time, value: l1}, end: {time: min2.time, value: l2}, color: 'rgba(255, 69, 58, 0.6)' });
    } else if (isFalling && converge) {
        patterns.push("יתד יורד (Falling Wedge) 📐⬆️");
        lines.push({ start: {time: max1.time, value: h1}, end: {time: max2.time, value: h2}, color: 'rgba(48, 209, 88, 0.6)' });
        lines.push({ start: {time: min1.time, value: l1}, end: {time: min2.time, value: l2}, color: 'rgba(48, 209, 88, 0.6)' });
    } else if (isRising && !converge) {
        patterns.push("תעלה עולה (Ascending Channel) ↗️");
        lines.push({ start: {time: max1.time, value: h1}, end: {time: max2.time, value: h2}, color: 'rgba(10, 132, 255, 0.6)' });
        lines.push({ start: {time: min1.time, value: l1}, end: {time: min2.time, value: l2}, color: 'rgba(10, 132, 255, 0.6)' });
    } else if (isFalling && !converge) {
        patterns.push("תעלה יורדת (Descending Channel) ↘️");
        lines.push({ start: {time: max1.time, value: h1}, end: {time: max2.time, value: h2}, color: 'rgba(10, 132, 255, 0.6)' });
        lines.push({ start: {time: min1.time, value: l1}, end: {time: min2.time, value: l2}, color: 'rgba(10, 132, 255, 0.6)' });
    }
    
    const text = patterns.length === 0 ? "דשדוש (Consolidation) ↔️" : [...new Set(patterns)].join(" | ");
    return { text, lines };
}

function sanitizeValue(val) {
    if (val === null || val === undefined || isNaN(val) || val === '') return null;
    return Number(val);
}

// פונקציית עזר למיפוי סקטור לתעודת סל כדי למדוד עוצמה יחסית
function getSectorETF(sectorName) {
    const map = {
        "Technology": "XLK", "Healthcare": "XLV", "Financials": "XLF", 
        "Consumer Cyclical": "XLY", "Industrials": "XLI", "Energy": "XLE", 
        "Consumer Defensive": "XLP", "Utilities": "XLU", "Real Estate": "XLRE", "Basic Materials": "XLB"
    };
    return map[sectorName] || "SPY"; 
}

module.exports = async function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const ticker = (req.query.ticker || req.query.symbol || "").toUpperCase().trim();
        const action = req.query.action;
        
        const apiKey = process.env.GEMINI_API_KEY;
        const finnhubKey = process.env.FINNHUB_API_KEY;
        if (!apiKey || !finnhubKey) return res.status(500).json({ success: false, message: "Missing API Keys" });

        if (action === 'shark_portfolio') {
            const prompt = `You are "FinShark", an elite Wall Street AI hedge fund manager. 
            Construct a 5-stock model portfolio for today's market environment. 
            Choose real, highly traded US stocks. Balance it between Growth, Value, and Momentum.
            
            Return ONLY a valid JSON array in Hebrew. Do not wrap in markdown blocks. Format exactly like this:
            [
              {"ticker": "NVDA", "weight": 30, "role": "מנוע צמיחה ומומנטום", "reason": "מובילת שוק השבבים העולמית"},
              {"ticker": "AAPL", "weight": 20, "role": "עוגן ערך ויציבות", "reason": "תזרים מזומנים אדיר"}
            ]`;

            try {
                const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ 
                        contents: [{ parts: [{ text: prompt }] }], 
                        generationConfig: { 
                            temperature: 0.7,
                            responseMimeType: "application/json"
                        },
                        safetySettings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }]
                    })
                });
                
                if (!aiRes.ok) throw new Error("Gemini API returned an error");
                
                const aiData = await aiRes.json();
                if (aiData.candidates && aiData.candidates[0].content) {
                    let text = aiData.candidates[0].content.parts[0].text;
                    return res.status(200).json({ success: true, portfolio: JSON.parse(text) });
                } else {
                    throw new Error("Empty response from Gemini");
                }
            } catch (e) {
                console.error("Shark Portfolio Error:", e.message);
                return res.status(200).json({ success: true, portfolio: [
                    {"ticker": "NVDA", "weight": 30, "role": "מנוע צמיחה ומומנטום", "reason": "שליטה בתחום הבינה המלאכותית"},
                    {"ticker": "PLTR", "weight": 20, "role": "חדשנות דאטה", "reason": "חוזים ממשלתיים חזקים"},
                    {"ticker": "MSFT", "weight": 20, "role": "עוגן ויציבות", "reason": "תזרים יציב ומודל מנויים"},
                    {"ticker": "CRWD", "weight": 15, "role": "סייבר", "reason": "ביקוש קשיח להגנת ענן"},
                    {"ticker": "TSLA", "weight": 15, "role": "תנודתיות", "reason": "פוטנציאל למהלכים מהירים"}
                ]});
            }
        }

        if (action === 'market' || (!ticker && action !== 'analyze')) {
            const [spy, qqq, dia, iwm, xlk, xlv, xlf, xle, xly, xli, newsData, topGainers, topLosers] = await Promise.all([
                fetchFinnhub('quote', 'symbol=SPY'), fetchFinnhub('quote', 'symbol=QQQ'), fetchFinnhub('quote', 'symbol=DIA'), fetchFinnhub('quote', 'symbol=IWM'), 
                fetchFinnhub('quote', 'symbol=XLK'), fetchFinnhub('quote', 'symbol=XLV'), fetchFinnhub('quote', 'symbol=XLF'), fetchFinnhub('quote', 'symbol=XLE'), 
                fetchFinnhub('quote', 'symbol=XLY'), fetchFinnhub('quote', 'symbol=XLI'), fetchFinnhub('news', 'category=business'),
                fetchYahooScreener('day_gainers'), fetchYahooScreener('day_losers')
            ]);
            return res.status(200).json({
                success: true, marketData: {
                    indexes: [
                        { symbol: 'S&P 500', price: Number(spy?.c || 0), changesPercentage: Number(spy?.dp || 0) },
                        { symbol: 'NASDAQ', price: Number(qqq?.c || 0), changesPercentage: Number(qqq?.dp || 0) },
                        { symbol: 'DOW 30', price: Number(dia?.c || 0), changesPercentage: Number(dia?.dp || 0) },
                        { symbol: 'RUSSELL 2000', price: Number(iwm?.c || 0), changesPercentage: Number(iwm?.dp || 0) }
                    ],
                    sectors: [
                        { sector: "Technology", changesPercentage: String(xlk?.dp || "0") },
                        { sector: "Healthcare", changesPercentage: String(xlv?.dp || "0") },
                        { sector: "Financials", changesPercentage: String(xlf?.dp || "0") },
                        { sector: "Industrials", changesPercentage: String(xli?.dp || "0") },
                        { sector: "Consumer Cyclical", changesPercentage: String(xly?.dp || "0") },
                        { sector: "Energy", changesPercentage: String(xle?.dp || "0") },
                        { sector: "כללי", changesPercentage: String(spy?.dp || "0") }
                    ],
                    gainers: topGainers, losers: topLosers,
                    news: (Array.isArray(newsData) ? newsData : []).slice(0, 5).map(item => ({
                        title: item.headline || "ללא כותרת", url: item.url || "#", source: item.source || "שוק ההון", date: new Date(item.datetime * 1000).toISOString()
                    }))
                }
            });
        }

        if (!ticker) return res.status(400).json({ success: false, message: "Missing ticker symbol" });

        const [quote, chartPoints] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchYahooData(ticker, '2y', '1d')
        ]);

        if (!quote || quote.c === 0 || chartPoints.length < 10) {
            return res.status(404).json({ success: false, message: `הסימול ${ticker} לא נמצא, או שאין מספיק נתוני מסחר עבורו.` });
        }

        if (action === 'live_data') {
            const [profile, metricsData] = await Promise.all([
                fetchFinnhub('stock/profile2', `symbol=${ticker}`), fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`)
            ]);
            const lastChartPoint = chartPoints[chartPoints.length - 1];
            const m = metricsData?.metric || {};
            const patternObj = detectAllPatterns(chartPoints);
            const rawMarketCap = sanitizeValue(profile?.marketCapitalization || m?.marketCapitalization);
            return res.status(200).json({
                success: true, ticker, price: Number(quote.c), changePercentage: Number(quote.dp),
                ma50: lastChartPoint.ma50 || null, ma200: lastChartPoint.ma200 || null, volume: Number(quote.v || lastChartPoint.volume || 0), 
                pattern: patternObj.text, patternLines: patternObj.lines, rsi: calculateRSI(chartPoints.map(p=>p.close)),
                peRatio: sanitizeValue(m?.peBasicExclExtraTTM || m?.peExclExtraAnnual), chartData: chartPoints, marketCap: rawMarketCap !== null ? rawMarketCap * 1000000 : null
            });
        }

        const today = new Date().toISOString().split('T')[0];
        const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const [profile, metricsData, earningsData, tickerNews, insiderData] = await Promise.all([
            fetchFinnhub('stock/profile2', `symbol=${ticker}`), fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`),
            fetchFinnhub('stock/earnings', `symbol=${ticker}`), fetchFinnhub('company-news', `symbol=${ticker}&from=${lastMonth}&to=${today}`),
            fetchFinnhub('insider-transactions', `symbol=${ticker}`)
        ]);

        const m = metricsData?.metric || {};
        const rawMarketCap = sanitizeValue(profile?.marketCapitalization || m?.marketCapitalization);
        const fundamentals = {
            marketCap: rawMarketCap !== null ? rawMarketCap * 1000000 : null,
            fiftyTwoWeekHigh: sanitizeValue(m?.['52WeekHigh']), fiftyTwoWeekLow: sanitizeValue(m?.['52WeekLow']),
            peRatio: sanitizeValue(m?.peBasicExclExtraTTM || m?.peExclExtraAnnual), pbRatio: sanitizeValue(m?.pbAnnual || m?.pbQuarterly),
            psRatio: sanitizeValue(m?.psTTM || m?.psAnnual), eps: sanitizeValue(m?.epsTTM || m?.epsExclExtraItemsAnnual),
            epsGrowth5Y: sanitizeValue(m?.epsGrowth5Y), roe: sanitizeValue(m?.roeTTM), roa: sanitizeValue(m?.roaTTM), 
            roic: sanitizeValue(m?.roicTTM), debtToEquity: sanitizeValue(m?.totalDebtToEquityAnnual || m?.totalDebtToEquityQuarterly),
            dividendYield: sanitizeValue(m?.dividendYieldIndicatedAnnual), revenueGrowth: sanitizeValue(m?.revenueGrowthTTMYoy || m?.revenueGrowth5Y),
            grossMargin: sanitizeValue(m?.grossMarginTTM || m?.grossMarginAnnual), operatingMargin: sanitizeValue(m?.operatingMarginTTM || m?.operatingMarginAnnual), 
            netMargin: sanitizeValue(m?.netProfitMarginTTM || m?.netMarginTTM), currentRatio: sanitizeValue(m?.currentRatioQuarterly || m?.currentRatioAnnual),
            quickRatio: sanitizeValue(m?.quickRatioQuarterly || m?.quickRatioAnnual), beta: sanitizeValue(m?.beta)
        };

        const insiders = Array.isArray(insiderData?.data) ? insiderData.data : [];
        let netInsiderShares = 0;
        insiders.slice(0, 15).forEach(t => netInsiderShares += (t.change || 0));
        const insiderSentiment = netInsiderShares > 0 ? 'חיובי (קניות)' : netInsiderShares < 0 ? 'שלילי (מכירות)' : 'ניטרלי';

        const lastPoint = chartPoints[chartPoints.length - 1];
        const keyLevels = extractKeyLevels(chartPoints);
        const levelsPrompt = keyLevels.map(l => `${l.type}: $${l.price.toFixed(2)}`).join(', ');
        const patternObj = detectAllPatterns(chartPoints);
        const rsiVal = calculateRSI(chartPoints.map(p=>p.close));
        const isDataComplete = true; 
        const currPrice = Number(quote.c);

        // --- הכנת נתונים מתקדמים ל-AI (עוצמה יחסית וחדשות) ---
        const sectorETF = getSectorETF(profile?.finnhubIndustry);
        const [spyQuote, sectorQuote] = await Promise.all([
            fetchFinnhub('quote', 'symbol=SPY'),
            fetchFinnhub('quote', `symbol=${sectorETF}`)
        ]);
        const marketContext = `ה-S&P 500 (SPY) השתנה היום ב-${spyQuote?.dp?.toFixed(2) || 0}%. סקטור ה-${profile?.finnhubIndustry || 'כללי'} (${sectorETF}) השתנה ב-${sectorQuote?.dp?.toFixed(2) || 0}%.`;

        let earningsStreak = "אין מספיק נתונים על דוחות עבר.";
        if (Array.isArray(earningsData) && earningsData.length >= 3) {
            const recent = earningsData.slice(0,3).map(e => e.surprisePercent > 0 ? '✅' : '❌').join(' ');
            earningsStreak = `רצף הפתעות ב-3 רבעונים אחרונים: ${recent} (הדוח האחרון: ${earningsData[0].surprisePercent || 0}%).`;
        }
        const recentNews = (Array.isArray(tickerNews) ? tickerNews : []).slice(0, 3).map(n => n.headline).join(" | ");

        // --- פרומפט הכריש המשודרג ---
        const prompt = `אתה "FinShark" - אנליסט מניות סווינג בכיר בוול סטריט. הסגנון שלך הוא חד, מקצועי, ישיר ומעט ציני.
המניה: ${ticker} ($${currPrice}).
מצב השוק היום: ${marketContext}
חדשות אחרונות על המניה: ${recentNews || 'אין חדשות מיוחדות'}

נתונים קריטיים שחובה להצליב:
- ממוצעים: מניה ב-$${currPrice}, בעוד ש-MA50 הוא $${lastPoint.ma50} ו-MA200 הוא $${lastPoint.ma200}.
- מומנטום: RSI עומד על ${rsiVal.toFixed(1)}.
- תבנית בגרף: ${patternObj.text}.
- תמיכה/התנגדות קרובות: ${levelsPrompt || 'לא זוהו'}.
- פונדמנטל: מכפיל רווח P/E ${fundamentals.peRatio || 'N/A'}, צמיחת הכנסות ${fundamentals.revenueGrowth || 'N/A'}%.
- היסטוריית דוחות: ${earningsStreak}

הנחיות טון ושפה (חובה!):
1. אל תשתמש במילים רובוטיות כמו "חשוב לציין", "לסיכום", "ניתן לראות ש..." או "ניכר כי".
2. כתוב בגובה העיניים כמו סוחר רחוב מוול סטריט. השתמש במונחים כמו "מומנטום שורטיסטי", "נקודת איסוף", "תמחור מנופח" או "מפגינה עוצמה יחסית".
3. היה נחרץ! במקום לכתוב "המניה עשויה לעלות", כתוב "המניה יושבת על תמיכת ברזל ויש לה פוטנציאל פריצה".
4. בצע הצלבה: חובה להתייחס לאיך החדשות של המניה והמצב של השוק/הסקטור משפיעים על הפוזיציה. האם החדשות תומכות בגרף או סותרות אותו?

החזר JSON בלבד, בעברית, ללא הערות, לפי המבנה הבא:
{
  "internal_logic": "משפט אחד לעצמך באנגלית שאומר האם המניה קנייה או מכירה ולמה בהתבסס על החדשות והגרף (זה משפר את הדיוק שלך).",
  "identity": "תיאור עסקי קצר ותמציתי של החברה",
  "technical": "ניתוח הגרף והמומנטום בסגנון סוחר סווינג מקצועי - חובה לשלב התייחסות למצב השוק והחדשות האחרונות שצוינו",
  "long_term": { "summary": "מסקנה ארוכת טווח", "intrinsic_value": "הערכת שווי הוגן כמספר נקי", "accumulation_zone": "טווח מחירים אידיאלי לאיסוף", "price_target": "יעד מחיר ריאלי ל-12 חודשים כמספר נקי" },
  "short_term": { "summary": "תוכנית מסחר לסווינג (קצרה ופרקטית)", "entry_price": "${currPrice}", "target_price": "יעד (מספר נקי מבוסס התנגדות)", "stop_loss": "סטופ קשיח מתחת לתמיכה" },
  "pros": ["נקודת זכות 1", "נקודת זכות 2"], 
  "cons": ["נקודת תורפה 1", "נקודת תורפה 2"], 
  "scores": {"overall": 80, "growth":80, "value":80, "momentum":80, "quality":80}, 
  "rating": "קנייה / החזקה / מכירה" 
}`;

        // Fallback למקרה של תקלה ב-API (חוסך ניסיונות חוזרים שעולים כסף)
        let aiVerdict = { 
            isError: true,
            identity: "שגיאה בשרת הכריש, לא ניתן לנתח את המניה כרגע.", 
            technical: "יכול להיות שהמכסה של ה-API הסתיימה או שיש תקלת רשת. אנא נסה שוב מאוחר יותר.",
            long_term: { summary: "לא זמין", intrinsic_value: "N/A", accumulation_zone: "N/A", price_target: "N/A" },
            short_term: { summary: "לא זמין", entry_price: "N/A", target_price: "N/A", stop_loss: "N/A" },
            scores: null, rating: "שגיאה", pros: ["שגיאה"], cons: ["שגיאה"]
        };
        
        try {
            // קריאה בודדת ללא לולאות Retry למניעת בזבוז
            const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ 
                    contents: [{ parts: [{ text: prompt }] }], 
                    generationConfig: { 
                        temperature: 0.1, // טמפרטורה נמוכה ליציבות JSON
                        responseMimeType: "application/json" 
                    },
                    safetySettings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }]
                })
            });

            if (aiResponse.ok) {
                const aiData = await aiResponse.json();
                if (aiData.candidates && aiData.candidates[0].content) {
                    let text = aiData.candidates[0].content.parts[0].text;
                    aiVerdict = JSON.parse(text); 
                    aiVerdict.isError = false;
                }
            } else {
                console.error("Gemini API error status:", aiResponse.status);
            }
        } catch (e) { 
            console.error("Gemini Fetch error:", e.message);
        }

        return res.status(200).json({
            success: true, isDataComplete, ticker, name: profile?.name || ticker, industry: profile?.finnhubIndustry || "N/A", sector: profile?.finnhubIndustry || "N/A",
            price: currPrice, changePercentage: Number(quote.dp),
            ma50: lastPoint.ma50, ma200: lastPoint.ma200, volume: Number(quote.v || lastPoint.volume || 0),
            pattern: patternObj.text, patternLines: patternObj.lines, rsi: rsiVal, keyLevels, ...fundamentals,
            latestEarnings: (Array.isArray(earningsData) && earningsData.length > 0) ? earningsData[0] : null,
            tickerNews: (Array.isArray(tickerNews) ? tickerNews : []).slice(0, 5),
            insiderTransactions: insiders.slice(0, 6), insiderSentiment: insiderSentiment,
            analysis: aiVerdict, chartData: chartPoints
        });
    } catch (error) { 
        console.error("Global Catch Error:", error);
        return res.status(500).json({ success: false, message: error.message }); 
    }
};
