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
            
            const indexes = marketSymbols.map((s, i) => ({
                symbol: s === 'SPY' ? 'S&P 500' : s === 'QQQ' ? 'NASDAQ' : s,
                price: Number(quotes[i]?.c || 0), 
                // אנחנו שולחים את זה גם כמספר וגם כטקסט מוסתר כדי למנוע קריסה
                changesPercentage: Number(quotes[i]?.dp || 0) 
            }));

            return res.status(200).json({
                success: true,
                marketData: {
                    indexes: indexes,
                    sectors: [],
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

        if (!quote || !quote.c) throw new Error("נתוני מניה לא נמצאו");

        const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const prompt = `נתח את ${ticker}. מחיר: ${quote.c}$. החזר אך ורק JSON תקני בעברית עם המפתחות: identity, technical, news_analysis, summary, pros (array), cons (array), price_target, rating, scores (object with numbers 1-5). ללא טקסט נוסף לפני או אחרי.`;

        const aiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const aiData = await aiResponse.json();
        let aiVerdict = { summary: "לא ניתן לנתח כרגע", pros: [], cons: [] };
        
        try {
            let rawText = aiData.candidates[0].content.parts[0].text;
            // ניקוי JSON אגרסיבי במיוחד
            const jsonStart = rawText.indexOf('{');
            const jsonEnd = rawText.lastIndexOf('}') + 1;
            if (jsonStart !== -1 && jsonEnd !== -1) {
                rawText = rawText.substring(jsonStart, jsonEnd);
            }
            aiVerdict = JSON.parse(rawText);
        } catch (e) {
            console.error("AI Parse Error:", e);
        }

        return res.status(200).json({
            success: true,
            ticker: ticker,
            name: String(profile?.name || ticker),
            price: Number(quote.c || 0),
            changePercentage: Number(quote.dp || 0),
            marketData: {
                ticker: ticker,
                name: String(profile?.name || ticker),
                price: Number(quote.c || 0),
                changePercentage: Number(quote.dp || 0)
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
