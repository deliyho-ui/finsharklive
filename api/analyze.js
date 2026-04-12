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
        const ticker = (req.query.ticker || req.query.symbol || "AAPL").toUpperCase().trim();
        
        // שליפת נתונים בסיסית מ-Finnhub
        const [quote, profile] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`)
        ]);

        if (!quote || !quote.c) throw new Error("Finnhub data missing");

        // אתחול ג'מיני
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        // ב-2026, לפעמים צריך להוריד את ה-v1beta מהראש. המודל הזה הוא הכי יציב:
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const prompt = `נתח את ${ticker}. מחיר: ${quote.c}$. החזר JSON בעברית: identity, technical, news_analysis, verdict, price_target, rating, scores.`;
        
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, "").trim();
        
        return res.status(200).json({
            success: true,
            debug: {
                version: "3.0-FINAL-CHECK", // חותמת זיהוי
                timestamp: new Date().toISOString(),
                model: "gemini-1.5-flash"
            },
            marketData: { ticker, name: profile?.name || ticker, price: quote.c, changePercentage: quote.dp },
            aiVerdict: JSON.parse(text)
        });

    } catch (error) {
        // אם זה נופל, לפחות נדע למה
        return res.status(500).json({ 
            success: false, 
            message: `Error: ${error.message}`,
            suggestion: "ודא שהמפתח הופק ב-aistudio.google.com ולא ב-Cloud Console."
        });
    }
};
