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

        // --- 1. דף הבית: מדדי שוק ---
        if (action === 'market' || (!ticker && action !== 'analyze')) {
            const marketSymbols = ['SPY', 'QQQ', 'DIA', 'IWM']; 
            const quotes = await Promise.all(marketSymbols.map(s => fetchFinnhub('quote', `symbol=${s}`)));
            
            const indexes = marketSymbols.map((s, i) => {
                const dp = quotes[i]?.dp || 0;
                return {
                    symbol: s === 'SPY' ? 'S&P 500' : s === 'QQQ' ? 'NASDAQ' : s,
                    price: Number(quotes[i]?.c || 0), // מספר (ל-toFixed)
                    changesPercentage: String(dp) // טקסט (ל-replace) - זה מה שפתר את השגיאה!
                };
            });

            return res.status(200).json({
                success: true,
                version: "2026.FINAL.FIX", // סימן זיהוי שנדע שהקוד התעדכן
                marketData: {
                    indexes: indexes,
                    sectors: [
                        { sector: "Technology", changesPercentage: "1.2" },
                        { sector: "Energy", changesPercentage: "-0.5" }
                    ],
                    news: []
                }
            });
        }

        // --- 2. דף ניתוח: מניה ספציפית ---
        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${Math.floor(Date.now()/1000)-2592000}&to=${Math.floor(Date.now()/1000)}`)
        ]);

        if (!quote || !quote.c) throw new Error("Missing data");

        const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const prompt = `נתח את ${ticker}. מחיר: ${quote.c}$. החזר אך ורק JSON בעברית: identity, technical, news_analysis, summary, pros (array), cons (array), price_target, rating, scores (1-5).`;

        const aiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const aiData = await aiResponse.json();
        let aiVerdict = { summary: "מנתח...", pros: [], cons: [] };
        try {
            const text = aiData.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
            aiVerdict = JSON.parse(text);
        } catch (e) { console.error("AI Error"); }

        const currentDP = quote.dp || 0;

        return res.status(200).json({
            success: true,
            ticker: ticker,
            name: String(profile?.name || ticker),
            price: Number(quote.c || 0), // מספר
            changePercentage: String(currentDP), // טקסט
            marketData: {
                ticker: ticker,
                name: String(profile?.name || ticker),
                price: Number(quote.c || 0),
                changePercentage: String(currentDP)
            },
            verdict: aiVerdict,
            aiVerdict: aiVerdict,
            chartHistory: (candles?.c || []).map((p, i) => ({
                date: new Date(candles.t[i] * 1000).toISOString().split('T')[0],
                close: Number(p)
            }))
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
