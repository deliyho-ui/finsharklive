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
        const result = data.chart.result[0];
        const timestamps = result.timestamp;
        const quotes = result.indicators.quote[0];
        
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
                    news: (newsData || []).slice(0, 5).map(item => ({
                        title: item.headline,
                        headline: item.headline,
                        url: item.url,
                        source: item.source,
                        publishedAt: new Date(item.datetime * 1000).toISOString(),
                        date: new Date(item.datetime * 1000).toISOString()
                    }))
                }
            });
        }

        // ==========================================
        // 2. פסיקת הכריש - מסוף אנליסטים מלא
        // ==========================================
        const [quote, profile, chartPoints, metricsData, recommendations, priceTargets] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchYahooData(ticker, '2y', '1wk'), 
            fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`),
            fetchFinnhub('stock/recommendation', `symbol=${ticker}`),
            fetchFinnhub('stock/price-target', `symbol=${ticker}`)
        ]);

        const m = metricsData?.metric || {};
        
        const fundamentals = {
            marketCap: profile?.marketCapitalization || m.marketCapitalization || 0,
            fiftyTwoWeekHigh: m['52WeekHigh'] || 0,
            fiftyTwoWeekLow: m['52WeekLow'] || 0,
            peRatio: m.peBasicExclExtraTTM || m.peExclExtraAnnual || 0,
            pbRatio: m.pbAnnual || m.pbQuarterly || 0,
            psRatio: m.psTTM || m.psAnnual || 0, // NEW: מכפיל מכירות
            eps: m.epsTTM || m.epsExclExtraItemsAnnual || 0,
            epsGrowth5Y: m.epsGrowth5Y || 0, // NEW: צמיחת רווח
            roe: m.roeTTM || 0,
            roa: m.roaTTM || 0, // NEW: תשואה לנכסים
            roic: m.roicTTM || 0, // NEW: החזר השקעה
            debtToEquity: m.totalDebtToEquityAnnual || m.totalDebtToEquityQuarterly || 0,
            dividendYield: m.dividendYieldIndicatedAnnual || 0,
            revenueGrowth: m.revenueGrowthTTMYoy || m.revenueGrowth5Y || 0,
            grossMargin: m.grossMarginTTM || m.grossMarginAnnual || 0, // NEW: רווח גולמי
            operatingMargin: m.operatingMarginTTM || m.operatingMarginAnnual || 0, // NEW: רווח תפעולי
            netMargin: m.netProfitMarginTTM || m.netMarginTTM || 0,
            currentRatio: m.currentRatioQuarterly || m.currentRatioAnnual || 0,
            quickRatio: m.quickRatioQuarterly || m.quickRatioAnnual || 0, // NEW: יחס מהיר
            beta: m.beta || 0
        };

        // תיקון: משיכת הממוצעים מהגרף האמיתי במקום מהנתון הריק של Finnhub
        const lastChartPoint = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : {};
        const calcMa50 = lastChartPoint.ma50 ? Number(lastChartPoint.ma50) : Number(m['50DayMovingAverage'] || 0);
        const calcMa200 = lastChartPoint.ma200 ? Number(lastChartPoint.ma200) : Number(m['200DayMovingAverage'] || 0);

        const technicals = {
            ma50: calcMa50,
            ma200: calcMa200,
            volume: Number(quote?.v || m['10DayAverageTradingVolume'] || 0),
            trend: Number(quote?.c) > calcMa50 ? "שורית (מעל ממוצע 50)" : "דובית (מתחת לממוצע 50)"
        };

        const analystConsensus = recommendations && recommendations.length > 0 ? 
            `קנייה: ${recommendations[0].buy + recommendations[0].strongBuy}, החזקה: ${recommendations[0].hold}, מכירה: ${recommendations[0].sell}` : "אין קונצנזוס";

        // שליפת יעדי מחיר מדויקים - ממוצע וגבוה (כרפרנס בלבד למודל)
        const meanTarget = priceTargets?.targetMean ? Number(priceTargets.targetMean).toFixed(2) : null;
        const highTarget = priceTargets?.targetHigh ? Number(priceTargets.targetHigh).toFixed(2) : null;

        const prompt = `אתה "הכריש" - מודל בינה מלאכותית (AI) פיננסי מתקדם, עצמאי ואובייקטיבי לחלוטין. המטרה שלך היא לספק ניתוח עומק אמיתי למניית ${ticker} (${profile?.name}), ללא תלות עיוורת באנליסטים אנושיים. המטרה היא להכות את השוק.
        
        נתוני אמת מהשוק לעיבוד עמוק (חובה לנתח את כולם כדי לקבוע מחיר יעד!):
        - מחיר ומגמה טכנית: מחיר נוכחי: $${quote?.c}. ממוצע 50: $${technicals.ma50}, ממוצע 200: $${technicals.ma200}. (מגמה: ${technicals.trend}).
        - תמחור (Valuation): מכפיל רווח (P/E): ${fundamentals.peRatio}, מכפיל הון (P/B): ${fundamentals.pbRatio}, מכפיל מכירות (P/S): ${fundamentals.psRatio}. (האם החברה יקרה או זולה ביחס לצמיחה שלה?)
        - רווחיות ויעילות (Profitability): שולי רווח גולמי: ${fundamentals.grossMargin}%, רווח תפעולי: ${fundamentals.operatingMargin}%, רווח נקי: ${fundamentals.netMargin}%. תשואה להון (ROE): ${fundamentals.roe}%, תשואה לנכסים (ROA): ${fundamentals.roa}%, תשואה להון מושקע (ROIC): ${fundamentals.roic}%. (האם זו מכונה יעילה לייצור כסף?)
        - צמיחה (Growth): צמיחת הכנסות (YoY): ${fundamentals.revenueGrowth}%, צמיחת רווח למניה ב-5 שנים (EPS Growth): ${fundamentals.epsGrowth5Y}%.
        - חוסן פיננסי וסיכון: יחס נזילות מיידי (Current): ${fundamentals.currentRatio}, יחס מהיר (Quick): ${fundamentals.quickRatio}, חוב להון: ${fundamentals.debtToEquity}, תנודתיות (Beta): ${fundamentals.beta}.
        - סנטימנט וקונצנזוס השוק: ${analystConsensus}. (יעד ממוצע בשוק: $${meanTarget || 'לא זמין'}, יעד גבוה: $${highTarget || 'לא זמין'}).
        
        הנחיות קריטיות לניתוח שווי (Valuation):
        1. עצמאות המודל: אתה לא עובד אצל האנליסטים! יעד המחיר הממוצע שסופק הוא רק רפרנס. חשב מחיר יעד ריאלי (price_target) בעצמך המבוסס על הצלבת נתוני התמחור, הרווחיות, הצמיחה והמומנטום הטכני שמסופקים כאן.
        2. תמחור הוגן ומקורי: אם לחברה יש צמיחת EPS חזקה, ROIC גבוה ושולי רווח משתפרים - תן יעד מחיר המשקף אפסייד אמיתי ונועז (10% עד 30% או יותר), אפילו אם זה מעל הקונצנזוס. מנגד, אם יש יחס חוב מסוכן, התכווצות הכנסות או P/E בועתי ללא גיבוי - תן דאונסייד והמלצת מכירה אגרסיבית.
        3. השורה התחתונה והפסיקה (rating) חייבות לשקף את ההיגיון המדויק שגזרת מהמספרים לעיל. ציין אילו נתונים ספציפיים הובילו להחלטה.
        
        ספק את הניתוח בפורמט JSON חוקי בלבד בעברית:
        "identity": "פרופיל החברה ומעמדה התחרותי בשוק.",
        "technical": "ניתוח טכני מבוסס ממוצעים ותנודתיות.",
        "news_analysis": "ניתוח פונדמנטלי חריף ועצמאי של כל מספרי הרווחיות, הצמיחה והתמחור.",
        "summary": "השורה התחתונה שלך מחיבור כל הנתונים לכדי הערכת שווי כוללת.",
        "verdict": "פסיקה נוקבת ומנומקת.",
        "pros": ["נקודת חוזק 1", "נקודת חוזק 2", "נקודת חוזק 3"],
        "cons": ["נקודת תורפה 1", "נקודת תורפה 2", "נקודת תורפה 3"],
        "pattern": "תבנית שזוהתה בנתונים הטכניים/הפונדמנטליים",
        "price_target": "מחיר יעד ל-12 חודשים (חובה מספר טהור, מבוסס על הניתוח המקורי שלך)",
        "rating": "קנייה / החזקה / מכירה / קנייה חזקה",
        "scores": { "growth": 1-100, "momentum": 1-100, "value": 1-100, "quality": 1-100 }`;

        // העלינו את הטמפרטורה ל-0.3 כדי לאפשר ל-AI יכולת היקש וחישוב עצמאית
        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.3, 
                topP: 0.8,
                topK: 10
            }
        };

        const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const aiData = await aiResponse.json();
        let aiVerdict = {};
        try {
            let text = aiData.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
            aiVerdict = JSON.parse(text);
            
            // הגנה על מספר טהור למחיר היעד - יפול ליעד הממוצע או חישוב בסיסי במקרה של שגיאת AI
            let targetNum;
            if (typeof aiVerdict.price_target === 'string') {
                targetNum = Number(aiVerdict.price_target.replace(/[^0-9.]/g, ''));
            } else {
                targetNum = Number(aiVerdict.price_target);
            }
            
            aiVerdict.price_target = (targetNum && targetNum > 0) ? targetNum : (meanTarget ? Number(meanTarget) : Number(quote?.c || 0) * 1.15);

            // הפצצת מפתחות לוודא שהפרונט-אנד לעולם לא מראה "חסר נתונים"
            aiVerdict.bottomLine = aiVerdict.summary || aiVerdict.verdict;
            aiVerdict.verdict = aiVerdict.verdict || aiVerdict.summary;
            const prosArray = Array.isArray(aiVerdict.pros) ? aiVerdict.pros : ["צמיחה פוטנציאלית"];
            const consArray = Array.isArray(aiVerdict.cons) ? aiVerdict.cons : ["תנודתיות שוק"];
            
            aiVerdict.positive = prosArray; aiVerdict.strengths = prosArray; aiVerdict.bullish = prosArray;
            aiVerdict.negative = consArray; aiVerdict.weaknesses = consArray; aiVerdict.bearish = consArray;
            
            const s = aiVerdict.scores || {};
            aiVerdict.scores = { growth: s.growth || 50, momentum: s.momentum || 50, value: s.value || 50, quality: s.quality || 50 };
        } catch (e) { aiVerdict = { bottomLine: "הניתוח נכשל טכנית", verdict: "שגיאה", pros: [], cons: [] }; }

        return res.status(200).json({
            success: true,
            ticker, name: profile?.name || ticker, industry: profile?.finnhubIndustry || "N/A", sector: profile?.finnhubIndustry || "N/A",
            price: Number(quote?.c || 0), changePercentage: Number(quote?.dp || 0),
            
            // שולחים את כל הנתונים גם לשורש האובייקט וגם לתוך marketData
            ma50: technicals.ma50, ma200: technicals.ma200, volume: technicals.volume, trend: technicals.trend,
            ...fundamentals,
            
            marketData: { ticker, name: profile?.name || ticker, price: quote?.c, changePercentage: quote?.dp, ...fundamentals, ...technicals },
            fundamentals, metrics: fundamentals, technical: technicals, technicals,
            verdict: aiVerdict, aiVerdict,
            chartData: chartPoints, chartHistory: chartPoints
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
