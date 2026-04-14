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

// שולף נתוני מאקרו בסיסיים (VIX, תשואות אג"ח)
async function fetchYahooQuote(ticker) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const data = await res.json();
        return data.chart.result[0].meta.regularMarketPrice;
    } catch (e) { return null; }
}

// שולף 5 מניות מובילות או יורדות מהסורק של Yahoo Finance
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

// פונקציה לחישוב מדד ה-RSI
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

function sanitizeValue(val) {
    if (val === 0 || val === null || val === undefined || isNaN(val)) return "N/A";
    return val;
}

function formatNumberShort(num) { 
    if(!num) return "N/A"; 
    if (num >= 1e12) return (num / 1e12).toFixed(2) + "T"; 
    if (num >= 1e9) return (num / 1e9).toFixed(2) + "B"; 
    if (num >= 1e6) return (num / 1e6).toFixed(2) + "M"; 
    return num.toLocaleString(); 
}

function detectPattern(chartPoints) {
    if (!chartPoints || chartPoints.length < 50) return "אין מספיק נתונים לזיהוי תבניות מורכבות";

    const last20 = chartPoints.slice(-20); 
    const last30 = chartPoints.slice(-30);
    const last50 = chartPoints.slice(-50); 
    const currentPoint = chartPoints[chartPoints.length - 1];
    const prevPoint = chartPoints[chartPoints.length - 2];
    const currentPrice = currentPoint.close;

    let patterns = [];

    if (currentPoint.ma50 && currentPoint.ma200 && prevPoint.ma50 && prevPoint.ma200) {
        if (prevPoint.ma50 <= prevPoint.ma200 && currentPoint.ma50 > currentPoint.ma200) patterns.push("חיתוך זהב (Golden Cross) - שורי חזק 📈");
        else if (prevPoint.ma50 >= prevPoint.ma200 && currentPoint.ma50 < currentPoint.ma200) patterns.push("חיתוך מוות (Death Cross) - דובי חזק 📉");
    }

    const prices20 = last20.map(p => p.close);
    const max20 = Math.max(...prices20);
    const min20 = Math.min(...prices20);
    const prices50 = last50.map(p => p.close);
    
    const leftLip = Math.max(...prices50.slice(0, 15));
    const cupBottom = Math.min(...prices50.slice(15, 35));
    const rightLip = Math.max(...prices50.slice(35, 45));
    const handleBottom = Math.min(...prices50.slice(45));
    
    if (leftLip > cupBottom * 1.15 && Math.abs(leftLip - rightLip) / leftLip < 0.08 && handleBottom > cupBottom && currentPrice > handleBottom) {
        patterns.push("ספל וידית (Cup & Handle) - המשך מגמת עלייה ☕");
    }

    const prices30 = last30.map(p => p.close);
    const leftShoulder = Math.max(...prices30.slice(0, 10));
    const head = Math.max(...prices30.slice(10, 20));
    const rightShoulder = Math.max(...prices30.slice(20, 30));
    if (head > leftShoulder * 1.05 && head > rightShoulder * 1.05 && Math.abs(leftShoulder - rightShoulder) / leftShoulder < 0.08) patterns.push("ראש וכתפיים (Head & Shoulders) - היפוך דובי 👤");

    const leftShoulderInv = Math.min(...prices30.slice(0, 10));
    const headInv = Math.min(...prices30.slice(10, 20));
    const rightShoulderInv = Math.min(...prices30.slice(20, 30));
    if (headInv < leftShoulderInv * 0.95 && headInv < rightShoulderInv * 0.95 && Math.abs(leftShoulderInv - rightShoulderInv) / leftShoulderInv < 0.08) patterns.push("ראש וכתפיים הפוך (Inverse H&S) - היפוך שורי 👤⬆️");

    const h1 = Math.max(...prices20.slice(0, 6)), h2 = Math.max(...prices20.slice(7, 13)), h3 = Math.max(...prices20.slice(14, 20));
    const l1 = Math.min(...prices20.slice(0, 6)), l2 = Math.min(...prices20.slice(7, 13)), l3 = Math.min(...prices20.slice(14, 20));
    
    if (Math.abs(h1 - h2) / h1 < 0.03 && Math.abs(h2 - h3) / h2 < 0.03 && l1 < l2 && l2 < l3) patterns.push("משולש עולה (Ascending Triangle) - התכווצות לפני פריצה שורית 📐⬆️");
    else if (Math.abs(l1 - l2) / l1 < 0.03 && Math.abs(l2 - l3) / l2 < 0.03 && h1 > h2 && h2 > h3) patterns.push("משולש יורד (Descending Triangle) - לחץ מכירות, שבירה דובית מתקרבת 📐⬇️");
    else if (h1 > h2 && h2 > h3 && l1 < l2 && l2 < l3) patterns.push("משולש מתכנס (Symmetrical Triangle) - התכווצות תנודתיות לקראת תנועה חדה 📐");
    else if (h1 > h2 && h2 > h3 && l1 > l2 && l2 > l3 && (h1 - h3) > (l1 - l3)) patterns.push("יתד יורד (Falling Wedge) - תבנית היפוך שורית 🪓⬆️");
    else if (h1 < h2 && h2 < h3 && l1 < l2 && l2 < l3 && (l3 - l1) > (h3 - h1)) patterns.push("יתד עולה (Rising Wedge) - תבנית היפוך דובית 🪓⬇️");
    else if (h1 < h2 && h2 < h3 && l1 < l2 && l2 < l3 && Math.abs((h3 - h1) - (l3 - l1)) / Math.max(h3 - h1, 1) < 0.2) patterns.push("תעלה עולה (Ascending Channel) 🛤️⬆️");
    else if (h1 > h2 && h2 > h3 && l1 > l2 && l2 > l3 && Math.abs((h1 - h3) - (l1 - l3)) / Math.max(h1 - h3, 1) < 0.2) patterns.push("תעלה יורדת (Descending Channel) 🛤️⬇️");

    const t1 = Math.max(...prices30.slice(0, 10)), t2 = Math.max(...prices30.slice(10, 20)), t3 = Math.max(...prices30.slice(20, 30));
    const b1 = Math.min(...prices30.slice(0, 10)), b2 = Math.min(...prices30.slice(10, 20)), b3 = Math.min(...prices30.slice(20, 30));

    if (Math.abs(t1 - t2) / t1 < 0.03 && Math.abs(t2 - t3) / t2 < 0.03 && currentPrice < t3 * 0.95) patterns.push("פסגה משולשת (Triple Top) - קיר התנגדות מסיבי ⛰️⛰️⛰️");
    else if (Math.abs(b1 - b2) / b1 < 0.03 && Math.abs(b2 - b3) / b2 < 0.03 && currentPrice > b3 * 1.05) patterns.push("תחתית משולשת (Triple Bottom) - רצפת תמיכה ברזל 🕳️🕳️🕳️");
    else if (Math.abs(t2 - t3) / t2 < 0.03 && currentPrice < t3 * 0.95) patterns.push("פסגה כפולה (Double Top) - התנגדות כפולה, סימן דובי ⛰️⛰️");
    else if (Math.abs(b2 - b3) / b2 < 0.03 && currentPrice > b3 * 1.05) patterns.push("תחתית כפולה (Double Bottom) - תמיכה כפולה, סימן שורי 🕳️🕳️");

    const pastPole = prices20.slice(0, 8);
    const recentFlag = prices20.slice(8, 20);
    const poleStart = pastPole[0], poleEnd = pastPole[pastPole.length-1];
    const flagMax = Math.max(...recentFlag), flagMin = Math.min(...recentFlag);
    
    if (poleEnd > poleStart * 1.15 && flagMax <= poleEnd * 1.02 && flagMin > poleStart && (flagMax - flagMin)/flagMax < 0.12) {
         patterns.push("דגל שורי (Bull Flag) - ספיגת רווחים לקראת המשך ראלי 🚩🟩");
    } else if (poleEnd < poleStart * 0.85 && flagMin >= poleEnd * 0.98 && flagMax < poleStart && (flagMax - flagMin)/flagMax < 0.12) {
         patterns.push("דגל דובי (Bear Flag) - התבססות לקראת גל ירידות נוסף 🚩🟥");
    }

    if (currentPrice >= max20 * 0.99) patterns.push("פריצת שיא מקומי (Breakout) 🚀");
    else if (currentPrice <= min20 * 1.01) patterns.push("בחינת אזור תמיכה תחתון (Support Zone Test) 🧱");

    if (patterns.length === 0) return "דשדוש ותנועה צדדית ללא תבנית מובהקת (Consolidation) ↔️";
    
    return [...new Set(patterns)].join(" | ");
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
        
        if (!apiKey || !finnhubKey) {
            return res.status(500).json({ success: false, message: "Server configuration error: Missing API keys in Vercel environment." });
        }

        // ==========================================
        // 1. מסלול מהיר - Live Data למנגנון המטמון
        // ==========================================
        if (action === 'live_data' && ticker) {
            const [quote, chartPoints] = await Promise.all([
                fetchFinnhub('quote', `symbol=${ticker}`),
                fetchYahooData(ticker, '2y', '1wk')
            ]);
            
            const lastChartPoint = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : {};
            const currentVolume = Number(quote?.v || 0);
            
            const closes = chartPoints.map(p => p.close);
            const rsiVal = calculateRSI(closes);

            return res.status(200).json({
                success: true,
                ticker,
                price: Number(quote?.c || 0),
                changePercentage: Number(quote?.dp || 0),
                ma50: lastChartPoint.ma50 || 0,
                ma200: lastChartPoint.ma200 || 0,
                volume: currentVolume,
                trend: Number(quote?.c) > (lastChartPoint.ma50 || 0) ? "שורית (מעל ממוצע 50)" : "דובית (מתחת לממוצע 50)",
                pattern: detectPattern(chartPoints),
                rsi: rsiVal,
                chartData: chartPoints
            });
        }

        // ==========================================
        // 2. דף הבית - מזג האוויר של השוק
        // ==========================================
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
                    gainers: topGainers,
                    losers: topLosers,
                    news: (Array.isArray(newsData) ? newsData : []).slice(0, 5).map(item => {
                        let parsedDate = new Date().toISOString();
                        try { if (item.datetime && !isNaN(item.datetime)) parsedDate = new Date(item.datetime * 1000).toISOString(); } catch(e){}
                        return {
                            title: item.headline || "ללא כותרת",
                            headline: item.headline || "ללא כותרת",
                            url: item.url || "#",
                            source: item.source || "שוק ההון",
                            publishedAt: parsedDate,
                            date: parsedDate
                        };
                    })
                }
            });
        }

        // ==========================================
        // 3. ניתוח מלא על ידי ה-AI (משודרג להשקעות טווח ארוך)
        // ==========================================
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
            fetchYahooQuote('^VIX'),
            fetchYahooQuote('^TNX')
        ]);

        const m = metricsData?.metric || {};
        let latestEarnings = null;
        if (Array.isArray(earningsData) && earningsData.length > 0) latestEarnings = earningsData[0];
        
        const fundamentals = {
            marketCap: Number(profile?.marketCapitalization || m.marketCapitalization || 0),
            fiftyTwoWeekHigh: Number(m['52WeekHigh'] || 0),
            fiftyTwoWeekLow: Number(m['52WeekLow'] || 0),
            peRatio: Number(m.peBasicExclExtraTTM || m.peExclExtraAnnual || 0),
            pbRatio: Number(m.pbAnnual || m.pbQuarterly || 0),
            psRatio: Number(m.psTTM || m.psAnnual || 0), 
            eps: Number(m.epsTTM || m.epsExclExtraItemsAnnual || 0),
            epsGrowth5Y: Number(m.epsGrowth5Y || 0), 
            roe: Number(m.roeTTM || 0),
            roa: Number(m.roaTTM || 0), 
            roic: Number(m.roicTTM || 0), 
            debtToEquity: Number(m.totalDebtToEquityAnnual || m.totalDebtToEquityQuarterly || 0),
            dividendYield: Number(m.dividendYieldIndicatedAnnual || 0),
            revenueGrowth: Number(m.revenueGrowthTTMYoy || m.revenueGrowth5Y || 0),
            grossMargin: Number(m.grossMarginTTM || m.grossMarginAnnual || 0), 
            operatingMargin: Number(m.operatingMarginTTM || m.operatingMarginAnnual || 0), 
            netMargin: Number(m.netProfitMarginTTM || m.netMarginTTM || 0),
            currentRatio: Number(m.currentRatioQuarterly || m.currentRatioAnnual || 0),
            quickRatio: Number(m.quickRatioQuarterly || m.quickRatioAnnual || 0), 
            beta: Number(m.beta || 0)
        };

        const lastChartPoint = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : {};
        const calcMa50 = lastChartPoint.ma50 ? Number(lastChartPoint.ma50) : Number(m['50DayMovingAverage'] || 0);
        const calcMa200 = lastChartPoint.ma200 ? Number(lastChartPoint.ma200) : Number(m['200DayMovingAverage'] || 0);
        const currentVolume = Number(quote?.v || m['10DayAverageTradingVolume'] || 0);

        const closes = chartPoints.map(p => p.close);
        const rsiVal = calculateRSI(closes);

        // חישוב ווליום יחסי מול 10 שבועות אחרונים (מכיוון שהגרף שלנו שבועי)
        const last10Candles = chartPoints.slice(-10);
        const avgVolume10d = last10Candles.reduce((sum, p) => sum + p.volume, 0) / (last10Candles.length || 1);
        const volumeContext = currentVolume > 0 && avgVolume10d > 0
            ? `נפח מסחר נוכחי הינו ${formatNumberShort(currentVolume)} (מהווה ${((currentVolume/avgVolume10d)*100).toFixed(0)}% מהממוצע התקופתי)`
            : `נפח מסחר נוכחי הינו ${currentVolume}`;

        const technicals = {
            ma50: calcMa50, ma200: calcMa200, volume: currentVolume, rsi: rsiVal,
            trend: Number(quote?.c) > calcMa50 ? "שורית (מעל ממוצע 50)" : "דובית (מתחת לממוצע 50)"
        };

        const detectedPattern = detectPattern(chartPoints);
        const analystConsensus = Array.isArray(recommendations) && recommendations.length > 0 ? `קנייה: ${recommendations[0].buy + recommendations[0].strongBuy}, החזקה: ${recommendations[0].hold}, מכירה: ${recommendations[0].sell}` : "אין קונצנזוס";
        const meanTarget = priceTargets?.targetMean ? Number(priceTargets.targetMean).toFixed(2) : null;
        const highTarget = priceTargets?.targetHigh ? Number(priceTargets.targetHigh).toFixed(2) : null;
        
        const earningsPromptText = latestEarnings ? `דוח רבעוני אחרון (${latestEarnings.period}): רווח בפועל $${latestEarnings.actual} מול צפי של $${latestEarnings.estimate}. הפתעה של ${latestEarnings.surprisePercent}%.` : `אין נתוני דוח רבעוני אחרון.`;

        // עיבוד פעילות בעלי עניין
        let insiderContext = "אין עסקאות בעלי עניין משמעותיות לאחרונה.";
        if (insiderData && insiderData.data && insiderData.data.length > 0) {
            const recentInsiders = insiderData.data.slice(0, 3);
            let buyShare = 0; let sellShare = 0;
            recentInsiders.forEach(t => { if(t.change > 0) buyShare+=t.change; else sellShare+=Math.abs(t.change); });
            if (buyShare > sellShare && buyShare > 0) insiderContext = "פעילות בעלי עניין חיובית: נושאי משרה ודירקטורים קונים מניות לאחרונה.";
            else if (sellShare > buyShare && sellShare > 0) insiderContext = "פעילות בעלי עניין שלילית: קיימת מגמת מכירת מניות מצד נושאי משרה.";
        }

        // עיבוד השוואת מתחרים (Peers)
        let peersContext = "לא נמצאו מתחרים ישירים למניה זו במערכת.";
        if (Array.isArray(peersData) && peersData.length > 0) {
            peersContext = `מתחרות ישירות בסקטור (Peers): ${peersData.filter(p => p !== ticker).slice(0, 5).join(', ')}`;
        }

        // עיבוד סנטימנט תקשורתי
        let sentimentContext = "";
        if (sentimentData && sentimentData.sentiment) {
            const bullPct = (sentimentData.sentiment.bullishPercent * 100).toFixed(0);
            const bearPct = (sentimentData.sentiment.bearishPercent * 100).toFixed(0);
            sentimentContext = `מדד סנטימנט תקשורתי (Buzz): שורי ${bullPct}%, דובי ${bearPct}%.`;
        }

        const validTickerNews = Array.isArray(tickerNews) ? tickerNews : [];
        let newsPromptText = "לא נמצאו חדשות רלוונטיות לחברה בחודש האחרון.";
        if (validTickerNews.length > 0) {
            const topNews = validTickerNews.slice(0, 3).map(n => `- ${n.headline}`).join('\n');
            newsPromptText = `כותרות מרכזיות מהתקופה האחרונה:\n${topNews}`;
        }

        const prompt = `אתה "הכריש" - מודל בינה מלאכותית (AI) פיננסי מתקדם המיועד למשקיעי ערך (Value) וטווח ארוך (Growth). המטרה שלך היא לספק ניתוח עומק מקיף ואובייקטיבי לחלוטין למניית/נכס ${ticker} (${profile?.name || ticker}).
        
        הנחיות קריטיות לניתוח והתמודדות עם נתונים (Graceful Degradation):
        1. עצמאות המודל והשקעת ערך: אינך מחפש עסקאות סווינג קצרות, אלא מעריך שווי הוגן (Intrinsic Value), אזורי איסוף ארוכי טווח, ורמת סיכון לתיק ההשקעות.
        2. התעלמות מנתוני קיצון חסרי היגיון: אם אתה מזהה נתון פונדמנטלי אבסורדי (כמו מכפיל רווח P/E של 8000), התעלם ממנו והנח שמדובר בעיוות מס.
        3. תמיכה בתעודות סל ומדדים (ETFs): אם חסרים נתונים פונדמנטליים מרכזיים (כגון EPS, מכפילים, שולי רווח), סביר להניח שזהו מדד או תעודת סל סקטוריאלית. במקרה כזה, אל תוריד נקודות בציון! העבר את משקל הניתוח באופן אוטומטי למומנטום הטכני, לזרימת הכספים (Volume), לסביבת המאקרו ולחשיבות הסקטור.

        נתוני אמת מהשוק לעיבוד עמוק:
        - סביבת מאקרו (Macro): מדד הפחד (VIX) עומד על ${vix || 'N/A'}, ותשואת אג"ח ארה"ב ל-10 שנים היא ${tnx || 'N/A'}%. (שקלל את נתוני המאקרו בעת תמחור הסיכון).
        - מחיר, מגמה, ותבנית: מחיר נוכחי: $${quote?.c || 0}. ממוצע 50: $${technicals.ma50}, ממוצע 200: $${technicals.ma200}. (מגמה: ${technicals.trend}). תבנית בגרף שזוהתה: ${detectedPattern}.
        - מומנטום קנייה/מכירה (RSI): מדד העוצמה היחסית (RSI 14 שבועות) עומד על ${technicals.rsi.toFixed(1)}. (מעל 70 = קניית יתר, מתחת 30 = מכירת יתר).
        - נפח מסחר ויחסיות (Volume): ${volumeContext}. (שים לב לכך בעת בחינת אמינות הפריצות או המגמה).
        - השוואת מתחרות וסקטור: ${peersContext}
        - פעילות בעלי עניין (Insider Trading): ${insiderContext}
        - תמחור (Valuation): מכפיל רווח (P/E): ${sanitizeValue(fundamentals.peRatio)}, מכפיל הון (P/B): ${sanitizeValue(fundamentals.pbRatio)}, מכפיל מכירות (P/S): ${sanitizeValue(fundamentals.psRatio)}.
        - רווחיות ויעילות (Profitability): שולי רווח גולמי: ${sanitizeValue(fundamentals.grossMargin)}%, רווח נקי: ${sanitizeValue(fundamentals.netMargin)}%. תשואה להון (ROE): ${sanitizeValue(fundamentals.roe)}%, תשואה להון מושקע (ROIC): ${sanitizeValue(fundamentals.roic)}%.
        - צמיחה ודוחות: ${earningsPromptText}. צמיחת הכנסות (YoY): ${sanitizeValue(fundamentals.revenueGrowth)}%, צמיחת רווח למניה (5Y): ${sanitizeValue(fundamentals.epsGrowth5Y)}%.
        - חוסן פיננסי: יחס נזילות (Current): ${sanitizeValue(fundamentals.currentRatio)}, חוב להון: ${sanitizeValue(fundamentals.debtToEquity)}, תנודתיות (Beta): ${sanitizeValue(fundamentals.beta)}.
        - סנטימנט השוק: קונצנזוס אנליסטים: ${analystConsensus}. ${sentimentContext}
        - חדשות אחרונות למניה:
        ${newsPromptText}
        
        ספק את הניתוח בפורמט JSON חוקי בלבד בעברית (חובה להשתמש במבנה הבא בדיוק, ללא טקסט מחוץ לסוגריים המסולסלים):
        {
          "identity": "הסבר מעמיק על זהות החברה, הפעילות המרכזית, או תיאור של תעודת הסל.",
          "technical": "ניתוח טכני ארוך טווח המשלב את הממוצעים, הווליום היחסי, תבניות, וזיהוי אזורי תמיכה/התנגדות מהותיים בגרף השבועי.",
          "news_analysis": "ניתוח המשלב דוחות כספיים, סנטימנט תקשורתי, מגמות מאקרו ופעילות בעלי עניין.",
          "summary": "שורה תחתונה חותכת - האם זה הזמן לקנות, להחזיק או לשחרר, תוך התייחסות למאקרו.",
          "pros": ["חוזקה 1", "חוזקה 2", "חוזקה 3"],
          "cons": ["חולשה/סיכון 1", "חולשה/סיכון 2", "חולשה/סיכון 3"],
          "price_target": "מספר טהור המייצג יעד מחיר ל-12 חודשים (או N/A אם מדובר בתעודת סל)",
          "intrinsic_value": "הערכת שווי הוגן בטקסט קצר (למשל: 'מתומחרת בחסר עמוק', 'יקרה', 'שווי הוגן' או 'N/A')",
          "accumulation_zone": "טווח מחירים אידיאלי לאיסוף הדרגתי (למשל: '$140-$145' או 'קניה בשער הנוכחי')",
          "risk_level": "נמוך / בינוני / גבוה (הערכת רמת הסיכון הכוללת להשקעה ארוכת טווח)",
          "rating": "קנייה / החזקה / מכירה / קנייה חזקה",
          "scores": { "growth": 80, "momentum": 75, "value": 60, "quality": 90, "overall": 82 }
        }
        חובה להחזיר רק את ה-JSON ללא שום מילים נוספות!`;

        const payload = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, topP: 0.8, topK: 10 } };
        const modelName = "gemini-2.5-flash"; 

        const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });

        let aiVerdict = {};

        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            if (aiResponse.status === 429) {
                aiVerdict = {
                    summary: "המערכת חווה עומס זמני עקב כמות פניות גבוהה ל-AI. הנתונים נמשכו בהצלחה וניתנים לצפייה למטה.",
                    pros: ["נתוני האמת נמשכו בהצלחה"], cons: ["ניתוח ה-AI מושהה זמנית"],
                    price_target: meanTarget ? Number(meanTarget) : Number(quote?.c || 0), rating: "החזקה",
                    intrinsic_value: "N/A", accumulation_zone: "N/A", risk_level: "N/A",
                    scores: { growth: 50, momentum: 50, value: 50, quality: 50, overall: 50 }
                };
            } else {
                throw new Error(`שגיאה מ-Gemini API: ${errorText}`);
            }
        } else {
            const aiData = await aiResponse.json();
            try {
                let text = aiData.candidates[0].content.parts[0].text;
                const jsonStart = text.indexOf('{'), jsonEnd = text.lastIndexOf('}');
                
                if (jsonStart !== -1 && jsonEnd !== -1) {
                    text = text.substring(jsonStart, jsonEnd + 1);
                    aiVerdict = JSON.parse(text);
                } else { throw new Error("Invalid JSON structure returned from AI"); }
                
                let targetNum = typeof aiVerdict.price_target === 'string' ? Number(aiVerdict.price_target.replace(/[^0-9.]/g, '')) : Number(aiVerdict.price_target);
                aiVerdict.price_target = (targetNum && targetNum > 0) ? targetNum : (meanTarget ? Number(meanTarget) : Number(quote?.c || 0) * 1.15);
                
                // הזרקת ברירות מחדל במקרה שה-AI שכח שדות חדשים
                aiVerdict.intrinsic_value = aiVerdict.intrinsic_value || 'לא הוגדר';
                aiVerdict.accumulation_zone = aiVerdict.accumulation_zone || 'לא הוגדר';
                aiVerdict.risk_level = aiVerdict.risk_level || 'לא הוגדר';
                
                aiVerdict.pros = Array.isArray(aiVerdict.pros) ? aiVerdict.pros : ["נתונים חיוביים"];
                aiVerdict.cons = Array.isArray(aiVerdict.cons) ? aiVerdict.cons : ["סיכוני שוק"];
                
                const s = aiVerdict.scores || {};
                const aiOverall = s.overall || Math.round(((s.growth||50)+(s.momentum||50)+(s.value||50)+(s.quality||50))/4);

                aiVerdict.scores = { growth: s.growth || 50, momentum: s.momentum || 50, value: s.value || 50, quality: s.quality || 50, overall: aiOverall };

                if (aiVerdict.scores.overall >= 80) aiVerdict.rating = "קנייה חזקה";
                else if (aiVerdict.scores.overall >= 60) aiVerdict.rating = "קנייה";
                else if (aiVerdict.scores.overall <= 40) aiVerdict.rating = "מכירה";
                else aiVerdict.rating = "החזקה";

            } catch (e) { 
                aiVerdict = { 
                    summary: "הנתונים נמשכו בהצלחה, אך ה-AI התקשה לנסח פסיקה בפורמט תקין.", 
                    pros: ["כל נתוני השוק זמינים לצפייה"], cons: ["תקלה זמנית בסיכום המילולי"],
                    price_target: meanTarget ? Number(meanTarget) : Number(quote?.c || 0), rating: "החזקה",
                    intrinsic_value: "N/A", accumulation_zone: "N/A", risk_level: "N/A",
                    scores: { growth: 50, momentum: 50, value: 50, quality: 50, overall: 50 }
                }; 
            }
        }

        return res.status(200).json({
            success: true,
            ticker, name: profile?.name || ticker, industry: profile?.finnhubIndustry || "N/A", sector: profile?.finnhubIndustry || "N/A",
            price: Number(quote?.c || 0), changePercentage: Number(quote?.dp || 0),
            
            ma50: technicals.ma50, ma200: technicals.ma200, volume: technicals.volume, trend: technicals.trend, pattern: detectedPattern, rsi: technicals.rsi,
            ...fundamentals,
            
            latestEarnings: latestEarnings,
            tickerNews: validTickerNews.slice(0, 5),
            
            analysis: aiVerdict,
            chartData: chartPoints
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
