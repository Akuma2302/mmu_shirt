# MMU Collegiate Series ’26 — Pre-order site

```
index.html          Landing page and order form (one file, no build step)
apps-script/Code.gs Backend: Google Sheet + Drive + email confirmation
```

Here's how an order flows: **landing page → Apps Script Web App → Google Sheet (Orders, Items, Summary) + Drive folder (payment proofs) → confirmation email**.

## 1. Set up the Google Sheet and Apps Script

1. Create a new Google Sheet, for example "MMU26 Orders".
2. Go to **Extensions → Apps Script**, delete the sample code, and paste in all of `apps-script/Code.gs`. Save.
3. Choose `setup` in the function dropdown and click **Run**. Approve the permissions when asked (Sheets, Drive, Gmail send). This creates:
   - **Orders**: one row per order, with a Status dropdown and colour coding.
   - **Items**: one row per shirt line (variant, size, qty).
   - **Summary**: a live production count by size × sleeve, plus revenue and order counts. Cancelled orders aren't counted.
   - A Drive folder called **MMU26 Payment Proofs**. It stays private to you.
4. Go to **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click Deploy and copy the **Web app URL** (it ends in `/exec`).
5. Open `index.html` and paste that URL into `SCRIPT_URL` in the `CONFIG` block near the bottom.

> If you edit `Code.gs` later, go to **Deploy → Manage deployments → Edit → Version: New version**. Otherwise the old code keeps running.

## 2. Edit the content in `index.html`

These all live in the `CONFIG` block:
- `PRODUCTS`, `EARLY_BIRD_UNTIL`, `EARLY_BIRD_LIMIT`, `OPENS_AT`, `CLOSES_AT`: prices and dates. Keep them the same as in `Code.gs`, because the server recalculates every total itself. Early bird (RM59 short / RM65 long) lasts until 6 Dec 2026, 11:59 PM, or for the first 30 pieces, whichever comes first. The server counts pieces from the **Items** sheet (column "Price Type"). Cancelling an order gives its early-bird pieces back. Once `SCRIPT_URL` is set, the page shows the live "X of 30 left" count.
- `SIZE_CHART` / `CLOSES`: already filled in from the form's size chart image and the 5 Dec 2026 closing date. Update them if they change.
- `WHATSAPP`: your contact number, for example `60123456789`.
- Photos: the hero, product cards and long-sleeve banner use the clean mockups `assets/short-front.webp`, `short-back.webp`, `long-front.webp` and `long-back.webp`. Their white backgrounds blend into the page. The four close-up tiles show a region of `assets/mockup.webp` (the NL mockup poster). The regions are set in `CROPS` in the script as `[x, y, width, height]` in poster pixels. To use a real photo in a slot instead, drop a file into `assets/` with the matching name below and it replaces that region automatically:
  - `hero.jpg`: main banner, square, ideally models wearing the tee
  - `short-front.jpg`, `short-back.jpg`, `long-front.jpg`, `long-back.jpg`: product cards (4:5 portrait)
  - `detail-cotton.jpg`, `detail-embroidery.jpg`, `detail-collar.jpg`, `detail-stitch.jpg`: close-up tiles (4:3)
  - `lifestyle.jpg`: the "Made for everyday movement" banner

## 3. Host it (free)

Pick one:
- **Netlify Drop** (app.netlify.com/drop): drag the folder in and you get a link right away.
- **GitHub Pages**: push the repo, then Settings → Pages.
- **Google Sites**: embed the page.

## 4. Running the pre-order

- Check each new order's payment proof (the Drive link is in the Orders sheet), then set its Status to **Paid** or **Payment issue**.
- When pre-orders close, set `ORDERS_OPEN: false` in Code.gs and deploy a new version. Send the **Summary** tab to the supplier.
- When the shirts arrive, set orders to **Ready for pickup**, edit the `PICKUP` text in `emailPickupNotice`, and run it.
- At pickup, search for the Order ID and set the order to **Collected**.

## What else to add to the form

The landing page already includes these:
- **Multiple items in one order** (for example 2× M Short Sleeve + 1× L Long Sleeve) with a running total. The Google Form only allows one shirt per submission.
- **Order ID** shown on screen and sent by email, for pickup.
- **Size and no-refund acknowledgement**. Wrong sizes are the most common pre-order dispute.
- **PDPA consent** for name, phone and email (Malaysia PDPA 2010).
- **Optional Student/Staff ID**, for checking identity at pickup.
- **Optional notes**, plus a honeypot anti-spam field.

Worth considering next:
- **Pre-order closing date and production timeline** on the page, for example "Closes 30 Nov · Pickup est. mid-Jan". Buyers ask about this the most.
- **Real product photos** (front, back, embroidery close-up, on a model with the model's height and size) and a **colour** option if there's more than one.
- **Campus / pickup location choice** if MMU has more than one campus (Cyberjaya / Melaka).
- **Collect on behalf**: a field for the name of the person picking up.
- **Order limit or stock cap** if the supplier has a minimum or maximum quantity.
- **Payment method** beyond bank transfer, such as DuitNow QR (add a QR image to the payment box).
- **Club or batch bulk orders**, with a group name field for bulk discounts.
