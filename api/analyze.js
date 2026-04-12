const { GoogleGenerativeAI } = require("@google/generative-ai");

// פונקציית עזר לשליפה מ-Finnhub
async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch (e) { 
        console.error(`Finnhub Error (${endpoint}):`, e.message);
        return null; 
    }
}

module.exports = async function(req, res) {
    // הגדרות CORS ל-Vercel
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // גמישות בפרמטרים: בודק גם ticker וגם symbol
        const ticker = (req.query.ticker || req.query.symbol || "").toUpperCase().trim();
        const action = req.query.action;

        // 1. טיפול בדף הבית (Market Data)
        if (action === 'market' || (!ticker && action !== 'analyze')) {
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

        // אם הגענו לניתוח ואין טיקר
        if (!ticker) {
            return res.status(400).json({ success: false, message: "נא להזין סימול מניה (Ticker)" });
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
            throw new Error(`המניה ${ticker} לא נמצאה. ודא שהסימול תקין.`);
        }

        const stockData = {
            ticker: ticker,
            name: profile?.name || ticker,
            price: quote.c,
            changePercentage: quote.dp,
            marketCap: profile?.marketCapitalization || 0,
            industry: profile?.finnhubIndustry || "N/A"
        };

        // 3. ניתוח AI עם Gemini
        if (!process.env.GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // השם הכי יציב ב-2026 למפתחים
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });
        
        const prompt = `אתה אנליסט מניות בכיר. נתח את ${ticker} (${stockData.name}). מחיר: ${stockData.price}$. החזר JSON בלבד בעברית עם המפתחות: identity, technical, news_analysis, verdict (אובייקט עם pros, cons, summary), price_target, rating, scores (1-100).`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();
        
        // ניקוי תגיות קוד אם ה-AI הוסיף אותן בטעות
        text = text.replace(/```json|```/g, "").trim();
        
        // 4. שליחת התשובה
        return res.status(200).json({
            success: true,
            marketData: stockData,
            chartHistory: (candles?.c || []).map((p, i) => ({
                date: new Date(candles.t[i] * 1000).toISOString().split('T')[0],
                close: p
            })),
            aiVerdict: JSON.parse(text)
        });

    } catch (error) {
        console.error("Vercel Server Error:", error.message);
        return res.status(500).json({ 
            success: false, 
            message: error.message || "שגיאת שרת פנימית" 
        });
    }
};
