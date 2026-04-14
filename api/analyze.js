async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    if (!token) return null;

    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch (e) { 
        return null; 
    }
}

// שולף נתונים טכניים ושבועיים
async function fetchYahooData(ticker, range = "2y", interval = "1wk") {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const data = await res.json();
        
        if (!data || !data.chart || !data.chart.result || !data.chart.result[0]) return [];
        
        const result = data.chart.result[0];
        const timestamps = result.timestamp || [];
        const quotes = result.indicators.quote[0] || {};
        
        let points = timestamps.map((t, i) => ({
            date: new Date(t * 1000).toISOString().split('T')[0],
            open: Number(quotes.open[i]),
            high: Number(quotes.high[i]),
            low: Number(quotes.low[i]),
            close: Number(quotes.close[i]),
            value: Number(quotes.close[i]),
            volume: Number(quotes.volume[i]) 
        })).filter(p => !isNaN(p.close) && p.close !== null);

        return points.map((point, i, arr) => {
            let ma50_val = null, ma200_val = null;
            if (i >= 9) {
                let sum = 0; for (let j = 0; j < 10; j++) sum += arr[i - j].close;
                ma50_val = Number((sum / 10).toFixed(2));
            }
            if (i >= 39) {
                let sum = 0; for (let j = 0; j < 40; j++) sum += arr[i - j].close;
                ma200_val = Number((sum / 40).toFixed(2));
            }
            return { ...point, ma50: ma50_val, ma200: ma200_val };
        });
    } catch (e) { 
        return []; 
    }
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
        if(data && data.finance && data.finance.result && data.finance.result[0]) {
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
        if (change > 0) gains += change;
        else losses -= change;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < prices.length; i++) {
        let change = prices[i] - prices[i - 1];
        let gain = change > 0 ? change : 0;
        let loss = change < 0 ? -change : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) return 100;
    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function extractKeyLevels(points) {
    if (points.length < 20) return [];
    let levels = [];
    for (let i = 2; i < points.length - 2; i++) {
        const p = points[i];
        if (p.high >= points[i-1].high && p.high >= points[i+1].high && p.high >= points[i-2].high && p.high >= points[i+2].high) {
            levels.push({ price: p.high, type: 'התנגדות היסטורית' });
        }
        if (p.low <= points[i-1].low && p.low <= points[i+1].low && p.low <= points[i-2].low && p.low <= points[i+2].low) {
            levels.push({ price: p.low, type: 'תמיכה היסטורית' });
        }
    }
    let filtered = [];
    levels.sort((a, b) => b.price - a.price);
    levels.forEach(l => {
        if (!filtered.some(f => Math.abs(f.price - l.price) / l.price < 0.04)) {
            filtered.push(l);
        }
    });
    return filtered.slice(0, 8);
}

function detectAllPatterns(chartPoints) {
    if (!chartPoints || chartPoints.length < 50) return "אין מספיק נתונים לזיהוי תבניות מורכבות";

    const last40 = chartPoints.slice(-40);
    const currentPrice = chartPoints[chartPoints.length - 1].close;

    let patterns = [];

    const curr = chartPoints[chartPoints.length - 1];
    const prev = chartPoints[chartPoints.length - 2];
    if (curr.ma50 && curr.ma200 && prev.ma50 && prev.ma200) {
        if (prev.ma50 <= prev.ma200 && curr.ma50 > curr.ma200) patterns.push("חיתוך זהב (Golden Cross) 📈");
        if (prev.ma50 >= prev.ma200 && curr.ma50 < curr.ma200) patterns.push("חיתוך מוות (Death Cross) 📉");
    }

    const highs = last40.map(p => p.high);
    const lows = last40.map(p => p.low);
    const closes = last40.map(p => p.close);

    const h1 = Math.max(...highs.slice(0, 15)), h2 = Math.max(...highs.slice(25));
    const l1 = Math.min(...lows.slice(0, 15)), l2 = Math.min(...lows.slice(25));
    
    if (Math.abs(h1 - h2) / h1 < 0.02 && currentPrice < h1 * 0.96) patterns.push("פסגה כפולה (Double Top) - היפוך דובי 👤👤");
    if (Math.abs(l1 - l2) / l1 < 0.02 && currentPrice > l1 * 1.04) patterns.push("תחתית כפולה (Double Bottom) - היפוך שורי 🕳️🕳️");

    const leftS = Math.max(...highs.slice(0, 12));
    const head = Math.max(...highs.slice(12, 28));
    const rightS = Math.max(...highs.slice(28));
    if (head > leftS * 1.04 && head > rightS * 1.04 && Math.abs(leftS - rightS) / leftS < 0.05) patterns.push("ראש וכתפיים (H&S) - היפוך דובי חזק 👤");

    const poleStart = closes[0], poleEnd = closes[10];
    const flagMax = Math.max(...closes.slice(11)), flagMin = Math.min(...closes.slice(11));
    if (poleEnd > poleStart * 1.1 && flagMax <= poleEnd * 1.02 && flagMin > poleStart) patterns.push("דגל שורי (Bull Flag) - המשכיות לעלייה 🚩");
    if (poleEnd < poleStart * 0.9 && flagMin >= poleEnd * 0.98 && flagMax < poleStart) patterns.push("דגל דובי (Bear Flag) - המשכיות לירידה 🚩");

    const h_recent = highs.slice(-15), l_recent = lows.slice(-15);
    const isRising = h_recent[0] < h_recent[h_recent.length-1] && l_recent[0] < l_recent[l_recent.length-1];
    const isFalling = h_recent[0] > h_recent[h_recent.length-1] && l_recent[0] > l_recent[l_recent.length-1];
    
    if (isRising && (h_recent[h_recent.length-1] - l_recent[l_recent.length-1]) < (h_recent[0] - l_recent[0])) patterns.push("יתד עולה (Rising Wedge) 📐⬇️");
    if (isFalling && (h_recent[h_recent.length-1] - l_recent[l_recent.length-1]) < (h_recent[0] - l_recent[0])) patterns.push("יתד יורד (Falling Wedge) 📐⬆️");

    const maxHist = Math.max(...highs.slice(0, 39));
    const minHist = Math.min(...lows.slice(0, 39));
    if (currentPrice >= maxHist) patterns.push("פריצת שיא (All-Time High / Multi-Year Breakout) 🚀");
    if (currentPrice <= minHist) patterns.push("שבירת שפל היסטורי ⚠️");

    if (patterns.length === 0) return "דשדוש במבנה מחיר (Neutral Consolidation) ↔️";
    return [...new Set(patterns)].join(" | ");
}

function sanitizeValue(val) {
    if (val === null || val === undefined || isNaN(val) || val === '') return "N/A";
    return val;
}

function formatNumberShort(num) { 
    if(!num) return "N/A"; 
    let absNum = Math.abs(num);
    let sign = num < 0 ? "-" : "";
    if (absNum >= 1e12) return sign + (absNum / 1e12).toFixed(2) + "T"; 
    if (absNum >= 1e9) return sign + (absNum / 1e9).toFixed(2) + "B"; 
    if (absNum >= 1e6) return sign + (absNum / 1e6).toFixed(2) + "M"; 
    return num.toLocaleString(); 
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
        
        if (!apiKey || !finnhubKey) return res.status(500).json({ success: false, message: "Missing API keys." });

        if (action === 'live_data' && ticker) {
            // הוספנו פה משיכה של הפונדמנטלס גם ל-live_data כדי שהפרונטאנד לא יאפס אותם!
            const [quote, chartPoints, profile, metricsData] = await Promise.all([
                fetchFinnhub('quote', `symbol=${ticker}`),
                fetchYahooData(ticker, '2y', '1wk'),
                fetchFinnhub('stock/profile2', `symbol=${ticker}`),
                fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`)
            ]);
            
            const lastChartPoint = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : {};
            const m = metricsData?.metric || {};
            
            const fundamentals = {
                marketCap: profile?.marketCapitalization || m?.marketCapitalization || null,
                peRatio: m?.peBasicExclExtraTTM || m?.peExclExtraAnnual || null,
                roe: m?.roeTTM || null, 
                netMargin: m?.netProfitMarginTTM || null,
                revenueGrowth: m?.revenueGrowthTTMYoy || null, 
                debtToEquity: m?.totalDebtToEquityAnnual || null
            };
            
            return res.status(200).json({
                success: true, 
                ticker, 
                price: Number(quote?.c || 0), 
                changePercentage: Number(quote?.dp || 0),
                ma50: lastChartPoint.ma50 || null, 
                ma200: lastChartPoint.ma200 || null,
                // תיקון ווליום למקרה ש-finnhub מחזיר 0
                volume: Number(quote?.v || lastChartPoint.volume || 0), 
                pattern: detectAllPatterns(chartPoints), 
                ...fundamentals,
                chartData: chartPoints
            });
        }

        if (action === 'market' || (!ticker && action !== 'analyze')) {
            const [spy, qqq, dia, iwm, xlk, xlv, xlf, xle, xly, xli, newsData, topGainers, topLosers] = await Promise.all([
                fetchFinnhub('quote', 'symbol=SPY'), fetchFinnhub('quote', 'symbol=QQQ'), fetchFinnhub('quote', 'symbol=DIA'), fetchFinnhub('quote', 'symbol=IWM'), 
                fetchFinnhub('quote', 'symbol=XLK'), fetchFinnhub('quote', 'symbol=XLV'), fetchFinnhub('quote', 'symbol=XLF'), fetchFinnhub('quote', 'symbol=XLE'), 
                fetchFinnhub('quote', 'symbol=XLY'), fetchFinnhub('quote', 'symbol=XLI'), fetchFinnhub('news', 'category=business'),
                fetchYahooScreener('day_gainers'), fetchYahooScreener('day_losers')
            ]);
            return res.status(200).json({
                success: true,
                marketData: {
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

        const today = new Date().toISOString().split('T')[0];
        const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const [quote, profile, chartPoints, metricsData, recommendations, priceTargets, earningsData, tickerNews, insiderData, peersData, sentimentData, vix, tnx] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchYahooData(ticker, '2y', '1wk'), 
            fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`),
            fetchFinnhub('stock/recommendation', `symbol=${ticker}`),
            fetchFinnhub('stock/price-target', `symbol=${ticker}`),
            fetchFinnhub('stock/earnings', `symbol=${ticker}`),
            fetchFinnhub('company-news', `symbol=${ticker}&from=${lastMonth}&to=${today}`),
            fetchFinnhub('insider-transactions', `symbol=${ticker}`),
            fetchFinnhub('stock/peers', `symbol=${ticker}`),
            fetchFinnhub('news-sentiment', `symbol=${ticker}`),
            fetchYahooQuote('^VIX'), fetchYahooQuote('^TNX')
        ]);

        const m = metricsData?.metric || {};
        
        // תיקון קריטי: הסרת העטיפה של Number() שחייבה ערכים להיות 0, כעת נתון חסר נשאר null
        const fundamentals = {
            marketCap: profile?.marketCapitalization || m?.marketCapitalization || null,
            peRatio: m?.peBasicExclExtraTTM || m?.peExclExtraAnnual || null,
            roe: m?.roeTTM || null, 
            netMargin: m?.netProfitMarginTTM || null,
            revenueGrowth: m?.revenueGrowthTTMYoy || null, 
            debtToEquity: m?.totalDebtToEquityAnnual || null
        };

        const insiders = Array.isArray(insiderData?.data) ? insiderData.data : [];
        let netInsiderShares = 0;
        insiders.slice(0, 15).forEach(t => netInsiderShares += (t.change || 0));
        const insiderSentiment = netInsiderShares > 0 ? 'חיובי (קניות)' : netInsiderShares < 0 ? 'שלילי (מכירות)' : 'ניטרלי';

        const lastPoint = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : {};
        const keyLevels = extractKeyLevels(chartPoints);
        const levelsPrompt = keyLevels.map(l => `${l.type}: $${l.price.toFixed(2)}`).join(', ');
        const patternsDetected = detectAllPatterns(chartPoints);

        const isETF = profile?.finnhubIndustry === "" || (!fundamentals.marketCap && !fundamentals.peRatio);

        // הנחיות מעודכנות וחזקות יותר ל-AI לגבי נתונים חסרים
        const dataInstruction = isETF 
            ? "שים לב: נכס זה מזוהה כקרן סל (ETF) או מדד סקטוריאלי. התעלם לחלוטין מחוסר בנתוני פונדמנטלס (כמו מכפילים, רווחיות או שווי שוק). אל תוריד על כך ציון ואל תציין שחסר מידע. התבסס 100% על הניתוח הטכני, רמות המחיר, התבניות, והמאקרו."
            : "שים לב חשוב מאוד: זוהי חברה ציבורית. אם חלק מהנתונים הפונדמנטליים (P/E, ROE, שולי רווח) מופיעים כ-'N/A', משמעות הדבר היא שספק הנתונים (ה-API) נכשל בהבאתם. *אסור לך* להניח שהחברה מפסידה או שהנתון שלה שואף לאפס. במצב כזה, ציין ב'summary' שחסרים נתוני יסוד עקב שגיאת חיבור, והתבסס רק על הטכני והמומנטום בניתוח.";

        const prompt = `אתה "הכריש" - אנליסט בכיר בקרן גידור. עליך לספק ניתוח מניות מקצועי ואובייקטיבי.
        
        ${dataInstruction}
        
        משקלות הניתוח:
        1. איכות עסקית ופונדמנטלס (50%): (בחברה רגילה בלבד).
        2. מבנה מחיר וטכני (40%): תבניות בגרף, רמות תמיכה/התנגדות, ממוצעים ומומנטום.
        3. מאקרו, סנטימנט וכסף חכם (10%): VIX, אג"ח, חדשות, ופעילות בעלי עניין (Insider - מקבל משקל משני בלבד בניתוח).

        נתונים לעיבוד:
        - מניה/נכס: ${ticker} (${profile?.name || ticker}). מחיר נוכחי: $${quote?.c || 0}.
        - רמות מחיר היסטוריות: ${levelsPrompt}.
        - תבניות שזוהו ב-JS: ${patternsDetected}.
        - נתוני מאקרו: VIX (פחד): ${vix}, תשואת אג"ח 10 שנים: ${tnx}%.
        - פעילות בעלי עניין (Insider): סנטימנט ${insiderSentiment} (נטו שינוי: ${formatNumberShort(netInsiderShares)} מניות).
        - טכני: ממוצע 50: $${lastPoint.ma50}, ממוצע 200: $${lastPoint.ma200}. RSI: ${calculateRSI(chartPoints.map(p=>p.close)).toFixed(1)}.
        - פונדמנטלס: P/E: ${sanitizeValue(fundamentals.peRatio)}, ROE: ${sanitizeValue(fundamentals.roe)}${fundamentals.roe ? '%' : ''}, שולי רווח: ${sanitizeValue(fundamentals.netMargin)}${fundamentals.netMargin ? '%' : ''}, צמיחה YoY: ${sanitizeValue(fundamentals.revenueGrowth)}${fundamentals.revenueGrowth ? '%' : ''}.
        
        דרישות פלט חובה:
        - שווי הוגן (Intrinsic Value): ציין מספר דולרי ספציפי (או "לא רלוונטי ל-ETF").
        - אזור איסוף: הגדר טווח מחירים מבוסס תמיכות.

        ספק פסיקה ב-JSON בלבד בעברית:
        {
          "identity": "תיאור עסקי קצר",
          "technical": "ניתוח טכני מעמיק המשלב את התבניות שזוהו ואת הרמות",
          "news_analysis": "ניתוח פונדמנטלי, מאקרו, וסנטימנט כסף חכם",
          "summary": "השורה התחתונה - הוסף כאן הערה אם חסר מידע קריטי לחברה.",
          "pros": ["חוזקה 1", "חוזקה 2"], "cons": ["סיכון 1", "סיכון 2"],
          "price_target": "יעד ל-12 חודשים (מספר)",
          "intrinsic_value": "מחיר בדולרים + הסבר קצר",
          "accumulation_zone": "טווח מחירים",
          "risk_level": "נמוך / בינוני / גבוה",
          "rating": "קנייה חזקה / קנייה / החזקה / מכירה",
          "scores": { "growth": 80, "momentum": 75, "value": 60, "quality": 90, "overall": 82 }
        }`;

        const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3 } })
        });

        let aiVerdict = {};
        if (aiResponse.ok) {
            const aiData = await aiResponse.json();
            try {
                let text = aiData.candidates[0].content.parts[0].text;
                aiVerdict = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
            } catch (e) { aiVerdict = { summary: "שגיאת עיבוד.", scores: { overall: 50 }, rating: "החזקה" }; }
        }

        return res.status(200).json({
            success: true, ticker, name: profile?.name || ticker, industry: profile?.finnhubIndustry || "N/A", sector: profile?.finnhubIndustry || "N/A",
            price: Number(quote?.c || 0), changePercentage: Number(quote?.dp || 0),
            ma50: lastPoint.ma50, ma200: lastPoint.ma200, volume: Number(quote?.v || lastPoint.volume || 0),
            pattern: patternsDetected, rsi: calculateRSI(chartPoints.map(p=>p.close)), ...fundamentals,
            tickerNews: (Array.isArray(tickerNews) ? tickerNews : []).slice(0, 5),
            insiderTransactions: insiders.slice(0, 6),
            insiderSentiment: insiderSentiment,
            analysis: aiVerdict, chartData: chartPoints
        });
    } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
};
