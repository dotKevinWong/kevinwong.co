# 👨‍💻 KevinWong.co

💫 A little portfolio built with Next.js and ChakraUI

## ✅ To-Do
These are tasks that I ~~want~~ need to complete in the future 🤪
- [ ] Add blog posts
- [ ] Add more projects
- [ ] Add more statistics

## 😎 Getting Started

🫡 You are 100% free to copy my site. I just ask that you remove all of my personal information, projects, and writings. 

### 🦾 Prerequisites

- [Node.js](https://nodejs.org/en/)
- [Next.js](https://nextjs.org/)

### 👨‍💻 Installation

1. Clone the repo
   ````sh
   git clone https://github.com/dotKevinWong/kevinwong.co.git
   ````
2. Install NPM packages
   ````sh
    npm install .
   ````
3. Run the development server
   ````sh
   npm run dev
   ````

### 🎧 Spotify token rotation

Spotify expires user refresh tokens **six months after the original authorization**, and
refreshing an access token does **not** extend that window — so the `refresh_token` env var
has to be replaced roughly twice a year. ([Spotify's announcement][spotify-blog])

When it expires the token endpoint answers `400 invalid_grant`. The app treats that as
terminal: it stops calling Spotify, logs what to do, and the Spotify widgets fall back to
their empty states rather than erroring.

To mint a new token:

1. Add `http://127.0.0.1:8888/callback` to the Redirect URIs of the app in the
   [Spotify dashboard](https://developer.spotify.com/dashboard). Spotify rejects
   `localhost`, so the loopback IP is required.
2. Run it and approve access in the browser window that opens:
   ````sh
   npm run spotify:reauth
   ````
3. Put the printed token in `refresh_token` — both in `.env` and in the Vercel project's
   environment variables — then **redeploy**. Vercel only picks up env var changes on a
   new deployment.

Set a reminder for ~5 months out so this happens before the token dies rather than after.

[spotify-blog]: https://developer.spotify.com/blog/2026-06-18-refresh-token-expiration

## 📝 License
This project is licensed under the MIT License. See the [LICENSE](LICENSE.md) file for more information.

🗣️ All images, personal information, projects, and writings are not to be used without my permission and are not covered under the MIT License. You must remove all of my images, personal information, projects, and writings before using this project.
