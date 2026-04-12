const { GoogleGenerativeAI } = require("@google/generative-ai");

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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const ticker = req.query.ticker?.toUpperCase();
    const action = req.query.action;

    try {
        if (action === 'market') {
            const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'];
            const quotes = await Promise.all(symbols.map(s => fetchFinnhub('quote', `symbol=${s}`)));
            return res.status(200).json({ success: true, marketData: { indexes: symbols.map((s, i) => ({ symbol: s, price: quotes[i]?.c || 0, changesPercentage: quotes[i]?.dp || 0 })), sectors: [], news: [] } });
        }

        if (!ticker) return res.status(400).json({ success: false, message: "Missing ticker" });

        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${Math.floor(Date.now()/1000)-2592000}&to=${Math.floor(Date.now()/1000)}`)
        ]);

        if (!quote || !quote.c) throw new Error("מניה לא נמצאה ב-Finnhub");

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        // --- ניסיון ראשון עם השם הנפוץ ביותר ב-2026 ---
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // גרסה קלה ויציבה מאוד
        
        const prompt = `נתח את ${ticker}. מחיר: ${quote.c}$. החזר JSON בעברית: identity, technical, news_analysis, verdict, price_target, rating, scores.`;
        
        try {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text().replace(/```json|```/g, "").trim();
            
            return res.status(200).json({
                success: true,
                marketData: { ticker, name: profile?.name || ticker, price: quote.c, changePercentage: quote.dp },
                chartHistory: (candles?.c || []).map((p, i) => ({ date: new Date(candles.t[i] * 1000).toISOString().split('T')[0], close: p })),
                aiVerdict: JSON.parse(text)
            });
        } catch (aiError) {
            // אם יש 404, בוא נראה מה גוגל כן מרשה לנו
            console.error("AI Error:", aiError.message);
            throw new Error(`שגיאת מודל: ${aiError.message}. נסה להשתמש ב-API Key מ-AI Studio ולוודא Redeploy ב-Vercel.`);
        }

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
