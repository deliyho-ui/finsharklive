const { GoogleGenerativeAI } = require("@google/generative-ai");

// פונקציית עזר לשליפה מ-Finnhub
async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
}

module.exports = async function(req, res) {
    // הגדרות CORS הכרחיות ל-Vercel
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const ticker = req.query.ticker?.toUpperCase();
    const action = req.query.action;

    try {
        // 1. טיפול בנתוני שוק (דף הבית)
        if (action === 'market') {
            const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'];
            const quotes = await Promise.all(symbols.map(s => fetchFinnhub('quote', `symbol=${s}`)));
            
            return res.status(200).json({
                success: true,
                marketData: {
                    indexes: symbols.map((s, i) => ({
                        symbol: s,
                        price: quotes[i]?.c || 0,
                        changesPercentage: quotes[i]?.dp || 0
                    })),
                    sectors: [],
                    news: [] 
                }
            });
        }

        if (!ticker) {
            return res.status(400).json({ success: false, message: "Missing ticker" });
        }

        // 2. שליפת נתונים מ-Finnhub
        const to = Math.floor(Date.now() / 1000);
        const from = to - (30 * 24 * 60 * 60);

        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${from}&to=${to}`)
        ]);

        if (!quote || !quote.c) {
            throw new Error("מניה לא נמצאה");
        }

        const stockData = {
            ticker: ticker,
            name: profile?.name || ticker,
            price: quote.c,
            changePercentage: quote.dp,
            marketCap: profile?.marketCapitalization || 0,
            industry: profile?.finnhubIndustry || "N/A"
        };

        // 3. ניתוח AI עם Gemini 1.5 PRO - השם המדויק!
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-pro", 
            generationConfig: { responseMimeType: "application/json" }
        });
        
        const prompt = `אתה אנליסט בכיר. נתח את מניית ${ticker} (${stockData.name}). מחיר: ${stockData.price}$. החזר JSON בעברית עם המפתחות: identity (תיאור), technical (ניתוח טכני), news_analysis (פרשנות), verdict (pros, cons, summary), price_target (יעד לשנה), rating (דירוג), scores (ציון 1-100).`;

        const aiResult = await model.generateContent(prompt);
        const aiText = aiResult.response.text();
        
        return res.status(200).json({
            success: true,
            marketData: stockData,
            chartHistory: (candles?.c || []).map((p, i) => ({
                date: new Date(candles.t[i] * 1000).toISOString().split('T')[0],
                close: p
            })),
            aiVerdict: JSON.parse(aiText)
        });

    } catch (error) {
        console.error("Server Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};
