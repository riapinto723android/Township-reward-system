# Township Reward System

A co-op rewards tracker for a 20-player township: trophies, diamonds, tasks, and chat.

## Features

1. **Township trophies**: the township's total, a tier road (Sprout → Legend), progress to the next tier, and a trophies-per-day chart.
2. **Township diamonds**: a diamond vault where each player's diamonds always equal their trophies (1 trophy = 1 diamond by default; the rate can be changed to 1:2, 1:5 or 1:10), vault chests every 1,000 diamonds, and diamonds per player.
3. **20 players**: a podium, player cards and a sortable table with each player's trophies, diamonds and tasks. Tap a player to rename them, pick a color, correct totals or send a message.
4. **Tasks**: log completed tasks by type (Regatta, helicopter, train, airplane, ship, zoo, factory, other). The page shows total tasks for each player, tasks by type, and a task log where entries can be removed.
5. **Chat**: a group chat (Town square) for all 20 players and a private chat between any two players, with unread badges.

## Live site

https://riapinto723android.github.io/Township-reward-system/

No sign-up, no email and no personal details are needed. Players just open the link and pick their
player slot under **Who are you?**

### Turning on GitHub Pages (one time)

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Pick branch **main** and folder **/ (root)**, then **Save**.

The site goes live at the address above within a minute or two, and redeploys on every push to `main`.

## Where data is saved

- **With Firebase set up** (`firebase-config.js` filled in): every player shares the same trophies,
  diamonds, tasks and chats, live. Visitors are signed in anonymously, so nobody needs an account or email.
- **Without Firebase** (`window.FIREBASE_CONFIG = null`): each browser saves its own data (localStorage),
  so other players don't see your changes. The first visit shows example data; use **Start fresh** to clear it.

## Setting up Firebase (free, one time)

1. Go to https://console.firebase.google.com and click **Create a project**. Give it a name; you can turn Google Analytics off.
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save.**
3. **Build → Firestore Database → Create database.** Pick a location near your players and start in **production mode**.
4. In Firestore, open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), and click **Publish**.
5. Click the **gear icon → Project settings → General**. Under **Your apps**, click the **web icon `</>`**, give it a nickname and click **Register app**.
6. Copy the `firebaseConfig` values into [`firebase-config.js`](firebase-config.js) (replace `null` with the object) and commit to `main`.
   These values aren't secret; the rules decide what visitors may do.

GitHub Pages redeploys in a minute or two, and the header changes to **Live · shared with your township**.

The free plan allows 50,000 reads and 20,000 writes a day. The app keeps running totals and loads only the latest
40 tasks and 150 chat messages, so a 20-player township stays well inside it.

## Running it locally

Open `index.html` in a browser. There's no build step.
