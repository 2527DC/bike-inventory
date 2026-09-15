# Pending Questions for AI Analytics

1. **Dashboard Location:** We defaulted to `src/app/(dashboard)/analytics/ai-usage`. Let me know if you want to move it to `reports` or `settings`.
2. **Charting Library:** We installed `recharts` to build the charts. If you prefer another library (like Chart.js), we can swap it later.
3. **Database Schema:** We save the exact `cost` (Float) directly in the database for every request. If you'd rather calculate costs dynamically based on tokens on the frontend, let me know.
