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

        // --- חלק 1: נתוני שוק לדף הבית (במקום FMP) ---
        if (action === 'market' || (!ticker && action !== 'analyze')) {
            // רשימת מדדים מובילים (תעודות סל שקולות למדדים)
            const marketSymbols = ['SPY', 'QQQ', 'DIA', 'IWM']; 
            const quotes = await Promise.all(marketSymbols.map(s => fetchFinnhub('quote', `symbol=${s}`)));
            
            return res.status(200).json({
                success: true,
                // האתר מצפה למבנה כזה עבור המדדים למעלה
                indexes: marketSymbols.map((s, i) => ({
                    symbol: s === 'SPY' ? 'S&P 500' : s === 'QQQ' ? 'NASDAQ' : s,
                    price: quotes[i]?.c || 0,
                    changesPercentage: quotes[i]?.dp || 0
                })),
                // מפת חום סקטוריאלית (Finnhub לא נותן את זה בחינם, אז נשלח מערך ריק כדי שלא יקרוס)
                sectors: [],
                news: []
            });
        }

        // --- חלק 2: ניתוח מניה ספציפית ---
        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${Math.floor(Date.now()/1000)-2592000}&to=${Math.floor(Date.now()/1000)}`)
        ]);

        if (!quote || !quote.c) throw new Error("Finnhub failed for " + ticker);

        const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const prompt = `אתה אנליסט מניות. נתח את ${ticker}. מחיר: ${quote.c}$. החזר JSON בעברית: identity, technical, news_analysis, summary, pros (array), cons (array), price_target, rating, scores (1-5).`;

        const aiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const aiData = await aiResponse.json();
        let aiVerdict = {};
        try {
            const text = aiData.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
            aiVerdict = JSON.parse(text);
        } catch (e) { aiVerdict = { summary: "שגיאה בניתוח ה-AI" }; }

        return res.status(200).json({
            success: true,
            ticker: ticker,
            name: profile?.name || ticker,
            price: quote?.c || 0,
            changePercentage: quote?.dp || 0,
            marketData: {
                ticker: ticker,
                name: profile?.name || ticker,
                price: quote?.c || 0,
                changePercentage: quote?.dp || 0
            },
            verdict: aiVerdict,
            aiVerdict: aiVerdict,
            chartData: (candles?.c || []).map((p, i) => ({
                date: new Date(candles.t[i] * 1000).toISOString().split('T')[0],
                value: p
            }))
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
