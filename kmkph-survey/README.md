# KMKPH ’26 — Design & price survey

```
index.html            Survey page (4 steps, mobile-first)
assets/design-a..e    The 5 design posters (A Hitam+Ungu, B Hitam+Putih, C Cream+Navy, D Cream+Ungu, E Hitam+Emas)
apps-script/Survey.gs Backend: saves answers to Google Sheets, live Results tab
```

## Connect it (about 10 minutes, same as the MMU orders setup)

1. Create a blank Google Sheet, e.g. **KMKPH26 Survey**. Copy its ID (the long part of the URL between `/d/` and `/edit`).
2. Go to **script.new**, paste all of `apps-script/Survey.gs`, and put the Sheet ID into `SHEET_ID`. Save.
3. Run **`setup`** and allow the permissions. This creates the **Responses** and **Results** tabs.
4. **Deploy → New deployment → Web app**, with Execute as **Me** and Who has access **Anyone**. Copy the `/exec` URL.
5. Paste it into `SCRIPT_URL` in `index.html`, then commit and push.

## Reading the results

- **Results** tab: live vote counts and percentages for each design, second choice, sleeve, size, every price question and early bird, plus the average purchase intent (1–5).
- **Responses** tab: one row per answer. `Response ID` repeats if the same phone answered twice, so you can filter out duplicates.
- **Setting the price:** look at "Sanggup bayar" together with "Terlalu mahal" / "Terlalu murah". The best price sits above where most people say "too cheap" and below where they say "too expensive".
- To clear your own test answers, type `TEST` in Program/Kuliah when testing, then run `removeTestResponses`.
- To close the survey, set `SURVEY_OPEN: false` in `Survey.gs` and deploy a new version.
