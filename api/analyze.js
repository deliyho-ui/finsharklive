async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch (e) { return null; }
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

        // --- 1. דף הבית: מדדי שוק, VIX וחדשות ---
        if (action === 'market' || (!ticker && action !== 'analyze')) {
            const [spy, qqq, dia, iwm, vix, news, xlk, xlf, xle] = await Promise.all([
                fetchFinnhub('quote', 'symbol=SPY'),
                fetchFinnhub('quote', 'symbol=QQQ'),
                fetchFinnhub('quote', 'symbol=DIA'),
                fetchFinnhub('quote', 'symbol=IWM'),
                fetchFinnhub('quote', 'symbol=VIX'), 
                fetchFinnhub('news', 'category=general'),
                fetchFinnhub('quote', 'symbol=XLK'), 
                fetchFinnhub('quote', 'symbol=XLF'), 
                fetchFinnhub('quote', 'symbol=XLE')  
            ]);

            const vixValue = vix?.c || 20;
            const fearGreedScore = Math.max(5, Math.min(95, 100 - (vixValue * 2.5)));
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
                        // התיקון: הפכנו את הסקטורים ל-String במקום Number כדי שה-replace יעבוד
                        { sector: "טכנולוגיה", changesPercentage: String(xlk?.dp || "0") },
                        { sector: "פיננסים", changesPercentage: String(xlf?.dp || "0") },
                        { sector: "אנרגיה", changesPercentage: String(xle?.dp || "0") }
                    ],
                    news: (news || []).slice(0, 5).map(item => ({
                        title: item.headline,
                        url: item.url,
                        source: item.source,
                        time: new Date(item.datetime * 1000).toLocaleTimeString('he-IL')
                    }))
                }
            });
        }

        // --- 2. דף ניתוח: מניה ספציפית ---
        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${Math.floor(Date.now()/1000)-31536000}&to=${Math.floor(Date.now()/1000)}`)
        ]);

        const prompt = `נתח את ${ticker}. מחיר: ${quote?.c || 0}$. החזר JSON בעברית עם המפתחות: identity, technical, news_analysis, summary, verdict, pros (array), cons (array), price_target, rating. בתוך scores החזר אובייקט עם המפתחות: financial_health, growth_potential, competitive_moat, valuation, innovation_potential (ערכים 1-100). אל תוסיף שום מילה לפני או אחרי.`;

        const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const aiData = await aiResponse.json();
        let aiVerdict = {};
        try {
            let text = aiData.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
            aiVerdict = JSON.parse(text);
        } catch (e) { aiVerdict = { summary: "ניתוח AI לא זמין" }; }

        const chartPoints = (candles?.c || []).map((p, i) => ({
            date: new Date(candles.t[i] * 1000).toISOString().split('T')[0],
            value: Number(p),
            close: Number(p)
        }));

        // התיקון: החזרתי את אובייקט marketData שהיה חסר ומנע מהדף להיטען
        return res.status(200).json({
            success: true,
            ticker: ticker,
            name: String(profile?.name || ticker),
            industry: String(profile?.finnhubIndustry || "N/A"),
            price: Number(quote?.c || 0),
            changePercentage: Number(quote?.dp || 0),
            marketData: {
                ticker: ticker,
                name: String(profile?.name || ticker),
                price: Number(quote?.c || 0),
                changePercentage: Number(quote?.dp || 0)
            },
            verdict: aiVerdict,
            aiVerdict: aiVerdict,
            chartData: chartPoints,
            chartHistory: chartPoints
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
