# ⚡ WARP Desktop

אפליקציית הדסקטופ של WARP – כל המשחקים בחינם, בלי דפדפן.

## מה יש כאן?
- **WARP-Setup-1.0.0.exe** – מתקין רגיל עם קיצור דרך בשולחן העבודה
- **WARP-Portable-1.0.0.exe** – פותח ישירות, ללא התקנה

## איך לבנות?

### דרישות
- [Node.js](https://nodejs.org) גרסה 18+
- Windows (לבנות EXE)

### בניה
```bash
# התקן תלויות
npm install

# בנה את שני ה-EXEים
npm run build
```

הקבצים יופיעו בתיקיית `dist/`.

## מבנה הפרויקט
```
warp-desktop/
├── main.js          ← Electron main process
├── preload.js       ← Bridge בין UI לmain
├── preload-game.js  ← Bridge לחלון המשחק
├── src/
│   ├── index.html   ← UI הראשי
│   └── game-window.html ← חלון המשחק
├── assets/
│   └── icon.ico
└── package.json     ← הגדרות בניה
```

## שמירת משחקים אופליין
המשחקים נשמרים ב: `%APPDATA%\warp-desktop\`
- `games.json` – רשימת כל המשחקים (קאש)
- `saved_games.json` – המשחקים שבחרת לשמור
- `games_cache/` – קבצי המשחקים המורדים

## © 2025 WARP
