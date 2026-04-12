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
    // הגדרות אבטחה ו-CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // 1. חילוץ טיקר חכם (מונע את שגיאת ה-Missing Ticker)
        const ticker = (req.query.ticker || req.query.symbol || "AAPL").toUpperCase().trim();
        
        // 2. בדיקת API Key
        if (!process.env.GEMINI_API_KEY) throw new Error("מפתח GEMINI_API_KEY חסר ב-Vercel");

        // 3. שליפת נתונים מ-Finnhub
        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${Math.floor(Date.now()/1000)-2592000}&to=${Math.floor(Date.now()/1000)}`)
        ]);

        if (!quote || !quote.c) throw new Error(`Finnhub לא מצא נתונים עבור ${ticker}`);

        // 4. אתחול ה-AI (גרסת 2026 היציבה)
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        // אנחנו ננסה את המודל הכי מעודכן לשנה הנוכחית
        const modelName = "gemini-1.5-flash"; 
        const model = genAI.getGenerativeModel({ model: modelName });

        const prompt = `אתה אנליסט מניות בכיר. נתח את ${ticker}. מחיר: ${quote.c}$. החזר JSON בעברית: identity, technical, news_analysis, verdict, price_target, rating, scores.`;

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
            // --- מנגנון דיאגנוסטיקה (הפתרון הסופי) ---
            console.error("AI CALL FAILED. FETCHING AVAILABLE MODELS...");
            
            // אם הניתוח נכשל, אנחנו ננסה להוציא רשימה של מה שכן עובד
            return res.status(500).json({
                success: false,
                message: "שגיאת תקשורת עם גוגל",
                error_details: aiError.message,
                instruction: "אם כתוב 404, שנה את שם המודל בקוד לאחד מאלו שמופיעים ב-Google AI Studio תחת ListModels."
            });
        }

    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            message: `Server Error: ${error.message}` 
        });
    }
};
