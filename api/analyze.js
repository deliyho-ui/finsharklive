const { GoogleGenerativeAI } = require("@google/generative-ai");

async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
}

module.exports = async function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const ticker = req.query.ticker?.toUpperCase();
    const action = req.query.action;

    try {
        if (action === 'market') {
            const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'];
            const quotes = await Promise.all(symbols.map(s => fetchFinnhub('quote', `symbol=${s}`)));
            return res.status(200).json({
                success: true,
                marketData: {
                    indexes: symbols.map((s, i) => ({
                        symbol: s, price: quotes[i]?.c || 0, changesPercentage: quotes[i]?.dp || 0
                    })),
                    sectors: [], news: [] 
                }
            });
        }

        if (!ticker) return res.status(400).json({ success: false, message: "Missing ticker" });

        const to = Math.floor(Date.now() / 1000);
        const from = to - (30 * 24 * 60 * 60);

        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${from}&to=${to}`)
        ]);

        if (!quote || !quote.c) throw new Error("מניה לא נמצאה");

        const stockData = {
            ticker: ticker,
            name: profile?.name || ticker,
            price: quote.c,
            changePercentage: quote.dp,
            marketCap: profile?.marketCapitalization || 0,
            industry: profile?.finnhubIndustry || "N/A"
        };

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        // מעבר למודל PRO לניתוח מעמיק ומדויק יותר
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-pro-latest",
            generationConfig: { responseMimeType: "application/json" }
        });
        
        const prompt = `אתה אנליסט שוק הון בכיר. נתח לעומק את מניית ${ticker} (${stockData.name}) מתחום ה-${stockData.industry}. 
        נתונים נוכחיים: מחיר ${stockData.price}$, שינוי יומי: ${stockData.changePercentage}%.
        בצע ניתוח פונדמנטלי וטכני מקיף. היה ביקורתי ואל תחשוש לציין סיכונים.
        החזר JSON בעברית עם המפתחות: 
        identity (תיאור החברה והמודל העסקי), 
        technical (מגמות מחיר ורמות תמיכה/התנגדות), 
        news_analysis (פרשנות על סמך הידע המעודכן שלך על מצב השוק), 
        verdict (pros - רשימת יתרונות, cons - רשימת סיכונים, summary - סיכום סופי), 
        price_target (הערכת מחיר יעד לשנה), 
        rating (Strong Buy/Buy/Hold/Sell/Strong Sell), 
        scores (ציון משוקלל 1-100).`;

        const aiResult = await model.generateContent(prompt);
        
        return res.status(200).json({
            success: true,
            marketData: stockData,
            chartHistory: (candles?.c || []).map((p, i) => ({
                date: new Date(candles.t[i] * 1000).toISOString().split('T')[0],
                close: p
            })),
            aiVerdict: JSON.parse(aiResult.response.text())
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
