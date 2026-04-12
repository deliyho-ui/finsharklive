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
        const ticker = (req.query.ticker || req.query.symbol || "").toUpperCase().trim();
        if (!ticker) return res.status(400).json({ success: false, message: "Missing ticker" });

        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${Math.floor(Date.now()/1000)-2592000}&to=${Math.floor(Date.now()/1000)}`)
        ]);

        if (!quote || !quote.c) throw new Error("מניה לא נמצאה ב-Finnhub");

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const prompt = `אתה אנליסט מניות בכיר. נתח את ${ticker}. מחיר: ${quote.c}$. החזר JSON בעברית: identity, technical, news_analysis, verdict, price_target, rating, scores.`;

        // --- מנגנון ניסיונות חוזרים (Fallback) ---
        const modelsToTry = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-1.0-pro"];
        let lastError;
        let finalResponse;
        let modelUsed;

        for (const modelName of modelsToTry) {
            try {
                console.log(`Trying model: ${modelName}`);
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(prompt);
                finalResponse = await result.response;
                modelUsed = modelName;
                break; // אם הצלחנו, צא מהלולאה
            } catch (e) {
                console.error(`Failed with ${modelName}:`, e.message);
                lastError = e;
            }
        }

        if (!finalResponse) {
            throw new Error(`כל המודלים נכשלו. שגיאה אחרונה: ${lastError.message}`);
        }

        const text = finalResponse.text().replace(/```json|```/g, "").trim();
        
        return res.status(200).json({
            success: true,
            modelUsed: modelUsed, // נדע איזה מודל סוף סוף עבד
            marketData: { ticker, name: profile?.name || ticker, price: quote.c, changePercentage: quote.dp },
            chartHistory: (candles?.c || []).map((p, i) => ({ date: new Date(candles.t[i] * 1000).toISOString().split('T')[0], close: p })),
            aiVerdict: JSON.parse(text)
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: `Server Error: ${error.message}` });
    }
};
