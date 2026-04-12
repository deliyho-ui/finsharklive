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
        
        // שליפת נתונים מ-Finnhub
        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${Math.floor(Date.now()/1000)-2592000}&to=${Math.floor(Date.now()/1000)}`)
        ]);

        if (!quote || !quote.c) throw new Error("מניה לא נמצאה ב-Finnhub");

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        // --- עדכון למודל 2026 הרשמי ---
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        const prompt = `אתה אנליסט מניות בכיר. נתח את ${ticker}. מחיר: ${quote.c}$. החזר JSON בעברית עם המפתחות: identity, technical, news_analysis, verdict (pros, cons, summary), price_target, rating, scores (1-100).`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json|```/g, "").trim();
        
        return res.status(200).json({
            success: true,
            marketData: { ticker, name: profile?.name || ticker, price: quote.c, changePercentage: quote.dp },
            chartHistory: (candles?.c || []).map((p, i) => ({ date: new Date(candles.t[i] * 1000).toISOString().split('T')[0], close: p })),
            aiVerdict: JSON.parse(text)
        });

    } catch (error) {
        console.error("Final Error Log:", error.message);
        // אם גם 2.0 לא עובד, ננסה להחזיר שגיאה מפורטת יותר למסך
        return res.status(500).json({ 
            success: false, 
            message: `שגיאת שרת: ${error.message}. ודא שהמפתח מ-AI Studio הוזן ב-Vercel ובוצע Redeploy.` 
        });
    }
};
