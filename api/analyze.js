async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch (e) { return null; }
}

// פונקציה חדשה: משיכת גרף ישירות מיאהו פייננס (עוקף את החסימות של Finnhub)
async function fetchYahooChart(ticker, range = "6mo") {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`;
        const res = await fetch(url);
        const data = await res.json();
        const result = data.chart.result[0];
        const timestamps = result.timestamp;
        const closes = result.indicators.quote[0].close;
        return timestamps.map((t, i) => ({
            date: new Date(t * 1000).toISOString().split('T')[0],
            value: Number(closes[i]),
            close: Number(closes[i])
        })).filter(p => !isNaN(p.close));
    } catch (e) { return []; }
}

// פונקציה חדשה: VIX אמיתי מיאהו פייננס
async function getRealVix() {
    try {
        const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/^VIX?interval=1d&range=1d');
        const data = await res.json();
        return data.chart.result[0].meta.regularMarketPrice;
    } catch(e) { return 20; }
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

        // --- 1. דף הבית: מדדי שוק ---
        if (action === 'market' || (!ticker && action !== 'analyze')) {
            const [spy, qqq, dia, iwm, news, realVix] = await Promise.all([
                fetchFinnhub('quote', 'symbol=SPY'),
                fetchFinnhub('quote', 'symbol=QQQ'),
                fetchFinnhub('quote', 'symbol=DIA'),
                fetchFinnhub('quote', 'symbol=IWM'),
                fetchFinnhub('news', 'category=general'),
                getRealVix() // מדד VIX אמיתי
            ]);

            const fearGreedScore = Math.max(5, Math.min(95, 100 - (realVix * 2.5)));
            const sentiment = fearGreedScore > 60 ? "חמדנות" : fearGreedScore < 40 ? "פחד" : "נייטרלי";

            const indexes = [
                { symbol: 'S&P 500', price: Number(spy?.c || 0), changesPercentage: Number(spy?.dp || 0) },
                { symbol: 'NASDAQ', price: Number(qqq?.c || 0), changesPercentage: Number(qqq?.dp || 0) },
                { symbol: 'DOW 30', price: Number(dia?.c || 0), changesPercentage: Number(dia?.dp || 0) },
                { symbol: 'RUSSELL 2000', price: Number(iwm?.c || 0), changesPercentage: Number(iwm?.dp || 0) }
            ];

            return res.status(200).json({
                success: true,
                marketData: {
                    indexes: indexes,
                    vix: { value: fearGreedScore.toFixed(0), sentiment: sentiment },
                    sectors: [
                        { sector: "טכנולוגיה", changesPercentage: String(qqq?.dp || "0") },
                        { sector: "תעשייה", changesPercentage: String(dia?.dp || "0") },
                        { sector: "כללי", changesPercentage: String(spy?.dp || "0") }
                    ],
                    news: (news || []).slice(0, 5).map(item => ({
                        title: item.headline, url: item.url, source: item.source, time: new Date(item.datetime * 1000).toLocaleTimeString('he-IL')
                    }))
                }
            });
        }

        // --- 2. דף ניתוח: מניה ספציפית ---
        // הוספנו כאן את המשיכה של stock/metric כדי להביא את הפונדמנטליים!
        const [quote, profile, chartPoints, metricsData] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchYahooChart(ticker), 
            fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`)
        ]);

        const prompt = `נתח את ${ticker}. מחיר נוכחי: ${quote?.c || 0}$.
        החזר אובייקט JSON בלבד, לפי המבנה הבא:
        {
          "identity": "טקסט המתאר את החברה",
          "technical": "טקסט ניתוח טכני",
          "news_analysis": "טקסט ניתוח חדשות",
          "summary": "טקסט מסכם ושורה תחתונה",
          "pros": ["יתרון 1", "יתרון 2"],
          "cons": ["חיסרון 1", "חיסרון 2"],
          "price_target": "מספר טהור בלבד ללא סימנים (למשל 150.50)",
          "rating": "קנייה / החזקה / מכירה",
          "scores": {
            "growth": 80,
            "momentum": 75,
            "value": 60,
            "quality": 90
          }
        }`;

        const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const aiData = await aiResponse.json();
        let aiVerdict = {};
        try {
            let text = aiData.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
            aiVerdict = JSON.parse(text);
            
            // חילוץ מספר טהור ליעד המחיר 
            if (typeof aiVerdict.price_target === 'string') {
                const num = aiVerdict.price_target.replace(/[^0-9.]/g, '');
                aiVerdict.price_target = num ? Number(num) : Number(quote?.c || 0) * 1.1;
            }

            aiVerdict.verdict = aiVerdict.summary;
            aiVerdict.positive = aiVerdict.pros || [];
            aiVerdict.negative = aiVerdict.cons || [];
            
            const s = aiVerdict.scores || {};
            // שיבוט המפתחות גם לאנגלית וגם לעברית כדי שהאתר יתפוס אותם בטוח
            aiVerdict.scores = {
                growth: s.growth || 50,
                momentum: s.momentum || 50,
                value: s.value || 50,
                quality: s.quality || 50,
                "צמיחה": s.growth || 50,
                "מומנטום": s.momentum || 50,
                "ערך": s.value || 50,
                "איכות עסקית": s.quality || 50
            };
        } catch (e) { aiVerdict = { summary: "שגיאה בפענוח הניתוח" }; }

        // --- מיפוי נתונים פונדמנטליים ---
        const m = metricsData?.metric || {};
        const fundamentals = {
            marketCap: profile?.marketCapitalization || m.marketCapitalization || 0,
            fiftyTwoWeekHigh: m['52WeekHigh'] || 0,
            fiftyTwoWeekLow: m['52WeekLow'] || 0,
            peRatio: m.peExclExtraAnnual || m.peBasicExclExtraTTM || 0,
            pbRatio: m.pbAnnual || m.pbQuarterly || 0,
            eps: m.epsExclExtraItemsAnnual || m.epsTTM || 0,
            roe: m.roeTTM || 0,
            debtToEquity: m.totalDebtToEquityAnnual || m.totalDebtToEquityQuarterly || 0,
            dividendYield: m.dividendYieldIndicatedAnnual || 0
        };

        return res.status(200).json({
            success: true,
            ticker: ticker,
            name: String(profile?.name || ticker),
            industry: String(profile?.finnhubIndustry || "Technology"),
            price: Number(quote?.c || 0),
            changePercentage: Number(quote?.dp || 0),
            marketData: {
                ticker: ticker,
                name: String(profile?.name || ticker),
                price: Number(quote?.c || 0),
                changePercentage: Number(quote?.dp || 0)
            },
            fundamentals: fundamentals, // כאן הוספנו את המידע לטבלה!
            metrics: fundamentals,      // הוספנו גם תחת השם הזה ליתר ביטחון
            verdict: aiVerdict,
            aiVerdict: aiVerdict,
            chartData: chartPoints,
            chartHistory: chartPoints
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
