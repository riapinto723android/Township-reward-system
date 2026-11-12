// Shared database for the GitHub Pages site.
//
// Leave this as null and the site saves on each device separately.
// Paste your Firebase web app settings here (Firebase console → Project settings →
// Your apps → SDK setup and configuration → Config) and every player shares the same
// trophies, diamonds, tasks and chats live. These values are not secret: they only
// identify your project, and firestore.rules decides what visitors may do.
//
// Example:
// window.FIREBASE_CONFIG = {
//   apiKey: "AIza...",
//   authDomain: "your-project.firebaseapp.com",
//   projectId: "your-project",
//   storageBucket: "your-project.appspot.com",
//   messagingSenderId: "1234567890",
//   appId: "1:1234567890:web:abc123"
// };
window.FIREBASE_CONFIG = null;
