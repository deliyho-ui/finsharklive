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

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    try {
        // --- שלב הדיאגנוסטיקה: בדיקה מה גוגל מרשה לנו ---
        // אנחנו ננסה למשוך את רשימת המודלים הזמינים באמת
        const ticker = (req.query.ticker || "AAPL").toUpperCase();

        const [quote, profile] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`)
        ]);

        // נסיון ישיר עם הנתיב המלא (לפעמים ב-2026 זה מה שפותר את זה)
        const model = genAI.getGenerativeModel({ model: "models/gemini-1.5-flash" });
        
        const prompt = `נתח בקצרה את ${ticker}. החזר JSON: { "summary": "טקסט" }`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        
        return res.status(200).json({
            success: true,
            message: "הצלחנו!",
            data: JSON.parse(response.text().replace(/```json|```/g, ""))
        });

    } catch (error) {
        console.error("DIAGNOSTIC ERROR:", error.message);
        
        // אם זה נכשל, אנחנו מחזירים תשובה שתגיד לנו למה
        return res.status(500).json({
            success: false,
            error_type: "GEMINI_CONNECTION_FAILURE",
            message: error.message,
            tip: "אם קיבלת 404 על הכל, ודא שהמפתח מ-AI Studio ולא מגוגל קלאוד הרגיל."
        });
    }
};
