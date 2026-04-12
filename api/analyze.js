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

    const apiKey = process.env.GEMINI_API_KEY;
    const ticker = (req.query.ticker || req.query.symbol || "AAPL").toUpperCase().trim();

    try {
        // 1. נתונים מ-Finnhub (תמיד עובד)
        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${Math.floor(Date.now()/1000)-2592000}&to=${Math.floor(Date.now()/1000)}`)
        ]);

        // 2. ניסיון קריאה ל-Gemini בגרסה היציבה (v1 ולא v1beta)
        const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        
        const prompt = `נתח את ${ticker}. מחיר: ${quote?.c}$. תן JSON בעברית: identity, technical, news_analysis, verdict, price_target, rating, scores.`;

        const aiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            })
        });

        const aiData = await aiResponse.json();

        // אם גוגל מחזירה שגיאה, אנחנו לא עוצרים - אנחנו בודקים מה המודלים הזמינים
        if (!aiResponse.ok) {
            const listUrl = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;
            const listRes = await fetch(listUrl);
            const listData = await listRes.json();
            
            throw new Error(`
                גוגל חוסמת את המודל. 
                השגיאה: ${aiData.error?.message}
                מודלים שבאמת פתוחים לך: ${listData.models?.map(m => m.name).join(', ') || 'אין מודלים זמינים'}
            `);
        }

        const text = aiData.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();

        return res.status(200).json({
            success: true,
            marketData: { ticker, name: profile?.name || ticker, price: quote?.c, changePercentage: quote?.dp },
            chartHistory: (candles?.c || []).map((p, i) => ({ date: new Date(candles.t[i] * 1000).toISOString().split('T')[0], close: p })),
            aiVerdict: JSON.parse(text)
        });

    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            message: "שגיאה סופית",
            details: error.message
        });
    }
};
