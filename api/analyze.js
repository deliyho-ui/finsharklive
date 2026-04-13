async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch (e) { return null; }
}

// שולף שנתיים של נתונים שבועיים – אידיאלי למציאת תבניות וממוצעים
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
        })).filter(p => !isNaN(p.close));

        // חישוב ממוצעים נעים ישירות על הגרף (10 שבועות ~ MA50, 40 שבועות ~ MA200)
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
    } catch (e) { return []; }
}

// ==========================================
// 🚀 פונקציות עזר חדשות (סניטציה ותבניות)
// ==========================================
function sanitizeValue(val) {
    // מגן על ה-AI מלקבל נתוני 0 שגויים או null
    if (val === 0 || val === null || val === undefined || isNaN(val)) return "N/A";
    return val;
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

    // 1. חיתוכי ממוצעים (Golden/Death Cross)
    if (currentPoint.ma50 && currentPoint.ma200 && prevPoint.ma50 && prevPoint.ma200) {
        if (prevPoint.ma50 <= prevPoint.ma200 && currentPoint.ma50 > currentPoint.ma200) patterns.push("חיתוך זהב (Golden Cross) - שורי חזק 📈");
        else if (prevPoint.ma50 >= prevPoint.ma200 && currentPoint.ma50 < currentPoint.ma200) patterns.push("חיתוך מוות (Death Cross) - דובי חזק 📉");
    }

    const prices20 = last20.map(p => p.close);
    const max20 = Math.max(...prices20);
    const min20 = Math.min(...prices20);
    const prices50 = last50.map(p => p.close);
    
    // 2. ספל וידית (Cup & Handle) - 50 שבועות אחורה
    const leftLip = Math.max(...prices50.slice(0, 15));
    const cupBottom = Math.min(...prices50.slice(15, 35));
    const rightLip = Math.max(...prices50.slice(35, 45));
    const handleBottom = Math.min(...prices50.slice(45));
    
    if (leftLip > cupBottom * 1.15 && Math.abs(leftLip - rightLip) / leftLip < 0.08 && handleBottom > cupBottom && currentPrice > handleBottom) {
        patterns.push("ספל וידית (Cup & Handle) - המשך מגמת עלייה ☕");
    }

    // 3. ראש וכתפיים (Head & Shoulders) - 30 שבועות אחורה
    const prices30 = last30.map(p => p.close);
    const leftShoulder = Math.max(...prices30.slice(0, 10));
    const head = Math.max(...prices30.slice(10, 20));
    const rightShoulder = Math.max(...prices30.slice(20, 30));
    
    if (head > leftShoulder * 1.05 && head > rightShoulder * 1.05 && Math.abs(leftShoulder - rightShoulder) / leftShoulder < 0.08) patterns.push("ראש וכתפיים (Head & Shoulders) - היפוך דובי 👤");

    const leftShoulderInv = Math.min(...prices30.slice(0, 10));
    const headInv = Math.min(...prices30.slice(10, 20));
    const rightShoulderInv = Math.min(...prices30.slice(20, 30));

    if (headInv < leftShoulderInv * 0.95 && headInv < rightShoulderInv * 0.95 && Math.abs(leftShoulderInv - rightShoulderInv) / leftShoulderInv < 0.08) patterns.push("ראש וכתפיים הפוך (Inverse H&S) - היפוך שורי 👤⬆️");

    // 4. משולשים, יתדות ותעלות (Triangles, Wedges, Channels) - 20 שבועות אחורה
    const h1 = Math.max(...prices20.slice(0, 6)), h2 = Math.max(...prices20.slice(7, 13)), h3 = Math.max(...prices20.slice(14, 20));
    const l1 = Math.min(...prices20.slice(0, 6)), l2 = Math.min(...prices20.slice(7, 13)), l3 = Math.min(...prices20.slice(14, 20));
    
    // משולשים
    if (Math.abs(h1 - h2) / h1 < 0.03 && Math.abs(h2 - h3) / h2 < 0.03 && l1 < l2 && l2 < l3) patterns.push("משולש עולה (Ascending Triangle) - התכווצות לפני פריצה שורית 📐⬆️");
    else if (Math.abs(l1 - l2) / l1 < 0.03 && Math.abs(l2 - l3) / l2 < 0.03 && h1 > h2 && h2 > h3) patterns.push("משולש יורד (Descending Triangle) - לחץ מכירות, שבירה דובית מתקרבת 📐⬇️");
    else if (h1 > h2 && h2 > h3 && l1 < l2 && l2 < l3) patterns.push("משולש מתכנס (Symmetrical Triangle) - התכווצות תנודתיות לקראת תנועה חדה 📐");
    
    // יתדות (Wedges)
    else if (h1 > h2 && h2 > h3 && l1 > l2 && l2 > l3 && (h1 - h3) > (l1 - l3)) patterns.push("יתד יורד (Falling Wedge) - תבנית היפוך שורית 🪓⬆️");
    else if (h1 < h2 && h2 < h3 && l1 < l2 && l2 < l3 && (l3 - l1) > (h3 - h1)) patterns.push("יתד עולה (Rising Wedge) - תבנית היפוך דובית 🪓⬇️");
    
    // תעלות (Channels)
    else if (h1 < h2 && h2 < h3 && l1 < l2 && l2 < l3 && Math.abs((h3 - h1) - (l3 - l1)) / Math.max(h3 - h1, 1) < 0.2) patterns.push("תעלה עולה (Ascending Channel) 🛤️⬆️");
    else if (h1 > h2 && h2 > h3 && l1 > l2 && l2 > l3 && Math.abs((h1 - h3) - (l1 - l3)) / Math.max(h1 - h3, 1) < 0.2) patterns.push("תעלה יורדת (Descending Channel) 🛤️⬇️");

    // 5. פסגות ותחתיות - כפולות ומשולשות
    const t1 = Math.max(...prices30.slice(0, 10)), t2 = Math.max(...prices30.slice(10, 20)), t3 = Math.max(...prices30.slice(20, 30));
    const b1 = Math.min(...prices30.slice(0, 10)), b2 = Math.min(...prices30.slice(10, 20)), b3 = Math.min(...prices30.slice(20, 30));

    if (Math.abs(t1 - t2) / t1 < 0.03 && Math.abs(t2 - t3) / t2 < 0.03 && currentPrice < t3 * 0.95) patterns.push("פסגה משולשת (Triple Top) - קיר התנגדות מסיבי ⛰️⛰️⛰️");
    else if (Math.abs(b1 - b2) / b1 < 0.03 && Math.abs(b2 - b3) / b2 < 0.03 && currentPrice > b3 * 1.05) patterns.push("תחתית משולשת (Triple Bottom) - רצפת תמיכה ברזל 🕳️🕳️🕳️");
    else if (Math.abs(t2 - t3) / t2 < 0.03 && currentPrice < t3 * 0.95) patterns.push("פסגה כפולה (Double Top) - התנגדות כפולה, סימן דובי ⛰️⛰️");
    else if (Math.abs(b2 - b3) / b2 < 0.03 && currentPrice > b3 * 1.05) patterns.push("תחתית כפולה (Double Bottom) - תמיכה כפולה, סימן שורי 🕳️🕳️");

    // 6. דגלים (Bull / Bear Flags) - זינוק ואז דשדוש קצר
    const pastPole = prices20.slice(0, 8);
    const recentFlag = prices20.slice(8, 20);
    const poleStart = pastPole[0], poleEnd = pastPole[pastPole.length-1];
    const flagMax = Math.max(...recentFlag), flagMin = Math.min(...recentFlag);
    
    if (poleEnd > poleStart * 1.15 && flagMax <= poleEnd * 1.02 && flagMin > poleStart && (flagMax - flagMin)/flagMax < 0.12) {
         patterns.push("דגל שורי (Bull Flag) - ספיגת רווחים לקראת המשך ראלי 🚩🟩");
    } else if (poleEnd < poleStart * 0.85 && flagMin >= poleEnd * 0.98 && flagMax < poleStart && (flagMax - flagMin)/flagMax < 0.12) {
         patterns.push("דגל דובי (Bear Flag) - התבססות לקראת גל ירידות נוסף 🚩🟥");
    }

    // 7. פריצות תמיכה/התנגדות (Breakouts)
    if (currentPrice >= max20 * 0.99) patterns.push("פריצת שיא מקומי (Breakout) 🚀");
    else if (currentPrice <= min20 * 1.01) patterns.push("בחינת אזור תמיכה תחתון (Support Zone Test) 🧱");

    if (patterns.length === 0) return "דשדוש ותנועה צדדית ללא תבנית מובהקת (Consolidation) ↔️";
    
    // סינון כפילויות חישוב ושליחה
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

        // ==========================================
        // 1. דף הבית (ללא VIX)
        // ==========================================
        if (action === 'market' || (!ticker && action !== 'analyze')) {
            const [spy, qqq, dia, iwm, newsData] = await Promise.all([
                fetchFinnhub('quote', 'symbol=SPY'),
                fetchFinnhub('quote', 'symbol=QQQ'),
                fetchFinnhub('quote', 'symbol=DIA'),
                fetchFinnhub('quote', 'symbol=IWM'),
                fetchFinnhub('news', 'category=business') 
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
                        { sector: "טכנולוגיה", changesPercentage: String(qqq?.dp || "0") },
                        { sector: "תעשייה", changesPercentage: String(dia?.dp || "0") },
                        { sector: "כללי", changesPercentage: String(spy?.dp || "0") }
                    ],
                    // סינון בטוח של המערך כדי למנוע קריסה מול API החדשות
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
        // 2. פסיקת הכריש - מסוף אנליסטים מלא
        // ==========================================
        
        // הכנת תאריכים למשיכת חדשות על המניה מהחודש האחרון
        const today = new Date().toISOString().split('T')[0];
        const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const [quote, profile, chartPoints, metricsData, recommendations, priceTargets, earningsData, tickerNews] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchYahooData(ticker, '2y', '1wk'), 
            fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`),
            fetchFinnhub('stock/recommendation', `symbol=${ticker}`),
            fetchFinnhub('stock/price-target', `symbol=${ticker}`),
            fetchFinnhub('stock/earnings', `symbol=${ticker}`),
            fetchFinnhub('company-news', `symbol=${ticker}&from=${lastMonth}&to=${today}`) // שורת החדשות למניה הספציפית!
        ]);

        const m = metricsData?.metric || {};
        
        // שליפת הדוח הרבעוני האחרון
        let latestEarnings = null;
        if (Array.isArray(earningsData) && earningsData.length > 0) {
            latestEarnings = earningsData[0];
        }
        
        // 💡 הנתונים לחזית עוברים כ-0 נקי כדי למנוע את ה-TypeError מהפונקציה toFixed
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

        // משיכת הממוצעים מהגרף האמיתי במקום מהנתון הריק של Finnhub
        const lastChartPoint = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : {};
        const calcMa50 = lastChartPoint.ma50 ? Number(lastChartPoint.ma50) : Number(m['50DayMovingAverage'] || 0);
        const calcMa200 = lastChartPoint.ma200 ? Number(lastChartPoint.ma200) : Number(m['200DayMovingAverage'] || 0);

        const technicals = {
            ma50: calcMa50,
            ma200: calcMa200,
            volume: Number(quote?.v || m['10DayAverageTradingVolume'] || 0),
            trend: Number(quote?.c) > calcMa50 ? "שורית (מעל ממוצע 50)" : "דובית (מתחת לממוצע 50)"
        };

        // הפעלת מזהה התבניות
        const detectedPattern = detectPattern(chartPoints);

        const analystConsensus = Array.isArray(recommendations) && recommendations.length > 0 ? 
            `קנייה: ${recommendations[0].buy + recommendations[0].strongBuy}, החזקה: ${recommendations[0].hold}, מכירה: ${recommendations[0].sell}` : "אין קונצנזוס";

        const meanTarget = priceTargets?.targetMean ? Number(priceTargets.targetMean).toFixed(2) : null;
        const highTarget = priceTargets?.targetHigh ? Number(priceTargets.targetHigh).toFixed(2) : null;
        
        // יצירת טקסט דוח רבעוני להכנסה לפרומפט
        const earningsPromptText = latestEarnings ? 
            `דוח רבעוני אחרון (${latestEarnings.period}): רווח בפועל $${latestEarnings.actual} מול צפי של $${latestEarnings.estimate}. הפתעה של ${latestEarnings.surprisePercent}%.` : 
            `אין נתוני דוח רבעוני אחרון.`;

        // יצירת טקסט חדשות להכנסה לפרומפט
        const validTickerNews = Array.isArray(tickerNews) ? tickerNews : [];
        let newsPromptText = "לא נמצאו חדשות רלוונטיות לחברה בחודש האחרון.";
        if (validTickerNews.length > 0) {
            const topNews = validTickerNews.slice(0, 3).map(n => `- ${n.headline}`).join('\n');
            newsPromptText = `כותרות מרכזיות מהתקופה האחרונה:\n${topNews}`;
        }

        // 💡 הסניטציה (sanitizeValue) מופעלת כאן ספציפית כדי להעלים 0 מהעיניים של ה-AI
        const prompt = `אתה "הכריש" - מודל בינה מלאכותית (AI) פיננסי מתקדם, עצמאי ואובייקטיבי לחלוטין. המטרה שלך היא לספק ניתוח עומק מקיף וריאלי למניית ${ticker} (${profile?.name || ticker}), ללא תלות עיוורת באנליסטים אנושיים. 
        הדרישה הקריטית שלי אליך: פרט לעומק על כל סעיף. כתוב לפחות 2-3 משפטים עשירים ואנליטיים על הפונדמנטלס ועל המצב הטכני. אל תזרוק סתם סיסמאות קצרות. תן ערך אמיתי.
        
        נתוני אמת מהשוק לעיבוד עמוק:
        - מחיר ומגמה טכנית: מחיר נוכחי: $${quote?.c || 0}. ממוצע 50: $${technicals.ma50}, ממוצע 200: $${technicals.ma200}. (מגמה: ${technicals.trend}). תבנית בגרף שזוהתה על ידי המערכת: ${detectedPattern}.
        - תמחור (Valuation): מכפיל רווח (P/E): ${sanitizeValue(fundamentals.peRatio)}, מכפיל הון (P/B): ${sanitizeValue(fundamentals.pbRatio)}, מכפיל מכירות (P/S): ${sanitizeValue(fundamentals.psRatio)}.
        - רווחיות ויעילות (Profitability): שולי רווח גולמי: ${sanitizeValue(fundamentals.grossMargin)}%, רווח נקי: ${sanitizeValue(fundamentals.netMargin)}%. תשואה להון (ROE): ${sanitizeValue(fundamentals.roe)}%, תשואה להון מושקע (ROIC): ${sanitizeValue(fundamentals.roic)}%.
        - צמיחה ודוחות: ${earningsPromptText}. צמיחת הכנסות (YoY): ${sanitizeValue(fundamentals.revenueGrowth)}%, צמיחת רווח למניה (5Y): ${sanitizeValue(fundamentals.epsGrowth5Y)}%.
        - חוסן פיננסי וסיכון: יחס נזילות (Current): ${sanitizeValue(fundamentals.currentRatio)}, חוב להון: ${sanitizeValue(fundamentals.debtToEquity)}, תנודתיות (Beta): ${sanitizeValue(fundamentals.beta)}.
        - סנטימנט השוק: ${analystConsensus}. (יעד ממוצע בשוק: $${meanTarget || 'לא זמין'}, יעד גבוה: $${highTarget || 'לא זמין'}).
        - חדשות אחרונות למניה:
        ${newsPromptText}
        
        הנחיות קריטיות - חסינות שגיאות נתונים (Anomaly Detection):
        מערכת הנתונים שולחת ערך "N/A" במקרה של נתון חסר או אפס לא הגיוני. במקרה שאתה מזהה נתון "N/A" - *התעלם ממנו לחלוטין* ואל תציין אותו כ"נקודת תורפה". הסתמך על שאר הנתונים התקינים שקיבלת!
        
        הנחיות קריטיות לניתוח שווי (Valuation):
        1. עצמאות המודל: אתה לא עובד אצל האנליסטים! יעד המחיר הממוצע שסופק הוא רק רפרנס. חשב מחיר יעד ריאלי (price_target) בעצמך בהתבסס על הרווחיות, ההפתעה בדוחות, החדשות, התבנית הטכנית, והמומנטום.
        2. תמחור נועז ואמיתי: לחברות מנצחות תן יעד אפסייד חזק. לחברות מפסידות חתוך את מחיר היעד למטה בחדות.
        
        ספק את הניתוח בפורמט JSON חוקי בלבד בעברית (חובה להשתמש במבנה הבא בדיוק):
        {
          "identity": "פרופיל החברה ומעמדה התחרותי בשוק.",
          "technical": "ניתוח טכני מעמיק המשלב את הממוצעים ואת התבנית הגרפית שזוהתה (${detectedPattern}).",
          "news_analysis": "ניתוח פונדמנטלי המשלב את תוצאות הדוח הרבעוני, החדשות האחרונות, הצמיחה והתמחור.",
          "summary": "השורה התחתונה שלך מחיבור כל הנתונים לכדי הערכת שווי כוללת.",
          "verdict": "פסיקה נוקבת ומנומקת.",
          "pros": ["נקודת חוזק 1", "נקודת חוזק 2", "נקודת חוזק 3"],
          "cons": ["נקודת תורפה 1", "נקודת תורפה 2", "נקודת תורפה 3"],
          "pattern": "משפט קצר המסביר את התבנית שזוהתה בגרף ומה משמעותה.",
          "price_target": "מספר טהור בלבד ללא סימנים (למשל 150)",
          "rating": "קנייה / החזקה / מכירה / קנייה חזקה",
          "scores": { "growth": 80, "momentum": 75, "value": 60, "quality": 90 }
        }`;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.4, 
                topP: 0.8,
                topK: 10,
                responseMimeType: "application/json" // 💡 הכרחה לקבל JSON נקי
            }
        };

        const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!aiResponse.ok) {
            throw new Error(`שגיאה מ-Gemini API (סטטוס ${aiResponse.status})`);
        }

        const aiData = await aiResponse.json();
        let aiVerdict = {};
        try {
            // פענוח ה-JSON (בזכות ה-MimeType זה יעבוד חלק)
            let text = aiData.candidates[0].content.parts[0].text.trim();
            aiVerdict = JSON.parse(text);
            
            let targetNum;
            if (typeof aiVerdict.price_target === 'string') {
                targetNum = Number(aiVerdict.price_target.replace(/[^0-9.]/g, ''));
            } else {
                targetNum = Number(aiVerdict.price_target);
            }
            
            aiVerdict.price_target = (targetNum && targetNum > 0) ? targetNum : (meanTarget ? Number(meanTarget) : Number(quote?.c || 0) * 1.15);

            aiVerdict.bottomLine = aiVerdict.summary || aiVerdict.verdict;
            aiVerdict.verdict = aiVerdict.verdict || aiVerdict.summary;
            const prosArray = Array.isArray(aiVerdict.pros) ? aiVerdict.pros : ["נתונים טכניים או פונדמנטליים חיוביים"];
            const consArray = Array.isArray(aiVerdict.cons) ? aiVerdict.cons : ["סיכוני שוק"];
            
            aiVerdict.positive = prosArray; aiVerdict.strengths = prosArray; aiVerdict.bullish = prosArray;
            aiVerdict.negative = consArray; aiVerdict.weaknesses = consArray; aiVerdict.bearish = consArray;
            
            const s = aiVerdict.scores || {};
            aiVerdict.scores = { growth: s.growth || 50, momentum: s.momentum || 50, value: s.value || 50, quality: s.quality || 50 };
        } catch (e) { aiVerdict = { bottomLine: "הניתוח נכשל טכנית", verdict: "שגיאה בפענוח הנתונים מה-AI", pros: [], cons: [] }; }

        return res.status(200).json({
            success: true,
            ticker, name: profile?.name || ticker, industry: profile?.finnhubIndustry || "N/A", sector: profile?.finnhubIndustry || "N/A",
            price: Number(quote?.c || 0), changePercentage: Number(quote?.dp || 0),
            
            ma50: technicals.ma50, ma200: technicals.ma200, volume: technicals.volume, trend: technicals.trend, pattern: detectedPattern,
            ...fundamentals,
            
            latestEarnings: latestEarnings,
            tickerNews: validTickerNews.slice(0, 5), // מחזיר עד 5 כתבות לחזית להצגה
            
            marketData: { ticker, name: profile?.name || ticker, price: quote?.c, changePercentage: quote?.dp, ...fundamentals, ...technicals, pattern: detectedPattern },
            fundamentals, metrics: fundamentals, technical: technicals, technicals,
            verdict: aiVerdict, aiVerdict,
            chartData: chartPoints, chartHistory: chartPoints
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
