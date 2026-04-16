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

    const h1 = max1.val, h2 = max2.val;
    const l1 = min1.val, l2 = min2.val;

    if (Math.abs(h1 - h2) / h1 < 0.02 && currentPrice < h1 * 0.96) {
        patterns.push("פסגה כפולה (Double Top) ⛰️⛰️");
        lines.push({ start: {time: max1.time, value: h1}, end: {time: max2.time, value: h2}, color: 'rgba(255, 69, 58, 0.8)' });
    }
    if (Math.abs(l1 - l2) / l1 < 0.02 && currentPrice > l1 * 1.04) {
        patterns.push("תחתית כפולה (Double Bottom) 🕳️🕳️");
        lines.push({ start: {time: min1.time, value: l1}, end: {time: min2.time, value: l2}, color: 'rgba(48, 209, 88, 0.8)' });
    }
    
    const isRising = h2 > h1 && l2 > l1;
    const isFalling = h2 < h1 && l2 < l1;
    const converge = (h1 - l1) > (h2 - l2) * 1.2; 

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

        if (!ticker) {
            return res.status(400).json({ success: false, message: "Missing ticker symbol" });
        }

        if (action === 'live_data') {
            const [quote, chartPoints, profile, metricsData] = await Promise.all([
                fetchFinnhub('quote', `symbol=${ticker}`),
                fetchYahooData(ticker, '2y', '1d'),
                fetchFinnhub('stock/profile2', `symbol=${ticker}`),
                fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`)
            ]);
            
            const lastChartPoint = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : {};
            const m = metricsData?.metric || {};
            const patternObj = detectAllPatterns(chartPoints);
            const rawMarketCap = sanitizeValue(profile?.marketCapitalization || m?.marketCapitalization);
            
            return res.status(200).json({
                success: true, ticker, price: Number(quote?.c || 0), changePercentage: Number(quote?.dp || 0),
                ma50: lastChartPoint.ma50 || null, ma200: lastChartPoint.ma200 || null, volume: Number(quote?.v || lastChartPoint.volume || 0), 
                pattern: patternObj.text, patternLines: patternObj.lines, rsi: calculateRSI(chartPoints.map(p=>p.close)),
                peRatio: sanitizeValue(m?.peBasicExclExtraTTM || m?.peExclExtraAnnual), chartData: chartPoints,
                marketCap: rawMarketCap !== null ? rawMarketCap * 1000000 : null
            });
        }

        const today = new Date().toISOString().split('T')[0];
        const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const [quote, profile, chartPoints, metricsData, earningsData, tickerNews, insiderData] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchYahooData(ticker, '2y', '1d'), 
            fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`),
            fetchFinnhub('stock/earnings', `symbol=${ticker}`),
            fetchFinnhub('company-news', `symbol=${ticker}&from=${lastMonth}&to=${today}`),
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

        const lastPoint = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : {};
        const keyLevels = extractKeyLevels(chartPoints);
        const levelsPrompt = keyLevels.map(l => `${l.type}: $${l.price.toFixed(2)}`).join(', ');
        
        const patternObj = detectAllPatterns(chartPoints);
        const patternsDetected = patternObj.text;
        const rsiVal = calculateRSI(chartPoints.map(p=>p.close));

        const isETF = profile?.finnhubIndustry === "" || (!fundamentals.marketCap && !fundamentals.peRatio);
        const isDataComplete = isETF || (fundamentals.marketCap !== null && fundamentals.revenueGrowth !== null);

        const recentNews = (Array.isArray(tickerNews) ? tickerNews : []).slice(0, 3).map(n => n.headline).join(" | ");
        const currPrice = Number(quote?.c || 0);

        let latestEarningStr = "No recent earnings data";
        if (Array.isArray(earningsData) && earningsData.length > 0 && earningsData[0].surprisePercent !== null) {
            const latest = earningsData[0];
            latestEarningStr = `Latest Earning Surprise: ${latest.surprisePercent}% vs estimates.`;
        }

        const prompt = `אתה "הכריש" - מנתח מניות בכיר וסוחר סווינג.
        נתח את ${ticker}. המחיר הנוכחי הוא: $${currPrice}.
        
        זיהוי טכני שבוצע (קריטי לסווינג):
        - תבניות בגרף: ${patternsDetected}
        - רמות תמיכה והתנגדות היסטוריות אמיתיות שזוהו: ${levelsPrompt || 'לא זוהו מובהקות'}
        - ממוצעים: נע 50 ב-$${lastPoint.ma50}, נע 200 ב-$${lastPoint.ma200}.
        
        הנחיות חובה לכתיבת מסקנות לסוחרי סווינג (טווח קצר):
        1. 'stop_loss' (עצירת הפסד): חייב להיות מבוסס על 'תמיכה קרובה' קיימת מהרמות שסופקו לך למעלה. *אסור בשום אופן להמציא מספר שרחוק מהמחיר הנוכחי*.
        2. 'target_price' (יעד מחיר קרוב): חייב להיות מבוסס על 'התנגדות קרובה' שסופקה לך מעל המחיר הנוכחי. 
        
        הנחיות חובה למשקיעי ערך (טווח ארוך):
        1. התייחס לפונדמנטלס: P/E: ${fundamentals.peRatio || 'N/A'}, צמיחה: ${fundamentals.revenueGrowth || 'N/A'}%.
        2. התחשב בחדשות אחרונות: ${recentNews || 'אין מידע מיוחד'}.
        
        החזר JSON בלבד בעברית בפורמט הבא בדיוק: 
        { 
          "identity": "תיאור עסקי קצר על החברה", 
          "technical": "תיאור קריאת הגרף והמומנטום מנקודת המבט שלך",
          "news_sentiment": "השפעת החדשות (חיובי/שלילי/ניטרלי)",
          "long_term": { "summary": "מסקנה למשקיעי ערך", "intrinsic_value": "שווי הוגן מוערך (עם $)", "accumulation_zone": "טווח איסוף", "price_target": "יעד מחיר 12 חודשים (מספר נקי)" },
          "short_term": { "summary": "מסקנה לסוחרי סווינג", "entry_price": "מחיר כניסה טכני", "target_price": "יעד קרוב לפריצה (מספר נקי מבוסס התנגדות)", "stop_loss": "סטופ לוס (מספר נקי הגיוני מתחת למחיר הנוכחי)" },
          "pros": ["חוזקה 1", "חוזקה 2"], "cons": ["סיכון 1", "סיכון 2"], 
          "scores": {"overall": 80, "growth":80, "value":80, "momentum":80, "quality":80}, "rating": "קנייה חזקה / קנייה / החזקה / מכירה" 
        }`;

        // 💡 שינוי קריטי: responseMimeType="application/json" מונע הזיות ומכריח את ה-AI להחזיר תמיד אובייקט חוקי
        let aiVerdict = { 
            news_sentiment: "אין מידע.",
            technical: "שגיאת שרת בקריאת הטכני.",
            long_term: { summary: "שגיאת AI.", intrinsic_value: "", accumulation_zone: "", price_target: "" },
            short_term: { summary: "שגיאת AI.", entry_price: "", target_price: "", stop_loss: "" },
            scores: { overall: 50 }, rating: "החזקה" 
        };

        for (let i = 0; i < 2; i++) { // מנגנון ניסיון חוזר שקט במקרה של ניתוק גוגל
            try {
                const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ 
                        contents: [{ parts: [{ text: prompt }] }], 
                        generationConfig: { temperature: 0.1, responseMimeType: "application/json" } 
                    })
                });
                if (aiResponse.ok) {
                    const aiData = await aiResponse.json();
                    aiVerdict = JSON.parse(aiData.candidates[0].content.parts[0].text);
                    break; // הצליח!
                }
            } catch (e) { console.error("AI Attempt failed"); }
        }

        return res.status(200).json({
            success: true, isDataComplete, ticker, name: profile?.name || ticker, industry: profile?.finnhubIndustry || "N/A", sector: profile?.finnhubIndustry || "N/A",
            price: currPrice, changePercentage: Number(quote?.dp || 0),
            ma50: lastPoint.ma50, ma200: lastPoint.ma200, volume: Number(quote?.v || lastPoint.volume || 0),
            pattern: patternObj.text, patternLines: patternObj.lines, rsi: rsiVal, keyLevels, ...fundamentals,
            latestEarnings: (Array.isArray(earningsData) && earningsData.length > 0) ? earningsData[0] : null,
            tickerNews: (Array.isArray(tickerNews) ? tickerNews : []).slice(0, 5),
            insiderTransactions: insiders.slice(0, 6), insiderSentiment: insiderSentiment,
            analysis: aiVerdict, chartData: chartPoints
        });
    } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
};
