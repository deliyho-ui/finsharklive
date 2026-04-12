async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch (e) { return null; }
}

// משיכת גרף ישירות מיאהו פייננס עם User-Agent למניעת חסימות
async function fetchYahooData(ticker, range = "1mo") {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
            value: Number(quotes.close[i]),
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

        // ==========================================
        // 1. דף הבית (Dashboard)
        // ==========================================
        if (action === 'market' || (!ticker && action !== 'analyze')) {
            const [spy, qqq, dia, iwm, newsData, realVix] = await Promise.all([
                fetchFinnhub('quote', 'symbol=SPY'),
                fetchFinnhub('quote', 'symbol=QQQ'),
                fetchFinnhub('quote', 'symbol=DIA'),
                fetchFinnhub('quote', 'symbol=IWM'),
                fetchFinnhub('news', 'category=business'), 
                getRealVix()
            ]);

            // נוסחת הפחד והחמדנות - מדויק למציאות:
            // VIX נמוך (12) = 92 (חמדנות). VIX גבוה (35) = 0 (פחד קיצוני).
            const vixValue = realVix || 20;
            let fearGreedScore = Math.round(100 - ((vixValue - 10) / 25) * 100);
            fearGreedScore = Math.max(0, Math.min(100, fearGreedScore));
            const sentiment = fearGreedScore > 60 ? "חמדנות" : fearGreedScore < 40 ? "פחד" : "נייטרלי";

            return res.status(200).json({
                success: true,
                marketData: {
                    indexes: [
                        { symbol: 'S&P 500', price: Number(spy?.c || 0), changesPercentage: Number(spy?.dp || 0) },
                        { symbol: 'NASDAQ', price: Number(qqq?.c || 0), changesPercentage: Number(qqq?.dp || 0) },
                        { symbol: 'DOW 30', price: Number(dia?.c || 0), changesPercentage: Number(dia?.dp || 0) },
                        { symbol: 'RUSSELL 2000', price: Number(iwm?.c || 0), changesPercentage: Number(iwm?.dp || 0) }
                    ],
                    vix: { value: fearGreedScore, score: fearGreedScore, sentiment: sentiment },
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
        // 2. דף ניתוח מניה (AI Analysis)
        // ==========================================
        const [quote, profile, chartPoints, metricsData] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchYahooData(ticker, '1y'), // שולף שנה אחורה כדי שלגרף יהיה בשר
            fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`)
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

        const prompt = `אתה מומחה להשקעות. נתח את ${ticker}.
        נתונים כלכליים לניתוח: מחיר: ${quote?.c}$, P/E: ${fundamentals.peRatio}, EPS: ${fundamentals.eps}, ROE: ${fundamentals.roe}%, יחס חוב להון: ${fundamentals.debtToEquity}.
        
        החזר אך ורק אובייקט JSON בעברית עם המפתחות:
        "identity", "technical", "news_analysis", "summary", "verdict", "pros" (מערך מחרוזות), "cons" (מערך מחרוזות), "price_target" (מספר בלבד), "rating".
        בתוך "scores" החזר מספרים 1-100: "growth", "momentum", "value", "quality"`;

        const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const aiData = await aiResponse.json();
        let aiVerdict = {};
        
        try {
            let text = aiData.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
            aiVerdict = JSON.parse(text);
            
            // מנקה את מחיר היעד כדי שיהיה מספר טהור
            if (typeof aiVerdict.price_target === 'string') {
                const num = aiVerdict.price_target.replace(/[^0-9.]/g, '');
                aiVerdict.price_target = num ? Number(num) : Number(quote?.c || 0) * 1.1;
            }

            // הפצצת מפתחות: משכפל את הנתונים לכל שם אפשרי שהפרונט-אנד עלול לחפש
            aiVerdict.bottomLine = aiVerdict.summary || aiVerdict.verdict;
            aiVerdict.verdict = aiVerdict.verdict || aiVerdict.summary;
            aiVerdict.positive = aiVerdict.pros || [];
            aiVerdict.strengths = aiVerdict.pros || [];
            aiVerdict.negative = aiVerdict.cons || [];
            aiVerdict.weaknesses = aiVerdict.cons || [];
            
            const s = aiVerdict.scores || {};
            aiVerdict.scores = {
                growth: s.growth || 50, momentum: s.momentum || 50, value: s.value || 50, quality: s.quality || 50
            };
        } catch (e) { 
            aiVerdict = { bottomLine: "הניתוח נכשל", verdict: "הניתוח נכשל", pros: [], cons: [] }; 
        }

        // מחזיר את הנתונים - הפונדמנטליים נשלחים גם בשורש וגם בתוך האובייקטים
        return res.status(200).json({
            success: true,
            ticker: ticker,
            name: String(profile?.name || ticker),
            industry: String(profile?.finnhubIndustry || "Technology"),
            price: Number(quote?.c || 0),
            changePercentage: Number(quote?.dp || 0),
            ...fundamentals, 
            marketData: {
                ticker: ticker,
                name: String(profile?.name || ticker),
                price: Number(quote?.c || 0),
                changePercentage: Number(quote?.dp || 0),
                ...fundamentals 
            },
            fundamentals: fundamentals,
            metrics: fundamentals,
            companyProfile: fundamentals,
            verdict: aiVerdict,
            aiVerdict: aiVerdict,
            chartData: chartPoints,
            chartHistory: chartPoints
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
