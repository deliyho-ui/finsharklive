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
        // 1. דף הבית
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
                    // VIX מבוטל (מחזיר ערך קבוע שלא ישבור את האתר)
                    vix: { value: 50, score: 50, sentiment: "לא זמין" },
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
            eps: m.epsTTM || m.epsExclExtraItemsAnnual || 0,
            roe: m.roeTTM || 0,
            debtToEquity: m.totalDebtToEquityAnnual || m.totalDebtToEquityQuarterly || 0,
            dividendYield: m.dividendYieldIndicatedAnnual || 0
        };

        const technicals = {
            ma50: Number(m['50DayMovingAverage'] || 0),
            ma200: Number(m['200DayMovingAverage'] || 0),
            volume: Number(quote?.v || m['10DayAverageTradingVolume'] || 0),
            trend: Number(quote?.c) > Number(m['50DayMovingAverage']) ? "שורית (מעל ממוצע 50)" : "דובית (מתחת לממוצע 50)"
        };

        const analystConsensus = recommendations && recommendations.length > 0 ? 
            `קנייה: ${recommendations[0].buy + recommendations[0].strongBuy}, החזקה: ${recommendations[0].hold}, מכירה: ${recommendations[0].sell}` : "אין קונצנזוס";

        const prompt = `אתה "הכריש" - אנליסט פיננסי בכיר מוול סטריט. נתח את מניית ${ticker} (${profile?.name}).
        
        נתוני אמת מהשוק (השתמש בהם בפסיקה שלך!):
        - מחיר נוכחי: $${quote?.c}
        - מגמה וממוצעים: ממוצע 50 יום: $${technicals.ma50}, ממוצע 200 יום: $${technicals.ma200}. (המגמה הנוכחית: ${technicals.trend}).
        - פונדמנטליים: מכפיל רווח (P/E): ${fundamentals.peRatio}, רווח למניה (EPS): ${fundamentals.eps}, ROE: ${fundamentals.roe}%.
        - דעת האנליסטים: ${analystConsensus}. מחיר יעד ממוצע בשוק: $${priceTargets?.targetMean || 'לא זמין'}.
        
        ספק את הניתוח המעמיק ביותר שאפשר, בפורמט JSON חוקי בלבד בעברית:
        "identity": "פרופיל החברה ומעמדה התחרותי.",
        "technical": "ניתוח טכני מעמיק: שלב את הממוצעים הנעים וציין במפורש תבנית טכנית שנוצרה (למשל: תעלה עולה, דגל שורי, התכנסות, ראש וכתפיים).",
        "news_analysis": "ניתוח מומנטום, התייחסות לדוחות אחרונים וסנטימנט כללי.",
        "summary": "השורה התחתונה שלך מחיבור כל הנתונים.",
        "verdict": "פסיקה נוקבת ומנומקת: קנייה, החזקה או מכירה.",
        "pros": ["נקודת חוזק 1", "נקודת חוזק 2", "נקודת חוזק 3"],
        "cons": ["נקודת תורפה/סיכון 1", "נקודת תורפה 2", "נקודת תורפה 3"],
        "pattern": "תבנית טכנית שזוהתה בגרף (2-3 מילים)",
        "price_target": "מחיר יעד ל-12 חודשים (חובה מספר טהור, למשל: 150)",
        "rating": "קנייה / החזקה / מכירה",
        "scores": { "growth": 1-100, "momentum": 1-100, "value": 1-100, "quality": 1-100 }`;

        const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const aiData = await aiResponse.json();
        let aiVerdict = {};
        try {
            let text = aiData.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
            aiVerdict = JSON.parse(text);
            
            // הגנה על מספר טהור למחיר היעד
            if (typeof aiVerdict.price_target === 'string') {
                const num = aiVerdict.price_target.replace(/[^0-9.]/g, '');
                aiVerdict.price_target = num ? Number(num) : Number(quote?.c || 0) * 1.1;
            }

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
