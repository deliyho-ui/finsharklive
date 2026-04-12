async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    if (!token) return { error: "Missing API Key" };
    
    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : { error: `Status ${res.status}` };
    } catch (e) { return { error: e.message }; }
}

module.exports = async function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const ticker = (req.query.ticker || req.query.symbol || "").toUpperCase().trim();
        const action = req.query.action;

        // בדיקה אם המפתחות בכלל קיימים במערכת
        if (!process.env.FINNHUB_API_KEY) throw new Error("FINNHUB_API_KEY חסר ב-Vercel");
        if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY חסר ב-Vercel");

        if (action === 'market' || (!ticker && action !== 'analyze')) {
            const symbols = ['SPY', 'QQQ', 'DIA', 'IWM']; 
            const quotes = await Promise.all(symbols.map(s => fetchFinnhub('quote', `symbol=${s}`)));
            
            return res.status(200).json({
                success: true,
                marketData: {
                    indexes: symbols.map((s, i) => ({
                        symbol: s === 'SPY' ? 'S&P 500' : s === 'QQQ' ? 'NASDAQ' : s,
                        price: Number(quotes[i]?.c || 0),
                        changesPercentage: String(quotes[i]?.dp || "0")
                    })),
                    sectors: [],
                    news: []
                }
            });
        }

        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${Math.floor(Date.now()/1000)-2592000}&to=${Math.floor(Date.now()/1000)}`)
        ]);

        // אם quote חזר עם שגיאה או בלי מחיר
        if (!quote || quote.error || !quote.c) {
            throw new Error(`Finnhub error: ${quote?.error || "Ticker not found"}`);
        }

        const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const prompt = `נתח את ${ticker}. מחיר: ${quote.c}$. החזר אך ורק JSON בעברית: identity, technical, news_analysis, summary, pros (array), cons (array), price_target, rating, scores (1-5).`;

        const aiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const aiData = await aiResponse.json();
        if (!aiResponse.ok) throw new Error(`AI Error: ${aiData.error?.message}`);

        const text = aiData.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
        const aiVerdict = JSON.parse(text);

        return res.status(200).json({
            success: true,
            ticker: ticker,
            name: String(profile?.name || ticker),
            price: Number(quote.c || 0),
            changePercentage: String(quote.dp || "0"),
            marketData: {
                ticker: ticker,
                name: String(profile?.name || ticker),
                price: Number(quote.c || 0),
                changePercentage: String(quote.dp || "0")
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
