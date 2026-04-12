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
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const ticker = req.query.ticker?.toUpperCase();
        if (!ticker) return res.status(400).json({ success: false, message: "Missing ticker" });

        // 1. נתונים מ-Finnhub
        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${Math.floor(Date.now()/1000)-2592000}&to=${Math.floor(Date.now()/1000)}`)
        ]);

        if (!quote || !quote.c) throw new Error("מניה לא נמצאה ב-Finnhub. ודא שה-API Key תקין.");

        // 2. ניתוב ל-Gemini
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        // ננסה קודם את המודל הכי עדכני ל-2026
        let model;
        try {
            model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        } catch (e) {
            // אם 2.0 לא זמין, נחזור ל-1.5 היציב
            model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        }
        
        const prompt = `נתח את ${ticker}. מחיר: ${quote.c}$. החזר JSON בלבד בעברית: identity, technical, news_analysis, verdict (pros, cons, summary), price_target, rating, scores.`;
        
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, "").trim();
        
        return res.status(200).json({
            success: true,
            marketData: { ticker, name: profile?.name || ticker, price: quote.c, changePercentage: quote.dp },
            chartHistory: (candles?.c || []).map((p, i) => ({ date: new Date(candles.t[i] * 1000).toISOString().split('T')[0], close: p })),
            aiVerdict: JSON.parse(text)
        });

    } catch (error) {
        // כאן אנחנו נותנים שגיאה מפורטת שתעזור לנו להבין אם זה מפתח או מודל
        return res.status(500).json({ 
            success: false, 
            message: `שגיאה: ${error.message}. בדוק את ה-Logs ב-Vercel.` 
        });
    }
};
