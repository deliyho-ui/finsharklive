function detectPattern(chartPoints) {
    // אנחנו צריכים לפחות 50 שבועות (כשנה) כדי לזהות תבניות ארוכות טווח באמינות
    if (!chartPoints || chartPoints.length < 50) return "אין מספיק נתונים לזיהוי תבניות מורכבות";

    const last20 = chartPoints.slice(-20); // 5 חודשים אחרונים למגמות קצרות
    const last50 = chartPoints.slice(-50); // שנה אחרונה לתבניות מאקרו
    const currentPoint = chartPoints[chartPoints.length - 1];
    const prevPoint = chartPoints[chartPoints.length - 2];
    const currentPrice = currentPoint.close;

    let patterns = [];

    // ==========================================
    // 1. חיתוכי ממוצעים (Moving Average Crosses)
    // ==========================================
    if (currentPoint.ma50 && currentPoint.ma200 && prevPoint.ma50 && prevPoint.ma200) {
        if (prevPoint.ma50 <= prevPoint.ma200 && currentPoint.ma50 > currentPoint.ma200) {
            patterns.push("חיתוך זהב (Golden Cross) - שורי חזק");
        } else if (prevPoint.ma50 >= prevPoint.ma200 && currentPoint.ma50 < currentPoint.ma200) {
            patterns.push("חיתוך מוות (Death Cross) - דובי חזק");
        }
    }

    // חילוץ מערכי מחירים נקיים
    const prices20 = last20.map(p => p.close);
    const max20 = Math.max(...prices20);
    const min20 = Math.min(...prices20);
    const prices50 = last50.map(p => p.close);
    
    // ==========================================
    // 2. ספל וידית (Cup and Handle)
    // ==========================================
    // מחלקים את השנה האחרונה ל-4 חלקים: שפה שמאלית, תחתית ספל, שפה ימנית, וידית
    const leftLip = Math.max(...prices50.slice(0, 10));
    const cupBottom = Math.min(...prices50.slice(10, 35));
    const rightLip = Math.max(...prices50.slice(35, 45));
    const handleBottom = Math.min(...prices50.slice(45));
    
    if (
        leftLip > cupBottom * 1.15 && // הספל צריך להיות מספיק עמוק (לפחות 15% ירידה)
        Math.abs(leftLip - rightLip) / leftLip < 0.08 && // השפתיים צריכות להיות באותו גובה בערך
        handleBottom > cupBottom && // הידית לא יורדת מתחת לספל
        currentPrice > handleBottom // המחיר מתחיל לפרוץ מהידית
    ) {
        patterns.push("ספל וידית (Cup & Handle) - תבנית איסוף שורית להמשך עליות");
    }

    // ==========================================
    // 3. ראש וכתפיים (Head and Shoulders)
    // ==========================================
    // מסתכלים על 7.5 חודשים אחרונים (30 שבועות) ומחלקים ל-3 אזורים
    const prices30 = chartPoints.slice(-30).map(p => p.close);
    const leftShoulder = Math.max(...prices30.slice(0, 10));
    const head = Math.max(...prices30.slice(10, 20));
    const rightShoulder = Math.max(...prices30.slice(20, 30));
    
    if (head > leftShoulder * 1.05 && head > rightShoulder * 1.05 && Math.abs(leftShoulder - rightShoulder) / leftShoulder < 0.06) {
        patterns.push("ראש וכתפיים (Head & Shoulders) - תבנית היפוך דובית");
    }

    // ראש וכתפיים הפוך (Inverse H&S)
    const leftShoulderInv = Math.min(...prices30.slice(0, 10));
    const headInv = Math.min(...prices30.slice(10, 20));
    const rightShoulderInv = Math.min(...prices30.slice(20, 30));

    if (headInv < leftShoulderInv * 0.95 && headInv < rightShoulderInv * 0.95 && Math.abs(leftShoulderInv - rightShoulderInv) / leftShoulderInv < 0.06) {
        patterns.push("ראש וכתפיים הפוך (Inverse H&S) - תבנית תחתית שורית חזקה");
    }

    // ==========================================
    // 4. משולש מתכנס (Symmetrical Triangle)
    // ==========================================
    // בדיקת כיווץ תנודתיות (שיאים יורדים ושפלים עולים) על פני 20 שבועות
    const highs = [Math.max(...prices20.slice(0, 6)), Math.max(...prices20.slice(7, 13)), Math.max(...prices20.slice(14, 20))];
    const lows = [Math.min(...prices20.slice(0, 6)), Math.min(...prices20.slice(7, 13)), Math.min(...prices20.slice(14, 20))];
    
    if (highs[0] > highs[1] && highs[1] > highs[2] && lows[0] < lows[1] && lows[1] < lows[2]) {
        patterns.push("התכנסות מחירים / משולש (Triangle) - התכווצות תנודתיות לקראת פריצה");
    }

    // ==========================================
    // 5. פסגה כפולה / תחתית כפולה (Double Top/Bottom)
    // ==========================================
    const firstHalf20 = prices20.slice(0, 10);
    const secondHalf20 = prices20.slice(10, 20);
    const max1 = Math.max(...firstHalf20);
    const max2 = Math.max(...secondHalf20);
    const min1 = Math.min(...firstHalf20);
    const min2 = Math.min(...secondHalf20);

    if (Math.abs(max1 - max2) / max1 < 0.03 && currentPrice < max2 * 0.95) {
        patterns.push("פסגה כפולה (Double Top) - התנגדות כפולה וסימן דובי");
    }
    if (Math.abs(min1 - min2) / min1 < 0.03 && currentPrice > min2 * 1.05) {
        patterns.push("תחתית כפולה (Double Bottom) - תמיכה כפולה וסימן שורי");
    }

    // ==========================================
    // 6. תמיכה ופריצות רגילות (Breakouts)
    // ==========================================
    if (currentPrice >= max20 * 0.99) {
        patterns.push("פריצת שיא מקומי (Breakout) - מומנטום חזק");
    } else if (currentPrice <= min20 * 1.01) {
        patterns.push("בוחנת אזור תמיכה תחתון (Support Zone)");
    }

    // אם הגרף לא עונה לאף חוק תבנית
    if (patterns.length === 0) return "דשדוש ותנועה צדדית ללא תבנית מובהקת (Consolidation)";

    // מסנן כפילויות במקרה ששתי תבניות קפצו יחד, ומחבר למחרוזת
    return [...new Set(patterns)].join(" | ");
}
