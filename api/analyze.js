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
        const ticker = (req.query.ticker || req.query.symbol || "AAPL").toUpperCase().trim();
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) throw new Error("Missing GEMINI_API_KEY in Vercel settings");

        // 1. נתונים מ-Finnhub
        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${Math.floor(Date.now()/1000)-2592000}&to=${Math.floor(Date.now()/1000)}`)
        ]);

        if (!quote || !quote.c) throw new Error("Finnhub failed to find " + ticker);

        // 2. קריאה ישירה ל-Gemini (ללא SDK)
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        
        const prompt = `נתח את המניה ${ticker}. מחיר: ${quote.c}$. תן JSON בעברית עם המפתחות: identity, technical, news_analysis, verdict (pros, cons, summary), price_target, rating, scores (1-100).`;

        const aiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            })
        });

        const aiData = await aiResponse.json();

        if (!aiResponse.ok) {
            throw new Error(`Google API Error: ${aiData.error?.message || 'Unknown error'}`);
        }

        const text = aiData.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();

        return res.status(200).json({
            success: true,
            marketData: { ticker, name: profile?.name || ticker, price: quote.c, changePercentage: quote.dp },
            chartHistory: (candles?.c || []).map((p, i) => ({ 
                date: new Date(candles.t[i] * 1000).toISOString().split('T')[0], 
                close: p 
            })),
            aiVerdict: JSON.parse(text)
        });

    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
};
