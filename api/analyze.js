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
        const action = req.query.action;
        const apiKey = process.env.GEMINI_API_KEY;

        // --- 1. דף הבית: מדדי שוק ---
        if (action === 'market' || (!ticker && action !== 'analyze')) {
            const [spy, qqq, dia, iwm, news] = await Promise.all([
                fetchFinnhub('quote', 'symbol=SPY'),
                fetchFinnhub('quote', 'symbol=QQQ'),
                fetchFinnhub('quote', 'symbol=DIA'),
                fetchFinnhub('quote', 'symbol=IWM'),
                fetchFinnhub('news', 'category=general')
            ]);

            // חישוב מדד פחד/חמדנות דינמי על בסיס ה-S&P 500 (תחליף למגבלת חינם של VIX)
            const spyChange = spy?.dp || 0;
            let fearGreedScore = 50 + (spyChange * 15); 
            fearGreedScore = Math.max(10, Math.min(90, fearGreedScore)); 
            const sentiment = fearGreedScore > 60 ? "חמדנות" : fearGreedScore < 40 ? "פחד" : "נייטרלי";

            const indexes = [
                { symbol: 'S&P 500', price: Number(spy?.c || 0), changesPercentage: Number(spy?.dp || 0) },
                { symbol: 'NASDAQ', price: Number(qqq?.c || 0), changesPercentage: Number(qqq?.dp || 0) },
                { symbol: 'DOW 30', price: Number(dia?.c || 0), changesPercentage: Number(dia?.dp || 0) },
                { symbol: 'RUSSELL 2000', price: Number(iwm?.c || 0), changesPercentage: Number(iwm?.dp || 0) }
            ];

            return res.status(200).json({
                success: true,
                marketData: {
                    indexes: indexes,
                    vix: { value: fearGreedScore.toFixed(0), sentiment: sentiment },
                    // שימוש ב-QQQ ו-DIA כפרוקסי לסקטורים כדי להבטיח נתונים בחינם כטקסט
                    sectors: [
                        { sector: "טכנולוגיה", changesPercentage: String(qqq?.dp || "0") },
                        { sector: "תעשייה", changesPercentage: String(dia?.dp || "0") },
                        { sector: "כללי", changesPercentage: String(spy?.dp || "0") }
                    ],
                    news: (news || []).slice(0, 5).map(item => ({
                        title: item.headline,
                        url: item.url,
                        source: item.source,
                        time: new Date(item.datetime * 1000).toLocaleTimeString('he-IL')
                    }))
                }
            });
        }

        // --- 2. דף ניתוח: מניה ספציפית ---
        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            // שינוי הטווח לחצי שנה כדי שהגרף יעבוד בגרסה החינמית
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${Math.floor(Date.now()/1000)-15552000}&to=${Math.floor(Date.now()/1000)}`)
        ]);

        const prompt = `נתח את המניה ${ticker}. מחיר נוכחי: ${quote?.c || 0}$.
        חובה להחזיר אובייקט JSON חוקי בלבד, לפי המבנה הבא בדיוק! אסור להשתמש בתתי-אובייקטים (מלבד scores). כל הערכים (למעט ציונים) חייבים להיות מחרוזות טקסט (String) פשוטות עם משפט אחד או שניים!
        {
          "identity": "טקסט פשוט המתאר את החברה",
          "technical": "טקסט פשוט המתאר ניתוח טכני",
          "news_analysis": "טקסט פשוט של חדשות אחרונות",
          "summary": "טקסט פשוט של שורה תחתונה",
          "verdict": "טקסט פשוט של שורה תחתונה",
          "pros": ["נקודת חוזק 1", "נקודת חוזק 2"],
          "cons": ["נקודת חולשה 1", "נקודת חולשה 2"],
          "price_target": "מחיר יעד",
          "rating": "קנייה / החזקה / מכירה",
          "scores": {
            "financial_health": 80,
            "growth_potential": 90,
            "competitive_moat": 85,
            "valuation": 70,
            "innovation_potential": 95
          }
        }`;

        const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const aiData = await aiResponse.json();
        let aiVerdict = {};
        try {
            let text = aiData.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
            aiVerdict = JSON.parse(text);
            
            // הגנת ברזל: חילוץ טקסט למקרה שה-AI שוב מחזיר אובייקטים מקוננים
            ["identity", "technical", "news_analysis", "summary", "verdict"].forEach(key => {
                if (typeof aiVerdict[key] === 'object' && aiVerdict[key] !== null) {
                    aiVerdict[key] = aiVerdict[key].summary || aiVerdict[key].analysis || aiVerdict[key].description || "מידע זמין בניתוח המלא";
                }
            });

        } catch (e) { aiVerdict = { summary: "ניתוח AI לא זמין כרגע" }; }

        const chartPoints = (candles?.c || []).map((p, i) => ({
            date: new Date(candles.t[i] * 1000).toISOString().split('T')[0],
            value: Number(p),
            close: Number(p)
        }));

        return res.status(200).json({
            success: true,
            ticker: ticker,
            name: String(profile?.name || ticker),
            industry: String(profile?.finnhubIndustry || "N/A"),
            price: Number(quote?.c || 0),
            changePercentage: Number(quote?.dp || 0),
            marketData: {
                ticker: ticker,
                name: String(profile?.name || ticker),
                price: Number(quote?.c || 0),
                changePercentage: Number(quote?.dp || 0)
            },
            verdict: aiVerdict,
            aiVerdict: aiVerdict,
            chartData: chartPoints,
            chartHistory: chartPoints
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
