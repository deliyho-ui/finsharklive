async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch (e) { return null; }
}

// משיכת גרף + VIX אמיתי מיאהו פייננס
async function fetchYahooData(ticker, range = "6mo") {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
        const res = await fetch(url);
        const data = await res.json();
        const result = data.chart.result[0];
        const timestamps = result.timestamp;
        const quotes = result.indicators.quote[0];
        
        return timestamps.map((t, i) => ({
            date: new Date(t * 1000).toISOString().split('T')[0],
            open: Number(quotes.open[i]),
            high: Number(quotes.high[i]),
            low: Number(quotes.low[i]),
            close: Number(quotes.close[i]),
            value: Number(quotes.close[i]), // תאימות לאחור
            volume: Number(quotes.volume[i])
        })).filter(p => !isNaN(p.close));
    } catch (e) { return []; }
}

// חילוץ ה-VIX האמיתי
async function getRealVix() {
    try {
        const data = await fetchYahooData('^VIX', '5d');
        const latest = data[data.length - 1];
        return latest ? latest.close : 20; 
    } catch(e) { return null; }
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

        // --- 1. דף הבית ---
        if (action === 'market' || (!ticker && action !== 'analyze')) {
            const [spy, qqq, dia, iwm, newsData, realVix] = await Promise.all([
                fetchFinnhub('quote', 'symbol=SPY'),
                fetchFinnhub('quote', 'symbol=QQQ'),
                fetchFinnhub('quote', 'symbol=DIA'),
                fetchFinnhub('quote', 'symbol=IWM'),
                fetchFinnhub('news', 'category=general'), // Finnhub business news
                getRealVix()
            ]);

            // נוסחת VIX מדויקת: 20 זה נייטרלי (50). כל נקודה למטה זה חמדנות, למעלה זה פחד.
            const vixValue = realVix || 20;
            let fearGreedScore = 100 - (vixValue * 2.5);
            fearGreedScore = Math.max(0, Math.min(100, fearGreedScore));
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
                    // סידור התאריך לפורמט שהאתר שלך אוהב
                    news: (newsData || []).slice(0, 5).map(item => ({
                        title: item.headline,
                        url: item.url,
                        source: item.source,
                        publishedAt: item.datetime * 1000, 
                        date: new Date(item.datetime * 1000).toISOString()
                    }))
                }
            });
        }

        // --- 2. דף ניתוח חכם מבוסס נתונים ---
        const [quote, profile, chartPoints, metricsData] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchYahooData(ticker, '1y'), 
            fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`)
        ]);

        // מיפוי מדויק של הפונדמנטליים לטבלה באתר
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

        // הזרקת הנתונים למוח של ה-AI
        const prompt = `אתה אנליסט מניות. נתח את ${ticker}.
        נתונים פיננסיים עדכניים לשימוש בניתוח שלך:
        - מחיר נוכחי: ${quote?.c}$
        - מכפיל רווח (P/E): ${fundamentals.peRatio}
        - רווח למניה (EPS): ${fundamentals.eps}
        - טווח 52 שבועות: ${fundamentals.fiftyTwoWeekLow}$ עד ${fundamentals.fiftyTwoWeekHigh}$
        - תשואה להון (ROE): ${fundamentals.roe}%
        
        החזר אובייקט JSON בעברית בלבד! חובה להשתמש במפתחות האלו בדיוק כטקסט פשוט:
        {
          "identity": "תיאור החברה",
          "technical": "ניתוח טכני",
          "news_analysis": "ניתוח חדשות",
          "summary": "השורה התחתונה",
          "verdict": "פסיקה סופית - קנייה, החזקה או מכירה ולמה",
          "pros": ["יתרון 1", "יתרון 2"],
          "cons": ["חיסרון 1", "חיסרון 2"],
          "price_target": "מספר בלבד (למשל 150)",
          "rating": "קנייה / החזקה / מכירה",
          "scores": { "growth": 80, "momentum": 75, "value": 60, "quality": 90 }
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
            
            // וידוא שהמחיר יעד הוא מספר כדי למנוע NaN%
            if (typeof aiVerdict.price_target === 'string') {
                const num = aiVerdict.price_target.replace(/[^0-9.]/g, '');
                aiVerdict.price_target = num ? Number(num) : Number(quote?.c || 0) * 1.1;
            }

            // גיבוי למפתחות שהתבנית מחפשת
            aiVerdict.positive = aiVerdict.pros || [];
            aiVerdict.negative = aiVerdict.cons || [];
        } catch (e) { aiVerdict = { summary: "שגיאה בפענוח הניתוח" }; }

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
            fundamentals: fundamentals,
            metrics: fundamentals,
            verdict: aiVerdict,
            aiVerdict: aiVerdict,
            chartData: chartPoints,
            chartHistory: chartPoints
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
